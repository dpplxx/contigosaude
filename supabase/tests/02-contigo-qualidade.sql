-- ============================================================================
-- Testes do Contigo Qualidade (hc_qualidade_fisio, hc_confirmar_atendimento),
-- contra um banco real. Roda depois de 01-rpc-confianca.sql, no mesmo banco
-- de teste (ver .github/workflows/test-db.yml) — reaproveita a extensão
-- pgcrypto e o stub de auth/storage já carregados, mas usa fisios/pacientes
-- com IDs próprios pra não interferir nas fixtures do arquivo anterior.
-- ============================================================================

\set ON_ERROR_STOP on

-- ----------------------------------------------------------------------------
-- Fixtures: 4 pacientes, 4 fisios (A sem avaliação, B com poucas, C com
-- volume suficiente pra nível 2, D só com avaliação manual do admin).
-- ----------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'paciente-a1@example.com'),
  ('a0000000-0000-0000-0000-000000000002', 'paciente-a2@example.com'),
  ('b0000000-0000-0000-0000-000000000001', 'fisio-a@example.com'),
  ('b0000000-0000-0000-0000-000000000002', 'fisio-b@example.com'),
  ('b0000000-0000-0000-0000-000000000003', 'fisio-c@example.com'),
  ('b0000000-0000-0000-0000-000000000004', 'fisio-d@example.com');

insert into fisios (id, nome, whatsapp, especialidades, cidade, bairros, user_id)
values
  ('c0000000-0000-0000-0000-00000000000a', 'Fisio A (sem avaliação)', '11900000001',
    array['Fisioterapia'], 'Vitória', '{}', 'b0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-00000000000b', 'Fisio B (poucas avaliações)', '11900000002',
    array['Fisioterapia'], 'Vitória', '{}', 'b0000000-0000-0000-0000-000000000002'),
  ('c0000000-0000-0000-0000-00000000000c', 'Fisio C (volume suficiente)', '11900000003',
    array['Fisioterapia'], 'Vitória', '{}', 'b0000000-0000-0000-0000-000000000003'),
  ('c0000000-0000-0000-0000-00000000000d', 'Fisio D (só avaliação manual)', '11900000004',
    array['Fisioterapia'], 'Vitória', '{}', 'b0000000-0000-0000-0000-000000000004');

-- ----------------------------------------------------------------------------
-- Caso 1: profissional sem nenhuma avaliação começa em nível 0 ("novo"),
-- não em nível "ruim".
-- ----------------------------------------------------------------------------

do $$
declare
  v jsonb;
begin
  v := hc_qualidade_fisio('c0000000-0000-0000-0000-00000000000a');
  if (v ->> 'nivel')::int is distinct from 0 then
    raise exception 'TESTE FALHOU: fisio sem avaliação deveria começar em nível 0, veio %', v;
  end if;
  if (v ->> 'total_verificadas')::int is distinct from 0 then
    raise exception 'TESTE FALHOU: fisio sem avaliação deveria ter 0 verificadas, veio %', v;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Caso 2: 1 avaliação de nota 5 não vale nível alto — só nível 1
-- (a distorção que a média bayesiana existe pra evitar).
-- ----------------------------------------------------------------------------

insert into pedidos (id, nome, whatsapp, especialidade, cidade, bairro, urgencia, user_id)
values (
  'd0000000-0000-0000-0000-00000000000b', 'Pedido pra fisio B', '11911111111',
  'Fisioterapia', 'Vitória', 'Centro', 'Normal', 'a0000000-0000-0000-0000-000000000001'
);

set request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000002';
do $$
begin
  perform hc_fechar_agendamento('d0000000-0000-0000-0000-00000000000b', current_date + 1, '09:00');
  perform hc_marcar_status_agendamento(
    (select id from agendamentos where pedido_id = 'd0000000-0000-0000-0000-00000000000b'),
    'concluido'
  );
end $$;

set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
do $$
begin
  perform hc_confirmar_atendimento(
    (select id from agendamentos where pedido_id = 'd0000000-0000-0000-0000-00000000000b')
  );
  perform hc_avaliar('c0000000-0000-0000-0000-00000000000b', 5, 'Perfeito!');
end $$;

do $$
declare
  v jsonb;
begin
  v := hc_qualidade_fisio('c0000000-0000-0000-0000-00000000000b');
  if (v ->> 'nivel')::int is distinct from 1 then
    raise exception 'TESTE FALHOU: 1 avaliação de nota 5 deveria dar nível 1, não mais que isso — veio %', v;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Caso 3: volume suficiente (10 avaliações, nota alta e consistente) chega
-- a nível 2. Insere direto na tabela (bypassando o fluxo de pedido/
-- agendamento/confirmação, já coberto nos casos acima e em
-- 01-rpc-confianca.sql) só pra ter volume rápido — cada linha ainda tem um
-- agendamento_id próprio, então continua contando como "verificada".
-- ----------------------------------------------------------------------------

do $$
declare
  i integer;
  v_pedido uuid;
  v_agendamento uuid;
