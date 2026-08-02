-- ============================================================================
-- Migração: verificação manual de CREFITO pelo admin
--
-- A coluna fisios.crefito_status já existia (default 'pendente'), criada em
-- schema.sql pra uma criptografia que nunca foi usada — mas nenhum RPC nem
-- tela do app jamais leu ou escreveu nela. Hoje todo fisio mostra "CREFITO
-- informado" pra quem busca, sem diferenciar quem teve o registro conferido
-- de quem só digitou um número. Isso dá ao admin uma forma de marcar um
-- cadastro como verificado (ou rejeitado), e mostra essa diferença pro
-- paciente na busca e pro próprio fisio no painel dele.
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. hc_verificar_crefito — só admin pode chamar.
-- ----------------------------------------------------------------------------

create or replace function public.hc_verificar_crefito(
  p_fisio_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not hc_e_admin() then
    raise exception 'Sem permissão. Esta ação é restrita a administradores.';
  end if;

  if p_status not in ('pendente', 'verificado', 'rejeitado') then
    raise exception 'Status inválido.';
  end if;

  update fisios
  set
    crefito_status = p_status,
    crefito_verificado_em = case when p_status = 'verificado' then now() else null end
  where id = p_fisio_id;
end $$;

revoke all on function public.hc_verificar_crefito(uuid, text) from public, anon;
grant execute on function public.hc_verificar_crefito(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. hc_listar_fisios — mesma assinatura de hoje, só acrescenta
--    crefito_status pro badge na busca do paciente.
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
        'crefito_status', f.crefito_status,
        'nota_media', (
          select round(avg(a.nota)::numeric, 1) from avaliacoes a where a.fisio_id = f.id
        ),
        'total_avaliacoes', (
          select count(*) from avaliacoes a where a.fisio_id = f.id
        ),
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
          then hc_distancia_km(f.lat, f.lng, p_lat, p_lng)
          else 999
        end,
        f.nome
    ),
    '[]'::jsonb
  )
  from fisios f
  where hc_compativel(
    f.especialidades, f.cidade, f.bairros, f.lat, f.lng, f.raio_km,
    p_especialidade, p_cidade, p_bairro, p_lat, p_lng
  )
  and f.deletado_em is null;
$$;

revoke all on function public.hc_listar_fisios(
  text, text, text, double precision, double precision
) from public;
grant execute on function public.hc_listar_fisios(
  text, text, text, double precision, double precision
) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. hc_meu_painel_fisio — mesma assinatura de hoje, acrescenta
--    crefito_status pro próprio fisio ver o status no painel dele.
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
      'crefito_status', v_fisio.crefito_status,
      'foto_url', v_fisio.foto_url
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
