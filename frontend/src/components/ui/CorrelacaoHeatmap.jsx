import { clsx } from 'clsx'

// Interpola entre vermelho(-1), branco(0) e azul(+1)
function corCelula(v) {
  if (v == null) return '#1e2132'
  const abs = Math.abs(v)
  if (v > 0) {
    const r = Math.round(59  + (1 - abs) * (220 - 59))
    const g = Math.round(130 + (1 - abs) * (220 - 130))
    const b = Math.round(246 + (1 - abs) * (220 - 246))
    return `rgb(${r},${g},${b})`
  } else {
    const r = Math.round(239 + (1 - abs) * (220 - 239))
    const g = Math.round(68  + (1 - abs) * (220 - 68))
    const b = Math.round(68  + (1 - abs) * (220 - 68))
    return `rgb(${r},${g},${b})`
  }
}

function corTexto(v) {
  if (v == null) return '#64748b'
  return Math.abs(v) > 0.5 ? '#fff' : '#1e293b'
}

export default function CorrelacaoHeatmap({ classes, labels, matrix }) {
  if (!classes || !matrix) return null
  const n = classes.length

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-[11px] font-mono">
        <thead>
          <tr>
            <th className="w-24" />
            {labels.map((l, j) => (
              <th key={j} className="pb-1 px-0.5 text-center text-slate-400 font-normal w-16">
                <span className="inline-block rotate-[-35deg] origin-bottom-left whitespace-nowrap">{l}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={i}>
              <td className="pr-2 text-right text-slate-400 font-sans text-[11px] whitespace-nowrap">{labels[i]}</td>
              {row.map((v, j) => (
                <td
                  key={j}
                  className="w-14 h-10 text-center rounded-sm m-0.5 cursor-default"
                  style={{ background: corCelula(v), color: corTexto(v) }}
                  title={`${labels[i]} × ${labels[j]}: ${v != null ? v.toFixed(2) : '—'}`}
                >
                  {v != null ? (i === j ? '—' : v.toFixed(2)) : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex items-center gap-3 text-[10px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <span className="w-4 h-3 rounded-sm inline-block" style={{ background: 'rgb(59,130,246)' }} />
          Correlação positiva
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-4 h-3 rounded-sm inline-block" style={{ background: 'rgb(239,68,68)' }} />
          Correlação negativa
        </span>
      </div>
    </div>
  )
}
