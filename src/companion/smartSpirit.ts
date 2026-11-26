import { create } from 'zustand'
import { openReadingModel } from './client'
import { cacheName, fallbackModel, modelFile, primaryModel, type ModelDownload } from './inference'

const storageKey = 'folio:offline-smart-spirit:q4:v1'
type Status =
  | { kind: 'off' | 'checking' | 'removing' }
  | { kind: 'downloading'; loaded: number; total: number }
  | { kind: 'failed'; error: string }
  | { kind: 'ready'; download: ModelDownload }
type State = {
  status: Status
  check: () => Promise<void>
  download: () => Promise<void>
  remove: () => Promise<void>
  unavailable: () => void
}

function readSaved(): Extract<Status, { kind: 'ready' | 'failed' }> | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (saved?.kind === 'downloading') return { kind: 'failed', error: 'The download was interrupted. Retry to finish.' }
    if (saved?.kind === 'failed' && typeof saved.error === 'string') return saved
    const data = saved?.download
    if (saved?.kind === 'ready' && (data?.model === primaryModel || data?.model === fallbackModel) &&
        Array.isArray(data.files) && data.files.length && data.files.every((url: unknown) => typeof url === 'string' && modelFile(url, data.model))) return saved
  } catch { /* Treat unavailable or invalid storage as off. */ }
}

const saved = readSaved()
const checking: Status = saved?.kind === 'ready' ? { kind: 'checking' } : saved ?? { kind: 'off' }
let downloadClient: ReturnType<typeof openReadingModel> | undefined
let operation = 0

export const useSmartSpirit = create<State>((set, get) => {
  const status = (value: Status) => set({ status: value })
  const save = (value: Extract<Status, { kind: 'ready' | 'failed' }>) => {
    localStorage.setItem(storageKey, JSON.stringify(value))
    status(value)
  }
  const fail = (message: string) => {
    const value = { kind: 'failed', error: message } as const
    try { save(value) } catch { status(value) }
  }
  const busy = () => ['downloading', 'removing'].includes(get().status.kind)
  return {
    status: checking,
    async check() {
      if (get().status.kind !== 'checking') return
      const entry = readSaved()
      if (entry?.kind !== 'ready') { status(entry ?? { kind: 'off' }); return }
      const token = operation
      try {
        const storage = await caches.has(cacheName) ? await caches.open(cacheName) : undefined
        const files = new Set((await storage?.keys())?.map(key => key.url))
        if (operation !== token) return
        if (entry.download.files.every(url => files.has(url))) status(entry)
        else fail('The browser removed some model files. Download them again to enable Smart Spirit.')
      } catch {
        if (operation === token) fail('Model storage is unavailable on this device.')
      }
    },
    async download() {
      if (busy() || get().status.kind === 'ready') return
      const token = ++operation
      status({ kind: 'downloading', loaded: 0, total: 0 })
      try {
        localStorage.setItem(storageKey, JSON.stringify({ kind: 'downloading' }))
        if (!globalThis.caches) throw new Error('Model storage requires HTTPS and a browser with Cache Storage.')
        const client = openReadingModel()
        downloadClient = client
        const result = await client.download((loaded, total) => {
          if (token === operation) status({ kind: 'downloading', loaded, total })
        })
        if (token === operation) save({ kind: 'ready', download: result })
      } catch (error) {
        if (token === operation) fail(error instanceof Error ? error.message : 'The model download failed.')
      } finally {
        if (token === operation) { downloadClient?.close(); downloadClient = undefined }
      }
    },
    async remove() {
      if (get().status.kind === 'removing') return
      ++operation
      downloadClient?.close()
      downloadClient = undefined
      status({ kind: 'removing' })
      try {
        if (globalThis.caches && await caches.has(cacheName)) {
          const cache = await caches.open(cacheName)
          await Promise.all((await cache.keys()).filter(key => modelFile(key.url, primaryModel) || modelFile(key.url, fallbackModel)).map(key => cache.delete(key)))
        }
        localStorage.removeItem(storageKey)
        status({ kind: 'off' })
      } catch { fail('Could not remove the model files. Try again.') }
    },
    unavailable() {
      if (get().status.kind === 'ready') fail('The cached model could not load. Retry in Settings.')
    },
  }
})
