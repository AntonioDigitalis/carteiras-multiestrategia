import { getDb } from '../db/database.js'
import { getCDIDiarioLocal, getCDIMensalLocal, getIPCAMensalLocal } from './external.js'

const LABELS_CLASSE = {
  pos_fixado:     'Pós-fixado',
  inflacao:       'Inflação',
  prefixado:      'Pré-fixado',
  rf_global:      'RF Global',
  multimercado:   'Multimercado',
  rv_brasil:      'RV Brasil',
  rv_global:      'RV Global',
  fundos_listados: 'Fundos Listados',
  alternativos:   'Alternativos',
}

const BENCHMARKS_PASSIVA = {
  pos_fixado:      '70% CDI + 30% IDA-DI (DEBB11)',
  inflacao:        'IMA-B (IMAB11)',
  prefixado:       'IRF-M (IRFM11)',
  rf_global:       'AGG + Hedge BRL',
  multimercado:    'IHFA',
  rv_brasil:       'Ibovespa',
  rv_global:       'ACWI + Hedge BRL',
  fundos_listados: 'IFIX',
  alternativos:    'CDI',
}

// Spreads de fallback quando índice real não estiver disponível
const SPREADS_FALLBACK_AA = {
  inflacao:       { base: 'ipca', spread: 0.055 },
  prefixado:      { base: 'cdi',  spread: 0.01 },
  rf_global:      { base: 'cdi',  spread: 0.01 },
  multimercado:   { base: 'cdi',  spread: 0.02 },
  rv_brasil:      { base: 'cdi',  spread: 0.04 },
  rv_global:      { base: 'cdi',  spread: 0.03 },
  fundos_listados:{ base: 'cdi',  spread: 0.02 },
}

function retornoPassivoClasse(cls, mes, cdiMensal, ipcaMensal, db) {
  const mesData = mes + '-01'

  if (cls === 'alternativos') return cdiMensal

  if (cls === 'pos_fixado') {
    const debb = db.prepare(`SELECT valor FROM dados_macro WHERE serie='DEBB11_MENSAL' AND data=?`).get(mesData)
    if (debb) return 0.7 * cdiMensal + 0.3 * (debb.valor / 100)
    return cdiMensal  // fallback: CDI puro antes de jun/2022
  }

  if (cls === 'fundos_listados') {
    const row = db.prepare(`SELECT valor FROM dados_macro WHERE serie='IFIX_MENSAL' AND data=?`).get(mesData)
    if (row) return row.valor / 100
    return cdiMensal + (Math.pow(1 + SPREADS_FALLBACK_AA[cls].spread, 1 / 12) - 1)
  }

  if (cls === 'multimercado') {
    const ihfa = db.prepare(`SELECT valor FROM dados_macro WHERE serie='IHFA_MENSAL' AND data=?`).get(mesData)
    if (ihfa) return ihfa.valor / 100
    return cdiMensal + (Math.pow(1 + SPREADS_FALLBACK_AA.multimercado.spread, 1 / 12) - 1)
  }

  if (cls === 'inflacao') {
    const row = db.prepare(`SELECT valor FROM dados_macro WHERE serie='IMAB11_MENSAL' AND data=?`).get(mesData)
    if (row) return row.valor / 100
    return ipcaMensal + (Math.pow(1.055, 1 / 12) - 1)
  }

  if (cls === 'prefixado') {
    const row = db.prepare(`SELECT valor FROM dados_macro WHERE serie='IRFM11_MENSAL' AND data=?`).get(mesData)
    if (row) return row.valor / 100
    return cdiMensal + (Math.pow(1.01, 1 / 12) - 1)
  }

  if (cls === 'rv_brasil') {
    const row = db.prepare(`SELECT valor FROM dados_macro WHERE serie='IBOV_MENSAL' AND data=?`).get(mesData)
    if (row) return row.valor / 100
    return cdiMensal + (Math.pow(1.04, 1 / 12) - 1)
  }

  // rf_global: AGG + hedge cambial ≈ retorno_local + (CDI - taxa_USD_mensal).
  // IRX é a taxa anual (% a.a.) do T-Bill 13s; converte p/ mensal geometricamente.
  if (cls === 'rf_global') {
    const agg = db.prepare(`SELECT valor FROM dados_macro WHERE serie='AGG_MENSAL' AND data=?`).get(mesData)
    const irx = db.prepare(`SELECT valor FROM dados_macro WHERE serie='IRX_MENSAL' AND data=?`).get(mesData)
    if (agg && irx) {
      const irxMensal = Math.pow(1 + irx.valor / 100, 1 / 12) - 1
      return agg.valor / 100 + cdiMensal - irxMensal
    }
    return cdiMensal + (Math.pow(1.01, 1 / 12) - 1)
  }

  // rv_global: ACWI + hedge cambial ≈ retorno_local + (CDI - taxa_USD_mensal).
  if (cls === 'rv_global') {
    const acwi = db.prepare(`SELECT valor FROM dados_macro WHERE serie='ACWI_MENSAL' AND data=?`).get(mesData)
    const irx  = db.prepare(`SELECT valor FROM dados_macro WHERE serie='IRX_MENSAL' AND data=?`).get(mesData)
    if (acwi && irx) {
      const irxMensal = Math.pow(1 + irx.valor / 100, 1 / 12) - 1
      return acwi.valor / 100 + cdiMensal - irxMensal
    }
    return cdiMensal + (Math.pow(1.03, 1 / 12) - 1)
  }

  return cdiMensal
}

// ── Utilidades ─────────────────────────────────────────────

function diasEntre(d1, d2) {
  return Math.round((new Date(d2) - new Date(d1)) / 86400000)
}

// Duration modificada (anos). Valor manual tem precedência sobre o cálculo automático.
// Para rf_curva: CDI flutuante → 0; PRE/IPCA bullet → anos / (1 + taxa_aa).
// Para outros tipos (acao, fundo): apenas duration_manual é usado.
export function calcularDurationRF(produto, dataRef) {
  if (produto.duration_manual != null) return Number(produto.duration_manual)

  if (produto.tipo !== 'rf_curva') return null
  const { indexador, taxa, data_vencimento } = produto
  if (!data_vencimento) return null

  const hoje = dataRef || new Date().toISOString().split('T')[0]
  if (data_vencimento <= hoje) return 0

  if (indexador === 'CDI') return 0

  const anos = (new Date(data_vencimento) - new Date(hoje)) / (365.25 * 86400000)
  return anos / (1 + (taxa || 0) / 100)
}

function diaUteis(data) {
  const d = new Date(data)
  const dow = d.getUTCDay()
  return dow !== 0 && dow !== 6
}

// CDI diário → fator composto
function calcularFatorCDI(diasCDI, taxaCDIAnual) {
  const taxaDiaria = Math.pow(1 + taxaCDIAnual / 100, 1 / 252) - 1
  return Math.pow(1 + taxaDiaria, diasCDI)
}

// ── RF Marcada na Curva ────────────────────────────────────

// Alíquota IR de longo prazo (> 720 dias) usada para o gross-up de isentos
const ALIQUOTA_IR_LP = 0.15

export function calcularRetornoRFCurva(produto, dataInicio, dataFim) {
  const { indexador, tipo_cdi, taxa, data_emissao, data_vencimento, isento_ir } = produto
  const db = getDb()

  const inicio = data_emissao && data_emissao > dataInicio ? data_emissao : dataInicio
  const fim = dataFim < data_vencimento ? dataFim : data_vencimento

  if (inicio >= fim) return 0

  let retorno = 0

  if (indexador === 'PRE') {
    const dias = diasEntre(inicio, fim)
    // Convenção: taxa a.a. em dias úteis/252; dias_corridos/365,25 ≈ diasUteis/252 sem calendário de feriados
    retorno = Math.pow(1 + taxa / 100, dias / 365.25) - 1

  } else if (indexador === 'CDI') {
    const cdiRows = getCDIDiarioLocal(inicio, fim)
    if (cdiRows.length === 0) {
      // Estima CDI anual pelas taxas mensais disponíveis; evita 12% hardcoded desatualizado
      const cdiMensais = getCDIMensalLocal(inicio.slice(0, 7), fim.slice(0, 7))
      const cdiAnualEst = cdiMensais.length > 0
        ? Math.pow(cdiMensais.reduce((p, r) => p * (1 + r.valor / 100), 1), 12 / cdiMensais.length) - 1
        : 0.12
      const dias = diasEntre(inicio, fim)
      const cdiDiarioEst = Math.pow(1 + cdiAnualEst, 1 / 252) - 1
      if (tipo_cdi === 'pct') {
        retorno = Math.pow(1 + cdiDiarioEst * (taxa / 100), dias) - 1
      } else {
        const spreadDiario = Math.pow(1 + taxa / 100, 1 / 252) - 1
        retorno = Math.pow((1 + cdiDiarioEst) * (1 + spreadDiario), dias) - 1
      }
    } else {
      let fator = 1
      for (const row of cdiRows) {
        const cdiDiario = row.valor / 100
        if (tipo_cdi === 'pct') {
          fator *= (1 + cdiDiario * (taxa / 100))
        } else {
          // Composição geométrica: (1+CDI_dia) × (1+spread_dia) — evita soma aritmética
          fator *= (1 + cdiDiario) * Math.pow(1 + taxa / 100, 1 / 252)
        }
      }
      retorno = fator - 1
    }

  } else if (indexador === 'IPCA') {
    const ipcaRows = getIPCAMensalLocal(inicio.slice(0, 7), fim.slice(0, 7))
    const dias = diasEntre(inicio, fim)
    let fatorIPCA = 1
    for (const row of ipcaRows) fatorIPCA *= (1 + row.valor / 100)
    retorno = fatorIPCA * Math.pow(1 + taxa / 100, dias / 365.25) - 1
  }

  // Gross-up: converte retorno isento em equivalente bruto tributável para
  // comparação justa com CDBs e fundos (que pagam IR sobre o rendimento)
  if (isento_ir) return retorno / (1 - ALIQUOTA_IR_LP)
  return retorno
}

// ── Retorno de produto por período ────────────────────────

// ── Retorno de sub-carteira composta ──────────────────────
// Usada quando produto.tipo === 'carteira': calcula o retorno da carteira
// referenciada (produto.identificador = carteira_id) para o período pedido.

function calcularRetornoSubCarteira(subCarteiraId, dataInicio, dataFim) {
  const db = getDb()
  const subCarteira = db.prepare('SELECT perfil_id FROM carteiras WHERE id = ?').get(subCarteiraId)
  if (!subCarteira) return null

  const mesInicio = dataInicio.slice(0, 7)
  const mesFim = dataFim.slice(0, 7)

  let estados = db.prepare(`
    SELECT * FROM estados_portfolio
    WHERE carteira_id = ? AND mes >= ? AND mes <= ?
    ORDER BY data_inicio
  `).all(subCarteiraId, mesInicio, mesFim)

  // Fallback: estado aberto do mês anterior cobrindo este período (ex: último mes='2026-04' com data_fim=NULL cobrindo maio/2026)
  if (estados.length === 0) {
    estados = db.prepare(`
      SELECT * FROM estados_portfolio
      WHERE carteira_id = ? AND data_inicio <= ? AND (data_fim IS NULL OR data_fim >= ?)
      ORDER BY data_inicio
    `).all(subCarteiraId, dataFim, dataInicio)
  }

  if (estados.length === 0) return null

  // Mapa mes → alocação (usa a mais recente disponível)
  const alocRows = db.prepare(`
    SELECT * FROM alocacoes_macro WHERE perfil_id = ? AND mes <= ?
    ORDER BY mes DESC
  `).all(subCarteira.perfil_id, mesFim)
  const alocByMes = new Map(alocRows.map((a) => [a.mes, a]))

  function getAloc(mes) {
    for (let i = 0; ; i++) {
      const d = new Date(mes + '-01')
      d.setMonth(d.getMonth() - i)
      const m = d.toISOString().slice(0, 7)
      if (alocByMes.has(m)) {
        if (i > 3) console.warn(`[calcularRetornoSubCarteira] alocação de ${m} usada para mes=${mes} (${i} meses de defasagem)`)
        return alocByMes.get(m)
      }
      if (i > 12) return null
    }
  }

  const totalDias = diasEntre(dataInicio, dataFim) + 1
  if (totalDias <= 0) return null

  let acum = 1
  let temDados = false
  for (const est of estados) {
    const inicio = est.data_inicio > dataInicio ? est.data_inicio : dataInicio
    const fim = est.data_fim && est.data_fim < dataFim ? est.data_fim : dataFim
    if (inicio > fim) continue
    const aloc = getAloc(est.mes)
    if (!aloc) continue
    const produtos = db.prepare('SELECT * FROM produtos WHERE estado_id = ?').all(est.id)
    if (produtos.length === 0) continue
    const retEst = calcularRetornoEstado({ alocacao: aloc }, produtos, inicio, fim)
    acum *= (1 + retEst)
    temDados = true
  }

  return temDados ? acum - 1 : null
}

