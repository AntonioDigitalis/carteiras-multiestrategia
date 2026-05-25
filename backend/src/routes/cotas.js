import { Router } from 'express'
import { getDb } from '../db/database.js'
import {
  fetchHistoricoBrapi, fetchCotaFundo,
  fetchCDIDiario, fetchCDIAcumuladoMensal, fetchIPCAMensal,
} from '../services/external.js'

const router = Router()

// GET /api/cotas/:produtoId
router.get('/:produtoId', (req, res) => {
  const db = getDb()
  const rows = db.prepare(
    `SELECT * FROM cotas_cache WHERE produto_id = ? ORDER BY data DESC LIMIT 60`
  ).all(req.params.produtoId)
  res.json(rows)
})

// POST /api/cotas/:produtoId/sync
router.post('/:produtoId/sync', async (req, res) => {
  const db = getDb()
  const produto = db.prepare('SELECT * FROM produtos WHERE id = ?').get(req.params.produtoId)
  if (!produto) return res.status(404).json({ error: 'Produto não encontrado' })

  const hoje = new Date().toISOString().split('T')[0]
  const umAnoAtras = new Date(Date.now() - 365 * 24 * 3600000).toISOString().split('T')[0]

  try {
    if (produto.tipo === 'acao' && produto.identificador) {
      // Expandir janela até a data mais antiga que qualquer portfolio precisa (até 5 anos)
      const maisAntiga = db.prepare(
        `SELECT MIN(ep.data_inicio) as d FROM estados_portfolio ep
         JOIN produtos p ON p.estado_id = ep.id
         WHERE p.identificador = ? AND p.tipo = 'acao'`
      ).get(produto.identificador)
      const cincoAnosAtras = new Date(Date.now() - 5 * 365 * 24 * 3600000).toISOString().split('T')[0]
      const dataInicio = maisAntiga?.d
        ? (maisAntiga.d > cincoAnosAtras ? maisAntiga.d : cincoAnosAtras)
        : umAnoAtras

      const { rows, insertMany } = await fetchHistoricoBrapi(produto.identificador, dataInicio, hoje)

      // Detectar ticker sem dados
      if (rows.length === 0) {
        const ultimaCota = db.prepare(
          `SELECT MAX(cc.data) as d FROM cotas_cache cc
           JOIN produtos p ON cc.produto_id = p.id WHERE p.identificador = ?`
        ).get(produto.identificador)
        if (ultimaCota?.d) {
          const diasSem = Math.floor((Date.now() - new Date(ultimaCota.d)) / 86400000)
          if (diasSem > 10) {
            db.prepare(`INSERT OR IGNORE INTO eventos_corporativos (ticker, data, tipo, descricao, fonte)
              VALUES (?, ?, 'sem_dados', ?, 'sync')`)
              .run(produto.identificador, hoje,
                `Sem dados há ${diasSem} dias — possível mudança de ticker ou encerramento`)
            db.prepare(`INSERT INTO alertas_auditoria
              (tipo, categoria, titulo, descricao, ativo, produto_id, data, status)
              VALUES ('warning', 'ticker_change', 'Ticker sem dados', ?, ?, ?, ?, 'ativo')`)
              .run(`${produto.identificador} sem retorno há ${diasSem} dias. Verifique se o ticker mudou.`,
                produto.identificador, produto.id, hoje)
          }
        }
      }

      // Detectar splits/inplits antes de inserir
      const anterior = db.prepare(
        `SELECT valor, valor_ajustado FROM cotas_cache WHERE produto_id = ? ORDER BY data DESC LIMIT 1`
      ).get(produto.id)

      insertMany(produto.id, rows)

      // Verificar splits
      if (anterior && rows.length > 0) {
        const ultimo = rows[rows.length - 1]
        const adj = ultimo.adjustedClose ?? ultimo.close
        const nominal = ultimo.close
        if (nominal > 0 && Math.abs(adj / nominal - 1) > 0.15) {
          const ratio = adj / nominal
          const tipo = ratio > 1 ? 'split' : 'inplit'
          db.prepare(`INSERT OR IGNORE INTO eventos_corporativos (ticker, data, tipo, valor, descricao, fonte)
            VALUES (?, ?, ?, ?, ?, 'sync')`)
            .run(produto.identificador, hoje, tipo, ratio,
              `Razão ${ratio.toFixed(4)} — divergência de ${((Math.abs(ratio - 1)) * 100).toFixed(1)}% entre preço ajustado e nominal`)
          db.prepare(`
            INSERT INTO alertas_auditoria (tipo, categoria, titulo, descricao, ativo, produto_id, data, valor_bruto, valor_usado, status)
            VALUES ('warning', 'split', 'Possível Split/Inplit detectado', ?, ?, ?, ?, ?, ?, 'ativo')
          `).run(
            `Divergência de ${((Math.abs(adj / nominal - 1)) * 100).toFixed(1)}% entre preço ajustado e nominal`,
            produto.identificador, produto.id, hoje, nominal.toFixed(2), adj.toFixed(2),
          )
        }
      }

      res.json({ ok: true, sincronizados: rows.length })
    } else if (produto.tipo === 'fundo' && produto.identificador) {
      // Retroage até o início mais antigo do portfólio (até 5 anos), igual às ações
      const maisAntiga = db.prepare(
        `SELECT MIN(ep.data_inicio) as d FROM estados_portfolio ep
         JOIN produtos p ON p.estado_id = ep.id
         WHERE p.identificador = ? AND p.tipo = 'fundo'`
      ).get(produto.identificador)
      const cincoAnosAtras = new Date(Date.now() - 5 * 365 * 24 * 3600000).toISOString().split('T')[0]
      const dataInicio = maisAntiga?.d
        ? (maisAntiga.d > cincoAnosAtras ? maisAntiga.d : cincoAnosAtras)
        : umAnoAtras

      const cotas = await fetchCotaFundo(produto.identificador, dataInicio, hoje)

      // Inserir cotas de fundo (formato CVM: {data, valor})
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO cotas_cache (produto_id, data, valor, fonte)
        VALUES (?, ?, ?, 'CVM')
      `)

      db.transaction(() => {
        for (const c of cotas) {
          if (c.data && c.valor) stmt.run(produto.id, c.data, c.valor)
        }
      })()

      // Verificar se a ausência de cotas afeta algum mês do portfólio
      // (alerta só faz sentido se falta cobertura para meses em que o fundo é usado)
      const ultimaCota = db.prepare(
        `SELECT MAX(data) as d FROM cotas_cache WHERE produto_id = ?`
      ).get(produto.id)
      if (ultimaCota?.d) {
        // Último mês do portfólio que usa este produto (via identificador, abrange todos os produtos com mesmo CNPJ)
        const ultimoMesPortfolio = db.prepare(
          `SELECT MAX(ep.mes) as m FROM estados_portfolio ep
           JOIN produtos p ON p.estado_id = ep.id
           WHERE p.identificador = ? AND p.tipo = 'fundo'`
        ).get(produto.identificador)

        if (ultimoMesPortfolio?.m) {
          // Precisa de cotas até o fim do último mês usado
          const fimUltimoMes = ultimoMesPortfolio.m + '-28' // conservador — qualquer mês tem pelo menos 28 dias
          const coberturaOk = ultimaCota.d >= fimUltimoMes

          if (!coberturaOk) {
            const jaExiste = db.prepare(
              `SELECT id FROM alertas_auditoria WHERE produto_id = ? AND categoria = 'sem_cotas_fundo' AND status = 'ativo'`
            ).get(produto.id)
            if (!jaExiste) {
              const diasSem = Math.floor((Date.now() - new Date(ultimaCota.d)) / 86400000)
              db.prepare(`
                INSERT INTO alertas_auditoria (tipo, categoria, titulo, descricao, ativo, produto_id, data, status)
                VALUES ('warning', 'sem_cotas_fundo', 'Fundo sem cotas — retorno afetado', ?, ?, ?, ?, 'ativo')
              `).run(
                `Última cota em ${ultimaCota.d}, mas fundo é usado até ${ultimoMesPortfolio.m}. ` +
                `Fundo pode ter sido liquidado ou fusionado (sem dados há ${diasSem} dias).`,
                produto.nome, produto.id, hoje,
              )
            }
          }
        }
      }

      // Verificar cota travada (últimos 5 dias úteis)
      const recentes = db.prepare(
        `SELECT data, valor FROM cotas_cache WHERE produto_id = ? ORDER BY data DESC LIMIT 5`
      ).all(produto.id)

      if (recentes.length >= 3) {
        const valoresUnicos = new Set(recentes.map((r) => r.valor))
        if (valoresUnicos.size === 1) {
          db.prepare(`
            INSERT INTO alertas_auditoria (tipo, categoria, titulo, descricao, ativo, produto_id, data, valor_bruto, valor_usado, status)
            VALUES ('error', 'cota_travada', 'Cota Travada', ?, ?, ?, ?, ?, ?, 'ativo')
          `).run(
            `Cota inalterada por ${recentes.length} dias úteis consecutivos`,
            produto.nome,
            produto.id,
            hoje,
            recentes[0].valor.toString(),
            recentes[0].valor.toString(),
          )
        }
      }

      res.json({ ok: true, sincronizados: cotas.length })
    } else if (produto.tipo === 'carteira') {
      res.json({ ok: true, sincronizados: 0, msg: 'Sub-carteira — retorno calculado dinamicamente' })
    } else {
      res.json({ ok: true, sincronizados: 0, msg: 'Produto RF curva — sem cotas externas' })
    }
  } catch (e) {
    console.error('[sync]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// POST /api/cotas/sync-all
router.post('/sync-all', async (req, res) => {
  const db = getDb()
  const produtos = db.prepare(
    `SELECT p.* FROM produtos p WHERE p.tipo IN ('fundo', 'acao') AND p.identificador IS NOT NULL`
  ).all()

  let sincronizados = 0
  const erros = []

  // Sincronizar dados macro primeiro
  const hoje = new Date().toISOString().split('T')[0]
  const umAnoAtras = new Date(Date.now() - 365 * 24 * 3600000).toISOString().split('T')[0]
  const dataInicioBR = umAnoAtras.split('-').reverse().join('/')
  const dataFimBR = hoje.split('-').reverse().join('/')

  try {
    await fetchCDIDiario(dataInicioBR, dataFimBR)
    await fetchCDIAcumuladoMensal(dataInicioBR, dataFimBR)
    await fetchIPCAMensal(dataInicioBR, dataFimBR)
  } catch (e) {
    erros.push(`Dados macro: ${e.message}`)
  }

  for (const p of produtos) {
    try {
      if (p.tipo === 'acao') {
        const { rows, insertMany } = await fetchHistoricoBrapi(p.identificador, umAnoAtras, hoje)
        insertMany(p.id, rows)
        sincronizados++
      } else if (p.tipo === 'fundo') {
        const cotas = await fetchCotaFundo(p.identificador, umAnoAtras, hoje)
        const stmt = db.prepare(`
          INSERT OR IGNORE INTO cotas_cache (produto_id, data, valor, fonte)
          VALUES (?, ?, ?, 'CVM')
        `)
        db.transaction(() => {
          for (const c of cotas) {
            if (c.data && c.valor) stmt.run(p.id, c.data, c.valor)
          }
        })()
        sincronizados++
      }
      // Pequeno delay para não sobrecarregar APIs
      await new Promise((r) => setTimeout(r, 200))
    } catch (e) {
      erros.push(`${p.nome}: ${e.message}`)
    }
  }

  // Verificar retornos anômalos (±30%)
  verificarRetornosAnomalos(db)

  res.json({ sincronizados, erros, total: produtos.length })
})

function verificarRetornosAnomalos(db) {
  const produtos = db.prepare("SELECT * FROM produtos WHERE tipo IN ('fundo', 'acao')").all()
  const hoje = new Date().toISOString().split('T')[0]
  const umMesAtras = new Date(Date.now() - 32 * 24 * 3600000).toISOString().split('T')[0]

  for (const p of produtos) {
    const cotas = db.prepare(
      `SELECT valor, valor_ajustado FROM cotas_cache WHERE produto_id = ? AND data >= ? ORDER BY data`
    ).all(p.id, umMesAtras)

    if (cotas.length < 2) continue

    const first = cotas[0].valor
    const last = cotas[cotas.length - 1].valor_ajustado ?? cotas[cotas.length - 1].valor

    if (!first || first === 0) continue
    const retorno = last / first - 1

    if (Math.abs(retorno) > 0.30) {
      const existente = db.prepare(
        `SELECT id FROM alertas_auditoria WHERE produto_id = ? AND categoria = 'retorno_anomalo' AND data = ? AND status = 'ativo'`
      ).get(p.id, hoje)

      if (!existente) {
        db.prepare(`
          INSERT INTO alertas_auditoria (tipo, categoria, titulo, descricao, ativo, produto_id, data, valor_bruto, status)
          VALUES ('warning', 'retorno_anomalo', 'Retorno Anômalo', ?, ?, ?, ?, ?, 'ativo')
        `).run(
          `Retorno de ${(retorno * 100).toFixed(1)}% no último mês — acima do limite de ±30%`,
          p.nome, p.id, hoje, `${(retorno * 100).toFixed(2)}%`,
        )
      }
    }
  }
}

export default router
