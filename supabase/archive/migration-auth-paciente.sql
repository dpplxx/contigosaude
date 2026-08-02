-- ============================================================================
-- Extensão de Auth de Pacientes
--
-- Esta migração adiciona suporte a autenticação real de pacientes com email.
-- Corre no SQL Editor do Supabase: Settings → SQL Editor → "New Query"
--
-- ATUALIZAÇÃO (auditoria de segurança, 2026-08-01): a função
-- hc_meus_pedidos_auth() criada aqui embaixo tinha um problema sério —
-- identificava o paciente lendo auth.users.raw_user_meta_data->>'whatsapp',
-- um campo que qualquer usuário autenticado pode escrever em si mesmo.
-- Bastava definir esse metadado como o WhatsApp de outra pessoa pra ler os
-- pedidos dela, e a função nem exigia login (estava liberada pra "anon").
-- Nunca foi usada pelo frontend. Foi apagada em
-- migration-auditoria-seguranca.sql — mantém-se a definição aqui só como
-- registro histórico do que rodou em produção antes da correção.
--
-- A tabela "pacientes" e o trigger handle_new_auth_user abaixo continuam
-- existindo (RLS está correto), mas não são usados por nenhuma tela hoje —
-- veja a nota em migration-auditoria-seguranca.sql.
-- ============================================================================

-- Tabela para correlacionar usuários Supabase Auth com pedidos de pacientes
create table if not exists public.pacientes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nome text not null,
  email text not null,
  whatsapp text,
  criado_em timestamptz not null default now()
);

alter table public.pacientes enable row level security;

-- Política: cada paciente só vê seus próprios dados
create policy pacientes_self on public.pacientes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Atualizar status dos agendamentos para incluir novos estados
alter table public.agendamentos
  drop constraint if exists agendamentos_status_check,
  add constraint agendamentos_status_check
    check (status in ('pendente', 'agendado', 'recusado', 'concluido', 'cancelado'));

-- Adicionar status padrão como 'pendente'
alter table public.agendamentos
  alter column status set default 'pendente';

-- Função para criar um paciente autenticado ao registrar
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.pacientes (user_id, nome, email)
  values (new.id, new.email, new.email)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Trigger para executar quando um novo usuário é criado
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Função para listar meus pedidos autenticado por email
create or replace function public.hc_meus_pedidos_auth()
returns table (
  id uuid,
  nome text,
  especialidade text,
  cidade text,
  bairro text,
  urgencia text,
  status text,
  agendamento jsonb,
  criado_em timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.nome,
    p.especialidade,
    p.cidade,
    p.bairro,
    p.urgencia,
    p.status,
    jsonb_build_object(
      'id', a.id,
      'data', a.data,
      'horario', a.horario,
      'status', a.status,
      'fisio', jsonb_build_object(
        'id', f.id,
        'nome', f.nome,
        'formacao', f.formacao,
        'distancia_km', hc_distancia_km(p.lat, p.lng, f.lat, f.lng),
        'whatsapp', f.whatsapp
      )
    ) as agendamento,
    p.criado_em
  from pedidos p
  left join agendamentos a on a.pedido_id = p.id
  left join fisios f on f.id = a.fisio_id
  where p.whatsapp_chave = (
    select right(regexp_replace(
      coalesce((select raw_user_meta_data->>'whatsapp' from auth.users where id = auth.uid()), ''),
      '[^0-9]', '', 'g'
    ), 8)
  )
  order by p.criado_em desc;
$$;

grant execute on function public.hc_meus_pedidos_auth() to authenticated;
