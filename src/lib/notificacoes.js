import { supabase } from './supabase'

export async function enviarNotificacaoSendGrid(email, dados) {
  try {
    const { data, error } = await supabase.functions.invoke('notify-sendgrid', {
      body: {
        email,
        nome_paciente: dados.nomePaciente,
        especialidade: dados.especialidade,
        pedido_id: dados.pedidoId,
        cidade: dados.cidade,
        bairro: dados.bairro,
      },
    })
    if (error) throw error
    return data
  } catch (e) {
    console.error('Erro ao enviar notificação:', e)
    throw e
  }
}

export async function notificarNovosPedidos(pedidoId) {
  try {
    const { error } = await supabase.rpc('hc_notificar_fisios', {
      p_pedido_id: pedidoId,
    })
    if (error) throw error
  } catch (e) {
    console.error('Erro ao notificar fisios:', e)
  }
}
