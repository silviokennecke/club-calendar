import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  message: string
  icon?: ReactNode
  className?: string
}

export function EmptyState({ message, icon, className }: Props) {
  return (
    <div className={cn('text-center py-12 text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl', className)}>
      {icon && <div className="mb-2">{icon}</div>}
      {message}
    </div>
  )
}
