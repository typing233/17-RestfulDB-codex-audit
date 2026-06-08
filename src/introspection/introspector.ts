import { Pool } from 'pg';
import {
  SchemaMetadata,
  TableMetadata,
  ColumnMetadata,
  PrimaryKeyMetadata,
  ForeignKeyMetadata,
  UniqueConstraintMetadata,
} from './metadata';
import {
  TABLES_QUERY,
  COLUMNS_QUERY,
  PRIMARY_KEYS_QUERY,
  FOREIGN_KEYS_QUERY,
  UNIQUE_CONSTRAINTS_QUERY,
} from './queries';

function parsePgArray(val: unknown): string[] {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    const s = val.trim();
    if (s.startsWith('{') && s.endsWith('}')) {
      const inner = s.slice(1, -1);
      if (inner === '') return [];
      return inner.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    }
  }
  return [];
}

export class Introspector {
  constructor(
    private pool: Pool,
    private schemas: string[],
    private excludeTables: string[],
  ) {}

  async discover(): Promise<SchemaMetadata> {
    const tables = new Map<string, TableMetadata>();

    const [tablesResult, columnsResult, pksResult, fksResult, uniqResult] = await Promise.all([
      this.pool.query(TABLES_QUERY, [this.schemas]),
      this.pool.query(COLUMNS_QUERY, [this.schemas]),
      this.pool.query(PRIMARY_KEYS_QUERY, [this.schemas]),
      this.pool.query(FOREIGN_KEYS_QUERY, [this.schemas]),
      this.pool.query(UNIQUE_CONSTRAINTS_QUERY, [this.schemas]),
    ]);

    for (const row of tablesResult.rows) {
      if (this.excludeTables.includes(row.table_name)) continue;
      const key = `${row.table_schema}.${row.table_name}`;
      tables.set(key, {
        schema: row.table_schema,
        name: row.table_name,
        columns: [],
        primaryKey: null,
        foreignKeys: [],
        referencedBy: [],
        uniqueConstraints: [],
        hasVersionColumn: false,
      });
    }

    for (const row of columnsResult.rows) {
      const key = `${row.table_schema}.${row.table_name}`;
      const table = tables.get(key);
      if (!table) continue;

      const col: ColumnMetadata = {
        name: row.column_name,
        dataType: row.data_type,
        udtName: row.udt_name,
        isNullable: row.is_nullable,
        hasDefault: row.has_default,
        defaultValue: row.column_default,
        maxLength: row.character_maximum_length,
        isGenerated: row.is_generated,
        ordinalPosition: row.ordinal_position,
      };
      table.columns.push(col);

      if (col.name === 'version' && ['int4', 'int8', 'int2', 'integer', 'bigint', 'smallint'].includes(col.udtName)) {
        table.hasVersionColumn = true;
      }
    }

    for (const row of pksResult.rows) {
      const key = `${row.table_schema}.${row.table_name}`;
      const table = tables.get(key);
      if (!table) continue;

      const pk: PrimaryKeyMetadata = {
        constraintName: row.constraint_name,
        columns: parsePgArray(row.columns),
      };
      table.primaryKey = pk;
    }

    for (const row of fksResult.rows) {
      const key = `${row.table_schema}.${row.table_name}`;
      const table = tables.get(key);
      if (!table) continue;

      const fk: ForeignKeyMetadata = {
        constraintName: row.constraint_name,
        columns: parsePgArray(row.columns),
        referencedSchema: row.referenced_schema,
        referencedTable: row.referenced_table,
        referencedColumns: parsePgArray(row.referenced_columns),
        onDelete: row.on_delete,
        onUpdate: row.on_update,
      };
      table.foreignKeys.push(fk);

      const refKey = `${row.referenced_schema}.${row.referenced_table}`;
      const refTable = tables.get(refKey);
      if (refTable) {
        refTable.referencedBy.push({
          ...fk,
          referencedTable: row.table_name,
          referencedSchema: row.table_schema,
          referencedColumns: parsePgArray(row.columns),
          columns: parsePgArray(row.referenced_columns),
        });
      }
    }

    for (const row of uniqResult.rows) {
      const key = `${row.table_schema}.${row.table_name}`;
      const table = tables.get(key);
      if (!table) continue;

      const uc: UniqueConstraintMetadata = {
        constraintName: row.constraint_name,
        columns: parsePgArray(row.columns),
      };
      table.uniqueConstraints.push(uc);
    }

    return { tables, lastRefreshed: new Date() };
  }
}
