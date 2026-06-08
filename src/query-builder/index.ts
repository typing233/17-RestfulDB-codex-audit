import { TableMetadata } from '../introspection';
import { FilterCondition } from './filter-parser';
import { OrderClause } from './order-parser';
import { quote } from '../utils/naming';

export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

export class QueryBuilder {
  private table: TableMetadata;

  constructor(table: TableMetadata) {
    this.table = table;
  }

  private get fullTableName(): string {
    return `${quote(this.table.schema)}.${quote(this.table.name)}`;
  }

  buildSelect(opts: {
    columns?: string[] | null;
    filters?: FilterCondition[];
    order?: OrderClause[];
    limit?: number;
    offset?: number;
    extraWhere?: { column: string; value: unknown };
    keysetCondition?: { sql: string; params: unknown[] };
  }): BuiltQuery {
    const params: unknown[] = [];
    let paramIdx = 0;

    const cols = opts.columns && opts.columns.length > 0
      ? opts.columns.map(c => quote(c)).join(', ')
      : '*';

    let sql = `SELECT ${cols} FROM ${this.fullTableName}`;

    const whereClauses: string[] = [];

    if (opts.extraWhere) {
      paramIdx++;
      whereClauses.push(`${quote(opts.extraWhere.column)} = $${paramIdx}`);
      params.push(opts.extraWhere.value);
    }

    if (opts.filters) {
      for (const f of opts.filters) {
        if (f.isNull) {
          whereClauses.push(`${quote(f.column)} ${f.operator}`);
          continue;
        }
        if (f.operator === 'BETWEEN') {
          const vals = f.value as unknown[];
          paramIdx++;
          const p1 = paramIdx;
          params.push(vals[0]);
          paramIdx++;
          const p2 = paramIdx;
          params.push(vals[1]);
          whereClauses.push(`${quote(f.column)} BETWEEN $${p1} AND $${p2}`);
        } else if (f.operator === 'IN' || f.operator === 'NOT IN') {
          paramIdx++;
          params.push(f.value);
          if (f.operator === 'NOT IN') {
            whereClauses.push(`${quote(f.column)} != ALL($${paramIdx})`);
          } else {
            whereClauses.push(`${quote(f.column)} = ANY($${paramIdx})`);
          }
        } else {
          paramIdx++;
          whereClauses.push(`${quote(f.column)} ${f.operator} $${paramIdx}`);
          params.push(f.value);
        }
      }
    }

    if (opts.keysetCondition && opts.keysetCondition.sql) {
      let idxCounter = 0;
      const reindexed = opts.keysetCondition.sql.replace(/\$IDX(\d+)/g, () => {
        idxCounter++;
        return `$${paramIdx + idxCounter}`;
      });
      paramIdx += opts.keysetCondition.params.length;
      whereClauses.push(reindexed);
      params.push(...opts.keysetCondition.params);
    }

    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    if (opts.order && opts.order.length > 0) {
      const orderStr = opts.order.map(o => `${quote(o.column)} ${o.direction}`).join(', ');
      sql += ` ORDER BY ${orderStr}`;
    }

    if (opts.limit !== undefined) {
      paramIdx++;
      sql += ` LIMIT $${paramIdx}`;
      params.push(opts.limit);
    }

    if (opts.offset !== undefined && opts.offset > 0) {
      paramIdx++;
      sql += ` OFFSET $${paramIdx}`;
      params.push(opts.offset);
    }

    return { sql, params };
  }

