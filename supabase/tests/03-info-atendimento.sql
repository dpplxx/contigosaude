-- ============================================================================
-- Testes de "onde e como atende" (locais_atendimento, forma_pagamento,
-- convenios — migration-2026-08-11-info-atendimento.sql), contra um banco
-- real. Roda depois de 02-contigo-qualidade.sql, no mesmo banco de teste —
-- usa fisios/pacientes com IDs próprios pra não interferir nas fixtures
-- dos arquivos anteriores.
-- ============================================================================

\set ON_ERROR_STOP on

-- ----------------------------------------------------------------------------
-- Fixtures: 4 fisios pra testar o filtro rígido de local (com
-- retrocompatibilidade pra quem não preencheu) e 1 conta pra testar
-- validação do hc_cadastrar_fisio.
-- ----------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'fisio-nao-informou@example.com'),
  ('e1000000-0000-0000-0000-000000000002', 'fisio-so-clinica@example.com'),
  ('e1000000-0000-0000-0000-000000000003', 'fisio-convenio-unimed@example.com'),
  ('e1000000-0000-0000-0000-000000000004', 'fisio-sem-convenio@example.com'),
  ('e1000000-0000-0000-0000-000000000005', 'fisio-cadastro-validacao@example.com');

insert into fisios (id, nome, whatsapp, especialidades, cidade, bairros, user_id, locais_atendimento, forma_pagamento, convenios)
values
  ('e2000000-0000-0000-0000-00000000000a', 'Fisio Não Informou', '11900000011',
    array['Fisioterapia'], 'Vitória', '{}', 'e1000000-0000-0000-0000-000000000001',
    '{}', null, '{}'),
  ('e2000000-0000-0000-0000-00000000000b', 'Fisio Só Clínica', '11900000012',
    array['Fisioterapia'], 'Vitória', '{}', 'e1000000-0000-0000-0000-000000000002',
    array['clinica'], null, '{}');

-- Dois fisios na mesma banda de distância (mesmas coordenadas), só um
-- aceita Unimed — serve pra provar que convênio desempata, não exclui.
insert into fisios (id, nome, whatsapp, especialidades, cidade, bairros, lat, lng, raio_km, user_id, locais_atendimento, forma_pagamento, convenios)
values
  ('e2000000-0000-0000-0000-00000000000c', 'Fisio Aceita Unimed', '11900000013',
    array['Fisioterapia'], 'Vitória', '{}', -20.3155, -40.3128, 20, 'e1000000-0000-0000-0000-000000000003',
    array['domicilio'], 'convenio', array['Unimed']),
  ('e2000000-0000-0000-0000-00000000000d', 'Fisio Sem Convênio', '11900000014',
    array['Fisioterapia'], 'Vitória', '{}', -20.3155, -40.3128, 20, 'e1000000-0000-0000-0000-000000000004',
    array['domicilio'], 'particular', '{}');

-- ----------------------------------------------------------------------------
-- Caso 1: quem ainda não preencheu locais_atendimento (array vazio)
-- continua aparecendo numa busca por "domicílio" — retrocompatibilidade,
-- já que o produto inteiro sempre foi atendimento domiciliar.
-- ----------------------------------------------------------------------------

do $$
declare
  v jsonb;
begin
  v := hc_listar_fisios('Fisioterapia', 'Vitória', 'Centro', null, null, 'domicilio', null, null);
  if not exists (select 1 from jsonb_array_elements(v) e where e ->> 'id' = 'e2000000-0000-0000-0000-00000000000a') then
    raise exception 'TESTE FALHOU: fisio sem locais_atendimento preenchido deveria aparecer em busca por domicílio (retrocompat), veio %', v;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Caso 2: o mesmo fisio (sem preencher nada) NÃO aparece numa busca por
-- "clínica" — não assumimos nada além do que o produto já significava.
-- ----------------------------------------------------------------------------

do $$
declare
  v jsonb;
begin
  v := hc_listar_fisios('Fisioterapia', 'Vitória', 'Centro', null, null, 'clinica', null, null);
  if exists (select 1 from jsonb_array_elements(v) e where e ->> 'id' = 'e2000000-0000-0000-0000-00000000000a') then
    raise exception 'TESTE FALHOU: fisio sem locais_atendimento preenchido não deveria aparecer em busca por clínica, veio %', v;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Caso 3: fisio que só marcou "clínica" é EXCLUÍDO de uma busca por
-- "domicílio" — o filtro de local é rígido de verdade, não só prioridade.
-- ----------------------------------------------------------------------------

do $$
declare
  v jsonb;
