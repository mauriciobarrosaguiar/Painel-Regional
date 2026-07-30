import { badRequest, json, readBody } from '../_lib/security.js'
import { requireManager } from '../_lib/manager.js'

const TYPES = ['BUSSOLA', 'MERCADO_FARMA']

function commandStatement(env, user, type, districtId, parameters, now) {
  return env.DB.prepare(`
    INSERT INTO comandos_automacao
      (id, regional_id, distrital_id, tipo, parametros_json, status, solicitado_por, mensagem, solicitado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, 'aguardando', ?, ?, ?, ?)
  `).bind(
    `cmd-${crypto.randomUUID()}`,
    user.regional_id,
    districtId,
    type,
    JSON.stringify(parameters),
    user.email,
    'Extração registrada para usar a credencial desta Distrital.',
    now,
    now,
  )
}

export async function onRequestPost({ request, env }) {
  const { denial, user } = await requireManager(request, env)
  if (denial) return denial

  const data = await readBody(request)
  const type = String(data.tipo || '').trim().toUpperCase()
  if (!TYPES.includes(type)) return badRequest('Tipo de automação inválido.')

  const districtFilter = user.perfil === 'GD' ? ' AND d.id = ?' : ''
  const configured = await env.DB.prepare(`
    SELECT d.id, d.nome, d.codigo
      FROM distritais d
      JOIN credenciais_distritais c
        ON c.distrital_id = d.id
       AND c.regional_id = d.regional_id
       AND c.tipo = ?
       AND c.status = 'CONFIGURADA'
     WHERE d.regional_id = ? AND d.ativo = 1${districtFilter}
     GROUP BY d.id, d.nome, d.codigo
     ORDER BY d.nome
  `).bind(type, user.regional_id, ...(user.perfil === 'GD' ? [user.distrital_id] : [])).all()

  const districts = configured.results || []
  if (!districts.length) {
    return badRequest(user.perfil === 'GD'
      ? 'Cadastre primeiro seu login e senha do Bússola e Mercado Farma.'
      : 'Nenhum GD configurou ainda o acesso do Bússola e Mercado Farma.')
  }

  const active = await env.DB.prepare(`
    SELECT distrital_id
      FROM comandos_automacao
     WHERE regional_id = ? AND tipo = ? AND status IN ('aguardando', 'executando')
  `).bind(user.regional_id, type).all()
  const activeIds = new Set((active.results || []).map((item) => Number(item.distrital_id || 0)))
  const targets = districts.filter((item) => !activeIds.has(Number(item.id)))
  if (!targets.length) return json({ erro: 'As extrações selecionadas já estão aguardando ou em execução.' }, 409)

  const now = new Date().toISOString()
  await env.DB.batch(targets.map((district) => commandStatement(env, user, type, Number(district.id), {
    regional_id: Number(user.regional_id),
    distrital_id: Number(district.id),
    distrital_codigo: district.codigo,
    credencial_tipo: type,
  }, now)))

  const totalDistricts = await env.DB.prepare(`
    SELECT COUNT(*) AS total FROM distritais WHERE regional_id = ? AND ativo = 1
  `).bind(user.regional_id).first()
  const total = Number(totalDistricts?.total || 0)
  const missing = Math.max(total - districts.length, 0)

  return json({
    sucesso: true,
    status: 'aguardando',
    quantidade: targets.length,
    distritais_configuradas: districts.length,
    distritais_pendentes: missing,
    mensagem: user.perfil === 'GD'
      ? 'Extração da sua Distrital registrada na fila.'
      : `${targets.length} extração(ões) registrada(s). ${missing} Distrital(is) ainda sem acesso configurado.`,
  }, 202)
}