export function calcularRetornoProduto(produto, dataInicio, dataFim) {
  const db = getDb()

  if (produto.tipo === 'rf_curva') {
    return calcularRetornoRFCurva(produto, dataInicio, dataFim)
  }

  if (produto.tipo === 'carteira') {
    const subCarteiraId = Number(produto.identificador)
    if (!subCarteiraId) {
      console.warn(`[calcularRetornoProduto] produto id=${produto.id} tipo=carteira sem identificador válido`)
      return null
    }
    return calcularRetornoSubCarteira(subCarteiraId, dataInicio, dataFim)
  }

  // Tickers renomeados que compartilham o mesmo histórico de preços
  const TICKER_ALIASES = { 'CVBI11': 'PCIP11', 'PCIP11': 'CVBI11', 'AXIA7': 'AXIA3' }
  const alias = TICKER_ALIASES[produto.identificador]
  const identifiers = alias ? [produto.identificador, alias] : [produto.identificador]
  const placeholders = identifiers.map(() => '?').join(', ')

  // Query combinada (primário + alias) para cobertura máxima de datas com preço nominal
  const cotas = db.prepare(
    `SELECT cc.data, MAX(cc.valor) AS valor
     FROM cotas_cache cc
     JOIN produtos p ON cc.produto_id = p.id
     WHERE p.identificador IN (${placeholders}) AND p.tipo = ?
       AND cc.data >= ? AND cc.data <= ?
     GROUP BY cc.data
     ORDER BY cc.data`
  ).all(...identifiers, produto.tipo, dataInicio, dataFim)

  if (cotas.length < 2) return null

  const first = cotas[0]
  const last  = cotas[cotas.length - 1]

  // Incorporações e mudanças de ticker com valor patrimonial registrado:
  // se existe um evento ticker_change com valor no período, usa esse valor como preço final.
  const eventoIncorporacao = db.prepare(`
    SELECT valor FROM eventos_corporativos
    WHERE ticker = ? AND tipo = 'ticker_change' AND valor IS NOT NULL
      AND data >= ? AND data <= ?
    ORDER BY data DESC LIMIT 1
  `).get(produto.identificador, dataInicio, dataFim)

  let valorInicio, valorFim
  if (eventoIncorporacao) {
    valorInicio = first.valor
    valorFim    = eventoIncorporacao.valor
  } else if (produto.tipo === 'acao') {
    // Para preços ajustados, usa SOMENTE o ticker primário — séries adj de tickers diferentes
    // têm calibrações distintas e não podem ser combinadas.
    const cotasPrimary = db.prepare(
      `SELECT cc.data, MAX(cc.valor) AS valor, MAX(cc.valor_ajustado) AS valor_ajustado
       FROM cotas_cache cc
       JOIN produtos p ON cc.produto_id = p.id
       WHERE p.identificador = ? AND p.tipo = ?
         AND cc.data >= ? AND cc.data <= ?
       GROUP BY cc.data ORDER BY cc.data`
    ).all(produto.identificador, produto.tipo, dataInicio, dataFim)

    const fp = cotasPrimary[0]
    const lp = cotasPrimary[cotasPrimary.length - 1]

    if (cotasPrimary.length >= 2 && fp?.valor_ajustado && lp?.valor_ajustado && fp.valor > 0 && lp.valor > 0) {
      const ratioFirst = fp.valor_ajustado / fp.valor
      const ratioLast  = lp.valor_ajustado  / lp.valor
      const minRatio   = Math.min(ratioFirst, ratioLast)
      const ratioDrift = minRatio > 0 ? Math.max(ratioFirst, ratioLast) / minRatio : Infinity
      if (ratioDrift <= 20) {
        // threshold 20 cobre splits/grupamentos de até ~10:1 (ex: grupamento 1:10 → drift=10)
        valorInicio = fp.valor_ajustado
        valorFim    = lp.valor_ajustado
      } else {
        // Ajuste possivelmente corrompido (recalibração mid-série) — usa nominal combinado
        valorInicio = first.valor
        valorFim    = last.valor
      }
    } else {
      // Primário sem adj ou sem dados no período — usa nominal combinado (cobre datas via alias)
      valorInicio = first.valor
      valorFim    = last.valor
    }
  } else {
    valorInicio = first.valor
    valorFim    = last.valor
  }

  if (!valorInicio || valorInicio === 0) return null
  return valorFim / valorInicio - 1
}

// ── Retorno do estado do portfólio ─────────────────────────

function calcularRetornoEstado(estado, produtos, dataInicio, dataFim) {
  const classeMap = {}
  for (const p of produtos) {
    if (!classeMap[p.classe]) classeMap[p.classe] = []
    classeMap[p.classe].push(p)
  }

  let retornoTotal = 0
  const alocacao = estado.alocacao

  for (const [classe, prods] of Object.entries(classeMap)) {
    const pesoClasse = (alocacao?.[classe] ?? 0) / 100
    if (pesoClasse === 0) continue

    // Retorno da classe = média ponderada pelo peso dos produtos
    // Dois passos: primeiro coleta retornos, depois renormaliza pelos que têm dados.
    // Evita diluir a classe quando produto sem cota/vencido é pulado mas seu peso
    // permanecia no denominador (subestimava silenciosamente o retorno da classe).
    const retornosProds = prods.map(p => ({ p, ret: calcularRetornoProduto(p, dataInicio, dataFim) }))
    const pesoComDados = retornosProds.reduce((s, { p, ret }) => ret != null ? s + (p.peso || 0) : s, 0)
    let retornoClasse = 0

    for (const { p, ret } of retornosProds) {
      if (ret == null) continue
      retornoClasse += ret * ((p.peso || 0) / (pesoComDados || 1))
    }

    retornoTotal += retornoClasse * pesoClasse
  }

  return retornoTotal
}

// ── Retorno mensal de uma carteira ─────────────────────────

export function calcularRetornoMes(carteiraId, mes, alocacao) {
  const db = getDb()
  let estados = db.prepare(
    `SELECT * FROM estados_portfolio WHERE carteira_id = ? AND mes = ? ORDER BY data_inicio`
  ).all(carteiraId, mes)

  const [ano, m] = mes.split('-').map(Number)
  const inicioMes = `${mes}-01`
  const fimMes = new Date(ano, m, 0).toISOString().split('T')[0]

  // Mês sem estado próprio: procura estados que cobrem esse mês por data
  // (ex: estado de fev com data_fim em abr cobre março inteiro)
  if (estados.length === 0) {
    estados = db.prepare(
      `SELECT * FROM estados_portfolio
       WHERE carteira_id = ? AND data_inicio <= ? AND (data_fim IS NULL OR data_fim >= ?)
       ORDER BY data_inicio`
    ).all(carteiraId, fimMes, inicioMes)
    if (estados.length === 0) return null
  }

  // Se o primeiro estado começa depois do dia 1, preenche o gap com o estado
  // mais recente do mês anterior (convenção do 7º dia útil).
  if (estados[0].data_inicio > inicioMes) {
    const anterior = db.prepare(
      `SELECT * FROM estados_portfolio WHERE carteira_id = ? AND mes < ? ORDER BY mes DESC, data_inicio DESC LIMIT 1`
    ).get(carteiraId, mes)
    if (anterior) {
      const diaAntes = new Date(estados[0].data_inicio + 'T12:00:00')
      diaAntes.setDate(diaAntes.getDate() - 1)
      const gapFim = diaAntes.toISOString().split('T')[0]
      estados = [{ ...anterior, data_inicio: inicioMes, data_fim: gapFim }, ...estados]
    }
  }

  let retornoMes = 1

  for (let i = 0; i < estados.length; i++) {
    const est = estados[i]
    const inicio = est.data_inicio > inicioMes ? est.data_inicio : inicioMes
    const fim = est.data_fim && est.data_fim < fimMes ? est.data_fim : fimMes

    const produtos = db.prepare(
      `SELECT p.* FROM produtos p WHERE p.estado_id = ?`
    ).all(est.id)

    const retEst = calcularRetornoEstado({ alocacao }, produtos, inicio, fim)

    // Composição sequencial dos estados: cada estado rende em cima do anterior
    retornoMes *= (1 + retEst)
  }

  return retornoMes - 1
}

// ── Alocações macro com extensão automática para meses não configurados ────

function getAlocacoesExtendidas(db, perfilId, carteiraId, mesInicioStr, mesFimStr) {
  const raw = db.prepare(
    `SELECT * FROM alocacoes_macro WHERE perfil_id = ? AND mes >= ? AND mes <= ? ORDER BY mes`
  ).all(perfilId, mesInicioStr, mesFimStr)

  // Preenche gaps internos: se um mês está faltando, carrega a alocação do mês anterior
  const alocacoes = []
  for (let i = 0; i < raw.length; i++) {
    alocacoes.push(raw[i])
    if (i < raw.length - 1) {
      let [y, m] = raw[i].mes.split('-').map(Number)
      while (true) {
        m++; if (m > 12) { m = 1; y++ }
        const prox = `${y}-${String(m).padStart(2, '0')}`
        if (prox >= raw[i + 1].mes) break
        alocacoes.push({ ...raw[i], mes: prox })
      }
    }
  }

  // Estende para meses além do último configurado se o portfolio tiver estado aberto
  const estadoAberto = db.prepare(
    `SELECT mes FROM estados_portfolio WHERE carteira_id = ? AND data_fim IS NULL ORDER BY mes DESC LIMIT 1`
  ).get(carteiraId)

  if (estadoAberto) {
    const ultimaAlocGlobal = alocacoes.length > 0
      ? alocacoes[alocacoes.length - 1]
      : db.prepare(
          `SELECT * FROM alocacoes_macro WHERE perfil_id = ? AND mes <= ? ORDER BY mes DESC LIMIT 1`
        ).get(perfilId, mesFimStr)

    if (ultimaAlocGlobal && ultimaAlocGlobal.mes < mesFimStr) {
      if (ultimaAlocGlobal.mes < mesInicioStr) {
        // Período inteiramente no futuro — gera todos os meses do período
        let [y, m] = mesInicioStr.split('-').map(Number)
        while (true) {
          const mes = `${y}-${String(m).padStart(2, '0')}`
          if (mes > mesFimStr) break
          alocacoes.push({ ...ultimaAlocGlobal, mes })
          m++; if (m > 12) { m = 1; y++ }
        }
      } else {
        let [y, m] = ultimaAlocGlobal.mes.split('-').map(Number)
        while (true) {
          m++; if (m > 12) { m = 1; y++ }
          const proximo = `${y}-${String(m).padStart(2, '0')}`
          if (proximo > mesFimStr) break
          alocacoes.push({ ...ultimaAlocGlobal, mes: proximo })
        }
      }
    }
  }

  return alocacoes
}

// ── CDI mensal do cache ─────────────────────────────────────

