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
  pos_fixado:      '60% CDI + 40% IDA-DI (DEBB11)',
  inflacao:        'IMA-B (IMAB11)',
  prefixado:       'IRF-M (IRFM11)',
  rf_global:       'AGG + Hedge BRL',
  multimercado:    'IHFA',
  rv_brasil:       'Ibovespa',
  rv_global:       'ACWI + Hedge BRL',
  fundos_listados: 'IFIX',
  alternativos:    'Ouro (Trend Ouro)',  // provisório — sem série de índice de ouro dedicada ainda
}

// Proxy de ouro para o benchmark de alternativos — CNPJ do Trend Ouro FIF Mult,
// escolhido por ter o maior histórico disponível (Economatica desde 2019) entre
// os produtos de ouro já presentes no sistema.
const OURO_CNPJ_PROXY = '22.963.439/0001-52'

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

// Benchmark adaptativo: IBOV para RV Brasil, IFIX para FIIs, Passivo para multi-estratégia
const BENCHMARK_POR_CLASSE = {
  rv_brasil:      { serie: 'IBOV_MENSAL',   label: 'IBOV' },
  fundos_listados:{ serie: 'IFIX_MENSAL',   label: 'IFIX' },
  rv_global:      { serie: 'ACWI_MENSAL',   label: 'ACWI' },
  inflacao:       { serie: 'IMAB11_MENSAL', label: 'IMA-B' },
  prefixado:      { serie: 'IRFM11_MENSAL', label: 'IRF-M' },
  multimercado:   { serie: 'IHFA_MENSAL',   label: 'IHFA' },
  pos_fixado:     { serie: 'CDI_MENSAL',    label: 'CDI' },
}

// Contraparte diária real (Economatica/BCB) de cada série mensal de benchmark —
// usada para dar volatilidade real ao gráfico da carteira passiva em vez de
// espalhar o retorno mensal uniformemente pelos dias úteis.
const SERIE_DIARIA_POR_MENSAL = {
  IBOV_MENSAL:   'IBOV_DIARIO',
  IFIX_MENSAL:   'IFIX_DIARIO',
  IMAB11_MENSAL: 'IMAB_DIARIO',
  IRFM11_MENSAL: 'IRFM_DIARIO',
  IHFA_MENSAL:   'IHFA_DIARIO',
  CDI_MENSAL:    'CDI_DIARIO',
}

// Determina se a carteira tem um único benchmark "limpo" (override explícito
// ou classe dominante >50% da alocação média) — usado tanto para beta/up-down
// capture (calcularMetricas) quanto para a série diária real (calcularPassiva).
function getSingleBenchmarkSerie(carteira, alocacoes) {
  if (carteira.benchmark_override) {
    return { serieMensal: carteira.benchmark_override, label: carteira.benchmark_override.replace('_MENSAL', ''), classe: null }
  }
  const classes = Object.keys(LABELS_CLASSE)
  const pesoMedioClasse = {}
  for (const cls of classes)
    pesoMedioClasse[cls] = alocacoes.reduce((s, a) => s + (a[cls] || 0), 0) / Math.max(alocacoes.length, 1)
  const classeDOM = classes.find((cls) => pesoMedioClasse[cls] > 50)
  if (classeDOM && BENCHMARK_POR_CLASSE[classeDOM]) {
    return { serieMensal: BENCHMARK_POR_CLASSE[classeDOM].serie, label: BENCHMARK_POR_CLASSE[classeDOM].label, classe: classeDOM }
  }
  return null
}

// Compõe o retorno acumulado real dia a dia de uma série de níveis (ex:
// IBOV_DIARIO), amostrado nas datas de referência (calendário CDI_DIARIO —
// datas fora do calendário do índice carregam o último nível conhecido).
function serieDiariaPassivoReal(db, serieDiario, datasReferencia, mesInicioStr, mesFimStr) {
  const rows = db.prepare(
    `SELECT data, valor FROM dados_macro WHERE serie = ? AND data >= ? AND data <= ? ORDER BY data`
  ).all(serieDiario, mesInicioStr + '-01', mesFimStr + '-31')
  if (rows.length < 2) return null

  // `rows` busca desde o 1º dia do mês (mesInicioStr) mesmo quando o período
  // custom começa no meio do mês — necessário pra ter um nível/taxa de base
  // pro primeiro dia de referência. Mas essas linhas anteriores a ela só podem
  // servir de base, nunca compor no acumulado: senão o primeiro ponto do
  // gráfico já nasceria deslocado (ex: início custom dia 12 acumulando CDI
  // desde o dia 1º antes mesmo do primeiro ponto visível).
  const primeiraData = datasReferencia[0]

  let acumulado = 1
  let idx = 0
  const resultado = new Map()

  // CDI_DIARIO guarda a taxa diária (% a.d.), não um nível de índice como as
  // demais séries deste mapa — cada linha já É o retorno do dia. Tratá-la
  // como nível (razão entre linhas consecutivas) confunde corte de juros
  // (Copom) com perda de capital, gerando quedas artificiais no gráfico.
  if (serieDiario === 'CDI_DIARIO') {
    for (const data of datasReferencia) {
      while (idx < rows.length && rows[idx].data <= data) {
        if (rows[idx].data >= primeiraData) acumulado *= 1 + rows[idx].valor / 100
        idx++
      }
      resultado.set(data, acumulado - 1)
    }
    return resultado
  }

  let ultimoNivel = null
  for (const data of datasReferencia) {
    while (idx < rows.length && rows[idx].data <= data) {
      if (ultimoNivel != null && rows[idx].data >= primeiraData) acumulado *= rows[idx].valor / ultimoNivel
      ultimoNivel = rows[idx].valor
      idx++
    }
    resultado.set(data, acumulado - 1)
  }
  return resultado
}

// Retorno de nível [inicio,fim] a partir de cotas_cache (produto real, ex: Trend Ouro) —
// mesmo contrato de retornoNivelDiario, mas para séries que vivem em cotas_cache
// em vez de dados_macro (ainda não temos uma série de índice de ouro dedicada).
function retornoNivelCotaCache(identificador, inicio, fim, db) {
  const v0 = db.prepare(
    `SELECT cc.valor FROM cotas_cache cc JOIN produtos p ON cc.produto_id = p.id
     WHERE p.identificador = ? AND cc.data >= ? AND cc.data <= ? ORDER BY cc.data LIMIT 1`
  ).get(identificador, inicio, fim)
  const v1 = db.prepare(
    `SELECT cc.valor FROM cotas_cache cc JOIN produtos p ON cc.produto_id = p.id
     WHERE p.identificador = ? AND cc.data >= ? AND cc.data <= ? ORDER BY cc.data DESC LIMIT 1`
  ).get(identificador, inicio, fim)
  if (!v0 || !v1 || v0.valor == null || v1.valor == null || v0.valor <= 0) return null
  return v1.valor / v0.valor - 1
}

