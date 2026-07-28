import { json, requireDeveloper } from '../_lib/security.js'

export async function onRequestGet({ request, env }) {
  const { denial } = await requireDeveloper(request, env)
  if (denial) return denial

  try {
    const [regionals, managers, imports] = await env.DB.batch([
      env.DB.prepare(`
        SELECT r.id, r.nome, r.slug, r.ativo, r.setor, r.origem, r.na_base_atual, r.criado_em, r.atualizado_em,
               COUNT(DISTINCT d.id) AS total_distritais,
               COUNT(DISTINCT c.id) AS total_consultores
          FROM regionais r
          LEFT JOIN distritais d ON d.regional_id = r.id AND d.na_base_atual = 1
          LEFT JOIN consultores c ON c.distrital_id = d.id AND c.na_base_atual = 1
         WHERE r.origem = 'ESTRUTURA_PESSOAS'
         GROUP BY r.id
         ORDER BY r.nome
      `),
      env.DB.prepare(`
        SELECT u.id, u.nome, u.email, u.login_rede, u.setor, u.regional_id, u.ativo, u.na_base_atual,
               r.nome AS regional_nome, r.ativo AS regional_ativa,
               CASE WHEN ce.id IS NULL THEN 0 ELSE 1 END AS credencial_configurada,
               ce.usuario_mascarado, ce.status AS credencial_status, ce.atualizado_em AS credencial_atualizada_em
          FROM usuarios u
          JOIN regionais r ON r.id = u.regional_id
          LEFT JOIN credenciais_extracao ce ON ce.usuario_id = u.id AND ce.regional_id = u.regional_id
         WHERE u.perfil = 'RG' AND u.origem = 'ESTRUTURA_PESSOAS'
         ORDER BY r.nome
      `),
      env.DB.prepare(`
        SELECT id, nome_arquivo, nome_planilha, total_linhas, total_regionais, total_distritais,
               total_consultores, total_ignorados, criado_em
          FROM importacoes_estrutura_pessoas
         ORDER BY criado_em DESC
         LIMIT 10
      `),
    ])

    return json({
      regionais: regionals.results || [],
      gerentes_regionais: managers.results || [],
      importacoes: imports.results || [],
    })
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    if (detalhe.includes('no such column') || detalhe.includes('no such table')) {
      return json({ erro: 'A atualização do banco ainda está sendo aplicada. Aguarde o deploy terminar.', detalhe }, 503)
    }
    return json({ erro: 'Não foi possível carregar a Estrutura de Pessoas.', detalhe }, 500)
  }
}
