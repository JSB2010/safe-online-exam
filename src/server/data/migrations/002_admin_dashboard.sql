CREATE TABLE admin_audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  root_account_id TEXT NOT NULL,
  action TEXT NOT NULL,
  document JSONB NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX admin_audit_logs_actor_user_id_idx ON admin_audit_logs (actor_user_id);
CREATE INDEX admin_audit_logs_root_account_id_idx ON admin_audit_logs (root_account_id);
CREATE INDEX admin_audit_logs_action_idx ON admin_audit_logs (action);
CREATE INDEX admin_audit_logs_created_at_idx ON admin_audit_logs (created_at DESC);
