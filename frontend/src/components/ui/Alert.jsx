import { AlertTriangle, AlertCircle, CheckCircle, Info, X } from 'lucide-react'
import { clsx } from 'clsx'

const variants = {
  error: { icon: AlertCircle, bg: 'bg-red-900/30 border-red-800', text: 'text-red-300', icon_color: 'text-accent-red' },
  warning: { icon: AlertTriangle, bg: 'bg-yellow-900/30 border-yellow-800', text: 'text-yellow-300', icon_color: 'text-accent-yellow' },
  success: { icon: CheckCircle, bg: 'bg-green-900/30 border-green-800', text: 'text-green-300', icon_color: 'text-accent-green' },
  info: { icon: Info, bg: 'bg-blue-900/30 border-blue-800', text: 'text-blue-300', icon_color: 'text-accent-blue' },
}

export default function Alert({ type = 'info', title, message, onDismiss }) {
  const v = variants[type]
  const Icon = v.icon

  return (
    <div className={clsx('flex items-start gap-3 p-3 rounded-md border text-sm', v.bg)}>
      <Icon size={15} className={clsx('mt-0.5 flex-shrink-0', v.icon_color)} />
      <div className="flex-1 min-w-0">
        {title && <div className={clsx('font-medium text-xs', v.text)}>{title}</div>}
        {message && <div className="text-xs text-slate-400 mt-0.5">{message}</div>}
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="text-slate-500 hover:text-slate-300 flex-shrink-0">
          <X size={13} />
        </button>
      )}
    </div>
  )
}
