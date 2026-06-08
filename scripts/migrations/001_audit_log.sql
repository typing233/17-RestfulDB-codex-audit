-- Migration: Create audit log table
-- Up

CREATE TABLE IF NOT EXISTS _audit_log (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  record_id TEXT,
  action TEXT NOT NULL,
  old_data JSONB,
  new_data JSONB,
  changed_by TEXT,
  role TEXT,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_table_record ON _audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON _audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_by ON _audit_log(changed_by);

GRANT SELECT ON _audit_log TO admin;
GRANT INSERT ON _audit_log TO authenticated, admin;
GRANT USAGE ON SEQUENCE _audit_log_id_seq TO authenticated, admin;
