import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Database,
  Shield,
  GitCompare,
  Settings,
  TrendingUp,
  ChevronRight,
  Briefcase,
  Sliders,
  RefreshCw,
  Check,
  X,
  FileText,
} from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { useCarteiras } from '../../hooks/useCarteiras'
import { useSyncProgress } from '../../hooks/useSyncProgress'
import { clsx } from 'clsx'

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard Geral' },
  { to: '/otimizador', icon: Sliders, label: 'Otimizador' },
  { to: '/gestao', icon: Database, label: 'Gestão de Dados' },
  { to: '/auditoria', icon: Shield, label: 'Auditoria' },
  { to: '/comparador', icon: GitCompare, label: 'Comparador' },
  { to: '/relatorios', icon: FileText, label: 'Relatórios' },
  { to: '/configuracoes', icon: Settings, label: 'Configurações' },
]

export default function Sidebar() {
  const { carteiras, loading } = useCarteiras()
  const location = useLocation()
  const { status, start } = useSyncProgress()
  const [resultado, setResultado] = useState(null) // null | 'ok' | 'error' — transiente pós-sync
  const prevRunning = useRef(false)

  useEffect(() => {
    if (prevRunning.current && !status.running) {
      setResultado(status.erros.length > 0 ? 'error' : 'ok')
      const t = setTimeout(() => setResultado(null), 2000)
      prevRunning.current = status.running
      return () => clearTimeout(t)
    }
    prevRunning.current = status.running
  }, [status.running, status.erros.length])

  async function handleSync(e) {
    e.preventDefault()
    if (status.running) return
    setResultado(null)
    try {
      await start()
    } catch {
      setResultado('error')
      setTimeout(() => setResultado(null), 2000)
    }
  }

  return (
    <aside className="w-56 bg-bg-secondary border-r border-border flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-accent-blue flex items-center justify-center">
            <TrendingUp size={14} className="text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-100 leading-tight">Carteiras</div>
            <div className="text-[10px] text-slate-500 leading-tight">Multiestratégia</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3">
        {/* Main nav */}
        <div className="px-2 space-y-0.5 mb-4">
          {navItems.map(({ to, icon: Icon, label }, idx) => (
            <div key={to} className="flex items-center gap-1">
              <NavLink
                to={to}
                className={({ isActive }) =>
                  clsx(
                    'flex flex-1 items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                    isActive
                      ? 'bg-accent-blue/15 text-accent-blue font-medium'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-bg-tertiary'
                  )
                }
              >
                <Icon size={15} />
                {label}
              </NavLink>

              {idx === 0 && (
                <button
                  onClick={handleSync}
                  disabled={status.running}
                  title={status.running ? `Sincronizando... ${status.percent}%` : 'Sincronizar dados'}
                  className={clsx(
                    'relative flex-shrink-0 p-1.5 rounded-md transition-colors overflow-hidden',
                    resultado === 'ok'    && 'text-emerald-400',
                    resultado === 'error' && 'text-red-400',
                    !resultado && 'text-slate-600 hover:text-slate-300 hover:bg-bg-tertiary'
                  )}
                >
                  {status.running && (
                    <span
                      className="absolute inset-y-0 left-0 bg-accent-blue/25 transition-all duration-300"
                      style={{ width: `${status.percent}%` }}
                    />
                  )}
                  <span className="relative">
                    {resultado === 'ok'    ? <Check size={13} /> :
                     resultado === 'error' ? <X size={13} /> :
                     <RefreshCw size={13} className={status.running ? 'animate-spin' : ''} />}
                  </span>
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Carteiras section */}
        <div className="px-3 mb-2">
          <div className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider mb-2">
            Carteiras
          </div>
        </div>

        {loading ? (
          <div className="px-5 py-2">
            <div className="text-xs text-slate-600">Carregando...</div>
          </div>
        ) : (
          <div className="px-2 space-y-0.5">
            {carteiras.map((c) => {
              const isActive = location.pathname === `/carteira/${c.id}`
              return (
                <NavLink
                  key={c.id}
                  to={`/carteira/${c.id}`}
                  className={clsx(
                    'flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors',
                    isActive
                      ? 'bg-accent-blue/15 text-accent-blue font-medium'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-bg-tertiary'
                  )}
                >
                  <Briefcase size={12} className="flex-shrink-0" />
                  <span className="truncate">{c.nome}</span>
                  <span className="ml-auto text-[10px] text-slate-600">{c.tipo}</span>
                </NavLink>
              )
            })}
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border">
        <div className="text-[10px] text-slate-600">v1.0.0 · Local</div>
      </div>
    </aside>
  )
}
