const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})

const TYPES = new Set(['PRODUTOS_MIX', 'PRODUTOS_MERCADO_FARMA'])

async function scopeWithData(env, regionalId, districtId, type) {
  const column = type === 'PRODUTOS_MIX' ? 'mix_importacao_id' : 'mercado_farma_importacao_id'
  if (districtId) {
    const own = await env.DB.prepare(`
      SELECT COUNT(*) AS total
        FROM produtos_catalogo
       WHERE regional_id = ? AND distrital_id = ? AND ${column} IS NOT NULL
    `).bind(regionalId, districtId).first()
    if (Number(own?.total || 0) > 0) return districtId
  }
  return 0
}

export async function onRequestPost({ request, env }) {
  const provided = request.headers.get('x-admin-key') || ''
  if (!env.PAINEL_ADMIN_KEY || provided !== env.PAINEL_ADMIN_KEY) {
    return json({ erro: 'Acesso interno negado.' }, 401)
  }

  let data = {}
  try { data = await request.json() } catch { /* corpo inválido */ }
  const type = String(data.tipo || '').trim().toUpperCase()
  const regionalId = Number(data.regional_id || 0)
  const districtId = Number(data.distrital_id || 0)
  if (!TYPES.has(type) || !regionalId) return json({ erro: 'Tipo e Regional são obrigatórios.' }, 400)

  const selectedDistrict = await scopeWithData(env, regionalId, districtId, type)
  const column = type === 'PRODUTOS_MIX' ? 'mix_importacao_id' : 'mercado_farma_importacao_id'
  const result = await env.DB.prepare(`
    SELECT ean, produto, tipo_mix
      FROM produtos_catalogo
     WHERE regional_id = ? AND distrital_id = ? AND ${column} IS NOT NULL
     ORDER BY produto, ean
  `).bind(regionalId, selectedDistrict).all()

  return json({
    tipo: type,
    origem: selectedDistrict ? 'DISTRITAL' : 'REGIONAL',
    regional_id: regionalId,
    distrital_id: selectedDistrict || null,
    total: result.results?.length || 0,
    produtos: result.results || [],
  })
}
