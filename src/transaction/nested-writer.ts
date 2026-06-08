import { PoolClient } from 'pg';
import { SchemaMetadata, TableMetadata } from '../introspection';
import { QueryBuilder } from '../query-builder';
import { ConflictError } from '../errors';

export class NestedWriter {
  constructor(private metadata: SchemaMetadata) {}

  async create(
    client: PoolClient,
    table: TableMetadata,
    body: Record<string, unknown>,
    parentContext?: { fkColumn: string; fkValue: unknown },
  ): Promise<Record<string, unknown>> {
    const { scalar, nested } = this.separateFields(body, table);

    if (parentContext) {
      scalar[parentContext.fkColumn] = parentContext.fkValue;
    }

    const qb = new QueryBuilder(table);
    const { sql, params } = qb.buildInsert(scalar);
    const result = await client.query(sql, params);
    const record = result.rows[0];

    for (const [key, rows] of Object.entries(nested)) {
      const childTable = this.resolveChildTable(table, key);
      if (!childTable) continue;

      const fkCol = this.findFkColumn(childTable.table, table);
      if (!fkCol) continue;

      const pkCol = table.primaryKey?.columns[0] || 'id';
      record[key] = [];

      for (const row of rows as Record<string, unknown>[]) {
        const child = await this.create(client, childTable.table, row, {
          fkColumn: fkCol,
          fkValue: record[pkCol],
        });
        record[key].push(child);
      }
    }

    return record;
  }

  async update(
    client: PoolClient,
    table: TableMetadata,
    id: unknown,
    body: Record<string, unknown>,
    versionCheck?: number,
  ): Promise<Record<string, unknown>> {
    const { scalar, nested } = this.separateFields(body, table);

    const qb = new QueryBuilder(table);
    const { sql, params } = qb.buildUpdate(id, scalar, { versionCheck });
    const result = await client.query(sql, params);

    if (result.rowCount === 0) {
      if (versionCheck !== undefined) {
        throw new ConflictError('Version conflict: record has been modified by another request');
      }
      throw new ConflictError('Record not found or has been deleted');
    }

    const record = result.rows[0];

    for (const [key, rows] of Object.entries(nested)) {
      const childTable = this.resolveChildTable(table, key);
      if (!childTable) continue;

      const fkCol = this.findFkColumn(childTable.table, table);
      if (!fkCol) continue;

      const pkCol = table.primaryKey?.columns[0] || 'id';
      record[key] = [];

      for (const row of rows as Record<string, unknown>[]) {
        const childPk = childTable.table.primaryKey?.columns[0] || 'id';
        if (row[childPk]) {
          const child = await this.update(client, childTable.table, row[childPk], row);
          record[key].push(child);
        } else {
          const child = await this.create(client, childTable.table, row, {
            fkColumn: fkCol,
            fkValue: record[pkCol],
          });
          record[key].push(child);
        }
      }
    }

    return record;
  }

  private separateFields(
    body: Record<string, unknown>,
    table: TableMetadata,
  ): { scalar: Record<string, unknown>; nested: Record<string, unknown[]> } {
    const scalar: Record<string, unknown> = {};
    const nested: Record<string, unknown[]> = {};
    const columnNames = new Set(table.columns.map(c => c.name));

    for (const [key, value] of Object.entries(body)) {
      if (Array.isArray(value) && !columnNames.has(key)) {
        nested[key] = value;
      } else if (columnNames.has(key)) {
        scalar[key] = value;
      }
    }

    return { scalar, nested };
  }

  private resolveChildTable(parent: TableMetadata, name: string): { table: TableMetadata } | null {
    for (const [key, table] of this.metadata.tables) {
      if (table.name === name) {
        const hasFk = table.foreignKeys.some(fk => fk.referencedTable === parent.name);
        if (hasFk) return { table };
      }
    }
    return null;
  }

  private findFkColumn(child: TableMetadata, parent: TableMetadata): string | null {
    const fk = child.foreignKeys.find(f => f.referencedTable === parent.name);
    return fk?.columns[0] || null;
  }
}