function getCDIMensal(mes) {
  const db = getDb()
  const row = db.prepare(
    `SELECT valor FROM dados_macro WHERE serie = 'CDI_MENSAL' AND data = ?`
  ).get(mes + '-01')
  return row ? row.valor / 100 : null
}

// ── Série diária de retorno acumulado ─────────────────────
// Um ponto por dia útil (via CDI_DIARIO). Para fundos/ações usa cotas reais;
// para rf_curva, cálculo analítico dia a dia.

function calcularSerieDiaria(carteiraId, dataInicio, dataFim) {
  const db = getDb()

  const carteira = db.prepare(
    `SELECT c.*, p.id as perfil_id FROM carteiras c JOIN perfis p ON c.perfil_id = p.id WHERE c.id = ?`
  ).get(carteiraId)
  if (!carteira) return null

  // Todos os estados ativos no período
  const estados = db.prepare(`
    SELECT * FROM estados_portfolio
    WHERE carteira_id = ? AND data_inicio <= ? AND (data_fim IS NULL OR data_fim >= ?)
    ORDER BY data_inicio
  `).all(carteiraId, dataFim, dataInicio)
  if (!estados.length) return null

  // Produtos de todos os estados (batch)
  const estadoIds = estados.map((e) => e.id)
  const phE = estadoIds.map(() => '?').join(',')
  const todosProds = db.prepare(`SELECT * FROM produtos WHERE estado_id IN (${phE})`).all(...estadoIds)
  const prodsByEstado = new Map()
  for (const p of todosProds) {
    if (!prodsByEstado.has(p.estado_id)) prodsByEstado.set(p.estado_id, [])
    prodsByEstado.get(p.estado_id).push(p)
  }

  // Identifiers distintos de fundo/acao
  const identifiers = [...new Set(
    todosProds.filter((p) => (p.tipo === 'fundo' || p.tipo === 'acao') && p.identificador)
              .map((p) => p.identificador)
  )]

  // Cotas em batch (7 dias de buffer antes para calcular retorno do 1º dia)
  const bufferInicio = new Date(dataInicio + 'T12:00:00')
  bufferInicio.setDate(bufferInicio.getDate() - 10)
  const bufferStr = bufferInicio.toISOString().split('T')[0]
  const cotasMapByIdent = new Map()
  if (identifiers.length) {
    const ph2 = identifiers.map(() => '?').join(',')
    const rows = db.prepare(`
      SELECT p.identificador, cc.data, MAX(cc.valor) AS valor, MAX(cc.valor_ajustado) AS valor_ajustado
      FROM cotas_cache cc
      JOIN produtos p ON cc.produto_id = p.id
      WHERE p.identificador IN (${ph2}) AND cc.data >= ? AND cc.data <= ?
      GROUP BY p.identificador, cc.data
      ORDER BY p.identificador, cc.data
    `).all(...identifiers, bufferStr, dataFim)
    for (const r of rows) {
      if (!cotasMapByIdent.has(r.identificador)) cotasMapByIdent.set(r.identificador, new Map())
      // Usa valor_ajustado quando disponível: captura dividendos no dia ex-dividend
      // ?? em vez de || para não descartar valor_ajustado=0 legítimo
      cotasMapByIdent.get(r.identificador).set(r.data, r.valor_ajustado ?? r.valor)
    }
  }

  // CDI diário e IPCA mensal
  const cdiRows = db.prepare(
    `SELECT data, valor FROM dados_macro WHERE serie='CDI_DIARIO' AND data >= ? AND data <= ? ORDER BY data`
  ).all(dataInicio, dataFim)
  if (!cdiRows.length) return null
  const cdiByData = new Map(cdiRows.map((r) => [r.data, r.valor / 100]))
  const diasUteis = cdiRows.map((r) => r.data)

  const ipcaRows = db.prepare(
    `SELECT data, valor FROM dados_macro WHERE serie='IPCA_MENSAL' AND data >= ? AND data <= ? ORDER BY data`
  ).all(dataInicio.slice(0, 7) + '-01', dataFim.slice(0, 7) + '-01')
  const ipcaByMes = new Map(ipcaRows.map((r) => [r.data.slice(0, 7), r.valor / 100]))

  // Alocações macro
  const alocRows = db.prepare(
    `SELECT * FROM alocacoes_macro WHERE perfil_id = ? AND mes >= ? AND mes <= ? ORDER BY mes`
  ).all(carteira.perfil_id, dataInicio.slice(0, 7), dataFim.slice(0, 7))
  const alocByMes = new Map(alocRows.map((a) => [a.mes, a]))

  function getAloc(mes) {
    if (alocByMes.has(mes)) return alocByMes.get(mes)
    const ant = [...alocByMes.keys()].filter((m) => m <= mes).sort()
    return ant.length ? alocByMes.get(ant[ant.length - 1]) : null
  }

  // Pré-computa retornos diários de sub-carteiras (tipo='carteira') por mês
  // Distribui o retorno mensal geometricamente pelos dias úteis do mês
  const subCarteirasIds = [...new Set(
    todosProds.filter((p) => p.tipo === 'carteira' && p.identificador).map((p) => p.identificador)
  )]
  const subRetDiario = new Map() // key: `${subId}_${mes}` → retorno diário geométrico
  if (subCarteirasIds.length > 0) {
    const mesesNoPeriodo = [...new Set(diasUteis.map((d) => d.slice(0, 7)))]
    for (const mes of mesesNoPeriodo) {
      const [y, m] = mes.split('-').map(Number)
      const inicioMes = `${mes}-01`
      const fimMes = new Date(y, m, 0).toISOString().split('T')[0]
      const diasDoMes = diasUteis.filter((d) => d.slice(0, 7) === mes).length
      if (diasDoMes === 0) continue
      for (const subId of subCarteirasIds) {
        const retMensal = calcularRetornoSubCarteira(Number(subId), inicioMes, fimMes)
        if (retMensal != null) {
          const base = 1 + retMensal
          // base <= 0 ocorre se a sub-carteira perdeu 100%+; Math.pow de negativo dá NaN
          subRetDiario.set(`${subId}_${mes}`, base > 0 ? Math.pow(base, 1 / diasDoMes) - 1 : 0)
        }
      }
    }
  }

  // "Última cota conhecida" — pré-alimentado com valores do buffer
  const ultimaCota = new Map()
  for (const [ident, cotasMap] of cotasMapByIdent) {
    const antes = [...cotasMap.keys()].filter((d) => d < dataInicio).sort()
    if (antes.length) ultimaCota.set(ident, cotasMap.get(antes[antes.length - 1]))
  }

  // Estado ativo para um dia: o mais recente cujo data_inicio <= dia
  function getEstado(dia) {
    let ativo = null
    for (const e of estados) {
      if (e.data_inicio > dia) break
      if (!e.data_fim || e.data_fim >= dia) ativo = e
    }
    return ativo
  }

  // Ponto base inicial (dia antes do primeiro dia útil, retorno = 0)
  const serie = []
  let acumulado = 1
  let acumuladoCDI = 1

  for (const dia of diasUteis) {
    const cdiDiario = cdiByData.get(dia) ?? 0
    acumuladoCDI *= 1 + cdiDiario

    const estado = getEstado(dia)
    const mes = dia.slice(0, 7)
    const aloc = getAloc(mes)

    let retDiario = 0
    const filteredIdents = new Set() // identifiers cujo retorno foi rejeitado pelo filtro do dia

    if (estado && aloc) {
      const prods = prodsByEstado.get(estado.id) || []
      const classeMap = {}
      for (const p of prods) {
        if (!classeMap[p.classe]) classeMap[p.classe] = []
        classeMap[p.classe].push(p)
      }

      for (const [classe, classeProds] of Object.entries(classeMap)) {
        const pesoClasse = (aloc[classe] ?? 0) / 100
        if (!pesoClasse) continue
        const pesoTotal = classeProds.reduce((s, p) => s + (p.peso || 0), 0) || 1
        let retClasse = 0

        for (const p of classeProds) {
          let retP = null

          if (p.tipo === 'rf_curva') {
            const { indexador, tipo_cdi, taxa, data_emissao, data_vencimento, isento_ir } = p
            if ((data_vencimento && dia > data_vencimento) || (data_emissao && dia < data_emissao)) {
              retP = 0
            } else if (indexador === 'PRE') {
              retP = Math.pow(1 + taxa / 100, 1 / 252) - 1
            } else if (indexador === 'CDI') {
              retP = tipo_cdi === 'pct'
                ? cdiDiario * (taxa / 100)
                : cdiDiario + Math.pow(1 + taxa / 100, 1 / 252) - 1
            } else if (indexador === 'IPCA') {
              const ipcaMensal = ipcaByMes.get(mes) ?? 0.005
              retP = (Math.pow(1 + ipcaMensal, 1 / 21) - 1) + (Math.pow(1 + taxa / 100, 1 / 252) - 1)
            }
            if (retP !== null && isento_ir) retP /= (1 - 0.15)

          } else if ((p.tipo === 'fundo' || p.tipo === 'acao') && p.identificador) {
            const cotasMap = cotasMapByIdent.get(p.identificador)
            if (cotasMap) {
              const valorHoje = cotasMap.get(dia)
              const valorAntes = ultimaCota.get(p.identificador)
              if (valorHoje && valorAntes && valorAntes > 0) {
                const raw = valorHoje / valorAntes - 1
                // Ignora retornos diários impossíveis (>40% num dia) — dados corrompidos (ex: ICVM 175 / Yahoo glitch)
                if (Math.abs(raw) <= 0.40) retP = raw
                else {
                  filteredIdents.add(p.identificador)
                  console.warn(`[calcularSerieDiaria] retorno filtrado: ${p.identificador} em ${dia} = ${(raw * 100).toFixed(1)}% (>40%)`)
                }
              }
            }
          } else if (p.tipo === 'carteira' && p.identificador) {
            const retDiario = subRetDiario.get(`${p.identificador}_${dia.slice(0, 7)}`)
            if (retDiario != null) retP = retDiario
          }

          if (retP !== null) retClasse += retP * ((p.peso || 0) / pesoTotal)
        }

        retDiario += retClasse * pesoClasse
      }
    }

    acumulado *= 1 + retDiario
    serie.push({ data: dia, retorno_acumulado: acumulado - 1, cdi_acumulado: acumuladoCDI - 1 })

    // Avança "última cota conhecida" — ignora preço 0 e cotas filtradas pelo limiar >40%
    // (não avança para filtradas: evita cascata onde amanhã o preço correto parece outra anomalia)
    for (const [ident, cotasMap] of cotasMapByIdent) {
      const v = cotasMap.get(dia)
      if (v !== undefined && v > 0 && !filteredIdents.has(ident)) ultimaCota.set(ident, v)
    }
  }

  return serie
}

// ── Métricas completas ─────────────────────────────────────

