import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import type { Book } from '../lib/model'
import logo from '../assets/branding/logo.webp'
import loadingAnimation from '../assets/branding/loading.gif?no-inline'
import loadingStill from '../assets/branding/loading-still.webp?no-inline'

const initialStyles = ['indigo', 'sand', 'ember', 'ocean', 'moss', 'violet']

export function Logo() {
  return <div className="brand"><span className="brand-icon">
    <img className="brand-mark" src={logo} alt="" />
  </span><span>Folio<span className="brand-dot">.</span><small>PDF READER</small></span></div>
}

export function BookLoading({ message, reducedMotion }: { message: string; reducedMotion: boolean }) {
  const [showArtwork, setShowArtwork] = useState(false)
  const artwork = reducedMotion ? loadingStill : loadingAnimation
  useEffect(() => {
    const timer = window.setTimeout(() => setShowArtwork(true), 150)
    return () => window.clearTimeout(timer)
  }, [])

  return <div className="book-loading" role="status">
    {showArtwork ? <picture>
      {!reducedMotion && <source media="(prefers-reduced-motion: reduce)" srcSet={loadingStill} />}
      <img className="book-loading-art" src={artwork} alt="" decoding="async" />
    </picture> : <span className="spinner" aria-hidden="true" />}
    <span>{message}</span>
  </div>
}

export function Cover({ book, className = '', lazy = false }: { book: Book; className?: string; lazy?: boolean }) {
  return <div className={`cover ${book.art === undefined ? 'imported' : initialStyles[book.art]} ${className}`}>
    <img src={book.cover} alt={book.art === undefined ? `First page of ${book.title}` : ''} draggable={false} decoding="async" loading={lazy ? 'lazy' : undefined} />
    {book.art !== undefined && <div className="cover-print"><span>FOLIO EDITIONS</span><strong>{book.title}</strong><i /></div>}
  </div>
}

export function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} aria-label={title} onCancel={event => { event.preventDefault(); close() }} onClick={event => { if (event.target === dialog.current) close() }}>
    <div className="dialog-inner">
      <div className="dialog-header"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={close}><X size={19} /></button></div>
      {children}
    </div>
  </dialog>
}
