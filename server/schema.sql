-- Applied idempotently at boot (see db.ts) — every statement is
-- CREATE ... IF NOT EXISTS. There's no migration framework here: this is a
-- brand-new schema with no prior production data to migrate around, so a
-- single idempotent file is the honest amount of machinery. If this schema
-- needs to change after real data exists, that change needs a real
-- expand/contract migration step added here — don't just edit a column
-- in place.

-- Multi-user: each person who practices on this instance (you, a friend you
-- share it with, or anyone who finds /signup) gets their own row here and
-- their own isolated library — see the user_id column on every other table
-- below. Signup is open (see server/index.ts's POST /api/signup and
-- auth/session.ts's createUser/validateNewUser); scripts/createUser.ts is
-- an alternate, command-line path to the same insert, not the only one.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pieces (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  composer TEXT,
  filename TEXT NOT NULL,
  music_xml TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  measure_count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pieces_user_id ON pieces(user_id);
CREATE INDEX IF NOT EXISTS idx_pieces_created_at ON pieces(created_at);

-- user_id is denormalized here (and on attempts below) rather than only
-- derived by joining through pieces — a flat, directly-queryable ownership
-- column on every user-scoped table makes "does this row belong to this
-- user" a single WHERE clause everywhere it's checked, instead of a JOIN
-- whose correctness has to be re-verified at every call site. Always equal
-- to the owning piece's user_id (set once, at creation — sections and
-- attempts are never reassigned to a different piece).
CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  piece_id TEXT NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  start_measure INTEGER NOT NULL,
  end_measure INTEGER NOT NULL,
  default_tempo_bpm INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  hand_filter TEXT,
  mode TEXT
);
CREATE INDEX IF NOT EXISTS idx_sections_piece_id ON sections(piece_id);
CREATE INDEX IF NOT EXISTS idx_sections_user_id ON sections(user_id);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  piece_id TEXT NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  tempo_bpm INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  aborted INTEGER NOT NULL,
  duration_ms INTEGER,
  aggregate TEXT NOT NULL,     -- JSON — AttemptAggregate
  note_results TEXT NOT NULL   -- JSON — StoredNoteResult[]
);
CREATE INDEX IF NOT EXISTS idx_attempts_section_id ON attempts(section_id);
CREATE INDEX IF NOT EXISTS idx_attempts_piece_id ON attempts(piece_id);
CREATE INDEX IF NOT EXISTS idx_attempts_user_id_timestamp ON attempts(user_id, timestamp);

-- Login session (see server/auth/session.ts). Opaque bearer token in an
-- HttpOnly cookie, not a JWT — makes "log out everywhere" for one user (or
-- a password rotation) a one-row delete instead of a key rotation that
-- would invalidate every user's sessions at once.
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

-- OAuth 2.1 authorization server state for the MCP endpoint (see
-- server/oauth/). This app *is* the AS, not just a resource server — a
-- client (Claude.ai) registers itself via Dynamic Client Registration, so
-- there's no fixed client list to seed. Registered clients are shared
-- across every user (Claude.ai registers once, not once per person); the
-- transaction/code/token tables below are per-user, since *which* user's
-- data a token can read is exactly what they authorize at the consent step.
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  info TEXT NOT NULL,   -- JSON — OAuthClientInformationFull
  created_at INTEGER NOT NULL
);

-- One row per in-flight /authorize round trip, from the initial redirect
-- through login/consent. No user_id yet at this stage — that's only known
-- once someone actually logs in on the consent page (see provider.ts's doc
-- comment on why authorize() can't check who's asking). Short-lived — see
-- TRANSACTION_TTL_MS in provider.ts.
CREATE TABLE IF NOT EXISTS oauth_transactions (
  txn_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scopes TEXT NOT NULL,   -- JSON string[]
  state TEXT,
  resource TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_codes (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scopes TEXT NOT NULL,   -- JSON string[]
  resource TEXT,
  expires_at INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  access_token TEXT PRIMARY KEY,
  refresh_token TEXT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  scopes TEXT NOT NULL,   -- JSON string[]
  resource TEXT,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_refresh_token ON oauth_tokens(refresh_token);
