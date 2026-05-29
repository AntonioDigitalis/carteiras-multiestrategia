import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { useCarteira, useMetricas } from '../hooks/useCarteiras'
import PeriodSelector, { resolvePeriod } from '../components/ui/PeriodSelector'
import { MetricCard, MetricRow } from '../components/ui/MetricCard'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import { api } from '../services/api'
import { clsx } from 'clsx'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, Legend, AreaChart, Area,
  ReferenceLine, ScatterChart, Scatter,
} from 'recharts'
import { format } from 'date-fns'

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
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="card space-y-0.5">
        <div className="text-sm font-medium text-slate-300 mb-3">Métricas de Risco</div>
        <MetricRow label="Volatilidade anualizada" value={fmtPct(m.volatilidade)}
          tooltip="Desvio padrão dos retornos mensais, anualizado (× √12). Mede a dispersão dos resultados em torno da média — quanto maior, mais imprevisível a rentabilidade." />
        <MetricRow label="Max Drawdown" value={fmtPct(m.max_drawdown)} highlight={-1}
          tooltip="Maior queda percentual do pico ao vale registrada no período. Mede o pior cenário de perda que um investidor poderia ter sofrido." />
        <MetricRow label="Duração MDD (meses)" value={m.mdd_duracao ?? '—'}
          tooltip="Número de meses desde o pico até o fundo do maior drawdown. Indica por quanto tempo a carteira ficou em queda contínua." />
        <MetricRow label="Recuperação (meses)" value={m.mdd_recuperacao ?? 'N/A'}
          tooltip="Número de meses para recuperar o patamar anterior ao maior drawdown. Não disponível se a recuperação ainda não ocorreu no período." />
        <MetricRow label="Sharpe" value={m.sharpe?.toFixed(2)} highlight={m.sharpe}
          tooltip="Retorno excedente ao CDI dividido pela volatilidade total (positiva e negativa). Mede eficiência por unidade de risco total. Acima de 0 = melhor que CDI ajustado ao risco." />
        <MetricRow label="Sortino" value={m.sortino?.toFixed(2)} highlight={m.sortino}
          tooltip="Como o Sharpe, mas usa apenas a volatilidade negativa (downside deviation). Penaliza somente as oscilações para baixo, ignorando a volatilidade positiva." />
        <MetricRow label="Calmar" value={m.calmar?.toFixed(2)} highlight={m.calmar}
          tooltip="CAGR dividido pelo módulo do Max Drawdown. Responde: quantos % de retorno anual a carteira entrega para cada % de queda máxima suportada." />
      </div>
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
              <Line type="monotone" dataKey="ativo_acumulado" stroke="#3b82f6" strokeWidth={2} dot={false} name="Carteira Ativa" />
              <Line type="monotone" dataKey="passivo_acumulado" stroke="#64748b" strokeWidth={2} strokeDasharray="4 2" dot={false} name="Carteira Passiva" />
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

const CORES_OTIMIZADOR = { max_sharpe: '#22c55e', min_vol: '#f59e0b', atual: '#3b82f6' }

