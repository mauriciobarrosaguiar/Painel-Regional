import {
  badRequest,
  encryptCredentials,
  hashImportedPassword,
  json,
  maskEmail,
  readBody,
  requireDeveloper,
} from '../_lib/security.js'

const ORIGEM = 'ESTRUTURA_PESSOAS'
const text = (value) => String(value ?? '').trim()
const upper = (value) => text(value).toLocaleUpperCase('pt-BR')
const validSector = (value) => /^\d{8}$/.test(text(value))
const activeRow = (row) => upper(row.situacao) === 'ATIVO'
const isConsultant = (row) => {
  const cargo = upper(row.cargo)
  return cargo.includes('CONSULTOR') || cargo.includes('REPRESENTANTE')
}

function normalizeLogin(value) {
  const login = text(value).toLowerCase()
  if (!login || login === '-' || login === 'vago') return ''
  return login.includes('@') ? login : `${login}@ems.com.br`
}

function slugFor(sector, name) {
  const base = upper(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `regional-${sector}-${base}`.slice(0, 90)
}

async function batches(env, statements, size = 40) {
  for (let index = 0; index < statements.length; index += size) {
    await env.DB.batch(statements.slice(index, index + size))
  }
}

function putAccess(map, access) {
  const key = `${access.setor_gr}|${access.login}`
  const current = map.get(key)
  if (!current || access.priority > current.priority) map.set(key, access)
}

export async function onRequestPost({ request, env }) {
  const { denial, user: developer } = await requireDeveloper(request, env)
  if (denial) return denial

  try {
    const data = await readBody(request)
    const rows = Array.isArray(data.linhas) ? data.linhas : []
    const fileName = text(data.nome_arquivo) || 'Estrutura de Pessoas.xlsx'
    const sheetName = text(data.nome_planilha) || 'Mês Atual'
    if (!rows.length) return badRequest('A planilha não possui linhas válidas para importar.')
    if (rows.length > 6000) return badRequest('A planilha ultrapassa o limite de 6.000 linhas.')

    const normalized = rows.map((row, index) => ({
      linha: Number(row.linha || index + 3),
      setor: text(row.setor),
      nome: upper(row.nome),
      cargo: upper(row.cargo),
      situacao: upper(row.situacao),
      email_corporativo: text(row.email_corporativo).toLowerCase(),
      login_rede: normalizeLogin(row.login_rede),
      setor_gd: text(row.setor_gd),
      nome_gd: upper(row.nome_gd),
      setor_gr: text(row.setor_gr),
      nome_gr: upper(row.nome_gr),
    }))

    const validRows = normalized.filter((row) => activeRow(row) && validSector(row.setor))
    if (!validRows.length) return badRequest('Nenhuma pessoa ATIVA com setor válido foi encontrada.')

    const peopleBySector = new Map()
    for (const row of validRows) {
      if (row.nome && row.login_rede) peopleBySector.set(row.setor, row)
    }

    const regionals = new Map()
    const districts = new Map()
    const consultants = new Map()
    const warnings = []

    for (const row of validRows) {
      if (!validSector(row.setor_gr) || !row.nome_gr) continue

      const rgPerson = peopleBySector.get(row.setor_gr)
      if (rgPerson?.login_rede) {
        regionals.set(row.setor_gr, {
          setor: row.setor_gr,
          nome: rgPerson.nome || row.nome_gr,
          login: rgPerson.login_rede,
          cargo: rgPerson.cargo,
        })
      }

      // O setor do próprio GR pode aparecer repetido nas colunas de GD.
      // Ele nunca deve virar uma Distrital nem sobrescrever o perfil RG.
      if (
        validSector(row.setor_gd)
        && row.setor_gd !== row.setor_gr
        && row.nome_gd
      ) {
        const gdPerson = peopleBySector.get(row.setor_gd)
        if (gdPerson?.login_rede) {
          districts.set(`${row.setor_gr}|${row.setor_gd}`, {
            setor_gr: row.setor_gr,
            setor: row.setor_gd,
            nome: gdPerson.nome || row.nome_gd,
            login: gdPerson.login_rede,
            cargo: gdPerson.cargo,
          })
        }
      }
    }

    // Consultores só são vinculados quando existe um GD real, diferente do GR.
    for (const row of validRows) {
      if (
        !validSector(row.setor_gr)
        || !validSector(row.setor_gd)
        || row.setor_gd === row.setor_gr
        || row.setor === row.setor_gr
        || row.setor === row.setor_gd
        || !row.login_rede
        || !row.nome
        || !isConsultant(row)
      ) continue

      const districtKey = `${row.setor_gr}|${row.setor_gd}`
      if (!districts.has(districtKey)) continue

      consultants.set(`${row.setor_gr}|${row.setor_gd}|${row.setor}`, {
        setor_gr: row.setor_gr,
        setor_gd: row.setor_gd,
        setor: row.setor,
        nome: row.nome,
        login: row.login_rede,
        cargo: row.cargo,
        situacao: row.situacao,
      })
    }

    for (const row of validRows) {
      if (validSector(row.setor_gr) && row.nome_gr && !regionals.has(row.setor_gr)) {
        warnings.push(`Linha ${row.linha}: GR ${row.nome_gr} sem login de rede válido no setor ${row.setor_gr}.`)
      }
      if (
        validSector(row.setor_gd)
        && row.setor_gd !== row.setor_gr
        && row.nome_gd
        && !districts.has(`${row.setor_gr}|${row.setor_gd}`)
      ) {
        warnings.push(`Linha ${row.linha}: GD ${row.nome_gd} sem login de rede válido no setor ${row.setor_gd}.`)
      }
    }

    if (!regionals.size) return badRequest('Nenhum Gerente Regional com setor, nome e login de rede válido foi encontrado.')

    const now = new Date().toISOString()
    const existingRegionals = await env.DB.prepare(
      `SELECT id, setor, ativo FROM regionais WHERE origem = ? OR setor IS NOT NULL`,
    ).bind(ORIGEM).all()
    const existingBySector = new Map((existingRegionals.results || []).map((item) => [text(item.setor), item]))

    await env.DB.batch([
      env.DB.prepare(`UPDATE regionais SET na_base_atual = 0 WHERE origem = ?`).bind(ORIGEM),
      env.DB.prepare(`UPDATE distritais SET na_base_atual = 0, ativo = 0 WHERE origem = ?`).bind(ORIGEM),
      env.DB.prepare(`UPDATE consultores SET na_base_atual = 0, ativo = 0 WHERE origem = ?`).bind(ORIGEM),
      env.DB.prepare(`UPDATE usuarios SET na_base_atual = 0, ativo = 0 WHERE origem = ?`).bind(ORIGEM),
    ])

    const regionalStatements = []
    for (const item of regionals.values()) {
      const existing = existingBySector.get(item.setor)
      if (existing) {
        regionalStatements.push(env.DB.prepare(`
          UPDATE regionais
             SET nome = ?, slug = ?, origem = ?, na_base_atual = 1, atualizado_em = ?
           WHERE id = ?
        `).bind(`REGIONAL ${item.nome}`, slugFor(item.setor, item.nome), ORIGEM, now, existing.id))
      } else {
        regionalStatements.push(env.DB.prepare(`
          INSERT INTO regionais
            (nome, slug, ativo, setor, origem, na_base_atual, criado_em, atualizado_em)
          VALUES (?, ?, 0, ?, ?, 1, datetime('now'), ?)
        `).bind(`REGIONAL ${item.nome}`, slugFor(item.setor, item.nome), item.setor, ORIGEM, now))
      }
    }
    await batches(env, regionalStatements)

    const regionalRows = await env.DB.prepare(`
      SELECT id, setor, ativo, nome
        FROM regionais
       WHERE origem = ? AND na_base_atual = 1
    `).bind(ORIGEM).all()
    const regionalBySector = new Map((regionalRows.results || []).map((item) => [text(item.setor), item]))

    const districtStatements = []
    for (const item of districts.values()) {
      const regional = regionalBySector.get(item.setor_gr)
      if (!regional) continue
      const active = Number(regional.ativo || 0) === 1 ? 1 : 0
      districtStatements.push(env.DB.prepare(`
        INSERT INTO distritais
          (regional_id, nome, codigo, gerente_nome, ativo, criado_em, login_rede, origem, na_base_atual, atualizado_em)
        VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, 1, ?)
        ON CONFLICT(regional_id, codigo) DO UPDATE SET
          nome = excluded.nome,
          gerente_nome = excluded.gerente_nome,
          login_rede = excluded.login_rede,
          origem = excluded.origem,
          na_base_atual = 1,
          ativo = excluded.ativo,
          atualizado_em = excluded.atualizado_em
      `).bind(regional.id, item.nome, item.setor, item.nome, active, item.login, ORIGEM, now))
    }
    await batches(env, districtStatements)

    // Limpa qualquer Distrital antiga criada com o mesmo setor do Gerente Regional.
    await env.DB.prepare(`
      UPDATE distritais
         SET ativo = 0, na_base_atual = 0, atualizado_em = ?
       WHERE origem = ?
         AND codigo = (SELECT setor FROM regionais WHERE regionais.id = distritais.regional_id)
    `).bind(now, ORIGEM).run()

    const districtRows = await env.DB.prepare(`
      SELECT d.id, d.regional_id, d.codigo, r.setor AS setor_gr
        FROM distritais d
        JOIN regionais r ON r.id = d.regional_id
       WHERE d.origem = ? AND d.na_base_atual = 1
    `).bind(ORIGEM).all()
    const districtBySector = new Map((districtRows.results || []).map(
      (item) => [`${text(item.setor_gr)}|${text(item.codigo)}`, item],
    ))

    const consultantStatements = []
    for (const item of consultants.values()) {
      const regional = regionalBySector.get(item.setor_gr)
      const district = districtBySector.get(`${item.setor_gr}|${item.setor_gd}`)
      if (!regional || !district) continue
      const active = Number(regional.ativo || 0) === 1 ? 1 : 0
      consultantStatements.push(env.DB.prepare(`
        INSERT INTO consultores
          (distrital_id, nome, codigo, email, ativo, criado_em, login_rede, cargo, situacao, origem, na_base_atual, atualizado_em)
        VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, 1, ?)
        ON CONFLICT(distrital_id, codigo) DO UPDATE SET
          nome = excluded.nome,
          email = excluded.email,
          login_rede = excluded.login_rede,
          cargo = excluded.cargo,
          situacao = excluded.situacao,
          origem = excluded.origem,
          na_base_atual = 1,
          ativo = excluded.ativo,
          atualizado_em = excluded.atualizado_em
      `).bind(
        district.id,
        item.nome,
        item.setor,
        item.login,
        active,
        item.login,
        item.cargo,
        item.situacao,
        ORIGEM,
        now,
      ))
    }
    await batches(env, consultantStatements)

    const consultantRows = await env.DB.prepare(`
      SELECT c.id, c.codigo, d.id AS distrital_id, d.codigo AS setor_gd,
             d.regional_id, r.setor AS setor_gr
        FROM consultores c
        JOIN distritais d ON d.id = c.distrital_id
        JOIN regionais r ON r.id = d.regional_id
       WHERE c.origem = ? AND c.na_base_atual = 1
    `).bind(ORIGEM).all()
    const consultantBySector = new Map((consultantRows.results || []).map(
      (item) => [`${text(item.setor_gr)}|${text(item.setor_gd)}|${text(item.codigo)}`, item],
    ))

    const accesses = new Map()

    for (const item of regionals.values()) {
      const regional = regionalBySector.get(item.setor)
      if (!regional) continue
      putAccess(accesses, {
        priority: 3,
        perfil: 'RG',
        setor_gr: item.setor,
        setor: item.setor,
        nome: item.nome,
        login: item.login,
        regional_id: regional.id,
        distrital_id: null,
        consultor_id: null,
        ativo: Number(regional.ativo || 0) === 1 ? 1 : 0,
      })
    }

    for (const item of districts.values()) {
      const regional = regionalBySector.get(item.setor_gr)
      const district = districtBySector.get(`${item.setor_gr}|${item.setor}`)
      if (!regional || !district) continue
      putAccess(accesses, {
        priority: 2,
        perfil: 'GD',
        setor_gr: item.setor_gr,
        setor: item.setor,
        nome: item.nome,
        login: item.login,
        regional_id: regional.id,
        distrital_id: district.id,
        consultor_id: null,
        ativo: Number(regional.ativo || 0) === 1 ? 1 : 0,
      })
    }

    for (const item of consultants.values()) {
      const regional = regionalBySector.get(item.setor_gr)
      const district = districtBySector.get(`${item.setor_gr}|${item.setor_gd}`)
      const consultant = consultantBySector.get(`${item.setor_gr}|${item.setor_gd}|${item.setor}`)
      if (!regional || !district || !consultant) continue
      putAccess(accesses, {
        priority: 1,
        perfil: 'CONSULTOR',
        setor_gr: item.setor_gr,
        setor: item.setor,
        nome: item.nome,
        login: item.login,
        regional_id: regional.id,
        distrital_id: district.id,
        consultor_id: consultant.id,
        ativo: Number(regional.ativo || 0) === 1 ? 1 : 0,
      })
    }

    const userStatements = []
    for (const access of accesses.values()) {
      const passwordHash = await hashImportedPassword(access.setor, access.login, env.PAINEL_REGIONAL_KEY)
      userStatements.push(env.DB.prepare(`
        INSERT INTO usuarios
          (regional_id, distrital_id, consultor_id, nome, email, senha_hash, perfil, ativo,
           criado_em, login_rede, setor, origem, na_base_atual, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, 1, ?)
        ON CONFLICT(regional_id, email) DO UPDATE SET
          nome = excluded.nome,
          senha_hash = excluded.senha_hash,
          perfil = excluded.perfil,
          distrital_id = excluded.distrital_id,
          consultor_id = excluded.consultor_id,
          login_rede = excluded.login_rede,
          setor = excluded.setor,
          origem = excluded.origem,
          na_base_atual = 1,
          ativo = excluded.ativo,
          atualizado_em = excluded.atualizado_em
      `).bind(
        access.regional_id,
        access.distrital_id,
        access.consultor_id,
        access.nome,
        access.login,
        passwordHash,
        access.perfil,
        access.ativo,
        access.login,
        access.setor,
        ORIGEM,
        now,
      ))
    }
    await batches(env, userStatements, 25)

    const rgUsers = await env.DB.prepare(`
      SELECT id, regional_id, login_rede, setor
        FROM usuarios
       WHERE origem = ? AND perfil = 'RG' AND na_base_atual = 1
    `).bind(ORIGEM).all()

    const credentialStatements = []
    for (const rg of rgUsers.results || []) {
      const encrypted = await encryptCredentials({
        usuario: rg.login_rede,
        segredo: rg.setor,
        regional_id: Number(rg.regional_id),
        origem: ORIGEM,
        salvo_em: now,
      }, env.PAINEL_REGIONAL_KEY)
      credentialStatements.push(env.DB.prepare(`
        INSERT INTO credenciais_extracao
          (regional_id, usuario_id, usuario_mascarado, credencial_cifrada, status, mensagem_status, atualizado_em)
        VALUES (?, ?, ?, ?, 'CONFIGURADA', ?, ?)
        ON CONFLICT(regional_id) DO UPDATE SET
          usuario_id = excluded.usuario_id,
          usuario_mascarado = excluded.usuario_mascarado,
          credencial_cifrada = excluded.credencial_cifrada,
          status = 'CONFIGURADA',
          mensagem_status = excluded.mensagem_status,
          atualizado_em = excluded.atualizado_em
      `).bind(
        rg.regional_id,
        rg.id,
        maskEmail(rg.login_rede),
        encrypted,
        'Login EMS e senha padrão do setor preparados para Bússola e Mercado Farma.',
        now,
      ))
    }
    await batches(env, credentialStatements)

    await env.DB.batch([
      env.DB.prepare(`UPDATE regionais SET ativo = 0 WHERE origem = ? AND na_base_atual = 0`).bind(ORIGEM),
      env.DB.prepare(`
        UPDATE consultores
           SET ativo = 0, na_base_atual = 0
         WHERE origem = ?
           AND distrital_id IN (SELECT id FROM distritais WHERE origem = ? AND na_base_atual = 0)
      `).bind(ORIGEM, ORIGEM),
      env.DB.prepare(`
        DELETE FROM sessoes_acesso
         WHERE tipo_usuario = 'USUARIO'
           AND usuario_id IN (SELECT id FROM usuarios WHERE origem = ?)
      `).bind(ORIGEM),
    ])

    const ignored = Math.max(0, rows.length - consultants.size - districts.size - regionals.size)
    const details = {
      avisos: [...new Set(warnings)].slice(0, 100),
      regra_login: 'Coluna K; aceita login com ou sem @ems.com.br',
      regra_senha: 'Setor próprio da pessoa',
      regra_hierarquia: 'O setor do GR não pode ser cadastrado como GD.',
    }

    await env.DB.prepare(`
      INSERT INTO importacoes_estrutura_pessoas
        (nome_arquivo, nome_planilha, total_linhas, total_regionais, total_distritais,
         total_consultores, total_ignorados, detalhes_json, criado_por, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      fileName,
      sheetName,
      rows.length,
      regionals.size,
      districts.size,
      consultants.size,
      ignored,
      JSON.stringify(details),
      developer.id,
    ).run()

    return json({
      sucesso: true,
      resumo: {
        linhas_recebidas: rows.length,
        regionais: regionals.size,
        distritais: districts.size,
        consultores: consultants.size,
        ignorados: ignored,
      },
      avisos: details.avisos,
      mensagem: 'Estrutura corrigida. RGs, GDs e Consultores foram vinculados pelos respectivos setores.',
    }, 201)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (detail.includes('no such column') || detail.includes('no such table')) {
      return json({ erro: 'A atualização do banco ainda não foi aplicada. Aguarde o deploy terminar.', detalhe: detail }, 503)
    }
    return json({ erro: 'Não foi possível importar a Estrutura de Pessoas.', detalhe: detail }, 500)
  }
}
