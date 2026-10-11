CREATE TABLE mcp_tool_metrics (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
 tool text NOT NULL CHECK (tool IN ('sp_create_project','sp_open_project','sp_get_document','sp_get_slide','sp_edit','sp_render_slide','sp_validate','sp_save_export','sp_list_projects','sp_project_info','sp_list_slides','sp_list_themes','sp_get_theme','sp_preview_theme','sp_apply_theme','sp_save_theme','sp_list_revisions','sp_get_revision','sp_revision_diff','sp_restore_revision')),
 duration_ms double precision NOT NULL CHECK (duration_ms>=0 AND duration_ms<=86400000),
 outcome text NOT NULL CHECK (outcome IN ('success','error')),
 error_code varchar(64) CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 transport text NOT NULL CHECK (transport IN ('streamable-http','stdio-bridge')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX mcp_tool_metrics_time ON mcp_tool_metrics (created_at DESC,id DESC);
CREATE INDEX mcp_tool_metrics_actor_time ON mcp_tool_metrics (actor_id,created_at DESC);
CREATE INDEX mcp_tool_metrics_tool_time ON mcp_tool_metrics (tool,created_at DESC);
