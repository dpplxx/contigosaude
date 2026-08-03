import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BuscaFisios } from './BuscaFisios'
import { supabase } from '../lib/supabase'
import {
  obterFisioPublico,
  registrarEventoMarketplace,
  denunciarAvaliacao,
  avaliacoesFisio,
} from '../lib/api'

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

vi.mock('../lib/api', () => ({
  avaliacoesFisio: vi.fn(),
  denunciarAvaliacao: vi.fn(),
  // registrarEventoMarketplace() sempre volta uma Promise de verdade no código
  // real (é "fire and forget" com .catch() encadeado) — sem isso aqui, o
  // .catch() do componente quebra tentando chamar em cima de undefined.
  registrarEventoMarketplace: vi.fn(() => Promise.resolve()),
  obterFisioPublico: vi.fn(),
}))

// O widget real do Turnstile depende do script da Cloudflare carregar, que
// nunca acontece no jsdom — sem isso o botão de busca fica travado
// "disabled" pra sempre nos testes.
vi.mock('../lib/turnstile', () => ({
  turnstileConfigurado: () => false,
  TurnstileWidget: () => null,
}))

describe('BuscaFisios', () => {
  it('renderiza o formulário inicial', () => {
    render(<BuscaFisios />)
    expect(screen.getByText('Busque um fisioterapeuta perto de você')).toBeInTheDocument()
    expect(screen.getByText('Cidade')).toBeInTheDocument()
  })

  it('desabilita botão sem cidade/bairro', () => {
    render(<BuscaFisios />)
    const button = screen.getByRole('button', { name: /Buscar profissionais/i })
    expect(button).toBeDisabled()
  })

  it('exibe erro se campos obrigatórios faltarem', () => {
    const { container } = render(<BuscaFisios />)

    // O botão fica desabilitado sem cidade/bairro/whatsapp (testado acima), então
    // simulamos o submit do form diretamente para exercitar a validação interna.
    fireEvent.submit(container.querySelector('form'))

    expect(screen.getByText(/Informe a cidade e o bairro/)).toBeInTheDocument()
  })

  it('barra o submit em silêncio se o campo honeypot vier preenchido', () => {
    const { container } = render(<BuscaFisios />)

    const honeypot = container.querySelector('input[name="site"]')
    fireEvent.change(honeypot, { target: { value: 'http://spam.example' } })
    fireEvent.submit(container.querySelector('form'))

    expect(screen.queryByText(/Informe a cidade e o bairro/)).not.toBeInTheDocument()
  })
})

describe('BuscaFisios — perfil compartilhado (?fisio=UUID)', () => {
  afterEach(() => {
    // Cada teste que mexe na URL precisa devolver o jsdom pro estado neutro,
    // senão o próximo describe (que espera URL sem ?fisio=) quebra.
    window.history.pushState({}, '', '/')
    vi.clearAllMocks()
  })

  it('mostra "Carregando perfil..." e depois os dados do profissional', async () => {
    window.history.pushState({}, '', '/app.html?fisio=abc-123')
    obterFisioPublico.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                id: 'abc-123',
                nome: 'Maria Silva',
                whatsapp: '11987654321',
                especialidades: ['Ortopédica'],
                total_avaliacoes: 0,
              }),
            10
          )
        })
    )

    render(<BuscaFisios />)

    expect(screen.getByText(/Carregando perfil/i)).toBeInTheDocument()

    expect(await screen.findByText('Maria Silva')).toBeInTheDocument()
    expect(obterFisioPublico).toHaveBeenCalledWith('abc-123')
  })

  it('mostra o erro quando o profissional não é encontrado', async () => {
    window.history.pushState({}, '', '/app.html?fisio=inexistente')
    obterFisioPublico.mockRejectedValue(new Error('Profissional não encontrado.'))

    render(<BuscaFisios />)

    expect(await screen.findByText('Profissional não encontrado.')).toBeInTheDocument()
  })

  it('o botão "Voltar" limpa o ?fisio= da URL', async () => {
    window.history.pushState({}, '', '/app.html?fisio=abc-123')
    obterFisioPublico.mockResolvedValue({
      id: 'abc-123',
      nome: 'Maria Silva',
      whatsapp: '11987654321',
      especialidades: [],
      total_avaliacoes: 0,
    })

    render(<BuscaFisios />)

    await screen.findByText('Maria Silva')
    fireEvent.click(screen.getByText(/Voltar para busca/i))

    // Sem fisio na URL e sem busca feita, volta pro formulário inicial.
    expect(await screen.findByText('Busque um fisioterapeuta perto de você')).toBeInTheDocument()
    expect(window.location.search).toBe('')
  })

  it('clicar no WhatsApp do perfil compartilhado registra o evento de marketplace', async () => {
    window.history.pushState({}, '', '/app.html?fisio=abc-123')
    obterFisioPublico.mockResolvedValue({
      id: 'abc-123',
      nome: 'Maria Silva',
      whatsapp: '11987654321',
      especialidades: [],
      total_avaliacoes: 0,
    })

    render(<BuscaFisios />)

    const botaoWhats = await screen.findByText(/Falar com Maria pelo WhatsApp/i)
    fireEvent.click(botaoWhats)

    expect(registrarEventoMarketplace).toHaveBeenCalledWith({
      tipo: 'whatsapp_clique',
      fisioId: 'abc-123',
    })
  })
})

