import { FormEvent, useState } from 'react'
import { api, setToken } from './api'
import type { Regional, SessionUser } from './types'
import './login.css'

type Props = {
  developerConfigured: boolean
  onAuthenticated: (user: SessionUser, regional: Regional | null) => void
}

type Mode = 'login' | 'developer'

export default function LoginPage({ developerConfigured, onAuthenticated }: Props) {
  const [mode, setMode] = useState<Mode>('login')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    const form = new FormData(event.currentTarget)
    const payload = {
      nome: String(form.get('nome') || '').trim(),
      email: String(form.get('email') || '').trim().toLowerCase(),
      senha: String(form.get('senha') || ''),
    }

    try {
      const endpoint = mode === 'developer' && !developerConfigured
        ? 'auth/developer-setup'
        : 'auth/login'
      const result = await api<{ token: string; usuario: SessionUser; regional?: Regional | null }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setToken(result.token)
      onAuthenticated(result.usuario, result.regional || null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível entrar no painel.')
    } finally {
      setLoading(false)
    }
  }

  const firstDeveloperAccess = mode === 'developer' && !developerConfigured

  return (
    <main className="login-page">
      <button
        className="developer-access-button"
        type="button"
        onClick={() => {
          setMode((current) => current === 'login' ? 'developer' : 'login')
          setError('')
        }}
      >
        {mode === 'login'
          ? developerConfigured ? 'Acesso do desenvolvedor' : 'Primeiro acesso do desenvolvedor'
          : 'Voltar ao login'}
      </button>

      <section className="login-card">
        <div className="login-brand">
          <div className="login-brand-mark">R</div>
          <div><strong>Painel Regional</strong><span>Gestão Comercial</span></div>
        </div>

        <span className="login-eyebrow">
          {mode === 'developer' ? 'Administração da plataforma' : 'Acesso Regional'}
        </span>
        <h1>
          {firstDeveloperAccess
            ? 'Crie seu primeiro acesso'
            : mode === 'developer'
              ? 'Entre como desenvolvedor'
              : 'Entre no Painel Regional'}
        </h1>
        <p>
          {firstDeveloperAccess
            ? 'Este acesso será usado para cadastrar Regionais e Gerentes Regionais.'
            : mode === 'developer'
              ? 'Use o e-mail e a senha cadastrados no primeiro acesso.'
              : 'Use o e-mail e a senha fornecidos pelo responsável da sua Regional.'}
        </p>

        <form onSubmit={submit}>
          {firstDeveloperAccess && (
            <label><span>Nome completo</span><input name="nome" required minLength={3} autoComplete="name" /></label>
          )}
          <label><span>E-mail</span><input name="email" type="email" required autoFocus autoComplete="username" /></label>
          <label><span>Senha</span><input name="senha" type="password" required minLength={8} autoComplete={firstDeveloperAccess ? 'new-password' : 'current-password'} /></label>
          {error && <div className="login-alert">{error}</div>}
          <button className="login-primary" disabled={loading}>
            {loading
              ? 'Aguarde…'
              : firstDeveloperAccess
                ? 'Criar primeiro acesso'
                : 'Entrar no painel'}
          </button>
        </form>

        <small>
          O acesso do Gerente Regional também será protegido e preparado para as extrações da Bússola e Mercado Farma.
        </small>
      </section>
    </main>
  )
}
