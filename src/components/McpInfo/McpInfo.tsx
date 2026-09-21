import { useEffect, useRef, useState } from 'react'

// The four tools server/mcp.ts actually registers, kept here as plain data
// so this panel can't describe a tool that doesn't exist (or forget one
// that does) — if mcp.ts's tool list changes, this is the other place to
// update, there's no shared source to import from without pulling the MCP
// SDK into the client bundle for four strings.
const MCP_TOOLS = [
  { name: 'list_pieces', description: 'Every piece in your library, with when each was last practiced.' },
  { name: 'practice_history', description: 'Recent practice attempts, most recent first — the whole library or one piece.' },
  { name: 'streak', description: 'Your current and longest consecutive-day practice streak.' },
  {
    name: 'section_progress',
    description:
      'Per-section progress for one piece — struggling / progressing / ready for timed practice, clean-pass and wrong-note counts for Notes mode.',
  },
]

/**
 * A self-contained trigger + modal — no parent state needed, unlike
 * ConfirmDialog (which is a yes/no the caller has to own the answer to).
 * Exists because MCP support (server/mcp.ts, README.md) was previously
 * documented only in the repo — invisible to someone just using the
 * deployed site — not because the feature is new. Deliberately written
 * protocol-first: MCP is an open standard (modelcontextprotocol.io), not a
 * Claude-only integration, even though Claude is the client this app has
 * actually been used with day to day.
 */
export function McpInfoLink() {
  const [open, setOpen] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const mcpUrl = `${window.location.origin}/mcp`

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  return (
    <>
      <button type="button" className="link-back" onClick={() => setOpen(true)}>
        MCP
      </button>
      {open && (
        <div className="confirm-overlay" onClick={() => setOpen(false)}>
          <div
            className="confirm-dialog mcp-info-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mcp-info-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="mcp-info-title">MCP access</h3>
            <p>
              <a href="https://modelcontextprotocol.io" target="_blank" rel="noreferrer">
                MCP
              </a>{' '}
              (Model Context Protocol) is an open standard that lets an AI assistant read data from an app
              on your behalf, with your permission. Woodshed runs a read-only MCP server at{' '}
              <code>/mcp</code> that any MCP-compatible client can connect to — Claude.ai and Claude Code
              both support it today as a "custom connector."
            </p>
            <p className="mcp-info-label">What's supported</p>
            <ul className="mcp-info-tools">
              {MCP_TOOLS.map((tool) => (
                <li key={tool.name}>
                  <code>{tool.name}</code> — {tool.description}
                </li>
              ))}
            </ul>
            <p className="mcp-info-note">
              Read-only: a connected client can look at your pieces, history, streak, and progress, but
              can't upload a piece, start an attempt, or change anything for you.
            </p>
            <p className="mcp-info-label">Connect it</p>
            <ol className="mcp-info-steps">
              <li>
                In your MCP client, add a connector pointed at <code className="mcp-info-url">{mcpUrl}</code>
              </li>
              <li>Approve it while logged in here — you'll land on a consent screen first</li>
            </ol>
            <div className="confirm-dialog-actions">
              <button type="button" className="confirm-dialog-confirm" ref={closeRef} onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
