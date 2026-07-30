import { json } from './_lib/security.js'
import { requireManager } from './_lib/manager.js'

export async function onRequestGet({ request, env }) {
  const { denial, user } = await requireManager(request, env)
  if (denial) return denial

  const districtFilter = user.perfil === 'GD' ? ' AND source.distrital_id = ?' : ''
  const commandParams = [user.regional_id]
  const extractionParams = [user.regional_id]
  if (user.perfil === 'GD') {
    commandParams.push(user.distrital_id)
    extractionParams.push(user.distrital_id)
  }

  const [commands, extractions, credentials] = await env.DB.batch([
    env.DB.prepare(`
      SELECT source.id, source.tipo, source.status, source.mensagem, source.erro,
             source.distrital_id, d.nome AS distrital_nome, d.codigo AS distrital_codigo,
             source.solicitado_em, source.iniciado_em, source.finalizado_em
        FROM comandos_automacao source
        LEFT JOIN distritais d ON d.id = source.distrital_id
       WHERE source.regional_id = ?${districtFilter}
       ORDER BY source.solicitado_em DESC
       LIMIT 60
    `).bind(...commandParams),
    env.DB.prepare(`
      SELECT source.id, source.tipo, source.status, source.total_registros, source.mensagem, source.erro,
             source.distrital_id, d.nome AS distrital_nome, d.codigo AS distrital_codigo,
             source.iniciado_em, source.finalizado_em, source.criado_em
        FROM extracoes source
        LEFT JOIN distritais d ON d.id = source.distrital_id
       WHERE source.regional_id = ?${districtFilter}
       ORDER BY source.criado_em DESC
       LIMIT 60
    `).bind(...extractionParams),
    env.DB.prepare(`
      SELECT d.id, d.nome, d.codigo, d.gerente_nome,
             MAX(CASE WHEN c.status = 'CONFIGURADA' THEN 1 ELSE 0 END) AS configurada,
             MAX(c.usuario_mascarado) AS usuario_mascarado,
             MAX(c.atualizado_em) AS atualizado_em
        FROM distritais d
        LEFT JOIN credenciais_distritais c
          ON c.distrital_id = d.id AND c.regional_id = d.regional_id
       WHERE d.regional_id = ? AND d.ativo = 1${user.perfil === 'GD' ? ' AND d.id = ?' : ''}
       GROUP BY d.id, d.nome, d.codigo, d.gerente_nome
       ORDER BY d.nome
    `).bind(user.regional_id, ...(user.perfil === 'GD' ? [user.distrital_id] : [])),
  ])

  const districtStatuses = (credentials.results || []).map((item) => ({
    id: Number(item.id),
    nome: item.nome,
    codigo: item.codigo,
    gerente_nome: item.gerente_nome || '',
    configurada: Number(item.configurada || 0) > 0,
    usuario_mascarado: item.usuario_mascarado || '',
    atualizado_em: item.atualizado_em || null,
  }))
  const configured = districtStatuses.filter((item) => item.configurada).length
  const own = user.perfil === 'GD' ? districtStatuses[0] || null : null
  const sharedCredential = own?.configurada ? {
    tipo: 'COMPARTILHADA',
    status: 'CONFIGURADA',
    usuario_mascarado: own.usuario_mascarado,
    atualizado_em: own.atualizado_em,
  } : null
  const active = (commands.results || []).filter((item) => ['aguardando', 'executando'].includes(String(item.status).toLowerCase())).length

  return json({
    modo: user.perfil,
    comandos: commands.results || [],
    extracoes: extractions.results || [],
    em_execucao: active,
    credencial_configurada: user.perfil === 'GD'
      ? Boolean(sharedCredential)
      : districtStatuses.length > 0 && configured === districtStatuses.length,
    credenciais: {
      integracao: sharedCredential,
      bussola: sharedCredential,
      mercado_farma: sharedCredential,
    },
    distritais: districtStatuses,
    resumo_credenciais: {
      total: districtStatuses.length,
      configuradas: configured,
      pendentes: Math.max(districtStatuses.length - configured, 0),
      completa: districtStatuses.length > 0 && configured === districtStatuses.length,
    },
    atualizado_em: new Date().toISOString(),
  })
}
