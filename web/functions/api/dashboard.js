import { forbidden, getSession, json, unauthorized } from './_lib/security.js'

async function sumResults(env, regionalId, districtId, consultantId) {
  const competenceRow = await env.DB.prepare(`
    SELECT MAX(competencia) AS competencia
      FROM resultados
     WHERE regional_id = ?
  `).bind(regionalId).first()
  const competence = competenceRow?.competencia || null
  const where = ['regional_id = ?']
  const params = [regionalId]
  if (competence) { where.push('competencia = ?'); params.push(competence) }
  if (districtId) { where.push('distrital_id = ?'); params.push(districtId) }
  if (consultantId) { where.push('consultor_id = ?'); params.push(consultantId) }

  const row = await env.DB.prepare(`
    SELECT
      COALESCE(SUM(ol_total_faturado), 0) AS ol_total_faturado,
      COALESCE(SUM(ol_sem_combate), 0) AS ol_sem_combate,
      COALESCE(SUM(ol_combate), 0) AS ol_combate,
      COALESCE(SUM(ol_prioritarios), 0) AS ol_prioritarios,
      COALESCE(SUM(ol_lancamentos), 0) AS ol_lancamentos,
      COALESCE(SUM(meta_ol_sem_combate), 0) AS meta_ol_sem_combate,
      COALESCE(SUM(meta_ol_prioritarios), 0) AS meta_ol_prioritarios,
      COALESCE(SUM(meta_ol_lancamentos), 0) AS meta_ol_lancamentos,
      COALESCE(SUM(clientes_com_venda), 0) AS clientes_com_venda,
      COALESCE(SUM(clientes_sem_venda), 0) AS clientes_sem_venda,
      COALESCE(SUM(pedidos_nao_faturados), 0) AS pedidos_nao_faturados,
      COALESCE(SUM(valor_nao_faturado), 0) AS valor_nao_faturado,
      MAX(atualizado_em) AS atualizado_em
    FROM resultados
    WHERE ${where.join(' AND ')}
  `).bind(...params).first()

  return { ...row, competencia_resultado: competence }
}

async function directGoals(env, regionalId, competence, level, districtId, consultantId) {
  const where = ['regional_id = ?', 'competencia = ?', 'nivel = ?']
  const params = [regionalId, competence, level]
  if (districtId) { where.push('distrital_id = ?'); params.push(districtId) }
  if (consultantId) { where.push('consultor_id = ?'); params.push(consultantId) }
  return env.DB.prepare(`
    SELECT COUNT(*) AS total_linhas,
           COALESCE(SUM(meta_ol_sem_combate), 0) AS meta_ol_sem_combate,
           COALESCE(SUM(meta_ol_prioritarios), 0) AS meta_ol_prioritarios,
           COALESCE(SUM(meta_ol_lancamentos), 0) AS meta_ol_lancamentos,
           COALESCE(SUM(meta_demanda_sem_combate), 0) AS meta_demanda_sem_combate,
           MAX(importado_em) AS metas_atualizadas_em
      FROM metas_sellout
     WHERE ${where.join(' AND ')}
  `).bind(...params).first()
}

async function consultantFallbackGoals(env, regionalId, competence, districtId) {
  return env.DB.prepare(`
    SELECT COUNT(*) AS total_linhas,
           COALESCE(SUM(m.meta_ol_sem_combate), 0) AS meta_ol_sem_combate,
           COALESCE(SUM(m.meta_ol_prioritarios), 0) AS meta_ol_prioritarios,
           COALESCE(SUM(m.meta_ol_lancamentos), 0) AS meta_ol_lancamentos,
           COALESCE(SUM(m.meta_demanda_sem_combate), 0) AS meta_demanda_sem_combate,
           MAX(m.importado_em) AS metas_atualizadas_em
      FROM metas_sellout m
      JOIN consultores c ON c.id = m.consultor_id
     WHERE m.regional_id = ? AND m.competencia = ? AND m.nivel = 'CONSULTOR'
       AND c.distrital_id = ?
  `).bind(regionalId, competence, districtId).first()
}

