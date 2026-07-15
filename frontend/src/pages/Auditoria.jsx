import { useState, useEffect } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle, Filter, RefreshCw, Download, Activity, Zap, TrendingDown, TrendingUp, DollarSign, ChevronDown, ChevronRight } from 'lucide-react'
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
  const [erros, setErros] = useState({}) // { alertas: 'msg', ... } — só as fontes que falharam
  const [filtro, setFiltro] = useState('ativos')
  const [filtroCarteira, setFiltroCarteira] = useState('todas')

  useEffect(() => {
    carregarDados()
  }, [])

  async function carregarDados() {
    setLoading(true)
    // allSettled: uma fonte falhar não pode apagar as outras 3 que carregaram bem
    const [a, l, s, ev] = await Promise.allSettled([
      api.getAlertas(),
      api.getLogCaptacao(),
      api.getSaude(),
      api.getEventos(),
    ])
    const novosErros = {}
    if (a.status === 'fulfilled') setAlertas(a.value); else novosErros.alertas = a.reason?.message || 'Falha ao carregar'
    if (l.status === 'fulfilled') setLog(l.value); else novosErros.log = l.reason?.message || 'Falha ao carregar'
    if (s.status === 'fulfilled') setSaude(s.value); else novosErros.saude = s.reason?.message || 'Falha ao carregar'
    if (ev.status === 'fulfilled') setEventos(ev.value); else novosErros.eventos = ev.reason?.message || 'Falha ao carregar'
    setErros(novosErros)
    setLoading(false)
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
  const nCritico = alertas.filter((a) => a.tipo === 'error' && a.status === 'ativo').length
  const nCotaTravada = alertas.filter((a) => a.categoria === 'cota_travada' && a.status === 'ativo').length
  const nRevisados = alertas.filter((a) => a.status === 'revisado').length
  const nRecentes = log.filter((l) => isRecente(l.timestamp)).length
  const nEventos = eventos.filter((e) => !e.revisado).length

  const ERRO_LABELS = { alertas: 'Alertas', log: 'Log de Captação', saude: 'Saúde dos Dados', eventos: 'Eventos Corporativos' }

  function irPara(novaTab, novoFiltro) {
    setTab(novaTab)
    if (novoFiltro) setFiltro(novoFiltro)
  }

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

      {/* Erro parcial: uma fonte pode falhar sem apagar as outras */}
      {Object.keys(erros).length > 0 && (
        <div className="card border border-red-800/50 bg-red-900/20 flex items-center gap-2 text-xs text-accent-red">
          <AlertCircle size={14} className="flex-shrink-0" />
          <span>Não foi possível carregar: {Object.keys(erros).map((k) => ERRO_LABELS[k]).join(', ')}.</span>
          <button onClick={carregarDados} className="underline hover:no-underline">Tentar de novo</button>
        </div>
      )}

      {/* Veredito: resposta direta a "está tudo bem ou preciso agir?" */}
      {nAtivos === 0 && nEventos === 0 ? (
        <div className="card flex items-center gap-3 border border-green-800/40 bg-green-900/10">
          <CheckCircle size={22} className="text-accent-green flex-shrink-0" />
          <div className="text-sm font-medium text-slate-200">Tudo em ordem — nenhum alerta ativo nem evento corporativo pendente.</div>
        </div>
      ) : (
        <div className="card flex items-start gap-3 border border-yellow-800/40 bg-yellow-900/10">
          <AlertTriangle size={22} className="text-accent-yellow flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-medium text-slate-200">{nAtivos + nEventos} ação(ões) pendente(s)</div>
            <div className="text-xs text-slate-400 mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {nCritico > 0 && (
                <button onClick={() => irPara('alertas', 'ativos')} className="hover:underline text-accent-red">
                  {nCritico} alerta(s) crítico(s)
                </button>
              )}
              {nCotaTravada > 0 && (
                <button onClick={() => irPara('alertas', 'ativos')} className="hover:underline text-accent-red">
                  {nCotaTravada} cota(s) travada(s)
                </button>
              )}
              {nAtivos - nCritico - nCotaTravada > 0 && (
                <button onClick={() => irPara('alertas', 'ativos')} className="hover:underline">
                  {nAtivos - nCritico - nCotaTravada} outro(s) alerta(s)
                </button>
              )}
              {nEventos > 0 && (
                <button onClick={() => irPara('eventos')} className="hover:underline">
                  {nEventos} evento(s) corporativo(s) sem revisar
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-5 gap-4">
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

  const produtosFiltrados = (filtroTipo === 'todos'
    ? produtosPorCarteira
    : filtroTipo === 'sem_dados'
    ? produtosPorCarteira.filter((p) => p.periodos.some((pe) => pe.status !== 'ok'))
    : produtosPorCarteira.filter((p) => p.tipo === filtroTipo)
  ).slice().sort((a, b) => {
    // Produtos com pendência primeiro — quem abre a aba quer ver o que
    // precisa de ação, não rolar a lista inteira procurando.
    const problemaA = a.periodos.some((pe) => pe.status !== 'ok') ? 0 : 1
    const problemaB = b.periodos.some((pe) => pe.status !== 'ok') ? 0 : 1
    return problemaA - problemaB
  })

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
                <th className="text-left pb-2 font-medium">Última cota</th>
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
                  <td className="py-1.5 pr-4">
                    {p.ultima_cota ? (
                      <span className={clsx('font-mono text-[10px]', diasDesatualizado(p.ultima_cota) > 15 ? 'text-accent-red' : 'text-slate-500')}>
                        {p.ultima_cota}
                      </span>
                    ) : (
                      <span className="text-slate-700">—</span>
                    )}
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
                <tr><td colSpan={meses.length + 3} className="py-6 text-center text-slate-600">Nenhum produto</td></tr>
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
  const [expandidos, setExpandidos] = useState(() => new Set())

  // Agrupa por (categoria, título) — cotas travadas e "cotas ausentes: X" já
  // compartilham o mesmo título por natureza; sem agrupar, 764 alertas
  // revisados+ativos afogavam os poucos que realmente pedem atenção.
  const grupos = []
  const porChave = new Map()
  for (const a of alertas) {
    const chave = `${a.categoria}__${a.titulo}`
    if (!porChave.has(chave)) {
      const grupo = { chave, categoria: a.categoria, titulo: a.titulo, tipo: a.tipo, itens: [] }
      porChave.set(chave, grupo)
      grupos.push(grupo)
    }
    porChave.get(chave).itens.push(a)
  }
  grupos.sort((a, b) => b.itens.length - a.itens.length)

  function toggle(chave) {
    setExpandidos((prev) => {
      const next = new Set(prev)
      next.has(chave) ? next.delete(chave) : next.add(chave)
      return next
    })
  }

  async function marcarGrupo(itens, status) {
    for (const it of itens) await onMarcar(it.id, status)
  }

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

      {grupos.length === 0 ? (
        <div className="card text-center py-12 text-slate-500 text-sm">
          <CheckCircle size={24} className="mx-auto mb-2 text-accent-green" />
          Nenhum alerta {filtro === 'todos' ? '' : filtro}
        </div>
      ) : (
        <div className="space-y-2">
          {grupos.map((g) =>
            g.itens.length === 1 ? (
              <AlertaItem key={g.chave} alerta={g.itens[0]} onMarcar={onMarcar} />
            ) : (
              <GrupoAlertas
                key={g.chave}
                grupo={g}
                expandido={expandidos.has(g.chave)}
                onToggle={() => toggle(g.chave)}
                onMarcar={onMarcar}
                onMarcarGrupo={marcarGrupo}
              />
            )
          )}
        </div>
      )}
    </div>
  )
}

function GrupoAlertas({ grupo, expandido, onToggle, onMarcar, onMarcarGrupo }) {
  const isCritical = grupo.tipo === 'error'
  const isWarning = grupo.tipo === 'warning'
  const nAtivosGrupo = grupo.itens.filter((it) => it.status === 'ativo').length

  return (
    <div className={clsx(
      'rounded-lg border',
      isCritical ? 'bg-red-900/20 border-red-800/50' :
      isWarning ? 'bg-yellow-900/20 border-yellow-800/50' :
      'bg-bg-secondary border-border'
    )}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 p-3 text-left">
        {expandido ? <ChevronDown size={14} className="text-slate-500 flex-shrink-0" /> : <ChevronRight size={14} className="text-slate-500 flex-shrink-0" />}
        {isCritical && <AlertCircle size={15} className="text-accent-red flex-shrink-0" />}
        {isWarning && <AlertTriangle size={15} className="text-accent-yellow flex-shrink-0" />}
        <span className="text-xs font-medium text-slate-200 flex-1">{grupo.titulo}</span>
        <span className="text-[10px] text-slate-500">{grupo.itens.length} ocorrências{nAtivosGrupo > 0 && nAtivosGrupo < grupo.itens.length ? ` (${nAtivosGrupo} ativas)` : ''}</span>
        {nAtivosGrupo > 0 && (
          <span
            role="button"
            onClick={(e) => { e.stopPropagation(); onMarcarGrupo(grupo.itens.filter((it) => it.status === 'ativo'), 'revisado') }}
            className="text-[10px] px-2 py-1 rounded bg-green-900/30 text-accent-green hover:bg-green-900/50 flex-shrink-0"
          >
            Marcar grupo como revisado
          </span>
        )}
      </button>
      {expandido && (
        <div className="px-3 pb-3 space-y-2">
          {grupo.itens.map((a) => (
            <AlertaItem key={a.id} alerta={a} onMarcar={onMarcar} compacto />
          ))}
        </div>
      )}
    </div>
  )
}

// Alertas de cota travada carregam a data de detecção em `data`, mas a
// descrição fixa "últimos 5 dias" nunca atualiza — calcula há quanto tempo
// de fato está travada a partir de `data` até hoje.
function diasTravada(alerta) {
  if (alerta.categoria !== 'cota_travada' || !alerta.data) return null
  const dias = Math.floor((Date.now() - new Date(alerta.data).getTime()) / 86400000)
  return dias >= 0 ? dias : null
}

function AlertaItem({ alerta, onMarcar, compacto }) {
  const isCritical = alerta.tipo === 'error'
  const isWarning = alerta.tipo === 'warning'
  const dias = diasTravada(alerta)

  return (
    <div
      className={clsx(
        'flex items-start gap-3 rounded-lg text-sm',
        compacto ? 'bg-black/10 p-2' : clsx(
          'p-3 border',
          isCritical ? 'bg-red-900/20 border-red-800/50' :
          isWarning ? 'bg-yellow-900/20 border-yellow-800/50' :
          'bg-bg-secondary border-border'
        )
      )}
    >
      {!compacto && (
        <div className="mt-0.5 flex-shrink-0">
          {isCritical && <AlertCircle size={15} className="text-accent-red" />}
          {isWarning && <AlertTriangle size={15} className="text-accent-yellow" />}
          {!isCritical && !isWarning && <CheckCircle size={15} className="text-accent-green" />}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {!compacto && <span className="text-xs font-medium text-slate-200">{alerta.titulo}</span>}
          <span className="text-[10px] text-slate-500">{alerta.ativo}</span>
          {dias != null && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/40 text-accent-red font-medium">
              travada há {dias} dia{dias === 1 ? '' : 's'}
            </span>
          )}
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

// Não há um "id de sessão" de sync no log — aproxima o último lote pelas
// entradas dentro de uma janela de 30min antes do timestamp mais recente
// (uma sincronização real de ~130 itens já levou alguns minutos).
function resumoUltimaSincronizacao(log) {
  if (log.length === 0) return null
  const maisRecente = log[0].timestamp
  const limite = new Date(maisRecente).getTime() - 30 * 60 * 1000
  const doLote = log.filter((l) => new Date(l.timestamp).getTime() >= limite)
  const erroItens = doLote.filter((l) => l.status === 'erro')
  return {
    timestamp: maisRecente,
    ok: doLote.filter((l) => l.status === 'ok').length,
    erros: erroItens.length,
    erroItens,
  }
}

function formatarRelativo(timestamp) {
  const diffMin = Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000)
  if (diffMin < 1) return 'agora mesmo'
  if (diffMin < 60) return `há ${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `há ${diffH}h`
  const diffD = Math.floor(diffH / 24)
  return `há ${diffD} dia${diffD === 1 ? '' : 's'}`
}

function LogTab({ log, saude, filtroCarteira }) {
  const logFiltrado = (() => {
    if (filtroCarteira === 'todas') return log
    if (!saude?.produtos) return log
    const produtosDaCarteira = saude.produtos
      .filter((p) => filtroCarteira === 'sem_carteira'
        ? !p.carteira_ids || p.carteira_ids.length === 0
        : p.carteira_ids?.includes(Number(filtroCarteira)))
      .map((p) => p.identificador)
      .filter(Boolean)
    return log.filter((l) => produtosDaCarteira.includes(l.ativo))
  })()
  const resumo = resumoUltimaSincronizacao(log)
  return (
    <div className="space-y-3">
      {resumo && (
        <div className="card">
          <div className="flex items-center gap-3 flex-wrap text-xs">
            <span className="text-slate-300 font-medium">
              Última sincronização: {formatarRelativo(resumo.timestamp)}
            </span>
            <span className="text-accent-green">{resumo.ok} ok</span>
            {resumo.erros > 0 && <span className="text-accent-red font-medium">{resumo.erros} erro{resumo.erros === 1 ? '' : 's'}</span>}
          </div>
          {resumo.erros > 0 && (
            <div className="mt-2 space-y-1 border-t border-border pt-2">
              {resumo.erroItens.slice(0, 8).map((l) => (
                <div key={l.id} className="text-[10px] text-accent-red">
                  <span className="font-mono">{l.ativo}</span>{l.detalhes ? `: ${l.detalhes}` : ''}
                </div>
              ))}
              {resumo.erroItens.length > 8 && (
                <div className="text-[10px] text-slate-600">+ {resumo.erroItens.length - 8} outro(s) — veja a tabela abaixo</div>
              )}
            </div>
          )}
        </div>
      )}
    <div className="card overflow-hidden">
      <div className="text-sm font-medium text-slate-300 mb-3">Log de Captação{filtroCarteira !== 'todas' ? '' : ` (últimos ${logFiltrado.length})`}</div>
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
    </div>
  )
}

function isRecente(timestamp) {
  if (!timestamp) return false
  const ts = new Date(timestamp)
  const diff = Date.now() - ts.getTime()
  return diff < 24 * 60 * 60 * 1000
}

function diasDesatualizado(dataISO) {
  return Math.floor((Date.now() - new Date(dataISO).getTime()) / 86400000)
}
