-- ============================================================================
-- Testes das RPCs de confiança/antifraude, contra um banco real (não mock).
--
-- Cobre exatamente as regras endurecidas nesta sessão: hc_sou_fisio detecta
-- conta de fisio, hc_criar_pedido recusa conta de fisio criando pedido,
-- hc_fechar_agendamento recusa fechar pedido da própria conta, hc_avaliar
-- recusa autoavaliação e avaliação duplicada do mesmo atendimento.
--
-- Roda só em CI, contra o container de teste (ver 00-stub-supabase.sql) —
-- nunca aponte isto pro projeto Supabase de produção.
-- ============================================================================

\set ON_ERROR_STOP on

-- ----------------------------------------------------------------------------
-- Fixtures
-- ----------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'paciente-teste@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'fisio-teste@example.com');

insert into fisios (id, nome, whatsapp, especialidades, cidade, bairros, user_id)
values (
  '33333333-3333-3333-3333-333333333333',
  'Fisio Teste',
  '11988887777',
  array['Fisioterapia'],
  'Vitória',
  '{}',
  '22222222-2222-2222-2222-222222222222'
);

-- ----------------------------------------------------------------------------
-- hc_sou_fisio: identifica corretamente cada conta
-- ----------------------------------------------------------------------------

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$
begin
  if hc_sou_fisio() is not true then
    raise exception 'TESTE FALHOU: hc_sou_fisio() deveria ser true pra conta com cadastro de fisio';
  end if;
end $$;

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
begin
  if hc_sou_fisio() is not false then
    raise exception 'TESTE FALHOU: hc_sou_fisio() deveria ser false pra conta sem cadastro de fisio';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- hc_criar_pedido: conta de fisio não pode criar pedido como paciente
-- ----------------------------------------------------------------------------

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$
begin
  begin
    perform hc_criar_pedido(
      'Nome Válido', '11999999999', 'Fisioterapia', 'Vitória', 'Centro', 'Normal'
    );
    raise exception 'TESTE FALHOU: hc_criar_pedido deveria recusar conta que já é fisio';
  exception
    when others then
      if sqlerrm like 'TESTE FALHOU%' then raise; end if;
      -- exceção esperada (conta já é fisio) — ok
  end;
end $$;

-- ----------------------------------------------------------------------------
-- hc_fechar_agendamento: não fecha pedido criado pela própria conta
-- ----------------------------------------------------------------------------

insert into pedidos (id, nome, whatsapp, especialidade, cidade, bairro, urgencia, user_id)
values (
  '44444444-4444-4444-4444-444444444444',
  'Pedido do próprio fisio', '11977776666', 'Fisioterapia', 'Vitória', 'Centro', 'Normal',
  '22222222-2222-2222-2222-222222222222'
);

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$
begin
  begin
    perform hc_fechar_agendamento(
      '44444444-4444-4444-4444-444444444444', current_date + 1, '10:00'
    );
    raise exception 'TESTE FALHOU: hc_fechar_agendamento deveria recusar pedido da própria conta';
  exception
    when others then
      if sqlerrm like 'TESTE FALHOU%' then raise; end if;
      -- exceção esperada (pedido é da própria conta) — ok
  end;
end $$;

-- ----------------------------------------------------------------------------
-- hc_fechar_agendamento: caso normal funciona, e libera pra hc_avaliar
-- ----------------------------------------------------------------------------

insert into pedidos (id, nome, whatsapp, especialidade, cidade, bairro, urgencia, user_id)
values (
  '55555555-5555-5555-5555-555555555555',
  'Pedido do paciente', '11966665555', 'Fisioterapia', 'Vitória', 'Centro', 'Normal',
  '11111111-1111-1111-1111-111111111111'
);

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$
begin
  perform hc_fechar_agendamento(
    '55555555-5555-5555-5555-555555555555', current_date + 1, '10:00'
  );
end $$;

do $$
begin
  if not exists (
    select 1 from agendamentos
    where pedido_id = '55555555-5555-5555-5555-555555555555'
      and fisio_id = '33333333-3333-3333-3333-333333333333'
  ) then
    raise exception 'TESTE FALHOU: hc_fechar_agendamento deveria ter criado o agendamento';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- hc_meus_pedidos: agendamento.avaliado começa false, antes de qualquer
-- avaliação
-- ----------------------------------------------------------------------------

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
declare
  v_avaliado boolean;
begin
  select (p.value -> 'agendamento' ->> 'avaliado')::boolean
  into v_avaliado
  from jsonb_array_elements(hc_meus_pedidos()) p
  where p.value ->> 'id' = '55555555-5555-5555-5555-555555555555';

  if v_avaliado is distinct from false then
    raise exception 'TESTE FALHOU: hc_meus_pedidos deveria marcar avaliado=false antes da avaliação';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- hc_avaliar: paciente avalia normalmente
-- ----------------------------------------------------------------------------

do $$
begin
  perform hc_avaliar('33333333-3333-3333-3333-333333333333', 5, 'Ótimo atendimento');
end $$;

-- ----------------------------------------------------------------------------
-- hc_meus_pedidos: agendamento.avaliado vira true depois de hc_avaliar
-- ----------------------------------------------------------------------------

do $$
declare
  v_avaliado boolean;
begin
  select (p.value -> 'agendamento' ->> 'avaliado')::boolean
  into v_avaliado
  from jsonb_array_elements(hc_meus_pedidos()) p
  where p.value ->> 'id' = '55555555-5555-5555-5555-555555555555';

  if v_avaliado is distinct from true then
    raise exception 'TESTE FALHOU: hc_meus_pedidos deveria marcar avaliado=true depois da avaliação';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- hc_avaliar: não deixa avaliar o mesmo atendimento duas vezes
-- ----------------------------------------------------------------------------

do $$
begin
  begin
    perform hc_avaliar('33333333-3333-3333-3333-333333333333', 1, 'De novo');
    raise exception 'TESTE FALHOU: hc_avaliar deveria recusar avaliação duplicada do mesmo atendimento';
  exception
    when others then
      if sqlerrm like 'TESTE FALHOU%' then raise; end if;
      -- exceção esperada (já avaliou este atendimento) — ok
  end;
end $$;

-- ----------------------------------------------------------------------------
-- hc_avaliar: fisio não pode avaliar o próprio cadastro
-- ----------------------------------------------------------------------------

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$
begin
  begin
    perform hc_avaliar('33333333-3333-3333-3333-333333333333', 5, 'Eu mesmo, 5 estrelas');
    raise exception 'TESTE FALHOU: hc_avaliar deveria recusar fisio avaliando o próprio cadastro';
  exception
    when others then
      if sqlerrm like 'TESTE FALHOU%' then raise; end if;
      -- exceção esperada (autoavaliação) — ok
  end;
end $$;

\echo 'Todos os testes de RPC de confiança passaram.'
