-- ============================================================================
-- Migração: isolar dados do paciente pela conta logada
--
-- hc_meus_pedidos, hc_enviar_mensagem (lado paciente) e hc_avaliar usam só o
-- WhatsApp digitado como identidade — sem checar login nenhum. WhatsApp não é
-- segredo: qualquer pessoa que souber o número de alguém consegue ler os
-- pedidos dela (nome, observações, e se já tiver agendamento, o fisio
-- vinculado e a conversa inteira do chat), ou mandar mensagem e nota se
-- passando por ela. Confirmado ao vivo antes desta migração.
--
-- O paciente já loga com email/senha hoje (AuthEmail.jsx), então dá pra
-- fechar isso do mesmo jeito que já foi feito pro fisio em
-- migration-fisio-auth.sql: vincular pedidos.user_id à conta e trocar as
-- checagens de WhatsApp por auth.uid().
--
-- Cadastros feitos antes desta migração (sem user_id) deixam de aparecer em
-- "Meus pedidos" — aceitável nesta fase de protótipo, com poucos registros
-- reais, em troca de fechar um vazamento de verdade.
--
-- IMPORTANTE sobre permissões: o Supabase configura "default privileges" no
-- schema public que concedem EXECUTE direto ao papel "anon" (não só via
-- PUBLIC) toda vez que uma função é criada do zero. "drop function" seguido
-- de "create or replace" conta como criar do zero. Por isso todo REVOKE
-- abaixo é feito de "public, anon" explicitamente — só "from public" não
-- basta e deixa a função ainda chamável por qualquer um sem login
-- (confirmado ao vivo: has_function_privilege('anon', ..., 'execute')
-- continuava true até revogar de anon também).
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
-- ============================================================================

alter table public.pedidos add column if not exists user_id uuid references auth.users (id) on delete set null;
create index if not exists pedidos_user_id_idx on public.pedidos (user_id);

-- ============================================================================
-- hc_criar_pedido — mesma assinatura de antes, agora exige login e grava
-- quem pediu.
-- ============================================================================

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

  -- Trava simples de spam: no máximo 5 pedidos abertos por conta.
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

-- ============================================================================
-- hc_meus_pedidos — trocou de "hc_meus_pedidos(whatsapp)" pra
-- "hc_meus_pedidos()" sem parâmetro nenhum: usa só a conta logada.
-- ============================================================================

drop function if exists public.hc_meus_pedidos(text);

create or replace function public.hc_meus_pedidos()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'nome', p.nome,
        'especialidade', p.especialidade,
        'cidade', p.cidade,
        'bairro', p.bairro,
        'urgencia', p.urgencia,
        'observacoes', p.observacoes,
        'status', p.status,
        'criado_em', p.criado_em,
        'agendamento', (
          select jsonb_build_object(
            'id', a.id,
            'data', a.data,
            'horario', a.horario,
            'status', a.status,
            'fisio', jsonb_build_object(
              'id', f.id,
              'nome', f.nome,
              'whatsapp', f.whatsapp,
              'cidade', f.cidade,
              'especialidades', f.especialidades,
              'formacao', f.formacao,
              'distancia_km', round(
                hc_distancia_km(f.lat, f.lng, p.lat, p.lng)::numeric, 1
              )
            ),
            'mensagens', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'id', m.id,
                    'remetente', m.remetente,
                    'remetente_nome', m.remetente_nome,
                    'texto', m.texto,
                    'criado_em', m.criado_em
                  ) order by m.criado_em
                ),
                '[]'::jsonb
              )
              from mensagens m
              where m.agendamento_id = a.id
            )
          )
          from agendamentos a
          join fisios f on f.id = a.fisio_id
          where a.pedido_id = p.id
          order by a.criado_em desc
          limit 1
        )
      ) order by p.criado_em desc
    ),
    '[]'::jsonb
  )
  from pedidos p
  where p.user_id = auth.uid()
    and p.deletado_em is null;
$$;

