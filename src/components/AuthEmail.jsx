import { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { Card, Field, TextInput, PrimaryButton } from './ui'
import { supabase } from '../lib/supabase'
import { mensagemDeErro } from '../lib/utils'

const COPY = {
  paciente: {
    titulo: 'Entrar com Email',
    subtituloLogin: 'Entre para buscar fisioterapeutas perto de você.',
    subtituloRegistro: 'Crie sua conta para buscar fisioterapeutas perto de você.',
  },
  fisio: {
    titulo: 'Entrar com Email',
    subtituloLogin: 'Entre para gerenciar seu cadastro.',
    subtituloRegistro: 'Crie sua conta para aparecer na busca de pacientes da sua região.',
  },
}

// Componente compartilhado entre paciente e fisio: no app inteiro há uma
// única sessão do Supabase Auth por navegador, então o mesmo login serve
// para as duas áreas — o que muda é só a área que a pessoa escolhe depois.
export function AuthEmail({ tipo = 'paciente', onAutenticado }) {
  const [modo, setModo] = useState('login')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')
  const [registroFeito, setRegistroFeito] = useState(false)

  const textos = COPY[tipo] || COPY.paciente

  const handleAuth = async (e) => {
    e.preventDefault()
    if (!email || !senha) {
      setErro('Preencha email e senha')
      return
    }

    setLoading(true)
    setErro('')

    try {
      if (modo === 'login') {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: senha,
        })
        if (error) throw error
        onAutenticado?.(data.session)
      } else {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password: senha,
        })
        if (error) throw error
        setModo('login')
        setSenha('')
        setRegistroFeito(true)
      }
    } catch (e) {
      setErro(
        /Invalid login credentials/i.test(e?.message || '')
          ? 'Email ou senha incorretos.'
          : mensagemDeErro(e, `Erro ao ${modo === 'login' ? 'entrar' : 'registrar'}`)
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-medium mb-1">
        {modo === 'login' ? textos.titulo : 'Criar conta'}
      </h2>
      <p className="text-sm mb-5" style={{ color: 'var(--muted1)' }}>
        {modo === 'login' ? textos.subtituloLogin : textos.subtituloRegistro}
      </p>

      {registroFeito && (
        <p
          className="text-sm mb-4 px-3 py-2 rounded-lg"
          style={{ background: '#2FAE7233', color: '#1F7A50' }}
        >
          Conta criada! Confira seu email para confirmar e depois entre com sua senha.
        </p>
      )}

      <form onSubmit={handleAuth} className="space-y-4">
        <Field label="Email">
          <TextInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="seu@email.com"
            disabled={loading}
            required
          />
        </Field>

        <Field label="Senha">
          <TextInput
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="Mínimo 6 caracteres"
            disabled={loading}
            required
          />
        </Field>

        {erro && (
          <div className="flex items-start gap-2 text-xs" style={{ color: '#C24A3E' }}>
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        <PrimaryButton type="submit" disabled={loading}>
          {loading ? '...' : modo === 'login' ? 'Entrar' : 'Registrar'}
        </PrimaryButton>

        <button
          type="button"
          onClick={() => {
            setModo(modo === 'login' ? 'registro' : 'login')
            setErro('')
            setRegistroFeito(false)
          }}
          className="text-sm underline w-full text-center"
          style={{ color: 'var(--muted1)' }}
        >
          {modo === 'login' ? 'Não tem conta? Registre-se' : 'Já tem conta? Entre'}
        </button>
      </form>
    </Card>
  )
}
