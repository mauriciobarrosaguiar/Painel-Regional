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
  const developerMode = mode === 'developer'

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

        <h1>
          {firstDeveloperAccess
            ? 'Crie seu primeiro acesso'
            : developerMode
              ? 'Entre como desenvolvedor'
              : 'Entre no Painel Regional'}
        </h1>

        <form onSubmit={submit}>
          {firstDeveloperAccess && (
            <label><span>Nome completo</span><input name="nome" required minLength={3} autoComplete="name" /></label>
          )}
          <label>
            <span>{developerMode ? 'E-mail' : 'Matrícula ou e-mail EMS'}</span>
            <input
              name="email"
              type={developerMode ? 'email' : 'text'}
              required
              autoFocus
              autoComplete="username"
              placeholder={developerMode ? 'seuemail@dominio.com' : 'm0000000'}
            />
          </label>
          <label>
            <span>Senha</span>
            <input
              name="senha"
              type="password"
              required
              minLength={8}
              autoComplete={firstDeveloperAccess ? 'new-password' : 'current-password'}
              placeholder={developerMode ? '' : 'Número do setor'}
            />
          </label>
          {error && <div className="login-alert">{error}</div>}
          <button className="login-primary" disabled={loading}>
            {loading
              ? 'Aguarde…'
              : firstDeveloperAccess
                ? 'Criar primeiro acesso'
                : 'Entrar no painel'}
          </button>
        </form>
      </section>

      <footer className="login-credit">
        Desenvolvido por Mauricio Barros de Aguiar *{' '}
        <a href="https://mbalabs.com.br" target="_blank" rel="noreferrer">mbalabs.com.br</a>
      </footer>
    </main>
  )
}
