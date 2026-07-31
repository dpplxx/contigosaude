import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  it('exibe erro se campos obrigatórios faltarem', async () => {
    const user = userEvent.setup()
    render(<BuscaFisios />)

    const button = screen.getByRole('button', { name: /Buscar profissionais/i })
    await user.click(button)

    expect(screen.getByText(/Informe a cidade e o bairro/)).toBeInTheDocument()
  })
})
