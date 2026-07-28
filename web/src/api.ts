const TOKEN_KEY = 'painel_regional_token'

export const getToken = () => localStorage.getItem(TOKEN_KEY) || ''
export const setToken = (token: string) => localStorage.setItem(TOKEN_KEY, token)
export const clearToken = () => localStorage.removeItem(TOKEN_KEY)

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(`/api/${path.replace(/^\//, '')}`, {
    ...options,
    headers,
    cache: 'no-store',
  })

  const raw = await response.text()
  let payload: Record<string, unknown> = {}
  if (raw) {
    try {
      payload = JSON.parse(raw) as Record<string, unknown>
    } catch {
      payload = {}
    }
  }

  if (!response.ok) {
    const message = String(
      payload.erro
      || payload.detalhe
      || raw.slice(0, 240)
      || `Erro HTTP ${response.status}`,
    )
    throw new Error(message)
  }

  if (!raw) return {} as T
  if (!Object.keys(payload).length && raw) {
    throw new Error('O servidor respondeu em formato inválido. Atualize a página e tente novamente.')
  }
  return payload as T
}
