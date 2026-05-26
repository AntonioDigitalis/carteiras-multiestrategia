import { getDb } from '../db/database.js'
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, createWriteStream, statSync } from 'fs'
import { execFileSync, spawn } from 'child_process'
import { createInterface } from 'readline'
import https from 'https'
import http from 'http'
import YahooFinance from 'yahoo-finance2'

const _yf = new YahooFinance({
  suppressNotices: ['yahooSurvey'],
  validation: { logErrors: false, logOptionsErrors: false },
})

const BCB_BASE = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs'
const BRAPI_BASE = 'https://brapi.dev/api'
const ANBIMA_BASE = 'https://data.anbima.com.br'

async function fetchJSON(url, opts = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(url, { signal: controller.signal, ...opts })
    clearTimeout(timeout)
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
    return res.json()
  } catch (e) {
    clearTimeout(timeout)
    throw e
  }
}

function registrarLog(fonte, ativo, valor, status, detalhes) {
  try {
    const db = getDb()
    db.prepare(
      `INSERT INTO log_captacao (fonte, ativo, valor, status, detalhes)
       VALUES (?, ?, ?, ?, ?)`
    ).run(fonte, ativo, valor?.toString() ?? null, status, detalhes ?? null)
  } catch (_) {}
}

// ── BCB SGS ────────────────────────────────────────────────

export async function fetchCDIDiario(dataInicio, dataFim) {
  const db = getDb()
  const url = `${BCB_BASE}.12/dados?formato=json&dataInicial=${dataInicio}&dataFinal=${dataFim}`
  try {
    const data = await fetchJSON(url)
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO dados_macro (serie, data, valor, fonte)
       VALUES ('CDI_DIARIO', ?, ?, 'BCB')`
    )
    const insertMany = db.transaction((rows) => {
      for (const r of rows) {
        const d = r.data.split('/').reverse().join('-')  // DD/MM/YYYY → YYYY-MM-DD
        stmt.run(d, parseFloat(r.valor))
        registrarLog('BCB_SGS_12', 'CDI_DIARIO', r.valor, 'ok', null)
      }
    })
    insertMany(data)
    return data.length
  } catch (e) {
    registrarLog('BCB_SGS_12', 'CDI_DIARIO', null, 'erro', e.message)
    throw e
  }
}

export async function fetchIPCAMensal(dataInicio, dataFim) {
  const db = getDb()
  const url = `${BCB_BASE}.433/dados?formato=json&dataInicial=${dataInicio}&dataFinal=${dataFim}`
  try {
    const data = await fetchJSON(url)
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO dados_macro (serie, data, valor, fonte)
       VALUES ('IPCA_MENSAL', ?, ?, 'BCB')`
    )
    const insertMany = db.transaction((rows) => {
      for (const r of rows) {
        const parts = r.data.split('/')
        const d = `${parts[2]}-${parts[1]}-01`
        stmt.run(d, parseFloat(r.valor))
      }
    })
    insertMany(data)
    return data.length
  } catch (e) {
    registrarLog('BCB_SGS_433', 'IPCA_MENSAL', null, 'erro', e.message)
    throw e
  }
}

