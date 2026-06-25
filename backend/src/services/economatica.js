import { getDb } from '../db/database.js'
import { createReadStream, existsSync, mkdirSync, openSync, readSync, closeSync, rmSync, statSync } from 'fs'
import { createInterface } from 'readline'
import { downloadToFile, registrarLog } from './external.js'

// Feeds disponíveis. As URLs ficam em `configuracoes` (chave abaixo) e são
// tratadas como sensíveis em routes/config.js (são tokens de acesso).
// `fundos` fica para a Fase 2 (precisa de ponte nome↔CNPJ + URL corrigida).
const FEEDS = [
  { feed: 'acoes',     chave: 'economatica_url_acoes',     tipo: 'ativos' },
  { feed: 'fiis',      chave: 'economatica_url_fiis',      tipo: 'ativos' },
  { feed: 'etfs',      chave: 'economatica_url_etfs',      tipo: 'ativos' },
  { feed: 'indices',   chave: 'economatica_url_indices',   tipo: 'indices' },
  { feed: 'papeis_rf', chave: 'economatica_url_papeis_rf', tipo: 'papeis_rf' },
]

// Nome do índice no feed (após strip do sufixo) → série em dados_macro.
// Mesmas séries que import_indices_diario.mjs consome. CDI/IPCA/DOL ficam de
// fora: têm semântica diferente do CDI/IPCA do BCB já usados pelo app.
const INDICE_SERIE = {
  'IBOV':  'IBOV_DIARIO',
  'IMA-B': 'IMAB_DIARIO',
  'IRF-M': 'IRFM_DIARIO',
  'IFIX':  'IFIX_DIARIO',
  'IHFA':  'IHFA_DIARIO',
}

const CACHE_DIR = '/tmp/economatica-cache'
const BATCH = 50000

// Os feeds trazem histórico completo (IBOV desde 1967, papeis_rf desde 1990). O
// app só usa de 2019 em diante — ignoramos datas anteriores para não inchar o banco.
const DATA_MINIMA = '2019-01-01'

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true })
}

// Split CSV simples: campos separados por vírgula, sem vírgulas internas;
// remove aspas externas. Cobre tanto o formato de 3 colunas quanto os largos.
function splitCsv(line) {
  return line.split(',').map((f) => {
    f = f.trim()
    return f.startsWith('"') && f.endsWith('"') ? f.slice(1, -1) : f
  })
}

// Descobre, pelo cabeçalho, a coluna do preço AJUSTADO por proventos (total return).
// Feeds simples (etfs/indices/papeis_rf): 3 colunas, valor na 3ª ("...|ajust p/ prov|...").
// Feeds largos (OHLCV): ações usam 'adj_close_price'; FIIs usam 'preco_fechamento_aj'.
function acharColunaValor(headerFields) {
  const norm = headerFields.map((h) => h.toLowerCase())
  for (const nome of ['adj_close_price', 'preco_fechamento_aj']) {
    const i = norm.indexOf(nome)
    if (i >= 0) return i
  }
  if (headerFields.length === 3) return 2
  throw new Error('cabeçalho sem coluna de preço ajustado reconhecida')
}

const stripSufixo = (ativo) => ativo.split('<')[0].trim()

// Lê só os primeiros bytes do arquivo (evita carregar feeds de centenas de MB).
function headBytes(path, n = 64) {
  const fd = openSync(path, 'r')
  try {
    const b = Buffer.alloc(n)
    const r = readSync(fd, b, 0, n, 0)
    return b.slice(0, r).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

// Baixa o feed para arquivo temporário, seguindo o redirect 302 → S3 (presigned
// de vida curta) imediatamente. Retenta porque a URL assinada pode expirar.
async function baixarFeed(url, destPath, feed) {
  let ultimoErro = null
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      await downloadToFile(url, destPath)
      // S3 devolve XML de erro com status 200/403 → detecta pelo início do arquivo
      if (headBytes(destPath).startsWith('<')) throw new Error('resposta inválida (presigned expirou?)')
      if (statSync(destPath).size < 64) throw new Error('arquivo vazio')
      return
    } catch (e) {
      ultimoErro = e
      try { rmSync(destPath, { force: true }) } catch (_) {}
      if (tentativa < 3) await new Promise((r) => setTimeout(r, 500))
    }
  }
  throw new Error(`download falhou após 3 tentativas: ${ultimoErro?.message}`)
}

// Lê o arquivo por streaming e descarrega em lotes (memória limitada mesmo no
// feed de 115 MB). `onRow(parsed)` devolve 0+ linhas a inserir; `flush(rows)` é
// uma transação better-sqlite3.
function processarArquivo(filePath, onRow, flush) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity })
    let batch = []
    let total = 0
    let valueCol = -1  // < 0 até o cabeçalho ser lido
    rl.on('line', (line) => {
      if (valueCol < 0) {  // primeira linha = cabeçalho
        try { valueCol = acharColunaValor(splitCsv(line)) }
        catch (e) { rl.close(); reject(e); return }
        return
      }
      const fields = splitCsv(line)
      const data = fields[1]
      if (!data || data < DATA_MINIMA) return
      const raw = fields[valueCol]
      if (raw == null || raw === '-' || raw === '') return
      const valor = parseFloat(raw)
      if (isNaN(valor)) return
      const rows = onRow({ ativo: fields[0], data, valor })
      if (rows && rows.length) {
        for (const r of rows) batch.push(r)
        if (batch.length >= BATCH) { flush(batch); total += batch.length; batch = [] }
      }
    })
    rl.on('close', () => {
      if (batch.length) { flush(batch); total += batch.length }
      resolve(total)
    })
    rl.on('error', reject)
  })
}

