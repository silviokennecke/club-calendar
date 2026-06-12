'use client'
import React, { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Pencil, Trash2, Plus, Check, X } from 'lucide-react'
import dynamic from 'next/dynamic'

// @emoji-mart/react doesn't ship TS types; we load it dynamically to avoid SSR issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const EmojiPicker = dynamic(() => import('@emoji-mart/react').then(m => m), { ssr: false }) as any

interface EmojiPickerFieldProps {
  value: string
  onChange: (val: string) => void
}

function EmojiPickerField({ value, onChange }: EmojiPickerFieldProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-10 h-10 flex items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-50 transition-colors text-xl"
        title="Pick emoji"
      >
        {value || <span className="text-slate-300 text-sm">😀</span>}
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 shadow-xl rounded-xl overflow-hidden">
          {EmojiPicker && React.createElement(EmojiPicker, {
            onEmojiSelect: (e: { native: string }) => { onChange(e.native); setOpen(false) },
            theme: 'light',
            previewPosition: 'none',
            skinTonePosition: 'none',
            navPosition: 'bottom',
            perLine: 8,
            maxFrequentRows: 1,
          })}
        </div>
      )}
    </div>
  )
}

interface Field {
  key: string
  label: string
  placeholder?: string
  type?: 'text' | 'emoji'
}

interface Item {
  id: number
  [key: string]: unknown
}

interface Props {
  calendarId: string
  resourcePath: string        // e.g. `/api/calendars/${calendarId}/properties`
  queryKey: string[]
  fields: Field[]
  title: string
  renderItem: (item: Item) => React.ReactNode
}

export default function ResourceManager({ calendarId: _calendarId, resourcePath, queryKey, fields, title, renderItem }: Props) {
  const qc = useQueryClient()
  const { data: items = [] } = useQuery<Item[]>({ queryKey, queryFn: () => apiGet(resourcePath) })

  const [creating, setCreating] = useState(false)
  const [createValues, setCreateValues] = useState<Record<string, string>>({})
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  async function handleCreate() {
    setSaving(true)
    try {
      await apiPost(resourcePath, createValues)
      qc.invalidateQueries({ queryKey })
      setCreating(false)
      setCreateValues({})
    } finally { setSaving(false) }
  }

  async function handleUpdate(id: number) {
    setSaving(true)
    try {
      await apiPatch(`${resourcePath}/${id}`, editValues)
      qc.invalidateQueries({ queryKey })
      setEditingId(null)
    } finally { setSaving(false) }
  }

  async function handleDelete(id: number) {
    await apiDelete(`${resourcePath}/${id}`)
    qc.invalidateQueries({ queryKey })
  }

  function startEdit(item: Item) {
    setEditingId(item.id)
    const vals: Record<string, string> = {}
    fields.forEach(f => { vals[f.key] = String(item[f.key] ?? '') })
    setEditValues(vals)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <Button size="sm" onClick={() => { setCreating(true); setCreateValues({}) }}>
          <Plus className="w-3.5 h-3.5 mr-1" />Add
        </Button>
      </div>

      {creating && (
        <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
          <div className="flex gap-2 flex-wrap">
            {fields.map(f => (
              f.type === 'emoji' ? (
                <EmojiPickerField
                  key={f.key}
                  value={createValues[f.key] ?? ''}
                  onChange={val => setCreateValues(v => ({ ...v, [f.key]: val }))}
                />
              ) : (
                <Input key={f.key} className="flex-1 min-w-32" placeholder={f.placeholder ?? f.label}
                  value={createValues[f.key] ?? ''} onChange={e => setCreateValues(v => ({ ...v, [f.key]: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()} />
              )
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setCreating(false)}><X className="w-3.5 h-3.5 mr-1" />Cancel</Button>
            <Button size="sm" disabled={saving} onClick={handleCreate}><Check className="w-3.5 h-3.5 mr-1" />Save</Button>
          </div>
        </div>
      )}

      {items.length === 0 && !creating ? (
        <p className="text-sm text-slate-400 py-6 text-center">No {title.toLowerCase()} yet. Add one to get started.</p>
      ) : (
        <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 bg-white">
          {items.map(item => (
            <div key={item.id} className="flex items-center gap-3 px-4 py-3">
              {editingId === item.id ? (
                <div className="flex-1 space-y-2">
                  <div className="flex gap-2 flex-wrap">
                    {fields.map(f => (
                      f.type === 'emoji' ? (
                        <EmojiPickerField
                          key={f.key}
                          value={editValues[f.key] ?? ''}
                          onChange={val => setEditValues(v => ({ ...v, [f.key]: val }))}
                        />
                      ) : (
                        <Input key={f.key} className="flex-1 min-w-32 h-9" value={editValues[f.key] ?? ''}
                          placeholder={f.placeholder ?? f.label}
                          onChange={e => setEditValues(v => ({ ...v, [f.key]: e.target.value }))}
                          onKeyDown={e => e.key === 'Enter' && handleUpdate(item.id)} />
                      )
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={saving} onClick={() => handleUpdate(item.id)}><Check className="w-3.5 h-3.5 mr-1" />Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}><X className="w-3.5 h-3.5 mr-1" />Cancel</Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex-1">{renderItem(item)}</div>
                  <button onClick={() => startEdit(item)} className="text-slate-400 hover:text-slate-600 p-1"><Pencil className="w-3.5 h-3.5" /></button>
                  <AlertDialog>
                    <AlertDialogTrigger render={<button className="text-slate-400 hover:text-red-500 p-1" />}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this item?</AlertDialogTitle>
                        <AlertDialogDescription>Events using this item will lose the reference.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(item.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
