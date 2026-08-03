-- ============================================================
-- CONTIGO SAÚDE — ANALYTICS DO MARKETPLACE
-- ============================================================

create table if not exists public.marketplace_eventos (
  id uuid primary key default gen_random_uuid(),

  -- O que aconteceu:
  -- busca
  -- resultado_exibido
  -- whatsapp_clique
  tipo text not null check (
    tipo in (
      'busca',
      'resultado_exibido',
      'whatsapp_clique'
    )
  ),

  -- Profissional relacionado ao evento, quando existir
  fisio_id uuid references public.fisios(id) on delete set null,

  -- Dados gerais da busca
  especialidade text,
  cidade text,
  uf text,

  -- Quantidade de resultados daquela busca
  quantidade_resultados integer,

  -- Identificador anônimo da sessão do navegador.
  -- NÃO é telefone, nome ou e-mail.
  sessao_id text,

  criado_em timestamptz not null default now()
);

-- ============================================================
-- ÍNDICES
-- ============================================================

create index if not exists marketplace_eventos_tipo_idx
  on public.marketplace_eventos (tipo, criado_em desc);

create index if not exists marketplace_eventos_fisio_idx
  on public.marketplace_eventos (fisio_id, criado_em desc);

create index if not exists marketplace_eventos_cidade_idx
  on public.marketplace_eventos (cidade, especialidade, criado_em desc);

create index if not exists marketplace_eventos_sessao_idx
  on public.marketplace_eventos (sessao_id, criado_em desc);

-- ============================================================
-- RLS
-- ============================================================

alter table public.marketplace_eventos enable row level security;

-- Ninguém lê diretamente essa tabela pelo navegador.
revoke all on public.marketplace_eventos from anon, authenticated;

-- ============================================================
-- FUNÇÃO PÚBLICA PARA REGISTRAR EVENTOS
-- ============================================================

create or replace function public.hc_registrar_evento_marketplace(
  p_tipo text,
  p_fisio_id uuid default null,
  p_especialidade text default null,
  p_cidade text default null,
  p_uf text default null,
  p_quantidade_resultados integer default null,
  p_sessao_id text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin

  if p_tipo not in (
    'busca',
    'resultado_exibido',
    'whatsapp_clique'
  ) then
    raise exception 'Tipo de evento inválido.';
  end if;

  -- Segurança básica:
  -- não permitir quantidade absurda de resultados.
  if p_quantidade_resultados is not null
     and (p_quantidade_resultados < 0 or p_quantidade_resultados > 10000) then
    raise exception 'Quantidade de resultados inválida.';
  end if;

  insert into public.marketplace_eventos (
    tipo,
    fisio_id,
    especialidade,
    cidade,
    uf,
    quantidade_resultados,
    sessao_id
  )
  values (
    p_tipo,
    p_fisio_id,
    nullif(trim(p_especialidade), ''),
    nullif(trim(p_cidade), ''),
    nullif(upper(trim(p_uf)), ''),
    p_quantidade_resultados,
    nullif(trim(p_sessao_id), '')
  );

end;
$$;

revoke all on function public.hc_registrar_evento_marketplace(
  text,
  uuid,
  text,
  text,
  text,
  integer,
  text
) from public;

grant execute on function public.hc_registrar_evento_marketplace(
  text,
  uuid,
  text,
  text,
  text,
  integer,
  text
) to anon, authenticated;