describe('BuscaFisios — resultados da busca e denúncia de avaliação', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  async function buscarERenderizar(resultado) {
    supabase.rpc.mockResolvedValue({ data: resultado, error: null })
    render(<BuscaFisios />)

    fireEvent.change(screen.getByPlaceholderText(/São Paulo/i), { target: { value: 'Serra' } })
    fireEvent.change(screen.getByPlaceholderText(/Tatuapé/i), { target: { value: 'Laranjeiras' } })
    fireEvent.click(screen.getByRole('button', { name: /Buscar profissionais/i }))

    await waitFor(() => expect(supabase.rpc).toHaveBeenCalled())
  }

  it('lista o profissional retornado e permite clicar no WhatsApp', async () => {
    await buscarERenderizar([
      {
        id: 'fisio-1',
        nome: 'João Souza',
        whatsapp: '11987654321',
        especialidades: ['Ortopédica'],
        total_avaliacoes: 0,
      },
    ])

    const botaoWhats = await screen.findByText('WhatsApp')
    fireEvent.click(botaoWhats)

    expect(registrarEventoMarketplace).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'whatsapp_clique', fisioId: 'fisio-1' })
    )
  })

  it('mostra mensagem de nenhum resultado quando a busca volta vazia', async () => {
    await buscarERenderizar([])

    expect(
      await screen.findByText(/Nenhum profissional disponível nessa região/i)
    ).toBeInTheDocument()
  })

  it('denunciar uma avaliação chama a API com o motivo escolhido', async () => {
    avaliacoesFisio.mockResolvedValue([
      { id: 'av-1', nota: 5, comentario: 'Ótimo atendimento', nome_avaliador: 'Ana S.', criado_em: new Date().toISOString() },
    ])
    denunciarAvaliacao.mockResolvedValue()

    await buscarERenderizar([
      {
        id: 'fisio-1',
        nome: 'João Souza',
        whatsapp: '11987654321',
        especialidades: [],
        total_avaliacoes: 1,
        nota_media: 5,
      },
    ])

    fireEvent.click(await screen.findByText(/Ver avaliações/i))
    expect(await screen.findByText('Ótimo atendimento')).toBeInTheDocument()

    fireEvent.click(screen.getByText(/Denunciar/i))

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'ofensiva' } })
    fireEvent.click(screen.getByText('Enviar'))

    await waitFor(() =>
      expect(denunciarAvaliacao).toHaveBeenCalledWith({ avaliacaoId: 'av-1', motivo: 'ofensiva' })
    )
    expect(await screen.findByText(/Denúncia enviada/i)).toBeInTheDocument()
  })
})
