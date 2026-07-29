import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import * as XLSX from 'xlsx'
import { api } from './api'
import './client-import.css'

type Status = {
  clientes_ativos: number
  ultima_importacao: null | {
    nome_arquivo: string
    status: string
    total_recebido: number
    total_importado: number
    criado_em: string
    finalizado_em?: string | null
  }
}

type ClientRow = {
  cnpj: string
  codigo_cliente: string
  nome_pdv: string
  grupo_economico: string
  rede_associacao: string
  endereco: string
  bairro: string
  cidade: string
  uf: string
  cep: string
  situacao: string
  classificacao_cliente: string
  setor_gr: string
  nome_gr: string
  setor_gd: string
  nome_gd: string
  setor_consultor: string
  nome_consultor: string
  foco_pex: string
  positivacao: string
}

const normalize = (value: unknown) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toUpperCase()

function parseClientPanel(file: File): Promise<{ sheetName: string; rows: ClientRow[] }> {
  return file.arrayBuffer().then((buffer) => {
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })
    const sheetName = workbook.SheetNames.find((name) => normalize(name) === 'PAINEL') || workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false }) as unknown[][]
    if (!matrix.length) throw new Error('A aba PAINEL está vazia.')

    const headers = matrix[0].map(normalize)
    const lastIndex = (name: string) => {
      const expected = normalize(name)
      let found = -1
      headers.forEach((header, index) => { if (header === expected) found = index })
      return found
    }
    const firstIndex = (name: string) => headers.indexOf(normalize(name))
    const at = (row: unknown[], index: number) => index >= 0 ? String(row[index] ?? '').trim() : ''

    const columns = {
      cnpj: firstIndex('CNPJ'), codigo: firstIndex('CÓD CLIENTE SISO'), nome: firstIndex('NOME PDV'),
      grupo: firstIndex('GRUPO ECONÔMICO'), rede: firstIndex('REDE ASSOCIAÇÃO'), endereco: firstIndex('ENDEREÇO'),
      bairro: firstIndex('BAIRRO'), cidade: firstIndex('CIDADE'), uf: firstIndex('UF'), cep: firstIndex('CEP'),
      situacao: firstIndex('SITUAÇÃO'), classificacao: firstIndex('CLASSIFICAÇÃO CLIENTE'),
      gr: lastIndex('SETOR GR'), nomeGr: lastIndex('NOME GR'), gd: lastIndex('SETOR GD'), nomeGd: lastIndex('NOME GD'),
      consultor: lastIndex('SETOR REP'), nomeConsultor: lastIndex('NOME REP'), foco: firstIndex('FOCO PEX'), positivacao: firstIndex('POSITIVAÇÃO'),
    }

    if ([columns.cnpj, columns.nome, columns.gr, columns.gd, columns.consultor].some((index) => index < 0)) {
      throw new Error('Não encontrei as colunas obrigatórias CNPJ, NOME PDV, SETOR GR, SETOR GD e SETOR REP.')
    }

    const rows = matrix.slice(1).map((row): ClientRow => ({
      cnpj: at(row, columns.cnpj), codigo_cliente: at(row, columns.codigo), nome_pdv: at(row, columns.nome),
      grupo_economico: at(row, columns.grupo), rede_associacao: at(row, columns.rede), endereco: at(row, columns.endereco),
      bairro: at(row, columns.bairro), cidade: at(row, columns.cidade), uf: at(row, columns.uf), cep: at(row, columns.cep),
      situacao: at(row, columns.situacao), classificacao_cliente: at(row, columns.classificacao),
      setor_gr: at(row, columns.gr), nome_gr: at(row, columns.nomeGr), setor_gd: at(row, columns.gd), nome_gd: at(row, columns.nomeGd),
      setor_consultor: at(row, columns.consultor), nome_consultor: at(row, columns.nomeConsultor),
      foco_pex: at(row, columns.foco), positivacao: at(row, columns.positivacao),
    })).filter((row) => row.cnpj && row.nome_pdv && /^\d{8}$/.test(row.setor_gr) && /^\d{8}$/.test(row.setor_gd) && /^\d{8}$/.test(row.setor_consultor))

    return { sheetName, rows }
  })
}

export default function ClientBaseImport() {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function loadStatus() {
    try { setStatus(await api<Status>('developer/clientes/status')) } catch { /* migração pode ainda estar em deploy */ }
  }
  useEffect(() => { void loadStatus() }, [])

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    setBusy(true)
    setError('')
    setProgress('Lendo a aba PAINEL…')
    try {
      const parsed = await parseClientPanel(file)
      setProgress(`${parsed.rows.length.toLocaleString('pt-BR')} clientes válidos. Preparando importação…`)
      const started = await api<{ id: string }>('developer/clientes/iniciar', {
        method: 'POST', body: JSON.stringify({ nome_arquivo: file.name, nome_planilha: parsed.sheetName, total_linhas: parsed.rows.length }),
      })
      const chunkSize = 500
      for (let index = 0; index < parsed.rows.length; index += chunkSize) {
        const chunk = parsed.rows.slice(index, index + chunkSize)
        await api('developer/clientes/lote', {
          method: 'POST', body: JSON.stringify({ importacao_id: started.id, linhas: chunk }),
        })
        const completed = Math.min(index + chunk.length, parsed.rows.length)
        setProgress(`Enviando clientes: ${completed.toLocaleString('pt-BR')} de ${parsed.rows.length.toLocaleString('pt-BR')}`)
      }
      const result = await api<{ mensagem: string; total_importado: number }>('developer/clientes/finalizar', {
        method: 'POST', body: JSON.stringify({ importacao_id: started.id }),
      })
      setProgress(`${result.mensagem} ${result.total_importado.toLocaleString('pt-BR')} clientes publicados.`)
      await loadStatus()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível importar o Painel de Clientes.')
    } finally {
      input.value = ''
      setBusy(false)
    }
  }

  return <><button className="client-import-fab" type="button" onClick={() => setOpen(true)}>Clientes</button>{open && <div className="client-import-overlay" role="dialog" aria-modal="true"><section className="client-import-modal"><button className="client-import-close" onClick={() => setOpen(false)}>×</button><span className="developer-kicker">Base oficial</span><h2>Painel de Clientes</h2><p>Envie a planilha mensal. A aba PAINEL será separada automaticamente pelas colunas finais de GR, GD e REP.</p><div className="client-import-status"><strong>{(status?.clientes_ativos || 0).toLocaleString('pt-BR')}</strong><span>clientes ativos no sistema</span>{status?.ultima_importacao && <small>Última base: {status.ultima_importacao.nome_arquivo} · {status.ultima_importacao.status}</small>}</div><label className={`client-import-select ${busy ? 'disabled' : ''}`}><input type="file" accept=".xlsx,.xls" disabled={busy} onChange={(event) => void upload(event)} />{busy ? 'Importando…' : 'Selecionar Painel EMS'}</label>{progress && <div className="client-import-progress">{progress}</div>}{error && <div className="developer-alert error">{error}</div>}<small className="client-import-note">Mapeamento usado: SETOR GR/NOME GR, SETOR GD/NOME GD e SETOR REP/NOME REP do último bloco da aba PAINEL.</small></section></div>}</>
}
