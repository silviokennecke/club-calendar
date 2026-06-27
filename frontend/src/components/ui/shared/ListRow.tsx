import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  title: string
  subtitle?: string
  actions?: ReactNode
  className?: string
}

export function ListRow({ title, subtitle, actions, className }: Props) {
  return (
    <div className={cn('flex items-center justify-between px-4 py-3', className)}>
      <div>
        <p className="text-sm font-medium text-slate-900">{title}</p>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
    </div>
  )
}