revoke all on function public.hc_meus_pedidos() from public, anon;
grant execute on function public.hc_meus_pedidos() to authenticated;

-- ============================================================================
-- hc_enviar_mensagem — o lado fisio já usava auth.uid() (migration-fisio-
-- auth.sql). Agora o lado paciente também usa, e o p_whatsapp (que só servia
-- pra esse lado) sai da assinatura.
-- ============================================================================

drop function if exists public.hc_enviar_mensagem(uuid, text, text, text, text);

create or replace function public.hc_enviar_mensagem(
  p_agendamento_id uuid,
  p_remetente text,
  p_remetente_nome text,
  p_texto text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_ok boolean;
begin
  if length(coalesce(trim(p_texto), '')) = 0 then
    raise exception 'Mensagem vazia.';
  end if;

  if p_remetente not in ('paciente', 'fisio') then
    raise exception 'Remetente inválido.';
  end if;

  select exists (
    select 1
    from agendamentos a
    join pedidos p on p.id = a.pedido_id
    join fisios f on f.id = a.fisio_id
    where a.id = p_agendamento_id
      and (
        (p_remetente = 'paciente' and p.user_id = auth.uid())
        or (p_remetente = 'fisio' and f.user_id = auth.uid())
      )
  ) into v_ok;

  if not v_ok then
    raise exception 'Sem permissão para esta conversa.';
  end if;

  insert into mensagens (agendamento_id, remetente, remetente_nome, texto)
  values (p_agendamento_id, p_remetente, trim(p_remetente_nome), trim(p_texto))
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.hc_enviar_mensagem(uuid, text, text, text) from public, anon;
grant execute on function public.hc_enviar_mensagem(uuid, text, text, text) to authenticated;

-- ============================================================================
-- hc_avaliar — mesma ideia: sai o p_whatsapp, entra a checagem por
-- auth.uid() contra pedidos.user_id.
-- ============================================================================

drop function if exists public.hc_avaliar(uuid, integer, text, text);

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
begin
  if p_nota < 1 or p_nota > 5 then
    raise exception 'Nota inválida.';
  end if;

  if not exists (
    select 1
    from agendamentos a
    join pedidos p on p.id = a.pedido_id
    where a.fisio_id = p_fisio_id
      and p.user_id = auth.uid()
  ) then
    raise exception 'Você só pode avaliar um profissional que já te atendeu.';
  end if;

  insert into avaliacoes (fisio_id, nota, comentario)
  values (p_fisio_id, p_nota, nullif(trim(p_comentario), ''));
end $$;

revoke all on function public.hc_avaliar(uuid, integer, text) from public, anon;
grant execute on function public.hc_avaliar(uuid, integer, text) to authenticated;

-- ============================================================================
-- Correção de retrocompatibilidade: migrações anteriores (fisio-auth,
-- editar-cadastro-fisio, foto-fisio) recriaram hc_meu_painel_fisio() e
-- hc_atualizar_foto_fisio() do zero sem revogar o default privilege do
-- schema — mesmo problema descrito no topo deste arquivo. Fechando aqui
-- também, já que essa migração é o lugar natural pra isso.
-- ============================================================================

revoke all on function public.hc_meu_painel_fisio() from public, anon;
grant execute on function public.hc_meu_painel_fisio() to authenticated;

revoke all on function public.hc_atualizar_foto_fisio(text) from public, anon;
grant execute on function public.hc_atualizar_foto_fisio(text) to authenticated;

revoke all on function public.hc_marcar_status_agendamento(uuid, text) from public, anon;
grant execute on function public.hc_marcar_status_agendamento(uuid, text) to authenticated;

revoke all on function public.hc_cadastrar_fisio(
  text, text, text[], text, text, text[], text, text, numeric, text, text,
  double precision, double precision, integer, text, text
) from public, anon;
grant execute on function public.hc_cadastrar_fisio(
  text, text, text[], text, text, text[], text, text, numeric, text, text,
  double precision, double precision, integer, text, text
) to authenticated;
