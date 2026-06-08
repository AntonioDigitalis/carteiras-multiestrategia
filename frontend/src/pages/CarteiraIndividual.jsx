import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { useCarteira, useMetricas } from '../hooks/useCarteiras'
import PeriodSelector, { resolvePeriod } from '../components/ui/PeriodSelector'
import { MetricCard, MetricRow } from '../components/ui/MetricCard'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import CorrelacaoHeatmap from '../components/ui/CorrelacaoHeatmap'
import { api } from '../services/api'
import { clsx } from 'clsx'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, Legend, AreaChart, Area,
  ReferenceLine,
} from 'recharts'
import { format } from 'date-fns'
import { CORES_OTIMIZADOR, LABELS_CLASSE_OT, fmtPct, FronteiraChart, PesosCard, PesosAtivoCard } from '../components/OtimizadorShared'

const defaultPeriod = { preset: '12M', ...resolvePeriod('12M') }

export default function CarteiraIndividual() {
  const { id } = useParams()
  const { carteira, loading: loadingCart } = useCarteira(id)
  const [period, setPeriod] = useState(defaultPeriod)
  const [tab, setTab] = useState('overview')
  const { metricas, loading: loadingMet } = useMetricas(id, period)
  const [exportando, setExportando] = useState(false)

  const exportarExcel = useCallback(async () => {
    setExportando(true)
    try {
      const params = {}
      if (period?.start) params.start = period.start
      if (period?.end) params.end = period.end
      const blob = await api.exportarExcel(id, params)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${carteira?.nome?.replace(/\s+/g, '_') ?? 'carteira'}_${period?.start ?? 'inicio'}_${period?.end ?? 'hoje'}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('Erro ao exportar:', e)
    } finally {
      setExportando(false)
    }
  }, [id, period, carteira])

  if (loadingCart) return <LoadingSpinner text="Carregando carteira..." />

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">
            {carteira?.nome ?? '—'}
          </h1>
          <div className="text-xs text-slate-500 mt-0.5">
            {carteira?.tipo === 'B' ? 'Carteira Exclusiva · R$ 200k+' : 'Carteira Acessível'}
            {' · '}
            {carteira?.perfil_nome}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={exportarExcel}
            disabled={exportando}
            className="btn-secondary flex items-center gap-1.5 text-xs"
          >
            {exportando ? (
              <span className="w-3 h-3 border-2 border-slate-400/30 border-t-slate-400 rounded-full animate-spin" />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            )}
            {exportando ? 'Exportando...' : 'Exportar Excel'}
          </button>
          <PeriodSelector value={period} onChange={setPeriod} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-6 border-b border-border">
        {[
          { key: 'overview', label: 'Visão Geral' },
          { key: 'retorno', label: 'Retorno' },
          { key: 'risco', label: 'Risco' },
          { key: 'correlacao', label: 'Correlação' },
          { key: 'atribuicao', label: 'Atribuição' },
          { key: 'passiva', label: 'vs. Passiva' },
          { key: 'otimizador', label: 'Otimizador' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              'pb-3 text-sm font-medium transition-colors',
              tab === key ? 'tab-active' : 'tab-inactive'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'otimizador' ? (
        <OtimizadorTab carteiraId={id} period={period} />
      ) : loadingMet ? (
        <LoadingSpinner text="Calculando métricas..." />
      ) : !metricas ? (
        <div className="text-center py-16 text-slate-500 text-sm">
          Sem dados para o período selecionado. Adicione dados na tela de Gestão.
        </div>
      ) : (
        <>
          {tab === 'overview' && <OverviewTab metricas={metricas} />}
          {tab === 'retorno' && <RetornoTab metricas={metricas} />}
          {tab === 'risco' && <RiscoTab metricas={metricas} />}
          {tab === 'correlacao' && <CorrelacaoTab carteiraId={id} period={period} />}
          {tab === 'atribuicao' && <AtribuicaoTab carteiraId={id} period={period} />}
          {tab === 'passiva' && <PassivaTab carteiraId={id} period={period} />}
        </>
      )}
    </div>
  )
}

function OverviewTab({ metricas }) {
  const m = metricas
  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          title="Retorno Acumulado"
          value={fmtPct(m.retorno_acumulado)}
          trend={m.retorno_acumulado}
          size="lg"
        />
        <MetricCard
          title="CAGR"
          value={fmtPct(m.cagr)}
          subtitle="Retorno anualizado"
          trend={m.cagr}
          tooltip="Compound Annual Growth Rate — taxa de retorno anualizada equivalente ao período selecionado. Permite comparar carteiras com históricos de tamanhos diferentes."
        />
        <MetricCard
          title="Volatilidade"
          value={fmtPct(m.volatilidade)}
          subtitle="Anualizada"
          tooltip="Desvio padrão dos retornos mensais, anualizado (× √12). Mede a dispersão dos resultados em torno da média — quanto maior, mais imprevisível a rentabilidade mensal."
        />
        <MetricCard
          title="Sharpe"
          value={m.sharpe?.toFixed(2)}
          trend={m.sharpe}
          subtitle="vs CDI"
          tooltip="Retorno excedente ao CDI dividido pela volatilidade. Mede o quanto de retorno extra a carteira entrega por unidade de risco assumido. Acima de 0 = melhor que CDI ajustado ao risco."
        />
      </div>

      {/* Gráfico de performance */}
      {(m.serie_retorno_diaria ?? m.serie_retorno)?.length > 0 && (
        <div className="card">
          <div className="text-sm font-medium text-slate-300 mb-4">Retorno Acumulado</div>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={m.serie_retorno_diaria ?? m.serie_retorno}>
              <defs>
                <linearGradient id="retGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3e" />
              <XAxis
                dataKey="data"
                tick={{ fill: '#64748b', fontSize: 11 }}
                interval="preserveStartEnd"
                tickFormatter={(v) => {
                  const [y, m] = v.split('-')
                  return `${m}/${y.slice(2)}`
                }}
              />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 11 }}
                tickFormatter={(v) => `${(v * 100).toFixed(1)}%`}
              />
              <Tooltip
                contentStyle={{ background: '#1e2132', border: '1px solid #2a2d3e', borderRadius: 6 }}
                labelStyle={{ color: '#94a3b8', fontSize: 11 }}
                formatter={(v) => [`${(v * 100).toFixed(2)}%`, '']}
              />
              <Area
                type="monotone"
                dataKey="retorno_acumulado"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#retGrad)"
                dot={false}
                name="Carteira"
              />
              {(m.serie_retorno_diaria ?? m.serie_retorno)[0]?.cdi_acumulado != null && (
                <Line
                  type="monotone"
                  dataKey="cdi_acumulado"
                  stroke="#64748b"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                  name="CDI"
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Métricas adicionais */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <div className="text-sm font-medium text-slate-300 mb-3">Retorno</div>
          <div className="space-y-0.5">
            <MetricRow label="Melhor mês" value={fmtPct(m.melhor_mes)} highlight={1} />
            <MetricRow label="Pior mês" value={fmtPct(m.pior_mes)} highlight={-1} />
            <MetricRow label="% Meses positivos" value={m.pct_meses_positivos != null ? `${(m.pct_meses_positivos * 100).toFixed(0)}%` : '—'} />
            <MetricRow label="vs CDI (acum.)" value={fmtPct(m.retorno_vs_cdi)} highlight={m.retorno_vs_cdi}
              tooltip="Diferença absoluta entre o retorno acumulado da carteira e o CDI no período (em pontos percentuais). Positivo = superou o CDI." />
            <MetricRow label="% do CDI" value={m.retorno_vs_cdi_pct != null ? `${(m.retorno_vs_cdi_pct * 100).toFixed(1)}%` : '—'}
              tooltip="Retorno da carteira expresso como proporção do CDI no mesmo período. Ex: 90% CDI = a carteira rendeu 90% do que o CDI rendeu. Acima de 100% = superou o CDI." />
          </div>
        </div>
        <div className="card">
          <div className="text-sm font-medium text-slate-300 mb-3">Risco</div>
          <div className="space-y-0.5">
            <MetricRow label="Max Drawdown" value={fmtPct(m.max_drawdown)} highlight={-1}
              tooltip="Maior queda percentual do pico ao vale registrada no período. Mede o pior cenário de perda que um investidor poderia ter sofrido." />
            <MetricRow label="Sortino" value={m.sortino?.toFixed(2)} highlight={m.sortino}
              tooltip="Variação do Sharpe que penaliza apenas a volatilidade negativa (retornos abaixo do CDI). Mais relevante que o Sharpe quando as perdas são a principal preocupação." />
            <MetricRow label="Calmar" value={m.calmar?.toFixed(2)} highlight={m.calmar}
              tooltip="CAGR dividido pelo módulo do Max Drawdown. Mede o retorno anualizado obtido por cada ponto percentual de risco máximo assumido. Quanto maior, melhor." />
            <MetricRow label="Início MDD" value={m.mdd_inicio ?? '—'} />
            <MetricRow label="Fim MDD" value={m.mdd_fim ?? '—'} />
          </div>
        </div>
      </div>
    </div>
  )
}

function RetornoTab({ metricas }) {
  const m = metricas
  const serieAcum = m.serie_retorno_diaria ?? m.serie_retorno

  return (
    <div className="space-y-4">
      {serieAcum?.length > 1 && (
        <div className="card">
          <div className="text-sm font-medium text-slate-300 mb-4">Retorno Acumulado (diário)</div>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={serieAcum}>
              <defs>
                <linearGradient id="retGrad2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3e" />
              <XAxis
                dataKey="data"
                tick={{ fill: '#64748b', fontSize: 11 }}
                interval="preserveStartEnd"
                tickFormatter={(v) => { const [y, mo] = v.split('-'); return `${mo}/${y.slice(2)}` }}
              />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 11 }}
                tickFormatter={(v) => `${(v * 100).toFixed(1)}%`}
              />
              <Tooltip
                contentStyle={{ background: '#1e2132', border: '1px solid #2a2d3e', borderRadius: 6 }}
                labelStyle={{ color: '#94a3b8', fontSize: 11 }}
                formatter={(v) => [`${(v * 100).toFixed(2)}%`, '']}
              />
              <Legend />
              <Area type="monotone" dataKey="retorno_acumulado" stroke="#3b82f6" strokeWidth={2}
                fill="url(#retGrad2)" dot={false} name="Carteira" />
              {serieAcum[0]?.cdi_acumulado != null && (
                <Line type="monotone" dataKey="cdi_acumulado" stroke="#64748b"
                  strokeWidth={1.5} strokeDasharray="4 2" dot={false} name="CDI" />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {m.retornos_mensais?.length > 0 && (
        <div className="card">
          <div className="text-sm font-medium text-slate-300 mb-4">Retornos Mensais</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={m.retornos_mensais}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3e" />
              <XAxis dataKey="mes" tick={{ fill: '#64748b', fontSize: 11 }}
                tickFormatter={(v) => { const [y, mo] = v.split('-'); return `${mo}/${y.slice(2)}` }}
              />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }}
                tickFormatter={(v) => `${(v * 100).toFixed(1)}%`}
              />
              <Tooltip
                contentStyle={{ background: '#1e2132', border: '1px solid #2a2d3e', borderRadius: 6 }}
                formatter={(v) => [`${(v * 100).toFixed(2)}%`, '']}
              />
              <Legend />
              <ReferenceLine y={0} stroke="#475569" strokeWidth={1} />
              <Line type="monotone" dataKey="retorno" stroke="#3b82f6" dot={false} name="Carteira" />
              <Line type="monotone" dataKey="cdi" stroke="#64748b" strokeDasharray="4 2" dot={false} name="CDI" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

function RiscoTab({ metricas }) {
  const m = metricas
  const fmtPct2 = (v) => v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-4">
        <div className="card space-y-0.5">
          <div className="text-sm font-medium text-slate-300 mb-3">Volatilidade e Drawdown</div>
          <MetricRow label="Volatilidade anualizada" value={fmtPct(m.volatilidade)}
            tooltip="Desvio padrão dos retornos mensais, anualizado (× √12)." />
          <MetricRow label="Max Drawdown" value={fmtPct(m.max_drawdown)} highlight={-1}
            tooltip="Maior queda percentual do pico ao vale registrada no período." />
          <MetricRow label="Duração MDD (dias úteis)" value={m.mdd_duracao ?? '—'}
            tooltip="Dias úteis desde o pico até o fundo do maior drawdown." />
          <MetricRow label="Sharpe" value={m.sharpe?.toFixed(2)} highlight={m.sharpe}
            tooltip="Retorno excedente ao CDI dividido pela volatilidade total." />
          <MetricRow label="Sortino" value={m.sortino?.toFixed(2)} highlight={m.sortino}
            tooltip="Como o Sharpe, mas penaliza apenas a volatilidade negativa (downside deviation)." />
          <MetricRow label="Calmar" value={m.calmar?.toFixed(2)} highlight={m.calmar}
            tooltip="CAGR / |Max Drawdown|. Retorno anual por unidade de queda máxima." />
        </div>

        <div className="card space-y-0.5">
          <div className="text-sm font-medium text-slate-300 mb-3">VaR / CVaR Histórico (mensal)</div>
          <MetricRow label="VaR 95%" value={fmtPct2(m.var_95)} highlight={-1}
            tooltip="Em 95% dos meses, a perda não superou este valor. Calculado como o percentil 5% dos retornos mensais." />
          <MetricRow label="CVaR 95%" value={fmtPct2(m.cvar_95)} highlight={-1}
            tooltip="Perda média esperada nos 5% piores meses. Mais conservador que o VaR." />
          <MetricRow label="VaR 99%" value={fmtPct2(m.var_99)} highlight={-1}
            tooltip="Em 99% dos meses, a perda não superou este valor (percentil 1%)." />
          <MetricRow label="CVaR 99%" value={fmtPct2(m.cvar_99)} highlight={-1}
            tooltip="Perda média esperada no 1% pior dos meses." />
        </div>
      </div>

      <div className="space-y-4">
        <div className="card space-y-0.5">
          <div className="text-sm font-medium text-slate-300 mb-3">vs. {m.benchmark_label ?? 'Benchmark'}</div>
          {!m.benchmark_disponivel && (
            <p className="text-xs text-slate-500">Dados insuficientes de {m.benchmark_label ?? 'benchmark'} no período (&lt; 12 meses de overlap).</p>
          )}
          <MetricRow label="Beta" value={m.beta?.toFixed(2) ?? '—'}
            tooltip={`Sensibilidade da carteira ao ${m.benchmark_label ?? 'benchmark'}. Beta=1 move igual ao índice; <1 menos sensível; >1 amplifica os movimentos.`} />
          <MetricRow label="Up Capture" value={m.up_capture != null ? `${(m.up_capture * 100).toFixed(0)}%` : '—'}
            tooltip={`Quanto a carteira capturou dos meses de alta do ${m.benchmark_label ?? 'benchmark'}. Acima de 100% = superou o índice nas altas.`} />
          <MetricRow label="Down Capture" value={m.down_capture != null ? `${(m.down_capture * 100).toFixed(0)}%` : '—'}
            tooltip={`Quanto a carteira capturou das quedas do ${m.benchmark_label ?? 'benchmark'}. Abaixo de 100% = perdeu menos que o índice nas baixas.`} />
        </div>

        <div className="card space-y-0.5">
          <div className="text-sm font-medium text-slate-300 mb-3">Retorno por Janela</div>
          <MetricRow label="Mês atual (MTD)" value={fmtPct2(m.retorno_mtd)} highlight={m.retorno_mtd} />
          <MetricRow label="Ano (YTD)" value={fmtPct2(m.retorno_ytd)} highlight={m.retorno_ytd} />
          <MetricRow label="12 meses" value={fmtPct2(m.retorno_12m)} highlight={m.retorno_12m} />
          <MetricRow label="24 meses" value={fmtPct2(m.retorno_24m)} highlight={m.retorno_24m} />
          <MetricRow label="Desde o início" value={fmtPct(m.retorno_acumulado)} highlight={m.retorno_acumulado} />
        </div>
      </div>
    </div>
  )
}

function CorrelacaoTab({ carteiraId, period }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = {}
    if (period?.start) params.start = period.start
    if (period?.end) params.end = period.end
    api.getCorrelacao(carteiraId, params)
      .then(d => { if (!cancelled) setData(d) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [carteiraId, period?.start, period?.end])

  if (loading) return <LoadingSpinner text="Calculando correlações..." />
  if (!data) return <p className="text-slate-500 text-sm py-8 text-center">Dados insuficientes para calcular correlação (mínimo 12 meses por classe).</p>

  return (
    <div className="card space-y-4">
      <div>
        <div className="text-sm font-medium text-slate-300">Matriz de Correlação entre Classes</div>
        <p className="text-xs text-slate-500 mt-0.5">{data.n_meses} meses · Correlação de Pearson sobre retornos mensais</p>
      </div>
      <CorrelacaoHeatmap classes={data.classes} labels={data.labels} matrix={data.matrix} />
    </div>
  )
}

function fmtDur(d) {
  if (d == null) return '—'
  if (d === 0) return '0,0 a'
  return `${d.toFixed(1).replace('.', ',')} a`
}

function AtribuicaoTab({ carteiraId, period }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState({})

  useEffect(() => {
    setLoading(true)
    const params = {}
    if (period?.start) params.start = period.start
    if (period?.end) params.end = period.end
    api.getAtribuicao(carteiraId, params)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [carteiraId, period?.start, period?.end])

  if (loading) return <LoadingSpinner />
  if (!data) return <div className="text-sm text-slate-500 py-8 text-center">Sem dados</div>

  function toggleClasse(key) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="text-sm font-medium text-slate-300 mb-4">Atribuição por Classe · Ativo</div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-border">
              <th className="text-left pb-2 font-medium pl-2">Classe / Ativo</th>
              <th className="text-right pb-2 font-medium">Peso</th>
              <th className="text-right pb-2 font-medium" title="Duration modificada dos ativos de RF (anos). CDI flutuante = 0.">Duration RF</th>
              <th className="text-right pb-2 font-medium">Retorno</th>
              <th className="text-right pb-2 font-medium">vs Benchmark</th>
              <th className="text-right pb-2 font-medium">Contribuição</th>
            </tr>
          </thead>
          <tbody>
            {data.classes?.map((cl) => {
              const isOpen = expanded[cl.key]
              const temAtivos = cl.ativos?.length > 0
              return (
                <>
                  {/* Linha de classe */}
                  <tr
                    key={cl.key}
                    className={clsx(
                      'border-b border-border cursor-pointer select-none',
                      temAtivos ? 'hover:bg-bg-tertiary/30' : ''
                    )}
                    onClick={() => temAtivos && toggleClasse(cl.key)}
                  >
                    <td className="py-2 pl-2 text-slate-200 font-medium flex items-center gap-1.5">
                      {temAtivos && (
                        <span className="text-slate-500 text-[10px] w-3">{isOpen ? '▼' : '▶'}</span>
                      )}
                      {!temAtivos && <span className="w-3" />}
                      {cl.nome}
                    </td>
                    <td className="py-2 text-right text-slate-400 font-mono">{fmtPct(cl.peso)}</td>
                    <td className="py-2 text-right font-mono text-slate-300">
                      {fmtDur(cl.duration_media_rf)}
                    </td>
                    <td className={clsx('py-2 text-right font-mono font-semibold', cl.retorno >= 0 ? 'text-accent-green' : 'text-accent-red')}>
                      {fmtPct(cl.retorno)}
                    </td>
                    <td className={clsx('py-2 text-right font-mono', (cl.vs_benchmark ?? 0) >= 0 ? 'text-accent-green' : 'text-accent-red')}>
                      {cl.benchmark != null ? fmtPct(cl.vs_benchmark) : '—'}
                    </td>
                    <td className={clsx('py-2 text-right font-mono', cl.contribuicao >= 0 ? 'text-accent-green' : 'text-accent-red')}>
                      {fmtPct(cl.contribuicao)}
                    </td>
                  </tr>

                  {/* Linhas dos ativos (expandível) */}
                  {isOpen && cl.ativos?.map((at) => (
                    <tr
                      key={at.nome}
                      className="border-b border-border/30 bg-bg-secondary/50"
                    >
                      <td className="py-1.5 pl-8 pr-2">
                        <div className={clsx('text-slate-300', at.sem_dados && 'opacity-50')}>
                          {at.nome}
                        </div>
                        {at.identificador && (
                          <div className="text-[10px] text-slate-600 font-mono">{at.identificador}</div>
                        )}
                        {at.sem_dados && (
                          <div className="text-[10px] text-accent-yellow">⚠ sem cotas</div>
                        )}
                      </td>
                      <td className="py-1.5 text-right text-slate-500 font-mono text-[11px]">
                        <div>{fmtPct(at.peso_portfolio)}</div>
                        <div className="text-slate-600">{fmtPct(at.peso_classe)} na classe</div>
                      </td>
                      <td className="py-1.5 text-right font-mono text-[11px] text-slate-400">
                        {fmtDur(at.duration)}
                      </td>
                      <td className={clsx('py-1.5 text-right font-mono text-[11px]', at.retorno >= 0 ? 'text-accent-green' : 'text-accent-red')}>
                        {fmtPct(at.retorno)}
                      </td>
                      <td className={clsx('py-1.5 text-right font-mono text-[11px]', at.vs_benchmark == null ? 'text-slate-600' : (at.vs_benchmark >= 0 ? 'text-accent-green' : 'text-accent-red'))}>
                        {at.vs_benchmark != null ? fmtPct(at.vs_benchmark) : '—'}
                      </td>
                      <td className={clsx('py-1.5 text-right font-mono text-[11px]', at.contribuicao >= 0 ? 'text-accent-green' : 'text-accent-red')}>
                        {fmtPct(at.contribuicao)}
                      </td>
                    </tr>
                  ))}
                </>
              )
            })}
          </tbody>
        </table>
        <div className="mt-3 text-[10px] text-slate-600">
          Clique em uma classe para expandir e ver os ativos individuais. "vs Benchmark" = retorno do ativo menos o benchmark da classe no período. Duration = duration modificada atual (PRE/IPCA bullet); CDI flutuante = 0,0 a.
        </div>
      </div>

      <div className="card">
        <div className="text-sm font-medium text-slate-300 mb-1">Retorno Total da Carteira</div>
        <div className={clsx('text-2xl font-mono font-semibold', (data.retorno_total ?? 0) >= 0 ? 'text-accent-green' : 'text-accent-red')}>
          {fmtPct(data.retorno_total)}
        </div>
      </div>
    </div>
  )
}

function PassivaTab({ carteiraId, period }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    const params = {}
    if (period?.start) params.start = period.start
    if (period?.end) params.end = period.end
    api.getCarteiraPassiva(carteiraId, params)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [carteiraId, period?.start, period?.end])

  if (loading) return <LoadingSpinner />
  if (!data) return (
    <div className="card text-center py-12 text-slate-500 text-sm">
      Sem dados para o período. Adicione alocações e dados na tela de Gestão.
    </div>
  )

  const ma = data.metricas_ativo
  const mp = data.metricas_passivo

  return (
    <div className="space-y-6">
      {/* Gráfico retorno acumulado */}
      {(data.serie_diaria ?? data.serie)?.length > 1 && (
        <div className="card">
          <div className="text-sm font-medium text-slate-300 mb-4">Retorno Acumulado: Ativa vs Passiva</div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data.serie_diaria ?? data.serie}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3e" />
              <XAxis
                dataKey="data"
                tick={{ fill: '#64748b', fontSize: 11 }}
                interval="preserveStartEnd"
                tickFormatter={(v) => { const [y, m] = v.split('-'); return `${m}/${y.slice(2)}` }}
              />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 11 }}
                tickFormatter={(v) => `${(v * 100).toFixed(1)}%`}
              />
              <Tooltip
                contentStyle={{ background: '#1e2132', border: '1px solid #2a2d3e', borderRadius: 6 }}
                formatter={(v, name) => [`${(v * 100).toFixed(2)}%`, name]}
              />
              <Legend />
              <Line type="monotone" dataKey="ativo_acumulado" stroke="#3b82f6" strokeWidth={2} dot={false} name="Carteira Ativa" connectNulls />
              <Line type="monotone" dataKey="passivo_acumulado" stroke="#64748b" strokeWidth={2} strokeDasharray="4 2" dot={false} name="Carteira Passiva" connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Alpha acumulado (rolling 12m) */}
      {data.rolling_alpha?.length > 0 && (
        <div className="card">
          <div className="text-sm font-medium text-slate-300 mb-1">Alpha Rolante (12 meses)</div>
          <p className="text-xs text-slate-500 mb-4">Retorno acumulado da ativa sobre a passiva em janelas de 12 meses</p>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={data.rolling_alpha}>
              <defs>
                <linearGradient id="alphaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3e" />
              <XAxis dataKey="data" tick={{ fill: '#64748b', fontSize: 11 }} />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 11 }}
                tickFormatter={(v) => `${(v * 100).toFixed(1)}%`}
              />
              <Tooltip
                contentStyle={{ background: '#1e2132', border: '1px solid #2a2d3e', borderRadius: 6 }}
                formatter={(v) => [`${(v * 100).toFixed(2)}%`, 'Alpha 12m']}
              />
              <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 2" />
              <Area type="monotone" dataKey="alpha_12m" stroke="#22c55e" strokeWidth={2} fill="url(#alphaGrad)" name="Alpha 12m" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Métricas comparadas */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <div className="text-sm font-semibold text-accent-blue mb-3">Carteira Ativa</div>
          <div className="space-y-0.5">
            <MetricRow label="Retorno acumulado" value={fmtPct(ma?.retorno_acumulado)} highlight={ma?.retorno_acumulado} />
            <MetricRow label="CAGR" value={fmtPct(ma?.cagr)} highlight={ma?.cagr} />
            <MetricRow label="Volatilidade" value={fmtPct(ma?.volatilidade)} />
            <MetricRow label="Sharpe" value={ma?.sharpe?.toFixed(2)} highlight={ma?.sharpe} />
            <MetricRow label="Max Drawdown" value={fmtPct(ma?.max_drawdown)} highlight={-1} />
          </div>
        </div>
        <div className="card">
          <div className="text-sm font-semibold text-slate-400 mb-3">Carteira Passiva (benchmark)</div>
          <div className="space-y-0.5">
            <MetricRow label="Retorno acumulado" value={fmtPct(mp?.retorno_acumulado)} highlight={mp?.retorno_acumulado} />
            <MetricRow label="CAGR" value={fmtPct(mp?.cagr)} highlight={mp?.cagr} />
            <MetricRow label="Volatilidade" value={fmtPct(mp?.volatilidade)} />
            <MetricRow label="Sharpe" value={mp?.sharpe?.toFixed(2)} highlight={mp?.sharpe} />
            <MetricRow label="Max Drawdown" value={fmtPct(mp?.max_drawdown)} highlight={-1} />
          </div>
        </div>
      </div>

      {/* Métricas de seleção */}
      <div className="card">
        <div className="text-sm font-medium text-slate-300 mb-3">Métricas de Geração de Alpha</div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-slate-500 mb-0.5">Alpha Total</div>
            <div className={clsx('text-lg font-mono font-semibold', (data.alpha_total ?? 0) >= 0 ? 'text-accent-green' : 'text-accent-red')}>
              {fmtPct(data.alpha_total)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-0.5">Tracking Error</div>
            <div className="text-lg font-mono font-semibold text-slate-200">{fmtPct(data.tracking_error)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-0.5">Information Ratio</div>
            <div className={clsx('text-lg font-mono font-semibold', (data.information_ratio ?? 0) >= 0 ? 'text-accent-green' : 'text-accent-red')}>
              {data.information_ratio != null ? data.information_ratio.toFixed(2) : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Legenda dos benchmarks */}
      {data.benchmarks && (
        <div className="card">
          <div className="text-sm font-medium text-slate-300 mb-2">Benchmarks da Carteira Passiva</div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1">
            {Object.entries(data.benchmarks).map(([cls, bench]) => (
              <div key={cls} className="flex justify-between text-xs">
                <span className="text-slate-500">{LABELS_CLASSE_FE[cls] ?? cls}</span>
                <span className="text-slate-400 font-mono">{bench}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const LABELS_CLASSE_FE = {
  pos_fixado:      'Pós-fixado',
  inflacao:        'Inflação',
  prefixado:       'Pré-fixado',
  rf_global:       'RF Global',
  multimercado:    'Multimercado',
  rv_brasil:       'RV Brasil',
  rv_global:       'RV Global',
  fundos_listados: 'Fundos Listados',
  alternativos:    'Alternativos',
}



function OtimizadorTab({ carteiraId, period }) {
  const [subTab, setSubTab] = useState('macro')

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-border pb-3">
        {[
          { key: 'macro', label: 'Por Classe' },
          { key: 'ativo', label: 'Por Ativo' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              subTab === t.key ? 'bg-accent-blue text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'macro' && <OtimizadorMacro carteiraId={carteiraId} period={period} />}
      {subTab === 'ativo' && <OtimizadorAtivo carteiraId={carteiraId} period={period} />}
    </div>
  )
}

function OtimizadorMacro({ carteiraId, period }) {
  const [resultado, setResultado] = useState(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState(null)
  const [minPeso, setMinPeso] = useState(0)
  const [maxPeso, setMaxPeso] = useState(0)

  async function otimizar() {
    setLoading(true); setErro(null); setResultado(null)
    try {
      const params = {}
      if (period?.start) params.start = period.start
      if (period?.end) params.end = period.end
      if (minPeso > 0) params.min_peso = minPeso
      if (maxPeso > 0) params.max_peso = maxPeso
      const data = await api.otimizar(carteiraId, params)
      if (data?.error) { setErro(data.error); return }
      setResultado(data)
    } catch (e) { setErro(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="text-sm font-medium text-slate-300 mb-1">Otimizador de Alocação (Monte Carlo)</div>
        <p className="text-xs text-slate-500 mb-4">
          Simula {(5000).toLocaleString()} combinações de pesos entre as classes de ativos e identifica os portfólios de máximo Sharpe e mínima volatilidade.
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 whitespace-nowrap">Mín. por classe (%)</label>
            <input
              type="number" min={0} max={100} step={1} value={minPeso}
              onChange={(e) => setMinPeso(Math.max(0, Number(e.target.value)))}
              className="w-16 bg-bg-tertiary border border-border rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-accent-blue"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 whitespace-nowrap">Máx. por classe (%)</label>
            <input
              type="number" min={0} max={100} step={1} value={maxPeso}
              onChange={(e) => setMaxPeso(Math.max(0, Number(e.target.value)))}
              className="w-16 bg-bg-tertiary border border-border rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-accent-blue"
            />
          </div>
          <span className="text-[10px] text-slate-600">0 = sem restrição</span>
        </div>
        <button onClick={otimizar} disabled={loading} className="btn-primary flex items-center gap-2">
          {loading ? <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Otimizando...</> : 'Otimizar Carteira'}
        </button>
        {erro && <div className="mt-3 text-xs text-accent-red bg-red-900/20 border border-red-800/50 rounded px-3 py-2">{erro}</div>}
      </div>

      {resultado && (
        <>
          <div className="card">
            <div className="text-sm font-medium text-slate-300 mb-1">Fronteira Eficiente</div>
            <p className="text-xs text-slate-500 mb-4">Cada ponto representa um portfólio simulado. Os portfólios ótimos estão destacados.</p>
            <FronteiraChart resultado={resultado} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <PesosCard titulo="Máximo Sharpe" subtitulo={`Sharpe: ${Number.isFinite(resultado.max_sharpe.sharpe) ? resultado.max_sharpe.sharpe.toFixed(2) : '—'}`} cor={CORES_OTIMIZADOR.max_sharpe} portfolio={resultado.max_sharpe} classes={resultado.classes} labels={resultado.labels} />
            <PesosCard titulo="Mínima Volatilidade" subtitulo={`Vol: ${fmtPct(resultado.min_vol.vol)}`} cor={CORES_OTIMIZADOR.min_vol} portfolio={resultado.min_vol} classes={resultado.classes} labels={resultado.labels} />
            {resultado.paridade_risco && (
              <PesosCard titulo="Paridade de Risco" subtitulo={`Vol: ${fmtPct(resultado.paridade_risco.vol)}`} cor={CORES_OTIMIZADOR.paridade_risco} portfolio={resultado.paridade_risco} classes={resultado.classes} labels={resultado.labels} />
            )}
          </div>
          <div className="card overflow-x-auto">
            <div className="text-sm font-medium text-slate-300 mb-4">Comparação de Portfólios</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-slate-500">
                  <th className="text-left pb-2 font-medium">Métrica</th>
                  <th className="text-right pb-2 font-medium" style={{ color: CORES_OTIMIZADOR.atual }}>Atual</th>
                  <th className="text-right pb-2 font-medium" style={{ color: CORES_OTIMIZADOR.max_sharpe }}>Máx. Sharpe</th>
                  <th className="text-right pb-2 font-medium" style={{ color: CORES_OTIMIZADOR.min_vol }}>Mín. Vol.</th>
                  {resultado.paridade_risco && <th className="text-right pb-2 font-medium" style={{ color: CORES_OTIMIZADOR.paridade_risco }}>Par. Risco</th>}
                </tr>
              </thead>
              <tbody>
                {[
                  { label: 'CAGR esperado', key: 'cagr', fmt: fmtPct },
                  { label: 'Volatilidade', key: 'vol', fmt: fmtPct },
                  { label: 'Sharpe', key: 'sharpe', fmt: (v) => v?.toFixed(2) },
                ].map(({ label, key, fmt }) => (
                  <tr key={key} className="border-b border-border/30">
                    <td className="py-2 text-slate-400">{label}</td>
                    <td className="py-2 text-right font-mono text-slate-300">{fmt(resultado.atual[key]) ?? '—'}</td>
                    <td className="py-2 text-right font-mono text-accent-green">{fmt(resultado.max_sharpe[key]) ?? '—'}</td>
                    <td className="py-2 text-right font-mono text-accent-yellow">{fmt(resultado.min_vol[key]) ?? '—'}</td>
                    {resultado.paridade_risco && <td className="py-2 text-right font-mono" style={{ color: CORES_OTIMIZADOR.paridade_risco }}>{fmt(resultado.paridade_risco[key]) ?? '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 text-[10px] text-slate-600">
              Baseado em {resultado.n_meses} meses de dados · {resultado.n_simulacoes?.toLocaleString()} simulações
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function OtimizadorAtivo({ carteiraId, period }) {
  const [classe, setClasse] = useState('multimercado')
  const [ativos, setAtivos] = useState([])
  const [loadingAtivos, setLoadingAtivos] = useState(false)
  const [novoId, setNovoId] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addErro, setAddErro] = useState(null)
  const [resultado, setResultado] = useState(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState(null)
  const [minPeso, setMinPeso] = useState(0)
  const [maxPeso, setMaxPeso] = useState(0)
  const [usarDuration, setUsarDuration] = useState(false)
  const [usarMinValue, setUsarMinValue] = useState(false)
  const [targetDuration, setTargetDuration] = useState('')
  const [durationTolerancia, setDurationTolerancia] = useState(1)
  const [maxPortfolioMin, setMaxPortfolioMin] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoadingAtivos(true)
    setResultado(null)
    setMinPeso(0)
    setMaxPeso(0)
    api.getAtivosClasse(carteiraId, classe)
      .then((data) => { if (!cancelled) setAtivos(data.map((a) => ({ ...a, duration: '', min_lote: '' }))) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingAtivos(false) })
    return () => { cancelled = true }
  }, [classe, carteiraId])

  function atualizarAtivo(id, campo, valor) {
    setAtivos((prev) => prev.map((a) => a.identificador === id ? { ...a, [campo]: valor } : a))
  }

  async function adicionarAtivo() {
    const id = novoId.trim()
    if (!id) return
    if (ativos.some((a) => a.identificador === id)) { setAddErro('Ativo já está na lista'); return }
    setAddLoading(true); setAddErro(null)
    try {
      const isCNPJ = id.replace(/\D/g, '').length === 14
      let nome = id
      let tipo = 'acao'
      if (isCNPJ) {
        const fundo = await api.buscarFundo(id)
        nome = fundo.nome || id
        tipo = 'fundo'
      } else {
        const tick = await api.validarTicker(id)
        nome = tick.nome || id
        tipo = 'acao'
      }
      setAtivos((prev) => [...prev, { identificador: id, nome, tipo, classe, duration: '', min_lote: '' }])
      setNovoId('')
    } catch (e) { setAddErro(e.message) }
    finally { setAddLoading(false) }
  }

  function removerAtivo(id) { setAtivos((prev) => prev.filter((a) => a.identificador !== id)) }

  async function otimizar() {
    if (ativos.length < 2) { setErro('Adicione ao menos 2 ativos'); return }
    if (minPeso > 0 && minPeso * ativos.length > 100) {
      setErro(`Mín. ${minPeso}% × ${ativos.length} ativos = ${minPeso * ativos.length}% — impossível somar 100%. Reduza o mínimo.`)
      return
    }
    setLoading(true); setErro(null); setResultado(null)
    try {
      const ativosBody = ativos.map((a) => ({
        ...a,
        duration: usarDuration && a.duration !== '' ? Number(a.duration) : undefined,
        min_lote: usarMinValue && a.min_lote !== '' ? Number(a.min_lote) : undefined,
      }))
      const body = { classe, ativos: ativosBody, n_simulacoes: 5000 }
      if (period?.start) body.start = period.start
      if (period?.end) body.end = period.end
      if (minPeso > 0) body.min_peso = minPeso
      if (maxPeso > 0) body.max_peso = maxPeso
      if (usarDuration && targetDuration !== '') {
        body.target_duration = Number(targetDuration)
        body.duration_tolerancia = Number(durationTolerancia)
      }
      if (usarMinValue && maxPortfolioMin !== '') body.max_portfolio_min = Number(maxPortfolioMin)
      const data = await api.otimizarClasse(carteiraId, body)
      if (data?.error) { setErro(data.error); return }
      setResultado(data)
    } catch (e) { setErro(e.message) }
    finally { setLoading(false) }
  }

  const restricoesAtivas = (usarDuration && targetDuration !== '') || (usarMinValue && maxPortfolioMin !== '')

  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <div className="text-sm font-medium text-slate-300">Otimizador por Ativo</div>
        <p className="text-xs text-slate-500">
          Mantém os pesos das classes fixos e otimiza a distribuição interna dos ativos dentro de uma classe.
          Requer cotas sincronizadas para fundos e ações.
        </p>

        <div>
          <label className="text-xs text-slate-500 block mb-1">Classe de ativo</label>
          <select
            value={classe}
            onChange={(e) => setClasse(e.target.value)}
            className="bg-bg-tertiary border border-border rounded px-3 py-1.5 text-xs text-slate-200 w-full"
          >
            {Object.entries(LABELS_CLASSE_OT).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        <div>
          <div className="text-xs text-slate-500 mb-2">
            Ativos na simulação {loadingAtivos && <span className="text-slate-600">carregando...</span>}
          </div>
          {ativos.length === 0 && !loadingAtivos && (
            <p className="text-xs text-slate-600 italic">Nenhum ativo com identificador nesta classe.</p>
          )}
          <div className="space-y-1.5">
            {ativos.map((a) => (
              <div key={a.identificador} className="bg-surface-2 rounded px-3 py-2">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-200">{a.nome}</span>
                    <span className="text-[10px] text-slate-500 ml-2">{a.identificador}</span>
                  </div>
                  <button onClick={() => removerAtivo(a.identificador)} className="text-slate-600 hover:text-accent-red text-xs ml-2">✕</button>
                </div>
                {(usarDuration || usarMinValue) && (
                  <div className="flex flex-wrap gap-3 mt-2 pt-2 border-t border-border/30">
                    {usarDuration && (
                      <div className="flex items-center gap-1.5">
                        <label className="text-[10px] text-slate-500 whitespace-nowrap">Duration (anos)</label>
                        <input
                          type="number" min={0} step={0.1} value={a.duration}
                          onChange={(e) => atualizarAtivo(a.identificador, 'duration', e.target.value)}
                          placeholder="—"
                          className="w-16 bg-bg-tertiary border border-border rounded px-2 py-0.5 text-xs text-slate-200 focus:outline-none focus:border-accent-blue"
                        />
                      </div>
                    )}
                    {usarMinValue && (
                      <div className="flex items-center gap-1.5">
                        <label className="text-[10px] text-slate-500 whitespace-nowrap">Lote mín. (R$)</label>
                        <input
                          type="number" min={0} step={1} value={a.min_lote}
                          onChange={(e) => atualizarAtivo(a.identificador, 'min_lote', e.target.value)}
                          placeholder="—"
                          className="w-24 bg-bg-tertiary border border-border rounded px-2 py-0.5 text-xs text-slate-200 focus:outline-none focus:border-accent-blue"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs text-slate-500 mb-1">Adicionar ativo por CNPJ ou ticker</div>
          <div className="flex gap-2">
            <input
              value={novoId}
              onChange={(e) => setNovoId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && adicionarAtivo()}
              placeholder="Ex: 12.345.678/0001-90 ou IVVB11"
              className="flex-1 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-accent-blue"
            />
            <button onClick={adicionarAtivo} disabled={addLoading} className="btn-primary text-xs px-3">
              {addLoading ? '...' : 'Adicionar'}
            </button>
          </div>
          {addErro && <div className="mt-1 text-xs text-accent-red">{addErro}</div>}
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 whitespace-nowrap">Mín. por ativo (%)</label>
            <input
              type="number" min={0} max={100} step={1} value={minPeso}
              onChange={(e) => setMinPeso(Math.max(0, Number(e.target.value)))}
              className="w-16 bg-bg-tertiary border border-border rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-accent-blue"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 whitespace-nowrap">Máx. por ativo (%)</label>
            <input
              type="number" min={0} max={100} step={1} value={maxPeso}
              onChange={(e) => setMaxPeso(Math.max(0, Number(e.target.value)))}
              className="w-16 bg-bg-tertiary border border-border rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-accent-blue"
            />
          </div>
          <span className="text-[10px] text-slate-600">0 = sem restrição</span>
        </div>

        <div className="border-t border-border pt-3 space-y-3">
          <div className="text-[10px] text-slate-600 uppercase tracking-wider">Restrições avançadas</div>

          <div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={usarDuration} onChange={(e) => setUsarDuration(e.target.checked)}
                className="w-3.5 h-3.5 accent-accent-blue" />
              <span className="text-xs text-slate-300">Restrição de Duration</span>
            </label>
            {usarDuration && (
              <div className="mt-2 ml-5 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-slate-500 whitespace-nowrap">Duration alvo (anos)</label>
                  <input
                    type="number" min={0} step={0.1} value={targetDuration}
                    onChange={(e) => setTargetDuration(e.target.value)}
                    placeholder="ex: 3.5"
                    className="w-20 bg-bg-tertiary border border-border rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-accent-blue"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-slate-500 whitespace-nowrap">Tolerância ±</label>
                  <input
                    type="number" min={0} step={0.1} value={durationTolerancia}
                    onChange={(e) => setDurationTolerancia(Math.max(0, Number(e.target.value)))}
                    className="w-16 bg-bg-tertiary border border-border rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-accent-blue"
                  />
                  <span className="text-[10px] text-slate-600">anos</span>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={usarMinValue} onChange={(e) => setUsarMinValue(e.target.checked)}
                className="w-3.5 h-3.5 accent-accent-blue" />
              <span className="text-xs text-slate-300">Restrição de Valor Mínimo da Carteira</span>
            </label>
            {usarMinValue && (
              <div className="mt-2 ml-5 flex items-center gap-1.5">
                <label className="text-xs text-slate-500 whitespace-nowrap">Valor máximo (R$)</label>
                <input
                  type="number" min={0} step={1000} value={maxPortfolioMin}
                  onChange={(e) => setMaxPortfolioMin(e.target.value)}
                  placeholder="ex: 50000"
                  className="w-28 bg-bg-tertiary border border-border rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-accent-blue"
                />
              </div>
            )}
          </div>
        </div>

        <button onClick={otimizar} disabled={loading || ativos.length < 2} className="btn-primary flex items-center gap-2">
          {loading ? <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Otimizando...</> : 'Otimizar Ativos'}
        </button>
        {erro && <div className="text-xs text-accent-red bg-red-900/20 border border-red-800/50 rounded px-3 py-2">{erro}</div>}
      </div>

      {resultado && (
        <>
          {resultado.ativos?.some((a) => !a.valido) && (
            <div className="card">
              <div className="text-xs text-slate-400 mb-2">Status dos dados por ativo</div>
              {resultado.ativos.map((a) => (
                <div key={a.identificador} className="flex items-center justify-between text-xs py-1 border-b border-border/20 last:border-0">
                  <span className={a.valido ? 'text-slate-300' : 'text-slate-500'}>{a.nome}</span>
                  <span className={a.valido ? 'text-accent-green' : 'text-accent-red'}>
                    {a.valido ? `${a.n_meses_com_dados} meses` : 'sem dados — sincronize cotas'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {restricoesAtivas && resultado.n_simulacoes_total != null && (
            <div className="card border border-border/50">
              <div className="text-xs text-slate-400">
                Restrições aplicadas: <span className="text-slate-200 font-mono">{resultado.n_simulacoes_validas?.toLocaleString()}</span> de <span className="font-mono">{resultado.n_simulacoes_total?.toLocaleString()}</span> simulações atenderam às restrições
                {resultado.n_simulacoes_validas / resultado.n_simulacoes_total < 0.1 && (
                  <span className="text-amber-400 ml-2">— amostra pequena, considere ampliar as tolerâncias</span>
                )}
              </div>
            </div>
          )}

          <div className="card">
            <div className="text-sm font-medium text-slate-300 mb-1">
              Fronteira Eficiente — {resultado.label_classe}
            </div>
            <p className="text-xs text-slate-500 mb-4">
              {restricoesAtivas ? 'Portfólios dentro das restrições definidas.' : 'Distribuição ótima dos ativos dentro da classe.'}
            </p>
            <FronteiraChart resultado={resultado} />
          </div>

          <div className={`grid gap-4 ${resultado.paridade_risco ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <PesosAtivoCard titulo="Máximo Sharpe" subtitulo={`Sharpe: ${Number.isFinite(resultado.max_sharpe.sharpe) ? resultado.max_sharpe.sharpe.toFixed(2) : '—'}`} cor={CORES_OTIMIZADOR.max_sharpe} portfolio={resultado.max_sharpe} ativos={resultado.ativos.filter((a) => a.valido)} />
            <PesosAtivoCard titulo="Mínima Volatilidade" subtitulo={`Vol: ${fmtPct(resultado.min_vol.vol)}`} cor={CORES_OTIMIZADOR.min_vol} portfolio={resultado.min_vol} ativos={resultado.ativos.filter((a) => a.valido)} />
            {resultado.paridade_risco && (
              <PesosAtivoCard
                titulo="Paridade de Risco"
                subtitulo={resultado.paridade_risco.viola_restricoes ? '⚠ não atende às restrições' : `Vol: ${fmtPct(resultado.paridade_risco.vol)}`}
                cor={resultado.paridade_risco.viola_restricoes ? '#94a3b8' : CORES_OTIMIZADOR.paridade_risco}
                portfolio={resultado.paridade_risco}
                ativos={resultado.ativos.filter((a) => a.valido)}
              />
            )}
          </div>

          <div className="card overflow-x-auto">
            <div className="text-sm font-medium text-slate-300 mb-4">Comparação de Portfólios</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-slate-500">
                  <th className="text-left pb-2 font-medium">Métrica</th>
                  <th className="text-right pb-2 font-medium" style={{ color: CORES_OTIMIZADOR.atual }}>Atual</th>
                  <th className="text-right pb-2 font-medium" style={{ color: CORES_OTIMIZADOR.max_sharpe }}>Máx. Sharpe</th>
                  <th className="text-right pb-2 font-medium" style={{ color: CORES_OTIMIZADOR.min_vol }}>Mín. Vol.</th>
                  {resultado.paridade_risco && <th className="text-right pb-2 font-medium" style={{ color: resultado.paridade_risco.viola_restricoes ? '#94a3b8' : CORES_OTIMIZADOR.paridade_risco }}>Par. Risco{resultado.paridade_risco.viola_restricoes ? ' ⚠' : ''}</th>}
                </tr>
              </thead>
              <tbody>
                {[
                  { label: 'CAGR esperado', key: 'cagr', fmt: fmtPct },
                  { label: 'Volatilidade', key: 'vol', fmt: fmtPct },
                  { label: 'Sharpe', key: 'sharpe', fmt: (v) => v?.toFixed(2) },
                ].map(({ label, key, fmt }) => (
                  <tr key={key} className="border-b border-border/30">
                    <td className="py-2 text-slate-400">{label}</td>
                    <td className="py-2 text-right font-mono text-slate-300">{fmt(resultado.atual?.[key]) ?? '—'}</td>
                    <td className="py-2 text-right font-mono text-accent-green">{fmt(resultado.max_sharpe[key]) ?? '—'}</td>
                    <td className="py-2 text-right font-mono text-accent-yellow">{fmt(resultado.min_vol[key]) ?? '—'}</td>
                    {resultado.paridade_risco && <td className="py-2 text-right font-mono" style={{ color: resultado.paridade_risco.viola_restricoes ? '#94a3b8' : CORES_OTIMIZADOR.paridade_risco }}>{fmt(resultado.paridade_risco[key]) ?? '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 text-[10px] text-slate-600">
              Baseado em {resultado.n_meses} meses · {resultado.n_simulacoes?.toLocaleString()} simulações
            </div>
          </div>
        </>
      )}
    </div>
  )
}

