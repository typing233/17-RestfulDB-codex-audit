import { TableMetadata } from '../introspection';
import { ValidationError } from '../errors';

export type SqlOperator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'ILIKE' | 'IN' | 'NOT IN' | 'IS NULL' | 'IS NOT NULL' | 'BETWEEN';

export interface FilterCondition {
  column: string;
  operator: SqlOperator;
  value: unknown;
  isNull?: boolean;
}

const OPERATOR_MAP: Record<string, { sql: SqlOperator; paramStyle: 'single' | 'array' | 'range' | 'none' }> = {
  'eq': { sql: '=', paramStyle: 'single' },
  'neq': { sql: '!=', paramStyle: 'single' },
  'gt': { sql: '>', paramStyle: 'single' },
  'gte': { sql: '>=', paramStyle: 'single' },
  'lt': { sql: '<', paramStyle: 'single' },
  'lte': { sql: '<=', paramStyle: 'single' },
  'like': { sql: 'LIKE', paramStyle: 'single' },
  'ilike': { sql: 'ILIKE', paramStyle: 'single' },
  'in': { sql: 'IN', paramStyle: 'array' },
  'notin': { sql: 'NOT IN', paramStyle: 'array' },
  'is': { sql: 'IS NULL', paramStyle: 'none' },
  'isnot': { sql: 'IS NOT NULL', paramStyle: 'none' },
  'between': { sql: 'BETWEEN', paramStyle: 'range' },
};

export function parseFilters(
  query: Record<string, string>,
  table: TableMetadata,
): FilterCondition[] {
  const reservedKeys = new Set(['select', 'order', 'limit', 'offset', 'embed']);
  const conditions: FilterCondition[] = [];
  const columnNames = new Set(table.columns.map(c => c.name));

  for (const [key, rawValue] of Object.entries(query)) {
    if (reservedKeys.has(key)) continue;
    if (!columnNames.has(key)) continue;

    const dotIndex = rawValue.indexOf('.');
    if (dotIndex === -1) {
      conditions.push({ column: key, operator: '=', value: rawValue });
      continue;
    }

    const opStr = rawValue.substring(0, dotIndex);
    const valueStr = rawValue.substring(dotIndex + 1);
    const opDef = OPERATOR_MAP[opStr];

    if (!opDef) {
      conditions.push({ column: key, operator: '=', value: rawValue });
      continue;
    }

    switch (opDef.paramStyle) {
      case 'none':
        conditions.push({ column: key, operator: opDef.sql, value: null, isNull: true });
        break;
      case 'single':
        conditions.push({ column: key, operator: opDef.sql, value: coerceValue(valueStr, table, key) });
        break;
      case 'array': {
        const items = parseArrayValue(valueStr);
        conditions.push({ column: key, operator: opDef.sql, value: items.map(v => coerceValue(v, table, key)) });
        break;
      }
      case 'range': {
        const parts = valueStr.split(',');
        if (parts.length !== 2) {
          throw new ValidationError(`BETWEEN requires exactly two values for column ${key}`);
        }
        conditions.push({
          column: key,
          operator: 'BETWEEN',
          value: [coerceValue(parts[0], table, key), coerceValue(parts[1], table, key)],
        });
        break;
      }
    }
  }

  return conditions;
}

function parseArrayValue(raw: string): string[] {
  let str = raw;
  if (str.startsWith('(') && str.endsWith(')')) {
    str = str.slice(1, -1);
  }
  return str.split(',').map(s => s.trim());
}

function coerceValue(val: string, table: TableMetadata, columnName: string): unknown {
  const col = table.columns.find(c => c.name === columnName);
  if (!col) return val;

  const numericTypes = ['int2', 'int4', 'int8', 'float4', 'float8', 'numeric', 'integer', 'bigint', 'smallint', 'real', 'double precision'];
  if (numericTypes.includes(col.udtName)) {
    const num = Number(val);
    if (!isNaN(num)) return num;
  }

  if (col.udtName === 'bool') {
    if (val === 'true') return true;
    if (val === 'false') return false;
  }

  return val;
}
