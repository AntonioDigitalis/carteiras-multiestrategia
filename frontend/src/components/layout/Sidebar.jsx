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
} from 'lucide-react'
import { useCarteiras } from '../../hooks/useCarteiras'
import { clsx } from 'clsx'

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard Geral' },
  { to: '/otimizador', icon: Sliders, label: 'Otimizador' },
  { to: '/gestao', icon: Database, label: 'Gestão de Dados' },
  { to: '/auditoria', icon: Shield, label: 'Auditoria' },
  { to: '/comparador', icon: GitCompare, label: 'Comparador' },
  { to: '/configuracoes', icon: Settings, label: 'Configurações' },
]

export default function Sidebar() {
  const { carteiras, loading } = useCarteiras()
  const location = useLocation()

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
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                  isActive
                    ? 'bg-accent-blue/15 text-accent-blue font-medium'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-bg-tertiary'
                )
              }
            >
              <Icon size={15} />
              {label}
            </NavLink>
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
