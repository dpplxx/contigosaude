import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BuscaFisios } from './BuscaFisios'

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

vi.mock('../lib/api', () => ({
  avaliacoesFisio: vi.fn(),
  denunciarAvaliacao: vi.fn(),
  registrarEventoMarketplace: vi.fn(),
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
