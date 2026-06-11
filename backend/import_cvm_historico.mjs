/**
 * Backfill de cotas de fundos CVM para 2022-2024.
 *
 * Baixa os arquivos mensais da CVM e popula cotas_cache para todos os CNPJs
 * cadastrados em produtos. Os dados ficam disponíveis para:
 *   - Cálculo de retorno individual por fundo
 *   - Monte Carlo quando o histórico de alocações for estendido para esse período
 *
 * NOTA: o otimizador só usa meses presentes em alocacoes_macro. Para os perfis
 * 1-4 (início 2025-02), este backfill prepara infraestrutura para uso futuro.
 * O perfil 5 (Top Ações/Dividendos, desde 2019) não tem fundos CVM.
 *
 * Uso: node backend/import_cvm_historico.mjs [anoMesInicio] [anoMesFim]
 *      (padrão: 202201 a 202412)
 */
import { writeFileSync, mkdirSync, readFileSync, rmSync, readdirSync } from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import Database from './node_modules/better-sqlite3/lib/database.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const db = new Database(resolve(__dirname, 'data/carteiras.db'))

const CVM_BASE = 'https://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS'
const HEADERS  = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/124.0.0.0 Safari/537.36' }

// Range padrão: 2022-01 a 2024-12
const args = process.argv.slice(2)
const mesInicio = args[0] || '202201'
const mesFim    = args[1] || '202412'

// Gera lista de YYYYMM entre mesInicio e mesFim
function gerarMeses(inicio, fim) {
  const meses = []
  let ano = parseInt(inicio.slice(0, 4))
  let mes = parseInt(inicio.slice(4, 6))
  const anoFim = parseInt(fim.slice(0, 4))
  const mesFimN = parseInt(fim.slice(4, 6))
  while (ano < anoFim || (ano === anoFim && mes <= mesFimN)) {
    meses.push(`${ano}${String(mes).padStart(2, '0')}`)
    mes++
    if (mes > 12) { mes = 1; ano++ }
  }
  return meses
}

// Busca todos os CNPJs de fundos cadastrados
const cnpjs = db.prepare(
  "SELECT DISTINCT identificador FROM produtos WHERE tipo = 'fundo' AND identificador IS NOT NULL AND identificador != ''"
).all().map(r => r.identificador)

// Pré-computa mapa CNPJ → [produto_id, ...]
const cnpjPidMap = new Map()
for (const cnpj of cnpjs) {
  const pids = db.prepare(
    "SELECT id FROM produtos WHERE identificador = ? AND tipo = 'fundo'"
  ).all(cnpj).map(r => r.id)
  cnpjPidMap.set(cnpj, pids)
}

console.log(`Fundos cadastrados: ${cnpjs.length} CNPJs | ${[...cnpjPidMap.values()].flat().length} produto_ids`)

const meses = gerarMeses(mesInicio, mesFim)
console.log(`Meses a processar: ${meses[0]} → ${meses[meses.length - 1]} (${meses.length} arquivos)\n`)

const upsertStmt = db.prepare(`
  INSERT INTO cotas_cache (produto_id, data, valor, fonte)
  VALUES (?, ?, ?, 'CVM')
  ON CONFLICT(produto_id, data) DO UPDATE SET
    valor = excluded.valor,
    fonte = excluded.fonte
`)

let totalInseridos = 0
let totalMesesOk = 0
let totalMesesErro = 0

