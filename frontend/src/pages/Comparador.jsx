import { useState } from 'react'
import { useCarteiras } from '../hooks/useCarteiras'
import PeriodSelector, { resolvePeriod } from '../components/ui/PeriodSelector'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import { clsx } from 'clsx'
import { api } from '../services/api'
import { useEffect } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, Legend
} from 'recharts'

const CORES = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4']
const defaultPeriod = { preset: '12M', ...resolvePeriod('12M') }

export default function Comparador() {
  const { carteiras, loading } = useCarteiras()
  const [selecionadas, setSelecionadas] = useState([])
  const [period, setPeriod] = useState(defaultPeriod)
  const [dados, setDados] = useState(null)
  const [loadingDados, setLoadingDados] = useState(false)

  function toggleCarteira(id) {
    setSelecionadas((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
    setDados(null)
  }

  async function comparar() {
    if (selecionadas.length < 2) return
    setLoadingDados(true)
    try {
      const params = {}
      if (period?.start) params.start = period.start
      if (period?.end) params.end = period.end

      const resultados = await Promise.all(
        selecionadas.map((id) =>
          api.getMetricas(id, params).then((m) => ({
            id,
            nome: carteiras.find((c) => c.id === id)?.nome ?? `Carteira ${id}`,
            ...m,
          }))
        )
      )
      setDados(resultados)
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingDados(false)
    }
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Comparador de Carteiras</h1>
          <p className="text-xs text-slate-500 mt-0.5">Compare métricas lado a lado</p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Seleção de carteiras */}
      <div className="card">
        <div className="text-sm font-medium text-slate-300 mb-3">
          Selecione 2 ou mais carteiras
        </div>
        <div className="flex flex-wrap gap-2">
          {carteiras.map((c, i) => {
            const sel = selecionadas.includes(c.id)
            return (
              <button
                key={c.id}
                onClick={() => toggleCarteira(c.id)}
                className={clsx(
                  'text-xs px-3 py-1.5 rounded-md border transition-colors',
                  sel
                    ? 'border-accent-blue bg-accent-blue/15 text-accent-blue'
                    : 'border-border text-slate-400 hover:text-slate-200 hover:border-border-light'
                )}
              >
                {sel && (
                  <span
                    className="inline-block w-2 h-2 rounded-full mr-1.5"
                    style={{ background: CORES[selecionadas.indexOf(c.id)] }}
                  />
                )}
                {c.nome}
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={comparar}
            disabled={selecionadas.length < 2 || loadingDados}
            className="btn-primary"
          >
            {loadingDados ? 'Calculando...' : 'Comparar'}
          </button>
          {selecionadas.length > 0 && (
            <span className="text-xs text-slate-500">{selecionadas.length} carteira(s) selecionada(s)</span>
          )}
        </div>
      </div>

      {loadingDados && <LoadingSpinner text="Calculando..." />}

      {dados && !loadingDados && <ResultadoComparacao dados={dados} />}
    </div>
  )
}

function ResultadoComparacao({ dados }) {
  const metricas = [
    { key: 'retorno_acumulado', label: 'Retorno Acumulado', fmt: fmtPct, bigger: true },
    { key: 'cagr', label: 'CAGR', fmt: fmtPct, bigger: true },
    { key: 'volatilidade', label: 'Volatilidade', fmt: fmtPct, bigger: false },
    { key: 'sharpe', label: 'Sharpe', fmt: (v) => v?.toFixed(2), bigger: true },
    { key: 'sortino', label: 'Sortino', fmt: (v) => v?.toFixed(2), bigger: true },
    { key: 'max_drawdown', label: 'Max Drawdown', fmt: fmtPct, bigger: false },
    { key: 'melhor_mes', label: 'Melhor Mês', fmt: fmtPct, bigger: true },
    { key: 'pior_mes', label: 'Pior Mês', fmt: fmtPct, bigger: true },
    { key: 'pct_meses_positivos', label: '% Meses Positivos', fmt: (v) => v != null ? `${(v * 100).toFixed(0)}%` : '—', bigger: true },
  ]

  // Montar série temporal combinada
  const serieMap = {}
  dados.forEach((d, i) => {
    (d.serie_retorno || []).forEach(({ data, retorno_acumulado }) => {
      if (!serieMap[data]) serieMap[data] = { data }
      serieMap[data][d.nome] = retorno_acumulado
    })
  })
  const serie = Object.values(serieMap).sort((a, b) => a.data.localeCompare(b.data))

  return (
    <div className="space-y-6">
      {/* Gráfico */}
      {serie.length > 0 && (
        <div className="card">
          <div className="text-sm font-medium text-slate-300 mb-4">Retorno Acumulado</div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={serie}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3e" />
              <XAxis dataKey="data" tick={{ fill: '#64748b', fontSize: 11 }} />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 11 }}
                tickFormatter={(v) => `${(v * 100).toFixed(1)}%`}
              />
              <Tooltip
                contentStyle={{ background: '#1e2132', border: '1px solid #2a2d3e', borderRadius: 6 }}
                formatter={(v) => [`${(v * 100).toFixed(2)}%`, '']}
              />
              <Legend />
              {dados.map((d, i) => (
                <Line
                  key={d.id}
                  type="monotone"
                  dataKey={d.nome}
                  stroke={CORES[i]}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Tabela de métricas */}
      <div className="card overflow-x-auto">
        <div className="text-sm font-medium text-slate-300 mb-4">Métricas Comparadas</div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left pb-2 font-medium text-slate-500 pr-4">Métrica</th>
              {dados.map((d, i) => (
                <th key={d.id} className="text-right pb-2 font-medium" style={{ color: CORES[i] }}>
                  {d.nome}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metricas.map(({ key, label, fmt, bigger }) => {
              const values = dados.map((d) => d[key])
              const best = bigger
                ? Math.max(...values.filter((v) => v != null))
                : Math.min(...values.filter((v) => v != null))

              return (
                <tr key={key} className="border-b border-border/30">
                  <td className="py-2 text-slate-400 pr-4">{label}</td>
                  {dados.map((d, i) => {
                    const v = d[key]
                    const isBest = v === best && v != null
                    return (
                      <td
                        key={d.id}
                        className={clsx(
                          'py-2 text-right font-mono',
                          isBest ? 'text-accent-green font-semibold' : 'text-slate-300'
                        )}
                      >
                        {fmt(v) ?? '—'}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function fmtPct(v) {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`
}
