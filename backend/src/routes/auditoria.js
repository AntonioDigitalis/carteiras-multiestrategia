import { Router } from 'express'
import { getDb } from '../db/database.js'

const router = Router()

// GET /api/auditoria/alertas
router.get('/alertas', (req, res) => {
  const db = getDb()
  const { status, categoria } = req.query
  let q = `
    SELECT aa.*,
      c.id   AS carteira_id,
      c.nome AS carteira_nome,
      pf.nome AS perfil_nome
    FROM alertas_auditoria aa
    LEFT JOIN produtos pr       ON aa.produto_id = pr.id
    LEFT JOIN estados_portfolio ep ON pr.estado_id = ep.id
    LEFT JOIN carteiras c       ON ep.carteira_id = c.id
    LEFT JOIN perfis pf         ON c.perfil_id = pf.id
    WHERE 1=1
  `
  const params = []

  if (status) { q += ' AND aa.status = ?'; params.push(status) }
  if (categoria) { q += ' AND aa.categoria = ?'; params.push(categoria) }

  q += ' ORDER BY aa.created_at DESC LIMIT 200'
  const rows = db.prepare(q).all(...params)
  res.json(rows)
})

// PUT /api/auditoria/alertas/:id
router.put('/alertas/:id', (req, res) => {
  const db = getDb()
  const { status } = req.body
  if (!['ativo', 'revisado', 'ignorar'].includes(status)) {
    return res.status(400).json({ error: 'Status inválido' })
  }
  db.prepare(
    `UPDATE alertas_auditoria SET status = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(status, req.params.id)
  res.json({ ok: true })
})

// GET /api/auditoria/saude
router.get('/saude', (req, res) => {
  const db = getDb()

  // Todos os meses com estados cadastrados
  const meses = db.prepare(
    'SELECT DISTINCT mes FROM estados_portfolio ORDER BY mes'
  ).all().map((r) => r.mes)

  // Status de dados macro por mês
  const macro = meses.map((mes) => {
    const cdi = db.prepare(
      "SELECT COUNT(*) as n FROM dados_macro WHERE serie='CDI_MENSAL' AND data=?"
    ).get(mes + '-01').n > 0
    const ipca = db.prepare(
      "SELECT COUNT(*) as n FROM dados_macro WHERE serie='IPCA_MENSAL' AND data=?"
    ).get(mes + '-01').n > 0
    return { mes, cdi, ipca }
  })

  // Todos os produtos agrupados por (nome, identificador), excluindo rf_curva
  const rows = db.prepare(`
    SELECT p.id, p.nome, p.tipo, p.identificador, p.classe, e.mes, e.carteira_id,
      c.nome AS carteira_nome, pf.nome AS perfil_nome
    FROM produtos p
    JOIN estados_portfolio e ON p.estado_id = e.id
    JOIN carteiras c ON e.carteira_id = c.id
    JOIN perfis pf ON c.perfil_id = pf.id
    ORDER BY p.nome, e.mes
  `).all()

  // Agrupar por (nome, identificador)
  const prodMap = new Map()
  for (const r of rows) {
    const key = `${r.tipo}__${r.nome}__${r.identificador ?? ''}`
    if (!prodMap.has(key)) {
      prodMap.set(key, { nome: r.nome, tipo: r.tipo, identificador: r.identificador, classe: r.classe, periodos: [], carteira_ids: new Set() })
    }
    prodMap.get(key).carteira_ids.add(r.carteira_id)
    let status, n_cotas = null, nota = null
    if (r.tipo === 'rf_curva') {
      // RF curva precisa de dados macro (CDI ou IPCA)
      const macroMes = macro.find((m) => m.mes === r.mes)
      status = macroMes?.cdi ? 'ok' : 'sem_macro'
      nota = 'Usa dados macro'
    } else {
      n_cotas = db.prepare('SELECT COUNT(*) as n FROM cotas_cache WHERE produto_id=?').get(r.id).n
      status = n_cotas > 0 ? 'ok' : 'sem_cotas'
    }
    prodMap.get(key).periodos.push({ mes: r.mes, produto_id: r.id, n_cotas, status, nota })
  }

  const produtos = Array.from(prodMap.values()).map((p) => ({
    ...p,
    carteira_ids: Array.from(p.carteira_ids),
  }))

  // Auto-gerar alertas para dados faltantes (sem duplicatas)
  const alertaStmt = db.prepare(`
    INSERT INTO alertas_auditoria (tipo, categoria, titulo, ativo, descricao)
    SELECT 'warning', 'macro', ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM alertas_auditoria WHERE titulo=? AND ativo=? AND status='ativo'
    )
  `)
  const cotaStmt = db.prepare(`
    INSERT INTO alertas_auditoria (tipo, categoria, titulo, ativo, descricao)
    SELECT 'error', 'cotas', ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM alertas_auditoria WHERE titulo=? AND ativo=? AND status='ativo'
    )
  `)

  db.transaction(() => {
    for (const m of macro) {
      if (!m.cdi) {
        const t = `CDI mensal ausente — ${m.mes}`
        alertaStmt.run(t, m.mes, `CDI mensal não disponível para ${m.mes}. Busque dados macro na aba Auditoria.`, t, m.mes)
      }
    }
    for (const p of produtos) {
      if (p.tipo === 'rf_curva') continue
      const missing = p.periodos.filter((pe) => pe.status === 'sem_cotas').map((pe) => pe.mes)
      if (missing.length > 0) {
        const id = p.identificador || p.nome
        const t = `Cotas ausentes: ${p.nome.slice(0, 40)}`
        cotaStmt.run(t, id, `Sem cotas em ${missing.join(', ')}. Sincronize na tela de Gestão.`, t, id)
      }
    }
  })()

  const carteiras = db.prepare(`
    SELECT DISTINCT c.id, c.nome, pf.nome AS perfil_nome
    FROM estados_portfolio ep
    JOIN carteiras c ON ep.carteira_id = c.id
    JOIN perfis pf ON c.perfil_id = pf.id
    ORDER BY pf.nome, c.nome
  `).all()

  res.json({ macro, produtos, meses, carteiras })
})

// GET /api/auditoria/eventos
router.get('/eventos', (req, res) => {
  const db = getDb()
  const { ticker, tipo } = req.query
  let q = `SELECT * FROM eventos_corporativos WHERE 1=1`
  const params = []
  if (ticker) { q += ' AND ticker = ?'; params.push(ticker) }
  if (tipo) { q += ' AND tipo = ?'; params.push(tipo) }
  q += ' ORDER BY data DESC, ticker LIMIT 500'
  res.json(db.prepare(q).all(...params))
})

// PUT /api/auditoria/eventos/:id/revisar
router.put('/eventos/:id/revisar', (req, res) => {
  const db = getDb()
  db.prepare('UPDATE eventos_corporativos SET revisado = 1 WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// GET /api/auditoria/log
router.get('/log', (req, res) => {
  const db = getDb()
  const rows = db.prepare(
    'SELECT * FROM log_captacao ORDER BY timestamp DESC LIMIT 500'
  ).all()
  res.json(rows)
})

export default router
