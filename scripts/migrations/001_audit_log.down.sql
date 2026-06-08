-- Migration: Drop audit log table
-- Down

DROP INDEX IF EXISTS idx_audit_log_changed_by;
DROP INDEX IF EXISTS idx_audit_log_created_at;
DROP INDEX IF EXISTS idx_audit_log_table_record;
DROP TABLE IF EXISTS _audit_log;