export function calcularMetricas(carteiraId, dataInicio, dataFim) {
  const db = getDb()

  // Buscar carteira
  const carteira = db.prepare(
    `SELECT c.*, p.id as perfil_id FROM carteiras c
     JOIN perfis p ON c.perfil_id = p.id WHERE c.id = ?`
  ).get(carteiraId)

  if (!carteira) return null

  // Quando sem dataInicio (preset "Início"), usa o primeiro dia do primeiro estado da carteira
  const primeiroEstado = !dataInicio
    ? db.prepare(
        `SELECT MIN(data_inicio) as data_inicio FROM estados_portfolio WHERE carteira_id = ?`
      ).get(carteiraId)
    : null
  const inicioEfetivo = dataInicio || primeiroEstado?.data_inicio || '2020-01-01'

  const inicioStr = inicioEfetivo
  const fimStr = dataFim || new Date().toISOString().split('T')[0]

  const mesInicioStr = inicioStr.slice(0, 7)
  const mesFimStr = fimStr.slice(0, 7)

  const alocacoes = getAlocacoesExtendidas(db, carteira.perfil_id, carteiraId, mesInicioStr, mesFimStr)
  if (alocacoes.length === 0) return null

  // Calcular retornos mensais
  const retornosMensais = []
  const serieRetorno = [{ data: mesInicioStr, retorno_acumulado: 0, cdi_acumulado: 0 }]

  let acumulado = 1
  let acumuladoCDI = 1

  for (const aloc of alocacoes) {
    const ret = calcularRetornoMes(carteiraId, aloc.mes, aloc)
    if (ret === null) continue

    const cdi = getCDIMensal(aloc.mes)

    retornosMensais.push({ mes: aloc.mes, retorno: ret, cdi: cdi ?? 0 })
    acumulado *= (1 + ret)
    acumuladoCDI *= (1 + (cdi ?? 0))

    serieRetorno.push({
      data: aloc.mes,
      retorno_acumulado: acumulado - 1,
      cdi_acumulado: acumuladoCDI - 1,
    })
  }

  if (retornosMensais.length === 0) return null

  const retornos = retornosMensais.map((r) => r.retorno)
  const retornoAcumulado = acumulado - 1
  const retornoAcumuladoCDI = acumuladoCDI - 1

  // CAGR
  const anos = retornosMensais.length / 12
  const cagr = Math.pow(acumulado, 1 / anos) - 1

  // Volatilidade (desvio padrão mensal × √12)
  const media = retornos.reduce((a, b) => a + b, 0) / retornos.length
  const variancia = retornos.reduce((s, r) => s + Math.pow(r - media, 2), 0) / (retornos.length - 1)
  const volMensal = Math.sqrt(variancia)
  const volatilidade = volMensal * Math.sqrt(12)

  // Sharpe
  const cdiMedioMensal = retornosMensais.reduce((s, r) => s + (r.cdi || 0), 0) / retornosMensais.length
  const sharpe = volMensal > 0 ? (media - cdiMedioMensal) / volMensal * Math.sqrt(12) : null

  // Sortino — downside deviation padrão (Price/Sortino): divide por n_total, não por n_negativos
  const retNeg = retornos.filter((r) => r < cdiMedioMensal)
  const downDev = retNeg.length > 0
    ? Math.sqrt(retNeg.reduce((s, r) => s + Math.pow(r - cdiMedioMensal, 2), 0) / retornos.length) * Math.sqrt(12)
    : 0
  // Numerador: excesso sobre CDI em base geométrica (evita misturar CAGR geométrico com CDI aritmético)
  const cagrCDI = Math.pow(acumuladoCDI, 1 / anos) - 1
  const sortino = downDev > 0 ? (cagr - cagrCDI) / downDev : null

  // Série diária: fonte de verdade para retorno_acumulado, CDI, Max Drawdown
  const serieDiaria = calcularSerieDiaria(carteiraId, inicioStr, fimStr)
  const ultimoDiario = serieDiaria?.at(-1)

  const retornoFinal    = ultimoDiario?.retorno_acumulado ?? retornoAcumulado
  const retornoCDIFinal = ultimoDiario?.cdi_acumulado     ?? retornoAcumuladoCDI

  // CAGR recalculado pelo número real de dias úteis da série
  const cagrFinal = serieDiaria?.length > 0
    ? Math.pow(1 + retornoFinal, 252 / serieDiaria.length) - 1
    : cagr

  // Max Drawdown calculado a partir da série diária (captura quedas intra-mês)
  let maxDD = 0
  let mddInicio = null
  let mddFim = null
  let picoDiario = -Infinity
  let picoData = null
  if (serieDiaria?.length > 0) {
    for (const { data, retorno_acumulado } of serieDiaria) {
      if (retorno_acumulado > picoDiario) { picoDiario = retorno_acumulado; picoData = data }
      const dd = (1 + retorno_acumulado) / (1 + picoDiario) - 1
      if (dd < maxDD) { maxDD = dd; mddInicio = picoData; mddFim = data }
    }
  } else {
    // Fallback mensal
    let pico = 1, navAtual = 1, picoMes = null
    for (const { mes, retorno } of retornosMensais) {
      navAtual *= (1 + retorno)
      if (navAtual > pico) { pico = navAtual; picoMes = mes }
      const dd = navAtual / pico - 1
      if (dd < maxDD) { maxDD = dd; mddFim = mes; mddInicio = picoMes }
    }
  }

  // mdd_duracao em dias úteis (findIndex retorna -1 se data não constar na série — guards necessários)
  const mddDuracao = (() => {
    if (!mddInicio || !mddFim || !serieDiaria) return null
    const idxFim    = serieDiaria.findIndex(p => p.data === mddFim)
    const idxInicio = serieDiaria.findIndex(p => p.data >= mddInicio)
    return idxFim >= 0 && idxInicio >= 0 ? idxFim - idxInicio : null
  })()

  const calmar = maxDD < 0 ? cagrFinal / Math.abs(maxDD) : null

  // ── VaR e CVaR histórico mensal ─────────────────────────
  const sortedRet = [...retornos].sort((a, b) => a - b)
  const n = sortedRet.length
  const varIdx95 = Math.max(0, Math.floor(0.05 * n) - 1)
  const varIdx99 = Math.max(0, Math.floor(0.01 * n) - 1)
  const var_95  = sortedRet[varIdx95] != null ? -sortedRet[varIdx95] : null
  const cvar_95 = varIdx95 >= 0 ? -(sortedRet.slice(0, varIdx95 + 1).reduce((s, r) => s + r, 0) / (varIdx95 + 1)) : null
  const var_99  = sortedRet[varIdx99] != null ? -sortedRet[varIdx99] : null
  const cvar_99 = varIdx99 >= 0 ? -(sortedRet.slice(0, varIdx99 + 1).reduce((s, r) => s + r, 0) / (varIdx99 + 1)) : null

  // ── Beta e Up/Down Capture vs IBOV ─────────────────────
  const ibovRows = db.prepare(
    `SELECT data, valor FROM dados_macro WHERE serie='IBOV_MENSAL' AND data >= ? AND data <= ? ORDER BY data`
  ).all(mesInicioStr + '-01', mesFimStr + '-01')
  const ibovByMes = new Map(ibovRows.map(r => [r.data.slice(0, 7), r.valor / 100]))

  const paresMesIbov = retornosMensais
    .map(r => ({ mes: r.mes, cart: r.retorno, ibov: ibovByMes.get(r.mes) }))
    .filter(p => p.ibov != null)

  let beta_ibov = null, up_capture = null, down_capture = null
  const ibovDisponivel = paresMesIbov.length >= 12

  if (ibovDisponivel) {
    const cartArr  = paresMesIbov.map(p => p.cart)
    const ibovArr  = paresMesIbov.map(p => p.ibov)
    const mCart    = cartArr.reduce((s, r) => s + r, 0) / cartArr.length
    const mIbov    = ibovArr.reduce((s, r) => s + r, 0) / ibovArr.length
    const covCI    = cartArr.reduce((s, r, i) => s + (r - mCart) * (ibovArr[i] - mIbov), 0) / (cartArr.length - 1)
    const varIbov  = ibovArr.reduce((s, r) => s + Math.pow(r - mIbov, 2), 0) / (ibovArr.length - 1)
    beta_ibov = varIbov > 0 ? covCI / varIbov : null

    const upMeses   = paresMesIbov.filter(p => p.ibov > 0)
    const downMeses = paresMesIbov.filter(p => p.ibov < 0)
    if (upMeses.length >= 6) {
      const acumCartUp  = upMeses.reduce((p, r) => p * (1 + r.cart), 1) - 1
      const acumIbovUp  = upMeses.reduce((p, r) => p * (1 + r.ibov), 1) - 1
      up_capture = acumIbovUp !== 0 ? acumCartUp / acumIbovUp : null
    }
    if (downMeses.length >= 3) {
      const acumCartDn  = downMeses.reduce((p, r) => p * (1 + r.cart), 1) - 1
      const acumIbovDn  = downMeses.reduce((p, r) => p * (1 + r.ibov), 1) - 1
      down_capture = acumIbovDn !== 0 ? acumCartDn / acumIbovDn : null
    }
  }

  // ── Retornos por janela fixa ────────────────────────────
  const anoFim = mesFimStr.slice(0, 4)
  const retorno_mtd = retornosMensais.length > 0 ? retornosMensais.at(-1).retorno : null
  const retorno_ytd = retornosMensais
    .filter(r => r.mes.startsWith(anoFim))
    .reduce((p, r) => p * (1 + r.retorno), 1) - 1 || null
  const ultimos12 = retornosMensais.slice(-12)
  const retorno_12m = ultimos12.length >= 12 ? ultimos12.reduce((p, r) => p * (1 + r.retorno), 1) - 1 : null
  const ultimos24 = retornosMensais.slice(-24)
  const retorno_24m = ultimos24.length >= 24 ? ultimos24.reduce((p, r) => p * (1 + r.retorno), 1) - 1 : null

  return {
    retorno_acumulado: retornoFinal,
    retorno_acumulado_cdi: retornoCDIFinal,
    retorno_vs_cdi: retornoFinal - retornoCDIFinal,
    retorno_vs_cdi_pct: retornoCDIFinal > 0 ? retornoFinal / retornoCDIFinal : null,
    cagr: cagrFinal,
    volatilidade,
    sharpe,
    sortino,
    calmar,
    max_drawdown: maxDD,
    mdd_inicio: mddInicio,
    mdd_fim: mddFim,
    mdd_duracao: mddDuracao,
    melhor_mes: Math.max(...retornos),
    pior_mes: Math.min(...retornos),
    pct_meses_positivos: retornos.filter((r) => r > 0).length / retornos.length,
    retornos_mensais: retornosMensais,
    serie_retorno: serieRetorno,
    serie_retorno_diaria: serieDiaria,
    n_meses: retornosMensais.length,
    // Risco
    var_95, cvar_95, var_99, cvar_99,
    // vs IBOV
    beta_ibov, up_capture, down_capture, ibov_disponivel: ibovDisponivel,
    // Janelas fixas
    retorno_mtd, retorno_ytd, retorno_12m, retorno_24m,
  }
}

// ── Retornos mensais por classe (para otimizador) ──────────

function calcularRetornosMensaisPorClasse(carteiraId, mesInicioStr, mesFimStr) {
  const db = getDb()
  const carteira = db.prepare('SELECT * FROM carteiras WHERE id = ?').get(carteiraId)
  if (!carteira) return []

  const alocacoes = db.prepare(
    `SELECT * FROM alocacoes_macro WHERE perfil_id = ? AND mes >= ? AND mes <= ? ORDER BY mes`
  ).all(carteira.perfil_id, mesInicioStr, mesFimStr)

  const CLASSES = Object.keys(LABELS_CLASSE)
  const resultado = []

  for (const aloc of alocacoes) {
    const [ano, m] = aloc.mes.split('-').map(Number)
    const inicioMes = `${aloc.mes}-01`
    const fimMes = new Date(ano, m, 0).toISOString().split('T')[0]

    const estados = db.prepare(
      `SELECT * FROM estados_portfolio WHERE carteira_id = ? AND mes = ? ORDER BY data_inicio`
    ).all(carteiraId, aloc.mes)

    const row = { mes: aloc.mes }
    for (const cls of CLASSES) {
      const pesoClasse = (aloc[cls] || 0) / 100
      if (pesoClasse === 0) { row[cls] = null; continue }

      let retornoClasse = 0
      let found = false
      for (const est of estados) {
        const prods = db.prepare(
          `SELECT * FROM produtos WHERE estado_id = ? AND classe = ?`
        ).all(est.id, cls)
        if (prods.length === 0) continue
        const retsPorProd = prods.map(p => ({ p, ret: calcularRetornoProduto(p, inicioMes, fimMes) }))
        const pesoComDados = retsPorProd.reduce((s, { p, ret }) => ret != null ? s + (p.peso || 0) : s, 0)
        for (const { p, ret } of retsPorProd) {
          if (ret != null) { retornoClasse += ret * ((p.peso || 0) / (pesoComDados || 1)); found = true }
        }
      }
      row[cls] = found ? retornoClasse : null
    }
    resultado.push(row)
  }
  return resultado
}

