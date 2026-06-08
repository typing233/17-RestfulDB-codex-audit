import { SchemaMetadata, TableMetadata, ForeignKeyMetadata } from '../introspection';
import { ValidationError } from '../errors';

export interface EmbedRequest {
  relation: string;
  table: TableMetadata;
  fkColumn: string;
  parentColumn: string;
  isParent: boolean;
  nested?: EmbedRequest[];
}

export function parseEmbed(
  raw: string | undefined,
  table: TableMetadata,
  metadata: SchemaMetadata,
): EmbedRequest[] {
  if (!raw) return [];

  const parts = raw.split(',').map(s => s.trim());
  const embeds: EmbedRequest[] = [];

  for (const part of parts) {
    const segments = part.split('.');
    let currentTable = table;
    let currentEmbeds = embeds;

    for (const segment of segments) {
      const existing = currentEmbeds.find(e => e.relation === segment);
      if (existing) {
        currentTable = existing.table;
        currentEmbeds = existing.nested || [];
        continue;
      }

      const resolved = resolveRelation(segment, currentTable, metadata);
      if (!resolved) {
        throw new ValidationError(`Cannot resolve embed relation: ${segment} from table ${currentTable.name}`);
      }

      const embed: EmbedRequest = { ...resolved, nested: [] };
      currentEmbeds.push(embed);
      currentTable = resolved.table;
      currentEmbeds = embed.nested!;
    }
  }

  return embeds;
}

function resolveRelation(
  name: string,
  table: TableMetadata,
  metadata: SchemaMetadata,
): Omit<EmbedRequest, 'nested'> | null {
  for (const fk of table.foreignKeys) {
    if (fk.referencedTable === name || fk.columns[0] === name + '_id') {
      const refTable = metadata.tables.get(`${fk.referencedSchema}.${fk.referencedTable}`);
      if (refTable) {
        return {
          relation: name,
          table: refTable,
          fkColumn: fk.columns[0],
          parentColumn: fk.referencedColumns[0],
          isParent: true,
        };
      }
    }
  }

  for (const ref of table.referencedBy) {
    if (ref.referencedTable === name) {
      const childTable = metadata.tables.get(`${ref.referencedSchema}.${ref.referencedTable}`);
      if (childTable) {
        return {
          relation: name,
          table: childTable,
          fkColumn: ref.referencedColumns[0],
          parentColumn: table.primaryKey?.columns[0] || 'id',
          isParent: false,
        };
      }
    }
  }

  for (const [key, t] of metadata.tables) {
    if (t.name === name) {
      const fk = t.foreignKeys.find(f => f.referencedTable === table.name);
      if (fk) {
        return {
          relation: name,
          table: t,
          fkColumn: fk.columns[0],
          parentColumn: fk.referencedColumns[0],
          isParent: false,
        };
      }
    }
  }

  return null;
}
