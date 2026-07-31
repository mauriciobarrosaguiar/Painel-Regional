import { forbidden, getSession, json, unauthorized } from './_lib/security.js'

const WIDTH = 2400
const HEIGHT = 1350
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

const number = value => Number(value || 0)
const text = value => String(value ?? '').trim()
const ratio = (value, goal) => number(goal) > 0 ? number(value) / number(goal) * 100 : 0
const safe = value => text(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .toLowerCase() || 'relatorio'
const esc = value => String(value ?? '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;')
const truncate = (value, max) => {
  const source = text(value)
  return source.length > max ? `${source.slice(0, Math.max(1, max - 1))}…` : source
}
const competenceLabel = value => /^\d{4}-\d{2}$/.test(text(value))
  ? `${text(value).slice(5, 7)}/${text(value).slice(0, 4)}`
  : text(value)
const generatedLabel = () => new Date().toLocaleString('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  dateStyle: 'short',
  timeStyle: 'short',
})
const statusFill = value => value >= 100 ? '#dcfce7' : value >= 80 ? '#fef3c7' : '#fee2e2'
const statusColor = value => value >= 100 ? '#157047' : value >= 80 ? '#9a5d08' : '#b91c1c'

function rect(x, y, width, height, fill, radius = 0, stroke = 'none', strokeWidth = 1) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
}

function svgText(x, y, value, options = {}) {
  const { size = 30, fill = '#243449', weight = 400, anchor = 'start' } = options
  return `<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="middle">${esc(value)}</text>`
}