  buildCount(opts: {
    filters?: FilterCondition[];
    extraWhere?: { column: string; value: unknown };
  }): BuiltQuery {
    const params: unknown[] = [];
    let paramIdx = 0;

    let sql = `SELECT count(*) AS total FROM ${this.fullTableName}`;
    const whereClauses: string[] = [];

    if (opts.extraWhere) {
      paramIdx++;
      whereClauses.push(`${quote(opts.extraWhere.column)} = $${paramIdx}`);
      params.push(opts.extraWhere.value);
    }

    if (opts.filters) {
      for (const f of opts.filters) {
        if (f.isNull) {
          whereClauses.push(`${quote(f.column)} ${f.operator}`);
          continue;
        }
        if (f.operator === 'BETWEEN') {
          const vals = f.value as unknown[];
          paramIdx++;
          params.push(vals[0]);
          paramIdx++;
          params.push(vals[1]);
          whereClauses.push(`${quote(f.column)} BETWEEN $${paramIdx - 1} AND $${paramIdx}`);
        } else if (f.operator === 'IN' || f.operator === 'NOT IN') {
          paramIdx++;
          params.push(f.value);
          if (f.operator === 'NOT IN') {
            whereClauses.push(`${quote(f.column)} != ALL($${paramIdx})`);
          } else {
            whereClauses.push(`${quote(f.column)} = ANY($${paramIdx})`);
          }
        } else {
          paramIdx++;
          whereClauses.push(`${quote(f.column)} ${f.operator} $${paramIdx}`);
          params.push(f.value);
        }
      }
    }

    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    return { sql, params };
  }

  buildEstimateCount(): BuiltQuery {
    return {
      sql: `SELECT reltuples::bigint AS total FROM pg_class WHERE oid = $1::regclass`,
      params: [this.fullTableName],
    };
  }

  buildPlannedCount(opts: {
    filters?: FilterCondition[];
    extraWhere?: { column: string; value: unknown };
  }): BuiltQuery {
    const countQuery = this.buildCount(opts);
    return {
      sql: `EXPLAIN (FORMAT JSON) ${countQuery.sql}`,
      params: countQuery.params,
    };
  }

