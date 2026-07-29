const encoder = new TextEncoder()
const decoder = new TextDecoder()
const fromHex = (value) => new Uint8Array(String(value).match(/.{1,2}/g)?.map((item) => Number.parseInt(item, 16)) || [])
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})

async function encryptionKey(secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Chave de proteção não configurada.')
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`painel-regional:credenciais:v1:${secret}`))
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['decrypt'])
}

async function decryptCredentials(value, secret) {
  const [version, ivHex, encryptedHex] = String(value || '').split('.')
  if (version !== 'v1' || !ivHex || !encryptedHex) throw new Error('Credencial cifrada inválida.')
  const key = await encryptionKey(secret)
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromHex(ivHex) }, key, fromHex(encryptedHex))
  return JSON.parse(decoder.decode(decrypted))
}

export async function onRequestPost({ request, env }) {
  const provided = request.headers.get('x-admin-key') || ''
  if (!env.PAINEL_ADMIN_KEY || provided !== env.PAINEL_ADMIN_KEY) {
    return json({ erro: 'Acesso interno negado.' }, 401)
  }

  let data = {}
  try { data = await request.json() } catch { /* corpo vazio */ }
  const regionalId = Number(data.regional_id || 0)
  const type = String(data.tipo || '').trim().toUpperCase()
  if (!regionalId || !['BUSSOLA', 'MERCADO_FARMA'].includes(type)) {
    return json({ erro: 'Regional e integração são obrigatórias.' }, 400)
  }

  const current = await env.DB.prepare(`
    SELECT credencial_cifrada
      FROM credenciais_integracoes
     WHERE regional_id = ? AND status = 'CONFIGURADA'
     ORDER BY CASE WHEN tipo = ? THEN 0 ELSE 1 END, atualizado_em DESC
     LIMIT 1
  `).bind(regionalId, type).first()
  if (!current) return json({ erro: 'Credencial única não configurada para esta Regional.' }, 404)

  try {
    const credential = await decryptCredentials(current.credencial_cifrada, env.PAINEL_REGIONAL_KEY)
    return json({
      regional_id: regionalId,
      tipo: type,
      usuario: credential.usuario,
      senha: credential.segredo,
    })
  } catch (error) {
    return json({ erro: 'Não foi possível abrir a credencial.', detalhe: error instanceof Error ? error.message : String(error) }, 500)
  }
}
