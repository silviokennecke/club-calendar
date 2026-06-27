import { cn } from '@/lib/utils'

const variantClasses = {
  purple: 'bg-purple-50 text-purple-700',
  blue: 'bg-blue-50 text-blue-700',
  green: 'bg-green-50 text-green-700',
  slate: 'bg-slate-100 text-slate-500',
} as const

export type TagBadgeVariant = keyof typeof variantClasses

interface TagBadgeProps {
  label: string
  icon?: string | null
  variant: TagBadgeVariant
  className?: string
}

export function TagBadge({ label, icon, variant, className }: TagBadgeProps) {
  return (
    <span className={cn('text-xs px-2 py-0.5 rounded-full', variantClasses[variant], className)}>
      {icon && <span className="mr-1">{icon}</span>}
      {label}
    </span>
  )
}

interface TagBadgeRowItem {
  id: string | number
  name: string
  icon?: string | null
}

interface TagBadgeRowProps {
  items: TagBadgeRowItem[]
  variant: TagBadgeVariant
  className?: string
}

export function TagBadgeRow({ items, variant, className }: TagBadgeRowProps) {
  if (items.length === 0) return null
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {items.map(item => (
        <TagBadge key={item.id} label={item.name} icon={item.icon} variant={variant} />
      ))}
    </div>
  )
}
