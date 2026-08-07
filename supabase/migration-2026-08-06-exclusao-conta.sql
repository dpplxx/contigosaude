-- Exclusão de conta pelo próprio usuário (LGPD, direito ao esquecimento).
-- Cole isto no SQL Editor do Supabase e rode uma vez.
--
-- O QUE ESTA FUNÇÃO FAZ: anonimiza todo dado pessoal ligado à conta que
-- chamou (auth.uid()) — cadastro de fisio e/ou pedidos feitos como paciente,
-- mais os agendamentos e mensagens que exibiriam esse nome pra outra pessoa.
-- Usa o mesmo padrão de soft-delete que já existe em fisios/pedidos
-- (deletado_em), então some das buscas e do painel sem quebrar históricos
-- de agendamento/avaliação de quem já teve atendimento.
--
-- O QUE ELA NÃO FAZ: não apaga a linha em auth.users (o login em si).
-- Apagar auth.users exige a Admin API do Supabase com a service role key
-- (supabase.auth.admin.deleteUser), que só dá pra chamar de uma Edge
-- Function ou de um backend com essa chave — nunca do client, e nunca de
-- uma função "security definer" comum. Fica registrado aqui pra quem for
-- fechar esse ponto depois: precisa de uma Edge Function dedicada.
-- Por ora, o client força signOut() logo após chamar isto, então na
-- prática a conta fica sem nenhum dado pessoal e sem sessão ativa.
create or replace function public.hc_excluir_minha_conta()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_fisio_ids uuid[];
  v_pedido_ids uuid[];
begin
  if v_uid is null then
    raise exception 'Você precisa estar logado pra excluir a conta.';
  end if;

  -- Captura os IDs antes de anonimizar (depois daqui user_id vira null e
  -- não dá mais pra achar as linhas por v_uid).
  select array_agg(id) into v_fisio_ids from public.fisios where user_id = v_uid;
  select array_agg(id) into v_pedido_ids from public.pedidos where user_id = v_uid;

  -- Agendamentos futuros/ativos em que essa conta era o fisio ou o
  -- paciente: cancela, já que uma das partes está de saída.
  update public.agendamentos
  set status = 'cancelado'
  where status = 'agendado'
    and (fisio_id = any(v_fisio_ids) or pedido_id = any(v_pedido_ids));

  -- Nome exibido no chat: mensagens guardam uma cópia do nome de quem
  -- mandou (remetente_nome), então precisa limpar aqui — trocar o nome em
  -- fisios/pedidos não atualiza mensagens antigas.
  update public.mensagens
  set remetente_nome = '[removido]'
  where (remetente = 'fisio' and agendamento_id in (
           select id from public.agendamentos where fisio_id = any(v_fisio_ids)
         ))
     or (remetente = 'paciente' and agendamento_id in (
           select id from public.agendamentos where pedido_id = any(v_pedido_ids)
         ));

  -- Cadastro de fisio, se houver.
  update public.fisios
  set
    nome = 'Fisioterapeuta removido',
    whatsapp = 'removido-' || id::text,
    email = null,
    foto_url = null,
    formacao = null,
    resumo = null,
    disponibilidade = null,
    crefito = null,
    crefito_encrypted = null,
    notificacoes_ativas = false,
    deletado_em = now(),
    user_id = null
  where id = any(v_fisio_ids);

  -- Pedidos feitos como paciente, se houver.
  update public.pedidos
  set
    nome = 'Paciente removido',
    whatsapp = 'removido-' || id::text,
    observacoes = null,
    observacoes_encrypted = null,
    deletado_em = now(),
    user_id = null
  where id = any(v_pedido_ids);
end $$;

revoke all on function public.hc_excluir_minha_conta() from public, anon;
grant execute on function public.hc_excluir_minha_conta() to authenticated;