async function goalsForScope(env, regionalId, districtId, consultantId) {
  const competenceRow = await env.DB.prepare(`
    SELECT MAX(competencia) AS competencia
      FROM metas_sellout
     WHERE regional_id = ?
  `).bind(regionalId).first()
  const competence = competenceRow?.competencia || null
  if (!competence) return null

  if (consultantId) {
    const goals = await directGoals(env, regionalId, competence, 'CONSULTOR', null, consultantId)
    return Number(goals?.total_linhas || 0) ? { ...goals, competencia_meta: competence } : null
  }

  if (districtId) {
    const direct = await directGoals(env, regionalId, competence, 'GD', districtId, null)
    if (Number(direct?.total_linhas || 0)) return { ...direct, competencia_meta: competence }
    const fallback = await consultantFallbackGoals(env, regionalId, competence, districtId)
    return Number(fallback?.total_linhas || 0) ? { ...fallback, competencia_meta: competence } : null
  }

  const regional = await directGoals(env, regionalId, competence, 'GR', null, null)
  if (Number(regional?.total_linhas || 0)) return { ...regional, competencia_meta: competence }
  const districts = await directGoals(env, regionalId, competence, 'GD', null, null)
  if (Number(districts?.total_linhas || 0)) return { ...districts, competencia_meta: competence }
  const consultants = await directGoals(env, regionalId, competence, 'CONSULTOR', null, null)
  return Number(consultants?.total_linhas || 0) ? { ...consultants, competencia_meta: competence } : null
}

export async function onRequestGet({ request, env }) {
  const user = await getSession(request, env)
  if (!user) return unauthorized('Sessão expirada. Entre novamente.')
  if (user.perfil === 'DESENVOLVEDOR') return forbidden('Selecione uma Regional para consultar o painel.')

  const url = new URL(request.url)
  let districtId = Number(url.searchParams.get('distrital_id')) || null
  let consultantId = Number(url.searchParams.get('consultor_id')) || null
  if (user.perfil === 'GD') districtId = Number(user.distrital_id || 0) || null
  if (user.perfil === 'CONSULTOR') {
    districtId = Number(user.distrital_id || 0) || null
    consultantId = Number(user.consultor_id || 0) || null
  }

  if (districtId) {
    const allowed = await env.DB.prepare(`
      SELECT id FROM distritais WHERE id = ? AND regional_id = ? AND ativo = 1
    `).bind(districtId, user.regional_id).first()
    if (!allowed) return forbidden('Distrital inválida para esta Regional.')
  }
  if (consultantId) {
    const allowed = await env.DB.prepare(`
      SELECT c.id
        FROM consultores c
        JOIN distritais d ON d.id = c.distrital_id
       WHERE c.id = ? AND d.regional_id = ? AND c.ativo = 1
    `).bind(consultantId, user.regional_id).first()
    if (!allowed) return forbidden('Consultor inválido para esta Regional.')
  }

  const [result, goals] = await Promise.all([
    sumResults(env, user.regional_id, districtId, consultantId),
    goalsForScope(env, user.regional_id, districtId, consultantId),
  ])

  let scope = 'Resultado Regional consolidado'
  if (districtId) {
    const district = await env.DB.prepare('SELECT nome FROM distritais WHERE id = ?').bind(districtId).first()
    scope = district?.nome || 'Resultado Distrital'
  }
  if (consultantId) {
    const consultant = await env.DB.prepare('SELECT nome FROM consultores WHERE id = ?').bind(consultantId).first()
    scope = consultant?.nome || 'Resultado do Consultor'
  }

  return json({
    escopo: scope,
    ...result,
    ...(goals ? {
      meta_ol_sem_combate: Number(goals.meta_ol_sem_combate || 0),
      meta_ol_prioritarios: Number(goals.meta_ol_prioritarios || 0),
      meta_ol_lancamentos: Number(goals.meta_ol_lancamentos || 0),
      meta_demanda_sem_combate: Number(goals.meta_demanda_sem_combate || 0),
      competencia_meta: goals.competencia_meta,
      metas_atualizadas_em: goals.metas_atualizadas_em || '',
    } : {}),
    atualizado_em: result.atualizado_em || '',
  })
}
