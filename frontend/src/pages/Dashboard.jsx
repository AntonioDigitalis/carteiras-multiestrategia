import { useState } from 'react'
import { Link } from 'react-router-dom'
import { TrendingUp, TrendingDown, RefreshCw, AlertTriangle } from 'lucide-react'
import { useCarteiras } from '../hooks/useCarteiras'
import PeriodSelector, { resolvePeriod } from '../components/ui/PeriodSelector'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import { clsx } from 'clsx'
import { api } from '../services/api'
import { usePeriodMetrics } from '../hooks/usePeriodMetrics'

const defaultPeriod = { preset: '12M', ...resolvePeriod('12M') }

export default function Dashboard() {
  const { carteiras, loading: loadingCarteiras } = useCarteiras()
  const [period, setPeriod] = useState(defaultPeriod)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState(null)

  async function syncAll() {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const r = await api.syncTodas()
      setSyncMsg(`Dados atualizados: ${r.sincronizados} ativos`)
    } catch (e) {
      setSyncMsg(`Erro: ${e.message}`)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Dashboard Geral</h1>
          <p className="text-xs text-slate-500 mt-0.5">Visão consolidada de todas as carteiras</p>
        </div>
        <div className="flex items-center gap-3">
          <PeriodSelector value={period} onChange={setPeriod} />
          <button
            onClick={syncAll}
            disabled={syncing}
            className="btn-secondary flex items-center gap-2"
          >
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Sincronizando...' : 'Atualizar Dados'}
          </button>
        </div>
      </div>

      {syncMsg && (
        <div className="text-xs text-slate-400 bg-bg-secondary border border-border rounded px-3 py-2">
          {syncMsg}
        </div>
      )}

      {loadingCarteiras ? (
        <LoadingSpinner text="Carregando carteiras..." />
      ) : carteiras.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Perfis */}
          {groupByPerfil(carteiras).map((perfil) => (
            <PerfilGroup key={perfil.id} perfil={perfil} period={period} />
          ))}
        </>
      )}
    </div>
  )
}

function PerfilGroup({ perfil, period }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-blue inline-block" />
        {perfil.nome}
      </h2>
      <div className="grid grid-cols-2 gap-4">
        {perfil.carteiras.map((c) => (
          <CarteiraCard key={c.id} carteira={c} period={period} />
        ))}
      </div>
    </div>
  )
}

function CarteiraCard({ carteira, period }) {
  const { metricas, loading } = usePeriodMetrics(carteira.id, period)

  const retorno = metricas?.retorno_acumulado
  const sharpe = metricas?.sharpe
  const vol = metricas?.volatilidade

  return (
    <Link
      to={`/carteira/${carteira.id}`}
      className="card hover:border-accent-blue/40 transition-colors group block"
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-sm font-semibold text-slate-200 group-hover:text-white transition-colors">
            {carteira.nome}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">{carteira.tipo === 'B' ? 'Exclusiva · R$ 200k+' : 'Acessível'}</div>
        </div>
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-bg-tertiary text-slate-500">
          {carteira.tipo}
        </span>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-4 bg-bg-tertiary rounded animate-pulse" />
          ))}
        </div>
      ) : !metricas ? (
        <div className="text-xs text-slate-600 py-4 text-center">Sem dados no período</div>
      ) : (
        <div className="space-y-1">
          <MetricLine
            label="Retorno acumulado"
            value={fmtPct(retorno)}
            positive={retorno > 0}
            negative={retorno < 0}
          />
          <MetricLine
            label="vs CDI"
            value={metricas.retorno_vs_cdi_pct != null ? `${(metricas.retorno_vs_cdi_pct * 100).toFixed(1)}% CDI` : '—'}
            positive={metricas.retorno_vs_cdi_pct > 1}
            negative={metricas.retorno_vs_cdi_pct != null && metricas.retorno_vs_cdi_pct < 1}
          />
          <MetricLine label="Volatilidade" value={fmtPct(vol)} />
          <MetricLine
            label="Sharpe"
            value={sharpe != null ? sharpe.toFixed(2) : '—'}
            positive={sharpe > 0}
            negative={sharpe < 0}
          />
          <MetricLine
            label="Max Drawdown"
            value={fmtPct(metricas.max_drawdown)}
            negative={!!metricas.max_drawdown}
          />
        </div>
      )}
    </Link>
  )
}

function MetricLine({ label, value, positive, negative }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-slate-500">{label}</span>
      <span
        className={clsx(
          'text-xs font-mono',
          positive && 'text-accent-green',
          negative && 'text-accent-red',
          !positive && !negative && 'text-slate-400'
        )}
      >
        {value ?? '—'}
      </span>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <AlertTriangle size={32} className="text-slate-600 mb-3" />
      <div className="text-slate-300 font-medium mb-1">Nenhuma carteira configurada</div>
      <div className="text-slate-500 text-sm mb-4">
        Acesse Configurações para criar os perfis e carteiras.
      </div>
      <Link to="/configuracoes" className="btn-primary">
        Ir para Configurações
      </Link>
    </div>
  )
}

function groupByPerfil(carteiras) {
  const map = {}
  for (const c of carteiras) {
    if (!map[c.perfil_id]) {
      map[c.perfil_id] = { id: c.perfil_id, nome: c.perfil_nome, carteiras: [] }
    }
    map[c.perfil_id].carteiras.push(c)
  }
  return Object.values(map)
}

function fmtPct(v) {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`
}
