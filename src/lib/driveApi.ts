const api = 'https://www.googleapis.com/drive/v3/'
const uploadApi = 'https://www.googleapis.com/upload/drive/v3/'
export const driveScope = 'https://www.googleapis.com/auth/drive.appdata'
export const driveClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() as string | undefined

export class DriveError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}
type DriveFile = { id: string; name: string }
type FileList = { files?: DriveFile[]; nextPageToken?: string }

export function driveApi(token: string, signal?: AbortSignal) {
  async function request(url: string, init?: RequestInit) {
    const headers = new Headers(init?.headers)
    headers.set('Authorization', 'Bearer ' + token)
    const response = await fetch(url, { ...init, headers, signal, cache: 'no-store' })
    if (!response.ok) {
      const status = response.status
      const detail = status === 401 ? 'Google Drive access expired. Reconnect in Settings.' :
        status === 403 ? 'Google Drive denied access. Check permissions and available storage.' :
        status === 429 ? 'Google Drive is busy. Try syncing again shortly.' :
        status === 404 ? 'This file is no longer in Google Drive.' : 'Google Drive sync could not finish. Try again.'
      throw new DriveError(detail, status)
    }
    return response
  }

  async function write(name: string, blob: Blob, id?: string) {
    const metadata = JSON.stringify(id ? { name } : { name, parents: ['appDataFolder'] })
    const endpoint = uploadApi + 'files' + (id ? '/' + encodeURIComponent(id) : '')
    const method = id ? 'PATCH' : 'POST'
    if (blob.size >= 5 * 1024 * 1024) {
      const session = await request(endpoint + '?uploadType=resumable&fields=id,name', {
        method, body: metadata,
        headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': blob.type, 'X-Upload-Content-Length': String(blob.size) },
      })
      const location = session.headers.get('Location')
      const url = location && new URL(location)
      if (!url || url.origin !== 'https://www.googleapis.com' || !url.pathname.startsWith('/upload/drive/')) {
        throw new Error('Google Drive did not return a valid upload session.')
      }
      return (await request(url.href, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type } })).json() as Promise<DriveFile>
    }
    const boundary = 'folio-' + crypto.randomUUID()
    const body = new Blob([
      '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + metadata + '\r\n',
      '--' + boundary + '\r\nContent-Type: ' + blob.type + '\r\n\r\n', blob, '\r\n--' + boundary + '--\r\n',
    ])
    return (await request(endpoint + '?uploadType=multipart&fields=id,name', {
      method, body, headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
    })).json() as Promise<DriveFile>
  }

  return {
    async account() {
      const response = await request(api + 'about?fields=user(permissionId,displayName,emailAddress)')
      const { user } = await response.json() as { user?: { permissionId?: string; displayName?: string; emailAddress?: string } }
      if (!user?.permissionId) throw new Error('Google Drive could not identify the connected account.')
      return { id: user.permissionId, label: user.emailAddress || user.displayName || 'Google Drive' }
    },
    async list() {
      const files: DriveFile[] = []
      const query = new URLSearchParams({
        spaces: 'appDataFolder', fields: 'nextPageToken,files(id,name)', pageSize: '1000',
        q: "trashed = false and name contains 'folio-'",
      })
      let next: string | undefined
      do {
        if (next) query.set('pageToken', next)
        const result = await (await request(api + 'files?' + query)).json() as FileList
        files.push(...(result.files ?? []))
        next = result.nextPageToken
      } while (next)
      return files.sort((a, b) => a.id.localeCompare(b.id))
    },
    async read(id: string) { return request(api + 'files/' + encodeURIComponent(id) + '?alt=media') },
    write,
  }
}

type TokenResult = { access_token?: string; expires_in?: string | number; scope?: string; error?: string }
type Identity = { accounts: { oauth2: { initTokenClient(options: {
  client_id: string; scope: string; callback: (result: TokenResult) => void; error_callback: (error: { type: string }) => void
}): { requestAccessToken(options: { prompt: string }): void } } } }
const googleIdentity = () => (window as Window & { google?: Identity }).google
let script: Promise<void> | undefined

export function loadGoogleIdentity() {
  if (googleIdentity()) return Promise.resolve()
  return script ??= new Promise<void>((resolve, reject) => {
    const node = document.createElement('script')
    node.src = 'https://accounts.google.com/gsi/client'
    node.async = true
    node.onload = () => googleIdentity() ? resolve() : reject(new Error('Google sign-in could not start.'))
    node.onerror = () => { node.remove(); reject(new Error('Google sign-in could not load. Check your connection and retry.')) }
    document.head.append(node)
  }).catch(error => { script = undefined; throw error })
}

export function requestDriveToken() {
  return new Promise<{ token: string; expiresAt: number }>((resolve, reject) => {
    const google = googleIdentity()
    if (!google || !driveClientId) {
      reject(new Error('Google Drive sync is unavailable on this deployment.'))
      return
    }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: driveClientId,
      scope: driveScope,
      callback(result) {
        if (!result.access_token || result.error || !result.scope?.split(' ').includes(driveScope)) {
          reject(new Error('Allow Folio access to its data in Google Drive to sync.'))
        } else resolve({ token: result.access_token, expiresAt: Date.now() + (Number(result.expires_in) || 3600) * 1000 - 30_000 })
      },
      error_callback(error) {
        reject(new Error(error.type === 'popup_closed' ? 'Google sign-in was closed.' : 'Google sign-in could not open. Allow pop-ups and retry.'))
      },
    })
    client.requestAccessToken({ prompt: 'select_account' })
  })
}

type FileAccess = { token: string; expiresAt: number; account: string; signal: AbortSignal }
let fileAccess: FileAccess | undefined
export function setDriveFileAccess(access?: FileAccess) {
  fileAccess = access
}
export async function fetchDriveBook(source: { id: string; account: string }, signal?: AbortSignal) {
  const access = fileAccess
  if (!access || access.account !== source.account || Date.now() >= access.expiresAt) {
    throw new Error('Connect Google Drive in Settings to download this PDF.')
  }
  if (navigator.onLine === false) throw new Error('Go online to open this PDF for the first time.')
  const requestSignal = signal ? AbortSignal.any([signal, access.signal]) : access.signal
  const response = await driveApi(access.token, requestSignal).read(source.id)
  const file = await response.blob()
  if (!(await file.slice(0, 1024).text()).includes('%PDF-')) throw new Error('Google Drive did not return a valid PDF.')
  return file.slice(0, file.size, 'application/pdf')
}
