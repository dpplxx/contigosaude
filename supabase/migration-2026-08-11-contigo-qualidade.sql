-- ============================================================================
-- CONTIGO QUALIDADE — reputação e níveis de qualidade dos fisioterapeutas
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
--
-- O QUE ESTA MIGRATION FAZ:
--   1. Adiciona uma etapa de confirmação do paciente antes de poder avaliar
--      (hoje só o fisio marca "concluído"; agora o paciente confirma que
--      aconteceu de verdade, e só depois disso a avaliação é aceita).
--   2. Calcula um nível de qualidade (0 a 4) por fisio, baseado só em
--      avaliações verificadas (ligadas a um atendimento real confirmado).
--   3. Expõe esse nível na busca, no perfil público e no painel do fisio, e
--      usa o nível como critério de desempate na busca — nunca como
--      critério principal, distância continua mandando.
--
-- O QUE ISTO NÃO FAZ (de propósito):
--   Não mexe em agenda, pagamento, chat ou no fluxo de WhatsApp/cadastro.
--   Não conta avaliação lançada manualmente pelo admin (hc_admin_avaliar,
--   migration-2026-08-02-avaliacoes-moderacao.sql) como "verificada" — ela
--   continua aparecendo na nota pública, só não conta pro selo.
--   Nenhuma tabela de plano/assinatura é referenciada aqui — o nível não
--   pode ser comprado nem hoje nem se um plano pago for criado no futuro,
--   porque o cálculo não olha pra nada além de avaliações reais e perfil.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Confirmação do paciente
--
-- Hoje o fisio marca o agendamento como "concluído" (hc_marcar_status_
-- agendamento) e o paciente já pode avaliar depois disso. Isto adiciona um
-- passo intermediário: o paciente precisa confirmar que o atendimento
-- aconteceu antes de poder avaliar — assim a "avaliação verificada" fica
-- mais forte (dois lados confirmaram, não só um).
-- ----------------------------------------------------------------------------

alter table public.agendamentos
  add column if not exists confirmado_paciente boolean not null default false,
  add column if not exists confirmado_em timestamptz;

