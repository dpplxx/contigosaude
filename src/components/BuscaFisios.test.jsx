import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BuscaFisios } from './BuscaFisios'

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

vi.mock('../lib/api', () => ({
  criarPedido: vi.fn(),
}))

describe('BuscaFisios', () => {
  it('renderiza o formulário inicial', () => {
    render(<BuscaFisios />)
    expect(screen.getByText('Busque um fisioterapeuta perto de você')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Ex: Maria Silva')).toBeInTheDocument()
  })

  it('desabilita botão sem cidade/bairro/whatsapp', () => {
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
})
