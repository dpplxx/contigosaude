-- ============================================================================
-- Migração: impedir que um fisio avalie a si mesmo
--
-- Paciente e fisio usam a mesma conta (Supabase Auth) — o app só decide qual
-- tela mostrar pelo que a pessoa clica ("Sou paciente" / "Sou fisioterapeuta"),
-- não existe distinção de tipo de conta no login. Isso abre uma fraude óbvia
-- desde que hc_fechar_agendamento existe: um fisio loga, clica em "Sou
-- paciente" com a MESMA conta, cria um pedido falso, fecha esse pedido com o
-- próprio cadastro de fisio, marca como concluído e se autoavalia com 5
-- estrelas pra inflar a própria nota. Confirmado 1 conta hoje que já tem
-- pedido E cadastro de fisio ao mesmo tempo (sem fraude ainda, mas a
-- possibilidade é real).
--
-- Três camadas, cada uma fechando o problema num ponto diferente:
--
-- 1. hc_criar_pedido — uma conta que já tem cadastro de fisio não consegue
--    criar pedido como paciente. É o bloqueio mais cedo possível: se isso
--    não existe, os outros dois nem chegam a ser testados na prática.
--
-- 2. hc_fechar_agendamento — mesmo que o bloqueio 1 seja contornado de
--    algum jeito (ou já exista pedido antigo de conta que virou fisio
--    depois), a função recusa fechar um pedido que pertence à própria
--    conta do fisio.
--
-- 3. hc_avaliar — última rede de segurança: recusa avaliação se o fisio
--    sendo avaliado é a própria conta de quem está avaliando, não importa
--    como o agendamento foi criado (inclusive pelo Painel administrativo).
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. hc_criar_pedido — mesma assinatura de hoje, create or replace direto.
-- ----------------------------------------------------------------------------

