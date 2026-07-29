const ORIGEM = 'ESTRUTURA_PESSOAS'
const text = (value) => String(value ?? '').trim()
const normalizeName = (value) => text(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleUpperCase('pt-BR')
  .replace(/^REGIONAL\s+/, '')
  .replace(/\s+/g, ' ')
  .trim()

export async function repararHierarquiaImportada(env) {
  const regionaisResult = await env.DB.prepare(`
    SELECT id, nome, setor, ativo
      FROM regionais
     WHERE origem = ? AND na_base_atual = 1
     ORDER BY id
  `).bind(ORIGEM).all()

  const resumo = {
    regionais: 0,
    gerentes_regionais: 0,
    distritais_falsas_removidas: 0,
    gerentes_distritais: 0,
    consultores: 0,
    avisos: [],
  }

  for (const regional of regionaisResult.results || []) {
    resumo.regionais += 1
    const regionalId = Number(regional.id)
    const regionalSector = text(regional.setor)
    const regionalName = normalizeName(regional.nome)
    const active = Number(regional.ativo || 0) === 1 ? 1 : 0

    const usersResult = await env.DB.prepare(`
      SELECT id, nome, email, login_rede, setor, perfil, distrital_id, consultor_id, ativo
        FROM usuarios
       WHERE regional_id = ?
         AND origem = ?
       ORDER BY id
    `).bind(regionalId, ORIGEM).all()
    const users = usersResult.results || []

    let gerenteRegional = users.find((item) => text(item.setor) === regionalSector)
    if (!gerenteRegional) {
      gerenteRegional = users.find((item) => normalizeName(item.nome) === regionalName)
    }

    if (gerenteRegional) {
      await env.DB.prepare(`
        UPDATE usuarios
           SET perfil = 'RG',
               distrital_id = NULL,
               consultor_id = NULL,
               setor = ?,
               ativo = ?,
               na_base_atual = 1,
               atualizado_em = datetime('now')
         WHERE id = ?
      `).bind(regionalSector, active, gerenteRegional.id).run()
      resumo.gerentes_regionais += 1
    } else {
      resumo.avisos.push(`GR não localizado para ${regional.nome} — setor ${regionalSector}.`)
    }

    const districtsResult = await env.DB.prepare(`
      SELECT id, nome, gerente_nome, codigo, login_rede, na_base_atual
        FROM distritais
       WHERE regional_id = ? AND origem = ?
       ORDER BY id
    `).bind(regionalId, ORIGEM).all()

    const falseDistrictIds = []
    const validDistricts = []
    for (const district of districtsResult.results || []) {
      const sameSector = text(district.codigo) === regionalSector
      const sameName = normalizeName(district.nome) === regionalName
        || normalizeName(district.gerente_nome) === regionalName
      if (sameSector || sameName) falseDistrictIds.push(Number(district.id))
      else if (Number(district.na_base_atual || 0) === 1) validDistricts.push(district)
    }

    for (const districtId of falseDistrictIds) {
      await env.DB.batch([
        env.DB.prepare(`
          UPDATE consultores
             SET ativo = 0, na_base_atual = 0, atualizado_em = datetime('now')
           WHERE distrital_id = ? AND origem = ?
        `).bind(districtId, ORIGEM),
        env.DB.prepare(`
          UPDATE usuarios
             SET ativo = 0, na_base_atual = 0, atualizado_em = datetime('now')
           WHERE regional_id = ?
             AND distrital_id = ?
             AND origem = ?
             AND id <> COALESCE(?, -1)
        `).bind(regionalId, districtId, ORIGEM, gerenteRegional?.id || null),
        env.DB.prepare(`
          UPDATE distritais
             SET ativo = 0, na_base_atual = 0, atualizado_em = datetime('now')
           WHERE id = ?
        `).bind(districtId),
      ])
      resumo.distritais_falsas_removidas += 1
    }

    for (const district of validDistricts) {
      const districtId = Number(district.id)
      const districtSector = text(district.codigo)
      await env.DB.prepare(`
        UPDATE distritais
           SET ativo = ?, na_base_atual = 1, atualizado_em = datetime('now')
         WHERE id = ?
      `).bind(active, districtId).run()

      const manager = users.find((item) => text(item.setor) === districtSector && Number(item.id) !== Number(gerenteRegional?.id || 0))
      if (manager) {
        await env.DB.prepare(`
          UPDATE usuarios
             SET perfil = 'GD',
                 distrital_id = ?,
                 consultor_id = NULL,
                 ativo = ?,
                 na_base_atual = 1,
                 atualizado_em = datetime('now')
           WHERE id = ?
        `).bind(districtId, active, manager.id).run()
        resumo.gerentes_distritais += 1
      } else {
        resumo.avisos.push(`GD não localizado para o setor ${districtSector} da ${regional.nome}.`)
      }

      const consultantsResult = await env.DB.prepare(`
        SELECT id, codigo
          FROM consultores
         WHERE distrital_id = ?
           AND origem = ?
           AND na_base_atual = 1
      `).bind(districtId, ORIGEM).all()

      for (const consultant of consultantsResult.results || []) {
        const consultantUser = users.find((item) => text(item.setor) === text(consultant.codigo)
          && Number(item.id) !== Number(gerenteRegional?.id || 0)
          && Number(item.id) !== Number(manager?.id || 0))
        if (!consultantUser) continue
        await env.DB.prepare(`
          UPDATE usuarios
             SET perfil = 'CONSULTOR',
                 distrital_id = ?,
                 consultor_id = ?,
                 ativo = ?,
                 na_base_atual = 1,
                 atualizado_em = datetime('now')
           WHERE id = ?
        `).bind(districtId, consultant.id, active, consultantUser.id).run()
        resumo.consultores += 1
      }
    }
  }

  await env.DB.prepare(`
    DELETE FROM sessoes_acesso
     WHERE tipo_usuario = 'USUARIO'
       AND usuario_id IN (
         SELECT id FROM usuarios WHERE origem = ?
       )
  `).bind(ORIGEM).run()

  return resumo
}
