CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE assessments (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  document JSONB NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX assessments_course_id_idx ON assessments (course_id);

CREATE TABLE courses (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  document JSONB NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX courses_course_id_idx ON courses (course_id);

CREATE TABLE canvas_oauth_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  document JSONB NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX canvas_oauth_tokens_user_id_idx ON canvas_oauth_tokens (user_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE transient_states (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  document JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(document) = 'object'),
  course_id TEXT,
  content_id TEXT,
  budget_count INTEGER CHECK (budget_count IS NULL OR budget_count >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX transient_states_expires_at_idx ON transient_states (expires_at);
CREATE INDEX transient_states_course_content_idx ON transient_states (course_id, content_id);

CREATE TABLE operation_locks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX operation_locks_expires_at_idx ON operation_locks (expires_at);
