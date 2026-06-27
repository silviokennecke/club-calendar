import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  triggerLabel: string
  description: ReactNode
  confirmLabel?: string
  onConfirm: () => void
  isLoading?: boolean
  className?: string
}

export function DangerZoneConfirm({ triggerLabel, description, confirmLabel = 'Delete', onConfirm, isLoading = false, className }: Props) {
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} className={cn('text-xs text-red-400 hover:text-red-600 underline', className)}>
        {triggerLabel}
      </button>
    )
  }

  return (
    <div className={cn('bg-red-50 border border-red-200 rounded-lg p-4 space-y-3', className)}>
      <p className="text-sm text-red-700 font-medium">{description}</p>
      <div className="flex gap-2">
        <Button variant="destructive" size="sm" disabled={isLoading} onClick={onConfirm}>
          {isLoading ? `${confirmLabel}…` : confirmLabel}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
      </div>
    </div>
  )
}