export async function fetchCDIAcumuladoMensal(dataInicio, dataFim) {
  const db = getDb()
  const url = `${BCB_BASE}.4391/dados?formato=json&dataInicial=${dataInicio}&dataFinal=${dataFim}`
  try {
    const data = await fetchJSON(url)
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO dados_macro (serie, data, valor, fonte)
       VALUES ('CDI_MENSAL', ?, ?, 'BCB')`
    )
    const insertMany = db.transaction((rows) => {
      for (const r of rows) {
        const parts = r.data.split('/')
        const d = `${parts[2]}-${parts[1]}-01`
        stmt.run(d, parseFloat(r.valor))
      }
    })
    insertMany(data)
    return data.length
  } catch (e) {
    registrarLog('BCB_SGS_4391', 'CDI_MENSAL', null, 'erro', e.message)
    throw e
  }
}

// ── Yahoo Finance ───────────────────────────────────────────

function yahooSymbol(ticker) {
  // Tickers B3: adiciona .SA se não tiver sufixo
  return ticker.includes('.') ? ticker : `${ticker}.SA`
}

async function fetchYahooChart(symbol, dataInicio, dataFim) {
  const quotes = await _yf.chart(symbol, {
    period1: dataInicio,
    period2: dataFim,
    interval: '1d',
  })
  return quotes
}

export async function fetchPrecoBrapi(ticker) {
  const symbol = yahooSymbol(ticker)
  try {
    const q = await _yf.quote(symbol)
    if (!q) throw new Error('Ticker não encontrado')
    return {
      ticker,
      nome: q.longName || q.shortName || ticker,
      preco: q.regularMarketPrice,
      preco_ajustado: q.regularMarketPrice,
    }
  } catch (e) {
    registrarLog('yahoo', ticker, null, 'erro', e.message)
    throw e
  }
}

async function fetchHistoricoAlphaVantage(ticker, dataInicio, dataFim, apiKey) {
  // Alpha Vantage usa sufixo .SAO para B3 (ex: IVVB11.SAO)
  const symbol = ticker.includes('.') ? ticker : `${ticker}.SAO`
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=compact&apikey=${apiKey}`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/124.0.0.0' } })
  if (!res.ok) throw new Error(`Alpha Vantage: HTTP ${res.status}`)
  const data = await res.json()
  if (data['Note']) throw new Error('Alpha Vantage: limite de requisições atingido (25/dia)')
  if (data['Information']) throw new Error('Alpha Vantage: ' + data['Information'].slice(0, 80))
  if (data['Error Message']) throw new Error('Alpha Vantage: ticker não encontrado — ' + ticker)
  const series = data['Time Series (Daily)']
  if (!series) throw new Error('Alpha Vantage: sem dados para ' + ticker)
  return Object.entries(series)
    .filter(([d]) => d >= dataInicio && d <= dataFim)
    .map(([d, v]) => ({
      date: d,
      close: parseFloat(v['4. close']),
      adjustedClose: parseFloat(v['4. close']), // free tier não tem adjusted
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

function getAlphaVantageKey() {
  try {
    const db = getDb()
    const row = db.prepare(`SELECT valor FROM configuracoes WHERE chave = 'alpha_vantage_key'`).get()
    return row?.valor || null
  } catch (_) { return null }
}

// ── B3 Boletim Diário (BVBG.086.01 PriceReport) ───────────────

const B3_CACHE_DIR = '/tmp/b3-cache'

function ensureB3CacheDir() {
  if (!existsSync(B3_CACHE_DIR)) mkdirSync(B3_CACHE_DIR, { recursive: true })
}

// Download with HTTP→HTTPS redirect following
function downloadToFile(url, destPath) {
  return new Promise((resolve, reject) => {
    function doGet(u, redirects = 0) {
      if (redirects > 5) return reject(new Error('Too many redirects'))
      const lib = u.startsWith('https') ? https : http
      lib.get(u, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/124.0.0.0' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume()
          return doGet(res.headers.location, redirects + 1)
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`B3: HTTP ${res.statusCode}`))
        }
        const file = createWriteStream(destPath)
        res.pipe(file)
        file.on('finish', () => { file.close(); resolve() })
        file.on('error', reject)
      }).on('error', reject)
    }
    doGet(url)
  })
}

// Stream-parse BVBG.086.01 XML → Map<ticker, lastPrice> (spot market only)
function parseB3Xml(xmlStream) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: xmlStream, crlfDelay: Infinity })
    const prices = new Map()
    let ticker = null, lastPric = null, hasDaysToSttlm = false, inPricRpt = false

    rl.on('line', (line) => {
      const t = line.trim()
      if (t === '<PricRpt>') {
        inPricRpt = true; ticker = null; lastPric = null; hasDaysToSttlm = false
      } else if (t === '</PricRpt>') {
        if (ticker && lastPric !== null) {
          if (!hasDaysToSttlm || !prices.has(ticker)) prices.set(ticker, lastPric)
        }
        inPricRpt = false
      } else if (inPricRpt) {
        if (t.startsWith('<TckrSymb>')) {
          ticker = t.replace(/<\/?TckrSymb>/g, '')
        } else if (t.startsWith('<LastPric')) {
          const m = t.match(/>([0-9.]+)</)
          if (m) lastPric = parseFloat(m[1])
        } else if (t.startsWith('<DaysToSttlm>')) {
          hasDaysToSttlm = true
        }
      }
    })
    rl.on('close', () => resolve(prices))
    rl.on('error', reject)
  })
}

