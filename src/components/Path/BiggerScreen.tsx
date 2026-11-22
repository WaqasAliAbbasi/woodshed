import { useState } from 'react'
import { describeStep } from '../../lib/path/nextStep'
import { navigate } from '../../lib/router'
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

  return (
    <div className="path" style={{ gap: 24 }}>
      <div>
        {context && <p className="p-eyebrow">{context}</p>}
        <h1 className="p-h1" style={{ fontSize: 34 }}>
          Practice needs a bigger screen
        </h1>
        <p className="p-muted" style={{ marginTop: 10 }}>
          The score and the Play button are made for a laptop or tablet on the music stand. Browsers on iPhone also can't
          connect to a MIDI keyboard.
        </p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p className="p-muted p-small">From your phone you can</p>
        <button type="button" className="p-btn" style={{ justifyContent: 'space-between' }} onClick={() => navigate('/')}>
          See today's plan <span aria-hidden="true">›</span>
        </button>
        <button type="button" className="p-btn" style={{ justifyContent: 'space-between' }} onClick={() => navigate('/lesson')}>
          Log a lesson <span aria-hidden="true">›</span>
        </button>
        <button type="button" className="p-btn" style={{ justifyContent: 'space-between' }} onClick={() => navigate('/library')}>
          Browse the Library <span aria-hidden="true">›</span>
        </button>
      </div>
      <button type="button" className="p-btn p-btn-primary" onClick={() => void copy()}>
        Copy the link to open on your laptop
      </button>
      {copied === 'yes' && <p className="p-banner p-banner-success">Link copied.</p>}
      {copied === 'no' && <p className="p-banner">Couldn't copy here. The link is {window.location.href}</p>}
    </div>
  )
}
