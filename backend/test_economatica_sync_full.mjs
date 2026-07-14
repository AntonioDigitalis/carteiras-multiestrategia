// Teste de importação em escala real: todos os tickers tipo='acao' cobertos
// pela Economatica News API (ações/FIIs/ETFs/BDRs), gravando em TODAS as
// ocorrências (produto_id) de cada ticker — mesmo padrão do sync-all de produção
// (cotas.js), só que puxando da News API em vez de Yahoo/CVM/feeds URL.
// fonte='economatica_news_api', upsert (idempotente).
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
  return { status: res.status, body: await res.json().catch(() => null) }
}

const FAMILIAS = ['equities', 'fii', 'etf', 'bdr']

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
const flush = db.transaction((rows) => { for (const r of rows) stmt.run(r.pid, r.data, r.valor) })

const tickers = db.prepare(
  `SELECT DISTINCT identificador FROM produtos WHERE tipo='acao' AND identificador IS NOT NULL`
).all().map((r) => r.identificador)

const cobertos = []
const naoCobertos = []
let totalCotas = 0

for (const ticker of tickers) {
  // /quote/history responde 200 com série vazia mesmo pra ticker fora do
  // domínio da família (ex: FII testado em /v1/equities) — só aceitar se
  // vier pelo menos 1 dia útil de fato.
  let historico = null
  for (const familia of FAMILIAS) {
    const { status, body } = await chamar(`/v1/${familia}/${ticker}/quote/history`)
    if (status === 200 && body?.series?.some((r) => r.close_adj != null)) { historico = { familia, ...body }; break }
    await new Promise((r) => setTimeout(r, 60))
  }
  if (!historico) { naoCobertos.push(ticker); continue }

  const validas = historico.series.filter((r) => r.close_adj != null)
  const produtoIds = db.prepare(`SELECT id FROM produtos WHERE identificador = ?`).all(ticker).map((r) => r.id)

  const rows = []
  for (const pid of produtoIds) for (const r of validas) rows.push({ pid, data: r.date, valor: r.close_adj })
  flush(rows)

  totalCotas += rows.length
  cobertos.push({ ticker, familia: historico.familia, dias: validas.length, ocorrencias: produtoIds.length })
  console.log(`${ticker} (${historico.familia}): ${validas.length} dias x ${produtoIds.length} ocorrências = ${rows.length} linhas`)
}

console.log('\n===== RESUMO =====')
console.log(`Tickers cobertos: ${cobertos.length}/${tickers.length}`)
console.log(`Total de linhas gravadas em cotas_cache: ${totalCotas}`)
console.log(`Não cobertos (${naoCobertos.length}):`, naoCobertos.join(', '))