// ── Carteira Passiva (benchmark por classe) ────────────────

export function calcularPassiva(carteiraId, dataInicio, dataFim) {
  const db = getDb()
  const carteira = db.prepare(
    `SELECT c.*, p.id as perfil_id FROM carteiras c JOIN perfis p ON c.perfil_id = p.id WHERE c.id = ?`
  ).get(carteiraId)
  if (!carteira) return null

  // Mesmo critério de "Início" que calcularMetricas: usa o primeiro estado da carteira
  const primeiroEstado = !dataInicio
    ? db.prepare(`SELECT MIN(data_inicio) as data_inicio FROM estados_portfolio WHERE carteira_id = ?`).get(carteiraId)
    : null
  const inicioEfetivo = dataInicio || primeiroEstado?.data_inicio || '2020-01-01'

  const mesInicioStr = inicioEfetivo.slice(0, 7)
  const mesFimStr = dataFim?.slice(0, 7) || new Date().toISOString().slice(0, 7)

  const alocacoes = getAlocacoesExtendidas(db, carteira.perfil_id, carteiraId, mesInicioStr, mesFimStr)
  if (alocacoes.length === 0) return null

  const ativoMetricas = calcularMetricas(carteiraId, dataInicio, dataFim)
  if (!ativoMetricas) return null

  const retAtivosMap = {}
  for (const r of ativoMetricas.retornos_mensais) retAtivosMap[r.mes] = r.retorno

  const CLASSES = Object.keys(LABELS_CLASSE)
  const serie = [{ data: mesInicioStr, passivo_acumulado: 0, ativo_acumulado: 0, alpha: 0 }]
  let acumPassivo = 1
  let acumAtivo = 1
  let acumPassivoAlinhado = 1 // compõe só meses com retorno ativo disponível (base justa p/ alpha)
  const retornosMensais = []

  for (const aloc of alocacoes) {
    const mes = aloc.mes
    const cdiRow = db.prepare(
      `SELECT valor FROM dados_macro WHERE serie = 'CDI_MENSAL' AND data = ?`
    ).get(mes + '-01')
    const cdiMensal = cdiRow ? cdiRow.valor / 100 : 0.01

    const ipcaRow = db.prepare(
      `SELECT valor FROM dados_macro WHERE serie = 'IPCA_MENSAL' AND data = ?`
    ).get(mes + '-01')
    const ipcaMensal = ipcaRow ? ipcaRow.valor / 100 : 0.004

    let retPassivo = 0
    for (const cls of CLASSES) {
      const pesoClasse = (aloc[cls] || 0) / 100
      if (pesoClasse === 0) continue
      const retClasse = retornoPassivoClasse(cls, mes, cdiMensal, ipcaMensal, db)
      retPassivo += retClasse * pesoClasse
    }

    const retAtivo = retAtivosMap[mes] ?? null
    retornosMensais.push({ mes, passivo: retPassivo, ativo: retAtivo, cdi: cdiMensal })
    acumPassivo *= (1 + retPassivo)
    if (retAtivo != null) {
      acumAtivo *= (1 + retAtivo)
      acumPassivoAlinhado *= (1 + retPassivo)
    }

    serie.push({
      data: mes,
      passivo_acumulado: acumPassivo - 1,
      ativo_acumulado: retAtivo != null ? acumAtivo - 1 : null,
      // alpha do ponto compara ativo vs passivo na mesma base (só meses com ativo)
      alpha: retAtivo != null ? acumAtivo / acumPassivoAlinhado - 1 : null,
    })
  }

  const T = retornosMensais.length
  const anos = T / 12
  const retornosPassivos = retornosMensais.map((r) => r.passivo)
  const mediaPassivo = retornosPassivos.reduce((a, b) => a + b, 0) / T
  const varPassivo = retornosPassivos.reduce((s, r) => s + Math.pow(r - mediaPassivo, 2), 0) / Math.max(T - 1, 1)
  const volPassivo = Math.sqrt(varPassivo) * Math.sqrt(12)
  const cagrPassivo = anos > 0 ? Math.pow(acumPassivo, 1 / anos) - 1 : 0

  const cdiMedioMensal = retornosMensais.reduce((s, r) => s + (r.cdi || 0), 0) / T
  // CDI anualizado geometricamente (consistente com cagrPassivo); antes usava cdiMensal*12 (aritmético)
  const cagrCDIPassivo = Math.pow(1 + cdiMedioMensal, 12) - 1
  const sharpePassivo = volPassivo > 0 ? (cagrPassivo - cagrCDIPassivo) / volPassivo : null

  // Drawdown passivo
  let picoP = 1, navP = 1, maxDDP = 0
  for (const { passivo } of retornosMensais) {
    navP *= (1 + passivo)
    if (navP > picoP) picoP = navP
    const dd = navP / picoP - 1
    if (dd < maxDDP) maxDDP = dd
  }

  // Tracking error + information ratio
  // Considera apenas meses com retorno ativo disponível (não trata ausência como 0%)
  const alphas = retornosMensais.filter((r) => r.ativo != null).map((r) => r.ativo - r.passivo)
  const mediaAlpha = alphas.length ? alphas.reduce((a, b) => a + b, 0) / alphas.length : 0
  const varAlpha = alphas.reduce((s, a) => s + Math.pow(a - mediaAlpha, 2), 0) / Math.max(alphas.length - 1, 1)
  const trackingError = Math.sqrt(varAlpha) * Math.sqrt(12)
  const informationRatio = trackingError > 0 ? (ativoMetricas.cagr - cagrPassivo) / trackingError : null

  // Rolling 12m alpha (apenas janelas com retorno ativo completo nos 12 meses)
  const rolling_alpha = []
  for (let i = 11; i < retornosMensais.length; i++) {
    const janela = retornosMensais.slice(i - 11, i + 1)
    if (janela.some((r) => r.ativo == null)) continue
    const acumAtivJan = janela.reduce((p, r) => p * (1 + r.ativo), 1)
    const acumPassJan = janela.reduce((p, r) => p * (1 + r.passivo), 1)
    rolling_alpha.push({ data: janela[janela.length - 1].mes, alpha_12m: acumAtivJan / acumPassJan - 1 })
  }

  // Série diária: passivo distribuído uniformemente pelos dias úteis do mês;
  // ativo usa a série diária real de calcularMetricas.
  let serieDiaria = null
  const ativoSerieDiaria = ativoMetricas.serie_retorno_diaria
  if (ativoSerieDiaria?.length > 1) {
    const cdiDiarios = db.prepare(
      `SELECT data FROM dados_macro WHERE serie='CDI_DIARIO' AND data >= ? AND data <= ? ORDER BY data`
    ).all(inicioEfetivo, dataFim || new Date().toISOString().split('T')[0])

    // Conta dias úteis por mês
    const diasPorMes = new Map()
    for (const { data } of cdiDiarios) {
      const m = data.slice(0, 7)
      diasPorMes.set(m, (diasPorMes.get(m) || 0) + 1)
    }

    const passivoMensal = new Map(retornosMensais.map((r) => [r.mes, r.passivo]))
    const ativoByData = new Map(ativoSerieDiaria.map((p) => [p.data, p.retorno_acumulado]))

    let acumPassDiario = 1
    serieDiaria = cdiDiarios.map(({ data }) => {
      const mes = data.slice(0, 7)
      const retMes = passivoMensal.get(mes) ?? 0
      const n = diasPorMes.get(mes) || 21
      acumPassDiario *= Math.pow(1 + retMes, 1 / n)
      return {
        data,
        passivo_acumulado: acumPassDiario - 1,
        ativo_acumulado: ativoByData.get(data) ?? null,
      }
    })
  }

  return {
    serie,
    serie_diaria: serieDiaria,
    rolling_alpha,
    metricas_ativo: {
      retorno_acumulado: ativoMetricas.retorno_acumulado,
      cagr: ativoMetricas.cagr,
      volatilidade: ativoMetricas.volatilidade,
      sharpe: ativoMetricas.sharpe,
      max_drawdown: ativoMetricas.max_drawdown,
    },
    metricas_passivo: {
      retorno_acumulado: acumPassivo - 1,
      cagr: cagrPassivo,
      volatilidade: volPassivo,
      sharpe: sharpePassivo,
      max_drawdown: maxDDP,
    },
    alpha_total: acumAtivo / acumPassivoAlinhado - 1,
    tracking_error: trackingError,
    information_ratio: informationRatio,
    benchmarks: BENCHMARKS_PASSIVA,
    n_meses: T,
  }
}

// ── Dados mensais para exportação Excel ────────────────────

export function calcularDadosExcel(carteiraId, dataInicio, dataFim) {
  const db = getDb()
  const carteira = db.prepare('SELECT c.*, p.nome as perfil_nome FROM carteiras c JOIN perfis p ON c.perfil_id = p.id WHERE c.id = ?').get(carteiraId)
  if (!carteira) return null

  const mesInicioStr = dataInicio?.slice(0, 7) || '2020-01'
  const mesFimStr = dataFim?.slice(0, 7) || new Date().toISOString().slice(0, 7)

  const alocacoes = db.prepare(
    `SELECT * FROM alocacoes_macro WHERE perfil_id = ? AND mes >= ? AND mes <= ? ORDER BY mes`
  ).all(carteira.perfil_id, mesInicioStr, mesFimStr)

  const CLASSES = Object.keys(LABELS_CLASSE)
  const linhas = []
  let acumCarteira = 1
  let acumCDI = 1
  const acumClasse = Object.fromEntries(CLASSES.map((c) => [c, 1]))

  for (const aloc of alocacoes) {
    const [ano, m] = aloc.mes.split('-').map(Number)
    const inicioMes = `${aloc.mes}-01`
    const fimMes = new Date(ano, m, 0).toISOString().split('T')[0]

    const cdiRow = db.prepare("SELECT valor FROM dados_macro WHERE serie='CDI_MENSAL' AND data=?").get(aloc.mes + '-01')
    const cdiMes = cdiRow ? cdiRow.valor / 100 : null

    const estados = db.prepare(`SELECT * FROM estados_portfolio WHERE carteira_id = ? AND mes = ?`).all(carteiraId, aloc.mes)

    let retornoCarteiraMes = 0
    const contribuicaoPorClasse = {}

    for (const cls of CLASSES) {
      const pesoClasse = (aloc[cls] || 0) / 100
      if (pesoClasse === 0) { contribuicaoPorClasse[cls] = null; continue }

      let retornoClasse = 0
      let found = false
      for (const est of estados) {
        const prods = db.prepare(`SELECT * FROM produtos WHERE estado_id = ? AND classe = ?`).all(est.id, cls)
        const retsPorProd = prods.map(p => ({ p, ret: calcularRetornoProduto(p, inicioMes, fimMes) }))
        const pesoComDados = retsPorProd.reduce((s, { p, ret }) => ret != null ? s + (p.peso || 0) : s, 0)
        for (const { p, ret } of retsPorProd) {
          if (ret != null) { retornoClasse += ret * ((p.peso || 0) / (pesoComDados || 1)); found = true }
        }
      }

      const contrib = found ? retornoClasse * pesoClasse : null
      contribuicaoPorClasse[cls] = contrib
      if (contrib != null) retornoCarteiraMes += contrib
      if (found) acumClasse[cls] *= (1 + retornoClasse)
    }

    if (cdiMes != null) acumCDI *= (1 + cdiMes)
    acumCarteira *= (1 + retornoCarteiraMes)

    linhas.push({
      mes: aloc.mes,
      retorno_mensal: retornoCarteiraMes,
      cdi_mensal: cdiMes,
      acumulado_carteira: acumCarteira - 1,
      acumulado_cdi: acumCDI - 1,
      contribuicao: contribuicaoPorClasse,
      acumulado_classe: { ...acumClasse },
    })
  }

  return { carteira: carteira.nome, perfil: carteira.perfil_nome, linhas, labels: LABELS_CLASSE }
}

