import Database from 'better-sqlite3'
import { execSync } from 'child_process'
import { writeFileSync, readFileSync, rmSync } from 'fs'

const db = new Database('./data/carteiras.db')
const ins = db.prepare('INSERT OR IGNORE INTO cotas_cache (produto_id,data,valor,valor_ajustado,fonte) VALUES (?,?,?,?,?)')

function getProd(ticker) {
  return db.prepare('SELECT MIN(p.id) as id FROM produtos p JOIN estados_portfolio ep ON ep.id=p.estado_id WHERE p.identificador=? AND p.tipo=\'acao\'').get(ticker)
}
function cobertura(ticker) {
  const r = db.prepare('SELECT MIN(cc.data) as mn FROM cotas_cache cc JOIN produtos p ON cc.produto_id=p.id WHERE p.identificador=? AND p.tipo=\'acao\'').get(ticker)
  return r?.mn?.slice(0,7) || 'SEM DADOS'
}
function inserir(prodId, rows, fonte) {
  let n = 0
  db.transaction(() => {
    for (const r of rows) n += ins.run(prodId, r.date, r.close, r.close, fonte).changes
  })()
  return n
}

async function fetchArquivo(url, tmpZ, tmpT) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/124' } })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  writeFileSync(tmpZ, Buffer.from(await res.arrayBuffer()))
  execSync(`unzip -o -p "${tmpZ}" > "${tmpT}"`)
  const content = readFileSync(tmpT, 'latin1')
  rmSync(tmpZ, { force: true }); rmSync(tmpT, { force: true })
  return content
}

function parseTicker(content, ticker) {
  const rows = []
  for (const line of content.split('\n')) {
    if (line.length < 121 || line[0] !== '0' || line[1] !== '1') continue
    if (line.slice(12, 24).trimEnd() !== ticker) continue
    const ds = line.slice(2, 10)
    const dt = `${ds.slice(0,4)}-${ds.slice(4,6)}-${ds.slice(6,8)}`
    const preco = parseInt(line.slice(108, 121), 10) / 100
    if (!isNaN(preco) && preco > 0) rows.push({ date: dt, close: preco })
  }
  return rows
}

// Meses mensais com gaps de 1 mês
const gaps_mensais = [
  { ticker: 'KLBN11', ano: 2022, mes: 7 },
  { ticker: 'CXSE3',  ano: 2024, mes: 11 },
  { ticker: 'JBSS3',  ano: 2025, mes: 2 },
]

for (const { ticker, ano, mes } of gaps_mensais) {
  const mm = String(mes).padStart(2, '0')
  process.stdout.write(`${ticker} ${ano}/${mm}... `)
  try {
    const url = `https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_M${mm}${ano}.ZIP`
    const content = await fetchArquivo(url, `/tmp/ct${ano}${mm}.zip`, `/tmp/ct${ano}${mm}.txt`)
    const rows = parseTicker(content, ticker)
    const prod = getProd(ticker)
    const n = inserir(prod.id, rows, 'B3_COTAHIST_M')
    console.log(`${rows.length} registros → ${n} inseridos | cobertura: ${cobertura(ticker)}`)
  } catch (e) {
    console.log(`ERRO: ${e.message.slice(0,60)}`)
  }
}

// SAPR11 — anos 2019 e 2020
for (const ano of [2019, 2020]) {
  process.stdout.write(`SAPR11 ${ano}... `)
  try {
    const url = `https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_A${ano}.ZIP`
    const content = await fetchArquivo(url, `/tmp/ct${ano}_sapr.zip`, `/tmp/ct${ano}_sapr.txt`)
    const rows = parseTicker(content, 'SAPR11')
    const prod = getProd('SAPR11')
    const n = inserir(prod.id, rows, 'B3_COTAHIST')
    console.log(`${rows.length} registros → ${n} inseridos`)
  } catch (e) {
    console.log(`ERRO: ${e.message.slice(0,60)}`)
  }
}
console.log(`SAPR11 cobertura final: ${cobertura('SAPR11')}`)

// Resumo final
console.log('\n=== RESUMO FINAL ===')
for (const [t, from] of [
  ['KLBN11','2022-07'],['CXSE3','2024-11'],['JBSS3','2025-02'],['SAPR11','2019-10'],
  ['NATU3','2025-02'],['BSHV39','2025-03'],
]) {
  const mn = cobertura(t)
  const ok = mn <= from.slice(0,7)
  console.log(ok ? '✓' : '⚠', t.padEnd(8), 'desde', mn)
}
