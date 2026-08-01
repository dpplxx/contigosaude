-- ============================================================================
-- Migração: foto de perfil do fisio
--
-- A coluna fisios.foto_url e o card de busca (BuscaFisios.jsx) já sabiam
-- exibir a foto — só faltava um jeito de fazer o upload de verdade. Esta
-- migração cria o bucket de armazenamento, as políticas de acesso (cada
-- fisio só mexe na própria pasta, mas qualquer um pode ver as fotos — são
-- públicas por natureza, aparecem na busca) e a função que salva a URL.
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
-- ============================================================================

-- Bucket público (as fotos aparecem pros pacientes na busca, sem login).
-- 2MB de limite e só tipos de imagem comuns — evita gente subindo arquivo
-- gigante ou coisa que não é imagem.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fotos-fisios',
  'fotos-fisios',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Qualquer um pode ver (bucket público, mas a policy de SELECT também
-- precisa existir explicitamente pra funcionar por baixo do RLS do storage).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'fotos_fisios_leitura_publica'
  ) then
    create policy fotos_fisios_leitura_publica on storage.objects for select
      to public
      using (bucket_id = 'fotos-fisios');
  end if;

  -- Cada fisio só escreve na própria pasta: fotos-fisios/{seu user_id}/...
  -- (storage.foldername separa o caminho do arquivo em partes; a primeira
  -- parte precisa bater com o uid de quem está autenticado).
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'fotos_fisios_upload_proprio'
  ) then
    create policy fotos_fisios_upload_proprio on storage.objects for insert
      to authenticated
      with check (
        bucket_id = 'fotos-fisios'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'fotos_fisios_atualizar_proprio'
  ) then
    create policy fotos_fisios_atualizar_proprio on storage.objects for update
      to authenticated
      using (
        bucket_id = 'fotos-fisios'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'fotos_fisios_apagar_proprio'
  ) then
    create policy fotos_fisios_apagar_proprio on storage.objects for delete
      to authenticated
      using (
        bucket_id = 'fotos-fisios'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end $$;

-- Salva a URL pública da foto no cadastro do fisio logado. Separado de
-- hc_cadastrar_fisio de propósito: o upload acontece na hora que a pessoa
-- escolhe o arquivo, sem precisar clicar em "Salvar alterações" do resto
-- do formulário.
create or replace function public.hc_atualizar_foto_fisio(p_foto_url text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update fisios
  set foto_url = nullif(trim(p_foto_url), '')
  where user_id = auth.uid();

  if not found then
    raise exception 'Nenhum cadastro encontrado para esta conta. Cadastre-se primeiro.';
  end if;
end $$;

grant execute on function public.hc_atualizar_foto_fisio(text) to authenticated;

-- hc_meu_painel_fisio precisa devolver foto_url pro formulário mostrar a
-- foto atual ao abrir pra editar.
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

grant execute on function public.hc_meu_painel_fisio() to authenticated;
