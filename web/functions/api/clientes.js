import { badRequest, json, getSession } from './_lib/security.js'

export async function onRequestGet({ request, env }) {
  const user = await getSession(request, env)
  if (!user) return json({ erro: 'Sessão expirada. Entre novamente.' }, 401)
  if (user.perfil === 'DESENVOLVEDOR') return json({ erro: 'Acesse como usuário Regional.' }, 403)

  const url = new URL(request.url)
  const page = Math.max(1, Number(url.searchParams.get('pagina') || 1))
  const limit = Math.min(100, Math.max(10, Number(url.searchParams.get('limite') || 30)))
  const offset = (page - 1) * limit
  const search = String(url.searchParams.get('busca') || '').trim()
  let districtId = Number(url.searchParams.get('distrital_id') || 0) || null
  let consultantId = Number(url.searchParams.get('consultor_id') || 0) || null

  if (user.perfil === 'GD') districtId = Number(user.distrital_id || 0) || null
  if (user.perfil === 'CONSULTOR') {
    districtId = Number(user.distrital_id || 0) || null
    consultantId = Number(user.consultor_id || 0) || null
  }

  const regional = await env.DB.prepare(`SELECT setor FROM regionais WHERE id = ?`).bind(user.regional_id).first()
  if (!regional?.setor) return badRequest('A Regional não possui setor vinculado.')

  const where = ['ativo = 1', 'setor_gr = ?']
  const params = [String(regional.setor)]

  if (districtId) {
    const district = await env.DB.prepare(`
      SELECT codigo FROM distritais WHERE id = ? AND regional_id = ? AND ativo = 1
    `).bind(districtId, user.regional_id).first()
    if (!district) return badRequest('Distrital inválida.')
    where.push('setor_gd = ?')
    params.push(String(district.codigo))
  }

  if (consultantId) {
    const consultant = await env.DB.prepare(`
      SELECT c.codigo
        FROM consultores c
        JOIN distritais d ON d.id = c.distrital_id
       WHERE c.id = ? AND d.regional_id = ? AND c.ativo = 1
    `).bind(consultantId, user.regional_id).first()
    if (!consultant) return badRequest('Consultor inválido.')
    where.push('setor_consultor = ?')
    params.push(String(consultant.codigo))
  }

  if (search) {
    where.push(`(cnpj LIKE ? OR upper(nome_pdv) LIKE upper(?) OR upper(cidade) LIKE upper(?) OR upper(grupo_economico) LIKE upper(?))`)
    const value = `%${search}%`
    params.push(value, value, value, value)
  }

  const count = await env.DB.prepare(`
    SELECT COUNT(*) AS total
      FROM painel_clientes
     WHERE ${where.join(' AND ')}
  `).bind(...params).first()

  const result = await env.DB.prepare(`
    SELECT id, cnpj, codigo_cliente, nome_pdv, grupo_economico, rede_associacao,
           endereco, bairro, cidade, uf, cep, situacao, classificacao_cliente,
           setor_gr, nome_gr, setor_gd, nome_gd, setor_consultor, nome_consultor,
           foco_pex, positivacao
      FROM painel_clientes
     WHERE ${where.join(' AND ')}
     ORDER BY nome_pdv, cnpj
     LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all()

  const stats = await env.DB.prepare(`
    SELECT COUNT(*) AS clientes,
           COUNT(DISTINCT setor_consultor) AS consultores,
           COUNT(DISTINCT cidade) AS cidades,
           COUNT(DISTINCT uf) AS ufs
      FROM painel_clientes
     WHERE ${where.join(' AND ')}
  `).bind(...params).first()

  return json({
    clientes: result.results || [],
    total: Number(count?.total || 0),
    pagina: page,
    limite: limit,
    paginas: Math.max(1, Math.ceil(Number(count?.total || 0) / limit)),
    resumo: {
      clientes: Number(stats?.clientes || 0),
      consultores: Number(stats?.consultores || 0),
      cidades: Number(stats?.cidades || 0),
      ufs: Number(stats?.ufs || 0),
    },
  })
}