-- Só o paciente dono do pedido confirma, e só depois que o fisio marcou
-- como concluído — não faz sentido confirmar um atendimento agendado ou
-- cancelado.
create or replace function public.hc_confirmar_atendimento(p_agendamento_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update agendamentos a
  set confirmado_paciente = true, confirmado_em = now()
  from pedidos p
  where a.id = p_agendamento_id
    and p.id = a.pedido_id
    and p.user_id = auth.uid()
    and a.status = 'concluido';

  if not found then
    raise exception 'Não foi possível confirmar este atendimento.';
  end if;
end $$;

revoke all on function public.hc_confirmar_atendimento(uuid) from public, anon;
grant execute on function public.hc_confirmar_atendimento(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. hc_qualidade_fisio — o cálculo do nível
--
-- "Verificada" = avaliação com status='publicada' (não removida por
-- moderação) E agendamento_id preenchido (veio de hc_avaliar, então já
-- passou pela confirmação do paciente acima — nunca de hc_admin_avaliar,
-- que grava sem agendamento_id).
--
-- Pra evitar que 1 avaliação de 5,0 valha o mesmo que 100 avaliações de
-- 4,9 (o problema que a Karla pediu pra evitar), a nota usada nos níveis 2+
-- não é a média crua: é uma média bayesiana simples, que puxa a nota pra
-- uma média neutra da plataforma enquanto o fisio tem poucas avaliações e
-- só passa a confiar na nota real dele conforme acumula mais. Com poucas
-- avaliações o efeito é forte; com muitas, o efeito quase some.
--
-- Os números abaixo (mínimo de avaliações e nota de corte por nível) são
-- um ponto de partida, não uma verdade absoluta — dá pra ajustar rodando
-- esta função de novo com valores diferentes, sem mexer em mais nada.
-- ----------------------------------------------------------------------------

create or replace function public.hc_qualidade_fisio(p_fisio_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_total integer;
  v_media numeric;
  v_global numeric;
  v_ajustada numeric;
  v_nivel integer;
  v_perfil_completo boolean;
  v_crefito_verificado boolean;
  v_tem_removida boolean;
  -- "Peso" da média global no cálculo bayesiano — quanto maior, mais
  -- avaliações um fisio precisa ter antes da nota dele pesar mais que a
  -- média da plataforma.
  m constant numeric := 5;
  -- Nota neutra usada quando a plataforma inteira ainda não tem avaliação
  -- verificada nenhuma (fase inicial, evita divisão por média nula).
  c_padrao constant numeric := 4.5;
begin
  select count(*), avg(nota)
  into v_total, v_media
  from avaliacoes
  where fisio_id = p_fisio_id and status = 'publicada' and agendamento_id is not null;

  if v_total is null or v_total = 0 then
    return jsonb_build_object(
      'nivel', 0,
      'total_verificadas', 0,
      'nota_media', null,
      'nota_ajustada', null
    );
  end if;

  select avg(nota) into v_global
  from avaliacoes
  where status = 'publicada' and agendamento_id is not null;

  v_ajustada := (v_total::numeric / (v_total + m)) * v_media
              + (m / (v_total + m)) * coalesce(v_global, c_padrao);

  select
    (
      foto_url is not null
      and resumo is not null and trim(resumo) <> ''
      and disponibilidade is not null and trim(disponibilidade) <> ''
    ),
    (crefito_status = 'verificado')
  into v_perfil_completo, v_crefito_verificado
  from fisios
  where id = p_fisio_id;

  select exists(
    select 1 from avaliacoes where fisio_id = p_fisio_id and status = 'removida'
  ) into v_tem_removida;

  -- Nível 1 já vale com qualquer avaliação verificada — é literalmente
  -- "possui avaliações verificadas". Os níveis de cima é que exigem volume
  -- mínimo + nota ajustada, pra não dar nível alto por sorte de 1 nota boa.
  v_nivel := 1;
  if v_total >= 8 and v_ajustada >= 4.5 then
    v_nivel := 2;
  end if;
  if v_total >= 15 and v_ajustada >= 4.7 then
    v_nivel := 3;
  end if;
  if v_total >= 30 and v_ajustada >= 4.8
     and v_perfil_completo and v_crefito_verificado and not v_tem_removida then
    v_nivel := 4;
  end if;

  return jsonb_build_object(
    'nivel', v_nivel,
    'total_verificadas', v_total,
    'nota_media', round(v_media::numeric, 1),
    'nota_ajustada', round(v_ajustada::numeric, 2)
  );
end $$;

grant execute on function public.hc_qualidade_fisio(uuid) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. hc_avaliar — agora só aceita avaliação de atendimento confirmado
--
-- ÚLTIMA FONTE anterior: migration-2026-08-02-avaliacoes-moderacao.sql.
-- Única mudança real: a busca do agendamento agora exige
-- status='concluido' and confirmado_paciente=true, em vez de aceitar
-- qualquer agendamento existente entre paciente e fisio. O resto (bloqueio
-- de autoavaliação, trava de duplicata, filtro de link/telefone no
-- comentário) continua igual.
-- ----------------------------------------------------------------------------

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
  v_nome_paciente text;
  v_comentario text;
begin
  if p_nota < 1 or p_nota > 5 then
    raise exception 'Nota inválida.';
  end if;

  if exists (select 1 from fisios where id = p_fisio_id and user_id = auth.uid()) then
    raise exception 'Você não pode avaliar seu próprio cadastro.';
  end if;

  select a.id, p.nome into v_agendamento_id, v_nome_paciente
  from agendamentos a
  join pedidos p on p.id = a.pedido_id
  where a.fisio_id = p_fisio_id
    and p.user_id = auth.uid()
    and a.status = 'concluido'
    and a.confirmado_paciente = true
  order by a.criado_em desc
  limit 1;

  if v_agendamento_id is null then
    raise exception 'Confirme que o atendimento aconteceu antes de avaliar.';
  end if;

  if exists (select 1 from avaliacoes where agendamento_id = v_agendamento_id) then
    raise exception 'Você já avaliou este atendimento.';
  end if;

  v_comentario := nullif(trim(p_comentario), '');

  if v_comentario is not null and (
    v_comentario ~* 'https?://|www\.|\.com\b'
    or regexp_replace(v_comentario, '[^0-9]', '', 'g') ~ '[0-9]{8,}'
  ) then
    raise exception 'O comentário não pode conter links ou telefones. Fale só sobre o atendimento.';
  end if;

  insert into avaliacoes (fisio_id, nota, comentario, agendamento_id, nome_avaliador, status)
  values (p_fisio_id, p_nota, v_comentario, v_agendamento_id, hc_nome_curto(v_nome_paciente), 'publicada');
end $$;

revoke all on function public.hc_avaliar(uuid, integer, text) from public, anon;
grant execute on function public.hc_avaliar(uuid, integer, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. hc_meus_pedidos — agora informa confirmado_paciente
--
-- ÚLTIMA FONTE anterior: migration-2026-08-04-avaliado-flag.sql. Única
-- mudança: mais um campo booleano no objeto do agendamento, pra tela de
-- "meus atendimentos" saber quando mostrar "confirmar" antes de "avaliar".
-- ----------------------------------------------------------------------------

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
            'confirmado_paciente', a.confirmado_paciente,
            'avaliado', exists(select 1 from avaliacoes av where av.agendamento_id = a.id),
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

-- ----------------------------------------------------------------------------
-- 5. hc_listar_fisios — nível de qualidade no retorno + desempate na busca
--
-- ÚLTIMA FONTE anterior: migration-2026-08-02-avaliacoes-moderacao.sql.
-- A ordem continua sendo por distância primeiro — só que agora em faixas de
-- 2km, não por valor exato. Dentro da mesma faixa (dois fisios a uma
-- distância parecida), quem tem nível de qualidade maior aparece primeiro.
-- Um fisio novo, sem nenhuma avaliação ainda, nunca perde posição por causa
-- disso pra alguém mais longe — só desempata entre gente igualmente perto.
-- ----------------------------------------------------------------------------

create or replace function public.hc_listar_fisios(
  p_especialidade text,
  p_cidade text,
  p_bairro text,
  p_lat double precision default null,
  p_lng double precision default null
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', f.id,
        'nome', f.nome,
        'foto_url', f.foto_url,
        'especialidades', f.especialidades,
        'formacao', f.formacao,
        'bairro', (f.bairros[1]),
        'whatsapp', f.whatsapp,
        'crefito', f.crefito,
        'crefito_uf', f.crefito_uf,
        'nota_media', (
          select round(avg(a.nota)::numeric, 1) from avaliacoes a
          where a.fisio_id = f.id and a.status = 'publicada'
        ),
        'total_avaliacoes', (
          select count(*) from avaliacoes a
          where a.fisio_id = f.id and a.status = 'publicada'
        ),
        'qualidade', q.dados,
        'distancia_km',
          case
            when p_lat is not null and f.lat is not null
            then hc_distancia_km(f.lat, f.lng, p_lat, p_lng)
            else null
          end
      )
      order by
        case
          when p_lat is not null and f.lat is not null
          then floor(hc_distancia_km(f.lat, f.lng, p_lat, p_lng) / 2)
          else 999
        end,
        coalesce((q.dados ->> 'nivel')::int, 0) desc,
        case
          when p_lat is not null and f.lat is not null
          then hc_distancia_km(f.lat, f.lng, p_lat, p_lng)
          else 999
        end,
        f.nome
    ),
    '[]'::jsonb
  )
  from fisios f
  cross join lateral (select public.hc_qualidade_fisio(f.id) as dados) q
  where hc_compativel(
    f.especialidades, f.cidade, f.bairros, f.lat, f.lng, f.raio_km,
    p_especialidade, p_cidade, p_bairro, p_lat, p_lng
  )
  and f.deletado_em is null;
$$;

grant execute on function public.hc_listar_fisios(
  text, text, text, double precision, double precision
) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. hc_obter_fisio_publico — nível de qualidade no perfil individual
--
-- ÚLTIMA FONTE anterior: migration-perfil-publico.sql. Única mudança: mais
-- um campo no jsonb.
-- ----------------------------------------------------------------------------

create or replace function public.hc_obter_fisio_publico(
  p_fisio_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', f.id,
    'nome', f.nome,
    'formacao', f.formacao,
    'foto_url', f.foto_url,
    'whatsapp', f.whatsapp,
    'bairros', f.bairros,
    'cidade', f.cidade,
    'uf', f.uf,
    'crefito', f.crefito,
    'crefito_uf', f.crefito_uf,
    'crefito_status', f.crefito_status,
    'especialidades', f.especialidades,
    'resumo', f.resumo,
    'disponibilidade', f.disponibilidade,
    'nota_media', (
      select round(avg(a.nota)::numeric, 1) from avaliacoes a
      where a.fisio_id = f.id and a.status = 'publicada'
    ),
    'total_avaliacoes', (
      select count(*) from avaliacoes a
      where a.fisio_id = f.id and a.status = 'publicada'
    ),
    'qualidade', public.hc_qualidade_fisio(f.id),
    'raio_km', f.raio_km
  )
  from public.fisios f
  where f.id = p_fisio_id
    and f.deletado_em is null;
$$;

revoke all on function public.hc_obter_fisio_publico(uuid) from public;
grant execute on function public.hc_obter_fisio_publico(uuid) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. hc_meu_painel_fisio — o fisio vê o próprio nível de qualidade
--
-- ÚLTIMA FONTE anterior: schema-atual.sql (linha ~1124, já com a checagem
-- de aal2 do MFA). Única mudança: mais um campo no objeto "fisio".
-- ----------------------------------------------------------------------------

create or replace function public.hc_meu_painel_fisio()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fisio fisios%rowtype;
begin
  if not public.hc_aal_suficiente() then
    raise exception 'Complete a verificação em duas etapas para continuar.';
  end if;

  select * into v_fisio from fisios where user_id = auth.uid() limit 1;

  if v_fisio.id is null then
    return jsonb_build_object('fisio', null);
  end if;

  return jsonb_build_object(
    'fisio', jsonb_build_object(
      'id', v_fisio.id,
      'nome', v_fisio.nome,
      'whatsapp', v_fisio.whatsapp,
      'cidade', v_fisio.cidade,
      'bairros', v_fisio.bairros,
      'especialidades', v_fisio.especialidades,
      'valor_sessao', v_fisio.valor_sessao,
      'contador_cliques', v_fisio.contador_cliques,
      'raio_km', v_fisio.raio_km,
      'tem_coordenadas', v_fisio.lat is not null,
      'formacao', v_fisio.formacao,
      'resumo', v_fisio.resumo,
      'disponibilidade', v_fisio.disponibilidade,
      'cep', v_fisio.cep,
      'uf', v_fisio.uf,
      'lat', v_fisio.lat,
      'lng', v_fisio.lng,
      'crefito', v_fisio.crefito,
      'crefito_uf', v_fisio.crefito_uf,
      'foto_url', v_fisio.foto_url,
      'qualidade', public.hc_qualidade_fisio(v_fisio.id)
    ),
    'agendamentos', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', a.id,
            'data', a.data,
            'horario', a.horario,
            'status', a.status,
            'pedido', jsonb_build_object(
              'id', p.id,
              'nome', p.nome,
              'whatsapp', p.whatsapp,
              'cidade', p.cidade,
              'bairro', p.bairro,
              'especialidade', p.especialidade,
              'observacoes', p.observacoes,
              'distancia_km', round(
                hc_distancia_km(v_fisio.lat, v_fisio.lng, p.lat, p.lng)::numeric, 1
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
          ) order by a.data desc, a.horario desc
        ),
        '[]'::jsonb
      )
      from agendamentos a
      join pedidos p on p.id = a.pedido_id
      where a.fisio_id = v_fisio.id
    ),
    'pedidos_compativeis', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'especialidade', p.especialidade,
            'cidade', p.cidade,
            'bairro', p.bairro,
            'urgencia', p.urgencia,
            'criado_em', p.criado_em,
            'distancia_km', round(
              hc_distancia_km(v_fisio.lat, v_fisio.lng, p.lat, p.lng)::numeric, 1
            )
          ) order by
            hc_distancia_km(v_fisio.lat, v_fisio.lng, p.lat, p.lng) nulls last,
            p.criado_em desc
        ),
        '[]'::jsonb
      )
      from pedidos p
      where p.status = 'ativo'
        and not exists (select 1 from agendamentos a where a.pedido_id = p.id)
        and hc_compativel(
          v_fisio.especialidades, v_fisio.cidade, v_fisio.bairros,
          v_fisio.lat, v_fisio.lng, v_fisio.raio_km,
          p.especialidade, p.cidade, p.bairro, p.lat, p.lng
        )
    ),
    'avaliacoes', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', av.id,
            'nota', av.nota,
            'comentario', av.comentario,
            'criado_em', av.criado_em
          ) order by av.criado_em desc
        ),
        '[]'::jsonb
      )
      from avaliacoes av
      where av.fisio_id = v_fisio.id
    )
  );
end $$;

revoke all on function public.hc_meu_painel_fisio() from public, anon;
grant execute on function public.hc_meu_painel_fisio() to authenticated;