const LABELS_CLASSE_OT = {
  pos_fixado: 'Pós-fixado', inflacao: 'Inflação', prefixado: 'Pré-fixado',
  rf_global: 'RF Global', multimercado: 'Multimercado', rv_brasil: 'RV Brasil',
  rv_global: 'RV Global', fundos_listados: 'Fundos Listados', alternativos: 'Alternativos',
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

  async function otimizar() {
    setLoading(true); setErro(null); setResultado(null)
    try {
      const params = {}
      if (period?.start) params.start = period.start
      if (period?.end) params.end = period.end
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
          <div className="grid grid-cols-2 gap-4">
            <PesosCard titulo="Máximo Sharpe" subtitulo={`Sharpe: ${resultado.max_sharpe.sharpe.toFixed(2)}`} cor={CORES_OTIMIZADOR.max_sharpe} portfolio={resultado.max_sharpe} classes={resultado.classes} labels={resultado.labels} />
            <PesosCard titulo="Mínima Volatilidade" subtitulo={`Vol: ${fmtPct(resultado.min_vol.vol)}`} cor={CORES_OTIMIZADOR.min_vol} portfolio={resultado.min_vol} classes={resultado.classes} labels={resultado.labels} />
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

  async function carregarAtivos(cls) {
    setLoadingAtivos(true)
    setResultado(null)
    try {
      const data = await api.getAtivosClasse(carteiraId, cls)
      setAtivos(data)
    } catch (e) { /* silencioso */ }
    finally { setLoadingAtivos(false) }
  }

  useEffect(() => { carregarAtivos(classe) }, [classe, carteiraId])

  async function adicionarAtivo() {
    const id = novoId.trim()
    if (!id) return
    if (ativos.some((a) => a.identificador === id)) { setAddErro('Ativo já está na lista'); return }
    setAddLoading(true); setAddErro(null)
    try {
      const isCNPJ = id.includes('/')
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
      setAtivos((prev) => [...prev, { identificador: id, nome, tipo, classe }])
      setNovoId('')
    } catch (e) { setAddErro(e.message) }
    finally { setAddLoading(false) }
  }

  function removerAtivo(id) { setAtivos((prev) => prev.filter((a) => a.identificador !== id)) }

  async function otimizar() {
    if (ativos.length < 2) { setErro('Adicione ao menos 2 ativos'); return }
    setLoading(true); setErro(null); setResultado(null)
    try {
      const body = { classe, ativos, n_simulacoes: 5000 }
      if (period?.start) body.start = period.start
      if (period?.end) body.end = period.end
      const data = await api.otimizarClasse(carteiraId, body)
      if (data?.error) { setErro(data.error); return }
      setResultado(data)
    } catch (e) { setErro(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <div className="text-sm font-medium text-slate-300">Otimizador por Ativo</div>
        <p className="text-xs text-slate-500">
          Mantém os pesos das classes fixos e otimiza a distribuição interna dos ativos dentro de uma classe.
          Requer cotas sincronizadas para fundos e ações.
        </p>

        {/* Seletor de classe */}
        <div>
          <label className="text-xs text-slate-500 block mb-1">Classe de ativo</label>
          <select
            value={classe}
            onChange={(e) => setClasse(e.target.value)}
            className="bg-surface border border-border rounded px-3 py-1.5 text-xs text-slate-200 w-full"
          >
            {Object.entries(LABELS_CLASSE_OT).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        {/* Lista de ativos */}
        <div>
          <div className="text-xs text-slate-500 mb-2">
            Ativos na simulação {loadingAtivos && <span className="text-slate-600">carregando...</span>}
          </div>
          {ativos.length === 0 && !loadingAtivos && (
            <p className="text-xs text-slate-600 italic">Nenhum ativo com identificador nesta classe.</p>
          )}
          <div className="space-y-1">
            {ativos.map((a) => (
              <div key={a.identificador} className="flex items-center justify-between bg-surface-2 rounded px-3 py-1.5">
                <div>
                  <span className="text-xs text-slate-200">{a.nome}</span>
                  <span className="text-[10px] text-slate-500 ml-2">{a.identificador}</span>
                </div>
                <button onClick={() => removerAtivo(a.identificador)} className="text-slate-600 hover:text-accent-red text-xs ml-2">✕</button>
              </div>
            ))}
          </div>
        </div>

        {/* Adicionar ativo */}
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

        <button onClick={otimizar} disabled={loading || ativos.length < 2} className="btn-primary flex items-center gap-2">
          {loading ? <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Otimizando...</> : 'Otimizar Ativos'}
        </button>
        {erro && <div className="text-xs text-accent-red bg-red-900/20 border border-red-800/50 rounded px-3 py-2">{erro}</div>}
      </div>

      {resultado && (
        <>
          {/* Status dos ativos */}
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

          <div className="card">
            <div className="text-sm font-medium text-slate-300 mb-1">
              Fronteira Eficiente — {resultado.label_classe}
            </div>
            <p className="text-xs text-slate-500 mb-4">Distribuição ótima dos ativos dentro da classe.</p>
            <FronteiraChart resultado={resultado} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <PesosAtivoCard titulo="Máximo Sharpe" subtitulo={`Sharpe: ${resultado.max_sharpe.sharpe.toFixed(2)}`} cor={CORES_OTIMIZADOR.max_sharpe} portfolio={resultado.max_sharpe} ativos={resultado.ativos.filter((a) => a.valido)} />
            <PesosAtivoCard titulo="Mínima Volatilidade" subtitulo={`Vol: ${fmtPct(resultado.min_vol.vol)}`} cor={CORES_OTIMIZADOR.min_vol} portfolio={resultado.min_vol} ativos={resultado.ativos.filter((a) => a.valido)} />
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

function PesosAtivoCard({ titulo, subtitulo, cor, portfolio, ativos }) {
  return (
    <div className="card">
      <div className="text-sm font-medium mb-0.5" style={{ color: cor }}>{titulo}</div>
      <div className="text-xs text-slate-500 mb-3">{subtitulo}</div>
      <div className="space-y-2">
        {ativos.map((a) => {
          const w = (portfolio.weights[a.identificador] || 0) * 100
          return (
            <div key={a.identificador}>
              <div className="flex justify-between text-xs mb-0.5">
                <span className="text-slate-400 truncate max-w-[70%]" title={a.nome}>{a.nome}</span>
                <span className="text-slate-200 font-mono">{w.toFixed(1)}%</span>
              </div>
              <div className="h-1 bg-surface-2 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${w}%`, backgroundColor: cor }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FronteiraChart({ resultado }) {
  const { fronteira, max_sharpe, min_vol, atual } = resultado

  // Amostrar pontos para performance (máx 800 pontos no gráfico)
  const passo = Math.max(1, Math.floor(fronteira.length / 800))
  const pontos = fronteira.filter((_, i) => i % passo === 0).map((p) => ({
    vol: +(p.vol * 100).toFixed(3),
    cagr: +(p.cagr * 100).toFixed(3),
    sharpe: +p.sharpe.toFixed(3),
  }))

  const destaques = [
    { label: '● Atual', vol: +(atual.vol * 100).toFixed(3), cagr: +(atual.cagr * 100).toFixed(3), fill: CORES_OTIMIZADOR.atual },
    { label: '● Máx. Sharpe', vol: +(max_sharpe.vol * 100).toFixed(3), cagr: +(max_sharpe.cagr * 100).toFixed(3), fill: CORES_OTIMIZADOR.max_sharpe },
    { label: '● Mín. Vol.', vol: +(min_vol.vol * 100).toFixed(3), cagr: +(min_vol.cagr * 100).toFixed(3), fill: CORES_OTIMIZADOR.min_vol },
  ]

  return (
    <div>
      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3e" />
          <XAxis
            dataKey="vol"
            name="Volatilidade"
            unit="%"
            tick={{ fill: '#64748b', fontSize: 11 }}
            label={{ value: 'Volatilidade (%)', position: 'insideBottom', offset: -5, fill: '#64748b', fontSize: 11 }}
          />
          <YAxis
            dataKey="cagr"
            name="CAGR"
            unit="%"
            tick={{ fill: '#64748b', fontSize: 11 }}
            label={{ value: 'CAGR (%)', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11 }}
          />
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            contentStyle={{ background: '#1e2132', border: '1px solid #2a2d3e', borderRadius: 6, fontSize: 11 }}
            formatter={(v, name) => [`${v}%`, name]}
          />
          <Scatter data={pontos} fill="#3b82f6" fillOpacity={0.25} name="Portfólios" />
          {destaques.map((d) => (
            <Scatter key={d.label} data={[d]} fill={d.fill} name={d.label} r={6} />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
      <div className="flex gap-4 mt-2 justify-center">
        {destaques.map((d) => (
          <div key={d.label} className="flex items-center gap-1.5 text-xs">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: d.fill }} />
            <span className="text-slate-400">{d.label.replace('● ', '')}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PesosCard({ titulo, subtitulo, cor, portfolio, classes, labels }) {
  const total = classes.reduce((s, cls) => s + (portfolio.weights[cls] ?? 0), 0)
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold" style={{ color: cor }}>{titulo}</div>
          <div className="text-xs text-slate-500">{subtitulo}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">CAGR</div>
          <div className="text-sm font-mono font-semibold text-slate-200">{fmtPct(portfolio.cagr)}</div>
        </div>
      </div>
      <div className="space-y-2">
        {classes.map((cls, i) => {
          const peso = (portfolio.weights[cls] ?? 0)
          return (
            <div key={cls}>
              <div className="flex justify-between text-xs mb-0.5">
                <span className="text-slate-400">{labels[i]}</span>
                <span className="font-mono text-slate-300">{(peso * 100).toFixed(1)}%</span>
              </div>
              <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${peso * 100}%`, background: cor, opacity: 0.8 }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function fmtPct(v) {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`
}
