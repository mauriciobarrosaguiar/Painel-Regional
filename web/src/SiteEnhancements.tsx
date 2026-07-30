import { FormEvent, useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from './api'
import type { SessionUser } from './types'
import './site-enhancements.css'

type CredentialItem = {
  usuario_mascarado?: string
  status?: string
  mensagem_status?: string
  atualizado_em?: string | null
}

type CredentialResponse = {
  integracao?: CredentialItem | null
}

type Props = {
  user: SessionUser | null
}

const formatDateTime = (value?: string | null) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR')
}

const normalizedText = (value?: string | null) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toUpperCase()

export default function SiteEnhancements({ user }: Props) {
  const [footerTarget, setFooterTarget] = useState<HTMLElement | null>(null)
  const [credentialTarget, setCredentialTarget] = useState<HTMLElement | null>(null)
  const [credential, setCredential] = useState<CredentialItem | null>(null)
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const updateTargets = () => {
      const workspaceFooter = document.querySelector<HTMLElement>('.app-shell > footer')
      const developerShell = document.querySelector<HTMLElement>('.developer-shell')
      const nextFooter = workspaceFooter || developerShell || null

      const previousFooter = document.querySelector<HTMLElement>('.mba-credit-host')
      if (previousFooter && previousFooter !== nextFooter) previousFooter.classList.remove('mba-credit-host')
      if (workspaceFooter && !workspaceFooter.classList.contains('mba-credit-host')) {
        workspaceFooter.classList.add('mba-credit-host')
      }
      setFooterTarget(nextFooter)

      const activeNavigation = normalizedText(
        document.querySelector<HTMLElement>('.regional-main-nav button.active')?.textContent,
      )
      const nextCredentialTarget = user?.perfil === 'GD' && activeNavigation.includes('MEUS ACESSOS')
        ? document.querySelector<HTMLElement>('.integration-forms')
        : null

      const previousCredential = document.querySelector<HTMLElement>('.integration-forms.secure-credential-host')
      if (previousCredential && previousCredential !== nextCredentialTarget) {
        previousCredential.classList.remove('secure-credential-host')
      }
      if (nextCredentialTarget && !nextCredentialTarget.classList.contains('secure-credential-host')) {
        nextCredentialTarget.classList.add('secure-credential-host')
      }
      setCredentialTarget(nextCredentialTarget)
    }

    updateTargets()
    const observer = new MutationObserver(updateTargets)
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    })

    window.addEventListener('popstate', updateTargets)
    return () => {
      observer.disconnect()
      window.removeEventListener('popstate', updateTargets)
      document.querySelector<HTMLElement>('.mba-credit-host')?.classList.remove('mba-credit-host')
      document.querySelector<HTMLElement>('.integration-forms.secure-credential-host')?.classList.remove('secure-credential-host')
    }
  }, [user?.perfil])

  const loadCredential = useCallback(async () => {
    if (user?.perfil !== 'GD') return
    setLoading(true)
    setError('')
    try {
      const result = await api<CredentialResponse>('integracoes/credenciais')
      const saved = result.integracao || null
      setCredential(saved)
      setEditing(!saved)
    } catch (reason) {
      setCredential(null)
      setEditing(true)
      setError(reason instanceof Error ? reason.message : 'Não foi possível consultar o acesso salvo.')
    } finally {
      setLoading(false)
    }
  }, [user?.perfil])

  useEffect(() => {
    if (credentialTarget) void loadCredential()
  }, [credentialTarget, loadCredential])

  async function saveCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    setLoading(true)
    setMessage('')
    setError('')
    try {
      const result = await api<{ mensagem: string; integracao?: CredentialItem }>('integracoes/credenciais', {
        method: 'POST',
        body: JSON.stringify({
          usuario: values.get('usuario'),
          senha: values.get('senha'),
        }),
      })
      form.reset()
      setMessage(result.mensagem || 'Acesso salvo com segurança.')
      setCredential(result.integracao || null)
      setEditing(false)
      await loadCredential()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o acesso.')
    } finally {
      setLoading(false)
    }
  }

  const credit = (
    <a
      className="mba-credit-link"
      href="https://mbalabs.com.br"
      target="_blank"
      rel="noopener noreferrer"
    >
      Desenvolvido por Mauricio Barros de Aguiar <span aria-hidden="true">*</span> mbalabs.com.br
    </a>
  )

  const credentialView = credentialTarget ? createPortal(
    <section className="secure-credential-card" aria-label="Acesso protegido do Bússola e Mercado Farma">
      <div className="secure-credential-heading">
        <span className="secure-credential-icon">B</span>
        <div>
          <h2>Bússola e Mercado Farma</h2>
          <p>Credencial técnica usada somente pelas extrações automatizadas.</p>
        </div>
        <b className={credential ? 'secure-status configured' : 'secure-status pending'}>
          {credential ? 'Configurada' : 'Pendente'}
        </b>
      </div>

      {credential && (
        <div className="secure-credential-details">
          <article>
            <span>Usuário salvo</span>
            <strong>{credential.usuario_mascarado || 'Protegido'}</strong>
          </article>
          <article>
            <span>Última alteração</span>
            <strong>{formatDateTime(credential.atualizado_em)}</strong>
          </article>
          <article>
            <span>Situação</span>
            <strong>{credential.mensagem_status || 'Acesso protegido e disponível para as extrações.'}</strong>
          </article>
        </div>
      )}

      {message && <div className="secure-credential-alert success">{message}</div>}
      {error && <div className="secure-credential-alert error">{error}</div>}

      {!editing && credential ? (
        <button className="secure-replace-button" type="button" onClick={() => { setEditing(true); setMessage(''); setError('') }}>
          Substituir acesso técnico
        </button>
      ) : (
        <form className="secure-credential-form" onSubmit={saveCredential}>
          <div>
            <h3>{credential ? 'Substituir acesso técnico' : 'Cadastrar acesso técnico'}</h3>
            <p>O login e a senha são criptografados. A senha nunca será exibida no painel.</p>
          </div>
          <label>
            <span>Login do Bússola e Mercado Farma</span>
            <input name="usuario" required autoComplete="off" placeholder="Digite o login" />
          </label>
          <label>
            <span>Senha do Bússola e Mercado Farma</span>
            <input name="senha" type="password" required autoComplete="new-password" placeholder="Digite a senha" />
          </label>
          <div className="secure-credential-actions">
            {credential && <button type="button" onClick={() => { setEditing(false); setError('') }}>Cancelar</button>}
            <button type="submit" disabled={loading}>{loading ? 'Salvando…' : 'Salvar acesso'}</button>
          </div>
        </form>
      )}
    </section>,
    credentialTarget,
  ) : null

  return (
    <>
      {footerTarget && (footerTarget.matches('.app-shell > footer')
        ? createPortal(credit, footerTarget)
        : createPortal(<footer className="mba-credit-footer">{credit}</footer>, footerTarget))}
      {credentialView}
    </>
  )
}
