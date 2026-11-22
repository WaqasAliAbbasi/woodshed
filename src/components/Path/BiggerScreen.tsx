import { useState } from 'react'
import { describeStep } from '../../lib/path/nextStep'
import { AppLink } from '../AppShell/AppShell'
import { usePathData } from './usePathData'
import './path.css'

/** "Divertimento in D · chunk 3 · build tempo" — what the link would open, from the light overview (no score download on a phone). */
function usePieceContext(pieceId: string | undefined, label: string | undefined): string | undefined {
  const { overview, derived } = usePathData()
  if (!pieceId || !overview || !derived) return label
  const title = overview.pieces.find((p) => p.id === pieceId)?.title
  const path = derived.paths.get(pieceId)
  const where = label ?? (path ? describeStep(path.next) : undefined)
  return [title, where].filter(Boolean).join(' · ') || undefined
}

/**
 * Stands in for every practice screen below ~700px wide
 * (`PhoneNeedsBigger` artboard): the score and Play button are made for a
 * laptop on the music stand, and iPhone browsers can't reach a MIDI
 * keyboard at all (see lib/platform.ts). Offers what a phone *is* good for.
 */
export function BiggerScreen({ pieceId, label }: { pieceId?: string; label?: string }) {
  const context = usePieceContext(pieceId, label)
  const [copied, setCopied] = useState<'yes' | 'no' | undefined>(undefined)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied('yes')
    } catch {
      setCopied('no')
    }
  }

  const chevron = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
  return (
    <div className="path p-bigger">
      <svg width="120" height="84" viewBox="0 0 120 84" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="A laptop" className="p-bigger-art">
        <rect x="18" y="8" width="84" height="54" rx="6" />
        <path d="M6 72h108l-6 8H12z" />
        <path d="M32 26h56M32 36h56M32 46h40" />
      </svg>
      <div>
        {context && (
          <p className="p-eyebrow" style={{ marginBottom: 6, fontSize: 14 }}>
            {context}
          </p>
        )}
        <h1 className="p-bigger-title">Practice needs a bigger screen</h1>
        <p style={{ marginTop: 10, color: 'var(--text-soft)' }}>
          The score and the Play button are made for a laptop on the music stand. Phone browsers on iPhone also can't connect to a MIDI keyboard.
        </p>
      </div>
      <div className="p-bigger-links">
        <p style={{ fontWeight: 600 }}>From your phone you can</p>
        <AppLink href="/" className="p-bigger-link p-bigger-link-primary">
          See today's plan {chevron}
        </AppLink>
        <AppLink href="/sessions" className="p-bigger-link">
          Log practice or a lesson {chevron}
        </AppLink>
        <AppLink href="/stats" className="p-bigger-link">
          See your week {chevron}
        </AppLink>
      </div>
      <button type="button" className="p-link p-bigger-copy" onClick={() => void copy()}>
        Copy the link to open on your laptop
      </button>
      {copied === 'yes' && <p className="p-banner p-banner-success">Link copied.</p>}
      {copied === 'no' && <p className="p-banner">Couldn't copy here. The link is {window.location.href}</p>}
    </div>
  )
}