// In-process cache: dateStr → Map<ticker, price>
const _b3DayCache = new Map()

async function getB3DayPrices(dateStr) {
  if (_b3DayCache.has(dateStr)) return _b3DayCache.get(dateStr)
  ensureB3CacheDir()

  const cacheJson = `${B3_CACHE_DIR}/${dateStr}.json`
  if (existsSync(cacheJson)) {
    const m = new Map(Object.entries(JSON.parse(readFileSync(cacheJson, 'utf8'))))
    _b3DayCache.set(dateStr, m)
    return m
  }

  // YYMMDD format (PR250520.zip)
  const yymmdd = dateStr.replace(/-/g, '').slice(2)
  const outerZip = `${B3_CACHE_DIR}/PR${yymmdd}_outer.zip`
  const innerZip = `${B3_CACHE_DIR}/PR${yymmdd}_inner.zip`

  try {
    const url = `http://www.b3.com.br/pesquisapregao/download?filelist=PR${yymmdd}.zip`
    await downloadToFile(url, outerZip)
    if (statSync(outerZip).size < 500) throw new Error('B3: arquivo vazio — dia sem pregão')

    // Extract nested ZIP (outer contains PR{YYMMDD}.zip as single entry)
    const innerData = execFileSync('unzip', ['-p', outerZip, `PR${yymmdd}.zip`], { maxBuffer: 50 * 1024 * 1024 })
    if (!innerData || innerData.length < 100) throw new Error('B3: arquivo vazio (dia sem pregão?)')
    writeFileSync(innerZip, innerData)

    // Find last XML in inner ZIP (last file has settled end-of-day prices)
    const listing = execFileSync('unzip', ['-l', innerZip], { encoding: 'utf8', maxBuffer: 1024 * 1024 })
    const xmlFiles = listing.split('\n')
      .filter((l) => l.includes('BVBG.086.01') && l.includes('.xml'))
      .map((l) => l.trim().split(/\s+/).pop())
      .sort()
    if (xmlFiles.length === 0) throw new Error('B3: nenhum XML no arquivo')

    const proc = spawn('unzip', ['-p', innerZip, xmlFiles[xmlFiles.length - 1]])
    const prices = await parseB3Xml(proc.stdout)

    writeFileSync(cacheJson, JSON.stringify(Object.fromEntries(prices)))
    _b3DayCache.set(dateStr, prices)
    return prices
  } finally {
    try { rmSync(outerZip, { force: true }) } catch (_) {}
    try { rmSync(innerZip, { force: true }) } catch (_) {}
  }
}

function getWeekdays(dataInicio, dataFim) {
  const days = []
  const cur = new Date(dataInicio + 'T12:00:00Z')
  const end = new Date(dataFim + 'T12:00:00Z')
  while (cur <= end) {
    const d = cur.getDay()
    if (d !== 0 && d !== 6) days.push(cur.toISOString().split('T')[0])
    cur.setDate(cur.getDate() + 1)
  }
  return days
}

