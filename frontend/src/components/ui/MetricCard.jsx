import { clsx } from 'clsx'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

function TooltipIcon({ text }) {
  return (
    <span className="relative group inline-block cursor-help ml-1 align-middle">
      <span className="text-[10px] leading-none text-slate-600 group-hover:text-slate-400 select-none">ⓘ</span>
      <span className={clsx(
        'pointer-events-none absolute top-full left-0 mt-1.5',
        'hidden group-hover:block z-[9999]',
        'w-56 text-[11px] text-slate-300 bg-[#1a1d2e] border border-border',
        'rounded-lg px-3 py-2 leading-relaxed shadow-xl font-normal font-sans whitespace-normal'
      )}>
        <span className="absolute bottom-full left-3 border-4 border-transparent border-b-border" />
        {text}
      </span>
    </span>
  )
}

export function MetricCard({ title, value, subtitle, trend, tooltip, format = 'text', size = 'md' }) {
  const isPositive = typeof trend === 'number' ? trend > 0 : trend === 'up'
  const isNegative = typeof trend === 'number' ? trend < 0 : trend === 'down'

  return (
    <div className="card">
      <div className="text-xs text-slate-500 font-medium mb-2 flex items-center">
        {title}
        {tooltip && <TooltipIcon text={tooltip} />}
      </div>
      <div
        className={clsx(
          'font-semibold font-mono',
          size === 'lg' ? 'text-2xl' : 'text-xl',
          isPositive && 'text-accent-green',
          isNegative && 'text-accent-red',
          !isPositive && !isNegative && 'text-slate-100'
        )}
      >
        {(value == null || value === 'NaN') ? '—' : value}
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

export function MetricRow({ label, value, highlight, tooltip }) {
  const isPositive = typeof highlight === 'number' ? highlight > 0 : highlight === true
  const isNegative = typeof highlight === 'number' ? highlight < 0 : highlight === false

  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
      <span className="text-xs text-slate-400 flex items-center">
        {label}
        {tooltip && <TooltipIcon text={tooltip} />}
      </span>
      <span
        className={clsx(
          'text-xs font-mono font-medium',
          isPositive && 'text-accent-green',
          isNegative && 'text-accent-red',
          !isPositive && !isNegative && 'text-slate-300'
        )}
      >
        {(value == null || value === 'NaN') ? '—' : value}
      </span>
    </div>
  )
}
