import { useEffect, useState } from 'react'
import { Mail, Lock, ArrowRight, AlertCircle } from 'lucide-react'
import { Card, Field, TextInput, PrimaryButton } from './ui'
import { supabase } from '../lib/supabase'
import { mensagemDeErro } from '../lib/utils'

export function AuthPaciente({ onAutenticado }) {
  const [modo, setModo] = useState('login')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')
  const [sessao, setSessao] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setSessao(data.session)
    })

    const { data } = supabase.auth.onAuthStateChange((_evento, sessao) => {
      setSessao(sessao)
      if (sessao) onAutenticado?.(sessao)
    })

    return () => data.subscription.unsubscribe()
  }, [onAutenticado])

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
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: senha,
        })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password: senha,
        })
        if (error) throw error
        setErro('')
        setModo('login')
        setEmail('')
        setSenha('')
        return
      }
    } catch (e) {
      setErro(mensagemDeErro(e, `Erro ao ${modo === 'login' ? 'entrar' : 'registrar'}`))
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setSessao(null)
  }

  if (sessao) {
    return (
      <Card>
        <p className="text-sm mb-3">Autenticado como: <strong>{sessao.user.email}</strong></p>
        <button
          onClick={handleLogout}
          className="text-xs px-3 py-1.5 rounded-lg"
          style={{ background: '#C6693D', color: '#14231F' }}
        >
          Sair
        </button>
      </Card>
    )
  }

  return (
    <Card>
      <h2 className="text-lg font-medium mb-1">
        {modo === 'login' ? 'Entrar com Email' : 'Criar Conta'}
      </h2>
      <p className="text-sm mb-5" style={{ color: 'var(--muted1)' }}>
        {modo === 'login'
          ? 'Acompanhe seus pedidos com segurança.'
          : 'Registre-se para começar a usar.'}
      </p>

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
          <div className="flex items-start gap-2 text-xs" style={{ color: '#D98C6E' }}>
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
