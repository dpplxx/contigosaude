import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MeusAtendimentos } from './MeusAtendimentos'
import { confirmarAtendimento, meusPedidos } from '../lib/api'

vi.mock('../lib/api', () => ({
  avaliar: vi.fn(),
  confirmarAtendimento: vi.fn(),
  meusPedidos: vi.fn(),
}))

vi.mock('../lib/analytics', () => ({
  trackEvent: vi.fn(),
  Events: { REVIEW_SUBMITTED: 'review_submitted' },
}))

function pedidoConcluido(overrides = {}) {
  return {
    id: 'pedido-1',
    especialidade: 'Ortopédica',
    cidade: 'Vitória',
    bairro: 'Centro',
    status: 'ativo',
    agendamento: {
      id: 'ag-1',
      data: '2020-01-01',
      horario: '10:00:00',
      status: 'concluido',
      confirmado_paciente: false,
      avaliado: false,
      fisio: { id: 'fisio-1', nome: 'João Pereira' },
      ...overrides,
    },
  }
}

describe('MeusAtendimentos — confirmação antes de avaliar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mostra o convite pra confirmar quando concluído mas ainda não confirmado', async () => {
    meusPedidos.mockResolvedValue([pedidoConcluido()])
    render(<MeusAtendimentos />)

    expect(await screen.findByText(/O atendimento com João Pereira aconteceu\?/)).toBeInTheDocument()
    expect(screen.queryByText(/Como foi o atendimento/)).not.toBeInTheDocument()
  })

  it('confirma e recarrega a lista ao clicar no botão', async () => {
    meusPedidos
      .mockResolvedValueOnce([pedidoConcluido()])
      .mockResolvedValueOnce([pedidoConcluido({ confirmado_paciente: true })])
    confirmarAtendimento.mockResolvedValue()

    render(<MeusAtendimentos />)
    const botao = await screen.findByRole('button', { name: /Sim, o atendimento aconteceu/ })
    fireEvent.click(botao)

    await waitFor(() => expect(confirmarAtendimento).toHaveBeenCalledWith('ag-1'))
    await waitFor(() => expect(meusPedidos).toHaveBeenCalledTimes(2))
  })

  it('espera 7 dias pra avaliar mesmo depois de confirmado', async () => {
    const hoje = new Date().toISOString().slice(0, 10)
    meusPedidos.mockResolvedValue([
      pedidoConcluido({ confirmado_paciente: true, data: hoje }),
    ])
    render(<MeusAtendimentos />)

    expect(await screen.findByText(/Você poderá avaliar esse atendimento a partir de/)).toBeInTheDocument()
    expect(screen.queryByText(/O atendimento com João Pereira aconteceu\?/)).not.toBeInTheDocument()
  })

  it('mostra o formulário de avaliação depois de confirmado e passados 7 dias', async () => {
    meusPedidos.mockResolvedValue([
      pedidoConcluido({ confirmado_paciente: true, data: '2020-01-01' }),
    ])
    render(<MeusAtendimentos />)

    expect(await screen.findByText(/Como foi o atendimento com João Pereira\?/)).toBeInTheDocument()
  })

  it('mostra "já avaliou" quando avaliado=true, sem passar pela confirmação de novo', async () => {
    meusPedidos.mockResolvedValue([
      pedidoConcluido({ confirmado_paciente: true, avaliado: true, data: '2020-01-01' }),
    ])
    render(<MeusAtendimentos />)

    expect(await screen.findByText(/Você já avaliou este atendimento/)).toBeInTheDocument()
  })
})
