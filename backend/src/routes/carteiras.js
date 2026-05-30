import { Router } from 'express'
import { getDb } from '../db/database.js'
import { calcularMetricas, calcularAtribuicao, calcularPassiva, otimizarCarteira, otimizarDentroClasse, calcularDadosExcel } from '../services/calculator.js'
import { garantirDadosMacro, fetchHistoricoBrapi } from '../services/external.js'

const router = Router()

// Previne syncs concorrentes do mesmo ticker (TOCTOU entre requests simultâneos)
const _syncInProgress = new Set()

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
function isValidDate(s) {
  return typeof s === 'string' && DATE_RE.test(s) && !isNaN(Date.parse(s))
}
function validateDateRange(start, end, res) {
  if (start && !isValidDate(start)) { res.status(400).json({ error: 'start deve ser YYYY-MM-DD' }); return false }
  if (end   && !isValidDate(end))   { res.status(400).json({ error: 'end deve ser YYYY-MM-DD' });   return false }
  return true
}

// GET /api/carteiras
router.get('/', (req, res) => {
  const db = getDb()
  const rows = db.prepare(`
    SELECT c.*, p.nome as perfil_nome
    FROM carteiras c
    JOIN perfis p ON c.perfil_id = p.id
    ORDER BY p.ordem, c.tipo
  `).all()
  res.json(rows)
})

// GET /api/carteiras/:id
router.get('/:id', (req, res) => {
  const db = getDb()
  const row = db.prepare(`
    SELECT c.*, p.nome as perfil_nome
    FROM carteiras c
    JOIN perfis p ON c.perfil_id = p.id
    WHERE c.id = ?
  `).get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Carteira não encontrada' })
  res.json(row)
})

// PUT /api/carteiras/:id
router.put('/:id', (req, res) => {
  const db = getDb()
  const { nome, descricao } = req.body
  db.prepare('UPDATE carteiras SET nome = ?, descricao = ? WHERE id = ?')
    .run(nome, descricao, req.params.id)
  res.json({ ok: true })
})

// POST /api/carteiras
router.post('/', (req, res) => {
  const db = getDb()
  const { nome, perfil_id, tipo } = req.body
  if (!nome?.trim() || !perfil_id) return res.status(400).json({ error: 'nome e perfil_id obrigatórios' })
  const perfil = db.prepare('SELECT id FROM perfis WHERE id = ?').get(perfil_id)
  if (!perfil) return res.status(400).json({ error: 'Perfil não encontrado' })
  const result = db.prepare(
    `INSERT INTO carteiras (perfil_id, tipo, nome, descricao, created_at) VALUES (?, ?, ?, null, datetime('now'))`
  ).run(perfil_id, tipo?.trim() || 'A', nome.trim())
  res.json({ id: result.lastInsertRowid, nome: nome.trim(), perfil_id, tipo: tipo || 'A' })
})