begin
  for i in 1..10 loop
    v_pedido := gen_random_uuid();
    insert into pedidos (id, nome, whatsapp, especialidade, cidade, bairro, urgencia, user_id, status)
    values (v_pedido, 'Paciente ' || i, '119222220' || lpad(i::text, 2, '0'), 'Fisioterapia',
      'Vitória', 'Centro', 'Normal', 'a0000000-0000-0000-0000-000000000002', 'arquivado');

    v_agendamento := gen_random_uuid();
    insert into agendamentos (id, pedido_id, fisio_id, data, horario, status, confirmado_paciente, confirmado_em)
    values (v_agendamento, v_pedido, 'c0000000-0000-0000-0000-00000000000c',
      current_date - i, '09:00', 'concluido', true, now());

    insert into avaliacoes (fisio_id, nota, agendamento_id, status)
    values ('c0000000-0000-0000-0000-00000000000c', 5, v_agendamento, 'publicada');
  end loop;
end $$;

do $$
declare
  v jsonb;
begin
  v := hc_qualidade_fisio('c0000000-0000-0000-0000-00000000000c');
  if (v ->> 'total_verificadas')::int is distinct from 10 then
    raise exception 'TESTE FALHOU: fisio C deveria ter 10 avaliações verificadas, veio %', v;
  end if;
  if (v ->> 'nivel')::int < 2 then
    raise exception 'TESTE FALHOU: 10 avaliações nota 5 deveriam dar nível >= 2, veio %', v;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Caso 4: avaliação sem agendamento_id (o que hc_admin_avaliar grava, ao
-- lançar manualmente uma avaliação recebida por telefone) NÃO conta como
-- verificada — fisio D continua nível 0 mesmo com uma avaliação nota 5 no
-- banco. Insere direto (em vez de chamar hc_admin_avaliar) pra testar só a
-- regra de contagem do Contigo Qualidade, sem depender do fluxo de MFA do
-- admin (hc_e_admin), que é responsabilidade de outro teste.
-- ----------------------------------------------------------------------------

insert into avaliacoes (fisio_id, nota, comentario, nome_avaliador, status, agendamento_id)
values ('c0000000-0000-0000-0000-00000000000d', 5, 'Lançado por telefone', 'Fulano', 'publicada', null);

do $$
declare
  v jsonb;
begin
  v := hc_qualidade_fisio('c0000000-0000-0000-0000-00000000000d');
  if (v ->> 'nivel')::int is distinct from 0 then
    raise exception 'TESTE FALHOU: avaliação manual do admin (sem agendamento_id) não deveria contar pro nível — veio %', v;
  end if;
  if (v ->> 'total_verificadas')::int is distinct from 0 then
    raise exception 'TESTE FALHOU: avaliação manual do admin não deveria contar como verificada — veio %', v;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Caso 5: hc_qualidade_fisio não devolve nenhum dado do paciente — só
-- números agregados.
-- ----------------------------------------------------------------------------

do $$
declare
  v jsonb;
  chaves text[];
begin
  v := hc_qualidade_fisio('c0000000-0000-0000-0000-00000000000c');
  select array_agg(k) into chaves from jsonb_object_keys(v) k;
  if chaves <@ array['nivel', 'total_verificadas', 'nota_media', 'nota_ajustada'] is not true then
    raise exception 'TESTE FALHOU: hc_qualidade_fisio devolveu chave inesperada (risco de vazar dado de paciente): %', chaves;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Caso 6: hc_confirmar_atendimento só funciona pro paciente dono do pedido,
-- e só depois de "concluído".
-- ----------------------------------------------------------------------------

insert into pedidos (id, nome, whatsapp, especialidade, cidade, bairro, urgencia, user_id)
values (
  'd0000000-0000-0000-0000-00000000000e', 'Pedido ainda agendado', '11933333333',
  'Fisioterapia', 'Vitória', 'Centro', 'Normal', 'a0000000-0000-0000-0000-000000000001'
);

set request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';
do $$
begin
  perform hc_fechar_agendamento('d0000000-0000-0000-0000-00000000000e', current_date + 1, '09:00');
end $$;

-- Ainda 'agendado' (fisio não marcou concluído): confirmação deve falhar.
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
do $$
begin
  begin
    perform hc_confirmar_atendimento(
      (select id from agendamentos where pedido_id = 'd0000000-0000-0000-0000-00000000000e')
    );
    raise exception 'TESTE FALHOU: hc_confirmar_atendimento deveria recusar agendamento ainda não concluído';
  exception
    when others then
      if sqlerrm like 'TESTE FALHOU%' then raise; end if;
  end;
end $$;

-- Outro paciente (não dono do pedido) não pode confirmar, mesmo depois de concluído.
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';
do $$
begin
  perform hc_marcar_status_agendamento(
    (select id from agendamentos where pedido_id = 'd0000000-0000-0000-0000-00000000000e'),
    'concluido'
  );
end $$;

set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
do $$
begin
  begin
    perform hc_confirmar_atendimento(
      (select id from agendamentos where pedido_id = 'd0000000-0000-0000-0000-00000000000e')
    );
    raise exception 'TESTE FALHOU: hc_confirmar_atendimento deveria recusar quem não é dono do pedido';
  exception
    when others then
      if sqlerrm like 'TESTE FALHOU%' then raise; end if;
  end;
end $$;

\echo 'Todos os testes do Contigo Qualidade passaram.'
