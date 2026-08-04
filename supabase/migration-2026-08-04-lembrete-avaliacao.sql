-- ============================================================================
-- Lembrete automático pro paciente avaliar o fisio 7 dias depois do
-- atendimento concluído, se ainda não avaliou. Reaproveita hc_disparar_push
-- (mesma infra de push já usada pra "agendamento criado" e "mensagem nova",
-- ver migration-2026-08-02-push-triggers.sql).
--
-- Depende de pg_cron pra rodar sozinho todo dia — extensão só existe no
-- Postgres hospedado pelo Supabase, então (assim como push-triggers.sql, que
-- depende de pg_net) este arquivo é pulado no Postgres efêmero do CI — ver
-- .github/workflows/test-db.yml.
--
-- A âncora dos "7 dias" é a data do atendimento (agendamentos.data), não a
-- data em que foi marcado como concluído — não existe essa segunda data
-- guardada, e normalmente as duas coincidem (o fisio marca concluído logo
-- depois de atender). Roda uma vez por dia comparando com igualdade exata
-- (a.data = current_date - 7), então cada atendimento gera no máximo um
-- lembrete, sem precisar guardar "já mandei lembrete pra esse".
-- ============================================================================

create extension if not exists pg_cron;

create or replace function public.hc_lembrar_avaliacao_pendente()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  for r in
    select p.user_id as paciente_user_id, f.nome as fisio_nome
    from agendamentos a
    join pedidos p on p.id = a.pedido_id
    join fisios f on f.id = a.fisio_id
    where a.status = 'concluido'
      and a.data = current_date - 7
      and not exists (select 1 from avaliacoes av where av.agendamento_id = a.id)
  loop
    perform hc_disparar_push(
      r.paciente_user_id,
      'Como foi seu atendimento?',
      'Avalie ' || r.fisio_nome || ' e ajude outros pacientes a escolher com confiança.',
      '/app.html?papel=paciente'
    );
  end loop;
end;
$$;

-- Só o job agendado chama isso (roda como o dono do cron, não como usuário
-- logado) — ninguém deveria conseguir disparar isso na mão pelo cliente.
revoke all on function public.hc_lembrar_avaliacao_pendente() from public, anon, authenticated;

-- cron.schedule com o mesmo nome atualiza o agendamento existente em vez de
-- duplicar, mas o unschedule antes deixa reaplicar esta migration sem erro
-- em versões do pg_cron que não fazem upsert.
do $$
begin
  perform cron.unschedule('lembrete-avaliacao-diario');
exception when others then
  null;
end $$;

select cron.schedule(
  'lembrete-avaliacao-diario',
  '0 12 * * *', -- todo dia às 12:00 UTC (09:00 no horário de Brasília)
  $$select public.hc_lembrar_avaliacao_pendente();$$
);
