export const TABLES_QUERY = `
SELECT table_schema, table_name, 'table' AS rel_kind
FROM information_schema.tables
WHERE table_schema = ANY($1)
  AND table_type = 'BASE TABLE'
ORDER BY table_schema, table_name;
`;

export const VIEWS_QUERY = `
SELECT table_schema, table_name, 'view' AS rel_kind
FROM information_schema.views
WHERE table_schema = ANY($1)
ORDER BY table_schema, table_name;
`;

export const MATERIALIZED_VIEWS_QUERY = `
SELECT schemaname AS table_schema, matviewname AS table_name, 'matview' AS rel_kind
FROM pg_matviews
WHERE schemaname = ANY($1)
ORDER BY schemaname, matviewname;
`;

export const COLUMNS_QUERY = `
SELECT
  c.table_schema,
  c.table_name,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.is_nullable = 'YES' AS is_nullable,
  c.column_default IS NOT NULL AS has_default,
  c.column_default,
  c.character_maximum_length,
  COALESCE(c.is_generated = 'ALWAYS', false) AS is_generated,
  c.ordinal_position
FROM information_schema.columns c
WHERE c.table_schema = ANY($1)
ORDER BY c.table_schema, c.table_name, c.ordinal_position;
`;

export const PRIMARY_KEYS_QUERY = `
SELECT
  tc.table_schema,
  tc.table_name,
  tc.constraint_name,
  array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS columns
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
  AND tc.table_name = kcu.table_name
WHERE tc.table_schema = ANY($1)
  AND tc.constraint_type = 'PRIMARY KEY'
GROUP BY tc.table_schema, tc.table_name, tc.constraint_name;
`;

export const FOREIGN_KEYS_QUERY = `
SELECT
  tc.table_schema,
  tc.table_name,
  tc.constraint_name,
  array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS columns,
  ccu.table_schema AS referenced_schema,
  ccu.table_name AS referenced_table,
  array_agg(ccu.column_name ORDER BY kcu.ordinal_position) AS referenced_columns,
  rc.delete_rule AS on_delete,
  rc.update_rule AS on_update
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
  AND tc.table_name = kcu.table_name
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name
  AND tc.constraint_schema = rc.constraint_schema
JOIN information_schema.constraint_column_usage ccu
  ON rc.unique_constraint_name = ccu.constraint_name
  AND rc.unique_constraint_schema = ccu.constraint_schema
WHERE tc.table_schema = ANY($1)
  AND tc.constraint_type = 'FOREIGN KEY'
GROUP BY tc.table_schema, tc.table_name, tc.constraint_name,
         ccu.table_schema, ccu.table_name, rc.delete_rule, rc.update_rule;
`;

export const UNIQUE_CONSTRAINTS_QUERY = `
SELECT
  tc.table_schema,
  tc.table_name,
  tc.constraint_name,
  array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS columns
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
  AND tc.table_name = kcu.table_name
WHERE tc.table_schema = ANY($1)
  AND tc.constraint_type = 'UNIQUE'
GROUP BY tc.table_schema, tc.table_name, tc.constraint_name;
`;

export const TABLE_PRIVILEGES_QUERY = `
SELECT
  table_schema,
  table_name,
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = ANY($1)
  AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
ORDER BY table_schema, table_name, grantee;
`;

export const COLUMN_PRIVILEGES_QUERY = `
SELECT
  table_schema,
  table_name,
  column_name,
  grantee,
  privilege_type
FROM information_schema.column_privileges
WHERE table_schema = ANY($1)
  AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE')
ORDER BY table_schema, table_name, column_name, grantee;
`;
