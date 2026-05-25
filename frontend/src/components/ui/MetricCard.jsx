import { clsx } from 'clsx'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

export function MetricCard({ title, value, subtitle, trend, format = 'text', size = 'md' }) {
  const isPositive = typeof trend === 'number' ? trend > 0 : trend === 'up'
  const isNegative = typeof trend === 'number' ? trend < 0 : trend === 'down'

  return (
    <div className="card">
      <div className="text-xs text-slate-500 font-medium mb-2">{title}</div>
      <div
        className={clsx(
          'font-semibold font-mono',
          size === 'lg' ? 'text-2xl' : 'text-xl',
          isPositive && 'text-accent-green',
          isNegative && 'text-accent-red',
          !isPositive && !isNegative && 'text-slate-100'
        )}
      >
        {value ?? '—'}
      </div>
      {subtitle && (
        <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
          {typeof trend === 'number' && trend > 0 && <TrendingUp size={10} className="text-accent-green" />}
          {typeof trend === 'number' && trend < 0 && <TrendingDown size={10} className="text-accent-red" />}
          {typeof trend === 'number' && trend === 0 && <Minus size={10} className="text-slate-500" />}
          {subtitle}
        </div>
      )}
    </div>
  )
}

export function MetricRow({ label, value, highlight }) {
  const isPositive = typeof highlight === 'number' ? highlight > 0 : highlight === true
  const isNegative = typeof highlight === 'number' ? highlight < 0 : highlight === false

  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
      <span className="text-xs text-slate-400">{label}</span>
      <span
        className={clsx(
          'text-xs font-mono font-medium',
          isPositive && 'text-accent-green',
          isNegative && 'text-accent-red',
          !isPositive && !isNegative && 'text-slate-300'
        )}
      >
        {value ?? '—'}
      </span>
    </div>
  )
}
