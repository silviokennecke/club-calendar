import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface Props<T extends { id: string | number }> {
  items: T[]
  renderItem: (item: T) => ReactNode
  emptyMessage: string
  className?: string
}

export function ListCard<T extends { id: string | number }>({ items, renderItem, emptyMessage, className }: Props<T>) {
  return (
    <div className={cn('bg-white rounded-xl border border-slate-200 divide-y divide-slate-100', className)}>
      {items.length === 0
        ? <p className="text-sm text-slate-400 p-4">{emptyMessage}</p>
        : items.map(item => <div key={item.id}>{renderItem(item)}</div>)
      }
    </div>
  )
}