async function fetchHistoricoB3(ticker, dataInicio, dataFim) {
  // Limit B3 daily bulletins to last 30 days — disk cache makes repeated syncs fast
  const limitDate = new Date(Date.now() - 30 * 24 * 3600000).toISOString().split('T')[0]
  const efetivo = dataInicio > limitDate ? dataInicio : limitDate

  const days = getWeekdays(efetivo, dataFim)
  const result = []
  for (const day of days) {
    try {
      const prices = await getB3DayPrices(day)
      const price = prices.get(ticker)
      if (price !== undefined) result.push({ date: day, close: price, adjustedClose: price })
    } catch (_) {
      // Trading holiday or network error — skip silently
    }
  }
  return result
}

// In-memory cache: year → Map<ticker_date, price>
const _cotahistCache = new Map()

async function fetchCotahistAnual(year) {
  if (_cotahistCache.has(year)) return _cotahistCache.get(year)

  const url = `https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_A${year}.ZIP`
  const { createRequire } = await import('module')
  const fs = await import('fs')

  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/124.0.0.0' } })
  if (!res.ok) throw new Error(`B3 COTAHIST ${year}: HTTP ${res.status}`)

  const buf = Buffer.from(await res.arrayBuffer())
  const tmpZip = `/tmp/cotahist_${year}.zip`
  const tmpTxt = `/tmp/cotahist_${year}.txt`
  fs.writeFileSync(tmpZip, buf)

  const { execSync } = await import('child_process')
  execSync(`unzip -o -p "${tmpZip}" > "${tmpTxt}"`)
  const content = fs.readFileSync(tmpTxt, 'latin1')
  fs.rmSync(tmpZip, { force: true })
  fs.rmSync(tmpTxt, { force: true })

  // Parse: tipo='01' (cotação diária), BDI='02' (lote padrão)
  // pos 0-1: tipo, 2-9: data YYYYMMDD, 10-11: BDI, 12-23: ticker (12 chars), 108-120: preço fechamento
  const byTicker = new Map()
  for (const line of content.split('\n')) {
    if (line.length < 121) continue
    if (line[0] !== '0' || line[1] !== '1') continue
    if (line[10] !== '0' || line[11] !== '2') continue
    const tkr  = line.slice(12, 24).trimEnd()
    const ds   = line.slice(2, 10)
    const dt   = `${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6, 8)}`
    const preco = parseInt(line.slice(108, 121), 10) / 100
    if (isNaN(preco)) continue
    if (!byTicker.has(tkr)) byTicker.set(tkr, [])
    byTicker.get(tkr).push({ date: dt, close: preco, adjustedClose: preco })
  }

  _cotahistCache.set(year, byTicker)
  return byTicker
}

async function fetchHistoricoB3Cotahist(ticker, dataInicio, dataFim) {
  const anoInicio = parseInt(dataInicio.slice(0, 4))
  const anoFim    = parseInt(dataFim.slice(0, 4))
  const result    = []

  for (let ano = anoInicio; ano <= anoFim; ano++) {
    try {
      const byTicker = await fetchCotahistAnual(ano)
      const registros = byTicker.get(ticker) || []
      for (const r of registros) {
        if (r.date >= dataInicio && r.date <= dataFim) result.push(r)
      }
    } catch (e) {
      registrarLog('B3_COTAHIST', ticker, null, 'aviso', `${ano}: ${e.message}`)
    }
  }
  return result
}

