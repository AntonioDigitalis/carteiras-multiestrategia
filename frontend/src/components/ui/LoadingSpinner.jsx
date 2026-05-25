export default function LoadingSpinner({ size = 'md', text }) {
  const sz = size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-10 h-10' : 'w-6 h-6'

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12">
      <div className={`${sz} border-2 border-accent-blue/30 border-t-accent-blue rounded-full animate-spin`} />
      {text && <div className="text-xs text-slate-500">{text}</div>}
    </div>
  )
}

export function InlineSpinner() {
  return (
    <div className="w-3.5 h-3.5 border-2 border-accent-blue/30 border-t-accent-blue rounded-full animate-spin inline-block" />
  )
}
