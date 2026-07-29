const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})

export async function onRequestPost({ request, env }) {
  const provided = request.headers.get('x-admin-key') || ''
  if (!env.PAINEL_ADMIN_KEY || provided !== env.PAINEL_ADMIN_KEY) return json({ erro: 'Acesso interno negado.' }, 401)

  let data = {}
  try { data = await request.json() } catch { /* corpo vazio */ }
  const action = String(data.acao || '').trim().toLowerCase()

  if (action === 'buscar') {
    const type = String(data.tipo || '').trim().toUpperCase()
    const params = []
    let filter = "status = 'aguardando'"
    if (['BUSSOLA', 'MERCADO_FARMA'].includes(type)) { filter += ' AND tipo = ?'; params.push(type) }
    const command = await env.DB.prepare(`
      SELECT id, regional_id, tipo, parametros_json, solicitado_por, solicitado_em
        FROM comandos_automacao
       WHERE ${filter}
       ORDER BY solicitado_em
       LIMIT 1
    `).bind(...params).first()
    if (!command) return json({ comando: null })

    const now = new Date().toISOString()
    await env.DB.prepare(`
      UPDATE comandos_automacao
         SET status = 'executando', iniciado_em = ?, atualizado_em = ?, mensagem = ?
       WHERE id = ? AND status = 'aguardando'
    `).bind(now, now, 'Processador regional iniciou a extração.', command.id).run()
    return json({ comando: { ...command, status: 'executando' } })
  }

  if (action === 'finalizar') {
    const id = String(data.id || '').trim()
    const status = String(data.status || '').trim().toLowerCase()
    if (!id || !['concluido', 'erro'].includes(status)) return json({ erro: 'Comando ou status inválido.' }, 400)
    const command = await env.DB.prepare(`SELECT regional_id, tipo FROM comandos_automacao WHERE id = ?`).bind(id).first()
    if (!command) return json({ erro: 'Comando não encontrado.' }, 404)
    const now = new Date().toISOString()
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE comandos_automacao
           SET status = ?, mensagem = ?, erro = ?, finalizado_em = ?, atualizado_em = ?
         WHERE id = ?
      `).bind(status, String(data.mensagem || ''), String(data.erro || ''), now, now, id),
      env.DB.prepare(`
        INSERT INTO extracoes
          (id, regional_id, tipo, status, total_registros, mensagem, erro, iniciado_em, finalizado_em, criado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        `ext-${crypto.randomUUID()}`, command.regional_id, command.tipo, status,
        Number(data.total_registros || 0), String(data.mensagem || ''), String(data.erro || ''),
        String(data.iniciado_em || now), now, now,
      ),
    ])
    return json({ sucesso: true })
  }

  return json({ erro: 'Ação interna inválida.' }, 400)
}
