-- ============================================================================
-- Migração: escritas do Painel administrativo passam a ir por RPC
--
-- atualizarStatusPedido, atualizarStatusAgendamentoPainel, agendar e
-- avaliarPeloPainel (src/lib/api.js) escreviam direto nas tabelas, contando
-- só com a policy RLS "painel_total" (using hc_e_admin()) pra proteger. Era
-- o único canto do app que não passava pela camada hc_* — todo o resto já
-- usa RPC security definer com revoke explícito de public/anon, inclusive a
-- lógica antifraude que blinda hc_fechar_agendamento e hc_avaliar contra
-- autoavaliação. Esta migração cria os 4 equivalentes administrativos,
-- cada um checando hc_e_admin() por dentro, pra fechar essa exceção e
-- deixar a superfície de escrita consistente.
--
-- Depois de rodar isto e atualizar o app (já feito em api.js/Painel.jsx),
-- dá pra revogar UPDATE/INSERT direto nas 4 tabelas na policy
-- "painel_total" e deixar só SELECT — não incluído aqui de propósito, pra
-- não quebrar nada que ainda dependa da policy antiga antes do frontend
-- novo estar no ar. Fazer isso é o próximo passo natural, não uma migração
-- nova.
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. hc_admin_atualizar_status_pedido
-- ----------------------------------------------------------------------------

create or replace function public.hc_admin_atualizar_status_pedido(
  p_pedido_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not hc_e_admin() then
    raise exception 'Sem permissão. Esta ação é restrita a administradores.';
  end if;

  if p_status not in ('ativo', 'arquivado') then
    raise exception 'Status inválido.';
  end if;

  update pedidos set status = p_status where id = p_pedido_id;
end $$;

revoke all on function public.hc_admin_atualizar_status_pedido(uuid, text) from public, anon;
grant execute on function public.hc_admin_atualizar_status_pedido(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. hc_admin_atualizar_status_agendamento
-- ----------------------------------------------------------------------------

create or replace function public.hc_admin_atualizar_status_agendamento(
  p_agendamento_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not hc_e_admin() then
    raise exception 'Sem permissão. Esta ação é restrita a administradores.';
  end if;

  if p_status not in ('agendado', 'concluido', 'cancelado') then
    raise exception 'Status inválido.';
  end if;

  update agendamentos set status = p_status where id = p_agendamento_id;
end $$;

revoke all on function public.hc_admin_atualizar_status_agendamento(uuid, text) from public, anon;
grant execute on function public.hc_admin_atualizar_status_agendamento(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. hc_admin_criar_agendamento — o Painel ainda pode fechar um atendimento
--    manualmente (fluxo alternativo ao fisio fechar sozinho pelo próprio
--    painel via hc_fechar_agendamento). Mesmo índice único de
--    agendamentos_pedido_unico impede duplicar.
-- ----------------------------------------------------------------------------

create or replace function public.hc_admin_criar_agendamento(
  p_pedido_id uuid,
  p_fisio_id uuid,
  p_data date,
  p_horario time
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not hc_e_admin() then
    raise exception 'Sem permissão. Esta ação é restrita a administradores.';
  end if;

  begin
    insert into agendamentos (pedido_id, fisio_id, data, horario)
    values (p_pedido_id, p_fisio_id, p_data, p_horario)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Esse pedido já tem um agendamento.';
  end;

  return v_id;
end $$;

revoke all on function public.hc_admin_criar_agendamento(uuid, uuid, date, time) from public, anon;
grant execute on function public.hc_admin_criar_agendamento(uuid, uuid, date, time) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. hc_admin_avaliar — registro manual de avaliação pelo Painel. Ação
--    administrativa (ex.: paciente avaliou por telefone) — de propósito não
--    tem a checagem de "já teve atendimento" nem a trava de duplicata que
--    hc_avaliar tem, porque quem decide se a avaliação é legítima aqui é o
--    admin, não o sistema. Ainda assim bloqueia autoavaliação: mesmo admin
--    não pode inflar a própria nota se também for fisio cadastrado.
-- ----------------------------------------------------------------------------

create or replace function public.hc_admin_avaliar(
  p_fisio_id uuid,
  p_nota integer,
  p_comentario text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not hc_e_admin() then
    raise exception 'Sem permissão. Esta ação é restrita a administradores.';
  end if;

  if p_nota < 1 or p_nota > 5 then
    raise exception 'Nota inválida.';
  end if;

  if exists (select 1 from fisios where id = p_fisio_id and user_id = auth.uid()) then
    raise exception 'Você não pode avaliar seu próprio cadastro.';
  end if;

  insert into avaliacoes (fisio_id, nota, comentario)
  values (p_fisio_id, p_nota, nullif(trim(p_comentario), ''));
end $$;

revoke all on function public.hc_admin_avaliar(uuid, integer, text) from public, anon;
grant execute on function public.hc_admin_avaliar(uuid, integer, text) to authenticated;
