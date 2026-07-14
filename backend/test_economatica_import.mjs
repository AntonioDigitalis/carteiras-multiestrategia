// Teste de importação real da Economatica News API para cotas_cache.
// Escopo de teste: só 1 produto_id de referência por ticker (não todas as
// ocorrências mensais) — fonte='economatica_news_api', isolada da fonte
// 'economatica' já usada pelo mecanismo de feeds URL.
import { createHash, createHmac } from 'crypto'
import { getDb } from './src/db/database.js'

const BASE_URL = 'https://news-api.economatica.com'
const db = getDb()
const getConfig = (chave) => db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(chave)?.valor?.trim() || null
const apiKey = getConfig('economatica_api_key')
const apiSecret = getConfig('economatica_api_secret')

function assinar(method, path, body, secret) {
  const bodyHash = createHash('sha256').update(body).digest('hex')
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const canonical = `${method}\n${path}\n${timestamp}\n${bodyHash}`
  const signature = createHmac('sha256', secret).update(canonical).digest('hex')
  return { timestamp, signature }
}

async function chamar(path) {
  const { timestamp, signature } = assinar('GET', path, '', apiSecret)
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'x-api-key': apiKey, 'x-timestamp': timestamp, 'x-signature': signature },
  })
  if (!res.ok) throw new Error(`${path} -> ${res.status}`)
  return res.json()
}

const TICKERS = [
  { ticker: 'PETR4', familia: 'equities' },
  { ticker: 'MXRF11', familia: 'fii' },
  { ticker: 'BOVA11', familia: 'etf' },
]

// Dados 'economatica' (feed URL, fonte primária) são imutáveis — nunca sobrescrever
// com o teste da News API, mesma regra do insertMany de external.js.
const stmt = db.prepare(`
  INSERT INTO cotas_cache (produto_id, data, valor, valor_ajustado, fonte)
  VALUES (?, ?, ?, NULL, 'economatica_news_api')
  ON CONFLICT(produto_id, data) DO UPDATE SET
    valor          = CASE WHEN cotas_cache.fonte = 'economatica' THEN cotas_cache.valor ELSE excluded.valor END,
    valor_ajustado = CASE WHEN cotas_cache.fonte = 'economatica' THEN cotas_cache.valor_ajustado ELSE NULL END,
    fonte          = CASE WHEN cotas_cache.fonte = 'economatica' THEN cotas_cache.fonte ELSE excluded.fonte END
`)

for (const { ticker, familia } of TICKERS) {
  const produto = db.prepare(
    `SELECT MIN(id) as id FROM produtos WHERE identificador = ?`
  ).get(ticker)
  if (!produto?.id) { console.log(`${ticker}: produto não encontrado, pulando`); continue }

  const data = await chamar(`/v1/${familia}/${ticker}/quote/history`)
  const validas = data.series.filter((r) => r.close_adj != null)
  const flush = db.transaction((rows) => { for (const r of rows) stmt.run(produto.id, r.date, r.close_adj) })
  flush(validas)
  console.log(`${ticker} (produto_id=${produto.id}, ${familia}): ${validas.length}/${data.series.length} cotas gravadas [${data.from} .. ${data.to}]`)
}

console.log('\n--- amostra do que foi gravado ---')
for (const { ticker } of TICKERS) {
  const rows = db.prepare(`
    SELECT c.data, c.valor FROM cotas_cache c
    JOIN produtos p ON p.id = c.produto_id
    WHERE p.identificador = ? AND c.fonte = 'economatica_news_api'
    ORDER BY c.data DESC LIMIT 3
  `).all(ticker)
  console.log(ticker, rows)
}
