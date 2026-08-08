-- MFA (verificação em duas etapas) pra admin e fisio: fecha o acesso a dado
-- de paciente atrás de um segundo fator, não só senha.
--
-- Como funciona: o Supabase Auth já suporta TOTP nativamente (enroll/
-- challenge/verify pelo client) e embute o nível de garantia da sessão no
-- JWT — aal1 (só senha) ou aal2 (senha + segundo fator). O que faltava era
-- o BANCO exigir aal2 de quem já ativou o segundo fator. Sem isso, alguém
-- com a senha vazada conseguia logar em aal1 e usar a conta normalmente —
-- o MFA existiria só na tela de login, decorativo.
--
-- hc_aal_suficiente() implementa o padrão oficial do Supabase pra
-- "aplicação opcional": só exige aal2 de quem TEM um fator verificado.
-- Quem nunca ativou MFA continua liberado em aal1, sem nenhuma mudança —
-- essencial aqui porque paciente não passa por esse fluxo (só admin e
-- fisio ganham a opção de ativar, ver MfaConfiguracao no app).
--
-- Onde isso é aplicado nesta migração:
--   1. hc_e_admin() — protege TODO o Painel de uma vez só, porque tanto os
--      RPCs administrativos quanto a leitura direta das tabelas (policy
--      painel_total) passam por esta função.
--   2. hc_meu_painel_fisio() — devolve nome/WhatsApp/observações dos
--      pacientes pro fisio logado; é a maior superfície de dado sensível
--      do lado fisio.
-- hc_enviar_mensagem() ficou de fora de propósito, pra não disputar a
-- mesma função com a migração de rate limiting (migration-2026-08-08-
-- rate-limiting.sql) — as duas mexeriam no mesmo "create or replace" e uma
-- sobrescreveria a outra dependendo da ordem em que forem coladas.
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.

create or replace function public.hc_aal_suficiente()
returns boolean
language sql
stable
as $$
  select case
    when exists (
      select 1 from auth.mfa_factors
      where user_id = auth.uid() and status = 'verified'
    )
    then (select auth.jwt() ->> 'aal') = 'aal2'
    else true
  end;
$$;

revoke all on function public.hc_aal_suficiente() from public, anon;
grant execute on function public.hc_aal_suficiente() to authenticated;

-- Mesma checagem de sempre (conta na tabela admins) + agora exige aal2 se a
-- conta tiver MFA ativado. Quem é admin mas ainda não passou pelo desafio
-- nesta sessão é tratado como "não admin" até verificar — falha fechada,
-- não aberta.
create or replace function public.hc_e_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from admins where user_id = auth.uid())
     and public.hc_aal_suficiente();
$$;

-- Corpo idêntico ao de schema-atual.sql, só com a checagem de aal2 no
-- início. Levanta exceção em vez de devolver vazio — o app já checa isso
-- ANTES de chamar esta função (mostra a tela de desafio primeiro), então na
-- prática só cai aqui se alguém pular a checagem do client, ex. chamando o
-- RPC direto.
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
