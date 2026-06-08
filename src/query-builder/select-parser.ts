import { TableMetadata } from '../introspection';
import { ValidationError } from '../errors';

export function parseSelect(raw: string | undefined, table: TableMetadata): string[] | null {
  if (!raw) return null;
  const columnNames = new Set(table.columns.map(c => c.name));
  const requested = raw.split(',').map(s => s.trim());

  for (const col of requested) {
    if (!columnNames.has(col)) {
      throw new ValidationError(`Unknown column in select: ${col}`, [{ field: col, issue: 'not found in table' }]);
    }
  }

  return requested;
}
