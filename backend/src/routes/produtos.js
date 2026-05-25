import { Router } from 'express'
import { getDb } from '../db/database.js'

const router = Router()

// GET /api/estados/:estadoId/produtos
router.get('/estados/:estadoId/produtos', (req, res) => {
  const db = getDb()
  const rows = db.prepare(
    'SELECT * FROM produtos WHERE estado_id = ? ORDER BY classe, nome'
  ).all(req.params.estadoId)
  res.json(rows)
})

// POST /api/estados/:estadoId/produtos
router.post('/estados/:estadoId/produtos', (req, res) => {
  const db = getDb()
  const {
    tipo, classe, nome, identificador,
    peso, indexador, tipo_cdi, taxa,
    data_emissao, data_vencimento,
  } = req.body

  if (!['fundo', 'acao', 'rf_curva'].includes(tipo)) {
    return res.status(400).json({ error: 'Tipo inválido' })
  }

  const result = db.prepare(`
    INSERT INTO produtos
      (estado_id, tipo, classe, nome, identificador, peso, indexador, tipo_cdi, taxa, data_emissao, data_vencimento)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.params.estadoId, tipo, classe, nome,
    identificador || null, peso || 0,
    indexador || null, tipo_cdi || null, taxa || null,
    data_emissao || null, data_vencimento || null,
  )

  const created = db.prepare('SELECT * FROM produtos WHERE id = ?').get(result.lastInsertRowid)
  res.json(created)
})

// PUT /api/produtos/:id
router.put('/:id', (req, res) => {
  const db = getDb()
  const {
    tipo, classe, nome, identificador,
    peso, indexador, tipo_cdi, taxa,
    data_emissao, data_vencimento,
  } = req.body

  db.prepare(`
    UPDATE produtos SET
      tipo = ?, classe = ?, nome = ?, identificador = ?,
      peso = ?, indexador = ?, tipo_cdi = ?, taxa = ?,
      data_emissao = ?, data_vencimento = ?
    WHERE id = ?
  `).run(
    tipo, classe, nome, identificador || null,
    peso || 0, indexador || null, tipo_cdi || null, taxa || null,
    data_emissao || null, data_vencimento || null,
    req.params.id,
  )

  const updated = db.prepare('SELECT * FROM produtos WHERE id = ?').get(req.params.id)
  res.json(updated)
})

// DELETE /api/produtos/:id
router.delete('/:id', (req, res) => {
  const db = getDb()
  db.prepare('DELETE FROM produtos WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

export default router
