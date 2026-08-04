-- ============================================================================
-- hc_meus_pedidos passa a informar se o agendamento já foi avaliado, pra tela
-- de "meus atendimentos" do paciente saber quando mostrar o convite pra
-- avaliar (só depois de concluído e só uma vez) sem precisar de outra RPC.
-- ============================================================================

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
