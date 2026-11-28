import { create } from 'zustand'
import { driveApi, driveClientId, DriveError, loadGoogleIdentity, requestDriveToken, setDriveFileAccess } from './driveApi'
import { isRecordId, mergeDriveRecords, parseDriveRecords, type DriveBinding, type DriveRecord } from './driveRecords'
import { useLibrary } from './store'
import * as storage from './storage'

type Session = { token: string; expiresAt: number; binding: DriveBinding; abort: AbortController }
type State = {
  available: boolean
  identityReady: boolean
  phase: 'off' | 'connecting' | 'connected' | 'syncing' | 'expired'
  account?: string
  error?: string
  lastSync?: number
  prepare(): Promise<boolean>
  connect(): Promise<void>
  sync(): Promise<void>
  disconnect(): void
}

let session: Session | undefined
let task: Promise<void> | undefined
let queued = false
let timer: number | undefined
let attempt = 0
let expiryTimer: number | undefined

const replicaName = (device: string) => 'folio-library-' + device + '.json'
const bookName = (id: string) => 'folio-book-' + id + '.pdf'
const readSignature = (records: DriveRecord[]) => JSON.stringify(records.map(row => [row.key, row.clock, row.device]))

async function exchange(connection: Session) {
  const signal = connection.abort.signal
  const api = driveApi(connection.token, signal)
  const files = await api.list()
  const books = new Map<string, string>()
  const ownName = replicaName(connection.binding.device)
  let ownFile: string | undefined
  let ownRecords: DriveRecord[] = []
  const inbound: DriveRecord[][] = []
  for (const file of files) {
    const id = /^folio-book-([\w-]+)\.pdf$/.exec(file.name)?.[1]
    if (isRecordId(id) && !books.has(id)) books.set(id, file.id)
    if (!/^folio-library-[\w-]+\.json$/.test(file.name)) continue
    const snapshot = parseDriveRecords(await (await api.read(file.id)).json())
    inbound.push(snapshot)
    if (file.name === ownName && !ownFile) { ownFile = file.id; ownRecords = snapshot }
  }

  const incoming = mergeDriveRecords(...inbound)
  const local = await storage.readDriveRecords()
  let failed = 0
  for (const row of mergeDriveRecords(local, incoming)) {
    if (row.kind !== 'book' || !row.value || row.value.sample || books.has(row.id)) continue
    signal.throwIfAborted()
    const pdf = await storage.readLocalPdf(row.id)
    if (!pdf) continue
    try {
      const uploaded = await api.write(bookName(row.id), pdf.slice(0, pdf.size, 'application/pdf'))
      books.set(row.id, uploaded.id)
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof DriveError && error.status === 401) throw error
      failed++
    }
  }
  signal.throwIfAborted()
  const merged = await useLibrary.getState().mergeDrive(connection.binding, incoming, books, signal)
  const changes = merged.filter(row => row.device === connection.binding.device)
  if (readSignature(changes) !== readSignature(ownRecords)) {
    signal.throwIfAborted()
    await api.write(ownName, new Blob([JSON.stringify({ version: 1, records: changes })], { type: 'application/json' }), ownFile)
  }
  if (failed) throw new Error(`Could not upload ${failed} PDF${failed === 1 ? '' : 's'}. Check Drive storage and try again.`)
}

function scheduleSync() {
  if (!session) return
  if (task) { queued = true; return }
  window.clearTimeout(timer)
  timer = window.setTimeout(() => { void useDriveSync.getState().sync() }, 2000)
}

export const useDriveSync = create<State>((set, get) => ({
  available: Boolean(driveClientId),
  identityReady: false,
  phase: 'off',
  async prepare() {
    if (!driveClientId) return false
    try {
      await loadGoogleIdentity()
      set({ identityReady: true, error: undefined })
      return true
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Could not load Google sign-in.' })
      return false
    }
  },
  async connect() {
    if (get().phase === 'connecting' || session) return
    const id = ++attempt
    set({ phase: 'connecting', error: undefined })
    try {
      const credential = await requestDriveToken()
      if (attempt !== id) return
      const abort = new AbortController()
      const user = await driveApi(credential.token, abort.signal).account()
      if (attempt !== id) return
      const binding = await storage.bindDriveAccount(user.id)
      if (attempt !== id) return
      session = { ...credential, binding, abort }
      setDriveFileAccess({ ...credential, account: binding.account, signal: abort.signal })
      expiryTimer = window.setTimeout(() => {
        get().disconnect()
        set({ phase: 'expired', error: 'Reconnect Google Drive to continue syncing.' })
      }, Math.max(0, credential.expiresAt - Date.now()))
      set({ phase: 'connected', account: user.label })
      await get().sync()
    } catch (error) {
      if (attempt === id) set({ phase: 'off', error: error instanceof Error ? error.message : 'Could not connect to Google Drive.' })
    }
  },
  async sync() {
    const connection = session
    if (!connection) return
    if (task) { queued = true; return task }
    window.clearTimeout(timer)
    if (navigator.onLine === false) {
      set({ error: 'Sync will resume when this device is back online.' })
      return
    }
    set({ phase: 'syncing', error: undefined })
    const run = async () => {
      try {
        const locks = navigator.locks
        if (locks) await locks.request('folio-drive-sync', { signal: connection.abort.signal }, () => exchange(connection))
        else await exchange(connection)
        if (session === connection) set({ phase: 'connected', lastSync: Date.now() })
      } catch (error) {
        if (session !== connection) return
        if (error instanceof DriveError && error.status === 401) {
          get().disconnect()
          set({ phase: 'expired', error: error.message })
        } else set({ phase: 'connected', error: error instanceof Error ? error.message : 'Could not sync with Google Drive.' })
      }
    }
    task = Promise.resolve().then(run).finally(() => {
      task = undefined
      if (queued) {
        queued = false
        scheduleSync()
      }
    })
    return task
  },
  disconnect() {
    attempt++
    session?.abort.abort()
    session = undefined
    setDriveFileAccess()
    window.clearTimeout(timer)
    window.clearTimeout(expiryTimer)
    queued = false
    set({ phase: 'off', account: undefined, error: undefined, lastSync: undefined })
  },
}))

export function watchDriveSync() {
  if (!driveClientId) return
  const unsubscribe = useLibrary.subscribe((next, previous) => {
    if (next.localRevision !== previous.localRevision) scheduleSync()
  })
  const onForeground = () => {
    if (document.visibilityState === 'visible' && session && !task) void useDriveSync.getState().sync()
  }
  const poll = window.setInterval(onForeground, 60_000)
  window.addEventListener('online', onForeground)
  document.addEventListener('visibilitychange', onForeground)
  return () => {
    unsubscribe()
    window.clearInterval(poll)
    window.removeEventListener('online', onForeground)
    document.removeEventListener('visibilitychange', onForeground)
  }
}
