import { TableMetadata } from '../introspection';
import { OrderClause } from './order-parser';
import { quote } from '../utils/naming';

export interface CursorParams {
  after?: string;
  before?: string;
}

interface CursorValue {
  columns: string[];
  values: unknown[];
  direction: 'forward' | 'backward';
}

export function parseCursor(query: { after?: string; before?: string }): CursorParams {
  return { after: query.after, before: query.before };
}

export function decodeCursor(cursor: string): Record<string, unknown> | null {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function encodeCursor(row: Record<string, unknown>, keyColumns: string[]): string {
  const data: Record<string, unknown> = {};
  for (const col of keyColumns) {
    data[col] = row[col];
  }
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

export function buildKeysetCondition(
  cursor: Record<string, unknown>,
  order: OrderClause[],
  direction: 'forward' | 'backward',
  startParamIdx: number,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const columns: string[] = [];
  const placeholders: string[] = [];

  for (const o of order) {
    const val = cursor[o.column];
    if (val === undefined) continue;
    columns.push(quote(o.column));
    params.push(val);
    placeholders.push(`$${startParamIdx + params.length - 1 + 1}`);
  }

  if (columns.length === 0) return { sql: '', params: [] };

  const ops = order.map(o => {
    const isAsc = o.direction === 'ASC';
    if (direction === 'forward') return isAsc ? '>' : '<';
    return isAsc ? '<' : '>';
  });

  if (columns.length === 1) {
    return {
      sql: `${columns[0]} ${ops[0]} $${startParamIdx + 1}`,
      params,
    };
  }

  const sql = `(${columns.join(', ')}) ${ops[0] === '>' ? '>' : '<'} (${placeholders.join(', ')})`;
  return { sql, params };
}

export function ensureStableSort(order: OrderClause[], table: TableMetadata): OrderClause[] {
  const pkCols = table.primaryKey?.columns || [];
  const result = [...order];

  for (const pkCol of pkCols) {
    if (!result.some(o => o.column === pkCol)) {
      result.push({ column: pkCol, direction: 'ASC' });
    }
  }

  return result;
}

export function getCursorColumns(order: OrderClause[]): string[] {
  return order.map(o => o.column);
}
