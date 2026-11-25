import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export const currentBook = () => window.location.hash.slice(1) || null

export function useReaderRoute() {
  const [active, setActive] = useState(currentBook)
  const activeRef = useRef(active)
  const libraryScroll = useRef<number | null>(null)
  const libraryFocus = useRef<HTMLElement | null>(null)
  const leaving = useRef(false)

  const sync = useCallback(() => {
    const next = currentBook()
    if (next && !activeRef.current && libraryScroll.current === null) libraryScroll.current = window.scrollY
    activeRef.current = next
    leaving.current = false
    setActive(next)
  }, [])

  useEffect(() => {
    const restoration = history.scrollRestoration
    history.scrollRestoration = 'manual'
    window.addEventListener('popstate', sync)
    window.addEventListener('hashchange', sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener('hashchange', sync)
      history.scrollRestoration = restoration
    }
  }, [sync])

  useLayoutEffect(() => {
    if (active || libraryScroll.current === null) return
    window.scrollTo({ top: libraryScroll.current, behavior: 'instant' })
    if (libraryFocus.current?.isConnected) libraryFocus.current.focus({ preventScroll: true })
    libraryScroll.current = null
    libraryFocus.current = null
  }, [active])

  const open = useCallback((id: string) => {
    if (activeRef.current === id || leaving.current) return
    if (!activeRef.current) {
      libraryScroll.current = window.scrollY
      libraryFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      history.pushState({ folioReader: true }, '', '#' + id)
    } else {
      history.replaceState(history.state, '', '#' + id)
    }
    sync()
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [sync])

  const close = useCallback(() => {
    if (!activeRef.current || leaving.current) return
    if (history.state?.folioReader) {
      leaving.current = true
      history.back()
    } else {
      history.replaceState(history.state, '', location.pathname + location.search)
      sync()
    }
  }, [sync])

  return { active, open, close }
}
