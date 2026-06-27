import { cn } from '@/lib/utils'

interface FilterItem {
  id: string
  label: string
}

interface Props {
  label?: string
  clearAllLabel?: string
  items: FilterItem[]
  selected: string[]
  onChange: (id: string) => void
  onClearAll?: () => void
  className?: string
}

export function FilterPillGroup({ label, clearAllLabel = 'All', items, selected, onChange, onClearAll, className }: Props) {
  const pillBase = 'text-xs px-3 py-1.5 rounded-full border transition-colors'
  const active = 'bg-blue-600 border-blue-600 text-white'
  const inactive = 'border-slate-200 text-slate-600 hover:border-slate-300 bg-white'

  return (
    <div className={cn('flex items-center gap-2 flex-wrap', className)}>
      {label && <span className="text-xs text-slate-500">{label}</span>}
      {onClearAll && (
        <button onClick={onClearAll} className={cn(pillBase, selected.length === 0 ? active : inactive)}>
          {clearAllLabel}
        </button>
      )}
      {items.map(item => (
        <button
          key={item.id}
          onClick={() => onChange(item.id)}
          className={cn(pillBase, selected.includes(item.id) ? active : inactive)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