// ── Helpers de otimização ─────────────────────────────────

// Projeção no simplex com caixa {Σw=1, lo≤w≤hi} via bissecção no multiplicador τ (Duchi et al. 2008)
function projectCappedSimplex(v, lo, hi) {
  function sumW(tau) {
    return v.reduce((s, vi) => s + Math.min(hi, Math.max(lo, vi - tau)), 0)
  }
  let tLo = Math.min(...v) - hi - 1
  let tHi = Math.max(...v) - lo + 1
  for (let i = 0; i < 200; i++) {
    const tMid = (tLo + tHi) / 2
    if (sumW(tMid) > 1) tLo = tMid; else tHi = tMid
    if (tHi - tLo < 1e-14) break
  }
  const tau = (tLo + tHi) / 2
  return v.map(vi => Math.min(hi, Math.max(lo, vi - tau)))
}

// Solver de mínima variância via gradient descent projetado (mínimo global garantido por convexidade)
function solverMinVol(cov, n, minW, maxW, iters = 800) {
  let w = Array(n).fill(1 / n)
  const L = 2 * Math.max(...Array.from({ length: n }, (_, i) => cov[i][i]))
  const lr = L > 0 ? 1 / L : 1
  for (let it = 0; it < iters; it++) {
    const grad = w.map((_, i) => 2 * cov[i].reduce((s, cij, j) => s + cij * w[j], 0))
    const wNew = w.map((wi, i) => wi - lr * grad[i])
    const wProj = projectCappedSimplex(wNew, minW, maxW)
    let change = 0
    for (let i = 0; i < n; i++) change = Math.max(change, Math.abs(wProj[i] - w[i]))
    w = wProj
    if (change < 1e-12) break
  }
  return w
}

// ── Correlação entre classes ───────────────────────────────

export function calcularCorrelacao(carteiraId, dataInicio, dataFim) {
  const db = getDb()
  const mesFimStr = dataFim?.slice(0, 7) || new Date().toISOString().slice(0, 7)
  const primeiroEstado = db.prepare(
    `SELECT MIN(data_inicio) as d FROM estados_portfolio WHERE carteira_id = ?`
  ).get(carteiraId)
  const inicioPossivel = primeiroEstado?.d?.slice(0, 7) ?? '2020-01'
  const inicio24m = (() => {
    const d = new Date(mesFimStr + '-01')
    d.setMonth(d.getMonth() - 23)
    return d.toISOString().slice(0, 7)
  })()
  const mesInicioStr = inicioPossivel > inicio24m ? inicioPossivel : inicio24m

  const retornosMensais = calcularRetornosMensaisPorClasse(carteiraId, mesInicioStr, mesFimStr)
  const CLASSES = Object.keys(LABELS_CLASSE)
  const classesAtivas = CLASSES.filter(cls => retornosMensais.filter(r => r[cls] != null).length >= 12)
  if (classesAtivas.length < 2) return null

  const T = retornosMensais.length
  const retMatrix = retornosMensais.map(row => classesAtivas.map(cls => row[cls] ?? 0))
  const nc = classesAtivas.length
  const means = classesAtivas.map((_, j) => retMatrix.reduce((s, row) => s + row[j], 0) / T)

  const cov = Array.from({ length: nc }, () => Array(nc).fill(0))
  for (let i = 0; i < nc; i++)
    for (let j = 0; j < nc; j++)
      cov[i][j] = retMatrix.reduce((s, row) => s + (row[i] - means[i]) * (row[j] - means[j]), 0) / Math.max(T - 1, 1)

  const matrix = Array.from({ length: nc }, (_, i) =>
    Array.from({ length: nc }, (_, j) => {
      if (i === j) return 1
      const denom = Math.sqrt(cov[i][i] * cov[j][j])
      return denom > 0 ? Math.max(-1, Math.min(1, cov[i][j] / denom)) : 0
    })
  )

  return {
    classes: classesAtivas,
    labels: classesAtivas.map(cls => LABELS_CLASSE[cls]),
    matrix,
    n_meses: T,
  }
}

// ── Painel de Mercado ──────────────────────────────────────

const SERIES_MERCADO = {
  CDI_MENSAL:   'CDI',
  IPCA_MENSAL:  'IPCA',
  IBOV_MENSAL:  'IBOV',
  IMAB11_MENSAL:'IMA-B',
  IFIX_MENSAL:  'IFIX',
  IRFM11_MENSAL:'IRF-M',
  DEBB11_MENSAL:'DEBB11',
}

export function calcularPainelMercado(mes) {
  const db = getDb()
  const [ano] = mes.split('-').map(Number)
  const janAno = `${ano}-01-01`

  const indices = {}
  for (const [serie, label] of Object.entries(SERIES_MERCADO)) {
    const rowMtd = db.prepare(
      `SELECT valor FROM dados_macro WHERE serie=? AND data=?`
    ).get(serie, mes + '-01')
    if (!rowMtd) { indices[serie] = { label, mtd: null, ytd: null, disponivel: false }; continue }

    const rowsYtd = db.prepare(
      `SELECT valor FROM dados_macro WHERE serie=? AND data >= ? AND data <= ? ORDER BY data`
    ).all(serie, janAno, mes + '-01')
    const ytd = rowsYtd.length > 0
      ? rowsYtd.reduce((p, r) => p * (1 + r.valor / 100), 1) - 1
      : null

    indices[serie] = { label, mtd: rowMtd.valor / 100, ytd, disponivel: true }
  }

  return { mes, indices }
}

// ── Otimizador de Carteira (Monte Carlo) ───────────────────

export function otimizarCarteira(carteiraId, dataInicio, dataFim, nSimulacoes = 5000, minPeso = 0, maxPeso = 1) {
  const db = getDb()
  const carteira = db.prepare('SELECT * FROM carteiras WHERE id = ?').get(carteiraId)
  if (!carteira) return null

  const mesFimStr = dataFim?.slice(0, 7) || new Date().toISOString().slice(0, 7)

  // Garante pelo menos 12 meses de histórico para que a covariância seja estável.
  // Se o período selecionado for menor, recua até o início da carteira (ou 24 meses).
  const primeiroEstado = db.prepare(
    `SELECT MIN(data_inicio) as d FROM estados_portfolio WHERE carteira_id = ?`
  ).get(carteiraId)
  const inicioPossivel = primeiroEstado?.d?.slice(0, 7) ?? '2020-01'

  const inicio12m = (() => {
    const d = new Date((mesFimStr + '-01'))
    d.setMonth(d.getMonth() - 23)
    return d.toISOString().slice(0, 7)
  })()
  // Usa o mais recente entre: 24 meses atrás e o início da carteira; ignorando o período selecionado
  const mesInicioStr = inicioPossivel > inicio12m ? inicioPossivel : inicio12m

  const cdiRows = getCDIMensalLocal(mesInicioStr, mesFimStr)
  const cdiMedioMensal = cdiRows.length > 0
    ? cdiRows.reduce((s, r) => s + r.valor / 100, 0) / cdiRows.length
    : 0.01

  const retornosMensais = calcularRetornosMensaisPorClasse(carteiraId, mesInicioStr, mesFimStr)
  const CLASSES = Object.keys(LABELS_CLASSE)

  // Usar apenas classes com dados
  const classesAtivas = CLASSES.filter((cls) => retornosMensais.some((r) => r[cls] != null))
  if (classesAtivas.length < 2) return { error: 'Dados insuficientes. Adicione produtos às classes antes de otimizar.' }

  const T = retornosMensais.length
  // Matriz de retornos (fill 0 quando classe sem dado no mês)
  const retMatrix = retornosMensais.map((row) => classesAtivas.map((cls) => row[cls] ?? 0))

  const n = classesAtivas.length
  const means = classesAtivas.map((_, j) => retMatrix.reduce((s, row) => s + row[j], 0) / T)

  const cov = Array.from({ length: n }, () => Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      cov[i][j] = retMatrix.reduce((s, row) => s + (row[i] - means[i]) * (row[j] - means[j]), 0) / Math.max(T - 1, 1)
    }
  }

  // Alocação atual (última alocação disponível)
  const ultimaAloc = db.prepare(
    `SELECT * FROM alocacoes_macro WHERE perfil_id = ? AND mes <= ? ORDER BY mes DESC LIMIT 1`
  ).get(carteira.perfil_id, mesFimStr)
  const pesosAtuais = classesAtivas.map((cls) => (ultimaAloc?.[cls] || 0) / 100)

  function portfolioStats(weights) {
    const retMensal = weights.reduce((s, w, i) => s + w * means[i], 0)
    let variancia = 0
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) variancia += weights[i] * weights[j] * cov[i][j]
    }
    const vol = Math.sqrt(Math.max(variancia, 0)) * Math.sqrt(12)
    const cagr = Math.pow(1 + retMensal, 12) - 1
    const sharpe = vol > 0 ? (cagr - cdiMedioMensal * 12) / vol : 0
    return { vol, cagr, sharpe }
  }

  const minW = n > 0 ? Math.min(minPeso, (1 - 1e-6) / n) : 0
  const maxW = n > 0 ? Math.max(maxPeso, 1 / n + 1e-10) : 1
  const remaining = 1 - n * minW

  const portfolios = []
  for (let s = 0; s < nSimulacoes; s++) {
    const raw = classesAtivas.map(() => -Math.log(Math.random()))
    const sum = raw.reduce((a, b) => a + b, 0)
    let weights = raw.map((v) => minW + remaining * v / sum)
    // Clamp ao máximo: redistribui o excesso proporcionalmente aos ativos livres
    for (let iter = 0; iter < 30; iter++) {
      const excess = weights.reduce((s, wi) => s + Math.max(0, wi - maxW), 0)
      if (excess < 1e-10) break
      weights = weights.map(wi => Math.min(wi, maxW))
      const freeTotal = weights.reduce((s, wi) => s + (wi < maxW - 1e-10 ? wi : 0), 0)
      if (freeTotal < 1e-10) {
        // Sem capacidade para redistribuir o excesso; fallback para peso igual (sempre ∈ [minW, maxW])
        weights = Array(n).fill(1 / n)
        break
      }
      weights = weights.map(wi => wi < maxW - 1e-10 ? wi + excess * wi / freeTotal : wi)
    }
    // Garantia: pesos somam exatamente 1 (erros de ponto flutuante no clamping)
    const wSum = weights.reduce((a, b) => a + b, 0)
    if (Math.abs(wSum - 1) > 1e-10) weights = weights.map(w => w / wSum)
    portfolios.push({ weights, ...portfolioStats(weights) })
  }

  const maxSharpe = portfolios.reduce((best, p) => (p.sharpe > best.sharpe ? p : best))
  const minVolSample = portfolios.reduce((best, p) => (p.vol < best.vol ? p : best))
  // Dirichlet concentra-se no centróide — refina com solver convexo para garantir mínimo global
  const pesosMinVolSolver = solverMinVol(cov, n, minW, maxW)
  const statsMinVolSolver = portfolioStats(pesosMinVolSolver)
  const minVol = statsMinVolSolver.vol < minVolSample.vol
    ? { weights: pesosMinVolSolver, ...statsMinVolSolver }
    : minVolSample
  const currentStats = portfolioStats(pesosAtuais)

  const toWeightMap = (p) =>
    classesAtivas.reduce((o, cls, i) => ({ ...o, [cls]: p.weights[i] }), {})

  // ERC via active-set com restrições de mínimo e máximo
  const pesosRP = (() => {
    const result = Array(n).fill(0)
    const fixed = new Set()
    let budget = 1

    while (true) {
      const freeIdx = Array.from({ length: n }, (_, i) => i).filter(i => !fixed.has(i))
      const m = freeIdx.length
      if (m === 0) break
      if (m === 1) { result[freeIdx[0]] = Math.max(minW, Math.min(maxW, budget)); break }

      const subCov = freeIdx.map(i => freeIdx.map(j => cov[i][j]))
      // Contribuição cruzada dos ativos fixados ao MRC dos livres (constante no inner loop)
      const fixedContrib = freeIdx.map(i =>
        [...fixed].reduce((s, k) => s + cov[i][k] * result[k], 0)
      )
      let subW = Array(m).fill(1 / m)
      for (let iter = 0; iter < 1000; iter++) {
        // MRC inclui covariância cruzada com ativos fixados (termos ignorados pelo código anterior)
        const mrc = subW.map((_, ii) =>
          budget * subW.reduce((s, wj, jj) => s + subCov[ii][jj] * wj, 0) + fixedContrib[ii]
        )
        const totalVar = subW.reduce((s, wi, ii) => s + wi * budget * mrc[ii], 0)
        if (totalVar <= 0) break
        const newSubW = subW.map((wi, ii) =>
          mrc[ii] > 0 && wi > 0 ? wi * Math.sqrt(totalVar / (m * budget * wi * mrc[ii])) : wi
        )
        let maxChange = 0
        for (let ii = 0; ii < m; ii++) maxChange = Math.max(maxChange, Math.abs(newSubW[ii] - subW[ii]))
        // Sem normalização intra-loop — normalizar a cada passo desloca o atrator de ERC para min-var (Spinu 2013)
        subW = newSubW
        if (maxChange < 1e-12) break
      }
      // Normaliza UMA VEZ após convergência
      const sLoop = subW.reduce((a, b) => a + b, 0)
      if (sLoop > 1e-10) subW = subW.map(v => v / sLoop)
      freeIdx.forEach((i, ii) => { result[i] = subW[ii] * budget })

      const minViolI = freeIdx.filter(i => result[i] < minW - 1e-10)
      if (minViolI.length > 0) {
        const worstI = minViolI.reduce((a, b) => result[a] < result[b] ? a : b)
        result[worstI] = minW; budget -= minW; fixed.add(worstI)
        if (budget <= 1e-10) { freeIdx.forEach(i => { if (i !== worstI) result[i] = 0 }); break }
        continue
      }
      const maxViolI = freeIdx.filter(i => result[i] > maxW + 1e-10)
      if (maxViolI.length > 0) {
        const worstI = maxViolI.reduce((a, b) => result[a] > result[b] ? a : b)
        result[worstI] = maxW; budget -= maxW; fixed.add(worstI)
        if (budget <= 1e-10) { freeIdx.forEach(i => { if (i !== worstI) result[i] = 0 }); break }
        continue
      }
      break
    }

    const rpSum = result.reduce((a, b) => a + b, 0)
    return rpSum > 1e-10 ? result.map(r => r / rpSum) : Array(n).fill(1 / n)
  })()

  return {
    fronteira: portfolios.map((p) => ({ vol: p.vol, cagr: p.cagr, sharpe: p.sharpe })),
    max_sharpe: { weights: toWeightMap(maxSharpe), vol: maxSharpe.vol, cagr: maxSharpe.cagr, sharpe: maxSharpe.sharpe },
    min_vol: { weights: toWeightMap(minVol), vol: minVol.vol, cagr: minVol.cagr, sharpe: minVol.sharpe },
    paridade_risco: { weights: toWeightMap({ weights: pesosRP }), ...portfolioStats(pesosRP) },
    atual: { weights: toWeightMap({ weights: pesosAtuais }), ...currentStats },
    classes: classesAtivas,
    labels: classesAtivas.map((cls) => LABELS_CLASSE[cls]),
    n_meses: T,
    n_simulacoes: nSimulacoes,
  }
}

