-- ============================================================
-- CONTIGO SAÚDE
-- Perfil público individual do profissional
--
-- Ajustado contra o schema real de public.fisios (conferido via psql
-- antes de rodar): a tabela não tem "ativo" (tem deletado_em), não tem
-- "bairro" singular (tem bairros[], um array), e não tem nota_media
-- nem total_avaliacoes como coluna — são calculadas a partir de
-- avaliacoes, do mesmo jeito que hc_listar_fisios já faz. Mesmo
-- filtro de status = 'publicada' usado lá, pra não contar avaliação
-- removida por moderação.
-- ============================================================

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
    'bairro', (f.bairros[1]),
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
    'raio_km', f.raio_km
  )
  from public.fisios f
  where f.id = p_fisio_id
    and f.deletado_em is null;
$$;

revoke all on function public.hc_obter_fisio_publico(uuid) from public;
grant execute on function public.hc_obter_fisio_publico(uuid) to anon, authenticated;