function pageShell(title, subtitle, content, footer) {
  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    ${rect(0, 0, WIDTH, HEIGHT, '#f4f7fb')}
    ${rect(0, 0, WIDTH, 18, '#2563eb')}
    ${rect(55, 45, 72, 72, '#0f2f55', 18)}
    ${svgText(91, 82, 'R', { size: 38, fill: '#ffffff', weight: 900, anchor: 'middle' })}
    ${svgText(150, 65, title, { size: 46, fill: '#17233b', weight: 900 })}
    ${svgText(150, 108, subtitle, { size: 23, fill: '#627286', weight: 500 })}
    ${content}
    ${svgText(55, 1318, `Painel Regional · ${footer}`, { size: 18, fill: '#748294' })}
  </svg>`
}

function summaryCards(items, y = 165) {
  const gap = 18
  const available = WIDTH - 110
  const width = (available - gap * (items.length - 1)) / items.length
  return items.map((item, index) => {
    const x = 55 + index * (width + gap)
    return [
      rect(x, y, width, 150, '#ffffff', 18, '#d9e2e8', 2),
      svgText(x + 22, y + 36, String(item.label).toUpperCase(), { size: 19, fill: '#627286', weight: 800 }),
      svgText(x + 22, y + 87, item.value, { size: 31, fill: item.color || '#0f2f55', weight: 900 }),
      svgText(x + 22, y + 124, item.note || '', { size: 17, fill: '#748294' }),
    ].join('')
  }).join('')
}

function tableSvg({ rows, y = 350 }) {
  const widths = [410, 145, 210, 185, 185, 120, 185, 185, 120, 185, 185, 120]
  const headers = ['NOME', 'SETOR', 'OL TOTAL', 'META SC', 'REAL SC', '% SC', 'META P', 'REAL P', '% P', 'META L', 'REAL L', '% L']
  const alignments = ['left', 'center', 'right', 'right', 'right', 'center', 'right', 'right', 'center', 'right', 'right', 'center']
  const headerHeight = 78
  const rowHeight = 72
  let output = ''
  let currentX = 55

  headers.forEach((header, index) => {
    output += rect(currentX, y, widths[index], headerHeight, '#0f2f55', 0, '#ffffff', 2)
    output += svgText(currentX + (alignments[index] === 'left' ? 14 : widths[index] / 2), y + headerHeight / 2, header, {
      size: 18,
      fill: '#ffffff',
      weight: 900,
      anchor: alignments[index] === 'left' ? 'start' : 'middle',
    })
    currentX += widths[index]
  })

  rows.forEach((row, rowIndex) => {
    currentX = 55
    row.forEach((cell, columnIndex) => {
      const percentColumn = [5, 8, 11].includes(columnIndex)
      const percentageValue = percentColumn ? number(String(cell).replace('%', '').replace(',', '.')) : 0
      const isTotal = row[0] === 'TOTAL'
      const fill = percentColumn
        ? statusFill(percentageValue)
        : isTotal ? '#eaf1ff' : rowIndex % 2 ? '#f7f9fb' : '#ffffff'
      const color = percentColumn ? statusColor(percentageValue) : '#243449'
      output += rect(currentX, y + headerHeight + rowIndex * rowHeight, widths[columnIndex], rowHeight, fill, 0, '#dce4ea', 2)
      const alignment = alignments[columnIndex]
      const textX = alignment === 'left'
        ? currentX + 14
        : alignment === 'center'
          ? currentX + widths[columnIndex] / 2
          : currentX + widths[columnIndex] - 14
      output += svgText(textX, y + headerHeight + rowIndex * rowHeight + rowHeight / 2, cell, {
        size: 19,
        fill: color,
        weight: isTotal || percentColumn ? 900 : 600,
        anchor: alignment === 'left' ? 'start' : alignment === 'center' ? 'middle' : 'end',
      })
      currentX += widths[columnIndex]
    })
  })

  return output
}

async function latestCompetences(env, regionalId) {
  const [result, goals] = await Promise.all([
    env.DB.prepare('SELECT MAX(competencia) AS competencia FROM resultados WHERE regional_id = ?').bind(regionalId).first(),
    env.DB.prepare('SELECT MAX(competencia) AS competencia FROM metas_sellout WHERE regional_id = ?').bind(regionalId).first(),
  ])
  return {
    result: result?.competencia || null,
    goals: goals?.competencia || null,
  }
}

async function sumResults(env, regionalId, competence, districtId, consultantId) {
  const where = ['regional_id = ?']
  const params = [regionalId]
  if (competence) { where.push('competencia = ?'); params.push(competence) }
  if (districtId) { where.push('distrital_id = ?'); params.push(districtId) }
  if (consultantId) { where.push('consultor_id = ?'); params.push(consultantId) }

  return env.DB.prepare(`
    SELECT
      COALESCE(SUM(ol_total_faturado), 0) AS ol_total_faturado,
      COALESCE(SUM(ol_sem_combate), 0) AS ol_sem_combate,
      COALESCE(SUM(ol_combate), 0) AS ol_combate,
      COALESCE(SUM(ol_prioritarios), 0) AS ol_prioritarios,
      COALESCE(SUM(ol_lancamentos), 0) AS ol_lancamentos,
      COALESCE(SUM(clientes_com_venda), 0) AS clientes_com_venda,
      COALESCE(SUM(clientes_sem_venda), 0) AS clientes_sem_venda,
      COALESCE(SUM(pedidos_nao_faturados), 0) AS pedidos_nao_faturados,
      COALESCE(SUM(valor_nao_faturado), 0) AS valor_nao_faturado,
      MAX(atualizado_em) AS atualizado_em
    FROM resultados
    WHERE ${where.join(' AND ')}
  `).bind(...params).first()
}

async function directGoals(env, regionalId, competence, level, districtId, consultantId) {
  if (!competence) return null
  const where = ['regional_id = ?', 'competencia = ?', 'nivel = ?']
  const params = [regionalId, competence, level]
  if (districtId) { where.push('distrital_id = ?'); params.push(districtId) }
  if (consultantId) { where.push('consultor_id = ?'); params.push(consultantId) }
  return env.DB.prepare(`
    SELECT COUNT(*) AS total_linhas,
           COALESCE(SUM(meta_ol_sem_combate), 0) AS meta_ol_sem_combate,
           COALESCE(SUM(meta_ol_prioritarios), 0) AS meta_ol_prioritarios,
           COALESCE(SUM(meta_ol_lancamentos), 0) AS meta_ol_lancamentos,
           COALESCE(SUM(meta_demanda_sem_combate), 0) AS meta_demanda_sem_combate
      FROM metas_sellout
     WHERE ${where.join(' AND ')}
  `).bind(...params).first()
}

async function consultantFallbackGoals(env, regionalId, competence, districtId) {
  if (!competence) return null
  return env.DB.prepare(`
    SELECT COUNT(*) AS total_linhas,
           COALESCE(SUM(m.meta_ol_sem_combate), 0) AS meta_ol_sem_combate,
           COALESCE(SUM(m.meta_ol_prioritarios), 0) AS meta_ol_prioritarios,
           COALESCE(SUM(m.meta_ol_lancamentos), 0) AS meta_ol_lancamentos,
           COALESCE(SUM(m.meta_demanda_sem_combate), 0) AS meta_demanda_sem_combate
      FROM metas_sellout m
      JOIN consultores c ON c.id = m.consultor_id
     WHERE m.regional_id = ? AND m.competencia = ? AND m.nivel = 'CONSULTOR'
       AND c.distrital_id = ?
  `).bind(regionalId, competence, districtId).first()
}

async function goalsForScope(env, regionalId, competence, districtId, consultantId) {
  if (!competence) return null
  if (consultantId) {
    const goals = await directGoals(env, regionalId, competence, 'CONSULTOR', null, consultantId)
    return number(goals?.total_linhas) ? goals : null
  }
  if (districtId) {
    const direct = await directGoals(env, regionalId, competence, 'GD', districtId, null)
    if (number(direct?.total_linhas)) return direct
    const fallback = await consultantFallbackGoals(env, regionalId, competence, districtId)
    return number(fallback?.total_linhas) ? fallback : null
  }
  const regional = await directGoals(env, regionalId, competence, 'GR', null, null)
  if (number(regional?.total_linhas)) return regional
  const districts = await directGoals(env, regionalId, competence, 'GD', null, null)
  if (number(districts?.total_linhas)) return districts
  const consultants = await directGoals(env, regionalId, competence, 'CONSULTOR', null, null)
  return number(consultants?.total_linhas) ? consultants : null
}

async function metricsForScope(env, regionalId, competences, districtId, consultantId) {
  const [result, goals] = await Promise.all([
    sumResults(env, regionalId, competences.result, districtId, consultantId),
    goalsForScope(env, regionalId, competences.goals, districtId, consultantId),
  ])
  return {
    ...result,
    meta_ol_sem_combate: number(goals?.meta_ol_sem_combate),
    meta_ol_prioritarios: number(goals?.meta_ol_prioritarios),
    meta_ol_lancamentos: number(goals?.meta_ol_lancamentos),
    competencia_resultado: competences.result,
    competencia_meta: competences.goals,
  }
}

function rowFromMetrics(item, metrics) {
  return [
    truncate(item.nome, 30),
    item.codigo || '—',
    money.format(number(metrics.ol_total_faturado)),
    money.format(number(metrics.meta_ol_sem_combate)),
    money.format(number(metrics.ol_sem_combate)),
    `${decimal.format(ratio(metrics.ol_sem_combate, metrics.meta_ol_sem_combate))}%`,
    money.format(number(metrics.meta_ol_prioritarios)),
    money.format(number(metrics.ol_prioritarios)),
    `${decimal.format(ratio(metrics.ol_prioritarios, metrics.meta_ol_prioritarios))}%`,
    money.format(number(metrics.meta_ol_lancamentos)),
    money.format(number(metrics.ol_lancamentos)),
    `${decimal.format(ratio(metrics.ol_lancamentos, metrics.meta_ol_lancamentos))}%`,
  ]
}

function totalRow(metrics) {
  return rowFromMetrics({ nome: 'TOTAL', codigo: '' }, metrics).map((value, index) => index === 0 ? 'TOTAL' : value)
}

function summaryPage(scopeName, metrics, competence, generated) {
  const scResult = ratio(metrics.ol_sem_combate, metrics.meta_ol_sem_combate)
  const priorityResult = ratio(metrics.ol_prioritarios, metrics.meta_ol_prioritarios)
  const launchResult = ratio(metrics.ol_lancamentos, metrics.meta_ol_lancamentos)
  const clients = number(metrics.clientes_com_venda) + number(metrics.clientes_sem_venda)
  const content = [
    summaryCards([
      { label: 'OL total faturado', value: money.format(number(metrics.ol_total_faturado)), note: 'Resultado consolidado' },
      { label: 'OL sem combate', value: money.format(number(metrics.ol_sem_combate)), note: `Meta ${money.format(number(metrics.meta_ol_sem_combate))} · ${decimal.format(scResult)}%`, color: statusColor(scResult) },
      { label: 'Prioritários', value: money.format(number(metrics.ol_prioritarios)), note: `Meta ${money.format(number(metrics.meta_ol_prioritarios))} · ${decimal.format(priorityResult)}%`, color: statusColor(priorityResult) },
      { label: 'Lançamentos', value: money.format(number(metrics.ol_lancamentos)), note: `Meta ${money.format(number(metrics.meta_ol_lancamentos))} · ${decimal.format(launchResult)}%`, color: statusColor(launchResult) },
    ]),
    summaryCards([
      { label: 'Clientes com venda', value: integer.format(number(metrics.clientes_com_venda)), note: `${integer.format(clients)} clientes na carteira` },
      { label: 'Clientes sem venda', value: integer.format(number(metrics.clientes_sem_venda)), note: 'Oportunidades da carteira' },
      { label: 'Não faturados', value: money.format(number(metrics.valor_nao_faturado)), note: `${integer.format(number(metrics.pedidos_nao_faturados))} pedidos/notas` },
      { label: 'OL combate', value: money.format(number(metrics.ol_combate)), note: 'Resultado de combate' },
    ], 350),
    rect(55, 555, WIDTH - 110, 545, '#ffffff', 24, '#d9e2e8', 2),
    svgText(90, 610, 'Resumo do resultado', { size: 31, fill: '#17233b', weight: 900 }),
    svgText(90, 675, `Escopo: ${scopeName}`, { size: 24, fill: '#475569', weight: 700 }),
    svgText(90, 730, `Competência dos resultados: ${competenceLabel(metrics.competencia_resultado) || 'não informada'}`, { size: 23, fill: '#627286' }),
    svgText(90, 780, `Competência das metas: ${competenceLabel(metrics.competencia_meta) || 'não informada'}`, { size: 23, fill: '#627286' }),
    svgText(90, 850, `Atualizado em: ${text(metrics.atualizado_em) || 'aguardando extração do Bússola'}`, { size: 23, fill: '#627286' }),
    svgText(90, 930, 'O arquivo ZIP contém imagens PNG em alta resolução, prontas para compartilhar.', { size: 24, fill: '#2563eb', weight: 800 }),
  ].join('')
  return {
    name: '01-resumo.png',
    width: WIDTH,
    height: HEIGHT,
    svg: pageShell('Painel Regional', `${scopeName} · ${competence ? `Metas ${competenceLabel(competence)}` : 'resultado atual'}`, content, `Gerado em ${generated}`),
  }
}

function rankingPages(title, subtitle, items, total, generated, filePrefix) {
  const maxRows = 11
  const chunks = items.length
    ? Array.from({ length: Math.ceil(items.length / maxRows) }, (_, index) => items.slice(index * maxRows, (index + 1) * maxRows))
    : [[]]

  return chunks.map((chunk, pageIndex) => {
    const rows = chunk.map(item => rowFromMetrics(item, item.metrics))
    if (pageIndex === chunks.length - 1) rows.push(totalRow(total))
    const content = [
      summaryCards([
        { label: 'Itens no relatório', value: integer.format(items.length), note: subtitle },
        { label: 'OL sem combate', value: money.format(number(total.ol_sem_combate)), note: `Meta ${money.format(number(total.meta_ol_sem_combate))}` },
        { label: 'Prioritários', value: money.format(number(total.ol_prioritarios)), note: `Meta ${money.format(number(total.meta_ol_prioritarios))}` },
        { label: 'Lançamentos', value: money.format(number(total.ol_lancamentos)), note: `Meta ${money.format(number(total.meta_ol_lancamentos))}` },
      ], 150),
      tableSvg({ rows, y: 330 }),
    ].join('')
    const suffix = chunks.length > 1 ? ` · Página ${pageIndex + 1}/${chunks.length}` : ''
    return {
      name: `${String(pageIndex + 2).padStart(2, '0')}-${filePrefix}-${pageIndex + 1}.png`,
      width: WIDTH,
      height: HEIGHT,
      svg: pageShell(title, `${subtitle}${suffix}`, content, `Gerado em ${generated}`),
    }
  })
}

async function validateScope(env, user, requestedDistrictId, requestedConsultantId) {
  let districtId = requestedDistrictId
  let consultantId = requestedConsultantId

  if (user.perfil === 'GD') {
    districtId = number(user.distrital_id) || null
    consultantId = null
  }
  if (user.perfil === 'CONSULTOR') {
    districtId = number(user.distrital_id) || null
    consultantId = number(user.consultor_id) || null
  }

  let district = null
  let consultant = null
  if (districtId) {
    district = await env.DB.prepare(`
      SELECT id, nome, codigo, gerente_nome
        FROM distritais
       WHERE id = ? AND regional_id = ? AND ativo = 1
    `).bind(districtId, user.regional_id).first()
    if (!district) throw new Error('Distrital inválida para esta Regional.')
  }
  if (consultantId) {
    consultant = await env.DB.prepare(`
      SELECT c.id, c.nome, c.codigo, c.distrital_id
        FROM consultores c
        JOIN distritais d ON d.id = c.distrital_id
       WHERE c.id = ? AND d.regional_id = ? AND c.ativo = 1
    `).bind(consultantId, user.regional_id).first()
    if (!consultant) throw new Error('Consultor inválido para esta Regional.')
    if (districtId && number(consultant.distrital_id) !== number(districtId)) throw new Error('O Consultor não pertence à Distrital informada.')
    districtId = number(consultant.distrital_id)
  }

  return { districtId, consultantId, district, consultant }
}

export async function onRequestGet({ request, env }) {
  const user = await getSession(request, env)
  if (!user) return unauthorized('Sessão expirada. Entre novamente.')
  if (user.perfil === 'DESENVOLVEDOR') return forbidden('Acesse uma Regional para gerar as imagens.')

  try {
    const url = new URL(request.url)
    const requestedDistrictId = number(url.searchParams.get('distrital_id')) || null
    const requestedConsultantId = number(url.searchParams.get('consultor_id')) || null
    const scope = await validateScope(env, user, requestedDistrictId, requestedConsultantId)
    const competences = await latestCompetences(env, user.regional_id)
    const metrics = await metricsForScope(env, user.regional_id, competences, scope.districtId, scope.consultantId)
    const generated = generatedLabel()
    const regional = await env.DB.prepare('SELECT nome, setor FROM regionais WHERE id = ?').bind(user.regional_id).first()

    let scopeName = regional?.nome || user.regional_nome || 'Resultado Regional'
    if (scope.district) scopeName = scope.district.nome
    if (scope.consultant) scopeName = scope.consultant.nome

    const pages = [summaryPage(scopeName, metrics, competences.goals, generated)]

    if (!scope.consultantId) {
      if (scope.districtId) {
        const source = await env.DB.prepare(`
          SELECT id, nome, codigo
            FROM consultores
           WHERE distrital_id = ? AND ativo = 1
           ORDER BY nome COLLATE NOCASE
        `).bind(scope.districtId).all()
        const items = []
        for (const item of source.results || []) {
          items.push({
            ...item,
            metrics: await metricsForScope(env, user.regional_id, competences, scope.districtId, item.id),
          })
        }
        pages.push(...rankingPages('Resultado dos Consultores', scopeName, items, metrics, generated, 'consultores'))
      } else {
        const source = await env.DB.prepare(`
          SELECT id, nome, codigo
            FROM distritais
           WHERE regional_id = ? AND ativo = 1
           ORDER BY nome COLLATE NOCASE
        `).bind(user.regional_id).all()
        const items = []
        for (const item of source.results || []) {
          items.push({
            ...item,
            metrics: await metricsForScope(env, user.regional_id, competences, item.id, null),
          })
        }
        pages.push(...rankingPages('Resultado das Distritais', scopeName, items, metrics, generated, 'distritais'))
      }
    }

    const competence = competences.goals || competences.result || new Date().toISOString().slice(0, 7)
    return json({
      filename: `painel-regional-${safe(scopeName)}-${competence}.zip`,
      pages,
    })
  } catch (error) {
    return json({
      erro: error instanceof Error ? error.message : 'Não foi possível gerar as imagens do painel.',
    }, 400)
  }
}