// Ativos (acoes/fiis/etfs) → cotas_cache, fonte economatica e imutável.
async function importarAtivos(db, filePath) {
  // ticker (identificador) → todos os produto_ids
  const tickerProdutos = new Map()
  for (const p of db.prepare(`SELECT identificador, id FROM produtos WHERE identificador IS NOT NULL`).all()) {
    const k = p.identificador
    if (!tickerProdutos.has(k)) tickerProdutos.set(k, [])
    tickerProdutos.get(k).push(p.id)
  }

  // Mesmo upsert imutável de import_economatica.mjs: economatica sobrescreve a si
  // mesma; valor_ajustado=NULL evita double-counting de proventos.
  const stmt = db.prepare(`
    INSERT INTO cotas_cache (produto_id, data, valor, valor_ajustado, fonte)
    VALUES (?, ?, ?, NULL, 'economatica')
    ON CONFLICT(produto_id, data) DO UPDATE SET
      valor          = excluded.valor,
      valor_ajustado = NULL,
      fonte          = 'economatica'
  `)
  const flush = db.transaction((rows) => { for (const r of rows) stmt.run(r.pid, r.data, r.valor) })

  return processarArquivo(filePath, (p) => {
    if (p.valor <= 0) return null
    const ticker = stripSufixo(p.ativo)
    const pids = tickerProdutos.get(ticker)
    if (!pids) return null
    return pids.map((pid) => ({ pid, data: p.data, valor: p.valor }))
  }, flush)
}

// Índices → dados_macro séries *_DIARIO (níveis), fonte economatica imutável.
async function importarIndices(db, filePath) {
  const stmt = db.prepare(`
    INSERT INTO dados_macro (serie, data, valor, fonte)
    VALUES (?, ?, ?, 'economatica')
    ON CONFLICT(serie, data) DO UPDATE SET valor = excluded.valor, fonte = 'economatica'
  `)
  const flush = db.transaction((rows) => { for (const r of rows) stmt.run(r.serie, r.data, r.valor) })

  return processarArquivo(filePath, (p) => {
    if (p.valor <= 0) return null
    const serie = INDICE_SERIE[stripSufixo(p.ativo)]
    if (!serie) return null
    return [{ serie, data: p.data, valor: p.valor }]
  }, flush)
}

// papeis_rf → tabela staging crua (mantém o sufixo no ativo).
async function importarPapeisRF(db, filePath) {
  const stmt = db.prepare(`
    INSERT INTO economatica_papeis_rf (ativo, data, valor)
    VALUES (?, ?, ?)
    ON CONFLICT(ativo, data) DO UPDATE SET valor = excluded.valor
  `)
  const flush = db.transaction((rows) => { for (const r of rows) stmt.run(r.ativo, r.data, r.valor) })

  return processarArquivo(filePath, (p) => {
    if (!isFinite(p.valor)) return null
    return [{ ativo: p.ativo, data: p.data, valor: p.valor }]
  }, flush)
}

export function importarPorTipo(db, tipo, filePath) {
  if (tipo === 'ativos')    return importarAtivos(db, filePath)
  if (tipo === 'indices')   return importarIndices(db, filePath)
  if (tipo === 'papeis_rf') return importarPapeisRF(db, filePath)
  throw new Error(`tipo de feed desconhecido: ${tipo}`)
}

function getUrl(db, chave) {
  const r = db.prepare(`SELECT valor FROM configuracoes WHERE chave = ?`).get(chave)
  return r?.valor?.trim() || null
}

// Já captado com sucesso hoje? Evita rebaixar ~130 MB a cada sync-all.
function captadoHoje(db, feed) {
  return !!db.prepare(
    `SELECT 1 FROM log_captacao
     WHERE fonte = 'economatica' AND ativo = ? AND status = 'ok' AND date(timestamp) = date('now')
     LIMIT 1`
  ).get(feed)
}

export async function sincronizarEconomatica() {
  const db = getDb()
  ensureCacheDir()
  const resultado = {}
  const pulados = []
  const erros = []

  for (const { feed, chave, tipo } of FEEDS) {
    const url = getUrl(db, chave)
    if (!url) continue                    // feed não configurado
    if (captadoHoje(db, feed)) { pulados.push(feed); continue }

    const destPath = `${CACHE_DIR}/${feed}.csv`
    try {
      await baixarFeed(url, destPath, feed)
      const n = await importarPorTipo(db, tipo, destPath)
      resultado[feed] = n
      registrarLog('economatica', feed, n, 'ok', null)
    } catch (e) {
      erros.push(`${feed}: ${e.message}`)
      registrarLog('economatica', feed, null, 'erro', e.message)
      console.warn(`[economatica] falha no feed ${feed}:`, e.message)
    } finally {
      try { rmSync(destPath, { force: true }) } catch (_) {}
    }
  }

  return { resultado, pulados, erros }
}
