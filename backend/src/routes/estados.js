import { Router } from 'express'
import { getDb } from '../db/database.js'

const router = Router()

// PUT /api/estados/:id
router.put('/:id', (req, res) => {
  const db = getDb()
  const { data_inicio, data_fim } = req.body
  db.prepare(
    'UPDATE estados_portfolio SET data_inicio = ?, data_fim = ? WHERE id = ?'
  ).run(data_inicio, data_fim || null, req.params.id)
  res.json({ ok: true })
})

// DELETE /api/estados/:id
router.delete('/:id', (req, res) => {
  const db = getDb()
  db.prepare('DELETE FROM estados_portfolio WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

export default router
