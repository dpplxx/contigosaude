-- Vincula a verificação do Turnstile (supabase/functions/verify-turnstile)
-- ao cadastro novo de fisioterapeuta no servidor. Antes, o Turnstile era só
-- uma chamada separada (src/lib/api.js → verificarTurnstile) sem nenhum
-- vínculo com hc_cadastrar_fisio — quem chamasse a RPC direto pelo cliente
-- Supabase (sem passar pela tela de cadastro) pulava o captcha inteiro.
--
-- Como funciona agora: verify-turnstile grava uma verificação válida por 10
-- minutos pro auth.uid() de quem chamou (precisa estar logado — e
-- hc_cadastrar_fisio já exige isso). hc_cadastrar_fisio consome (apaga) essa
-- verificação ao criar um cadastro NOVO (edição de perfil existente continua
-- sem exigir, igual já era no frontend).
--
-- ENFORCEMENT É OPT-IN DE PROPÓSITO: por padrão a checagem não bloqueia
-- nada (app.turnstile_obrigatorio não configurado = permissivo, igual ao
-- comportamento atual). SÓ ative depois de confirmar que:
--   1. supabase/functions/verify-turnstile está implantada
--      (supabase functions deploy verify-turnstile)
--   2. o secret TURNSTILE_SECRET_KEY está configurado nela
--   3. você testou um cadastro novo de fisio de ponta a ponta e funcionou
-- Só depois disso, rode:
--   alter database postgres set app.turnstile_obrigatorio = 'true';
-- Se ativar cedo demais (function não implantada), TODO cadastro novo de
-- fisio vai passar a falhar — ninguém consegue se cadastrar até desativar
-- de novo ou terminar o deploy.

create table if not exists public.turnstile_verificacoes (
  user_id uuid primary key,
  verificado_em timestamptz not null default now()
);

alter table public.turnstile_verificacoes enable row level security;
-- Sem policy nenhuma pra anon/authenticated: só a Edge Function
-- verify-turnstile (service role) escreve, e só hc_cadastrar_fisio
-- (security definer) lê/apaga.

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
  p_crefito_uf text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_uid uuid := auth.uid();
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

  select id into v_id from fisios where user_id = v_uid limit 1;

  if v_id is null then
    select id into v_id from fisios
    where whatsapp_chave = hc_chave(p_whatsapp) and user_id is null
    limit 1;
  end if;

  v_cadastro_novo := v_id is null;

  -- Só cadastro novo exige Turnstile — editar o próprio perfil já provado
  -- não é o risco que o captcha existe pra filtrar (mesma regra que já
  -- estava no frontend, ver src/components/Fisio.jsx).
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
      user_id = v_uid
    where id = v_id;
    return v_id;
  end if;

  insert into fisios (
    nome, whatsapp, especialidades, cidade, bairros,
    formacao, resumo, disponibilidade, valor_sessao,
    cep, uf, lat, lng, raio_km, crefito, crefito_uf, user_id
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
    v_uid
  )
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.hc_cadastrar_fisio(
  text, text, text[], text, text, text[], text, text, numeric, text, text,
  double precision, double precision, integer, text, text
) from public, anon;
grant execute on function public.hc_cadastrar_fisio(
  text, text, text[], text, text, text[], text, text, numeric, text, text,
  double precision, double precision, integer, text, text
) to authenticated;
