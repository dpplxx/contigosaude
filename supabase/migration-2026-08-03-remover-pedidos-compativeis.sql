-- ============================================================================
-- Migração: remove o funil "pedidos compatíveis" do painel do fisio
--
-- Descoberto nesta sessão: a aba "Pedir atendimento" do paciente foi trocada
-- pela busca aberta (BuscaFisios / hc_listar_fisios, contato direto por
-- WhatsApp) há um tempo, mas ninguém desligou a metade antiga do funil —
-- hc_criar_pedido nunca é chamada por nenhuma tela. Resultado: o painel do
-- fisio prometia "pedidos compatíveis aguardando" que nunca chegavam de
-- verdade, e o fluxo de agendamento/avaliação (que só existe a partir de um
-- pedido fechado) também nunca disparava.
--
-- Decisão: manter só a busca aberta. Esta migração desfaz especificamente o
-- que foi adicionado nesta MESMA sessão pra esse funil (a função
-- hc_ignorar_pedido e a tabela pedidos_ignorados_fisio, de
-- migration-2026-08-03-ignorar-pedido.sql — nunca chegou a ter uso real) e
-- volta hc_meu_painel_fisio a devolver só os dados do próprio cadastro, que
-- é tudo que o formulário do fisio usa hoje (status do CREFITO, se tem
-- coordenadas etc.).
--
-- NÃO mexe em pedidos/agendamentos/hc_criar_pedido/hc_fechar_agendamento/
-- hc_compativel: são estrutura antiga da linha de base (schema-atual.sql),
-- ficam no banco sem uso pela UI por ora — dropar isso é decisão separada,
-- não tomada aqui.
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
-- ============================================================================

drop function if exists public.hc_ignorar_pedido(uuid);
drop table if exists public.pedidos_ignorados_fisio;

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
    )
  );
end $$;

revoke all on function public.hc_meu_painel_fisio() from public, anon;
grant execute on function public.hc_meu_painel_fisio() to authenticated;