export async function fetchHistoricoBrapi(ticker, dataInicio, dataFim) {
  const db = getDb()
  const symbol = yahooSymbol(ticker)

  let rows = null
  let fonte = 'yahoo'

  // 1ª tentativa: Yahoo Finance
  try {
    const result = await fetchYahooChart(symbol, dataInicio, dataFim)
    if (!result?.quotes?.length) throw new Error('Sem dados para ' + ticker)
    rows = result.quotes
      .map((q) => ({
        date: q.date instanceof Date ? q.date.toISOString().split('T')[0] : String(q.date).split('T')[0],
        close: q.close,
        adjustedClose: q.adjclose ?? q.close,
      }))
      .filter((r) => r.close != null && r.date >= dataInicio && r.date <= dataFim)
  } catch (e) {
    registrarLog('yahoo', ticker, null, 'aviso', e.message)

    // 2ª tentativa: B3 boletim diário (ações B3 com cobertura de até 1 ano)
    try {
      rows = await fetchHistoricoB3(ticker, dataInicio, dataFim)
      fonte = 'B3'
      if (rows.length === 0) throw new Error('Ticker não encontrado no boletim B3')
    } catch (eB3) {
      registrarLog('B3', ticker, null, 'aviso', eB3.message)

      // 3ª tentativa: B3 COTAHIST anual (histórico completo, inclui deslistados)
      try {
        rows = await fetchHistoricoB3Cotahist(ticker, dataInicio, dataFim)
        fonte = 'B3_COTAHIST'
        if (rows.length === 0) throw new Error('Ticker não encontrado no COTAHIST B3')
      } catch (eCotahist) {
        registrarLog('B3_COTAHIST', ticker, null, 'aviso', eCotahist.message)

        // 4ª tentativa: Alpha Vantage (últimos ~100 dias)
        const alphaKey = getAlphaVantageKey()
        if (!alphaKey) {
          throw new Error(`Yahoo: ${e.message} | B3: ${eB3.message} | COTAHIST: ${eCotahist.message}. Configure a chave Alpha Vantage nas Configurações.`)
        }
        try {
          rows = await fetchHistoricoAlphaVantage(ticker, dataInicio, dataFim, alphaKey)
          fonte = 'alphavantage'
        } catch (e3) {
          registrarLog('alphavantage', ticker, null, 'erro', e3.message)
          throw new Error(`Yahoo: ${e.message} | B3: ${eB3.message} | COTAHIST: ${eCotahist.message} | Alpha Vantage: ${e3.message}`)
        }
      }
    }
  }

  const stmt = db.prepare(
    `INSERT OR IGNORE INTO cotas_cache (produto_id, data, valor, valor_ajustado, fonte)
     VALUES (?, ?, ?, ?, ?)`
  )
  const insertMany = db.transaction((produtoId, r) => {
    for (const row of r) stmt.run(produtoId, row.date, row.close, row.adjustedClose, fonte)
  })

  registrarLog(fonte, ticker, rows.length, rows.length > 0 ? 'ok' : 'sem_dados', null)
  return { rows, insertMany }
}

