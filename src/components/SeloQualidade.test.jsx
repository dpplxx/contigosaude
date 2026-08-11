import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SeloQualidade } from './ui'

describe('SeloQualidade', () => {
  it('não mostra nada na versão compacta pra quem ainda não tem avaliação verificada', () => {
    const { container } = render(<SeloQualidade qualidade={{ nivel: 0 }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('mostra "Novo no Contigo" na versão completa, sem parecer avaliação ruim', () => {
    render(<SeloQualidade qualidade={{ nivel: 0 }} variante="completo" />)
    expect(screen.getByText('Novo no Contigo')).toBeInTheDocument()
    expect(screen.queryByText('0,0')).not.toBeInTheDocument()
  })

  it('mostra o selo compacto a partir do nível 1', () => {
    render(<SeloQualidade qualidade={{ nivel: 1 }} />)
    expect(screen.getByText(/Profissional Avaliado/)).toBeInTheDocument()
  })

  it('mostra a explicação e o aviso de "não é comprado" na versão completa', () => {
    render(<SeloQualidade qualidade={{ nivel: 4 }} variante="completo" />)
    expect(screen.getByText(/Profissional Destaque/)).toBeInTheDocument()
    expect(screen.getByText(/não é comprado/)).toBeInTheDocument()
  })

  it('trata qualidade ausente como nível 0', () => {
    const { container } = render(<SeloQualidade qualidade={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
