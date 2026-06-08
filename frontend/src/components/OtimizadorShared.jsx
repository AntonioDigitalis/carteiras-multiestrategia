import { useState } from 'react'
import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts'

export const CORES_OTIMIZADOR = { max_sharpe: '#22c55e', min_vol: '#f59e0b', paridade_risco: '#a855f7', atual: '#3b82f6' }

export const LABELS_CLASSE_OT = {
  pos_fixado: 'Pós-fixado', inflacao: 'Inflação', prefixado: 'Pré-fixado',
  rf_global: 'RF Global', multimercado: 'Multimercado', rv_brasil: 'RV Brasil',
  rv_global: 'RV Global', fundos_listados: 'Fundos Listados', alternativos: 'Alternativos',
}

export function fmtPct(v) {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`
}

export function FronteiraChart({ resultado }) {
  const { fronteira, max_sharpe, min_vol, atual } = resultado
  const [selected, setSelected] = useState(null)

  const passo = Math.max(1, Math.floor(fronteira.length / 800))
  const pontos = fronteira.filter((_, i) => i % passo === 0).map((p) => ({
    vol: +(p.vol * 100).toFixed(3),
    cagr: +(p.cagr * 100).toFixed(3),
    sharpe: +p.sharpe.toFixed(3),
    weights: p.weights,
  }))

  const destaques = [
    ...(atual ? [{ label: '● Atual', vol: +(atual.vol * 100).toFixed(3), cagr: +(atual.cagr * 100).toFixed(3), fill: CORES_OTIMIZADOR.atual }] : []),
    { label: '● Máx. Sharpe', vol: +(max_sharpe.vol * 100).toFixed(3), cagr: +(max_sharpe.cagr * 100).toFixed(3), fill: CORES_OTIMIZADOR.max_sharpe },
    { label: '● Mín. Vol.', vol: +(min_vol.vol * 100).toFixed(3), cagr: +(min_vol.cagr * 100).toFixed(3), fill: CORES_OTIMIZADOR.min_vol },
    ...(resultado.paridade_risco ? [{ label: '● Par. Risco', vol: +(resultado.paridade_risco.vol * 100).toFixed(3), cagr: +(resultado.paridade_risco.cagr * 100).toFixed(3), fill: CORES_OTIMIZADOR.paridade_risco }] : []),
  ]

  const isClasseMode = !!resultado.classes
  const composicaoItems = isClasseMode
    ? resultado.classes.map((cls, i) => ({ key: cls, label: resultado.labels[i] }))
    : (resultado.ativos?.filter((a) => a.valido) ?? []).map((a) => ({ key: a.identificador, label: a.nome }))

  return (
    <div>
      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3e" />
          <XAxis
            dataKey="vol"
            name="Volatilidade"
            unit="%"
            type="number"
            domain={['auto', 'auto']}
            tick={{ fill: '#64748b', fontSize: 11 }}
            label={{ value: 'Volatilidade (%)', position: 'insideBottom', offset: -5, fill: '#64748b', fontSize: 11 }}
          />
          <YAxis
            dataKey="cagr"
            name="CAGR"
            unit="%"
            type="number"
            domain={['auto', 'auto']}
            tick={{ fill: '#64748b', fontSize: 11 }}
            label={{ value: 'CAGR (%)', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11 }}
          />
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            contentStyle={{ background: '#1e2132', border: '1px solid #2a2d3e', borderRadius: 6, fontSize: 11 }}
            formatter={(v, name) => [`${v}%`, name]}
          />
          <Scatter
            data={pontos}
            fill="#3b82f6"
            fillOpacity={0.25}
            name="Portfólios"
            onClick={(data) => setSelected(data)}
            style={{ cursor: 'pointer' }}
          />
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

      {selected?.weights && (
        <div className="mt-3 p-3 bg-[#1a1d2e] rounded-lg border border-[#2a2d3e]">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-medium text-slate-300">Composição do portfólio selecionado</div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500">
                CAGR <span className="text-slate-200 font-mono">{selected.cagr}%</span>
                <span className="mx-1.5">·</span>
                Vol <span className="text-slate-200 font-mono">{selected.vol}%</span>
                <span className="mx-1.5">·</span>
                Sharpe <span className="text-slate-200 font-mono">{selected.sharpe}</span>
              </span>
              <button
                onClick={() => setSelected(null)}
                className="text-slate-500 hover:text-slate-300 text-xs leading-none"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            {composicaoItems.map(({ key, label }) => {
              const w = (selected.weights[key] ?? 0) * 100
              return (
                <div key={key}>
                  <div className="flex justify-between text-xs mb-0.5">
                    <span className="text-slate-400 truncate max-w-[70%]" title={label}>{label}</span>
                    <span className="text-slate-200 font-mono">{w.toFixed(1)}%</span>
                  </div>
                  <div className="h-1 bg-[#2a2d3e] rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-blue-500" style={{ width: `${w}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export function PesosCard({ titulo, subtitulo, cor, portfolio, classes, labels }) {
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
                <div className="h-full rounded-full" style={{ width: `${peso * 100}%`, background: cor, opacity: 0.8 }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function PesosAtivoCard({ titulo, subtitulo, cor, portfolio, ativos }) {
  return (
    <div className="card">
      <div className="text-sm font-medium mb-0.5" style={{ color: cor }}>{titulo}</div>
      <div className="text-xs text-slate-500 mb-3">{subtitulo}</div>
      <div className="space-y-2">
        {ativos.map((a) => {
          if (!a.identificador) return null
          const w = (portfolio.weights[a.identificador] ?? 0) * 100
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
