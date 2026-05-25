import { useState, useEffect } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle, Filter, RefreshCw, Download, Activity, Zap, TrendingDown, TrendingUp, DollarSign } from 'lucide-react'
import { api } from '../services/api'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import { clsx } from 'clsx'

export default function Auditoria() {
  const [tab, setTab] = useState('saude')
  const [alertas, setAlertas] = useState([])
  const [log, setLog] = useState([])
  const [saude, setSaude] = useState(null)
  const [eventos, setEventos] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('todos')
  const [filtroCarteira, setFiltroCarteira] = useState('todas')

  useEffect(() => {
    carregarDados()
  }, [])

  async function carregarDados() {
    setLoading(true)
    try {
      const [a, l, s, ev] = await Promise.all([
        api.getAlertas(),
        api.getLogCaptacao(),
        api.getSaude(),
        api.getEventos(),
      ])
      setAlertas(a)
      setLog(l)
      setSaude(s)
      setEventos(ev)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function revisarEvento(id) {
    await api.revisarEvento(id)
    setEventos((prev) => prev.map((e) => e.id === id ? { ...e, revisado: 1 } : e))
  }

  async function marcarAlerta(id, status) {
    await api.marcarAlerta(id, status)
    setAlertas((prev) => prev.map((a) => a.id === id ? { ...a, status } : a))
  }

  const carteirasDisponiveis = saude?.carteiras ?? []

  const alertasFiltrados = alertas.filter((a) => {
    if (filtro === 'ativos' && a.status !== 'ativo') return false
    if (filtro === 'revisados' && a.status !== 'revisado') return false
    if (filtroCarteira !== 'todas') {
      if (filtroCarteira === 'sem_carteira') return a.carteira_id == null
      if (String(a.carteira_id) !== filtroCarteira) return false
    }
    return true
  })

  const nAtivos = alertas.filter((a) => a.status === 'ativo').length
  const nWarning = alertas.filter((a) => a.tipo === 'warning' && a.status === 'ativo').length
  const nRevisados = alertas.filter((a) => a.status === 'revisado').length
  const nRecentes = log.filter((l) => isRecente(l.timestamp)).length
  const nEventos = eventos.filter((e) => !e.revisado).length

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Auditoria de Dados</h1>
          <p className="text-xs text-slate-500 mt-0.5">Saúde dos dados, alertas e log de captação</p>
        </div>
        <div className="flex items-center gap-3">
          {carteirasDisponiveis.length > 0 && (
            <select
              value={filtroCarteira}
              onChange={(e) => setFiltroCarteira(e.target.value)}
              className="input text-xs py-1 h-auto max-w-xs"
            >
              <option value="todas">Todas as carteiras</option>
              {carteirasDisponiveis.map((c) => (
                <option key={c.id} value={String(c.id)}>{c.perfil_nome} — {c.nome}</option>
              ))}
              <option value="sem_carteira">Sem carteira (macro)</option>
            </select>
          )}
          <button onClick={carregarDados} className="btn-secondary flex items-center gap-2">
            <RefreshCw size={13} />
            Recarregar
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Alertas Ativos', value: nAtivos, color: 'text-accent-red', icon: AlertCircle },
          { label: 'Alertas Amarelos', value: nWarning, color: 'text-accent-yellow', icon: AlertTriangle },
          { label: 'Revisados', value: nRevisados, color: 'text-accent-green', icon: CheckCircle },
          { label: 'Captações (24h)', value: nRecentes, color: 'text-accent-blue', icon: Filter },
          { label: 'Eventos Corporativos', value: nEventos, color: 'text-accent-yellow', icon: Zap },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="card flex items-center gap-3">
            <Icon size={20} className={color} />
            <div>
              <div className={clsx('text-2xl font-semibold font-mono', color)}>{value}</div>
              <div className="text-xs text-slate-500">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-6 border-b border-border">
        {[
          { key: 'saude', label: 'Saúde dos Dados' },
          { key: 'alertas', label: 'Alertas' },
          { key: 'eventos', label: `Eventos Corporativos${nEventos > 0 ? ` (${nEventos})` : ''}` },
          { key: 'log', label: 'Log de Captação' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx('pb-3 text-sm font-medium transition-colors', tab === key ? 'tab-active' : 'tab-inactive')}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : tab === 'saude' ? (
        <SaudeTab saude={saude} filtroCarteira={filtroCarteira} onRefresh={carregarDados} />
      ) : tab === 'alertas' ? (
        <AlertasTab
          alertas={alertasFiltrados}
          filtro={filtro} setFiltro={setFiltro}
          onMarcar={marcarAlerta}
        />
      ) : tab === 'eventos' ? (
        <EventosTab eventos={eventos} filtroCarteira={filtroCarteira} saude={saude} onRevisar={revisarEvento} />
      ) : (
        <LogTab log={log} saude={saude} filtroCarteira={filtroCarteira} />
      )}
    </div>
  )
}

// ── Saúde dos Dados ────────────────────────────────────────

function SaudeTab({ saude, filtroCarteira, onRefresh }) {
  const [fetchingMacro, setFetchingMacro] = useState(false)
  const [macroMsg, setMacroMsg] = useState(null)
  const [filtroTipo, setFiltroTipo] = useState('todos')

  if (!saude) return (
    <div className="card text-center py-12 text-slate-500 text-sm">Sem dados de saúde disponíveis.</div>
  )

  const { macro, produtos, meses } = saude
  const macroPendente = macro.some((m) => !m.cdi || !m.ipca)
  const produtosPorCarteira = filtroCarteira === 'todas'
    ? produtos
    : filtroCarteira === 'sem_carteira'
    ? produtos.filter((p) => !p.carteira_ids || p.carteira_ids.length === 0)
    : produtos.filter((p) => p.carteira_ids?.includes(Number(filtroCarteira)))

  const produtosFiltrados = filtroTipo === 'todos'
    ? produtosPorCarteira
    : filtroTipo === 'sem_dados'
    ? produtosPorCarteira.filter((p) => p.periodos.some((pe) => pe.status !== 'ok'))
    : produtosPorCarteira.filter((p) => p.tipo === filtroTipo)

  async function buscarMacro() {
    if (!meses.length) return
    setFetchingMacro(true)
    setMacroMsg(null)
    try {
      const inicio = meses[0] + '-01'
      const hoje = new Date().toISOString().split('T')[0]
      const r = await api.fetchMacro(inicio, hoje)
      setMacroMsg(`CDI: ${r.cdi_mensal} registros · IPCA: ${r.ipca} registros`)
      onRefresh()
    } catch (e) {
      setMacroMsg('Erro: ' + e.message)
    } finally {
      setFetchingMacro(false)
    }
  }

  return (
    <div className="space-y-6">

      {/* Macro */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-medium text-slate-300">Dados Macroeconômicos (CDI · IPCA)</div>
            <p className="text-xs text-slate-500 mt-0.5">Necessários para calcular retornos de renda fixa e benchmarks</p>
          </div>
          <div className="flex items-center gap-3">
            {macroMsg && <span className="text-xs text-slate-400">{macroMsg}</span>}
            <button
              onClick={buscarMacro}
              disabled={fetchingMacro}
              className="btn-primary text-xs flex items-center gap-1.5 py-1.5 px-3"
            >
              {fetchingMacro
                ? <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Buscando...</>
                : <><Download size={12} /> Buscar CDI · IPCA</>}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-border">
                <th className="text-left pb-2 font-medium">Mês</th>
                <th className="text-center pb-2 font-medium">CDI Mensal</th>
                <th className="text-center pb-2 font-medium">IPCA Mensal</th>
              </tr>
            </thead>
            <tbody>
              {macro.map((m) => (
                <tr key={m.mes} className="border-b border-border/30">
                  <td className="py-1.5 font-mono text-slate-400">{m.mes}</td>
                  <td className="py-1.5 text-center">
                    <StatusBadge ok={m.cdi} />
                  </td>
                  <td className="py-1.5 text-center">
                    <StatusBadge ok={m.ipca} />
                  </td>
                </tr>
              ))}
              {macro.length === 0 && (
                <tr><td colSpan={3} className="py-6 text-center text-slate-600">Nenhum mês cadastrado</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Produtos */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-medium text-slate-300">Cotas de Produtos por Período</div>
            <p className="text-xs text-slate-500 mt-0.5">Fundos e ações precisam de cotas históricas para calcular retorno</p>
          </div>
          <div className="flex gap-2">
            {[
              { key: 'todos', label: 'Todos' },
              { key: 'fundo', label: 'Fundos' },
              { key: 'acao', label: 'Ações' },
              { key: 'sem_dados', label: 'Faltando' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFiltroTipo(key)}
                className={clsx(
                  'text-xs px-2.5 py-1 rounded-md transition-colors',
                  filtroTipo === key ? 'bg-accent-blue text-white' : 'bg-bg-secondary text-slate-400 hover:text-slate-200'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-border">
                <th className="text-left pb-2 font-medium w-64">Ativo</th>
                <th className="text-left pb-2 font-medium">Tipo</th>
                {meses.map((mes) => (
                  <th key={mes} className="text-center pb-2 font-medium px-1">{mes.slice(2)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {produtosFiltrados.map((p, i) => (
                <tr key={i} className="border-b border-border/30 hover:bg-bg-tertiary/20">
                  <td className="py-1.5 pr-4">
                    <div className="text-slate-300 truncate max-w-[16rem]">{p.nome}</div>
                    {p.identificador && (
                      <div className="text-slate-600 font-mono text-[10px]">{p.identificador}</div>
                    )}
                  </td>
                  <td className="py-1.5 pr-4">
                    <span className={clsx(
                      'text-[10px] px-1.5 py-0.5 rounded font-medium',
                      p.tipo === 'fundo' ? 'bg-blue-900/30 text-blue-400' :
                      p.tipo === 'acao' ? 'bg-purple-900/30 text-purple-400' :
                      'bg-bg-tertiary text-slate-500'
                    )}>
                      {p.tipo}
                    </span>
                  </td>
                  {meses.map((mes) => {
                    const periodo = p.periodos.find((pe) => pe.mes === mes)
                    if (!periodo) return (
                      <td key={mes} className="py-1.5 text-center px-1">
                        <span className="text-slate-700">·</span>
                      </td>
                    )
                    return (
                      <td key={mes} className="py-1.5 text-center px-1">
                        <StatusBadge ok={periodo.status === 'ok'} label={periodo.n_cotas != null ? String(periodo.n_cotas) : periodo.nota} />
                      </td>
                    )
                  })}
                </tr>
              ))}
              {produtosFiltrados.length === 0 && (
                <tr><td colSpan={meses.length + 2} className="py-6 text-center text-slate-600">Nenhum produto</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center gap-4 text-[10px] text-slate-600">
          <span className="flex items-center gap-1"><span className="text-accent-green">●</span> Com cotas (n = quantidade de registros)</span>
          <span className="flex items-center gap-1"><span className="text-accent-red">●</span> Sem cotas — sincronize na Gestão de Dados</span>
          <span className="flex items-center gap-1"><span className="text-slate-600">·</span> Ativo não incluso neste período</span>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ ok, label }) {
  if (ok) {
    return (
      <span className="inline-flex items-center gap-1 text-accent-green text-[10px]">
        <CheckCircle size={10} />
        {label != null ? label : 'ok'}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-accent-red text-[10px]">
      <AlertCircle size={10} />
      {label != null ? label : '—'}
    </span>
  )
}

// ── Alertas ────────────────────────────────────────────────

function AlertasTab({ alertas, filtro, setFiltro, onMarcar }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {['todos', 'ativos', 'revisados'].map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={clsx(
              'text-xs px-3 py-1.5 rounded-md transition-colors capitalize',
              filtro === f ? 'bg-accent-blue text-white' : 'bg-bg-secondary text-slate-400 hover:text-slate-200'
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {alertas.length === 0 ? (
        <div className="card text-center py-12 text-slate-500 text-sm">
          <CheckCircle size={24} className="mx-auto mb-2 text-accent-green" />
          Nenhum alerta {filtro === 'todos' ? '' : filtro}
        </div>
      ) : (
        <div className="space-y-2">
          {alertas.map((a) => (
            <AlertaItem key={a.id} alerta={a} onMarcar={onMarcar} />
          ))}
        </div>
      )}
    </div>
  )
}

function AlertaItem({ alerta, onMarcar }) {
  const isCritical = alerta.tipo === 'error'
  const isWarning = alerta.tipo === 'warning'

  return (
    <div
      className={clsx(
        'flex items-start gap-3 p-3 rounded-lg border text-sm',
        isCritical ? 'bg-red-900/20 border-red-800/50' :
        isWarning ? 'bg-yellow-900/20 border-yellow-800/50' :
        'bg-bg-secondary border-border'
      )}
    >
      <div className="mt-0.5 flex-shrink-0">
        {isCritical && <AlertCircle size={15} className="text-accent-red" />}
        {isWarning && <AlertTriangle size={15} className="text-accent-yellow" />}
        {!isCritical && !isWarning && <CheckCircle size={15} className="text-accent-green" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-slate-200">{alerta.titulo}</span>
          <span className="text-[10px] text-slate-500">{alerta.ativo}</span>
          {alerta.carteira_nome && (
            <span className="text-[10px] bg-bg-tertiary text-slate-500 border border-border rounded px-1.5 py-0.5">
              {alerta.perfil_nome} — {alerta.carteira_nome}
            </span>
          )}
          <span className="text-[10px] text-slate-600">{alerta.data}</span>
        </div>
        <div className="text-xs text-slate-400 mt-0.5">{alerta.descricao}</div>
        {alerta.valor_bruto && (
          <div className="text-[10px] text-slate-600 mt-1 font-mono">
            Valor captado: {alerta.valor_bruto} · Usado no cálculo: {alerta.valor_usado}
          </div>
        )}
      </div>
      {alerta.status === 'ativo' && (
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => onMarcar(alerta.id, 'revisado')}
            className="text-[10px] px-2 py-1 rounded bg-green-900/30 text-accent-green hover:bg-green-900/50"
          >
            Revisado
          </button>
          <button
            onClick={() => onMarcar(alerta.id, 'ignorar')}
            className="text-[10px] px-2 py-1 rounded bg-bg-tertiary text-slate-400 hover:text-slate-200"
          >
            Ignorar
          </button>
        </div>
      )}
      {alerta.status !== 'ativo' && (
        <span className="text-[10px] text-slate-600 flex-shrink-0 capitalize">{alerta.status}</span>
      )}
    </div>
  )
}

// ── Eventos Corporativos ───────────────────────────────────

const TIPO_EVENTO = {
  split:         { label: 'Split',          icon: TrendingUp,   color: 'text-accent-blue',   bg: 'bg-blue-900/20 border-blue-800/40' },
  inplit:        { label: 'Inplit',         icon: TrendingDown, color: 'text-accent-yellow', bg: 'bg-yellow-900/20 border-yellow-800/40' },
  dividendo:     { label: 'Dividendo',      icon: DollarSign,   color: 'text-accent-green',  bg: 'bg-green-900/20 border-green-800/40' },
  ticker_change: { label: 'Mudança Ticker', icon: AlertTriangle, color: 'text-accent-yellow', bg: 'bg-yellow-900/20 border-yellow-800/40' },
  sem_dados:     { label: 'Sem Dados',      icon: AlertCircle,  color: 'text-accent-red',    bg: 'bg-red-900/20 border-red-800/40' },
}

function EventosTab({ eventos, filtroCarteira, saude, onRevisar }) {
  const [filtroTipo, setFiltroTipo] = useState('todos')

  const tickersDaCarteira = (() => {
    if (filtroCarteira === 'todas' || !saude) return null
    return new Set(
      saude.produtos
        .filter((p) => filtroCarteira === 'sem_carteira'
          ? !p.carteira_ids?.length
          : p.carteira_ids?.includes(Number(filtroCarteira)))
        .map((p) => p.identificador).filter(Boolean)
    )
  })()

  const eventosFiltrados = eventos.filter((e) => {
    if (filtroTipo !== 'todos' && e.tipo !== filtroTipo) return false
    if (tickersDaCarteira && !tickersDaCarteira.has(e.ticker)) return false
    return true
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {['todos', 'split', 'inplit', 'dividendo', 'ticker_change', 'sem_dados'].map((f) => (
          <button key={f} onClick={() => setFiltroTipo(f)}
            className={clsx('text-xs px-3 py-1.5 rounded-md transition-colors capitalize',
              filtroTipo === f ? 'bg-accent-blue text-white' : 'bg-bg-secondary text-slate-400 hover:text-slate-200')}>
            {TIPO_EVENTO[f]?.label ?? 'Todos'}
          </button>
        ))}
      </div>

      <div className="text-[10px] text-slate-500 bg-bg-secondary rounded-lg px-3 py-2 border border-border">
        <span className="text-accent-green font-medium">Retorno Total (TR)</span> — Para ações sincronizadas via Yahoo Finance, o cálculo já usa o preço ajustado (<span className="font-mono">adjClose</span>) que incorpora dividendos e splits automaticamente, equivalente ao retorno total com reinvestimento de proventos. Ações obtidas via B3 ou Alpha Vantage refletem apenas retorno de preço.
      </div>

      {eventosFiltrados.length === 0 ? (
        <div className="card text-center py-12 text-slate-500 text-sm">
          <Zap size={24} className="mx-auto mb-2 text-slate-600" />
          Nenhum evento corporativo registrado
        </div>
      ) : (
        <div className="space-y-2">
          {eventosFiltrados.map((ev) => {
            const meta = TIPO_EVENTO[ev.tipo] || TIPO_EVENTO.sem_dados
            const Icon = meta.icon
            return (
              <div key={ev.id} className={clsx('flex items-start gap-3 p-3 rounded-lg border text-sm', meta.bg, ev.revisado && 'opacity-50')}>
                <Icon size={15} className={clsx('mt-0.5 flex-shrink-0', meta.color)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={clsx('text-[10px] font-medium px-1.5 py-0.5 rounded', meta.color, 'bg-black/20')}>{meta.label}</span>
                    <span className="text-xs font-semibold text-slate-200 font-mono">{ev.ticker}</span>
                    <span className="text-[10px] text-slate-500">{ev.data}</span>
                    {ev.valor != null && (
                      <span className="text-[10px] text-slate-400 font-mono">
                        {ev.tipo === 'dividendo' ? `R$ ${ev.valor.toFixed(4)}` : `×${ev.valor.toFixed(4)}`}
                      </span>
                    )}
                  </div>
                  {ev.descricao && <div className="text-xs text-slate-400 mt-0.5">{ev.descricao}</div>}
                  <div className="text-[10px] text-slate-600 mt-0.5">Fonte: {ev.fonte}</div>
                </div>
                {!ev.revisado && (
                  <button onClick={() => onRevisar(ev.id)}
                    className="text-[10px] px-2 py-1 rounded bg-green-900/30 text-accent-green hover:bg-green-900/50 flex-shrink-0">
                    Revisado
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Log ────────────────────────────────────────────────────

function LogTab({ log, saude, filtroCarteira }) {
  const logFiltrado = (() => {
    if (filtroCarteira === 'todas') return log
    if (!saude) return log
    const produtosDaCarteira = saude.produtos
      .filter((p) => filtroCarteira === 'sem_carteira'
        ? !p.carteira_ids || p.carteira_ids.length === 0
        : p.carteira_ids?.includes(Number(filtroCarteira)))
      .map((p) => p.identificador)
      .filter(Boolean)
    return log.filter((l) => produtosDaCarteira.includes(l.ativo))
  })()
  return (
    <div className="card overflow-hidden">
      <div className="text-sm font-medium text-slate-300 mb-3">Log de Captação</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-border">
              <th className="text-left pb-2 font-medium">Timestamp</th>
              <th className="text-left pb-2 font-medium">Fonte</th>
              <th className="text-left pb-2 font-medium">Ativo</th>
              <th className="text-right pb-2 font-medium">Valor</th>
              <th className="text-left pb-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {logFiltrado.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-600">Nenhum registro</td>
              </tr>
            ) : (
              logFiltrado.map((l) => (
                <tr key={l.id} className="border-b border-border/30 hover:bg-bg-tertiary/30">
                  <td className="py-1.5 text-slate-500 font-mono">{l.timestamp}</td>
                  <td className="py-1.5 text-slate-400">{l.fonte}</td>
                  <td className="py-1.5 text-slate-300">{l.ativo}</td>
                  <td className="py-1.5 text-right text-slate-300 font-mono">{l.valor}</td>
                  <td className="py-1.5">
                    <span className={clsx(
                      'text-[10px] px-1.5 py-0.5 rounded',
                      l.status === 'ok' ? 'bg-green-900/30 text-accent-green' :
                      l.status === 'erro' ? 'bg-red-900/30 text-accent-red' :
                      'bg-bg-tertiary text-slate-500'
                    )}>
                      {l.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function isRecente(timestamp) {
  if (!timestamp) return false
  const ts = new Date(timestamp)
  const diff = Date.now() - ts.getTime()
  return diff < 24 * 60 * 60 * 1000
}
