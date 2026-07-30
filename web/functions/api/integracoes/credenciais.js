import {
  badRequest,
  encryptCredentials,
  json,
  maskEmail,
  readBody,
} from '../_lib/security.js'
import { requireGD, requireManager } from '../_lib/manager.js'

const TYPES = ['BUSSOLA', 'MERCADO_FARMA']

function upsertCredential(env, user, type, maskedLogin, encrypted, now) {
  return env.DB.prepare(`
    INSERT INTO credenciais_distritais
      (regional_id, distrital_id, usuario_id, tipo, usuario_mascarado, credencial_cifrada,
       status, mensagem_status, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, 'CONFIGURADA', ?, ?)
    ON CONFLICT(distrital_id, tipo) DO UPDATE SET
      regional_id = excluded.regional_id,
      usuario_id = excluded.usuario_id,
      usuario_mascarado = excluded.usuario_mascarado,
      credencial_cifrada = excluded.credencial_cifrada,
      status = 'CONFIGURADA',
      mensagem_status = excluded.mensagem_status,
      testado_em = NULL,
      atualizado_em = excluded.atualizado_em
  `).bind(
    user.regional_id,
    user.distrital_id,
    user.id,
    type,
    maskedLogin,
    encrypted,
    'Acesso único configurado pelo GD para Bússola e Mercado Farma.',
    now,
  )
}

function summarizeDistricts(rows) {
  const districts = rows.map((item) => ({
    id: Number(item.id),
    nome: item.nome,
    codigo: item.codigo,
    gerente_nome: item.gerente_nome || '',
    configurada: Number(item.configurada || 0) > 0,
    usuario_mascarado: item.usuario_mascarado || '',
    status: Number(item.configurada || 0) > 0 ? 'CONFIGURADA' : 'PENDENTE',
    atualizado_em: item.atualizado_em || null,
  }))
  const configured = districts.filter((item) => item.configurada).length
  return {
    distritais: districts,
    resumo: {
      total: districts.length,
      configuradas: configured,
      pendentes: Math.max(districts.length - configured, 0),
      completa: districts.length > 0 && configured === districts.length,
    },
  }
}

export async function onRequestGet({ request, env }) {
  const { denial, user } = await requireManager(request, env)
  if (denial) return denial

  const params = [user.regional_id]
  let filter = ''
  if (user.perfil === 'GD') {
    filter = ' AND d.id = ?'
    params.push(user.distrital_id)
  }

  const result = await env.DB.prepare(`
    SELECT d.id, d.nome, d.codigo, d.gerente_nome,
           MAX(CASE WHEN c.status = 'CONFIGURADA' THEN 1 ELSE 0 END) AS configurada,
           MAX(c.usuario_mascarado) AS usuario_mascarado,
           MAX(c.atualizado_em) AS atualizado_em
      FROM distritais d
      LEFT JOIN credenciais_distritais c
        ON c.distrital_id = d.id AND c.regional_id = d.regional_id
     WHERE d.regional_id = ? AND d.ativo = 1${filter}
     GROUP BY d.id, d.nome, d.codigo, d.gerente_nome
     ORDER BY d.nome
  `).bind(...params).all()

  const status = summarizeDistricts(result.results || [])
  const own = user.perfil === 'GD' ? status.distritais[0] || null : null
  const shared = own?.configurada ? {
    tipo: 'COMPARTILHADA',
    usuario_mascarado: own.usuario_mascarado,
    status: own.status,
    mensagem_status: 'Acesso único configurado pelo GD para Bússola e Mercado Farma.',
    atualizado_em: own.atualizado_em,
  } : null

  return json({
    modo: user.perfil,
    integracao: shared,
    bussola: shared,
    mercado_farma: shared,
    ...status,
  })
}

export async function onRequestPost({ request, env }) {
  const { denial, user } = await requireGD(request, env)
  if (denial) return denial

  const district = await env.DB.prepare(`
    SELECT id FROM distritais
     WHERE id = ? AND regional_id = ? AND ativo = 1
  `).bind(user.distrital_id, user.regional_id).first()
  if (!district) return badRequest('Sua Distrital não está ativa ou não pertence a esta Regional.')

  const data = await readBody(request)
  const login = String(data.usuario || data.login || '').trim()
  const password = String(data.senha || '')

  if (login.length < 3 || password.length < 3) {
    return badRequest('Informe o login e a senha usados no Bússola e no Mercado Farma.')
  }

  const now = new Date().toISOString()
  const maskedLogin = maskEmail(login)
  const encryptedValues = await Promise.all(TYPES.map((type) => encryptCredentials({
    usuario: login,
    segredo: password,
    tipo: type,
    regional_id: Number(user.regional_id),
    distrital_id: Number(user.distrital_id),
    usuario_id: Number(user.id),
    salvo_em: now,
  }, env.PAINEL_REGIONAL_KEY)))

  await env.DB.batch(TYPES.map((type, index) => upsertCredential(
    env,
    user,
    type,
    maskedLogin,
    encryptedValues[index],
    now,
  )))

  const shared = {
    tipo: 'COMPARTILHADA',
    usuario_mascarado: maskedLogin,
    status: 'CONFIGURADA',
    mensagem_status: 'Acesso único configurado pelo GD para Bússola e Mercado Farma.',
    atualizado_em: now,
  }

  return json({
    sucesso: true,
    integracao: shared,
    bussola: shared,
    mercado_farma: shared,
    usuario_mascarado: maskedLogin,
    mensagem: 'Acesso do Bússola e Mercado Farma salvo com segurança para sua Distrital.',
  }, 201)
}
