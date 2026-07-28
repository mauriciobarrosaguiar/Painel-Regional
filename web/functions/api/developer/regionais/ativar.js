import { badRequest, json, readBody, requireDeveloper } from '../../_lib/security.js'

export async function onRequestPost({ request, env }) {
  const { denial } = await requireDeveloper(request, env)
  if (denial) return denial

  try {
    const data = await readBody(request)
    const regionalId = Number(data.regional_id)
    const active = Number(data.ativo) === 1 ? 1 : 0
    if (!regionalId) return badRequest('Regional inválida.')

    const regional = await env.DB.prepare(`
      SELECT id, nome, setor, na_base_atual
        FROM regionais
       WHERE id = ? AND origem = 'ESTRUTURA_PESSOAS'
    `).bind(regionalId).first()
    if (!regional) return badRequest('A Regional não pertence à Estrutura de Pessoas importada.')
    if (active && Number(regional.na_base_atual || 0) !== 1) {
      return badRequest('O Gerente Regional não está presente na base atual e não pode ser ativado.')
    }

    await env.DB.batch([
      env.DB.prepare(`
        UPDATE regionais
           SET ativo = ?, atualizado_em = datetime('now')
         WHERE id = ?
      `).bind(active, regionalId),
      env.DB.prepare(`
        UPDATE distritais
           SET ativo = CASE WHEN ? = 1 AND na_base_atual = 1 THEN 1 ELSE 0 END,
               atualizado_em = datetime('now')
         WHERE regional_id = ? AND origem = 'ESTRUTURA_PESSOAS'
      `).bind(active, regionalId),
      env.DB.prepare(`
        UPDATE consultores
           SET ativo = CASE WHEN ? = 1 AND na_base_atual = 1 THEN 1 ELSE 0 END,
               atualizado_em = datetime('now')
         WHERE origem = 'ESTRUTURA_PESSOAS'
           AND distrital_id IN (SELECT id FROM distritais WHERE regional_id = ?)
      `).bind(active, regionalId),
      env.DB.prepare(`
        UPDATE usuarios
           SET ativo = CASE WHEN ? = 1 AND na_base_atual = 1 THEN 1 ELSE 0 END,
               atualizado_em = datetime('now')
         WHERE regional_id = ? AND origem = 'ESTRUTURA_PESSOAS'
      `).bind(active, regionalId),
      env.DB.prepare(`
        DELETE FROM sessoes_acesso
         WHERE tipo_usuario = 'USUARIO'
           AND usuario_id IN (SELECT id FROM usuarios WHERE regional_id = ?)
      `).bind(regionalId),
    ])

    return json({
      sucesso: true,
      ativo: active,
      mensagem: active
        ? `${regional.nome} foi ativada. RG, GDs e Consultores já podem acessar com o login EMS e a senha do setor.`
        : `${regional.nome} foi desativada e deixou de aparecer no sistema.`,
    })
  } catch (error) {
    return json({
      erro: 'Não foi possível alterar a ativação da Regional.',
      detalhe: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
