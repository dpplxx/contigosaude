-- ============================================================================
-- Migração: fisio fecha o próprio atendimento
--
-- Até agora, um pedido só virava "agendamento" se alguém entrasse no Painel
-- e criasse isso manualmente — o que não existe de verdade no fluxo atual
-- (o paciente já contata o fisio direto pelo WhatsApp assim que a busca
-- retorna resultados). Sem agendamento, o pedido nunca some da lista de
-- "pedidos compatíveis" de outros fisios, e o paciente nunca pode avaliar.
--
-- Esta migração deixa o próprio fisio fechar o atendimento, direto do
-- painel dele, a partir de um pedido compatível que ele já está vendo.
-- Confirma data/horário e só então o WhatsApp do paciente é liberado —
-- mesma regra de "contato só depois da confirmação" que já valia pros
-- agendamentos criados manualmente.
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
-- ============================================================================

-- Um pedido só pode virar um agendamento. Sem isso, dois fisios poderiam
-- fechar o mesmo pedido ao mesmo tempo (condição de corrida) — o índice
-- único faz o segundo INSERT falhar no banco, não só na checagem da
-- aplicação.
create unique index if not exists agendamentos_pedido_unico on public.agendamentos (pedido_id);

create or replace function public.hc_fechar_agendamento(
  p_pedido_id uuid,
  p_data date,
  p_horario time
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fisio fisios%rowtype;
  v_pedido pedidos%rowtype;
  v_agendamento_id uuid;
begin
  select * into v_fisio from fisios where user_id = auth.uid() limit 1;
  if v_fisio.id is null then
    raise exception 'Você precisa ter um cadastro de fisioterapeuta pra fechar um atendimento.';
  end if;

  select * into v_pedido from pedidos
  where id = p_pedido_id and status = 'ativo' and deletado_em is null;
  if v_pedido.id is null then
    raise exception 'Pedido não encontrado ou já foi atendido.';
  end if;

  if not hc_compativel(
    v_fisio.especialidades, v_fisio.cidade, v_fisio.bairros, v_fisio.lat, v_fisio.lng, v_fisio.raio_km,
    v_pedido.especialidade, v_pedido.cidade, v_pedido.bairro, v_pedido.lat, v_pedido.lng
  ) then
    raise exception 'Esse pedido não é compatível com sua região ou especialidade.';
  end if;

  begin
    insert into agendamentos (pedido_id, fisio_id, data, horario, status)
    values (p_pedido_id, v_fisio.id, p_data, p_horario, 'agendado')
    returning id into v_agendamento_id;
  exception when unique_violation then
    raise exception 'Esse pedido já foi fechado por outro profissional.';
  end;

  return jsonb_build_object(
    'agendamento_id', v_agendamento_id,
    'paciente_nome', v_pedido.nome,
    'paciente_whatsapp', v_pedido.whatsapp
  );
end $$;

revoke all on function public.hc_fechar_agendamento(uuid, date, time) from public, anon;
grant execute on function public.hc_fechar_agendamento(uuid, date, time) to authenticated;
