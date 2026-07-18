CREATE TABLE admin_tool_presets (
  id TEXT PRIMARY KEY,
  root_account_id TEXT NOT NULL,
  document JSONB NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX admin_tool_presets_root_account_id_idx ON admin_tool_presets (root_account_id);
