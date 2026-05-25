import { useState } from 'react'
import { clsx } from 'clsx'
import { Calendar } from 'lucide-react'
import { format, subMonths, subYears, startOfMonth, startOfYear } from 'date-fns'

const PRESETS = [
  { label: 'MTD', value: 'MTD' },
  { label: 'YTD', value: 'YTD' },
  { label: '6M', value: '6M' },
  { label: '12M', value: '12M' },
  { label: '24M', value: '24M' },
  { label: 'Início', value: 'ALL' },
]

export function resolvePeriod(preset, customStart, customEnd) {
  const today = new Date()
  const end = format(today, 'yyyy-MM-dd')

  if (preset === 'CUSTOM') {
    return { start: customStart, end: customEnd || end }
  }

  const map = {
    MTD: format(startOfMonth(today), 'yyyy-MM-dd'),
    YTD: format(startOfYear(today), 'yyyy-MM-dd'),
    '6M': format(subMonths(today, 6), 'yyyy-MM-dd'),
    '12M': format(subMonths(today, 12), 'yyyy-MM-dd'),
    '24M': format(subMonths(today, 24), 'yyyy-MM-dd'),
    ALL: null,
  }

  return { start: map[preset], end }
}

export default function PeriodSelector({ value, onChange }) {
  const [showCustom, setShowCustom] = useState(false)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  function handlePreset(preset) {
    if (preset === 'CUSTOM') {
      setShowCustom(true)
      return
    }
    setShowCustom(false)
    onChange({ preset, ...resolvePeriod(preset) })
  }

  function applyCustom() {
    if (customStart && customEnd) {
      onChange({ preset: 'CUSTOM', start: customStart, end: customEnd })
      setShowCustom(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center bg-bg-secondary border border-border rounded-md overflow-hidden">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => handlePreset(p.value)}
            className={clsx(
              'px-3 py-1.5 text-xs font-medium transition-colors',
              value?.preset === p.value
                ? 'bg-accent-blue text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-bg-tertiary'
            )}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => handlePreset('CUSTOM')}
          className={clsx(
            'px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1',
            value?.preset === 'CUSTOM'
              ? 'bg-accent-blue text-white'
              : 'text-slate-400 hover:text-slate-200 hover:bg-bg-tertiary'
          )}
        >
          <Calendar size={11} />
          Custom
        </button>
      </div>

      {showCustom && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="input text-xs py-1.5 w-36"
          />
          <span className="text-slate-500 text-xs">até</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="input text-xs py-1.5 w-36"
          />
          <button onClick={applyCustom} className="btn-primary py-1.5 text-xs">
            Aplicar
          </button>
        </div>
      )}
    </div>
  )
}
