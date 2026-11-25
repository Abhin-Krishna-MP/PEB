import { Database, Download, Monitor, ShieldCheck, Trash2 } from 'lucide-react'
import { companionModes, fileSize, type Preferences } from '../lib/model'
import { useLibrary } from '../lib/store'

export default function Settings({ install, clear, usage, quota, toast }: {
  install: () => void; clear: () => void; usage: number; quota: number; toast: (message: string) => void
}) {
  const preferences = useLibrary(state => state.preferences)
  const configure = useLibrary(state => state.configure)
  function choose<K extends keyof Preferences>(name: K, value: Preferences[K]) {
    void configure({ [name]: value }).catch(() => toast('Could not save this preference.'))
  }
  function select<K extends keyof Preferences>(name: K, label: string, options: readonly Preferences[K][]) {
    return <label className="setting-row"><span>{label}</span><select value={String(preferences[name])} onChange={event => choose(name, (typeof preferences[name] === 'number' ? Number(event.target.value) : event.target.value) as Preferences[K])}>
      {options.map(option => <option key={String(option)} value={String(option)}>{option}{typeof option === 'number' && '%'}</option>)}
    </select></label>
  }
  return <section className="settings-page">
    <h1>Settings</h1><p className="intro">Make Folio feel like your own reading room.</p>
    <div className="settings-group"><h2><Monitor size={19} /> Reading preferences</h2>
      {select('appearance', 'App appearance', ['Dark', 'Light', 'System'])}
      {select('mode', 'Default reading mode', ['Auto', 'Single page', 'Double page', 'Scroll'])}
      {select('theme', 'Page theme', ['Original', 'Light', 'Sepia', 'Dark'])}
      {select('fit', 'Page fit', ['Fit page', 'Fit width'])}
      {select('zoom', 'Default zoom', [75, 100, 125, 150, 200])}
      {select('companion', 'Reading companion', companionModes)}
      <label className="setting-row">Page-turn animation<input type="checkbox" checked={preferences.animation} onChange={event => choose('animation', event.target.checked)} /></label>
      <label className="setting-row">Reduce motion<input type="checkbox" checked={preferences.reducedMotion} onChange={event => choose('reducedMotion', event.target.checked)} /></label>
    </div>
    <div className="settings-group"><h2><Database size={19} /> Offline & storage</h2>
      <div className="setting-row"><span>Browser storage</span><span>{fileSize(usage)} used{quota > 0 && ' / ' + fileSize(quota)}</span></div>
      <div className="setting-row"><span>Protect your library from automatic eviction</span><button className="secondary-button" onClick={async () => {
        try {
          const retained = await navigator.storage?.persist?.()
          toast(retained ? 'Persistent storage is enabled.' : 'Your browser manages storage retention on this device.')
        } catch { toast('Storage retention settings are unavailable.') }
      }}><ShieldCheck size={16} /> Request persistence</button></div>
      <div className="setting-row"><span>Install Folio on this device</span><button className="secondary-button" onClick={install}><Download size={16} /> Install app</button></div>
      <div className="setting-row"><span>Remove PDFs, collections, and reading history</span><button className="secondary-button danger" onClick={clear}><Trash2 size={16} /> Clear library</button></div>
    </div>
  </section>
}
