import { useCallback, useEffect, useState } from 'react'
import { Calendar, MapPin, Phone, RefreshCw, Clock } from 'lucide-react'
import { Card, Tag, SelectInput, ErroInline } from './ui'
import { ChatThread, AgendamentoInfo } from './Compartilhados'
import { painelFisio, marcarStatusAgendamento } from '../lib/api'
import { STATUS_AGENDAMENTO, STATUS_LABEL, formatDataHora, mensagemDeErro } from '../lib/utils'

export function MeusAgendamentos({ whatsappFisio, onNotify }) {
  const [agendamentos, setAgendamentos] = useState([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('pendente')

  const carregar = useCallback(async () => {
    if (!whatsappFisio) return
    setLoading(true)
    setErro('')
    try {
      const dados = await painelFisio(whatsappFisio)
      const agendamentosLista = dados.fisio?.agendamentos || []
      setAgendamentos(agendamentosLista)
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível carregar os agendamentos.'))
    } finally {
      setLoading(false)
    }
  }, [whatsappFisio])

  useEffect(() => {
    carregar()
    const intervalo = setInterval(carregar, 30000)
    return () => clearInterval(intervalo)
  }, [carregar])

  const alterarStatus = async (agendamentoId, novoStatus) => {
    try {
      await marcarStatusAgendamento({
        agendamentoId,
        status: novoStatus,
        whatsapp: whatsappFisio,
      })
      await carregar()
      onNotify?.('Status atualizado com sucesso!')
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível atualizar o status.'))
    }
  }

  const agendamentosFiltrados = agendamentos.filter((a) => a.status === filtroStatus)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm" style={{ color: 'var(--muted1)' }}>
          {agendamentosFiltrados.length} agendamento{agendamentosFiltrados.length !== 1 ? 's' : ''}
        </p>
        <button
          onClick={carregar}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border"
          style={{ borderColor: 'var(--border-soft)', color: 'var(--muted4)' }}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Atualizar
        </button>
      </div>

      <div>
        <label className="text-xs mb-2 block" style={{ color: 'var(--muted1)' }}>
          Filtrar por status
        </label>
        <SelectInput value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
          {STATUS_AGENDAMENTO.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABEL[status]}
            </option>
          ))}
        </SelectInput>
      </div>

      <ErroInline>{erro}</ErroInline>

      {agendamentosFiltrados.length === 0 && !loading && (
        <Card>
          <p className="text-sm" style={{ color: 'var(--muted1)' }}>
            Nenhum agendamento com status "{STATUS_LABEL[filtroStatus]}".
          </p>
        </Card>
      )}

      {agendamentosFiltrados.map((agendamento) => (
        <Card key={agendamento.id}>
          <div className="flex flex-wrap gap-2 mb-2">
            <Tag>{agendamento.pedido?.especialidade}</Tag>
            <Tag>{STATUS_LABEL[agendamento.status]}</Tag>
          </div>

          <p className="text-sm font-medium">{agendamento.pedido?.nome}</p>

          {agendamento.pedido?.bairro && (
            <p className="text-sm flex items-center gap-1 mt-1" style={{ color: 'var(--muted1)' }}>
              <MapPin size={13} />
              {agendamento.pedido.bairro}, {agendamento.pedido.cidade}
            </p>
          )}

          {agendamento.data && agendamento.horario && (
            <p className="text-sm flex items-center gap-1 mt-1" style={{ color: '#8FAE8B' }}>
              <Clock size={13} />
              {formatDataHora(agendamento.data, agendamento.horario)}
            </p>
          )}

          {agendamento.status === 'pendente' && (
            <div className="mt-3 flex gap-2 flex-wrap">
              <button
                onClick={() => alterarStatus(agendamento.id, 'agendado')}
                className="text-xs px-3 py-1.5 rounded-lg"
                style={{ background: '#8FAE8B', color: 'white' }}
              >
                Confirmar agendamento
              </button>
              <button
                onClick={() => alterarStatus(agendamento.id, 'recusado')}
                className="text-xs px-3 py-1.5 rounded-lg"
                style={{ color: 'var(--muted1)' }}
              >
                Recusar
              </button>
            </div>
          )}

          {agendamento.status === 'agendado' && (
            <button
              onClick={() => alterarStatus(agendamento.id, 'concluido')}
              className="text-xs px-3 py-1.5 rounded-lg mt-3"
              style={{ background: '#C6693D', color: '#14231F' }}
            >
              Marcar como concluído
            </button>
          )}

          {agendamento.pedido?.whatsapp && (
            <ChatThread
              agendamentoId={agendamento.id}
              whatsapp={agendamento.pedido.whatsapp}
              remetente="fisio"
              remetenteNome="Você"
              mensagens={agendamento.mensagens}
              onSent={carregar}
            />
          )}
        </Card>
      ))}
    </div>
  )
}
