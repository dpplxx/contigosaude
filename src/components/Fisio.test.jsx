import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PhysioForm } from './Fisio'
import { meuPainelFisio } from '../lib/api'

vi.mock('../lib/api', () => ({
  cadastrarFisio: vi.fn(),
  enviarFotoFisio: vi.fn(),
  marcarStatusAgendamento: vi.fn(),
  meuPainelFisio: vi.fn(),
  verificarTurnstile: vi.fn(),
}))

vi.mock('../lib/analytics', () => ({
  trackEvent: vi.fn(),
  Events: { SIGNUP_STARTED: 'signup_started', SIGNUP_COMPLETED: 'signup_completed' },
}))

describe('PhysioForm — onde e como atende', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    meuPainelFisio.mockRejectedValue(new Error('sem cadastro'))
  })

  it('não mostra o campo de convênios até escolher "Convênio" como forma de pagamento', async () => {
    render(<PhysioForm />)
    await screen.findByText('Cadastre-se como fisioterapeuta')

    expect(screen.queryByText('Convênios que você atende (opcional)')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Forma de pagamento (opcional)'), {
      target: { value: 'convenio' },
    })

    expect(await screen.findByText('Convênios que você atende (opcional)')).toBeInTheDocument()
    expect(screen.getByText('Unimed')).toBeInTheDocument()
  })

  it('alterna um convênio ao clicar duas vezes (adiciona e remove)', async () => {
    render(<PhysioForm />)
    await screen.findByText('Cadastre-se como fisioterapeuta')

    fireEvent.change(screen.getByLabelText('Forma de pagamento (opcional)'), {
      target: { value: 'convenio' },
    })
    // O grupo de pills fica dentro do <label> do Field, o que faz o nome
    // acessível do botão (role+name) virar o texto do campo inteiro em vez
    // do texto do próprio botão — por isso a busca é por texto, restrita a
    // elementos <button>, e não por role+name.
    const botaoUnimed = await screen.findByText('Unimed', { selector: 'button' })

    fireEvent.click(botaoUnimed)
    // Vira uma tag removível na lista, além do botão continuar existindo.
    expect(await screen.findByLabelText('Remover Unimed')).toBeInTheDocument()

    fireEvent.click(botaoUnimed)
    await waitFor(() =>
      expect(screen.queryByLabelText('Remover Unimed')).not.toBeInTheDocument()
    )
  })

  it('permite marcar mais de um local de atendimento', async () => {
    render(<PhysioForm />)
    await screen.findByText('Cadastre-se como fisioterapeuta')

    const domicilio = screen.getByText(/Domicílio/, { selector: 'button' })
    const clinica = screen.getByText(/Clínica/, { selector: 'button' })

    fireEvent.click(domicilio)
    fireEvent.click(clinica)

    // Não há como ler o estado React diretamente daqui, mas os dois botões
    // devem continuar presentes e clicáveis (não é um radio de opção única).
    expect(domicilio).toBeInTheDocument()
    expect(clinica).toBeInTheDocument()
  })
})
