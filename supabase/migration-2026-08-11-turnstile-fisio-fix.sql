-- Reconcilia hc_cadastrar_fisio depois que dois trabalhos em paralelo
-- mexeram nela: migration-2026-08-09-turnstile-server-side.sql adicionou a
-- checagem de Turnstile numa versão de 16 parâmetros; depois,
-- migration-2026-08-11-info-atendimento.sql adicionou 3 parâmetros novos
-- (locais_atendimento, forma_pagamento, convenios), criando uma versão de
-- 19 parâmetros.
--
-- Como o número de parâmetros mudou, "create or replace function" NÃO
-- substituiu a função antiga — criou uma SEGUNDA sobrecarga. Resultado:
-- duas versões de hc_cadastrar_fisio coexistindo. Qualquer chamada que use
-- os parâmetros novos (locais_atendimento etc.) cai na versão de 19
-- parâmetros, que não tem a checagem de Turnstile — o captcha ficava órfão,
-- pulável de novo assim que o app passasse a mandar esses parâmetros.
--
-- Esta migration junta as duas: mantém os 19 parâmetros atuais (compatível
-- com o app) e devolve a checagem de Turnstile, apagando a sobrecarga de 16
-- parâmetros pra sobrar só UMA versão da função.

drop function if exists public.hc_cadastrar_fisio(
  text, text, text[], text, text, text[], text, text, numeric, text, text,
  double precision, double precision, integer, text, text
);

create or replace function public.hc_cadastrar_fisio(
  p_nome text,
  p_whatsapp text,
  p_especialidades text[],
  p_cidade text,
  p_formacao text,
  p_bairros text[] default '{}',
  p_resumo text default null,
  p_disponibilidade text default null,
  p_valor_sessao numeric default null,
  p_cep text default null,
  p_uf text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_raio_km integer default 10,
  p_crefito text default null,
  p_crefito_uf text default null,
  p_locais_atendimento text[] default '{}',
  p_forma_pagamento text default null,
  p_convenios text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_uid uuid := auth.uid();
  v_locais text[] := coalesce(p_locais_atendimento, '{}');
  v_convenios text[];
  v_cadastro_novo boolean;
  v_turnstile_ok boolean;
begin
  if v_uid is null then
    raise exception 'Você precisa estar logado para se cadastrar.';
  end if;

  if not hc_checar_limite('cadastro_fisio:' || v_uid::text, 'cadastrar_fisio', 10, 10) then
    raise exception 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.';
  end if;

  if length(coalesce(trim(p_nome), '')) < 2 then
    raise exception 'Informe seu nome.';
  end if;

  if length(hc_chave(p_whatsapp)) < 8 then
    raise exception 'WhatsApp inválido.';
  end if;

  if coalesce(array_length(p_especialidades, 1), 0) = 0 then
    raise exception 'Escolha ao menos uma especialidade.';
  end if;

  if length(coalesce(trim(p_cidade), '')) < 2 then
    raise exception 'Informe a cidade onde você atende.';
  end if;

  if p_raio_km is null or p_raio_km < 1 or p_raio_km > 100 then
    raise exception 'O raio de atendimento deve ficar entre 1 e 100 km.';
  end if;

  if not (v_locais <@ array['domicilio', 'clinica', 'consultorio', 'outro']::text[]) then
    raise exception 'Local de atendimento inválido.';
  end if;

  if p_forma_pagamento is not null and p_forma_pagamento not in ('particular', 'convenio', 'particular_e_convenio') then
    raise exception 'Forma de pagamento inválida.';
  end if;

  select coalesce(array_agg(nullif(trim(c), '')), '{}')
  into v_convenios
  from unnest(coalesce(p_convenios, '{}')) as c
  where nullif(trim(c), '') is not null;

  -- Cadastro já vinculado a esta conta tem prioridade.
  select id into v_id from fisios where user_id = v_uid limit 1;

  -- Sem isso, adota um cadastro órfão (de antes do login existir) com o
  -- mesmo WhatsApp.
  if v_id is null then
    select id into v_id from fisios
    where whatsapp_chave = hc_chave(p_whatsapp) and user_id is null
    limit 1;
  end if;

  v_cadastro_novo := v_id is null;

  -- Só cadastro novo exige Turnstile — editar o próprio perfil já provado
  -- não é o risco que o captcha existe pra filtrar.
  if v_cadastro_novo and coalesce(current_setting('app.turnstile_obrigatorio', true), 'false') = 'true' then
    select exists (
      select 1 from public.turnstile_verificacoes
      where user_id = v_uid and verificado_em > now() - interval '10 minutes'
    ) into v_turnstile_ok;

    if not v_turnstile_ok then
      raise exception 'Verificação de segurança expirada ou ausente. Recarregue a página e tente de novo.';
    end if;

    delete from public.turnstile_verificacoes where user_id = v_uid;
  end if;

  if v_id is not null then
    update fisios set
      nome = trim(p_nome),
      whatsapp = trim(p_whatsapp),
      especialidades = p_especialidades,
      cidade = trim(p_cidade),
      bairros = coalesce(p_bairros, '{}'),
      formacao = nullif(trim(p_formacao), ''),
      resumo = nullif(trim(p_resumo), ''),
      disponibilidade = nullif(trim(p_disponibilidade), ''),
      valor_sessao = p_valor_sessao,
      cep = nullif(regexp_replace(coalesce(p_cep, ''), '[^0-9]', '', 'g'), ''),
      uf = nullif(upper(trim(coalesce(p_uf, ''))), ''),
      lat = p_lat,
      lng = p_lng,
      raio_km = p_raio_km,
      crefito = nullif(trim(p_crefito), ''),
      crefito_uf = nullif(upper(trim(coalesce(p_crefito_uf, ''))), ''),
      locais_atendimento = v_locais,
      forma_pagamento = p_forma_pagamento,
      convenios = v_convenios,
      user_id = v_uid
    where id = v_id;
    return v_id;
  end if;

  insert into fisios (
    nome, whatsapp, especialidades, cidade, bairros,
    formacao, resumo, disponibilidade, valor_sessao,
    cep, uf, lat, lng, raio_km, crefito, crefito_uf,
    locais_atendimento, forma_pagamento, convenios, user_id
  )
  values (
    trim(p_nome), trim(p_whatsapp), p_especialidades, trim(p_cidade),
    coalesce(p_bairros, '{}'),
    nullif(trim(p_formacao), ''), nullif(trim(p_resumo), ''),
    nullif(trim(p_disponibilidade), ''), p_valor_sessao,
    nullif(regexp_replace(coalesce(p_cep, ''), '[^0-9]', '', 'g'), ''),
    nullif(upper(trim(coalesce(p_uf, ''))), ''),
    p_lat, p_lng, p_raio_km,
    nullif(trim(p_crefito), ''), nullif(upper(trim(coalesce(p_crefito_uf, ''))), ''),
    v_locais, p_forma_pagamento, v_convenios, v_uid
  )
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.hc_cadastrar_fisio(
  text, text, text[], text, text, text[], text, text, numeric, text, text,
  double precision, double precision, integer, text, text, text[], text, text[]
) from public, anon;
grant execute on function public.hc_cadastrar_fisio(
  text, text, text[], text, text, text[], text, text, numeric, text, text,
  double precision, double precision, integer, text, text, text[], text, text[]
) to authenticated;
