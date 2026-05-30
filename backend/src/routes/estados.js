import { Router } from 'express'
import { getDb } from '../db/database.js'

const router = Router()

// PUT /api/estados/:id
router.put('/:id', (req, res) => {
  const db = getDb()
  const { data_inicio, data_fim, notas } = req.body
  if (data_fim && data_inicio && data_fim < data_inicio) {
    return res.status(400).json({ error: 'data_fim não pode ser anterior a data_inicio' })
  }
  db.prepare(
    'UPDATE estados_portfolio SET data_inicio = ?, data_fim = ?, notas = ? WHERE id = ?'
  ).run(data_inicio, data_fim || null, notas ?? null, req.params.id)
  res.json({ ok: true })
})

// DELETE /api/estados/:id
router.delete('/:id', (req, res) => {
  const db = getDb()
  db.prepare('DELETE FROM estados_portfolio WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

export default router
