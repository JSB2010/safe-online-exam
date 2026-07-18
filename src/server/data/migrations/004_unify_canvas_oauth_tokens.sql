INSERT INTO canvas_oauth_tokens (id, user_id, document, created_at, updated_at)
SELECT
  admin_token.user_id,
  admin_token.user_id,
  jsonb_strip_nulls(
    admin_token.document ||
    jsonb_build_object(
      'id', admin_token.user_id,
      'userId', admin_token.user_id,
      'grantType', 'account_admin',
      'displayName', COALESCE(
        NULLIF(admin_token.document->'displayName', 'null'::jsonb),
        NULLIF(shared_token.document->'displayName', 'null'::jsonb)
      ),
      'email', COALESCE(
        NULLIF(admin_token.document->'email', 'null'::jsonb),
        NULLIF(shared_token.document->'email', 'null'::jsonb)
      ),
      'identityUpdatedAt', COALESCE(
        NULLIF(admin_token.document->'identityUpdatedAt', 'null'::jsonb),
        NULLIF(shared_token.document->'identityUpdatedAt', 'null'::jsonb)
      ),
      'studentReadinessPromptDismissedAt', COALESCE(
        NULLIF(admin_token.document->'studentReadinessPromptDismissedAt', 'null'::jsonb),
        NULLIF(shared_token.document->'studentReadinessPromptDismissedAt', 'null'::jsonb)
      )
    )
  ),
  admin_token.created_at,
  admin_token.updated_at
FROM canvas_oauth_tokens AS admin_token
LEFT JOIN canvas_oauth_tokens AS shared_token
  ON shared_token.id = admin_token.user_id
WHERE admin_token.id = 'account_admin:' || admin_token.user_id
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  document = EXCLUDED.document,
  created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at;

DELETE FROM canvas_oauth_tokens
WHERE id = 'account_admin:' || user_id;

INSERT INTO canvas_oauth_tokens (id, user_id, document, created_at, updated_at)
SELECT
  legacy_token.user_id,
  legacy_token.user_id,
  legacy_token.document ||
    jsonb_build_object(
      'id', legacy_token.user_id,
      'userId', legacy_token.user_id
    ),
  legacy_token.created_at,
  legacy_token.updated_at
FROM canvas_oauth_tokens AS legacy_token
WHERE legacy_token.id = 'student_session:' || legacy_token.user_id
ON CONFLICT (id) DO NOTHING;

DELETE FROM canvas_oauth_tokens
WHERE id = 'student_session:' || user_id;

DROP INDEX canvas_oauth_tokens_user_id_idx;
CREATE UNIQUE INDEX canvas_oauth_tokens_user_id_unique_idx ON canvas_oauth_tokens (user_id);
