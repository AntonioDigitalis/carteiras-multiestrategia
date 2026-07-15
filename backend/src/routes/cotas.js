import { Router } from 'express'
import { getDb } from '../db/database.js'
import {
  fetchHistoricoBrapi, fetchCotaFundo,
  fetchCDIDiario, fetchCDIAcumuladoMensal, fetchIPCAMensal,
} from '../services/external.js'
import { sincronizarEconomatica } from '../services/economatica.js'
import { computarSaude, gerarAlertasSaude, verificarAlocacoes } from './auditoria.js'

const router = Router()

// Estado do sync-all em andamento (processo único do backend, uma sincronização por vez)
let syncStatus = { running: false, total: 0, processed: 0, sincronizados: 0, erros: [], economatica: null }

// Marcador persistido em configuracoes (não em memória): se o backend reiniciar
// no meio de um sync-all, syncStatus volta a running:false zerado e o frontend
// mostraria "concluído" mesmo com a sincronização interrompida pela metade.
// Ao subir, se sobrou marcador de uma execução anterior que nunca chegou ao
// finally, avisa no primeiro /sync-status em vez de ficar em silêncio.
const MARCADOR_SYNC = '_sync_all_em_andamento'
;(function checarSyncInterrompido() {
  const db = getDb()
  const marca = db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(MARCADOR_SYNC)
  if (marca) {
    syncStatus.erros.push(`Sincronização anterior (iniciada em ${marca.valor}) foi interrompida — o backend reiniciou no meio.`)
    db.prepare('DELETE FROM configuracoes WHERE chave = ?').run(MARCADOR_SYNC)
  }
})()

