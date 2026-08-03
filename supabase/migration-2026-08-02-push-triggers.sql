-- ============================================================================
-- Push de verdade: dispara send-push automaticamente do banco, sem depender
-- do cliente que fez a escrita continuar online pra avisar o outro lado.
--
-- pg_net.http_post() é assíncrono (enfileira e processa em background worker
-- do Postgres) — não trava a transação que criou o agendamento/mensagem.
--
-- A Authorization usa a chave anon (mesma que já vai pro navegador em todo
-- request do app — não é segredo novo nenhum, só repete o que já está
-- público em VITE_SUPABASE_ANON_KEY).
-- ============================================================================

create extension if not exists pg_net with schema extensions;

create or replace function public.hc_disparar_push(
  p_user_id uuid,
  p_titulo text,
  p_corpo text default '',
  p_url text default '/app.html'
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if p_user_id is null then
    return;
  end if;

  perform net.http_post(
    url := 'https://zjeyzqxphzzbitgrkoac.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_D5UJYqzJGBI1jU5-NjtwhQ_DqU-qOE2'
    ),
    body := jsonb_build_object(
      'userId', p_user_id,
      'titulo', p_titulo,
      'corpo', p_corpo,
      'url', p_url
    )
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- Agendamento criado → avisa o paciente
-- ----------------------------------------------------------------------------

create or replace function public.hc_notificar_agendamento_criado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_fisio_nome text;
begin
  select p.user_id, f.nome into v_user_id, v_fisio_nome
  from pedidos p, fisios f
  where p.id = new.pedido_id and f.id = new.fisio_id;

  if v_user_id is not null then
    perform hc_disparar_push(
      v_user_id,
      'Seu pedido foi agendado!',
      coalesce(v_fisio_nome, 'Um fisioterapeuta') || ' vai te atender. Veja os detalhes no app.',
      '/app.html'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notificar_agendamento_criado on agendamentos;
create trigger trg_notificar_agendamento_criado
  after insert on agendamentos
  for each row execute function hc_notificar_agendamento_criado();

-- ----------------------------------------------------------------------------
-- Mensagem nova → avisa quem não escreveu
-- ----------------------------------------------------------------------------

create or replace function public.hc_notificar_nova_mensagem()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_destinatario uuid;
begin
  if new.remetente = 'paciente' then
    select f.user_id into v_destinatario
    from agendamentos a join fisios f on f.id = a.fisio_id
    where a.id = new.agendamento_id;
  else
    select p.user_id into v_destinatario
    from agendamentos a join pedidos p on p.id = a.pedido_id
    where a.id = new.agendamento_id;
  end if;

  if v_destinatario is not null then
    perform hc_disparar_push(
      v_destinatario,
      'Nova mensagem no Contigo Saúde',
      left(new.texto, 120),
      '/app.html'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notificar_nova_mensagem on mensagens;
create trigger trg_notificar_nova_mensagem
  after insert on mensagens
  for each row execute function hc_notificar_nova_mensagem();