// ── Otimizador por Ativo (Monte Carlo hierárquico) ─────────

export function otimizarDentroClasse(carteiraId, classe, ativosParam, dataInicio, dataFim, nSimulacoes = 5000, minPeso = 0, maxPeso = 1) {
  const db = getDb()

  const mesFimStr = dataFim?.slice(0, 7) || new Date().toISOString().slice(0, 7)

  // Igual ao otimizador macro: usa sempre pelo menos 24 meses de histórico
  const primeiroEstado = db.prepare(
    `SELECT MIN(data_inicio) as d FROM estados_portfolio WHERE carteira_id = ?`
  ).get(carteiraId)
  const inicioPossivel = primeiroEstado?.d?.slice(0, 7) ?? '2020-01'
  const inicio24m = (() => {
    const d = new Date(mesFimStr + '-01')
    d.setMonth(d.getMonth() - 23)
    return d.toISOString().slice(0, 7)
  })()
  const mesInicioStr = inicioPossivel > inicio24m ? inicioPossivel : inicio24m

  // Meses com estados configurados no período (inclui mês corrente via estado aberto)
  const mesesConfigurados = db.prepare(
    `SELECT DISTINCT ep.mes FROM estados_portfolio ep
     WHERE ep.carteira_id = ? AND ep.mes >= ? AND ep.mes <= ?
     ORDER BY ep.mes`
  ).all(carteiraId, mesInicioStr, mesFimStr).map((r) => r.mes)

  // Estende para o mês corrente se o portfolio tiver estado aberto
  const estadoAberto = db.prepare(
    `SELECT mes FROM estados_portfolio WHERE carteira_id = ? AND data_fim IS NULL ORDER BY mes DESC LIMIT 1`
  ).get(carteiraId)
  const meses = [...mesesConfigurados]
  if (estadoAberto && mesesConfigurados.length > 0) {
    let [y, m] = mesesConfigurados[mesesConfigurados.length - 1].split('-').map(Number)
    while (true) {
      m++; if (m > 12) { m = 1; y++ }
      const proximo = `${y}-${String(m).padStart(2, '0')}`
      if (proximo > mesFimStr) break
      meses.push(proximo)
    }
  }

  if (meses.length < 3) return { error: 'Período insuficiente de dados (mínimo 3 meses).' }

  // Retornos mensais por ativo
  // Para tickers não presentes nesta carteira, busca produto em qualquer carteira como referência
  const ativosComDados = ativosParam.map((ativo) => {
    const retornosMensais = meses.map((mes) => {
      const [ano, m] = mes.split('-').map(Number)
      const inicioMes = `${mes}-01`
      const fimMes = new Date(ano, m, 0).toISOString().split('T')[0]

      const produto =
        db.prepare(`
          SELECT p.* FROM produtos p
          JOIN estados_portfolio ep ON p.estado_id = ep.id
          WHERE ep.carteira_id = ? AND ep.mes = ? AND p.identificador = ? AND p.classe = ?
          LIMIT 1
        `).get(carteiraId, mes, ativo.identificador, classe)
        // Fallback: ticker adicionado manualmente — usa qualquer produto com esse identificador
        ?? db.prepare(`SELECT * FROM produtos WHERE identificador = ? AND tipo = ? LIMIT 1`)
           .get(ativo.identificador, ativo.tipo)

      if (!produto) return null
      return calcularRetornoProduto(produto, inicioMes, fimMes)
    })

    const nComDados = retornosMensais.filter((r) => r != null).length
    return { ...ativo, retornosMensais, n_meses_com_dados: nComDados }
  })

  const minMeses = Math.max(3, Math.ceil(meses.length * 0.3))
  const ativosValidos = ativosComDados.filter((a) => a.n_meses_com_dados >= minMeses)

  if (ativosValidos.length < 2) {
    return {
      error: 'Dados insuficientes para simular. Sincronize as cotas dos ativos primeiro.',
      ativos: ativosComDados.map((a) => ({
        nome: a.nome, identificador: a.identificador, tipo: a.tipo,
        n_meses_com_dados: a.n_meses_com_dados,
        valido: a.n_meses_com_dados >= minMeses,
      })),
    }
  }

  const T = meses.length
  const retMatrix = meses.map((_, mi) =>
    ativosValidos.map((a) => a.retornosMensais[mi] ?? 0)
  )

  const n = ativosValidos.length
  const means = ativosValidos.map((_, j) => retMatrix.reduce((s, row) => s + row[j], 0) / T)

  const cov = Array.from({ length: n }, () => Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      cov[i][j] = retMatrix.reduce((s, row) => s + (row[i] - means[i]) * (row[j] - means[j]), 0) / Math.max(T - 1, 1)
    }
  }

  const cdiRows = getCDIMensalLocal(mesInicioStr, mesFimStr)
  const cdiMedioMensal = cdiRows.length > 0
    ? cdiRows.reduce((s, r) => s + r.valor / 100, 0) / cdiRows.length
    : 0.01

  // Pesos atuais: último estado disponível
  const ultimoEstado = db.prepare(
    `SELECT * FROM estados_portfolio WHERE carteira_id = ? AND mes <= ? ORDER BY mes DESC LIMIT 1`
  ).get(carteiraId, mesFimStr)

  let pesosAtuais = ativosValidos.map(() => 1 / ativosValidos.length)
  if (ultimoEstado) {
    const prods = db.prepare(`SELECT * FROM produtos WHERE estado_id = ? AND classe = ?`).all(ultimoEstado.id, classe)
    const pesoTotal = prods.reduce((s, p) => s + (p.peso || 0), 0) || 1
    const raw = ativosValidos.map((a) => {
      const prod = prods.find((p) => p.identificador === a.identificador)
      return prod ? (prod.peso || 0) / pesoTotal : 0
    })
    const sum = raw.reduce((s, w) => s + w, 0) || 1
    pesosAtuais = raw.map((w) => w / sum)
  }

  function portfolioStats(weights) {
    const retMensal = weights.reduce((s, w, i) => s + w * means[i], 0)
    let variancia = 0
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) variancia += weights[i] * weights[j] * cov[i][j]
    }
    const vol = Math.sqrt(Math.max(variancia, 0)) * Math.sqrt(12)
    const cagr = Math.pow(1 + retMensal, 12) - 1
    const sharpe = vol > 0 ? (cagr - cdiMedioMensal * 12) / vol : 0
    return { vol, cagr, sharpe }
  }

  const minW = n > 0 ? Math.min(minPeso, (1 - 1e-6) / n) : 0
  const maxW = n > 0 ? Math.max(maxPeso, 1 / n + 1e-10) : 1
  const remaining = 1 - n * minW

  const portfolios = []
  for (let s = 0; s < nSimulacoes; s++) {
    const raw = ativosValidos.map(() => -Math.log(Math.random()))
    const sum = raw.reduce((a, b) => a + b, 0)
    let weights = raw.map((v) => minW + remaining * v / sum)
    for (let iter = 0; iter < 30; iter++) {
      const excess = weights.reduce((s, wi) => s + Math.max(0, wi - maxW), 0)
      if (excess < 1e-10) break
      weights = weights.map(wi => Math.min(wi, maxW))
      const freeTotal = weights.reduce((s, wi) => s + (wi < maxW - 1e-10 ? wi : 0), 0)
      if (freeTotal < 1e-10) {
        weights = Array(n).fill(1 / n)
        break
      }
      weights = weights.map(wi => wi < maxW - 1e-10 ? wi + excess * wi / freeTotal : wi)
    }
    // Garantia: pesos somam exatamente 1 (erros de ponto flutuante no clamping)
    const wSum = weights.reduce((a, b) => a + b, 0)
    if (Math.abs(wSum - 1) > 1e-10) weights = weights.map(w => w / wSum)
    portfolios.push({ weights, ...portfolioStats(weights) })
  }

  const maxSharpe = portfolios.reduce((best, p) => (p.sharpe > best.sharpe ? p : best))
  const minVolSample = portfolios.reduce((best, p) => (p.vol < best.vol ? p : best))
  const pesosMinVolSolver = solverMinVol(cov, n, minW, maxW)
  const statsMinVolSolver = portfolioStats(pesosMinVolSolver)
  const minVol = statsMinVolSolver.vol < minVolSample.vol
    ? { weights: pesosMinVolSolver, ...statsMinVolSolver }
    : minVolSample
  const toWeightMap = (p) => ativosValidos.reduce((o, a, i) => ({ ...o, [a.identificador]: p.weights[i] }), {})

  const pesosRP = (() => {
    const result = Array(n).fill(0)
    const fixed = new Set()
    let budget = 1

    while (true) {
      const freeIdx = Array.from({ length: n }, (_, i) => i).filter(i => !fixed.has(i))
      const m = freeIdx.length
      if (m === 0) break
      if (m === 1) { result[freeIdx[0]] = Math.max(minW, Math.min(maxW, budget)); break }

      const subCov = freeIdx.map(i => freeIdx.map(j => cov[i][j]))
      const fixedContrib = freeIdx.map(i =>
        [...fixed].reduce((s, k) => s + cov[i][k] * result[k], 0)
      )
      let subW = Array(m).fill(1 / m)
      for (let iter = 0; iter < 1000; iter++) {
        const mrc = subW.map((_, ii) =>
          budget * subW.reduce((s, wj, jj) => s + subCov[ii][jj] * wj, 0) + fixedContrib[ii]
        )
        const totalVar = subW.reduce((s, wi, ii) => s + wi * budget * mrc[ii], 0)
        if (totalVar <= 0) break
        const newSubW = subW.map((wi, ii) =>
          mrc[ii] > 0 && wi > 0 ? wi * Math.sqrt(totalVar / (m * budget * wi * mrc[ii])) : wi
        )
        let maxChange = 0
        for (let ii = 0; ii < m; ii++) maxChange = Math.max(maxChange, Math.abs(newSubW[ii] - subW[ii]))
        subW = newSubW
        if (maxChange < 1e-12) break
      }
      const sLoop = subW.reduce((a, b) => a + b, 0)
      if (sLoop > 1e-10) subW = subW.map(v => v / sLoop)
      freeIdx.forEach((i, ii) => { result[i] = subW[ii] * budget })

      const minViolI = freeIdx.filter(i => result[i] < minW - 1e-10)
      if (minViolI.length > 0) {
        const worstI = minViolI.reduce((a, b) => result[a] < result[b] ? a : b)
        result[worstI] = minW; budget -= minW; fixed.add(worstI)
        if (budget <= 1e-10) { freeIdx.forEach(i => { if (i !== worstI) result[i] = 0 }); break }
        continue
      }
      const maxViolI = freeIdx.filter(i => result[i] > maxW + 1e-10)
      if (maxViolI.length > 0) {
        const worstI = maxViolI.reduce((a, b) => result[a] > result[b] ? a : b)
        result[worstI] = maxW; budget -= maxW; fixed.add(worstI)
        if (budget <= 1e-10) { freeIdx.forEach(i => { if (i !== worstI) result[i] = 0 }); break }
        continue
      }
      break
    }

    const rpSum2 = result.reduce((a, b) => a + b, 0)
    return rpSum2 > 1e-10 ? result.map(r => r / rpSum2) : Array(n).fill(1 / n)
  })()

  return {
    classe,
    label_classe: LABELS_CLASSE[classe] || classe,
    ativos: ativosComDados.map((a) => ({
      nome: a.nome, identificador: a.identificador, tipo: a.tipo,
      n_meses_com_dados: a.n_meses_com_dados,
      valido: ativosValidos.some((v) => v.identificador === a.identificador),
    })),
    fronteira: portfolios.map((p) => ({ vol: p.vol, cagr: p.cagr, sharpe: p.sharpe })),
    max_sharpe: { ...maxSharpe, weights: toWeightMap(maxSharpe) },
    min_vol: { ...minVol, weights: toWeightMap(minVol) },
    paridade_risco: { weights: toWeightMap({ weights: pesosRP }), ...portfolioStats(pesosRP) },
    atual: { ...portfolioStats(pesosAtuais), weights: toWeightMap({ weights: pesosAtuais }) },
    n_meses: T,
    n_simulacoes: nSimulacoes,
  }
}