function _persistirEventosYahoo(ticker, events) {
  try {
    const db = getDb()
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO eventos_corporativos (ticker, data, tipo, valor, descricao, fonte)
      VALUES (?, ?, ?, ?, ?, 'yahoo')
    `)
    db.transaction(() => {
      for (const ev of Object.values(events.splits || {})) {
        const data = new Date(ev.date * 1000).toISOString().split('T')[0]
        const ratio = ev.numerator / ev.denominator
        const tipo = ratio > 1 ? 'split' : 'inplit'
        const descricao = `${ev.splitRatio || `${ev.numerator}:${ev.denominator}`}`
        stmt.run(ticker, data, tipo, ratio, descricao)
      }
      for (const ev of Object.values(events.dividends || {})) {
        const data = new Date(ev.date * 1000).toISOString().split('T')[0]
        stmt.run(ticker, data, 'dividendo', ev.amount, `R$ ${ev.amount.toFixed(4)} por ação`)
      }
    })()
  } catch (_) {}
}

export async function validarTicker(ticker) {
  const symbol = yahooSymbol(ticker)
  try {
    const q = await _yf.quote(symbol)
    if (!q) throw new Error('Ticker não encontrado')
    return { ticker, nome: q.longName || q.shortName || ticker }
  } catch (e) {
    throw new Error(`Ticker inválido ou não encontrado: ${ticker}`)
  }
}

// ── CVM (fonte de cotas de fundos) ─────────────────────────

const CVM_BASE = 'https://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS'
const CVM_HEADERS = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/124.0.0.0 Safari/537.36' }

// Cache em memória dos CSVs já baixados nesta execução (anoMes -> Map<cnpj, [{data, valor}]>)
const _cvmCache = new Map()

async function fetchCsvCVM(anoMes) {
  if (_cvmCache.has(anoMes)) return _cvmCache.get(anoMes)

  const url = `${CVM_BASE}/inf_diario_fi_${anoMes}.zip`
  const res = await fetch(url, { headers: CVM_HEADERS })
  if (!res.ok) throw new Error(`CVM ${anoMes}: HTTP ${res.status}`)

  const buf = Buffer.from(await res.arrayBuffer())
  const tmpZip = `/tmp/cvm_${anoMes}.zip`
  const tmpDir = `/tmp/cvm_${anoMes}`

  const fs = await import('fs')
  const { execSync } = await import('child_process')
  fs.writeFileSync(tmpZip, buf)
  fs.mkdirSync(tmpDir, { recursive: true })
  execSync(`unzip -o "${tmpZip}" -d "${tmpDir}"`)

  const csvFile = fs.readdirSync(tmpDir).find((f) => f.endsWith('.csv'))
  if (!csvFile) throw new Error(`CVM ${anoMes}: CSV não encontrado no ZIP`)

  const csv = fs.readFileSync(`${tmpDir}/${csvFile}`, 'latin1')
  const linhas = csv.split('\n').slice(1) // pula header

  // Agrupa por CNPJ, mantendo apenas a classe master (ID_SUBCLASSE vazio) por data.
  // Fundos com sub-classes (ICVM 175) publicam múltiplas linhas por CNPJ+data;
  // a linha com ID_SUBCLASSE vazio é a cota da classe mestre (VL_QUOTA ~1.0).
  // As demais sub-classes têm cotas acumuladas maiores e gerariam retornos falsos.
  const porCnpj = new Map()
  for (const linha of linhas) {
    const cols = linha.split(';')
    if (cols.length < 6) continue
    const cnpj      = cols[1]?.trim()
    const subclasse = cols[2]?.trim()   // vazio = classe master
    const data      = cols[3]?.trim()
    const vlQuota   = parseFloat(cols[5]?.trim())
    if (!cnpj || !data || isNaN(vlQuota)) continue
    if (!porCnpj.has(cnpj)) porCnpj.set(cnpj, new Map())
    const porData = porCnpj.get(cnpj)
    // Prefere a entrada com subclasse vazia; só aceita outra se ainda não há nenhuma para essa data
    if (!porData.has(data) || subclasse === '') {
      porData.set(data, { data, valor: vlQuota })
    }
  }
  // Converte Map<data, registro> → array por CNPJ
  for (const [cnpj, porData] of porCnpj) {
    porCnpj.set(cnpj, [...porData.values()])
  }

  // Limpa arquivos temporários
  fs.rmSync(tmpDir, { recursive: true, force: true })
  fs.rmSync(tmpZip, { force: true })

  _cvmCache.set(anoMes, porCnpj)
  return porCnpj
}

// Cache em memória do cadastral CVM (válido por 24h)
let _cvmCadCache = null
let _cvmCadTs = 0

async function getCvmCadastral() {
  if (_cvmCadCache && Date.now() - _cvmCadTs < 24 * 3600 * 1000) return _cvmCadCache
  const url = 'https://dados.cvm.gov.br/dados/FI/CAD/DADOS/cad_fi.csv'
  const res = await fetch(url, { headers: CVM_HEADERS })
  if (!res.ok) throw new Error(`CVM cadastral HTTP ${res.status}`)
  const text = await res.text()
  const lines = text.split('\n')
  const headers = lines[0].split(';')
  const idx = { cnpj: headers.indexOf('CNPJ_FUNDO'), nome: headers.indexOf('DENOM_SOCIAL'), classe: headers.indexOf('CLASSE') }
  const map = new Map()
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(';')
    if (cols.length < 3) continue
    map.set(cols[idx.cnpj]?.trim(), { nome: cols[idx.nome]?.trim(), classe: cols[idx.classe]?.trim() })
  }
  _cvmCadCache = map
  _cvmCadTs = Date.now()
  return map
}

export async function buscarFundoAnbima(cnpj) {
  const d = cnpj.replace(/\D/g, '')
  const cnpjFormatado = `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12,14)}`
  try {
    const map = await getCvmCadastral()
    const reg = map.get(cnpjFormatado) || map.get(cnpj.trim())
    if (reg?.nome) return { cnpj: cnpjFormatado, nome: reg.nome, classe: reg.classe || null }
  } catch (_) {}
  return { cnpj: cnpjFormatado, nome: null, classe: null }
}

export async function fetchCotaFundo(cnpj, dataInicio, dataFim) {
  // CVM armazena CNPJ formatado — garante o formato XX.XXX.XXX/XXXX-XX
  const d = cnpj.replace(/\D/g, '')
  const cnpjFormatado = `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12,14)}`

  // Determina quais meses cobrir
  const inicio = new Date(dataInicio)
  const fim = new Date(dataFim)
  const meses = []
  const cur = new Date(inicio.getFullYear(), inicio.getMonth(), 1)
  while (cur <= fim) {
    meses.push(cur.toISOString().slice(0, 7).replace('-', ''))
    cur.setMonth(cur.getMonth() + 1)
  }

  const cotas = []
  for (const anoMes of meses) {
    try {
      const porCnpj = await fetchCsvCVM(anoMes)
      const registros = porCnpj.get(cnpjFormatado) || []
      for (const r of registros) {
        if (r.data >= dataInicio && r.data <= dataFim) cotas.push(r)
      }
    } catch (e) {
      registrarLog('CVM', cnpj, null, 'erro', `${anoMes}: ${e.message}`)
    }
  }

  registrarLog('CVM', cnpj, cotas.length, cotas.length > 0 ? 'ok' : 'sem_dados', null)
  return cotas
}

// ── Dados macro do cache local ─────────────────────────────

export function getCDIDiarioLocal(dataInicio, dataFim) {
  const db = getDb()
  return db.prepare(
    `SELECT data, valor FROM dados_macro
     WHERE serie = 'CDI_DIARIO' AND data >= ? AND data <= ?
     ORDER BY data`
  ).all(dataInicio, dataFim)
}

export function getCDIMensalLocal(mesInicio, mesFim) {
  const db = getDb()
  return db.prepare(
    `SELECT data, valor FROM dados_macro
     WHERE serie = 'CDI_MENSAL' AND data >= ? AND data <= ?
     ORDER BY data`
  ).all(mesInicio + '-01', mesFim + '-01')
}

export function getIPCAMensalLocal(mesInicio, mesFim) {
  const db = getDb()
  return db.prepare(
    `SELECT data, valor FROM dados_macro
     WHERE serie = 'IPCA_MENSAL' AND data >= ? AND data <= ?
     ORDER BY data`
  ).all(mesInicio + '-01', mesFim + '-01')
}

// Convert YYYY-MM-DD to DD/MM/YYYY for BCB API
function toDataBR(iso) {
  return iso.split('-').reverse().join('/')
}

export async function garantirDadosMacro(dataInicio, dataFim) {
  const db = getDb()
  const mesInicio = dataInicio.slice(0, 7) + '-01'
  const mesFim = dataFim.slice(0, 7) + '-01'
  const existentes = db.prepare(
    `SELECT COUNT(*) as c FROM dados_macro WHERE serie = 'CDI_MENSAL' AND data >= ? AND data <= ?`
  ).get(mesInicio, mesFim)

  if (existentes.c === 0) {
    try {
      await fetchCDIDiario(toDataBR(dataInicio), toDataBR(dataFim))
      await fetchCDIAcumuladoMensal(toDataBR(dataInicio), toDataBR(dataFim))
      await fetchIPCAMensal(toDataBR(dataInicio), toDataBR(dataFim))
    } catch (e) {
      console.warn('[external] Não foi possível buscar dados macro:', e.message)
    }
  }

  // Garante índices de mercado (benchmarks passivos)
  const existentesIdx = db.prepare(
    `SELECT COUNT(*) as c FROM dados_macro WHERE serie = 'IBOV_MENSAL' AND data >= ? AND data <= ?`
  ).get(mesInicio, mesFim)
  if (existentesIdx.c === 0) {
    try {
      await fetchIndicesMercado(dataInicio, dataFim)
    } catch (e) {
      console.warn('[external] Não foi possível buscar índices de mercado:', e.message)
    }
  }
}

// ── Índices de Mercado (benchmarks passivos) ────────────────

const INDICES_CONFIG = [
  { serie: 'IMAB11_MENSAL', ticker: 'IMAB11.SA' },   // IMA-B proxy
  { serie: 'IRFM11_MENSAL', ticker: 'IRFM11.SA' },   // IRF-M proxy
  { serie: 'AGG_MENSAL',    ticker: 'AGG' },           // US Aggregate Bond
  { serie: 'ACWI_MENSAL',   ticker: 'ACWI' },          // MSCI ACWI (USD)
  { serie: 'IBOV_MENSAL',   ticker: '^BVSP' },         // Ibovespa
  { serie: 'IRX_MENSAL',    ticker: '^IRX' },           // T-bill 13 sem (% a.a.) — custo hedge
  { serie: 'DEBB11_MENSAL', ticker: 'DEBB11.SA' },    // IDA-DI proxy (desde jun/2022)
]

export async function fetchIndicesMercado(dataInicio, dataFim) {
  const db = getDb()

  // Busca um mês antes para calcular o retorno do primeiro mês
  const dInicio = new Date(dataInicio)
  dInicio.setMonth(dInicio.getMonth() - 1)
  const fetchStart = dInicio.toISOString().split('T')[0]

  const mesInicioCmp = dataInicio.slice(0, 7) + '-01'
  const mesFimCmp    = dataFim.slice(0, 7) + '-01'

  const stmt = db.prepare(
    `INSERT OR REPLACE INTO dados_macro (serie, data, valor, fonte) VALUES (?, ?, ?, 'Yahoo')`
  )

  let total = 0
  for (const { serie, ticker } of INDICES_CONFIG) {
    try {
      if (serie === 'IRX_MENSAL') {
        // ^IRX mensal tem nulls recentes — usa diário e pega último valor de cada mês
        const result = await _yf.chart(ticker, { period1: fetchStart, period2: dataFim, interval: '1d' })
        const byMes = {}
        for (const q of result.quotes) {
          if (q.close == null) continue
          const mes = q.date.toISOString().slice(0, 7)
          byMes[mes] = q.close  // sobrescreve; fica com o último do mês
        }
        db.transaction(() => {
          for (const [mes, valor] of Object.entries(byMes)) {
            const mesData = mes + '-01'
            if (mesData < mesInicioCmp || mesData > mesFimCmp) continue
            stmt.run(serie, mesData, valor)
            total++
          }
        })()
      } else {
        const result = await _yf.chart(ticker, { period1: fetchStart, period2: dataFim, interval: '1mo' })
        const quotes = result.quotes.filter((q) => q.close != null)

        db.transaction(() => {
          for (let i = 1; i < quotes.length; i++) {
            const prev = quotes[i - 1]
            const curr = quotes[i]
            const mesData = curr.date.toISOString().slice(0, 7) + '-01'
            if (mesData < mesInicioCmp || mesData > mesFimCmp) continue
            const pricePrev = prev.adjclose ?? prev.close
            const priceCurr = curr.adjclose ?? curr.close
            stmt.run(serie, mesData, (priceCurr / pricePrev - 1) * 100)
            total++
          }
        })()
      }
    } catch (e) {
      console.warn(`[indices] Falha em ${ticker}:`, e.message)
    }
  }
  return total
}
