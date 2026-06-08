import { TableMetadata } from '../introspection';
import { ValidationError } from '../errors';

export interface OrderClause {
  column: string;
  direction: 'ASC' | 'DESC';
}

export function parseOrder(raw: string | undefined, table: TableMetadata): OrderClause[] {
  if (!raw) return [];
  const columnNames = new Set(table.columns.map(c => c.name));
  const clauses: OrderClause[] = [];

  const parts = raw.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    const dotIdx = trimmed.lastIndexOf('.');
    let column: string;
    let direction: 'ASC' | 'DESC' = 'ASC';

    if (dotIdx !== -1) {
      column = trimmed.substring(0, dotIdx);
      const dir = trimmed.substring(dotIdx + 1).toLowerCase();
      if (dir === 'desc') direction = 'DESC';
      else if (dir === 'asc') direction = 'ASC';
      else {
        column = trimmed;
      }
    } else {
      column = trimmed;
    }

    if (!columnNames.has(column)) {
      throw new ValidationError(`Unknown column in order: ${column}`, [{ field: column, issue: 'not found in table' }]);
    }

    clauses.push({ column, direction });
  }

  return clauses;
}