// POST /api/carteiras/importar-composicao
router.post('/importar-composicao', (req, res) => {
  const db = getDb()
  const { carteiras: payload } = req.body
  if (!Array.isArray(payload)) return res.status(400).json({ error: 'payload deve ser { carteiras: [...] }' })

  const tipoParaClasse = { acoes: 'rv_brasil', fiis: 'fundos_listados' }
  const todasCarteiras = db.prepare(`
    SELECT c.id, c.perfil_id, c.nome, p.nome as perfil_nome
    FROM carteiras c JOIN perfis p ON c.perfil_id = p.id
  `).all()

  const results = []
  const erros = []

  const importar = db.transaction(() => {
    for (const c of payload) {
      const nomeBusca = c.nome.replace(/\s*XP\s*$/i, '').trim().toLowerCase()
      const match = todasCarteiras.find((n) => n.nome.toLowerCase() === nomeBusca)
      if (!match) {
        erros.push(`Carteira não encontrada: "${c.nome}" (buscou "${nomeBusca}")`)
        continue
      }

      const classe = tipoParaClasse[c.tipo]
      if (!classe) {
        erros.push(`Tipo desconhecido: "${c.tipo}" em "${c.nome}"`)
        continue
      }

      const historico = [...c.historico].sort((a, b) => a.periodo.localeCompare(b.periodo))
      let estadosInseridos = 0
      let produtosInseridos = 0

      const stmtAloc = db.prepare(`
        INSERT INTO alocacoes_macro
          (perfil_id, mes, pos_fixado, inflacao, prefixado, rf_global, multimercado, rv_brasil, rv_global, fundos_listados, alternativos)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(perfil_id, mes) DO UPDATE SET
          pos_fixado = excluded.pos_fixado, inflacao = excluded.inflacao,
          prefixado = excluded.prefixado, rf_global = excluded.rf_global,
          multimercado = excluded.multimercado, rv_brasil = excluded.rv_brasil,
          rv_global = excluded.rv_global, fundos_listados = excluded.fundos_listados,
          alternativos = excluded.alternativos, updated_at = datetime('now')
      `)
      const stmtEstado = db.prepare(
        `INSERT INTO estados_portfolio (carteira_id, mes, data_inicio, data_fim) VALUES (?, ?, ?, ?)`
      )
      const stmtProd = db.prepare(
        `INSERT INTO produtos (estado_id, tipo, classe, nome, identificador, peso) VALUES (?, ?, ?, ?, ?, ?)`
      )

      for (let i = 0; i < historico.length; i++) {
        const entry = historico[i]
        const dataInicio = entry.periodo.length === 7 ? entry.periodo + '-01' : entry.periodo
        const mes = dataInicio.slice(0, 7)

        let dataFim = null
        if (i + 1 < historico.length) {
          const nextStart = historico[i + 1].periodo.length === 7
            ? historico[i + 1].periodo + '-01'
            : historico[i + 1].periodo
          const d = new Date(nextStart + 'T00:00:00Z')
          d.setUTCDate(d.getUTCDate() - 1)
          dataFim = d.toISOString().split('T')[0]
        }

        const alocObj = { pos_fixado: 0, inflacao: 0, prefixado: 0, rf_global: 0, multimercado: 0, rv_brasil: 0, rv_global: 0, fundos_listados: 0, alternativos: 0 }
        alocObj[classe] = 100
        stmtAloc.run(match.perfil_id, mes,
          alocObj.pos_fixado, alocObj.inflacao, alocObj.prefixado, alocObj.rf_global,
          alocObj.multimercado, alocObj.rv_brasil, alocObj.rv_global, alocObj.fundos_listados, alocObj.alternativos)

        const validos = entry.composicao.filter((x) => x.peso > 0)
        if (validos.length === 0) continue

        const somaPesos = validos.reduce((s, x) => s + x.peso, 0)

        const estResult = stmtEstado.run(match.id, mes, dataInicio, dataFim)
        const estadoId = estResult.lastInsertRowid
        estadosInseridos++

        for (const p of validos) {
          const pesoNorm = parseFloat(((p.peso / somaPesos) * 100).toFixed(6))
          stmtProd.run(estadoId, 'acao', classe, p.ticker, p.ticker, pesoNorm)
          produtosInseridos++
        }
      }

      results.push({ carteira: c.nome, matched: match.nome, estadosInseridos, produtosInseridos })
    }
  })

  try {
    importar()
    res.json({ ok: true, results, erros })
  } catch (e) {
    console.error('[importar-composicao]', e)
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/carteiras/:id
router.delete('/:id', (req, res) => {
  const db = getDb()
  const id = Number(req.params.id)
  const estados = db.prepare('SELECT COUNT(*) as n FROM estados_portfolio WHERE carteira_id = ?').get(id)
  if (estados.n > 0) return res.status(400).json({ error: 'Remova os estados desta carteira antes de excluí-la' })
  db.prepare('DELETE FROM carteiras WHERE id = ?').run(id)
  res.json({ ok: true })
})

// GET /api/carteiras/:id/alocacoes
router.get('/:id/alocacoes', (req, res) => {
  const db = getDb()
  const carteira = db.prepare('SELECT perfil_id FROM carteiras WHERE id = ?').get(req.params.id)
  if (!carteira) return res.status(404).json({ error: 'Carteira não encontrada' })

  const rows = db.prepare(
    `SELECT * FROM alocacoes_macro WHERE perfil_id = ? ORDER BY mes DESC`
  ).all(carteira.perfil_id)
  res.json(rows)
})

// POST /api/carteiras/:id/alocacoes
router.post('/:id/alocacoes', (req, res) => {
  const db = getDb()
  const carteira = db.prepare('SELECT perfil_id FROM carteiras WHERE id = ?').get(req.params.id)
  if (!carteira) return res.status(404).json({ error: 'Carteira não encontrada' })

  const { mes, pos_fixado, inflacao, prefixado, rf_global, multimercado, rv_brasil, rv_global, fundos_listados, alternativos } = req.body
  const soma = (pos_fixado || 0) + (inflacao || 0) + (prefixado || 0) + (rf_global || 0) +
    (multimercado || 0) + (rv_brasil || 0) + (rv_global || 0) + (fundos_listados || 0) + (alternativos || 0)

  if (Math.abs(soma - 100) > 0.1) {
    return res.status(400).json({ error: `Soma dos pesos deve ser 100%. Atual: ${soma.toFixed(2)}%` })
  }

  const result = db.prepare(`
    INSERT INTO alocacoes_macro
      (perfil_id, mes, pos_fixado, inflacao, prefixado, rf_global, multimercado, rv_brasil, rv_global, fundos_listados, alternativos)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(perfil_id, mes) DO UPDATE SET
      pos_fixado = excluded.pos_fixado,
      inflacao = excluded.inflacao,
      prefixado = excluded.prefixado,
      rf_global = excluded.rf_global,
      multimercado = excluded.multimercado,
      rv_brasil = excluded.rv_brasil,
      rv_global = excluded.rv_global,
      fundos_listados = excluded.fundos_listados,
      alternativos = excluded.alternativos,
      updated_at = datetime('now')
  `).run(carteira.perfil_id, mes,
    pos_fixado || 0, inflacao || 0, prefixado || 0, rf_global || 0,
    multimercado || 0, rv_brasil || 0, rv_global || 0, fundos_listados || 0, alternativos || 0)

  res.json({ id: result.lastInsertRowid, ok: true })
})

// GET /api/carteiras/:id/meses-com-estados
router.get('/:id/meses-com-estados', (req, res) => {
  const db = getDb()
  const rows = db.prepare(
    `SELECT DISTINCT ep.mes FROM estados_portfolio ep
     JOIN produtos p ON p.estado_id = ep.id
     WHERE ep.carteira_id = ?
     ORDER BY ep.mes`
  ).all(req.params.id)
  res.json(rows.map((r) => r.mes))
})

// GET /api/carteiras/:id/estados?mes=YYYY-MM
router.get('/:id/estados', (req, res) => {
  const db = getDb()
  const { mes } = req.query
  const rows = db.prepare(
    `SELECT * FROM estados_portfolio WHERE carteira_id = ? AND mes = ? ORDER BY data_inicio`
  ).all(req.params.id, mes)

  // Para cada estado, buscar os produtos
  const result = rows.map((e) => ({
    ...e,
    produtos: db.prepare('SELECT * FROM produtos WHERE estado_id = ? ORDER BY classe, nome').all(e.id),
  }))

  res.json(result)
})

// POST /api/carteiras/:id/estados
router.post('/:id/estados', (req, res) => {
  const db = getDb()
  const { mes, data_inicio, data_fim } = req.body
  const result = db.prepare(
    `INSERT INTO estados_portfolio (carteira_id, mes, data_inicio, data_fim)
     VALUES (?, ?, ?, ?)`
  ).run(req.params.id, mes, data_inicio, data_fim || null)

  res.json({
    id: result.lastInsertRowid,
    carteira_id: req.params.id,
    mes,
    data_inicio,
    data_fim: data_fim || null,
    produtos: [],
  })
})

// GET /api/carteiras/:id/metricas
router.get('/:id/metricas', async (req, res) => {
  try {
    const { start, end } = req.query
    if (!validateDateRange(start, end, res)) return
    const efStart = start || '2020-01-01'
    const efEnd = end || new Date().toISOString().split('T')[0]
    await garantirDadosMacro(efStart, efEnd)
    const metricas = calcularMetricas(Number(req.params.id), start || null, end || null)
    if (!metricas) return res.json(null)
    res.json(metricas)
  } catch (e) {
    console.error('[metricas]', e)
    res.status(500).json({ error: e.message })
  }
})

// GET /api/carteiras/:id/atribuicao
router.get('/:id/atribuicao', (req, res) => {
  try {
    const { start, end } = req.query
    if (!validateDateRange(start, end, res)) return
    const data = calcularAtribuicao(Number(req.params.id), start || null, end || null)
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/carteiras/:id/passiva
router.get('/:id/passiva', async (req, res) => {
  try {
    const { start, end } = req.query
    if (!validateDateRange(start, end, res)) return
    const efStart = start || '2020-01-01'
    const efEnd = end || new Date().toISOString().split('T')[0]
    await garantirDadosMacro(efStart, efEnd)
    const data = calcularPassiva(Number(req.params.id), start || null, end || null)
    if (!data) return res.json(null)
    res.json(data)
  } catch (e) {
    console.error('[passiva]', e)
    res.status(500).json({ error: e.message })
  }
})

// POST /api/carteiras/:id/otimizar
router.post('/:id/otimizar', (req, res) => {
  try {
    const { start, end, n_simulacoes, min_peso, max_peso } = req.body
    const minP = min_peso ?? 0
    const maxP = max_peso ?? 100
    if (minP < 0 || minP > 100) return res.status(400).json({ error: 'min_peso deve estar entre 0 e 100' })
    if (maxP < 0 || maxP > 100) return res.status(400).json({ error: 'max_peso deve estar entre 0 e 100' })
    if (minP > maxP) return res.status(400).json({ error: `min_peso (${minP}%) não pode ser maior que max_peso (${maxP}%)` })
    const data = otimizarCarteira(Number(req.params.id), start || null, end || null, n_simulacoes ?? 5000, minP / 100, maxP / 100)
    if (!data) return res.json(null)
    res.json(data)
  } catch (e) {
    console.error('[otimizar]', e)
    res.status(500).json({ error: e.message })
  }
})

// GET /api/carteiras/:id/ativos-classe?classe=X
router.get('/:id/ativos-classe', (req, res) => {
  const { classe } = req.query
  if (!classe) return res.status(400).json({ error: 'classe obrigatória' })
  try {
    const db = getDb()
    // Usa o nome do estado mais recente para cada identificador (evita duplicatas
    // quando o mesmo ticker tem nomes diferentes em estados distintos, ex: CPLE6→CPLE3)
    const ativos = db.prepare(`
      WITH max_mes AS (
        SELECT p.identificador, MAX(ep.mes) AS mes
        FROM produtos p
        JOIN estados_portfolio ep ON p.estado_id = ep.id
        WHERE ep.carteira_id = ? AND p.classe = ? AND p.identificador IS NOT NULL
        GROUP BY p.identificador
      ),
      max_estado AS (
        SELECT p.identificador, MAX(ep.id) AS estado_id
        FROM produtos p
        JOIN estados_portfolio ep ON p.estado_id = ep.id
        JOIN max_mes mm ON p.identificador = mm.identificador AND ep.mes = mm.mes
        WHERE ep.carteira_id = ? AND p.classe = ?
        GROUP BY p.identificador
      )
      SELECT p.nome, p.identificador, p.tipo, p.classe
      FROM produtos p
      JOIN max_estado me ON p.estado_id = me.estado_id AND p.identificador = me.identificador
      ORDER BY p.nome
    `).all(Number(req.params.id), classe, Number(req.params.id), classe)
    res.json(ativos)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/carteiras/:id/otimizar-classe
router.post('/:id/otimizar-classe', async (req, res) => {
  try {
    const { classe, ativos, n_simulacoes, start, end, min_peso, max_peso } = req.body
    if (!classe) return res.status(400).json({ error: 'classe obrigatória' })
    if (!ativos || ativos.length < 2) return res.status(400).json({ error: 'Informe ao menos 2 ativos' })
    const minP = min_peso ?? 0
    const maxP = max_peso ?? 100
    if (minP < 0 || minP > 100) return res.status(400).json({ error: 'min_peso deve estar entre 0 e 100' })
    if (maxP < 0 || maxP > 100) return res.status(400).json({ error: 'max_peso deve estar entre 0 e 100' })
    if (minP > maxP) return res.status(400).json({ error: `min_peso (${minP}%) não pode ser maior que max_peso (${maxP}%)` })

    const db = getDb()
    const hoje = new Date().toISOString().split('T')[0]
    const cincoAnosAtras = new Date(Date.now() - 5 * 365 * 24 * 3600000).toISOString().split('T')[0]
    const dataInicio = start || cincoAnosAtras

    // Sincroniza cotas de ativos de tipo 'acao' que ainda não têm dados na base
    for (const ativo of ativos.filter((a) => a.tipo === 'acao' && a.identificador)) {
      const temDados = db.prepare(
        `SELECT COUNT(*) as n FROM cotas_cache cc
         JOIN produtos p ON cc.produto_id = p.id
         WHERE p.identificador = ?`
      ).get(ativo.identificador).n

      if (temDados === 0 && !_syncInProgress.has(ativo.identificador)) {
        _syncInProgress.add(ativo.identificador)
        let produtoId = null
        try {
          // Cria produto temporário ligado ao estado mais recente desta carteira
          const estadoRef = db.prepare(
            `SELECT id FROM estados_portfolio WHERE carteira_id = ? ORDER BY mes DESC, data_inicio DESC LIMIT 1`
          ).get(Number(req.params.id))
          if (!estadoRef) {
            console.warn(`[otimizar-classe] carteira ${req.params.id} sem estados — sync de ${ativo.identificador} ignorado`)
            _syncInProgress.delete(ativo.identificador)
            continue
          }

          produtoId = db.prepare(
            `INSERT INTO produtos (estado_id, nome, identificador, tipo, classe, peso)
             VALUES (?, ?, ?, ?, ?, 0)`
          ).run(estadoRef.id, ativo.nome || ativo.identificador, ativo.identificador, ativo.tipo, classe).lastInsertRowid

          const { rows, insertMany } = await fetchHistoricoBrapi(ativo.identificador, dataInicio, hoje)
          insertMany(produtoId, rows)
        } catch (e) {
          if (produtoId) db.prepare('DELETE FROM produtos WHERE id = ?').run(produtoId)
          console.warn(`[otimizar-classe] sync ${ativo.identificador}: ${e.message}`)
        } finally {
          _syncInProgress.delete(ativo.identificador)
        }
      }
    }

    const data = otimizarDentroClasse(
      Number(req.params.id), classe, ativos,
      start || null, end || null, n_simulacoes ?? 5000, minP / 100, maxP / 100
    )
    res.json(data)
  } catch (e) {
    console.error('[otimizar-classe]', e)
    res.status(500).json({ error: e.message })
  }
})

// GET /api/carteiras/:id/exportar-excel
router.get('/:id/exportar-excel', async (req, res) => {
  try {
    const { start, end } = req.query
    const dados = calcularDadosExcel(Number(req.params.id), start || null, end || null)
    if (!dados) return res.status(404).json({ error: 'Carteira não encontrada' })

    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()

    const pct = (v) => v != null ? parseFloat((v * 100).toFixed(4)) : null

    // ── Aba 1: Evolução da Carteira ────────────────────────
    const aba1 = [
      ['Mês', 'Retorno Mensal (%)', 'CDI Mensal (%)', 'Retorno Acumulado (%)', 'CDI Acumulado (%)'],
      ...dados.linhas.map((l) => [
        l.mes,
        pct(l.retorno_mensal),
        pct(l.cdi_mensal),
        pct(l.acumulado_carteira),
        pct(l.acumulado_cdi),
      ]),
    ]
    const ws1 = XLSX.utils.aoa_to_sheet(aba1)
    ws1['!cols'] = [{ wch: 10 }, { wch: 20 }, { wch: 16 }, { wch: 24 }, { wch: 20 }]
    XLSX.utils.book_append_sheet(wb, ws1, 'Evolução da Carteira')

    // ── Aba 2: Contribuição Mensal por Classe ──────────────
    const classes = Object.keys(dados.labels)
    const aba2Header = ['Mês', ...classes.map((c) => dados.labels[c] + ' (%)', ), 'Total (%)']
    const aba2 = [
      aba2Header,
      ...dados.linhas.map((l) => {
        const contribs = classes.map((c) => pct(l.contribuicao[c]))
        const total = pct(l.retorno_mensal)
        return [l.mes, ...contribs, total]
      }),
    ]
    const ws2 = XLSX.utils.aoa_to_sheet(aba2)
    ws2['!cols'] = [{ wch: 10 }, ...classes.map(() => ({ wch: 18 })), { wch: 12 }]
    XLSX.utils.book_append_sheet(wb, ws2, 'Contribuição por Classe')

    // ── Aba 3: Retorno Acumulado por Classe ────────────────
    const aba3Header = ['Mês', ...classes.map((c) => dados.labels[c] + ' acum. (%)'), 'Carteira acum. (%)']
    const aba3 = [
      aba3Header,
      ...dados.linhas.map((l) => {
        const acums = classes.map((c) => pct(l.acumulado_classe[c] - 1))
        return [l.mes, ...acums, pct(l.acumulado_carteira)]
      }),
    ]
    const ws3 = XLSX.utils.aoa_to_sheet(aba3)
    ws3['!cols'] = [{ wch: 10 }, ...classes.map(() => ({ wch: 22 })), { wch: 18 }]
    XLSX.utils.book_append_sheet(wb, ws3, 'Acumulado por Classe')

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    // Remove chars que quebram headers HTTP (aspas, barras, CR/LF) antes de interpolar no Content-Disposition
    const nomeBase = dados.carteira.replace(/[^\w\s\-]/g, '').replace(/\s+/g, '_')
    const nomeArquivo = `${nomeBase}_${start || 'inicio'}_${end || 'hoje'}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`)
    res.send(buf)
  } catch (e) {
    console.error('[exportar-excel]', e)
    res.status(500).json({ error: e.message })
  }
})

export default router
