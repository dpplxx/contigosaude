-- ============================================================================
-- Migração: limpeza de duas sobras de migration-auth-paciente.sql
--
-- 1. agendamentos.status — aquela migração mudou o default pra 'pendente' e
--    ampliou o check pra aceitar 'pendente'/'recusado', mas o frontend
--    (STATUS_AGENDAMENTO em src/lib/utils.js) só sabe mostrar 'agendado',
--    'concluido' e 'cancelado'. Todo agendamento novo criado pelo Painel
--    (que não informa status no insert) nascia com um valor que a tela do
--    fisio não reconhecia. Confirmado 0 agendamentos com esses valores antes
--    de rodar isso, então é seguro reverter o default e o check pro estado
--    original.
--
-- 2. Tabela "pacientes" — criada pela mesma migração, alimentada por um
--    trigger em todo signup (paciente OU fisio, já que dividem o mesmo
--    auth.users), guardando nome/email duplicados. Nenhuma tela lê essa
--    tabela hoje. RLS nela sempre esteve correto (cada um só via a própria
--    linha), não era uma falha de segurança — só coleta sem uso. Confirmado
--    3 linhas antes de apagar (dado recuperável de auth.users se precisar).
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
-- ============================================================================

alter table public.agendamentos alter column status set default 'agendado';

alter table public.agendamentos
  drop constraint if exists agendamentos_status_check,
  add constraint agendamentos_status_check
    check (status in ('agendado', 'concluido', 'cancelado'));

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_auth_user();
drop table if exists public.pacientes;