function retornoPassivoClasse(cls, mes, cdiMensal, ipcaMensal, db) {
  const mesData = mes + '-01'

  if (cls === 'alternativos') {
    const [ano, m] = mes.split('-').map(Number)
    const ultimoDiaMes = new Date(ano, m, 0).toISOString().split('T')[0]
    const ouro = retornoNivelCotaCache(OURO_CNPJ_PROXY, mesData, ultimoDiaMes, db)
    return ouro != null ? ouro : cdiMensal
  }

  if (cls === 'pos_fixado') {
    const debb = db.prepare(`SELECT valor FROM dados_macro WHERE serie='DEBB11_MENSAL' AND data=?`).get(mesData)
    if (debb) return 0.6 * cdiMensal + 0.4 * (debb.valor / 100)
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

  const mesFim = dataFim.slice(0, 7)

  // Por intervalo de data, não pela tag `mes` (que só reflete o mês do
  // rebalance) — um estado tagueado num mês anterior pode seguir aberto e
  // cobrir todo o período pedido. Mesmo padrão de calcularSerieDiaria.
  const estados = db.prepare(`
    SELECT * FROM estados_portfolio
    WHERE carteira_id = ? AND data_inicio <= ? AND (data_fim IS NULL OR data_fim >= ?)
    ORDER BY data_inicio
  `).all(subCarteiraId, dataFim, dataInicio)

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

      // Guard: ratio < 0.5 indica recalibração retroativa suspeita (ex: Yahoo interpretou
      // dados corrompidos como grupamento e ajustou toda a série por /100).
      // Yield máximo realista para FIIs/ações em 2 anos ≈ 25%, portanto ratio ≥ 0.75.
      // Cobre splits legítimos: eles têm ratioDrift > 20 e são rejeitados pelo check abaixo.
      if (minRatio < 0.5) {
        console.warn(`[calcularRetornoProduto] ${produto.identificador}: valor_ajustado suspeito (ratio=${(minRatio * 100).toFixed(1)}%) — possível recalibração corrompida, usando preço nominal`)
        valorInicio = first.valor
        valorFim    = last.valor
        if (!valorInicio || valorInicio === 0) return null
        return valorFim / valorInicio - 1
      }

      // Detecta quando todos os preços ajustados são iguais ao nominal ao longo do período inteiro.
      // Isso indica que a fonte não rastreia dividendos (comum em FIIs via Yahoo/Alpha Vantage).
      // Nesse caso, corrige usando dividendos registrados em eventos_corporativos.
      const nSemAjuste = cotasPrimary.filter(r => r.valor_ajustado != null && Math.abs(r.valor_ajustado - r.valor) < 0.001).length
      const propSemAjuste = nSemAjuste / cotasPrimary.length
      if (propSemAjuste > 0.95 && cotasPrimary.length >= 20 && produto.classe === 'fundos_listados') {
        // Fonte não fornece preços ajustados — usa retorno nominal + dividendos de eventos_corporativos
        const dividendos = db.prepare(
          `SELECT data, valor FROM eventos_corporativos
           WHERE ticker = ? AND tipo = 'dividendo' AND data >= ? AND data <= ?
           ORDER BY data`
        ).all(produto.identificador, dataInicio, dataFim)
        if (dividendos.length > 0) {
          const totalDiv = dividendos.reduce((s, d) => s + d.valor, 0)
          const retNominal = first.valor > 0 ? last.valor / first.valor - 1 : null
          if (retNominal != null) {
            // Retorno total ≈ retorno nominal + yield dos dividendos (divididos pelo preço inicial)
            return retNominal + totalDiv / first.valor
          }
        }
        console.warn(`[calcularRetornoProduto] ${produto.identificador}: fonte sem preços ajustados para FII listado; retorno é apenas ganho de capital (sem rendimentos)`)
      }

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

  // Alocações macro. Sem limite inferior: getAloc precisa conseguir achar a
  // alocação vigente mesmo quando o último mês configurado é anterior a
  // dataInicio (ex: alocação parada em 2026-03, período selecionado é julho).
  const alocRows = db.prepare(
    `SELECT * FROM alocacoes_macro WHERE perfil_id = ? AND mes <= ? ORDER BY mes`
  ).all(carteira.perfil_id, dataFim.slice(0, 7))
  const alocByMes = new Map(alocRows.map((a) => [a.mes, a]))

  function getAloc(mes) {
    if (alocByMes.has(mes)) return alocByMes.get(mes)
    const ant = [...alocByMes.keys()].filter((m) => m <= mes).sort()
    return ant.length ? alocByMes.get(ant[ant.length - 1]) : null
  }

  // Pré-computa a série diária real de cada sub-carteira (tipo='carteira') —
  // usa o mesmo motor diário (calcularSerieDiaria), não mais o retorno mensal
  // de calcularRetornoEstado espalhado pelos dias do mês. Esse espalhamento,
  // além de achatar a volatilidade, buscava estados pela tag `mes` (não por
  // intervalo de data) e podia divergir bastante do retorno real da
  // sub-carteira quando ela tinha mais de um estado por mês ou meses sem
  // estado próprio — mesmo padrão de bug já corrigido em outras funções.
  const subCarteirasIds = [...new Set(
    todosProds.filter((p) => p.tipo === 'carteira' && p.identificador).map((p) => p.identificador)
  )]
  const subRetDiario = new Map() // key: `${subId}_${data}` → retorno diário real
  for (const subId of subCarteirasIds) {
    const serieSub = calcularSerieDiaria(Number(subId), dataInicio, dataFim)
    if (!serieSub?.length) continue
    for (let i = 1; i < serieSub.length; i++) {
      const ret = (1 + serieSub[i].retorno_acumulado) / (1 + serieSub[i - 1].retorno_acumulado) - 1
      subRetDiario.set(`${subId}_${serieSub[i].data}`, ret)
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
      // Não descarta por data_fim ultrapassada: um gap entre o fim de um
      // estado e o início do próximo (falha de publicação, não intenção de
      // ficar sem posição) herda o último estado conhecido, em vez de zerar
      // o retorno do dia enquanto o CDI de comparação segue acumulando.
      ativo = e
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

        // Dois passos: primeiro coleta os retornos do dia, depois renormaliza
        // pelo peso só dos produtos com dado hoje. Evita diluir a classe
        // quando um produto sem cotação no dia mantinha seu peso no
        // denominador (subestimava o retorno do dia silenciosamente).
        const retsPorProd = classeProds.map((p) => {
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
            const retDiarioSub = subRetDiario.get(`${p.identificador}_${dia}`)
            if (retDiarioSub != null) retP = retDiarioSub
          }

          return { p, retP }
        })

        const pesoComDados = retsPorProd.reduce((s, { p, retP }) => retP != null ? s + (p.peso || 0) : s, 0)
        let retClasse = 0
        for (const { p, retP } of retsPorProd) {
          if (retP !== null) retClasse += retP * ((p.peso || 0) / (pesoComDados || 1))
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

  const anos = retornosMensais.length / 12
  const cagr = Math.pow(acumulado, 1 / anos) - 1
  const cagrCDI = Math.pow(acumuladoCDI, 1 / anos) - 1

  // Série diária: fonte de verdade para retorno_acumulado, CDI, Max Drawdown e,
  // abaixo, Volatilidade/Sharpe/Sortino — os retornos mensais inteiros vazam
  // dias fora do período quando o início/fim customizado não cai em virada de
  // mês (ex: início dia 12 ainda soma o mês inteiro desde o dia 1º).
  const serieDiaria = calcularSerieDiaria(carteiraId, inicioStr, fimStr)
  const ultimoDiario = serieDiaria?.at(-1)

  const retornoFinal    = ultimoDiario?.retorno_acumulado ?? retornoAcumulado
  const retornoCDIFinal = ultimoDiario?.cdi_acumulado     ?? retornoAcumuladoCDI

  // CAGR recalculado pelo número real de dias úteis da série
  const cagrFinal = serieDiaria?.length > 0
    ? Math.pow(1 + retornoFinal, 252 / serieDiaria.length) - 1
    : cagr
  const cagrCDIFinal = serieDiaria?.length > 0
    ? Math.pow(1 + retornoCDIFinal, 252 / serieDiaria.length) - 1
    : cagrCDI

  // Retornos diários (diferença consecutiva da série diária) — base de
  // Volatilidade/Sharpe/Sortino quando disponível. Cai pro mensal só se a
  // série diária não puder ser montada (ex: sem CDI_DIARIO no período).
  const retornosDiarios = []
  const cdiDiariosSerie = []
  if (serieDiaria?.length > 1) {
    for (let i = 1; i < serieDiaria.length; i++) {
      retornosDiarios.push((1 + serieDiaria[i].retorno_acumulado) / (1 + serieDiaria[i - 1].retorno_acumulado) - 1)
      cdiDiariosSerie.push((1 + serieDiaria[i].cdi_acumulado) / (1 + serieDiaria[i - 1].cdi_acumulado) - 1)
    }
  }
  const usaDiario = retornosDiarios.length >= 2
  const anualizador = usaDiario ? Math.sqrt(252) : Math.sqrt(12)
  const retBase = usaDiario ? retornosDiarios : retornos
  const cdiBase = usaDiario ? cdiDiariosSerie : retornosMensais.map((r) => r.cdi || 0)

  // Volatilidade (desvio padrão anualizado)
  const media = retBase.reduce((a, b) => a + b, 0) / retBase.length
  const variancia = retBase.reduce((s, r) => s + Math.pow(r - media, 2), 0) / (retBase.length - 1)
  const volPeriodo = Math.sqrt(variancia)
  const volatilidade = volPeriodo * anualizador

  // Sharpe
  const cdiMedioPeriodo = cdiBase.reduce((a, b) => a + b, 0) / cdiBase.length
  const sharpe = volPeriodo > 0 ? (media - cdiMedioPeriodo) / volPeriodo * anualizador : null

  // Sortino — downside deviation padrão (Price/Sortino): divide por n_total, não por n_negativos
  const retNeg = retBase.filter((r, i) => r < cdiBase[i])
  const downDev = retNeg.length > 0
    ? Math.sqrt(retNeg.reduce((s, r) => s + Math.pow(r - cdiMedioPeriodo, 2), 0) / retBase.length) * anualizador
    : 0
  // Numerador: excesso sobre CDI em base geométrica, já recortado ao período exato
  const sortino = downDev > 0 ? (cagrFinal - cagrCDIFinal) / downDev : null

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

  // ── Benchmark adaptativo: IBOV para RV Brasil, IFIX para FIIs, Passivo para multi-estratégia ──
  const CLASSES_BETA = Object.keys(LABELS_CLASSE)
  const benchmarkUnico = getSingleBenchmarkSerie(carteira, alocacoes)

  let benchmarkByMes = new Map()
  let benchmark_label = 'Passivo'

  if (benchmarkUnico) {
    benchmark_label = benchmarkUnico.label
    const bmkRows = db.prepare(
      `SELECT data, valor FROM dados_macro WHERE serie=? AND data >= ? AND data <= ? ORDER BY data`
    ).all(benchmarkUnico.serieMensal, mesInicioStr + '-01', mesFimStr + '-01')
    benchmarkByMes = new Map(bmkRows.map(r => [r.data.slice(0, 7), r.valor / 100]))
  } else {
    // Multi-estratégia: benchmark passivo composto (retorno ponderado dos índices por classe)
    for (const aloc of alocacoes) {
      const mes = aloc.mes
      const cdiRow  = db.prepare(`SELECT valor FROM dados_macro WHERE serie='CDI_MENSAL' AND data=?`).get(mes + '-01')
      const ipcaRow = db.prepare(`SELECT valor FROM dados_macro WHERE serie='IPCA_MENSAL' AND data=?`).get(mes + '-01')
      const cdiM  = cdiRow  ? cdiRow.valor  / 100 : 0.01
      const ipcaM = ipcaRow ? ipcaRow.valor / 100 : 0.004
      let retBmk = 0
      for (const cls of CLASSES_BETA) {
        const peso = (aloc[cls] || 0) / 100
        if (peso === 0) continue
        retBmk += retornoPassivoClasse(cls, mes, cdiM, ipcaM, db) * peso
      }
      benchmarkByMes.set(mes, retBmk)
    }
  }

  // Beta e Up/Down Capture vs benchmark escolhido
  const paresBmk = retornosMensais
    .map(r => ({ mes: r.mes, cart: r.retorno, bmk: benchmarkByMes.get(r.mes) }))
    .filter(p => p.bmk != null)

  let beta = null, up_capture = null, down_capture = null
  const benchmark_disponivel = paresBmk.length >= 12

  if (benchmark_disponivel) {
    const cartArr = paresBmk.map(p => p.cart)
    const bmkArr  = paresBmk.map(p => p.bmk)
    const mCart   = cartArr.reduce((s, r) => s + r, 0) / cartArr.length
    const mBmk    = bmkArr.reduce((s, r) => s + r, 0) / bmkArr.length
    const covCB   = cartArr.reduce((s, r, i) => s + (r - mCart) * (bmkArr[i] - mBmk), 0) / (cartArr.length - 1)
    const varBmk  = bmkArr.reduce((s, r) => s + Math.pow(r - mBmk, 2), 0) / (bmkArr.length - 1)
    beta = varBmk > 0 ? covCB / varBmk : null

    const upMeses   = paresBmk.filter(p => p.bmk > 0)
    const downMeses = paresBmk.filter(p => p.bmk < 0)
    if (upMeses.length >= 6) {
      const acumCartUp = upMeses.reduce((p, r) => p * (1 + r.cart), 1) - 1
      const acumBmkUp  = upMeses.reduce((p, r) => p * (1 + r.bmk), 1) - 1
      up_capture = acumBmkUp !== 0 ? acumCartUp / acumBmkUp : null
    }
    if (downMeses.length >= 3) {
      const acumCartDn = downMeses.reduce((p, r) => p * (1 + r.cart), 1) - 1
      const acumBmkDn  = downMeses.reduce((p, r) => p * (1 + r.bmk), 1) - 1
      down_capture = acumBmkDn !== 0 ? acumCartDn / acumBmkDn : null
    }
  }

  // ── Retornos por janela fixa ────────────────────────────
  const anoFim = mesFimStr.slice(0, 4)
  const retorno_mtd = retornosMensais.length > 0 ? retornosMensais.at(-1).retorno : null
  const mesesYTD = retornosMensais.filter(r => r.mes.startsWith(anoFim))
  // `|| null` trocado por checagem explícita de length: um YTD exatamente
  // 0% também zera via reduce e virava null indevidamente (indistinguível
  // de "nenhum mês no ano corrente").
  const retorno_ytd = mesesYTD.length > 0 ? mesesYTD.reduce((p, r) => p * (1 + r.retorno), 1) - 1 : null
  const ultimos12 = retornosMensais.slice(-12)
  const retorno_12m = ultimos12.length >= 12 ? ultimos12.reduce((p, r) => p * (1 + r.retorno), 1) - 1 : null
  const ultimos24 = retornosMensais.slice(-24)
  const retorno_24m = ultimos24.length >= 24 ? ultimos24.reduce((p, r) => p * (1 + r.retorno), 1) - 1 : null

  const contribuicao_risco = calcularContribuicaoRiscoClasses(carteiraId, carteira, inicioStr, fimStr, db)

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
    // vs benchmark adaptativo
    beta, up_capture, down_capture, benchmark_disponivel, benchmark_label,
    // Janelas fixas
    retorno_mtd, retorno_ytd, retorno_12m, retorno_24m,
    contribuicao_risco,
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

    // Estados que cobrem esse mês por intervalo de datas (não pela tag `mes`,
    // que só reflete o mês do rebalance — um estado tagueado 'jun' pode ter
    // data_inicio em mai e seguir aberto até hoje, cobrindo jul/ago também).
    // Mesmo padrão de calcularSerieDiaria, a engine que já calcula certo.
    const estados = db.prepare(
      `SELECT * FROM estados_portfolio
       WHERE carteira_id = ? AND data_inicio <= ? AND (data_fim IS NULL OR data_fim >= ?)
       ORDER BY data_inicio`
    ).all(carteiraId, fimMes, inicioMes)

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

    // Override da carteira substitui o composto ponderado por classe por um
    // único índice (ex: Top Dividendos usa IDIV em vez do IBOV de rv_brasil)
    let retPassivo
    if (carteira.benchmark_override) {
      const row = db.prepare(`SELECT valor FROM dados_macro WHERE serie=? AND data=?`).get(carteira.benchmark_override, mes + '-01')
      retPassivo = row ? row.valor / 100 : cdiMensal
    } else {
      retPassivo = 0
      for (const cls of CLASSES) {
        const pesoClasse = (aloc[cls] || 0) / 100
        if (pesoClasse === 0) continue
        const retClasse = retornoPassivoClasse(cls, mes, cdiMensal, ipcaMensal, db)
        retPassivo += retClasse * pesoClasse
      }
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

  // Série diária: usa a volatilidade real do benchmark quando a carteira tem
  // um único índice (override ou classe dominante) e ele tem contraparte
  // diária real. Sem isso, cai de volta a espalhar o retorno mensal
  // uniformemente pelos dias úteis do mês. Ativo usa a série diária real de
  // calcularMetricas em ambos os casos.
  let serieDiaria = null
  const ativoSerieDiaria = ativoMetricas.serie_retorno_diaria
  if (ativoSerieDiaria?.length > 1) {
    const cdiDiarios = db.prepare(
      `SELECT data FROM dados_macro WHERE serie='CDI_DIARIO' AND data >= ? AND data <= ? ORDER BY data`
    ).all(inicioEfetivo, dataFim || new Date().toISOString().split('T')[0])
    const datasReferencia = cdiDiarios.map((r) => r.data)
    const ativoByData = new Map(ativoSerieDiaria.map((p) => [p.data, p.retorno_acumulado]))

    const benchmarkUnico = getSingleBenchmarkSerie(carteira, alocacoes)
    // pos_fixado e alternativos têm fórmula própria (60% CDI + 40% IDA-DI;
    // ouro), não uma única série de nível — SERIE_DIARIA_CLASSE cobre as demais.
    const classeTemDiarioReal = benchmarkUnico?.classe && (
      benchmarkUnico.classe === 'pos_fixado' ||
      benchmarkUnico.classe === 'alternativos' ||
      SERIE_DIARIA_CLASSE[benchmarkUnico.classe] != null
    )

    let passivoReal = null
    if (classeTemDiarioReal) {
      // Mesmo cálculo diário por classe de calcularAtribuicao (benchmarkDoDia),
      // em vez da série de nível única de SERIE_DIARIA_POR_MENSAL — essa
      // reduzia pos_fixado a CDI puro (sem o IDA-DI), achatando a volatilidade
      // do gráfico e divergindo do benchmark mostrado na Atribuição.
      const diaAntesInicio = db.prepare(
        `SELECT data FROM dados_macro WHERE serie='CDI_DIARIO' AND data < ? ORDER BY data DESC LIMIT 1`
      ).get(inicioEfetivo)?.data ?? inicioEfetivo
      let acumuladoBench = 1
      let diaAnteriorBench = diaAntesInicio
      passivoReal = new Map()

      for (const data of datasReferencia) {
        const ret = retornoBenchmarkPeriodo(benchmarkUnico.classe, diaAnteriorBench, data, db)
        if (ret != null) acumuladoBench *= 1 + ret
        passivoReal.set(data, acumuladoBench - 1)
        diaAnteriorBench = data
      }
    } else {
      const serieDiarioReal = benchmarkUnico && SERIE_DIARIA_POR_MENSAL[benchmarkUnico.serieMensal]
      passivoReal = serieDiarioReal
        ? serieDiariaPassivoReal(db, serieDiarioReal, datasReferencia, mesInicioStr, mesFimStr)
        : null
    }

    if (passivoReal) {
      serieDiaria = datasReferencia.map((data) => ({
        data,
        passivo_acumulado: passivoReal.get(data) ?? null,
        ativo_acumulado: ativoByData.get(data) ?? null,
      }))
    } else if (carteira.benchmark_override) {
      // Override sem contraparte diária (ex: IDIV) — é um único número por
      // mês, não uma composição por classe, então só espalhar geometricamente
      // pelos dias úteis já é o correto aqui.
      const diasPorMes = new Map()
      for (const data of datasReferencia) {
        const m = data.slice(0, 7)
        diasPorMes.set(m, (diasPorMes.get(m) || 0) + 1)
      }
      const passivoMensal = new Map(retornosMensais.map((r) => [r.mes, r.passivo]))
      let acumPassDiario = 1
      serieDiaria = datasReferencia.map((data) => {
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
    } else {
      // Fallback: carteira multi-classe sem dominante >50% — compõe o
      // benchmark passivo dia a dia, ponderado por classe (mesmo padrão de
      // benchmarkDoDia em calcularAtribuicao), em vez de espalhar o retorno
      // mensal uniformemente pelos dias do mês. O espalhamento uniforme
      // achatava a volatilidade a quase zero: o fator diário ficava idêntico
      // em todos os dias do mesmo mês, apagando o movimento real de
      // RV/multimercado que compõem a carteira passiva.
      const alocPorMesFB = new Map(alocacoes.map((a) => [a.mes, a]))
      const duMesCacheFB = new Map()
      const diasUteisDoMesFB = (mes) => {
        if (!duMesCacheFB.has(mes)) {
          const [y, m] = mes.split('-').map(Number)
          duMesCacheFB.set(mes, contarDiasUteis(`${mes}-01`, new Date(y, m, 0).toISOString().split('T')[0], db))
        }
        return duMesCacheFB.get(mes)
      }
      const diaAntesInicioFB = db.prepare(
        `SELECT data FROM dados_macro WHERE serie='CDI_DIARIO' AND data < ? ORDER BY data DESC LIMIT 1`
      ).get(inicioEfetivo)?.data ?? inicioEfetivo
      let acumPassDiario = 1
      let diaAnteriorFB = diaAntesInicioFB
      serieDiaria = datasReferencia.map((data) => {
        const mes = data.slice(0, 7)
        const aloc = alocPorMesFB.get(mes)
        let retDia = 0
        if (aloc) {
          const cdiRow = db.prepare(`SELECT valor FROM dados_macro WHERE serie='CDI_MENSAL' AND data=?`).get(mes + '-01')
          const cdiMensalFB = cdiRow ? cdiRow.valor / 100 : 0
          const ipcaRow = db.prepare(`SELECT valor FROM dados_macro WHERE serie='IPCA_MENSAL' AND data=?`).get(mes + '-01')
          const ipcaMensalFB = ipcaRow ? ipcaRow.valor / 100 : 0
          for (const cls of CLASSES) {
            const pesoClasse = (aloc[cls] || 0) / 100
            if (!pesoClasse) continue
            let ret = retornoBenchmarkPeriodo(cls, diaAnteriorFB, data, db)
            if (ret == null) {
              const mensalCls = getBenchmarkMensalClasse(cls, cdiMensalFB, ipcaMensalFB, mes, db)
              const n = diasUteisDoMesFB(mes)
              ret = (mensalCls != null && n > 0) ? Math.pow(1 + mensalCls, 1 / n) - 1 : 0
            }
            retDia += ret * pesoClasse
          }
        }
        acumPassDiario *= 1 + retDia
        diaAnteriorFB = data
        return {
          data,
          passivo_acumulado: acumPassDiario - 1,
          ativo_acumulado: ativoByData.get(data) ?? null,
        }
      })
    }
  }

  // Métricas do passivo, alpha total, tracking error e information ratio:
  // preferem a série diária (já clipada certo ao período customizado) — a
  // agregação mensal acima soma meses inteiros mesmo quando início/fim cai no
  // meio do mês, divergindo do que o gráfico mostra (mesmo problema já
  // corrigido em calcularMetricas/calcularAtribuicao). Cai pro mensal só se a
  // série diária não puder ser montada.
  let metricasPassivoFinal = { retorno_acumulado: acumPassivo - 1, cagr: cagrPassivo, volatilidade: volPassivo, sharpe: sharpePassivo, max_drawdown: maxDDP }
  let alphaTotalFinal = acumAtivo / acumPassivoAlinhado - 1
  let trackingErrorFinal = trackingError
  let informationRatioFinal = informationRatio

  if (serieDiaria?.length > 1) {
    const cdiByData = new Map(ativoSerieDiaria.map((p) => [p.data, p.cdi_acumulado]))
    const dias = []
    for (let i = 1; i < serieDiaria.length; i++) {
      const prev = serieDiaria[i - 1]
      const cur = serieDiaria[i]
      if (prev.passivo_acumulado == null || cur.passivo_acumulado == null) continue
      const retPassivoDia = (1 + cur.passivo_acumulado) / (1 + prev.passivo_acumulado) - 1
      const retAtivoDia = (prev.ativo_acumulado != null && cur.ativo_acumulado != null)
        ? (1 + cur.ativo_acumulado) / (1 + prev.ativo_acumulado) - 1
        : null
      const cdiPrev = cdiByData.get(prev.data)
      const cdiCur = cdiByData.get(cur.data)
      const retCdiDia = (cdiPrev != null && cdiCur != null) ? (1 + cdiCur) / (1 + cdiPrev) - 1 : null
      dias.push({ retPassivoDia, retAtivoDia, retCdiDia })
    }

    if (dias.length >= 2) {
      const passivoFinal = serieDiaria[serieDiaria.length - 1].passivo_acumulado
      const cagrPassivoD = Math.pow(1 + passivoFinal, 252 / serieDiaria.length) - 1

      const retsP = dias.map((d) => d.retPassivoDia)
      const mediaP = retsP.reduce((a, b) => a + b, 0) / retsP.length
      const varP = retsP.reduce((s, r) => s + Math.pow(r - mediaP, 2), 0) / Math.max(retsP.length - 1, 1)
      const volPassivoD = Math.sqrt(varP) * Math.sqrt(252)

      const cdisValidos = dias.map((d) => d.retCdiDia).filter((r) => r != null)
      const cdiMedioD = cdisValidos.length ? cdisValidos.reduce((a, b) => a + b, 0) / cdisValidos.length : 0
      const cagrCDID = Math.pow(1 + cdiMedioD, 252) - 1
      const sharpePassivoD = volPassivoD > 0 ? (cagrPassivoD - cagrCDID) / volPassivoD : null

      let picoD = 1, maxDDD = 0
      for (const { passivo_acumulado } of serieDiaria) {
        if (passivo_acumulado == null) continue
        const nav = 1 + passivo_acumulado
        if (nav > picoD) picoD = nav
        const dd = nav / picoD - 1
        if (dd < maxDDD) maxDDD = dd
      }

      metricasPassivoFinal = { retorno_acumulado: passivoFinal, cagr: cagrPassivoD, volatilidade: volPassivoD, sharpe: sharpePassivoD, max_drawdown: maxDDD }
      alphaTotalFinal = (1 + ativoMetricas.retorno_acumulado) / (1 + passivoFinal) - 1

      const alphasD = dias.filter((d) => d.retAtivoDia != null).map((d) => d.retAtivoDia - d.retPassivoDia)
      if (alphasD.length >= 2) {
        const mediaAlphaD = alphasD.reduce((a, b) => a + b, 0) / alphasD.length
        const varAlphaD = alphasD.reduce((s, a) => s + Math.pow(a - mediaAlphaD, 2), 0) / Math.max(alphasD.length - 1, 1)
        trackingErrorFinal = Math.sqrt(varAlphaD) * Math.sqrt(252)
        informationRatioFinal = trackingErrorFinal > 0 ? (ativoMetricas.cagr - cagrPassivoD) / trackingErrorFinal : null
      }
    }
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
    metricas_passivo: metricasPassivoFinal,
    alpha_total: alphaTotalFinal,
    tracking_error: trackingErrorFinal,
    information_ratio: informationRatioFinal,
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

    // Estados que cobrem esse mês por intervalo de datas (não pela tag `mes`,
    // que só reflete o mês do rebalance — um estado tagueado 'jun' pode ter
    // data_inicio em mai e seguir aberto até hoje, cobrindo jul/ago também).
    // Mesmo padrão de calcularSerieDiaria, a engine que já calcula certo.
    const estados = db.prepare(
      `SELECT * FROM estados_portfolio
       WHERE carteira_id = ? AND data_inicio <= ? AND (data_fim IS NULL OR data_fim >= ?)
       ORDER BY data_inicio`
    ).all(carteiraId, fimMes, inicioMes)

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

// ── Dados diários por produto (para auditoria via Excel) ──────────────────

export function calcularDadosDiariosPorProduto(carteiraId, dataInicio, dataFim) {
  const db = getDb()

  // Dias úteis do período (via CDI_DIARIO como calendário)
  const cdiRows = db.prepare(
    `SELECT data, valor FROM dados_macro WHERE serie='CDI_DIARIO' AND data >= ? AND data <= ? ORDER BY data`
  ).all(dataInicio, dataFim)
  if (!cdiRows.length) return null
  const diasUteis = cdiRows.map(r => r.data)
  const cdiByData = new Map(cdiRows.map(r => [r.data, r.valor / 100]))

  // Estados ativos no período
  const estados = db.prepare(`
    SELECT * FROM estados_portfolio
    WHERE carteira_id = ? AND data_inicio <= ? AND (data_fim IS NULL OR data_fim >= ?)
    ORDER BY data_inicio
  `).all(carteiraId, dataFim, dataInicio)
  if (!estados.length) return null

  // Batch: todos os produtos dos estados do período
  const estadoIds = estados.map(e => e.id)
  const phE = estadoIds.map(() => '?').join(',')
  const todosProds = db.prepare(`SELECT * FROM produtos WHERE estado_id IN (${phE})`).all(...estadoIds)

  const prodsByEstado = new Map()
  for (const p of todosProds) {
    if (!prodsByEstado.has(p.estado_id)) prodsByEstado.set(p.estado_id, [])
    prodsByEstado.get(p.estado_id).push(p)
  }

  // Catálogo de produtos únicos: fundo/acao → chave=identificador; rf_curva → chave='rf_<id>'
  const catalogMap = new Map()
  for (const p of todosProds) {
    const chave = (p.tipo === 'rf_curva' || !p.identificador) ? `rf_${p.id}` : p.identificador
    if (!catalogMap.has(chave)) {
      catalogMap.set(chave, { chave, nome: p.nome, tipo: p.tipo, identificador: p.identificador, classe: p.classe })
    }
  }

  // Cotas de mercado (fundo/acao) com buffer de 10 dias para calcular retorno do 1º dia
  const identifiers = [...new Set(
    todosProds.filter(p => (p.tipo === 'fundo' || p.tipo === 'acao') && p.identificador).map(p => p.identificador)
  )]
  const bufferInicio = new Date(dataInicio + 'T12:00:00')
  bufferInicio.setDate(bufferInicio.getDate() - 10)
  const bufferStr = bufferInicio.toISOString().split('T')[0]

  const cotasMapByIdent = new Map()
  if (identifiers.length) {
    const ph2 = identifiers.map(() => '?').join(',')
    const rows = db.prepare(`
      SELECT p.identificador, cc.data, MAX(cc.valor) AS valor, MAX(cc.valor_ajustado) AS valor_ajustado
      FROM cotas_cache cc JOIN produtos p ON cc.produto_id = p.id
      WHERE p.identificador IN (${ph2}) AND cc.data >= ? AND cc.data <= ?
      GROUP BY p.identificador, cc.data ORDER BY p.identificador, cc.data
    `).all(...identifiers, bufferStr, dataFim)
    for (const r of rows) {
      if (!cotasMapByIdent.has(r.identificador)) cotasMapByIdent.set(r.identificador, new Map())
      cotasMapByIdent.get(r.identificador).set(r.data, r.valor_ajustado ?? r.valor)
    }
  }

  // IPCA mensal para rf_curva indexada a inflação
  const ipcaRows = db.prepare(
    `SELECT data, valor FROM dados_macro WHERE serie='IPCA_MENSAL' AND data >= ? AND data <= ? ORDER BY data`
  ).all(dataInicio.slice(0, 7) + '-01', dataFim.slice(0, 7) + '-01')
  const ipcaByMes = new Map(ipcaRows.map(r => [r.data.slice(0, 7), r.valor / 100]))

  // Última cota conhecida antes do período (para retorno do 1º dia)
  const ultimaCota = new Map()
  for (const [ident, cotasMap] of cotasMapByIdent) {
    const antes = [...cotasMap.keys()].filter(d => d < dataInicio).sort()
    if (antes.length) ultimaCota.set(ident, cotasMap.get(antes[antes.length - 1]))
  }

  // Estado ativo em um dia
  function getEstado(dia) {
    let ativo = null
    for (const e of estados) {
      if (e.data_inicio > dia) break
      // Não descarta por data_fim ultrapassada: um gap entre o fim de um
      // estado e o início do próximo (falha de publicação, não intenção de
      // ficar sem posição) herda o último estado conhecido, em vez de zerar
      // o retorno do dia enquanto o CDI de comparação segue acumulando.
      ativo = e
    }
    return ativo
  }

  // Saída: chave → { preco: Map(data→number), retorno: Map(data→number) }
  const dados = new Map()
  for (const chave of catalogMap.keys()) dados.set(chave, { preco: new Map(), retorno: new Map() })

  // Preço teórico acumulado para rf_curva (base 100 na primeira aparição)
  const precoTeorico = new Map()

  for (const dia of diasUteis) {
    const filteredIdents = new Set()
    const estado = getEstado(dia)
    const mes = dia.slice(0, 7)

    if (estado) {
      const prods = prodsByEstado.get(estado.id) || []
      const cdiDiario = cdiByData.get(dia) ?? 0
      const ipcaMensal = ipcaByMes.get(mes) ?? 0.005

      for (const p of prods) {
        const chave = (p.tipo === 'rf_curva' || !p.identificador) ? `rf_${p.id}` : p.identificador
        const d = dados.get(chave)
        if (!d) continue

        let retP = null
        let precoHoje = null

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
            retP = (Math.pow(1 + ipcaMensal, 1 / 21) - 1) + (Math.pow(1 + taxa / 100, 1 / 252) - 1)
          }
          if (retP !== null && isento_ir) retP /= (1 - 0.15)
          // Preço teórico: base 100 composta diariamente
          const prev = precoTeorico.get(chave) ?? 100
          if (retP !== null) { precoHoje = prev * (1 + retP); precoTeorico.set(chave, precoHoje) }

        } else if ((p.tipo === 'fundo' || p.tipo === 'acao') && p.identificador) {
          const cotasMap = cotasMapByIdent.get(p.identificador)
          if (cotasMap) {
            const valorHoje = cotasMap.get(dia)
            const valorAntes = ultimaCota.get(p.identificador)
            precoHoje = valorHoje ?? null
            if (valorHoje && valorAntes && valorAntes > 0) {
              const raw = valorHoje / valorAntes - 1
              if (Math.abs(raw) <= 0.40) retP = raw
              else filteredIdents.add(p.identificador)
            }
          }
        }

        if (precoHoje != null) d.preco.set(dia, precoHoje)
        if (retP != null) d.retorno.set(dia, retP)
      }
    }

    // Avança última cota (mesmo filtro do calcularSerieDiaria)
    for (const [ident, cotasMap] of cotasMapByIdent) {
      const v = cotasMap.get(dia)
      if (v !== undefined && v > 0 && !filteredIdents.has(ident)) ultimaCota.set(ident, v)
    }
  }

  return { diasUteis, produtos: [...catalogMap.values()], dados }
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

// Retorno diário por classe a partir dos produtos que a carteira efetivamente
// possui — mesmo critério de calcularRetornosMensaisPorClasse (peso relativo
// dos produtos DENTRO da classe; não multiplica pelo peso da classe na
// alocação, pois queremos "quanto essa classe rendeu sozinha" para a
// covariância, não sua contribuição para o retorno total), só que dia a dia.
// Reaproveita a mesma lógica/dados de calcularSerieDiaria (LOCF de cota,
// filtro de retorno diário >40%, sub-carteira via série diária real).
function calcularRetornosDiariosPorClasse(carteiraId, dataInicioStr, dataFimStr, db) {
  const estados = db.prepare(`
    SELECT * FROM estados_portfolio
    WHERE carteira_id = ? AND data_inicio <= ? AND (data_fim IS NULL OR data_fim >= ?)
    ORDER BY data_inicio
  `).all(carteiraId, dataFimStr, dataInicioStr)
  const classes = Object.keys(LABELS_CLASSE)
  const retornosPorClasse = Object.fromEntries(classes.map((c) => [c, new Map()]))
  if (!estados.length) return retornosPorClasse

  const estadoIds = estados.map((e) => e.id)
  const phE = estadoIds.map(() => '?').join(',')
  const todosProds = db.prepare(`SELECT * FROM produtos WHERE estado_id IN (${phE})`).all(...estadoIds)
  const prodsByEstado = new Map()
  for (const p of todosProds) {
    if (!prodsByEstado.has(p.estado_id)) prodsByEstado.set(p.estado_id, [])
    prodsByEstado.get(p.estado_id).push(p)
  }

  const identifiers = [...new Set(
    todosProds.filter((p) => (p.tipo === 'fundo' || p.tipo === 'acao') && p.identificador).map((p) => p.identificador)
  )]

  const bufferInicio = new Date(dataInicioStr + 'T12:00:00')
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
    `).all(...identifiers, bufferStr, dataFimStr)
    for (const r of rows) {
      if (!cotasMapByIdent.has(r.identificador)) cotasMapByIdent.set(r.identificador, new Map())
      cotasMapByIdent.get(r.identificador).set(r.data, r.valor_ajustado ?? r.valor)
    }
  }

  const cdiRows = db.prepare(
    `SELECT data, valor FROM dados_macro WHERE serie='CDI_DIARIO' AND data >= ? AND data <= ? ORDER BY data`
  ).all(dataInicioStr, dataFimStr)
  if (!cdiRows.length) return retornosPorClasse
  const cdiByData = new Map(cdiRows.map((r) => [r.data, r.valor / 100]))
  const diasUteis = cdiRows.map((r) => r.data)

  const ipcaRows = db.prepare(
    `SELECT data, valor FROM dados_macro WHERE serie='IPCA_MENSAL' AND data >= ? AND data <= ? ORDER BY data`
  ).all(dataInicioStr.slice(0, 7) + '-01', dataFimStr.slice(0, 7) + '-01')
  const ipcaByMes = new Map(ipcaRows.map((r) => [r.data.slice(0, 7), r.valor / 100]))

  const subCarteirasIds = [...new Set(
    todosProds.filter((p) => p.tipo === 'carteira' && p.identificador).map((p) => p.identificador)
  )]
  const subRetDiario = new Map()
  for (const subId of subCarteirasIds) {
    const serieSub = calcularSerieDiaria(Number(subId), dataInicioStr, dataFimStr)
    if (!serieSub?.length) continue
    for (let i = 1; i < serieSub.length; i++) {
      const ret = (1 + serieSub[i].retorno_acumulado) / (1 + serieSub[i - 1].retorno_acumulado) - 1
      subRetDiario.set(`${subId}_${serieSub[i].data}`, ret)
    }
  }

  const ultimaCota = new Map()
  for (const [ident, cotasMap] of cotasMapByIdent) {
    const antes = [...cotasMap.keys()].filter((d) => d < dataInicioStr).sort()
    if (antes.length) ultimaCota.set(ident, cotasMap.get(antes[antes.length - 1]))
  }

  function getEstado(dia) {
    let ativo = null
    for (const e of estados) {
      if (e.data_inicio > dia) break
      ativo = e
    }
    return ativo
  }

  for (const dia of diasUteis) {
    const cdiDiario = cdiByData.get(dia) ?? 0
    const mes = dia.slice(0, 7)
    const estado = getEstado(dia)
    const filteredIdents = new Set()

    if (estado) {
      const prods = prodsByEstado.get(estado.id) || []
      const classeMap = {}
      for (const p of prods) {
        if (!classeMap[p.classe]) classeMap[p.classe] = []
        classeMap[p.classe].push(p)
      }

      for (const [classe, classeProds] of Object.entries(classeMap)) {
        const retsPorProd = classeProds.map((p) => {
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
                if (Math.abs(raw) <= 0.40) retP = raw
                else filteredIdents.add(p.identificador)
              }
            }
          } else if (p.tipo === 'carteira' && p.identificador) {
            const retDiarioSub = subRetDiario.get(`${p.identificador}_${dia}`)
            if (retDiarioSub != null) retP = retDiarioSub
          }
          return { p, retP }
        })

        const pesoComDados = retsPorProd.reduce((s, { p, retP }) => retP != null ? s + (p.peso || 0) : s, 0)
        let retClasse = 0
        let algumComDados = false
        for (const { p, retP } of retsPorProd) {
          if (retP !== null) { retClasse += retP * ((p.peso || 0) / (pesoComDados || 1)); algumComDados = true }
        }
        if (algumComDados) retornosPorClasse[classe].set(dia, retClasse)
      }
    }

    for (const [ident, cotasMap] of cotasMapByIdent) {
      const v = cotasMap.get(dia)
      if (v !== undefined && v > 0 && !filteredIdents.has(ident)) ultimaCota.set(ident, v)
    }
  }

  return retornosPorClasse
}

// Contribuição de cada classe para a volatilidade total da carteira, com os
// pesos ATUAIS (última alocação), via decomposição de Euler sobre a matriz de
// covariância diária real: RC_i = w_i·(Σw)_i / σ_p, anualizada — a soma das
// contribuições bate exatamente com a volatilidade anualizada da carteira.
// Reaproveita a mesma série de retornos por classe do otimizador de carteira.
// Classes sem peso ou sem dado de retorno ficam com contribuição null (o
// chamador decide como exibir — ex: "—").
function calcularContribuicaoRiscoClasses(carteiraId, carteira, inicioStr, fimStr, db) {
  const cdiRowsDiario = db.prepare(
    `SELECT data FROM dados_macro WHERE serie='CDI_DIARIO' AND data >= ? AND data <= ? ORDER BY data`
  ).all(inicioStr, fimStr)
  if (cdiRowsDiario.length < 15) return null
  const diasUteis = cdiRowsDiario.map((r) => r.data)

  const retornosPorClasse = calcularRetornosDiariosPorClasse(carteiraId, inicioStr, fimStr, db)
  const CLASSES = Object.keys(LABELS_CLASSE)
  const classesComDados = CLASSES.filter((cls) => retornosPorClasse[cls].size > 0)
  if (classesComDados.length === 0) return null

  const T = diasUteis.length
  const retMatrix = diasUteis.map((dia) => classesComDados.map((cls) => retornosPorClasse[cls].get(dia) ?? 0))
  const n = classesComDados.length
  const means = classesComDados.map((_, j) => retMatrix.reduce((s, row) => s + row[j], 0) / T)
  const cov = Array.from({ length: n }, () => Array(n).fill(0))
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      cov[i][j] = retMatrix.reduce((s, row) => s + (row[i] - means[i]) * (row[j] - means[j]), 0) / Math.max(T - 1, 1)

  const mesFimStr = fimStr.slice(0, 7)
  const ultimaAloc = db.prepare(
    `SELECT * FROM alocacoes_macro WHERE perfil_id = ? AND mes <= ? ORDER BY mes DESC LIMIT 1`
  ).get(carteira.perfil_id, mesFimStr)
  const w = classesComDados.map((cls) => (ultimaAloc?.[cls] || 0) / 100)

  const sigmaW = w.map((_, i) => cov[i].reduce((s, cij, j) => s + cij * w[j], 0))
  const volDiaria = Math.sqrt(Math.max(w.reduce((s, wi, i) => s + wi * sigmaW[i], 0), 0))
  const volAnual = volDiaria * Math.sqrt(252)

  const linhas = CLASSES.map((cls) => {
    const idx = classesComDados.indexOf(cls)
    const peso = (ultimaAloc?.[cls] || 0) / 100
    const semContribuicao = idx === -1 || peso === 0 || volDiaria === 0
    return {
      classe: cls,
      label: LABELS_CLASSE[cls],
      peso,
      vol_classe: idx === -1 ? null : Math.sqrt(Math.max(cov[idx][idx], 0)) * Math.sqrt(252),
      contribuicao_risco: semContribuicao ? null : (peso * sigmaW[idx] / volDiaria) * Math.sqrt(252),
      contribuicao_pct: semContribuicao ? null : (peso * sigmaW[idx] / volDiaria) / volDiaria,
    }
  })

  return { linhas, volatilidade_total: volAnual, n_dias: T }
}

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

  // Calendário de dias úteis via CDI_DIARIO — mesmo motor diário do resto do
  // app. 24 meses em pontos mensais é pouco pra estimar covariância entre até
  // 9 classes; diário dá ~500 pontos reais.
  const [efy, efm] = mesFimStr.split('-').map(Number)
  const dataInicioStr = `${mesInicioStr}-01`
  const dataFimStr = new Date(efy, efm, 0).toISOString().split('T')[0]

  const cdiRowsDiario = db.prepare(
    `SELECT data, valor FROM dados_macro WHERE serie='CDI_DIARIO' AND data >= ? AND data <= ? ORDER BY data`
  ).all(dataInicioStr, dataFimStr)
  if (cdiRowsDiario.length < 15) return { error: 'Período insuficiente de dados (mínimo ~1 mês útil).' }
  const diasUteis = cdiRowsDiario.map((r) => r.data)
  const cdiMedioDiario = cdiRowsDiario.reduce((s, r) => s + r.valor / 100, 0) / cdiRowsDiario.length

  const retornosPorClasseDiario = calcularRetornosDiariosPorClasse(carteiraId, dataInicioStr, dataFimStr, db)
  const CLASSES = Object.keys(LABELS_CLASSE)

  // Usar apenas classes com dados
  let classesAtivas = CLASSES.filter((cls) => retornosPorClasseDiario[cls].size > 0)
  if (classesAtivas.length < 2) return { error: 'Dados insuficientes. Adicione produtos às classes antes de otimizar.' }

  // Janela adaptativa: avança o início até o ponto mais antigo onde todas as classes
  // ativas têm ≥ 60% de cobertura real. Evita que classes com histórico curto
  // contaminem a covariância com zeros excessivos (fill-zero vicia médias e variâncias).
  const MIN_COVERAGE = 0.6
  const MIN_DIAS = 252 // ~12 meses úteis
  const coberturaJanela = (dias) => classesAtivas.every(
    cls => dias.filter(d => retornosPorClasseDiario[cls].has(d)).length / dias.length >= MIN_COVERAGE
  )
  let diasJanela = diasUteis.length >= MIN_DIAS ? diasUteis.slice(-MIN_DIAS) : diasUteis
  for (let i = 0; i <= diasUteis.length - MIN_DIAS; i++) {
    const slice = diasUteis.slice(i)
    if (coberturaJanela(slice)) { diasJanela = slice; break }
  }
  // Descarta classes sem cobertura suficiente na janela efetiva
  classesAtivas = classesAtivas.filter(
    cls => diasJanela.filter(d => retornosPorClasseDiario[cls].has(d)).length / diasJanela.length >= MIN_COVERAGE
  )
  if (classesAtivas.length < 2) return { error: 'Dados insuficientes. Adicione produtos às classes antes de otimizar.' }

  const T = diasJanela.length
  // Matriz de retornos (fill 0 quando classe sem dado no dia)
  const retMatrix = diasJanela.map((dia) => classesAtivas.map((cls) => retornosPorClasseDiario[cls].get(dia) ?? 0))

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
    const retDiario = weights.reduce((s, w, i) => s + w * means[i], 0)
    let variancia = 0
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) variancia += weights[i] * weights[j] * cov[i][j]
    }
    const vol = Math.sqrt(Math.max(variancia, 0)) * Math.sqrt(252)
    const cagr = Math.pow(1 + retDiario, 252) - 1
    const sharpe = vol > 0 ? (cagr - cdiMedioDiario * 252) / vol : 0
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
    fronteira: portfolios.map((p) => ({ vol: p.vol, cagr: p.cagr, sharpe: p.sharpe, weights: toWeightMap(p) })),
    max_sharpe: { weights: toWeightMap(maxSharpe), vol: maxSharpe.vol, cagr: maxSharpe.cagr, sharpe: maxSharpe.sharpe },
    min_vol: { weights: toWeightMap(minVol), vol: minVol.vol, cagr: minVol.cagr, sharpe: minVol.sharpe },
    paridade_risco: { weights: toWeightMap({ weights: pesosRP }), ...portfolioStats(pesosRP) },
    atual: { weights: toWeightMap({ weights: pesosAtuais }), ...currentStats },
    classes: classesAtivas,
    labels: classesAtivas.map((cls) => LABELS_CLASSE[cls]),
    n_dias: T,
    n_simulacoes: nSimulacoes,
  }
}

// ── Otimizador por Ativo (Monte Carlo hierárquico) ─────────

// ── ERC (Equal Risk Contribution) ──────────────────────────

function calcERC(n, cov, minW, maxW) {
  const result = Array(n).fill(0)
  const fixed = new Set()
  let budget = 1
  while (true) {
    const freeIdx = Array.from({ length: n }, (_, i) => i).filter(i => !fixed.has(i))
    const m = freeIdx.length
    if (m === 0) break
    if (m === 1) { result[freeIdx[0]] = Math.max(minW, Math.min(maxW, budget)); break }
    const subCov = freeIdx.map(i => freeIdx.map(j => cov[i][j]))
    const fixedContrib = freeIdx.map(i => [...fixed].reduce((s, k) => s + cov[i][k] * result[k], 0))
    let subW = Array(m).fill(1 / m)
    for (let iter = 0; iter < 1000; iter++) {
      const mrc = subW.map((_, ii) => budget * subW.reduce((s, wj, jj) => s + subCov[ii][jj] * wj, 0) + fixedContrib[ii])
      const totalVar = subW.reduce((s, wi, ii) => s + wi * budget * mrc[ii], 0)
      if (totalVar <= 0) break
      const newSubW = subW.map((wi, ii) => mrc[ii] > 0 && wi > 0 ? wi * Math.sqrt(totalVar / (m * budget * wi * mrc[ii])) : wi)
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
  const rpSum = result.reduce((a, b) => a + b, 0)
  return rpSum > 1e-10 ? result.map(r => r / rpSum) : Array(n).fill(1 / n)
}

// ── Helpers de restrições de portfólio ─────────────────────

function calcDurationCarteira(weights, ativosValidos) {
  const com = ativosValidos
    .map((a, i) => ({ w: weights[i], d: Number(a.duration) }))
    .filter((x) => x.d > 0 && isFinite(x.d))
  const totalW = com.reduce((s, x) => s + x.w, 0)
  return totalW > 0 ? com.reduce((s, x) => s + x.w * x.d, 0) / totalW : null
}

function calcMinPortfolio(weights, ativosValidos) {
  const vals = ativosValidos
    .map((a, i) => (a.min_lote > 0 ? a.min_lote / Math.max(weights[i], 1e-10) : null))
    .filter((x) => x != null)
  return vals.length > 0 ? Math.max(...vals) : null
}

function satisfazRestricoes(weights, ativosValidos, restricoes) {
  const { target_duration, duration_tolerancia = 1, max_portfolio_min } = restricoes
  if (target_duration != null) {
    const dur = calcDurationCarteira(weights, ativosValidos)
    if (dur != null && Math.abs(dur - target_duration) > duration_tolerancia) return false
  }
  if (max_portfolio_min != null) {
    const minP = calcMinPortfolio(weights, ativosValidos)
    if (minP != null && minP > max_portfolio_min) return false
  }
  return true
}

function aplicarFiltros(portfolios, ativosValidos, restricoes) {
  return portfolios.filter((p) => satisfazRestricoes(p.weights, ativosValidos, restricoes))
}

export function otimizarDentroClasse(carteiraId, classe, ativosParam, dataInicio, dataFim, nSimulacoes = 5000, minPeso = 0, maxPeso = 1, restricoes = {}) {
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

  // Calendário de dias úteis via CDI_DIARIO (mesma referência usada em calcularSerieDiaria).
  // Retornos diários em vez de mensais: com poucos meses de histórico (ex: ETF novo),
  // uma amostra de meia dúzia de retornos MENSAIS não tem poder estatístico para
  // estimar variância — o ruído da amostra pode inverter qual ativo "parece" mais
  // volátil mesmo quando os dados diários mostram claramente o contrário.
  const [efy, efm] = mesFimStr.split('-').map(Number)
  const dataInicioStr = `${mesInicioStr}-01`
  const dataFimStr = new Date(efy, efm, 0).toISOString().split('T')[0]

  const cdiRowsDiario = db.prepare(
    `SELECT data, valor FROM dados_macro WHERE serie='CDI_DIARIO' AND data >= ? AND data <= ? ORDER BY data`
  ).all(dataInicioStr, dataFimStr)
  if (cdiRowsDiario.length < 15) return { error: 'Período insuficiente de dados (mínimo ~1 mês útil).' }
  const diasUteis = cdiRowsDiario.map((r) => r.data)
  const cdiMedioDiario = cdiRowsDiario.reduce((s, r) => s + r.valor / 100, 0) / cdiRowsDiario.length

  const bufferInicio = new Date(dataInicioStr + 'T12:00:00')
  bufferInicio.setDate(bufferInicio.getDate() - 10)
  const bufferStr = bufferInicio.toISOString().split('T')[0]
  const TICKER_ALIASES = { 'CVBI11': 'PCIP11', 'PCIP11': 'CVBI11', 'AXIA7': 'AXIA3' }

  // Retornos diários por ativo. Ativos do tipo 'carteira' (sub-carteira como posição)
  // usam a própria série diária real; fundo/ação usam as cotas em cache com
  // "última cota conhecida" para preencher dias sem pregão do ativo específico.
  const ativosComDados = ativosParam.map((ativo) => {
    const retMap = new Map()

    if (ativo.tipo === 'carteira') {
      const subId = Number(ativo.identificador)
      const serieSub = subId ? calcularSerieDiaria(subId, dataInicioStr, dataFimStr) : null
      if (serieSub?.length) {
        for (let i = 1; i < serieSub.length; i++) {
          const ret = (1 + serieSub[i].retorno_acumulado) / (1 + serieSub[i - 1].retorno_acumulado) - 1
          retMap.set(serieSub[i].data, ret)
        }
      }
    } else {
      const alias = TICKER_ALIASES[ativo.identificador]
      const identifiers = alias ? [ativo.identificador, alias] : [ativo.identificador]
      const placeholders = identifiers.map(() => '?').join(', ')
      const cotas = db.prepare(`
        SELECT cc.data, MAX(cc.valor_ajustado) AS valor_ajustado, MAX(cc.valor) AS valor
        FROM cotas_cache cc
        JOIN produtos p ON cc.produto_id = p.id
        WHERE p.identificador IN (${placeholders}) AND p.tipo = ?
          AND cc.data >= ? AND cc.data <= ?
        GROUP BY cc.data
        ORDER BY cc.data
      `).all(...identifiers, ativo.tipo, bufferStr, dataFimStr)

      let ultimaCota = null
      for (const r of cotas) {
        const valor = r.valor_ajustado ?? r.valor
        if (r.data < dataInicioStr) {
          if (valor > 0) ultimaCota = valor
          continue
        }
        if (valor > 0 && ultimaCota > 0) {
          const raw = valor / ultimaCota - 1
          if (Math.abs(raw) <= 0.40) retMap.set(r.data, raw)
        }
        if (valor > 0) ultimaCota = valor
      }
    }

    const retornosDiarios = diasUteis.map((dia) => retMap.get(dia) ?? null)
    const nComDados = retornosDiarios.filter((r) => r != null).length
    return { ...ativo, retornosDiarios, n_dias_com_dados: nComDados }
  })

  const minDias = Math.max(15, Math.ceil(diasUteis.length * 0.3))
  const ativosValidos = ativosComDados.filter((a) => a.n_dias_com_dados >= minDias)

  if (ativosValidos.length < 2) {
    return {
      error: 'Dados insuficientes para simular. Sincronize as cotas dos ativos primeiro.',
      ativos: ativosComDados.map((a) => ({
        nome: a.nome, identificador: a.identificador, tipo: a.tipo,
        n_dias_com_dados: a.n_dias_com_dados,
        valido: a.n_dias_com_dados >= minDias,
      })),
    }
  }

  const T = diasUteis.length
  const retMatrix = diasUteis.map((_, di) =>
    ativosValidos.map((a) => a.retornosDiarios[di] ?? 0)
  )

  const n = ativosValidos.length
  const means = ativosValidos.map((_, j) => retMatrix.reduce((s, row) => s + row[j], 0) / T)

  const cov = Array.from({ length: n }, () => Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      cov[i][j] = retMatrix.reduce((s, row) => s + (row[i] - means[i]) * (row[j] - means[j]), 0) / Math.max(T - 1, 1)
    }
  }

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
    const retDiario = weights.reduce((s, w, i) => s + w * means[i], 0)
    let variancia = 0
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) variancia += weights[i] * weights[j] * cov[i][j]
    }
    const vol = Math.sqrt(Math.max(variancia, 0)) * Math.sqrt(252)
    const cagr = Math.pow(1 + retDiario, 252) - 1
    const sharpe = vol > 0 ? (cagr - cdiMedioDiario * 252) / vol : 0
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

  const toWeightMap = (p) => ativosValidos.reduce((o, a, i) => ({ ...o, [a.identificador]: p.weights[i] }), {})

  const pesosRP = calcERC(n, cov, minW, maxW)

  // Aplica restrições de duration e valor mínimo sobre o conjunto Monte Carlo
  const restricoesAtivas = (restricoes.target_duration != null) || (restricoes.max_portfolio_min != null)
  const portfoliosFiltrados = restricoesAtivas
    ? aplicarFiltros(portfolios, ativosValidos, restricoes)
    : portfolios

  if (restricoesAtivas && portfoliosFiltrados.length < 10) {
    return {
      error: `Apenas ${portfoliosFiltrados.length} de ${portfolios.length} simulações atendem às restrições. Amplie as tolerâncias ou desative alguma restrição.`,
      n_simulacoes_total: portfolios.length,
      n_simulacoes_validas: portfoliosFiltrados.length,
    }
  }

  const base = restricoesAtivas ? portfoliosFiltrados : portfolios
  const maxSharpe = base.reduce((best, p) => (p.sharpe > best.sharpe ? p : best))
  const minVolSample = base.reduce((best, p) => (p.vol < best.vol ? p : best))
  const pesosMinVolSolver = solverMinVol(cov, n, minW, maxW)
  const statsMinVolSolver = portfolioStats(pesosMinVolSolver)
  const solverSatisfaz = !restricoesAtivas || satisfazRestricoes(pesosMinVolSolver, ativosValidos, restricoes)
  const minVol = (solverSatisfaz && statsMinVolSolver.vol < minVolSample.vol)
    ? { weights: pesosMinVolSolver, ...statsMinVolSolver }
    : minVolSample

  const ercSatisfaz = !restricoesAtivas || satisfazRestricoes(pesosRP, ativosValidos, restricoes)

  return {
    classe,
    label_classe: LABELS_CLASSE[classe] || classe,
    ativos: ativosComDados.map((a) => ({
      nome: a.nome, identificador: a.identificador, tipo: a.tipo,
      n_dias_com_dados: a.n_dias_com_dados,
      valido: ativosValidos.some((v) => v.identificador === a.identificador),
    })),
    fronteira: base.map((p) => ({ vol: p.vol, cagr: p.cagr, sharpe: p.sharpe, weights: toWeightMap(p) })),
    max_sharpe: { ...maxSharpe, weights: toWeightMap(maxSharpe) },
    min_vol: { ...minVol, weights: toWeightMap(minVol) },
    paridade_risco: {
      weights: toWeightMap({ weights: pesosRP }), ...portfolioStats(pesosRP),
      ...(restricoesAtivas && !ercSatisfaz ? { viola_restricoes: true } : {}),
    },
    atual: { ...portfolioStats(pesosAtuais), weights: toWeightMap({ weights: pesosAtuais }) },
    n_dias: T,
    n_simulacoes: nSimulacoes,
    ...(restricoesAtivas ? { n_simulacoes_total: portfolios.length, n_simulacoes_validas: portfoliosFiltrados.length } : {}),
  }
}

// ── Otimizador livre (sem carteira) ────────────────────────

function gerarMeses(mesInicioStr, mesFimStr) {
  const meses = []
  let [y, mo] = mesInicioStr.split('-').map(Number)
  const [fy, fm] = mesFimStr.split('-').map(Number)
  while (y < fy || (y === fy && mo <= fm)) {
    meses.push(`${y}-${String(mo).padStart(2, '0')}`)
    mo++; if (mo > 12) { mo = 1; y++ }
  }
  return meses
}

// Retorno diário por classe usando os benchmarks passivos — mesma composição
// de retornoPassivoClasse (incluindo o hedge cambial de rv_global/rf_global
// via CDI - IRX), só que dia a dia em vez de mês a mês. Todas as 9 classes
// têm série diária real hoje: ACWI_DIARIO/AGG_DIARIO/IRX_DIARIO (Yahoo, sem
// equivalente Economatica) fecharam a lacuna que só existia pra rv_global/
// rf_global. Usado pelo otimizador "livre" (sem carteira associada).
const SERIE_DIARIA_BENCHMARK_CLASSE = {
  inflacao:        'IMAB_DIARIO',
  prefixado:       'IRFM_DIARIO',
  rv_brasil:       'IBOV_DIARIO',
  fundos_listados: 'IFIX_DIARIO',
  multimercado:    'IHFA_DIARIO',
  rv_global:       'ACWI_DIARIO',
  rf_global:       'AGG_DIARIO',
}

// Retornos diários (razão dia-a-dia) de uma série de NÍVEL em dados_macro,
// alinhados ao calendário de dias úteis, com "último valor conhecido" pra
// preencher datas sem publicação daquele índice específico.
function retornosDiariosNivelMacro(serie, diasUteis, bufferStr, fimStr, db) {
  const rows = db.prepare(
    `SELECT data, valor FROM dados_macro WHERE serie=? AND data>=? AND data<=? ORDER BY data`
  ).all(serie, bufferStr, fimStr)
  const porData = new Map(rows.map((r) => [r.data, r.valor]))
  const ret = new Map()
  let ultimo = null
  for (const r of rows) { if (r.data < diasUteis[0]) ultimo = r.valor; else break }
  for (const dia of diasUteis) {
    const v = porData.get(dia)
    if (v != null && ultimo != null && ultimo > 0) ret.set(dia, v / ultimo - 1)
    if (v != null) ultimo = v
  }
  return ret
}

// Mesma lógica de retornosDiariosNivelMacro, mas para a cota de um produto real
// (fundo/ETF em cotas_cache) — usado para alternativos (Trend Ouro) e
// alternativos_usd (GOLD11).
function retornosDiariosCotaAtivo(identificador, tipo, diasUteis, bufferStr, fimStr, db) {
  const rows = db.prepare(`
    SELECT cc.data, cc.valor FROM cotas_cache cc
    JOIN produtos p ON cc.produto_id = p.id
    WHERE p.identificador = ? AND p.tipo = ? AND cc.data >= ? AND cc.data <= ? ORDER BY cc.data
  `).all(identificador, tipo, bufferStr, fimStr)
  const porData = new Map(rows.map((r) => [r.data, r.valor]))
  const ret = new Map()
  let ultimo = null
  for (const r of rows) { if (r.data < diasUteis[0]) ultimo = r.valor; else break }
  for (const dia of diasUteis) {
    const v = porData.get(dia)
    if (v != null && ultimo != null && ultimo > 0) ret.set(dia, v / ultimo - 1)
    if (v != null) ultimo = v
  }
  return ret
}

// ETF usado como proxy de "Alternativos dolarizado": GOLD11 (Trend ETF LBMA
// Ouro, investimento no exterior) — sua cota em BRL já embute o câmbio, ao
// contrário do Trend Ouro (fundo hedgeado) usado no 'alternativos' normal. O
// fundo "Trend Ouro Dólar" (CNPJ 35.609.786/0001-23) não tem cobertura na CVM
// nem posição em nenhuma carteira; GOLD11 tem histórico real desde 12/2020.
const OURO_USD_ETF_TICKER = 'GOLD11'

function construirRetornosDiariosClasseBenchmark(cls, diasUteis, cdiByData, bufferStr, fimStr, db) {
  if (cls === 'alternativos') {
    return retornosDiariosCotaAtivo(OURO_CNPJ_PROXY, 'fundo', diasUteis, bufferStr, fimStr, db)
  }

  if (cls === 'alternativos_usd') {
    return retornosDiariosCotaAtivo(OURO_USD_ETF_TICKER, 'acao', diasUteis, bufferStr, fimStr, db)
  }

  // rv_global_usd/rf_global_usd: ACWI/AGG "puro", sem o hedge cambial CDI-IRX
  // — a exposição cambial real vem do câmbio à vista USD/BRL (USDBRL_DIARIO).
  if (cls === 'rv_global_usd' || cls === 'rf_global_usd') {
    const base = retornosDiariosNivelMacro(cls === 'rv_global_usd' ? 'ACWI_DIARIO' : 'AGG_DIARIO', diasUteis, bufferStr, fimStr, db)
    const fx = retornosDiariosNivelMacro('USDBRL_DIARIO', diasUteis, bufferStr, fimStr, db)
    const ret = new Map()
    for (const dia of diasUteis) {
      const b = base.get(dia)
      const f = fx.get(dia)
      if (b == null || f == null) continue
      ret.set(dia, (1 + b) * (1 + f) - 1)
    }
    return ret
  }

  if (cls === 'pos_fixado') {
    const debb = retornosDiariosNivelMacro('DEBB11_DIARIO', diasUteis, bufferStr, fimStr, db)
    const ret = new Map()
    for (const dia of diasUteis) {
      const d = debb.get(dia)
      if (d == null) continue
      ret.set(dia, 0.6 * (cdiByData.get(dia) ?? 0) + 0.4 * d)
    }
    return ret
  }

  if (cls === 'rv_global' || cls === 'rf_global') {
    const base = retornosDiariosNivelMacro(cls === 'rv_global' ? 'ACWI_DIARIO' : 'AGG_DIARIO', diasUteis, bufferStr, fimStr, db)
    const irxRows = db.prepare(
      `SELECT data, valor FROM dados_macro WHERE serie='IRX_DIARIO' AND data>=? AND data<=? ORDER BY data`
    ).all(bufferStr, fimStr)
    const irxPorData = new Map(irxRows.map((r) => [r.data, r.valor]))
    let ultimoIrx = null
    for (const r of irxRows) { if (r.data < diasUteis[0]) ultimoIrx = r.valor; else break }
    const ret = new Map()
    for (const dia of diasUteis) {
      const v = irxPorData.get(dia)
      if (v != null) ultimoIrx = v
      const b = base.get(dia)
      if (b == null || ultimoIrx == null) continue
      const irxDiario = Math.pow(1 + ultimoIrx / 100, 1 / 252) - 1
      ret.set(dia, b + (cdiByData.get(dia) ?? 0) - irxDiario)
    }
    return ret
  }

  const serie = SERIE_DIARIA_BENCHMARK_CLASSE[cls]
  return serie ? retornosDiariosNivelMacro(serie, diasUteis, bufferStr, fimStr, db) : new Map()
}

// Classes sintéticas exclusivas do otimizador "livre" — versões dolarizadas
// (sem o hedge cambial CDI-IRX) de RV Global/RF Global, e Alternativos via
// GOLD11 em vez do Trend Ouro hedgeado. Não fazem parte da taxonomia de 9
// classes usada pelas carteiras reais (alocacoes_macro/produtos.classe); só
// existem aqui, como benchmarks hipotéticos pra comparação no Monte Carlo.
const CLASSES_SINTETICAS_LIVRE = {
  rv_global_usd:    'RV Global (dolarizado)',
  rf_global_usd:    'RF Global (dolarizado)',
  alternativos_usd: 'Alternativos (dolarizado)',
}

export function otimizarMacroLivre(dataInicio, dataFim, nSimulacoes = 5000, minPeso = 0, maxPeso = 1, classesParam = null) {
  const db = getDb()
  const mesFimStr = dataFim?.slice(0, 7) || new Date().toISOString().slice(0, 7)
  const inicio24m = (() => {
    const d = new Date(mesFimStr + '-01')
    d.setMonth(d.getMonth() - 23)
    return d.toISOString().slice(0, 7)
  })()
  const mesInicioStr = dataInicio?.slice(0, 7) ?? inicio24m
  const meses = gerarMeses(mesInicioStr, mesFimStr)

  if (meses.length < 12) return { error: 'Período insuficiente (mínimo 12 meses).' }

  // classesParam permite ao usuário escolher quais classes incluir.
  const CLASSES_VALIDAS = [...Object.keys(LABELS_CLASSE), ...Object.keys(CLASSES_SINTETICAS_LIVRE)]
  const CLASSES = classesParam
    ? classesParam.filter(c => CLASSES_VALIDAS.includes(c))
    : CLASSES_VALIDAS

  if (CLASSES.length < 2) return { error: 'Selecione ao menos 2 classes para otimizar.' }

  // Calendário de dias úteis via CDI_DIARIO — mesmo padrão diário já usado em
  // calcularSerieDiaria/calcularMetricas/otimizarDentroClasse. 24 pontos
  // mensais é pouco pra estimar covariância entre 9 classes; diário dá ~500.
  const [efy, efm] = mesFimStr.split('-').map(Number)
  const dataInicioStr = `${mesInicioStr}-01`
  const dataFimStr = new Date(efy, efm, 0).toISOString().split('T')[0]

  const cdiRowsDiario = db.prepare(
    `SELECT data, valor FROM dados_macro WHERE serie='CDI_DIARIO' AND data >= ? AND data <= ? ORDER BY data`
  ).all(dataInicioStr, dataFimStr)
  if (cdiRowsDiario.length < 15) return { error: 'Período insuficiente de dados (mínimo ~1 mês útil).' }
  const diasUteis = cdiRowsDiario.map((r) => r.data)
  const cdiByData = new Map(cdiRowsDiario.map((r) => [r.data, r.valor / 100]))
  const cdiMedioDiario = cdiRowsDiario.reduce((s, r) => s + r.valor / 100, 0) / cdiRowsDiario.length

  const bufferInicio = new Date(dataInicioStr + 'T12:00:00')
  bufferInicio.setDate(bufferInicio.getDate() - 10)
  const bufferStr = bufferInicio.toISOString().split('T')[0]

  const retornosPorClasse = Object.fromEntries(
    CLASSES.map((cls) => [cls, construirRetornosDiariosClasseBenchmark(cls, diasUteis, cdiByData, bufferStr, dataFimStr, db)])
  )

  const classesAtivas = CLASSES.filter((cls) => retornosPorClasse[cls].size > 0)
  if (classesAtivas.length < 2) return { error: 'Dados de benchmark insuficientes. Sincronize os dados macro.' }

  // Qualidade dos dados: quantos dias úteis do período têm retorno real vs
  // ficam de fora (sem publicação do índice naquele dia específico).
  const qualidade_dados = Object.fromEntries(
    classesAtivas.map((cls) => [cls, {
      dias_reais: retornosPorClasse[cls].size,
      total: diasUteis.length,
      apenas_estimativa: retornosPorClasse[cls].size === 0,
    }])
  )

  const T = diasUteis.length
  const retMatrix = diasUteis.map((dia) => classesAtivas.map((cls) => retornosPorClasse[cls].get(dia) ?? 0))
  const n = classesAtivas.length
  const means = classesAtivas.map((_, j) => retMatrix.reduce((s, row) => s + row[j], 0) / T)

  const cov = Array.from({ length: n }, () => Array(n).fill(0))
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      cov[i][j] = retMatrix.reduce((s, row) => s + (row[i] - means[i]) * (row[j] - means[j]), 0) / Math.max(T - 1, 1)

  const pesosAtuais = classesAtivas.map(() => 1 / classesAtivas.length)

  function portfolioStats(weights) {
    const retDiario = weights.reduce((s, w, i) => s + w * means[i], 0)
    let variancia = 0
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) variancia += weights[i] * weights[j] * cov[i][j]
    const vol = Math.sqrt(Math.max(variancia, 0)) * Math.sqrt(252)
    const cagr = Math.pow(1 + retDiario, 252) - 1
    const sharpe = vol > 0 ? (cagr - cdiMedioDiario * 252) / vol : 0
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
    for (let iter = 0; iter < 30; iter++) {
      const excess = weights.reduce((s, wi) => s + Math.max(0, wi - maxW), 0)
      if (excess < 1e-10) break
      weights = weights.map(wi => Math.min(wi, maxW))
      const freeTotal = weights.reduce((s, wi) => s + (wi < maxW - 1e-10 ? wi : 0), 0)
      if (freeTotal < 1e-10) { weights = Array(n).fill(1 / n); break }
      weights = weights.map(wi => wi < maxW - 1e-10 ? wi + excess * wi / freeTotal : wi)
    }
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

  const toWeightMap = (p) => classesAtivas.reduce((o, cls, i) => ({ ...o, [cls]: p.weights[i] }), {})

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
      const fixedContrib = freeIdx.map(i => [...fixed].reduce((s, k) => s + cov[i][k] * result[k], 0))
      let subW = Array(m).fill(1 / m)
      for (let iter = 0; iter < 1000; iter++) {
        const mrc = subW.map((_, ii) => budget * subW.reduce((s, wj, jj) => s + subCov[ii][jj] * wj, 0) + fixedContrib[ii])
        const totalVar = subW.reduce((s, wi, ii) => s + wi * budget * mrc[ii], 0)
        if (totalVar <= 0) break
        const newSubW = subW.map((wi, ii) => mrc[ii] > 0 && wi > 0 ? wi * Math.sqrt(totalVar / (m * budget * wi * mrc[ii])) : wi)
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
    const rpSum = result.reduce((a, b) => a + b, 0)
    return rpSum > 1e-10 ? result.map(r => r / rpSum) : Array(n).fill(1 / n)
  })()

  return {
    fronteira: portfolios.map((p) => ({ vol: p.vol, cagr: p.cagr, sharpe: p.sharpe, weights: toWeightMap(p) })),
    max_sharpe: { weights: toWeightMap(maxSharpe), vol: maxSharpe.vol, cagr: maxSharpe.cagr, sharpe: maxSharpe.sharpe },
    min_vol: { weights: toWeightMap(minVol), vol: minVol.vol, cagr: minVol.cagr, sharpe: minVol.sharpe },
    paridade_risco: { weights: toWeightMap({ weights: pesosRP }), ...portfolioStats(pesosRP) },
    atual: { weights: toWeightMap({ weights: pesosAtuais }), ...portfolioStats(pesosAtuais) },
    classes: classesAtivas,
    labels: classesAtivas.map((cls) => LABELS_CLASSE[cls] || CLASSES_SINTETICAS_LIVRE[cls]),
    qualidade_dados,
    n_dias: T,
    n_simulacoes: nSimulacoes,
    livre: true,
  }
}

export function otimizarAtivosLivre(classe, ativosParam, dataInicio, dataFim, nSimulacoes = 5000, minPeso = 0, maxPeso = 1, restricoes = {}) {
  const db = getDb()
  const mesFimStr = dataFim?.slice(0, 7) || new Date().toISOString().slice(0, 7)
  const inicio24m = (() => {
    const d = new Date(mesFimStr + '-01')
    d.setMonth(d.getMonth() - 23)
    return d.toISOString().slice(0, 7)
  })()
  const mesInicioStr = dataInicio?.slice(0, 7) ?? inicio24m
  const meses = gerarMeses(mesInicioStr, mesFimStr)

  if (meses.length < 3) return { error: 'Período insuficiente de dados (mínimo 3 meses).' }

  const ativosComDados = ativosParam.map((ativo) => {
    const retornosMensais = meses.map((mes) => {
      const [ano, m] = mes.split('-').map(Number)
      const inicioMes = `${mes}-01`
      const fimMes = new Date(ano, m, 0).toISOString().split('T')[0]
      const produto = db.prepare(`SELECT * FROM produtos WHERE identificador = ? AND tipo = ? LIMIT 1`).get(ativo.identificador, ativo.tipo)
      if (!produto) return null
      return calcularRetornoProduto(produto, inicioMes, fimMes)
    })
    return { ...ativo, retornosMensais, n_meses_com_dados: retornosMensais.filter((r) => r != null).length }
  })

  const minMeses = Math.max(3, Math.ceil(meses.length * 0.3))
  const ativosValidos = ativosComDados.filter((a) => a.n_meses_com_dados >= minMeses)

  if (ativosValidos.length < 2) {
    return {
      error: 'Dados insuficientes para simular. Sincronize as cotas dos ativos primeiro.',
      ativos: ativosComDados.map((a) => ({
        nome: a.nome, identificador: a.identificador, tipo: a.tipo,
        n_meses_com_dados: a.n_meses_com_dados, valido: a.n_meses_com_dados >= minMeses,
      })),
    }
  }

  const T = meses.length
  const retMatrix = meses.map((_, mi) => ativosValidos.map((a) => a.retornosMensais[mi] ?? 0))
  const n = ativosValidos.length
  const means = ativosValidos.map((_, j) => retMatrix.reduce((s, row) => s + row[j], 0) / T)

  const cov = Array.from({ length: n }, () => Array(n).fill(0))
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      cov[i][j] = retMatrix.reduce((s, row) => s + (row[i] - means[i]) * (row[j] - means[j]), 0) / Math.max(T - 1, 1)

  const cdiRows = getCDIMensalLocal(mesInicioStr, mesFimStr)
  const cdiMedioMensal = cdiRows.length > 0
    ? cdiRows.reduce((s, r) => s + r.valor / 100, 0) / cdiRows.length
    : 0.01

  const pesosAtuais = ativosValidos.map(() => 1 / ativosValidos.length)

  function portfolioStats(weights) {
    const retMensal = weights.reduce((s, w, i) => s + w * means[i], 0)
    let variancia = 0
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) variancia += weights[i] * weights[j] * cov[i][j]
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
      if (freeTotal < 1e-10) { weights = Array(n).fill(1 / n); break }
      weights = weights.map(wi => wi < maxW - 1e-10 ? wi + excess * wi / freeTotal : wi)
    }
    const wSum = weights.reduce((a, b) => a + b, 0)
    if (Math.abs(wSum - 1) > 1e-10) weights = weights.map(w => w / wSum)
    portfolios.push({ weights, ...portfolioStats(weights) })
  }

  const toWeightMap = (p) => ativosValidos.reduce((o, a, i) => ({ ...o, [a.identificador]: p.weights[i] }), {})

  const pesosRP = calcERC(n, cov, minW, maxW)

  const restricoesAtivas = (restricoes.target_duration != null) || (restricoes.max_portfolio_min != null)
  const portfoliosFiltrados = restricoesAtivas
    ? aplicarFiltros(portfolios, ativosValidos, restricoes)
    : portfolios

  if (restricoesAtivas && portfoliosFiltrados.length < 10) {
    return {
      error: `Apenas ${portfoliosFiltrados.length} de ${portfolios.length} simulações atendem às restrições. Amplie as tolerâncias ou desative alguma restrição.`,
      n_simulacoes_total: portfolios.length,
      n_simulacoes_validas: portfoliosFiltrados.length,
    }
  }

  const base = restricoesAtivas ? portfoliosFiltrados : portfolios
  const maxSharpe = base.reduce((best, p) => (p.sharpe > best.sharpe ? p : best))
  const minVolSample = base.reduce((best, p) => (p.vol < best.vol ? p : best))
  const pesosMinVolSolver = solverMinVol(cov, n, minW, maxW)
  const statsMinVolSolver = portfolioStats(pesosMinVolSolver)
  const solverSatisfaz = !restricoesAtivas || satisfazRestricoes(pesosMinVolSolver, ativosValidos, restricoes)
  const minVol = (solverSatisfaz && statsMinVolSolver.vol < minVolSample.vol)
    ? { weights: pesosMinVolSolver, ...statsMinVolSolver }
    : minVolSample

  const ercSatisfaz = !restricoesAtivas || satisfazRestricoes(pesosRP, ativosValidos, restricoes)

  return {
    classe,
    label_classe: LABELS_CLASSE[classe] || classe,
    ativos: ativosComDados.map((a) => ({
      nome: a.nome, identificador: a.identificador, tipo: a.tipo,
      n_meses_com_dados: a.n_meses_com_dados,
      valido: ativosValidos.some((v) => v.identificador === a.identificador),
    })),
    fronteira: base.map((p) => ({ vol: p.vol, cagr: p.cagr, sharpe: p.sharpe, weights: toWeightMap(p) })),
    max_sharpe: { ...maxSharpe, weights: toWeightMap(maxSharpe) },
    min_vol: { ...minVol, weights: toWeightMap(minVol) },
    paridade_risco: {
      weights: toWeightMap({ weights: pesosRP }), ...portfolioStats(pesosRP),
      ...(restricoesAtivas && !ercSatisfaz ? { viola_restricoes: true } : {}),
    },
    atual: null,
    n_meses: T,
    n_simulacoes: nSimulacoes,
    livre: true,
    ...(restricoesAtivas ? { n_simulacoes_total: portfolios.length, n_simulacoes_validas: portfoliosFiltrados.length } : {}),
  }
}

// ── Benchmark mensal por classe ────────────────────────────

function getBenchmarkMensalClasse(cls, cdiMensal, ipcaMensal, mes, db) {
  return retornoPassivoClasse(cls, mes, cdiMensal, ipcaMensal, db)
}

// ── Benchmark por janela arbitrária (diário) ───────────────
// Usado para clipar o benchmark nos meses de borda parciais da atribuição.

// Retorno de uma série de NÍVEL diário (índice/preço) em [inicio,fim]:
// primeiro nível em data>=inicio, último em data<=fim.
function retornoNivelDiario(serie, inicio, fim, db) {
  const v0 = db.prepare(`SELECT valor FROM dados_macro WHERE serie=? AND data>=? AND data<=? ORDER BY data LIMIT 1`).get(serie, inicio, fim)
  const v1 = db.prepare(`SELECT valor FROM dados_macro WHERE serie=? AND data>=? AND data<=? ORDER BY data DESC LIMIT 1`).get(serie, inicio, fim)
  if (!v0 || !v1 || v0.valor == null || v1.valor == null || v0.valor <= 0) return null
  return v1.valor / v0.valor - 1
}

// CDI composto em [inicio,fim] a partir do CDI_DIARIO (valor = % ao dia).
function retornoCDIPeriodo(inicio, fim, db) {
  const rows = db.prepare(`SELECT valor FROM dados_macro WHERE serie='CDI_DIARIO' AND data>=? AND data<=? ORDER BY data`).all(inicio, fim)
  if (!rows.length) return null
  let f = 1
  for (const r of rows) f *= (1 + r.valor / 100)
  return f - 1
}

function contarDiasUteis(inicio, fim, db) {
  return db.prepare(`SELECT COUNT(*) n FROM dados_macro WHERE serie='CDI_DIARIO' AND data>=? AND data<=?`).get(inicio, fim).n
}

// Benchmark da classe numa janela arbitrária, a partir das séries diárias.
// Retorna null quando não há série diária para a classe (rf_global/rv_global,
// ou IHFA/DEBB11 além da cobertura) — o chamador faz fallback pro-rata.
const SERIE_DIARIA_CLASSE = {
  inflacao: 'IMAB_DIARIO',
  prefixado: 'IRFM_DIARIO',
  rv_brasil: 'IBOV_DIARIO',
  fundos_listados: 'IFIX_DIARIO',
  multimercado: 'IHFA_DIARIO',
}
function retornoBenchmarkPeriodo(cls, inicio, fim, db) {
  if (cls === 'alternativos') return retornoNivelCotaCache(OURO_CNPJ_PROXY, inicio, fim, db)
  if (cls === 'pos_fixado') {
    const cdi = retornoCDIPeriodo(inicio, fim, db)
    const debb = retornoNivelDiario('DEBB11_DIARIO', inicio, fim, db)
    if (cdi == null || debb == null) return null
    return 0.6 * cdi + 0.4 * debb
  }
  const serie = SERIE_DIARIA_CLASSE[cls]
  return serie ? retornoNivelDiario(serie, inicio, fim, db) : null
}

// ── Atribuição por classe ───────────────────────────────────

export function calcularAtribuicao(carteiraId, dataInicio, dataFim) {
  const db = getDb()
  const carteira = db.prepare(
    `SELECT c.*, p.id as perfil_id FROM carteiras c JOIN perfis p ON c.perfil_id = p.id WHERE c.id = ?`
  ).get(carteiraId)
  if (!carteira) return null

  // Mesmo default de calcularMetricas para o preset "Início"
  const primeiroEstado = !dataInicio
    ? db.prepare(
        `SELECT MIN(data_inicio) as data_inicio FROM estados_portfolio WHERE carteira_id = ?`
      ).get(carteiraId)
    : null
  const inicioStr = dataInicio || primeiroEstado?.data_inicio || '2020-01-01'
  const fimStr = dataFim || new Date().toISOString().split('T')[0]

  const CLASSES = LABELS_CLASSE
  const TICKER_CANONICAL = { 'CVBI11': 'PCIP11' }

  const estados = db.prepare(`
    SELECT * FROM estados_portfolio
    WHERE carteira_id = ? AND data_inicio <= ? AND (data_fim IS NULL OR data_fim >= ?)
    ORDER BY data_inicio
  `).all(carteiraId, fimStr, inicioStr)
  if (!estados.length) return null

  const estadoIds = estados.map((e) => e.id)
  const phE = estadoIds.map(() => '?').join(',')
  const todosProds = db.prepare(`SELECT * FROM produtos WHERE estado_id IN (${phE})`).all(...estadoIds)
  const prodsByEstado = new Map()
  for (const p of todosProds) {
    if (!prodsByEstado.has(p.estado_id)) prodsByEstado.set(p.estado_id, [])
    prodsByEstado.get(p.estado_id).push(p)
  }

  const identifiers = [...new Set(
    todosProds.filter((p) => (p.tipo === 'fundo' || p.tipo === 'acao') && p.identificador)
              .map((p) => p.identificador)
  )]

  const bufferInicio = new Date(inicioStr + 'T12:00:00')
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
    `).all(...identifiers, bufferStr, fimStr)
    for (const r of rows) {
      if (!cotasMapByIdent.has(r.identificador)) cotasMapByIdent.set(r.identificador, new Map())
      cotasMapByIdent.get(r.identificador).set(r.data, r.valor_ajustado ?? r.valor)
    }
  }

  const cdiRows = db.prepare(
    `SELECT data, valor FROM dados_macro WHERE serie='CDI_DIARIO' AND data >= ? AND data <= ? ORDER BY data`
  ).all(inicioStr, fimStr)
  if (!cdiRows.length) return null
  const cdiByData = new Map(cdiRows.map((r) => [r.data, r.valor / 100]))
  const diasUteis = cdiRows.map((r) => r.data)

  // Dia útil anterior ao período: base do benchmark do 1º dia, para casar com o
  // retorno do 1º dia da carteira (que vem da última cota conhecida antes do início)
  const diaAntesInicio = db.prepare(
    `SELECT data FROM dados_macro WHERE serie='CDI_DIARIO' AND data < ? ORDER BY data DESC LIMIT 1`
  ).get(inicioStr)?.data ?? inicioStr

  const mesIniStr = inicioStr.slice(0, 7)
  const mesFimStr = fimStr.slice(0, 7)

  const ipcaRows = db.prepare(
    `SELECT data, valor FROM dados_macro WHERE serie='IPCA_MENSAL' AND data >= ? AND data <= ? ORDER BY data`
  ).all(mesIniStr + '-01', mesFimStr + '-01')
  const ipcaByMes = new Map(ipcaRows.map((r) => [r.data.slice(0, 7), r.valor / 100]))

  const cdiMesRows = db.prepare(
    `SELECT data, valor FROM dados_macro WHERE serie='CDI_MENSAL' AND data >= ? AND data <= ? ORDER BY data`
  ).all(mesIniStr + '-01', mesFimStr + '-01')
  const cdiByMes = new Map(cdiMesRows.map((r) => [r.data.slice(0, 7), r.valor / 100]))

  const alocRows = db.prepare(
    `SELECT * FROM alocacoes_macro WHERE perfil_id = ? AND mes <= ? ORDER BY mes`
  ).all(carteira.perfil_id, mesFimStr)
  const alocByMes = new Map(alocRows.map((a) => [a.mes, a]))

  function getAloc(mes) {
    if (alocByMes.has(mes)) return alocByMes.get(mes)
    const ant = [...alocByMes.keys()].filter((m) => m <= mes).sort()
    return ant.length ? alocByMes.get(ant[ant.length - 1]) : null
  }

  // Série diária real de cada sub-carteira (mesmo motor calcularSerieDiaria),
  // não mais o retorno mensal de calcularRetornoEstado espalhado pelos dias
  // do mês — ver comentário equivalente em calcularSerieDiaria.
  const subCarteirasIds = [...new Set(
    todosProds.filter((p) => p.tipo === 'carteira' && p.identificador).map((p) => p.identificador)
  )]
  const subRetDiario = new Map()
  for (const subId of subCarteirasIds) {
    const serieSub = calcularSerieDiaria(Number(subId), inicioStr, fimStr)
    if (!serieSub?.length) continue
    for (let i = 1; i < serieSub.length; i++) {
      const ret = (1 + serieSub[i].retorno_acumulado) / (1 + serieSub[i - 1].retorno_acumulado) - 1
      subRetDiario.set(`${subId}_${serieSub[i].data}`, ret)
    }
  }

  const ultimaCota = new Map()
  for (const [ident, cotasMap] of cotasMapByIdent) {
    const antes = [...cotasMap.keys()].filter((d) => d < inicioStr).sort()
    if (antes.length) ultimaCota.set(ident, cotasMap.get(antes[antes.length - 1]))
  }

  function getEstado(dia) {
    let ativo = null
    for (const e of estados) {
      if (e.data_inicio > dia) break
      // Não descarta por data_fim ultrapassada: um gap entre o fim de um
      // estado e o início do próximo (falha de publicação, não intenção de
      // ficar sem posição) herda o último estado conhecido, em vez de zerar
      // o retorno do dia enquanto o CDI de comparação segue acumulando.
      ativo = e
    }
    return ativo
  }

  // Dias úteis do MÊS INTEIRO (não só os do período): mantém o benchmark de
  // fallback pro-rata nos meses de borda parciais.
  const duMesCache = new Map()
  function diasUteisDoMes(mes) {
    if (!duMesCache.has(mes)) {
      const [y, m] = mes.split('-').map(Number)
      duMesCache.set(mes, contarDiasUteis(`${mes}-01`, new Date(y, m, 0).toISOString().split('T')[0], db))
    }
    return duMesCache.get(mes)
  }

  function benchmarkDoDia(cls, diaAnterior, dia, mes) {
    // CDI é série de TAXA (o valor do dia já é o retorno do dia); as demais são
    // séries de NÍVEL e precisam da janela [diaAnterior, dia]. Trend Ouro (alternativos)
    // é uma cota real em cotas_cache, então já é nível — cai no caso genérico
    // via retornoBenchmarkPeriodo, igual IBOV/IMAB/etc.
    let exato
    if (cls === 'pos_fixado') {
      const cdi = cdiByData.get(dia)
      const debb = retornoNivelDiario('DEBB11_DIARIO', diaAnterior, dia, db)
      exato = (cdi != null && debb != null) ? 0.6 * cdi + 0.4 * debb : null
    } else {
      exato = retornoBenchmarkPeriodo(cls, diaAnterior, dia, db)
    }
    if (exato != null) return exato
    const mensal = getBenchmarkMensalClasse(cls, cdiByMes.get(mes) ?? 0, ipcaByMes.get(mes) ?? 0, mes, db)
    const du = diasUteisDoMes(mes)
    const base = 1 + (mensal ?? 0)
    return base > 0 && du > 0 ? Math.pow(base, 1 / du) - 1 : 0
  }

  const acumClasse = {}
  for (const cls of Object.keys(CLASSES)) {
    acumClasse[cls] = { retorno: 1, benchmark: 1, contribuicao_acum: 0, peso_medio: 0, n: 0 }
  }
  const acumAtivo = {}

  let diaAnterior = diaAntesInicio

  for (const dia of diasUteis) {
    const cdiDiario = cdiByData.get(dia) ?? 0
    const estado = getEstado(dia)
    const mes = dia.slice(0, 7)
    const aloc = getAloc(mes)
    const filteredIdents = new Set()

    if (estado && aloc) {
      const prods = prodsByEstado.get(estado.id) || []
      const classeMap = {}
      for (const p of prods) {
        if (!classeMap[p.classe]) classeMap[p.classe] = []
        classeMap[p.classe].push(p)
      }

      for (const cls of Object.keys(CLASSES)) {
        const pesoClasse = (aloc[cls] ?? 0) / 100
        if (!pesoClasse) continue

        const classeProds = classeMap[cls] || []
        const retsPorProd = classeProds.map((p) => {
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
                if (Math.abs(raw) <= 0.40) retP = raw
                else filteredIdents.add(p.identificador)
              }
            }
          } else if (p.tipo === 'carteira' && p.identificador) {
            const retDiarioSub = subRetDiario.get(`${p.identificador}_${dia}`)
            if (retDiarioSub != null) retP = retDiarioSub
          }

          return { p, retP }
        })

        const pesoComDados = retsPorProd.reduce((s, { p, retP }) => retP != null ? s + (p.peso || 0) : s, 0)
        let retClasse = 0
        for (const { p, retP } of retsPorProd) {
          if (retP !== null) retClasse += retP * ((p.peso || 0) / (pesoComDados || 1))
        }

        const benchDia = benchmarkDoDia(cls, diaAnterior, dia, mes)

        for (const { p, retP } of retsPorProd) {
          const canonicalId = p.identificador ? (TICKER_CANONICAL[p.identificador] ?? p.identificador) : null
          // RF na curva (Tesouro/CDB/LCA/CRI/CRA/debênture) não tem CNPJ nem ticker —
          // usa nome+termos como chave, únicos o bastante pra identificar a posição
          // e mesclar a mesma ao longo dos meses (igual identificador faz pros demais).
          const ativoKey = canonicalId
            ? `${canonicalId}__${cls}`
            : `${p.nome}|${p.indexador}|${p.taxa}|${p.data_vencimento}__${cls}`
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
              meses: new Set(),
              meses_com_dados: new Set(),
              indexador: p.indexador,
              tipo_cdi: p.tipo_cdi,
              taxa: p.taxa,
              data_vencimento: p.data_vencimento,
              duration_manual: p.duration_manual,
            }
          }
          const a = acumAtivo[ativoKey]
          a.indexador = p.indexador
          a.tipo_cdi = p.tipo_cdi
          a.taxa = p.taxa
          a.data_vencimento = p.data_vencimento
          a.duration_manual = p.duration_manual

          const pesoNorm = (p.peso || 0) / (pesoComDados || 1)
          a.meses.add(mes)
          if (retP != null) {
            a.retorno_acum *= (1 + retP)
            a.contribuicao_total += retP * pesoNorm * pesoClasse
            a.meses_com_dados.add(mes)
            // Peso médio só conta dias com dado: em dia sem cotação o produto sai
            // do denominador da renormalização e pesoNorm ficaria inflado
            a.peso_portfolio_medio += pesoNorm * pesoClasse
            a.peso_classe_medio += pesoNorm
            a.n++
          }
          a.benchmark_acum *= (1 + benchDia)
        }

        acumClasse[cls].retorno *= (1 + retClasse)
        acumClasse[cls].benchmark *= (1 + benchDia)
        acumClasse[cls].contribuicao_acum += retClasse * pesoClasse
        acumClasse[cls].peso_medio += pesoClasse
        acumClasse[cls].n++
      }
    }

    for (const [ident, cotasMap] of cotasMapByIdent) {
      const v = cotasMap.get(dia)
      if (v !== undefined && v > 0 && !filteredIdents.has(ident)) ultimaCota.set(ident, v)
    }
    diaAnterior = dia
  }

  // sem_dados na mesma granularidade do modelo mensal anterior: mês inteiro sem
  // nenhuma cotação. Buracos de um dia não invalidam o retorno — a cota seguinte
  // captura o intervalo todo via ultimaCota.
  for (const a of Object.values(acumAtivo)) {
    a.sem_dados = [...a.meses].some((m) => !a.meses_com_dados.has(m))
  }

  // retorno_total vem da série diária — mesma fonte de verdade da aba Retorno
  const serieDiaria = calcularSerieDiaria(carteiraId, inicioStr, fimStr)
  const retornoTotal = serieDiaria?.at(-1)?.retorno_acumulado ?? 0

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

  return { classes, retorno_total: retornoTotal }
}
