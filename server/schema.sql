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
  created_at INTEGER NOT NULL,
  -- The day of the week lessons happen on, 0 = Sunday … 6 = Saturday, or
  -- NULL if not set. Drives "lesson Sat 28 Nov" on the plan. Added after
  -- this table shipped — see ADDED_COLUMNS in db.ts.
  lesson_weekday INTEGER
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
  measure_count INTEGER NOT NULL,
  -- The tempo the student is currently working this piece up to: what
  -- "ready" is judged against, not what any single attempt was played at
  -- (attempts carry their own tempo_bpm). Nullable because only the client
  -- can parse the score's own marked tempo out of the MusicXML, so an unset
  -- target falls back to that. Added after this table shipped — see
  -- ADDED_COLUMNS in db.ts, which is what actually puts it on an existing
  -- database; this line only covers databases created from scratch.
  target_tempo_bpm INTEGER,
  -- Set when a lesson marks the piece Finished: the teacher's verdict
  -- stands whatever the learning path says. Cleared if a later lesson
  -- puts it back to Keep going or New. (ADDED_COLUMNS, like the two below.)
  finished_at INTEGER,
  -- Measures whose notes don't repeat an earlier measure, recorded when the
  -- piece is chunked — the "M new" in "N bars, M new", without the client
  -- having to fetch and parse every score in a book to show it.
  new_measure_count INTEGER
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
  mode TEXT,
  -- Learning path only (see docs/learning-path.md and src/lib/path/): the
  -- chunk this section belongs to and which rung of it it is ('notes',
  -- 'metronome', 'join', …). NULL on every Free practice section, which is
  -- what keeps Free practice from moving the path. The path creates ordinary
  -- sections so attempts, history and the MCP tools need no changes.
  -- (ADDED_COLUMNS.)
  chunk_id TEXT REFERENCES chunks(id) ON DELETE SET NULL,
  rung TEXT
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

-- The learning path's chunks: a piece cut into 2–6-bar pieces to learn one
-- at a time (src/lib/path/chunkPiece.ts). Computed once, client-side (only
-- the client parses MusicXML), and stored so every screen and device agrees
-- on the boundaries. `repeat_of_chunk_id` marks a chunk whose notes copy an
-- earlier one's exactly. Rung progress is never stored — it's derived from
-- attempts on the sections pointing back here (see sections.chunk_id).
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  piece_id TEXT NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  start_measure INTEGER NOT NULL,
  end_measure INTEGER NOT NULL,
  repeat_of_chunk_id TEXT REFERENCES chunks(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (piece_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_chunks_user_id ON chunks(user_id);

-- A book (ordered by page) or an exam set (optional date). A piece can be
-- in more than one.
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,      -- 'book' | 'exam' | 'other'
  exam_date INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collections_user_id ON collections(user_id);

CREATE TABLE IF NOT EXISTS collection_pieces (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  piece_id TEXT NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  page INTEGER,
  PRIMARY KEY (collection_id, piece_id)
);
CREATE INDEX IF NOT EXISTS idx_collection_pieces_user_id ON collection_pieces(user_id);

-- A bounded stretch of practice — the unit `src/components/Sessions/`
-- shows, distinct from an *attempt* (one scored run of one section). Named
-- `practice_sessions`, not `sessions`, to avoid colliding with the login
-- session table right below this one — two tables called "sessions" in one
-- schema is a bug waiting to be written.
--
-- Two kinds, one table (`source`):
--   'derived' — built automatically from recorded attempts by clustering
--     them on a gap threshold (see src/lib/sessions.ts, and
--     queries.ts's assignAttemptToSession, which both creates and keeps
--     merging these as attempts land — see its own doc comment for why an
--     attempt can widen or merge existing sessions, not just append to
--     the most recent one).
--   'manual' — entered by hand for practice Woodshed didn't witness (away
--     from the keyboard, a piece with no score uploaded, a lesson). Never
--     absorbs attempts — see assignAttemptToSession, which only matches
--     against 'derived' sessions.
-- `piece_id`/`label` are manual-only (a derived session can span more than
-- one piece in one sitting, so it has no single piece to name — see the
-- distinct-pieces-touched query instead). `note` is common to both: the
-- whole point of a session existing as a row, not just a computed view
-- over attempts, is giving practice something stable to attach a note to
-- after the fact — see docs/sessions-plan.md's "Why sessions are stored
-- rows, not derived on read".
CREATE TABLE IF NOT EXISTS practice_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  label TEXT,
  piece_id TEXT REFERENCES pieces(id) ON DELETE SET NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_practice_sessions_user_started ON practice_sessions(user_id, started_at);

-- One row per piece covered in a lesson. The lesson itself is a manual
-- practice_sessions row labelled "Lesson" (date, minutes, note), so it shows
-- in Sessions and the streak like any other logged practice. The latest
-- outcome per piece decides what Today's plan works on.
CREATE TABLE IF NOT EXISTS lesson_pieces (
  session_id TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  piece_id TEXT NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL,   -- 'finished' | 'continue' | 'new'
  focus TEXT,
  PRIMARY KEY (session_id, piece_id)
);
CREATE INDEX IF NOT EXISTS idx_lesson_pieces_user_id ON lesson_pieces(user_id);

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

-- Read-only export keys: a bearer token another of the user's own apps (life) presents to
-- GET /api/export/sessions, in place of the login cookie. Only the SHA-256 of the key is stored (the key is shown
-- once, by scripts/createExportKey.ts), and it is scoped to one user, so it can read nothing but that user's sessions.
CREATE TABLE IF NOT EXISTS export_keys (
  key_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