// ── Benchmark mensal por classe ────────────────────────────

function getBenchmarkMensalClasse(cls, cdiMensal, ipcaMensal, mes, db) {
  return retornoPassivoClasse(cls, mes, cdiMensal, ipcaMensal, db)
}

// ── Atribuição por classe ───────────────────────────────────

export function calcularAtribuicao(carteiraId, dataInicio, dataFim) {
  const db = getDb()
  const carteira = db.prepare('SELECT * FROM carteiras WHERE id = ?').get(carteiraId)
  if (!carteira) return null

  const mesInicioStr = dataInicio?.slice(0, 7) || '2020-01'
  const mesFimStr = dataFim?.slice(0, 7) || new Date().toISOString().slice(0, 7)

  const alocacoes = getAlocacoesExtendidas(db, carteira.perfil_id, carteiraId, mesInicioStr, mesFimStr)
  if (alocacoes.length === 0) return null

  const CLASSES = LABELS_CLASSE

  // Acumuladores por classe
  const acumClasse = {}
  for (const cls of Object.keys(CLASSES)) {
    acumClasse[cls] = { retorno: 1, benchmark: 1, contribuicao_acum: 0, peso_medio: 0, n: 0 }
  }

  // Acumuladores por ativo: chave = "nome__identificador__classe"
  const acumAtivo = {}

  let retornoTotal = 1

  for (const aloc of alocacoes) {
    const estados = db.prepare(
      `SELECT * FROM estados_portfolio WHERE carteira_id = ? AND mes = ?`
    ).all(carteiraId, aloc.mes)

    const [ano, m] = aloc.mes.split('-').map(Number)
    const inicioMes = `${aloc.mes}-01`
    const fimMes = new Date(ano, m, 0).toISOString().split('T')[0]

    // Macro do mês
    const cdiRow = db.prepare(
      "SELECT valor FROM dados_macro WHERE serie='CDI_MENSAL' AND data=?"
    ).get(aloc.mes + '-01')
    const ipcaRow = db.prepare(
      "SELECT valor FROM dados_macro WHERE serie='IPCA_MENSAL' AND data=?"
    ).get(aloc.mes + '-01')
    const cdiMensal = cdiRow ? cdiRow.valor / 100 : 0
    const ipcaMensal = ipcaRow ? ipcaRow.valor / 100 : 0

    for (const cls of Object.keys(CLASSES)) {
      const pesoClasse = (aloc[cls] || 0) / 100
      if (pesoClasse === 0) continue

      const benchmarkMes = getBenchmarkMensalClasse(cls, cdiMensal, ipcaMensal, aloc.mes, db)

      // Coletar todos os produtos desta classe neste mês
      const todosProdutos = []
      for (const est of estados) {
        const prods = db.prepare(
          `SELECT * FROM produtos WHERE estado_id = ? AND classe = ?`
        ).all(est.id, cls)
        todosProdutos.push(...prods)
      }

      const retsPorProdAtrib = todosProdutos.map(p => ({ p, ret: calcularRetornoProduto(p, inicioMes, fimMes) }))
      const pesoComDadosAtrib = retsPorProdAtrib.reduce((s, { p, ret }) => ret != null ? s + (p.peso || 0) : s, 0)
      let retornoClasse = 0

      for (const { p, ret } of retsPorProdAtrib) {
        const pesoNorm = (p.peso || 0) / (pesoComDadosAtrib || 1)
        if (ret != null) retornoClasse += ret * pesoNorm

        // Acumular por ativo — normaliza tickers renomeados para o nome canônico
        if (!p.identificador) continue  // produto sem identificador não pode ser rastreado individualmente
        const TICKER_CANONICAL = { 'CVBI11': 'PCIP11' }
        const canonicalId = TICKER_CANONICAL[p.identificador] ?? p.identificador
        const ativoKey = `${canonicalId}__${cls}`
        if (!acumAtivo[ativoKey]) {
          acumAtivo[ativoKey] = {
            nome: p.nome || canonicalId,
            identificador: canonicalId,
            tipo: p.tipo,
            classe: cls,
            retorno_acum: 1,
            benchmark_acum: 1,
            contribuicao_total: 0,
            peso_portfolio_medio: 0,
            peso_classe_medio: 0,
            n: 0,
            sem_dados: false,
            indexador: p.indexador,
            tipo_cdi: p.tipo_cdi,
            taxa: p.taxa,
            data_vencimento: p.data_vencimento,
            duration_manual: p.duration_manual,
          }
        }
        const a = acumAtivo[ativoKey]
        // Atualiza campos de duration com os valores mais recentes do ativo
        a.indexador = p.indexador
        a.tipo_cdi = p.tipo_cdi
        a.taxa = p.taxa
        a.data_vencimento = p.data_vencimento
        a.duration_manual = p.duration_manual
        if (ret != null) {
          a.retorno_acum *= (1 + ret)
          a.contribuicao_total += ret * pesoNorm * pesoClasse
        } else {
          a.sem_dados = true
        }
        a.benchmark_acum *= (1 + benchmarkMes)
        a.peso_portfolio_medio += pesoNorm * pesoClasse
        a.peso_classe_medio += pesoNorm
        a.n++
      }

      acumClasse[cls].retorno *= (1 + retornoClasse)
      acumClasse[cls].benchmark *= (1 + benchmarkMes)
      acumClasse[cls].contribuicao_acum += retornoClasse * pesoClasse
      acumClasse[cls].peso_medio += pesoClasse
      acumClasse[cls].n++
      retornoTotal *= (1 + retornoClasse * pesoClasse)
    }
  }

  const hoje = new Date().toISOString().split('T')[0]

  // Montar ativos por classe
  const ativosPorClasse = {}
  for (const [key, a] of Object.entries(acumAtivo)) {
    if (!ativosPorClasse[a.classe]) ativosPorClasse[a.classe] = []
    const retorno = a.retorno_acum - 1
    const benchmark = a.benchmark_acum - 1
    const duration = calcularDurationRF({
      tipo: a.tipo,
      indexador: a.indexador,
      tipo_cdi: a.tipo_cdi,
      taxa: a.taxa,
      data_vencimento: a.data_vencimento,
      duration_manual: a.duration_manual,
    }, hoje)
    ativosPorClasse[a.classe].push({
      nome: a.nome,
      identificador: a.identificador,
      tipo: a.tipo,
      peso_portfolio: a.n > 0 ? a.peso_portfolio_medio / a.n : 0,
      peso_classe: a.n > 0 ? a.peso_classe_medio / a.n : 0,
      retorno,
      contribuicao: a.contribuicao_total,
      vs_benchmark: a.sem_dados ? null : retorno - benchmark,
      sem_dados: a.sem_dados,
      duration,
    })
  }

  const classes = Object.entries(CLASSES).map(([key, nome]) => {
    const ac = acumClasse[key]
    const retorno = ac.retorno - 1
    const benchmark = ac.benchmark - 1
    const ativosClasse = ativosPorClasse[key] ?? []

    // Média ponderada de duration dos ativos rf_curva da classe (pelo peso na classe)
    const rfComDuration = ativosClasse.filter((a) => a.duration != null)
    const pesoRF = rfComDuration.reduce((s, a) => s + a.peso_classe, 0)
    const duration_media_rf = rfComDuration.length > 0 && pesoRF > 0
      ? rfComDuration.reduce((s, a) => s + a.duration * (a.peso_classe / pesoRF), 0)
      : null

    return {
      key,
      nome,
      peso: ac.n > 0 ? ac.peso_medio / ac.n : 0,
      retorno,
      contribuicao: ac.contribuicao_acum,
      benchmark,
      vs_benchmark: retorno - benchmark,
      duration_media_rf,
      ativos: ativosClasse.sort((a, b) => b.contribuicao - a.contribuicao),
    }
  }).filter((c) => c.peso > 0 || c.retorno !== 0)

  return { classes, retorno_total: retornoTotal - 1 }
}
