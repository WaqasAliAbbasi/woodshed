import { useCallback, useEffect, useRef, useState } from 'react'
import { navigate } from '../../lib/router'
import { McpInfoDialog } from '../McpInfo/McpInfo'
import './appShell.css'

/** The top-level pages, in tab order. */
const TABS = [
  ['/', 'Today'],
  ['/library', 'Library'],
  ['/sessions', 'Sessions'],
  ['/stats', 'Stats'],
] as const

export type TabPath = (typeof TABS)[number][0]

export function WoodshedMark() {
  return (
    <svg
      className="shell-mark-icon"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 23 L24 7 L44 23" />
      <rect x="30" y="9" width="5" height="9" />
      <path d="M8 23 V41 H40 V23" />
      <rect x="20.5" y="29" width="7" height="12" />
    </svg>
  )
}

/** A same-app link: a real `<a href>` (open in a new tab works) that routes client-side on a plain click. */
export function AppLink({ href, className, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        navigate(href)
      }}
      {...rest}
    >
      {children}
    </a>
  )
}

function logOut() {
  void fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).finally(() => {
    window.location.href = '/login'
  })
}

/** Log out, MCP and Export key: account things, kept out of the way of practice. */
function AccountMenu() {
  const [open, setOpen] = useState(false)
  const [mcpOpen, setMcpOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const closeMcp = useCallback(() => setMcpOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="shell-account" ref={ref}>
      <button type="button" className="shell-account-btn" aria-haspopup="menu" aria-expanded={open} aria-label="Account" onClick={() => setOpen((o) => !o)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
        </svg>
      </button>
      {open && (
        <div className="shell-account-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              setMcpOpen(true)
            }}
          >
            MCP access
          </button>
          {/* Server-rendered page (server/routes/export.ts), so a plain link, not client routing. */}
          <a role="menuitem" href="/export-key">
            Export key
          </a>
          <button type="button" role="menuitem" onClick={logOut}>
            Log out
          </button>
        </div>
      )}
      {mcpOpen && <McpInfoDialog onClose={closeMcp} />}
    </div>
  )
}

/** The one header every top-level page shares: the mark, the four tabs, the account menu. */
export function AppShell({ active, children }: { active: TabPath | undefined; children: React.ReactNode }) {
  return (
    <div className="shell">
      <header className="shell-header">
        <AppLink href="/" className="shell-mark" aria-label="Woodshed, today's plan">
          <WoodshedMark />
          <span>Woodshed</span>
        </AppLink>
        <nav className="shell-tabs" aria-label="Main">
          {TABS.map(([href, label]) => (
            <AppLink key={href} href={href} className="shell-tab" aria-current={active === href ? 'page' : undefined}>
              {label}
            </AppLink>
          ))}
        </nav>
        <AccountMenu />
      </header>
      <main className="page">{children}</main>
    </div>
  )
}

/**
 * Practice screens swap the tabs for this slim bar (`Rung` artboard): back to
 * Today, where you are, Finish now and Free practice. `right` holds those
 * actions, so each screen decides which apply.
 */
export function PracticeShell({ back, where, right, children }: { back?: { href: string; label: string }; where: React.ReactNode; right: React.ReactNode; children: React.ReactNode }) {
  const to = back ?? { href: '/', label: "Today's plan" }
  return (
    <div className="shell">
      <header className="shell-header shell-header-practice">
        <AppLink href={to.href} className="shell-back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
          {to.label}
        </AppLink>
        <p className="shell-where">{where}</p>
        <div className="shell-practice-actions">{right}</div>
      </header>
      <main className="page">{children}</main>
    </div>
  )
}