  buildInsert(data: Record<string, unknown>): BuiltQuery {
    const columns: string[] = [];
    const placeholders: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 0;

    for (const [key, value] of Object.entries(data)) {
      const col = this.table.columns.find(c => c.name === key);
      if (!col || col.isGenerated) continue;
      columns.push(quote(key));
      paramIdx++;
      placeholders.push(`$${paramIdx}`);
      params.push(value);
    }

    const sql = `INSERT INTO ${this.fullTableName} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
    return { sql, params };
  }

  buildBulkInsert(rows: Record<string, unknown>[]): BuiltQuery {
    if (rows.length === 0) return { sql: '', params: [] };

    const validColumns = this.table.columns.filter(c => !c.isGenerated);
    const colNames = validColumns.map(c => c.name);
    const firstRow = rows[0];
    const insertCols = colNames.filter(c => c in firstRow);

    const params: unknown[] = [];
    let paramIdx = 0;
    const valueGroups: string[] = [];

    for (const row of rows) {
      const placeholders: string[] = [];
      for (const col of insertCols) {
        paramIdx++;
        placeholders.push(`$${paramIdx}`);
        params.push(row[col] ?? null);
      }
      valueGroups.push(`(${placeholders.join(', ')})`);
    }

    const sql = `INSERT INTO ${this.fullTableName} (${insertCols.map(quote).join(', ')}) VALUES ${valueGroups.join(', ')} RETURNING *`;
    return { sql, params };
  }

  buildUpdate(id: unknown, data: Record<string, unknown>, options?: { versionCheck?: number }): BuiltQuery {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 0;

    const pkCol = this.table.primaryKey?.columns[0] || 'id';

    for (const [key, value] of Object.entries(data)) {
      if (key === pkCol) continue;
      if (key === 'version' && this.table.hasVersionColumn) continue;
      const col = this.table.columns.find(c => c.name === key);
      if (!col || col.isGenerated) continue;
      paramIdx++;
      setClauses.push(`${quote(key)} = $${paramIdx}`);
      params.push(value);
    }

    if (this.table.hasVersionColumn) {
      setClauses.push(`${quote('version')} = ${quote('version')} + 1`);
    }

    paramIdx++;
    params.push(id);
    let sql = `UPDATE ${this.fullTableName} SET ${setClauses.join(', ')} WHERE ${quote(pkCol)} = $${paramIdx}`;

    if (options?.versionCheck !== undefined) {
      paramIdx++;
      sql += ` AND ${quote('version')} = $${paramIdx}`;
      params.push(options.versionCheck);
    }

    sql += ' RETURNING *';
    return { sql, params };
  }

  buildBulkUpdate(data: Record<string, unknown>, filters: FilterCondition[], extraWhere?: { column: string; value: unknown }): BuiltQuery {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 0;

    const pkCol = this.table.primaryKey?.columns[0] || 'id';

    for (const [key, value] of Object.entries(data)) {
      if (key === pkCol) continue;
      if (key === 'version' && this.table.hasVersionColumn) continue;
      const col = this.table.columns.find(c => c.name === key);
      if (!col || col.isGenerated) continue;
      paramIdx++;
      setClauses.push(`${quote(key)} = $${paramIdx}`);
      params.push(value);
    }

    if (this.table.hasVersionColumn) {
      setClauses.push(`${quote('version')} = ${quote('version')} + 1`);
    }

    if (setClauses.length === 0) return { sql: '', params: [] };

    let sql = `UPDATE ${this.fullTableName} SET ${setClauses.join(', ')}`;
    const whereClauses: string[] = [];

    if (extraWhere) {
      paramIdx++;
      whereClauses.push(`${quote(extraWhere.column)} = $${paramIdx}`);
      params.push(extraWhere.value);
    }

    for (const f of filters) {
      if (f.isNull) {
        whereClauses.push(`${quote(f.column)} ${f.operator}`);
        continue;
      }
      if (f.operator === 'IN' || f.operator === 'NOT IN') {
        paramIdx++;
        params.push(f.value);
        whereClauses.push(f.operator === 'NOT IN'
          ? `${quote(f.column)} != ALL($${paramIdx})`
          : `${quote(f.column)} = ANY($${paramIdx})`);
      } else {
        paramIdx++;
        whereClauses.push(`${quote(f.column)} ${f.operator} $${paramIdx}`);
        params.push(f.value);
      }
    }

    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    sql += ' RETURNING *';
    return { sql, params };
  }

  buildDelete(id: unknown): BuiltQuery {
    const pkCol = this.table.primaryKey?.columns[0] || 'id';
    const sql = `DELETE FROM ${this.fullTableName} WHERE ${quote(pkCol)} = $1 RETURNING *`;
    return { sql, params: [id] };
  }

  buildBulkDelete(filters: FilterCondition[], extraWhere?: { column: string; value: unknown }): BuiltQuery {
    const params: unknown[] = [];
    let paramIdx = 0;

    let sql = `DELETE FROM ${this.fullTableName}`;
    const whereClauses: string[] = [];

    if (extraWhere) {
      paramIdx++;
      whereClauses.push(`${quote(extraWhere.column)} = $${paramIdx}`);
      params.push(extraWhere.value);
    }

    for (const f of filters) {
      if (f.isNull) {
        whereClauses.push(`${quote(f.column)} ${f.operator}`);
        continue;
      }
      if (f.operator === 'IN' || f.operator === 'NOT IN') {
        paramIdx++;
        params.push(f.value);
        whereClauses.push(f.operator === 'NOT IN'
          ? `${quote(f.column)} != ALL($${paramIdx})`
          : `${quote(f.column)} = ANY($${paramIdx})`);
      } else {
        paramIdx++;
        whereClauses.push(`${quote(f.column)} ${f.operator} $${paramIdx}`);
        params.push(f.value);
      }
    }

    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    sql += ' RETURNING *';
    return { sql, params };
  }
}

export { parseFilters, FilterCondition } from './filter-parser';
export { parseSelect } from './select-parser';
export { parseOrder, OrderClause } from './order-parser';
export { parsePagination, PaginationParams, parseCountStrategy, CountStrategy } from './pagination';
export { parseEmbed, EmbedRequest, buildJoinQuery } from './embed-resolver';
export { parseCursor, decodeCursor, encodeCursor, buildKeysetCondition, ensureStableSort, getCursorColumns, reverseOrder, CursorParams } from './cursor-pagination';
