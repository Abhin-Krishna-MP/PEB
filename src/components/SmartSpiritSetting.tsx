import { useEffect } from 'react'
import { useSmartSpirit } from '../companion/smartSpirit'
import { fileSize } from '../lib/model'

export default function SmartSpiritSetting() {
  const { status, check, download, remove } = useSmartSpirit()
  useEffect(() => { void check() }, [check])
  const percent = status.kind === 'downloading' && status.total > 0
    ? Math.min(99, Math.round(100 * status.loaded / status.total)) : undefined
  return <div className="setting-row smart-spirit-setting">
    <div>
      <strong>Offline Smart Spirit</strong>
      <p role="status">{
        status.kind === 'ready' ? `Ready offline${status.download.bytes ? ' · ' + fileSize(status.download.bytes) : ''}` :
        status.kind === 'downloading' ? percent === undefined ? 'Preparing download…' : `Downloading ${percent}%` :
        status.kind === 'failed' ? `Failed · ${status.error}` :
        status.kind === 'removing' ? 'Removing download…' :
        status.kind === 'checking' ? 'Checking download…' : 'Off · Rule-based companion'
      }</p>
      {status.kind === 'off' && <p>One-time download of roughly 200–450 MB. Book text stays on this device.</p>}
      {status.kind === 'downloading' && <progress aria-label="Smart Spirit download" max={100} value={percent} />}
    </div>
    <div className="smart-spirit-actions">
      {(status.kind === 'off' || status.kind === 'failed') && <button type="button" className="secondary-button" onClick={() => void download()}>
        {status.kind === 'failed' ? 'Retry download' : 'Download & enable'}
      </button>}
      {['ready', 'failed', 'downloading'].includes(status.kind) && <button type="button" className="secondary-button" onClick={() => void remove()}>
        {status.kind === 'downloading' ? 'Cancel & remove' : 'Remove download'}
      </button>}
    </div>
  </div>
}