for (const anoMes of meses) {
  const url = `${CVM_BASE}/inf_diario_fi_${anoMes}.zip`
  process.stdout.write(`  ${anoMes}... `)

  try {
    const res = await fetch(url, { headers: HEADERS })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const buf = Buffer.from(await res.arrayBuffer())
    const tmpZip = `/tmp/cvm_hist_${anoMes}.zip`
    const tmpDir = `/tmp/cvm_hist_${anoMes}`

    writeFileSync(tmpZip, buf)
    mkdirSync(tmpDir, { recursive: true })
    execSync(`unzip -o "${tmpZip}" -d "${tmpDir}"`, { stdio: 'pipe' })

    const csvFile = readdirSync(tmpDir).find(f => f.endsWith('.csv'))
    if (!csvFile) throw new Error('CSV não encontrado no ZIP')

    // Detecta índices das colunas a partir do header (lida com pré e pós-ICVM 175).
    // Pré-ICVM 175 (até ~2023-09): TP_FUNDO;CNPJ_FUNDO;DT_COMPTC;VL_TOTAL;VL_QUOTA;...
    // Pós-ICVM 175 (a partir ~2023-10): ...;CNPJ_FUNDO_CLASSE;ID_SUBCLASSE;DT_COMPTC;VL_TOTAL;VL_QUOTA;...
    const csv = readFileSync(`${tmpDir}/${csvFile}`, 'latin1')
    const linhas = csv.split('\n')
    const headerCols = linhas[0].split(';').map(h => h.trim())
    const iCnpj  = headerCols.findIndex(h => h.includes('CNPJ'))
    const iData  = headerCols.findIndex(h => h === 'DT_COMPTC')
    const iQuota = headerCols.findIndex(h => h === 'VL_QUOTA')
    if (iCnpj < 0 || iData < 0 || iQuota < 0) throw new Error(`Header inesperado: ${linhas[0].slice(0, 120)}`)

    // Agrupa por CNPJ → date → max(vlQuota)
    const porCnpj = new Map()
    for (const linha of linhas.slice(1)) {
      const cols = linha.split(';')
      if (cols.length <= iQuota) continue
      const cnpj    = cols[iCnpj]?.trim()
      const data    = cols[iData]?.trim()
      const vlQuota = parseFloat(cols[iQuota]?.trim())
      if (!cnpj || !data || isNaN(vlQuota) || vlQuota <= 0) continue
      if (!cnpjPidMap.has(cnpj)) continue // não está nos nossos fundos
      if (!porCnpj.has(cnpj)) porCnpj.set(cnpj, new Map())
      const porData = porCnpj.get(cnpj)
      if (!porData.has(data) || vlQuota > porData.get(data)) {
        porData.set(data, vlQuota)
      }
    }

    // Upsert para todos os produto_ids de cada CNPJ encontrado
    let inseridosMes = 0
    const salvar = db.transaction(() => {
      for (const [cnpj, porData] of porCnpj) {
        const pids = cnpjPidMap.get(cnpj)
        for (const [data, valor] of porData) {
          for (const pid of pids) {
            upsertStmt.run(pid, data, valor)
            inseridosMes++
          }
        }
      }
    })
    salvar()

    // Limpa temp
    rmSync(tmpDir, { recursive: true, force: true })
    rmSync(tmpZip, { force: true })

    totalInseridos += inseridosMes
    totalMesesOk++
    console.log(`${inseridosMes.toLocaleString('pt-BR')} registros (${porCnpj.size} CNPJs encontrados)`)
  } catch (e) {
    totalMesesErro++
    console.log(`ERRO: ${e.message}`)
  }
}

console.log(`\nConcluído: ${totalMesesOk} meses ok, ${totalMesesErro} erros`)
console.log(`Total inserido: ${totalInseridos.toLocaleString('pt-BR')} registros`)

// Verificação: amostra de CNPJs
console.log('\nAmostra de cobertura (3 CNPJs):')
for (const cnpj of cnpjs.slice(0, 3)) {
  const pid = cnpjPidMap.get(cnpj)?.[0]
  if (!pid) continue
  const r = db.prepare("SELECT MIN(data) as ini, MAX(data) as fim, COUNT(*) as n FROM cotas_cache WHERE produto_id = ? AND fonte = 'CVM'").get(pid)
  console.log(` ${cnpj}: ${r.n} cotas | ${r.ini} → ${r.fim}`)
}
