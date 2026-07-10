/**
 * Exporta o histórico de alocações das carteiras para CSV.
 * Gera dois arquivos:
 *   alocacoes_macro.csv  — % por classe de ativo por perfil/mês
 *   alocacoes_ativos.csv — ativos individuais por carteira/mês com peso
 *
 * Uso: node backend/exportar_alocacoes.mjs [diretorio_saida]
 *      (padrão: diretório atual)
 */
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import Database from './node_modules/better-sqlite3/lib/database.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const db = new Database(resolve(__dirname, 'data/carteiras.db'), { readonly: true })

const outDir = process.argv[2] || '.'

// --- 1. Alocações macro (% por classe) ---
const macro = db.prepare(`
  SELECT
    p.nome                AS perfil,
    a.mes,
    a.pos_fixado,
    a.inflacao,
    a.prefixado,
    a.rf_global,
    a.multimercado,
    a.rv_brasil,
    a.rv_global,
    a.fundos_listados,
    a.alternativos
  FROM alocacoes_macro a
  JOIN perfis p ON p.id = a.perfil_id
  ORDER BY p.ordem, a.mes
`).all()

const macroCols = ['perfil','mes','pos_fixado','inflacao','prefixado','rf_global','multimercado','rv_brasil','rv_global','fundos_listados','alternativos']
const macroCSV = [
  macroCols.join(','),
  ...macro.map(r => macroCols.map(c => r[c] ?? '').join(','))
].join('\n')

const macroPath = resolve(outDir, 'alocacoes_macro.csv')
writeFileSync(macroPath, macroCSV, 'utf8')
console.log(`Macro: ${macro.length} linhas → ${macroPath}`)

// --- 2. Alocações por ativo individual ---
const ativos = db.prepare(`
  SELECT
    p_perf.nome   AS perfil,
    c.nome        AS carteira,
    ep.mes,
    pr.nome       AS ativo,
    pr.tipo,
    pr.classe,
    pr.identificador,
    pr.peso,
    pr.indexador,
    pr.taxa,
    pr.data_emissao,
    pr.data_vencimento
  FROM estados_portfolio ep
  JOIN carteiras c      ON c.id  = ep.carteira_id
  JOIN perfis p_perf    ON p_perf.id = c.perfil_id
  JOIN produtos pr      ON pr.estado_id = ep.id
  ORDER BY p_perf.ordem, c.id, ep.mes, pr.classe, pr.peso DESC
`).all()

function escapeCsv(v) {
  if (v == null) return ''
  const s = String(v)
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
}

const ativosCols = ['perfil','carteira','mes','ativo','tipo','classe','identificador','peso','indexador','taxa','data_emissao','data_vencimento']
const ativosCSV = [
  ativosCols.join(','),
  ...ativos.map(r => ativosCols.map(c => escapeCsv(r[c])).join(','))
].join('\n')

const ativosPath = resolve(outDir, 'alocacoes_ativos.csv')
writeFileSync(ativosPath, ativosCSV, 'utf8')
console.log(`Ativos: ${ativos.length} linhas → ${ativosPath}`)
