DROP TABLE IF EXISTS admin_audit_logs;

CREATE TABLE admin_course_connections (
  id TEXT PRIMARY KEY,
  root_account_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  course_name TEXT NOT NULL,
  course_code TEXT,
  document JSONB NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (root_account_id, course_id)
);

CREATE INDEX admin_course_connections_root_name_idx
  ON admin_course_connections (root_account_id, lower(course_name), course_id);
CREATE INDEX admin_course_connections_root_updated_idx
  ON admin_course_connections (root_account_id, updated_at DESC);

CREATE TABLE admin_tool_preset_assignments (
  id TEXT PRIMARY KEY,
  root_account_id TEXT NOT NULL,
  preset_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'failed')),
  document JSONB NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (preset_id, course_id)
);

CREATE INDEX admin_tool_preset_assignments_root_idx
  ON admin_tool_preset_assignments (root_account_id);
CREATE INDEX admin_tool_preset_assignments_preset_status_idx
  ON admin_tool_preset_assignments (preset_id, status);
CREATE INDEX admin_tool_preset_assignments_course_idx
  ON admin_tool_preset_assignments (course_id);

INSERT INTO admin_tool_preset_assignments
  (id, root_account_id, preset_id, course_id, status, document, created_at, updated_at)
SELECT
  preset.id || ':' || assignment.course_id,
  preset.root_account_id,
  preset.id,
  assignment.course_id,
  'applied',
  jsonb_build_object(
    'id', preset.id || ':' || assignment.course_id,
    'rootAccountId', preset.root_account_id,
    'presetId', preset.id,
    'courseId', assignment.course_id,
    'desiredAssigned', true,
    'status', 'applied',
    'error', null,
    'appliedPresetUpdatedAt', preset.document->>'updatedAt',
    'updatedByUserId', COALESCE(preset.document->>'updatedByUserId', ''),
    'createdAt', preset.created_at,
    'updatedAt', preset.updated_at
  ),
  preset.created_at,
  preset.updated_at
FROM admin_tool_presets AS preset
CROSS JOIN LATERAL jsonb_array_elements_text(
  COALESCE(preset.document->'assignedCourseIds', '[]'::jsonb)
) AS assignment(course_id)
ON CONFLICT (preset_id, course_id) DO NOTHING;

UPDATE admin_tool_presets
SET document = document - 'assignedCourseIds';
