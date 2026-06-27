import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface FullPageLoaderProps {
  message?: string
  className?: string
}

export function FullPageLoader({ message = 'Loading…', className }: FullPageLoaderProps) {
  return (
    <div className={cn('flex items-center justify-center min-h-screen bg-slate-50', className)}>
      <p className="text-slate-400 text-sm">{message}</p>
    </div>
  )
}

interface FullPageErrorProps {
  message: string
  children?: ReactNode
  className?: string
}

export function FullPageError({ message, children, className }: FullPageErrorProps) {
  return (
    <div className={cn('flex items-center justify-center min-h-screen bg-slate-50', className)}>
      <div className="text-center">
        {children}
        <p className="text-slate-600 font-medium">{message}</p>
      </div>
    </div>
  )
}