begin
  v := hc_listar_fisios('Fisioterapia', 'Vitória', 'Centro', null, null, 'domicilio', null, null);
  if exists (select 1 from jsonb_array_elements(v) e where e ->> 'id' = 'e2000000-0000-0000-0000-00000000000b') then
    raise exception 'TESTE FALHOU: fisio que só atende em clínica não deveria aparecer em busca por domicílio, veio %', v;
  end if;

  v := hc_listar_fisios('Fisioterapia', 'Vitória', 'Centro', null, null, 'clinica', null, null);
  if not exists (select 1 from jsonb_array_elements(v) e where e ->> 'id' = 'e2000000-0000-0000-0000-00000000000b') then
    raise exception 'TESTE FALHOU: fisio que atende em clínica deveria aparecer em busca por clínica, veio %', v;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Caso 4: convênio e forma de pagamento só desempatam a ordem — nunca
-- excluem ninguém. Os dois fisios da mesma banda de distância aparecem
-- os dois, mas quem aceita Unimed vem primeiro quando filtrado por Unimed.
-- ----------------------------------------------------------------------------

do $$
declare
  v jsonb;
  posicoes jsonb;
begin
  v := hc_listar_fisios(
    'Fisioterapia', 'Vitória', 'Centro', -20.3155, -40.3128, null, null, 'Unimed'
  );

  if not exists (select 1 from jsonb_array_elements(v) e where e ->> 'id' = 'e2000000-0000-0000-0000-00000000000c') then
    raise exception 'TESTE FALHOU: fisio que aceita Unimed deveria aparecer, veio %', v;
  end if;
  if not exists (select 1 from jsonb_array_elements(v) e where e ->> 'id' = 'e2000000-0000-0000-0000-00000000000d') then
    raise exception 'TESTE FALHOU: convênio não deveria excluir quem não aceita, mas o fisio sumiu — veio %', v;
  end if;

  select jsonb_agg(e ->> 'id' order by ord) into posicoes
  from jsonb_array_elements(v) with ordinality as t(e, ord)
  where e ->> 'id' in ('e2000000-0000-0000-0000-00000000000c', 'e2000000-0000-0000-0000-00000000000d');

  if posicoes ->> 0 <> 'e2000000-0000-0000-0000-00000000000c' then
    raise exception 'TESTE FALHOU: filtrando por Unimed, quem aceita deveria vir antes de quem não aceita — ordem veio %', posicoes;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Caso 5: hc_cadastrar_fisio valida locais_atendimento e forma_pagamento.
-- ----------------------------------------------------------------------------

set request.jwt.claim.sub = 'e1000000-0000-0000-0000-000000000005';

do $$
begin
  begin
    perform hc_cadastrar_fisio(
      'Fisio Teste Validação', '11988889999', array['Fisioterapia'], 'Vitória', 'USP 2020',
      p_locais_atendimento => array['spa']
    );
    raise exception 'TESTE FALHOU: hc_cadastrar_fisio deveria recusar local de atendimento inválido';
  exception
    when others then
      if sqlerrm like 'TESTE FALHOU%' then raise; end if;
  end;
end $$;

do $$
begin
  begin
    perform hc_cadastrar_fisio(
      'Fisio Teste Validação', '11988889999', array['Fisioterapia'], 'Vitória', 'USP 2020',
      p_forma_pagamento => 'plano_qualquer'
    );
    raise exception 'TESTE FALHOU: hc_cadastrar_fisio deveria recusar forma de pagamento inválida';
  exception
    when others then
      if sqlerrm like 'TESTE FALHOU%' then raise; end if;
  end;
end $$;

-- Cadastro válido persiste os 3 campos, e convênios em branco são
-- descartados (trim + filtro de string vazia).
do $$
declare
  v_id uuid;
  v_convenios text[];
  v_locais text[];
  v_forma text;
begin
  v_id := hc_cadastrar_fisio(
    'Fisio Teste Validação', '11988889999', array['Fisioterapia'], 'Vitória', 'USP 2020',
    p_locais_atendimento => array['domicilio', 'clinica'],
    p_forma_pagamento => 'particular_e_convenio',
    p_convenios => array['Unimed', '  ', 'Bradesco Saúde', '']
  );

  select locais_atendimento, forma_pagamento, convenios
  into v_locais, v_forma, v_convenios
  from fisios where id = v_id;

  if v_locais <> array['domicilio', 'clinica'] then
    raise exception 'TESTE FALHOU: locais_atendimento não persistiu como esperado, veio %', v_locais;
  end if;
  if v_forma <> 'particular_e_convenio' then
    raise exception 'TESTE FALHOU: forma_pagamento não persistiu como esperado, veio %', v_forma;
  end if;
  if v_convenios <> array['Unimed', 'Bradesco Saúde'] then
    raise exception 'TESTE FALHOU: convenios deveria descartar entradas em branco, veio %', v_convenios;
  end if;
end $$;

\echo 'Todos os testes de informações de atendimento passaram.'
