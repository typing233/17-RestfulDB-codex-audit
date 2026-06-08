import { ColumnMetadata } from '../introspection';

const TYPE_MAP: Record<string, { type: string; format?: string }> = {
  'int2': { type: 'integer' },
  'int4': { type: 'integer' },
  'int8': { type: 'integer', format: 'int64' },
  'float4': { type: 'number', format: 'float' },
  'float8': { type: 'number', format: 'double' },
  'numeric': { type: 'number' },
  'bool': { type: 'boolean' },
  'varchar': { type: 'string' },
  'text': { type: 'string' },
  'char': { type: 'string' },
  'bpchar': { type: 'string' },
  'uuid': { type: 'string', format: 'uuid' },
  'timestamp': { type: 'string', format: 'date-time' },
  'timestamptz': { type: 'string', format: 'date-time' },
  'date': { type: 'string', format: 'date' },
  'time': { type: 'string', format: 'time' },
  'timetz': { type: 'string', format: 'time' },
  'json': { type: 'object' },
  'jsonb': { type: 'object' },
  'bytea': { type: 'string', format: 'byte' },
  'inet': { type: 'string' },
  'cidr': { type: 'string' },
  'macaddr': { type: 'string' },
};

export function pgTypeToJsonSchema(col: ColumnMetadata): Record<string, unknown> {
  if (col.udtName.startsWith('_')) {
    const innerType = col.udtName.slice(1);
    const mapped = TYPE_MAP[innerType] || { type: 'string' };
    return { type: 'array', items: mapped };
  }

  const mapped = TYPE_MAP[col.udtName] || { type: 'string' };
  const schema: Record<string, unknown> = { ...mapped };

  if (col.maxLength) {
    schema.maxLength = col.maxLength;
  }

  if (col.isNullable) {
    schema.nullable = true;
  }

  return schema;
}
