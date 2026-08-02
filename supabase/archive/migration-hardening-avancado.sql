-- ============================================================================
-- Migração: hardening avançado pós-auditoria
--
-- A auditoria de 2026-08-01 (migration-auditoria-seguranca.sql) fechou as
-- falhas exploráveis. Esta migração vai além: aplica defesa em profundidade
-- pra reduzir o dano de uma falha futura, mesmo que ela escape da revisão.
--
-- 1. Auditoria de verdade — a tabela "auditoria" existia desde o schema.sql
--    original, com política RLS e função de limpeza, mas NADA escrevia
--    nela. Uma trilha de auditoria que não registra nada é só decoração.
--    Agora todo INSERT/UPDATE/DELETE em pedidos, fisios, agendamentos e
--    mensagens fica registrado: quem (auth.uid()), o quê, quando, e o
--    antes/depois. Isso é o que permite responder "quem mudou isso e
--    quando" depois de um incidente — sem isso, um admin comprometido (ou
--    uma falha futura como a de hc_anonimizar_paciente) não deixa rastro.
--
-- 2. Trava contra avaliação duplicada — hc_avaliar não impedia o mesmo
--    paciente de enviar 50 avaliações pro mesmo atendimento. Não é uma
--    falha de acesso (só avalia quem realmente foi atendido), mas é uma
--    falha de integridade que permite manipular a nota média de um fisio.
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. AUDITORIA REAL
-- ----------------------------------------------------------------------------

create or replace function public.hc_registrar_auditoria()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.auditoria (tabela, operacao, usuario_id, linha_id, dados_antigos, dados_novos)
  values (
    TG_TABLE_NAME,
    TG_OP,
    auth.uid(),
    coalesce(new.id, old.id),
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end $$;

revoke all on function public.hc_registrar_auditoria() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'auditoria_pedidos') then
    create trigger auditoria_pedidos
      after insert or update or delete on public.pedidos
      for each row execute function public.hc_registrar_auditoria();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'auditoria_fisios') then
    create trigger auditoria_fisios
      after insert or update or delete on public.fisios
      for each row execute function public.hc_registrar_auditoria();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'auditoria_agendamentos') then
    create trigger auditoria_agendamentos
      after insert or update or delete on public.agendamentos
      for each row execute function public.hc_registrar_auditoria();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'auditoria_mensagens') then
    create trigger auditoria_mensagens
      after insert or update or delete on public.mensagens
      for each row execute function public.hc_registrar_auditoria();
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. TRAVA CONTRA AVALIAÇÃO DUPLICADA
--
-- avaliacoes não guardava nenhum vínculo com o atendimento (é anônima por
-- design — a tabela nunca expôs nome/contato do paciente). Sem esse
-- vínculo não dá pra saber se uma conta já avaliou aquele atendimento
-- específico, então nada impedia enviar a mesma avaliação 50 vezes e
-- manipular a nota média de um fisio. Adiciona agendamento_id (nunca
-- devolvido por hc_avaliacoes_fisio, então não quebra o anonimato) só
-- pra permitir essa checagem.
-- ----------------------------------------------------------------------------

alter table public.avaliacoes add column if not exists agendamento_id uuid references public.agendamentos (id) on delete cascade;
create unique index if not exists avaliacoes_agendamento_unico on public.avaliacoes (agendamento_id) where agendamento_id is not null;

-- Mesma assinatura de hoje — create or replace direto, sem drop.
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
