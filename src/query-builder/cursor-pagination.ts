import { TableMetadata } from '../introspection';
import { OrderClause } from './order-parser';
import { quote } from '../utils/naming';

export interface CursorParams {
  after?: string;
  before?: string;
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
): { sql: string; params: unknown[] } {
  const relevantOrder = order.filter(o => cursor[o.column] !== undefined);
  if (relevantOrder.length === 0) return { sql: '', params: [] };

  const params: unknown[] = [];

  if (relevantOrder.length === 1) {
    const o = relevantOrder[0];
    const op = getOperator(o.direction, direction);
    params.push(cursor[o.column]);
    return { sql: `${quote(o.column)} ${op} $IDX1`, params };
  }

  // Multi-column keyset: use SQL row-value comparison with proper ordering
  // For mixed directions we use the expanded OR form:
  // (a > v1) OR (a = v1 AND b < v2) OR (a = v1 AND b = v2 AND c > v3) ...
  const clauses: string[] = [];

  for (let depth = 0; depth < relevantOrder.length; depth++) {
    const parts: string[] = [];
    for (let i = 0; i < depth; i++) {
      const o = relevantOrder[i];
      params.push(cursor[o.column]);
      parts.push(`${quote(o.column)} = $IDX${params.length}`);
    }
    const o = relevantOrder[depth];
    const op = getOperator(o.direction, direction);
    params.push(cursor[o.column]);
    parts.push(`${quote(o.column)} ${op} $IDX${params.length}`);
    clauses.push(`(${parts.join(' AND ')})`);
  }

  return { sql: `(${clauses.join(' OR ')})`, params };
}

function getOperator(sortDir: 'ASC' | 'DESC', cursorDir: 'forward' | 'backward'): string {
  if (cursorDir === 'forward') {
    return sortDir === 'ASC' ? '>' : '<';
  }
  return sortDir === 'ASC' ? '<' : '>';
}

export function reverseOrder(order: OrderClause[]): OrderClause[] {
  return order.map(o => ({
    column: o.column,
    direction: o.direction === 'ASC' ? 'DESC' : 'ASC',
  }));
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
