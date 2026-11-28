import { useState } from 'react'
import { Cloud, RefreshCw } from 'lucide-react'
import { useDriveSync } from '../lib/driveSync'

export default function DriveSyncSetting() {
  const { available, identityReady, phase, account, error, lastSync, prepare, connect, sync, disconnect } = useDriveSync()
  const [loadingIdentity, setLoadingIdentity] = useState(false)
  async function start() {
    if (!identityReady) {
      setLoadingIdentity(true)
      const loaded = await prepare()
      setLoadingIdentity(false)
      if (!loaded || navigator.userActivation?.isActive === false) return
    }
    await connect()
  }

  const connected = phase === 'connected' || phase === 'syncing'
  return <div className="settings-group">
    <h2><Cloud size={19} /> Google Drive sync</h2>
    <div className="setting-row drive-setting">
      <div>
        <strong>{connected ? account : 'Sync across devices'}</strong>
        <p className="muted">Optional. Connect the same Google account on each device to sync your PDFs, reading progress, and notes.</p>
        <p role="status" className="muted">{error || (
          !available ? 'Google Drive sync is unavailable on this deployment.' :
          phase === 'connecting' ? 'Waiting for Google sign-in…' :
          phase === 'syncing' ? 'Syncing with Google Drive…' :
          lastSync ? 'Last synced ' + new Date(lastSync).toLocaleString() :
          connected ? 'Connected' : loadingIdentity ? 'Loading Google sign-in…' : 'This device only'
        )}</p>
      </div>
      {available && <div className="smart-spirit-actions">
        {connected ? <>
          <button type="button" className="secondary-button" disabled={phase === 'syncing'} onClick={() => void sync()}><RefreshCw size={15} /> Sync now</button>
          <button type="button" className="secondary-button" onClick={disconnect}>Disconnect</button>
        </> : <button type="button" className="secondary-button" disabled={phase === 'connecting' || loadingIdentity}
          onClick={() => void start()}>
          {phase === 'expired' ? 'Reconnect Google Drive' : 'Connect Google Drive'}
        </button>}
      </div>}
    </div>
  </div>
}
