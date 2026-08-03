import { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { Card, Field, TextInput, PrimaryButton } from './ui'
import { supabase } from '../lib/supabase'
import { recuperarSenha, definirNovaSenha } from '../lib/api'
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
  const [recuperacaoEnviada, setRecuperacaoEnviada] = useState(false)

  const textos = COPY[tipo] || COPY.paciente

  const handleRecuperar = async (e) => {
    e.preventDefault()
    if (!email) {
      setErro('Informe seu email')
      return
    }

    setLoading(true)
    setErro('')

    try {
      await recuperarSenha(email)
      setRecuperacaoEnviada(true)
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível enviar o link de recuperação.'))
    } finally {
      setLoading(false)
    }
  }

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

  if (modo === 'recuperar') {
    return (
      <Card>
        <h2 className="text-lg font-medium mb-1">Recuperar senha</h2>
        <p className="text-sm mb-5" style={{ color: 'var(--muted1)' }}>
          Informe seu email e mandamos um link para você criar uma senha nova.
        </p>

        {recuperacaoEnviada ? (
          <p
            className="text-sm mb-4 px-3 py-2 rounded-lg"
            style={{ background: '#2FAE7233', color: '#1F7A50' }}
          >
            Se esse email tiver uma conta, o link chega em instantes. Confira também o spam.
          </p>
        ) : (
          <form onSubmit={handleRecuperar} className="space-y-4">
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

            {erro && (
              <div className="flex items-start gap-2 text-xs" style={{ color: '#C24A3E' }}>
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{erro}</span>
              </div>
            )}

            <PrimaryButton type="submit" disabled={loading}>
              {loading ? '...' : 'Enviar link de recuperação'}
            </PrimaryButton>
          </form>
        )}

        <button
          type="button"
          onClick={() => {
            setModo('login')
            setErro('')
            setRecuperacaoEnviada(false)
          }}
          className="text-sm underline w-full text-center mt-4"
          style={{ color: 'var(--muted1)' }}
        >
          ← Voltar para entrar
        </button>
      </Card>
    )
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

        {modo === 'login' && (
          <button
            type="button"
            onClick={() => {
              setModo('recuperar')
              setErro('')
            }}
            className="text-sm underline w-full text-center"
            style={{ color: 'var(--muted1)' }}
          >
            Esqueci minha senha
          </button>
        )}

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

// Tela mostrada quando a pessoa volta pelo link do email de recuperação —
// o Supabase já autentica com uma sessão temporária de recuperação nesse
// momento (detectSessionInUrl), então aqui só falta ela escolher a senha
// nova. Serve tanto para paciente quanto para fisio: é a mesma conta.
export function DefinirNovaSenha({ onConcluido }) {
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (senha.length < 6) {
      setErro('A senha precisa ter pelo menos 6 caracteres.')
      return
    }
    if (senha !== confirmacao) {
      setErro('As senhas não coincidem.')
      return
    }

    setLoading(true)
    setErro('')

    try {
      await definirNovaSenha(senha)
      onConcluido?.()
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível atualizar a senha.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-medium mb-1">Definir nova senha</h2>
      <p className="text-sm mb-5" style={{ color: 'var(--muted1)' }}>
        Escolha uma senha nova para sua conta.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Nova senha">
          <TextInput
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="Mínimo 6 caracteres"
            disabled={loading}
            required
          />
        </Field>

        <Field label="Confirmar nova senha">
          <TextInput
            type="password"
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
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
          {loading ? '...' : 'Salvar nova senha'}
        </PrimaryButton>
      </form>
    </Card>
  )
}
