CREATE TABLE admin_account_settings (
  id TEXT PRIMARY KEY,
  root_account_id TEXT NOT NULL UNIQUE,
  document JSONB NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX admin_account_settings_root_account_id_idx
  ON admin_account_settings (root_account_id);

CREATE INDEX admin_course_connections_root_term_concluded_name_idx
  ON admin_course_connections (
    root_account_id,
    (document->>'termId'),
    (COALESCE((document->>'concluded')::boolean, false)),
    lower(course_name),
    course_id
  );