create or replace function public.hc_criar_pedido(
  p_nome text,
  p_whatsapp text,
  p_especialidade text,
  p_cidade text,
  p_bairro text,
  p_urgencia text,
  p_observacoes text default null,
  p_cep text default null,
  p_uf text default null,
  p_lat double precision default null,
  p_lng double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_proximos integer;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Você precisa estar logado para pedir atendimento.';
  end if;

  if exists (select 1 from fisios where user_id = v_uid) then
    raise exception 'Esta conta já tem um cadastro de fisioterapeuta. Use outra conta para pedir atendimento como paciente.';
  end if;

  if length(coalesce(trim(p_nome), '')) < 2 then
    raise exception 'Informe o nome de quem vai receber o atendimento.';
  end if;

  if length(hc_chave(p_whatsapp)) < 8 then
    raise exception 'WhatsApp inválido.';
  end if;

  if length(coalesce(trim(p_cidade), '')) < 2
     or length(coalesce(trim(p_bairro), '')) < 2 then
    raise exception 'Informe cidade e bairro.';
  end if;

  if (
    select count(*)
    from pedidos
    where user_id = v_uid
      and status = 'ativo'
  ) >= 5 then
    raise exception 'Você já tem pedidos abertos. Aguarde o contato da equipe.';
  end if;

  insert into pedidos (
    nome, whatsapp, especialidade, cidade, bairro, urgencia, observacoes,
    cep, uf, lat, lng, user_id
  )
  values (
    trim(p_nome), trim(p_whatsapp), p_especialidade,
    trim(p_cidade), trim(p_bairro), p_urgencia, nullif(trim(p_observacoes), ''),
    nullif(regexp_replace(coalesce(p_cep, ''), '[^0-9]', '', 'g'), ''),
    nullif(upper(trim(coalesce(p_uf, ''))), ''),
    p_lat, p_lng, v_uid
  )
  returning id into v_id;

  select count(*) into v_proximos
  from fisios f
  where hc_compativel(
    f.especialidades, f.cidade, f.bairros, f.lat, f.lng, f.raio_km,
    p_especialidade, trim(p_cidade), trim(p_bairro), p_lat, p_lng
  );

  return jsonb_build_object('id', v_id, 'fisios_proximos', v_proximos);
end $$;

revoke all on function public.hc_criar_pedido(
  text, text, text, text, text, text, text, text, text,
  double precision, double precision
) from public, anon;
grant execute on function public.hc_criar_pedido(
  text, text, text, text, text, text, text, text, text,
  double precision, double precision
) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. hc_fechar_agendamento — mesma assinatura de hoje.
-- ----------------------------------------------------------------------------

create or replace function public.hc_fechar_agendamento(
  p_pedido_id uuid,
  p_data date,
  p_horario time
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fisio fisios%rowtype;
  v_pedido pedidos%rowtype;
  v_agendamento_id uuid;
begin
  select * into v_fisio from fisios where user_id = auth.uid() limit 1;
  if v_fisio.id is null then
    raise exception 'Você precisa ter um cadastro de fisioterapeuta pra fechar um atendimento.';
  end if;

  select * into v_pedido from pedidos
  where id = p_pedido_id and status = 'ativo' and deletado_em is null;
  if v_pedido.id is null then
    raise exception 'Pedido não encontrado ou já foi atendido.';
  end if;

  if v_pedido.user_id = auth.uid() then
    raise exception 'Você não pode fechar um pedido enviado pela sua própria conta.';
  end if;

  if not hc_compativel(
    v_fisio.especialidades, v_fisio.cidade, v_fisio.bairros, v_fisio.lat, v_fisio.lng, v_fisio.raio_km,
    v_pedido.especialidade, v_pedido.cidade, v_pedido.bairro, v_pedido.lat, v_pedido.lng
  ) then
    raise exception 'Esse pedido não é compatível com sua região ou especialidade.';
  end if;

  begin
    insert into agendamentos (pedido_id, fisio_id, data, horario, status)
    values (p_pedido_id, v_fisio.id, p_data, p_horario, 'agendado')
    returning id into v_agendamento_id;
  exception when unique_violation then
    raise exception 'Esse pedido já foi fechado por outro profissional.';
  end;

  return jsonb_build_object(
    'agendamento_id', v_agendamento_id,
    'paciente_nome', v_pedido.nome,
    'paciente_whatsapp', v_pedido.whatsapp
  );
end $$;

revoke all on function public.hc_fechar_agendamento(uuid, date, time) from public, anon;
grant execute on function public.hc_fechar_agendamento(uuid, date, time) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. hc_avaliar — última rede de segurança, mesma assinatura de hoje.
-- ----------------------------------------------------------------------------

create or replace function public.hc_avaliar(
  p_fisio_id uuid,
  p_nota integer,
  p_comentario text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agendamento_id uuid;
begin
  if p_nota < 1 or p_nota > 5 then
    raise exception 'Nota inválida.';
  end if;

  if exists (select 1 from fisios where id = p_fisio_id and user_id = auth.uid()) then
    raise exception 'Você não pode avaliar seu próprio cadastro.';
  end if;

  select a.id into v_agendamento_id
  from agendamentos a
  join pedidos p on p.id = a.pedido_id
  where a.fisio_id = p_fisio_id
    and p.user_id = auth.uid()
  order by a.criado_em desc
  limit 1;

  if v_agendamento_id is null then
    raise exception 'Você só pode avaliar um profissional que já te atendeu.';
  end if;

  if exists (select 1 from avaliacoes where agendamento_id = v_agendamento_id) then
    raise exception 'Você já avaliou este atendimento.';
  end if;

  insert into avaliacoes (fisio_id, nota, comentario, agendamento_id)
  values (p_fisio_id, p_nota, nullif(trim(p_comentario), ''), v_agendamento_id);
end $$;

revoke all on function public.hc_avaliar(uuid, integer, text) from public, anon;
grant execute on function public.hc_avaliar(uuid, integer, text) to authenticated;