// GET /api/cotas/sync-status — precisa vir antes de /:produtoId, senão é capturada por ela
router.get('/sync-status', (req, res) => {
  const { running, total, processed, sincronizados, erros, economatica } = syncStatus
  res.json({
    running, total, processed, sincronizados, erros, economatica,
    percent: total > 0 ? Math.round((processed / total) * 100) : 0,
  })
})

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
        `SELECT data, valor, valor_ajustado FROM cotas_cache WHERE produto_id = ? ORDER BY data DESC LIMIT 1`
      ).get(produto.id)

      insertMany(produto.id, rows)

      // Verificar splits: compara o preço AJUSTADO da MESMA data antes e depois
      // do fetch. O nominal de uma data passada não muda; o ajustado sim,
      // quando a fonte reajusta o histórico retroativamente após um split real.
      // (Comparar ajustado vs nominal do dia mais recente do fetch não
      // funciona: por construção não há ação futura aplicada ainda, então
      // quase sempre são iguais — o alerta nunca disparava de fato.)
      if (anterior?.valor_ajustado != null && anterior.valor_ajustado > 0) {
        const linhaMesmaData = rows.find((r) => r.date === anterior.data)
        const adjNovo = linhaMesmaData ? (linhaMesmaData.adjustedClose ?? linhaMesmaData.close) : null
        if (adjNovo != null && Math.abs(adjNovo / anterior.valor_ajustado - 1) > 0.15) {
          const ratio = adjNovo / anterior.valor_ajustado
          const tipo = ratio > 1 ? 'split' : 'inplit'
          db.prepare(`INSERT OR IGNORE INTO eventos_corporativos (ticker, data, tipo, valor, descricao, fonte)
            VALUES (?, ?, ?, ?, ?, 'sync')`)
            .run(produto.identificador, hoje, tipo, ratio,
              `Razão ${ratio.toFixed(4)} — divergência de ${((Math.abs(ratio - 1)) * 100).toFixed(1)}% no preço ajustado de ${anterior.data} entre syncs`)
          db.prepare(`
            INSERT INTO alertas_auditoria (tipo, categoria, titulo, descricao, ativo, produto_id, data, valor_bruto, valor_usado, status)
            VALUES ('warning', 'split', 'Possível Split/Inplit detectado', ?, ?, ?, ?, ?, ?, 'ativo')
          `).run(
            `Preço ajustado de ${anterior.data} mudou ${((Math.abs(ratio - 1)) * 100).toFixed(1)}% entre este sync e o anterior`,
            produto.identificador, produto.id, hoje, anterior.valor_ajustado.toFixed(2), adjNovo.toFixed(2),
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

      // Inserir cotas de fundo (upsert — re-sync sobrescreve cotas corrigidas/revisadas)
      const stmt = db.prepare(`
        INSERT INTO cotas_cache (produto_id, data, valor, fonte)
        VALUES (?, ?, ?, 'CVM')
        ON CONFLICT(produto_id, data) DO UPDATE SET valor = excluded.valor, fonte = excluded.fonte
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

      verificarCotasTravadas(db, [produto])

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

// POST /api/cotas/sync-all — dispara em background e responde de imediato;
// acompanhe o progresso via GET /sync-status.
router.post('/sync-all', (req, res) => {
  if (syncStatus.running) {
    return res.status(409).json({ error: 'Sincronização já em andamento' })
  }

  const db = getDb()
  // Deduplica por identificador — um ticker/CNPJ aparece uma vez por
  // estado/mês em que foi usado; sincronizar por linha repetia a mesma
  // chamada de rede dezenas de vezes para o mesmo ativo.
  const identificadores = db.prepare(
    `SELECT DISTINCT identificador, tipo FROM produtos WHERE tipo IN ('fundo', 'acao') AND identificador IS NOT NULL`
  ).all()

  syncStatus = { running: true, total: identificadores.length, processed: 0, sincronizados: 0, erros: [], economatica: null }
  res.json({ started: true, total: identificadores.length })

  db.prepare(
    `INSERT INTO configuracoes (chave, valor) VALUES (?, ?)
     ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`
  ).run(MARCADOR_SYNC, new Date().toISOString())

  executarSyncAll(db, identificadores)
    .catch((e) => { syncStatus.erros.push(`Erro fatal: ${e.message}`) })
    .finally(() => {
      syncStatus.running = false
      db.prepare('DELETE FROM configuracoes WHERE chave = ?').run(MARCADOR_SYNC)
    })
})

async function executarSyncAll(db, identificadores) {
  // Fonte primária: Economatica (ações/FIIs/ETFs → cotas_cache; índices → dados_macro;
  // papeis_rf → staging). O upsert é imutável, então o loop Yahoo/CVM abaixo só
  // estende os dias além da cobertura Economatica, sem sobrescrevê-la.
  try {
    syncStatus.economatica = await sincronizarEconomatica()
    syncStatus.erros.push(...syncStatus.economatica.erros)
  } catch (e) {
    syncStatus.erros.push(`Economatica: ${e.message}`)
  }

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
    syncStatus.erros.push(`Dados macro: ${e.message}`)
  }

  // Upsert de cotas de fundo — mesma política do sync individual (POST
  // /:produtoId/sync): re-sync sobrescreve cotas corrigidas/revisadas pela
  // CVM, em vez de ignorá-las silenciosamente.
  const stmtFundo = db.prepare(`
    INSERT INTO cotas_cache (produto_id, data, valor, fonte)
    VALUES (?, ?, ?, 'CVM')
    ON CONFLICT(produto_id, data) DO UPDATE SET valor = excluded.valor, fonte = excluded.fonte
  `)

  for (const { identificador, tipo } of identificadores) {
    try {
      const produtoIds = db.prepare(
        `SELECT id FROM produtos WHERE identificador = ? AND tipo = ?`
      ).all(identificador, tipo).map((r) => r.id)

      if (tipo === 'acao') {
        const { rows, insertMany } = await fetchHistoricoBrapi(identificador, umAnoAtras, hoje)
        for (const pid of produtoIds) insertMany(pid, rows)
        syncStatus.sincronizados++
      } else if (tipo === 'fundo') {
        const cotas = await fetchCotaFundo(identificador, umAnoAtras, hoje)
        db.transaction(() => {
          for (const pid of produtoIds) {
            for (const c of cotas) {
              if (c.data && c.valor) stmtFundo.run(pid, c.data, c.valor)
            }
          }
        })()
        syncStatus.sincronizados++
      }
      // Pequeno delay para não sobrecarregar APIs
      await new Promise((r) => setTimeout(r, 200))
    } catch (e) {
      syncStatus.erros.push(`${identificador}: ${e.message}`)
    }
    syncStatus.processed++
  }

  // Verificar retornos anômalos e cotas travadas
  try {
    verificarRetornosAnomalos(db)
    verificarCotasTravadas(db)
  } catch (e) {
    syncStatus.erros.push(`Verificação pós-sync: ${e.message}`)
  }

  // Alertas de auditoria (saúde de dados + divergência macro/micro) — gerados
  // só aqui, não mais a cada GET /auditoria/saude (que agora é leitura pura)
  try {
    const { macro, produtos } = computarSaude(db)
    gerarAlertasSaude(db, macro, produtos)
    verificarAlocacoes(db)
  } catch (e) {
    syncStatus.erros.push(`Alertas de auditoria: ${e.message}`)
  }
}

function verificarRetornosAnomalos(db) {
  const hoje = new Date().toISOString().split('T')[0]
  const umMesAtras = new Date(Date.now() - 32 * 24 * 3600000).toISOString().split('T')[0]

  // Deduplica por identificador — evita um alerta por produto_id para o mesmo ticker/CNPJ
  const identificadores = db.prepare(
    "SELECT DISTINCT identificador, tipo, nome, MIN(id) as produto_id FROM produtos WHERE tipo IN ('fundo','acao') AND identificador IS NOT NULL GROUP BY identificador"
  ).all()

  for (const p of identificadores) {
    // Usa as cotas do produto_id mais antigo como representante do identificador
    const cotas = db.prepare(
      `SELECT valor, valor_ajustado FROM cotas_cache WHERE produto_id = ? AND data >= ? ORDER BY data`
    ).all(p.produto_id, umMesAtras)

    if (cotas.length < 2) continue

    // Usa valor_ajustado em ambos os extremos para evitar falsos positivos por splits/grupamentos
    const first = cotas[0].valor_ajustado ?? cotas[0].valor
    const last  = cotas[cotas.length - 1].valor_ajustado ?? cotas[cotas.length - 1].valor

    if (!first || first === 0) continue
    const retorno = last / first - 1

    if (Math.abs(retorno) > 0.30) {
      const existente = db.prepare(
        `SELECT id FROM alertas_auditoria WHERE ativo = ? AND categoria = 'retorno_anomalo' AND data = ? AND status = 'ativo'`
      ).get(p.identificador, hoje)

      if (!existente) {
        db.prepare(`
          INSERT INTO alertas_auditoria (tipo, categoria, titulo, descricao, ativo, produto_id, data, valor_bruto, status)
          VALUES ('warning', 'retorno_anomalo', 'Retorno Anômalo', ?, ?, ?, ?, ?, 'ativo')
        `).run(
          `Retorno de ${(retorno * 100).toFixed(1)}% no último mês — acima do limite de ±30%`,
          p.identificador, p.produto_id, hoje, `${(retorno * 100).toFixed(2)}%`,
        )
      }
    }
  }
}

function verificarCotasTravadas(db, lista = null) {
  const hoje = new Date().toISOString().split('T')[0]
  const produtos = lista ?? db.prepare("SELECT * FROM produtos WHERE tipo = 'fundo'").all()

  // Trabalha por CNPJ único para evitar alertas duplicados (mesmo fundo em múltiplos estados)
  const vistos = new Set()

  for (const p of produtos) {
    if (p.tipo !== 'fundo' || !p.identificador) continue
    if (vistos.has(p.identificador)) continue
    vistos.add(p.identificador)

    const recentes = db.prepare(
      `SELECT cc.data, cc.valor, p2.id as produto_id, p2.nome
       FROM cotas_cache cc
       JOIN produtos p2 ON cc.produto_id = p2.id
       WHERE p2.identificador = ? AND p2.tipo = 'fundo'
       ORDER BY cc.data DESC LIMIT 5`
    ).all(p.identificador)

    if (recentes.length < 5) continue

    const valoresUnicos = new Set(recentes.map((r) => r.valor))
    if (valoresUnicos.size > 1) continue

    // Todos os 5 últimos dias com valor idêntico — cota travada
    // Dedup por identificador (CNPJ) — consistente com vistos.has(p.identificador) acima
    const jaExiste = db.prepare(
      `SELECT id FROM alertas_auditoria
       WHERE ativo = ? AND categoria = 'cota_travada' AND status = 'ativo'`
    ).get(p.identificador)
    if (jaExiste) continue

    db.prepare(`
      INSERT INTO alertas_auditoria
        (tipo, categoria, titulo, descricao, ativo, produto_id, data, valor_bruto, valor_usado, status)
      VALUES ('error', 'cota_travada', 'Cota Travada', ?, ?, ?, ?, ?, ?, 'ativo')
    `).run(
      `Cota inalterada nos últimos 5 dias úteis (valor: ${recentes[0].valor})`,
      p.identificador,
      recentes[0].produto_id,
      hoje,
      recentes[0].valor.toString(),
      recentes[0].valor.toString(),
    )
  }
}

export default router
