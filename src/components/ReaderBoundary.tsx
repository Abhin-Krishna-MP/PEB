import { Component, type ReactNode } from 'react'

export class ReaderBoundary extends Component<{ children: ReactNode; close: () => void }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <div className="center-screen">
      <div className="reader-state">
        <h2>Couldn’t load the reader</h2>
        <button className="primary-button" onClick={() => location.reload()}>Reload Folio</button>
        <button className="secondary-button" onClick={this.props.close}>Back to library</button>
      </div>
    </div>
  }
}
