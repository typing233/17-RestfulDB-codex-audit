import { SchemaMetadata, TableMetadata, ForeignKeyMetadata } from '../introspection';
import { ValidationError } from '../errors';
import { quote } from '../utils/naming';

export interface EmbedRequest {
  relation: string;
  table: TableMetadata;
  fkColumns: string[];
  parentColumns: string[];
  fkColumn: string;
  parentColumn: string;
  isParent: boolean;
  nested?: EmbedRequest[];
  hint?: string;
}

function makeEmbed(data: {
  relation: string;
  table: TableMetadata;
  fkColumns: string[];
  parentColumns: string[];
  isParent: boolean;
  hint?: string;
  nested?: EmbedRequest[];
}): EmbedRequest {
  return {
    ...data,
    fkColumn: data.fkColumns[0],
    parentColumn: data.parentColumns[0],
    nested: data.nested || [],
  };
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
      const { name, hint } = parseSegmentHint(segment);

      const existing = currentEmbeds.find(e => e.relation === name && (!hint || e.hint === hint));
      if (existing) {
        currentTable = existing.table;
        currentEmbeds = existing.nested || [];
        continue;
      }

      const resolved = resolveRelation(name, currentTable, metadata, hint);
      if (!resolved) {
        throw new ValidationError(`Cannot resolve embed relation: ${name} from table ${currentTable.name}`);
      }

      const embed = makeEmbed({ ...resolved, nested: [] });
      currentEmbeds.push(embed);
      currentTable = resolved.table;
      currentEmbeds = embed.nested!;
    }
  }

  return embeds;
}

function parseSegmentHint(segment: string): { name: string; hint?: string } {
  const match = segment.match(/^(\w+)(?:\((\w+)\))?$/);
  if (!match) return { name: segment };
  return { name: match[1], hint: match[2] };
}

interface ResolvedRelation {
  relation: string;
  table: TableMetadata;
  fkColumns: string[];
  parentColumns: string[];
  isParent: boolean;
  hint?: string;
}

function resolveRelation(
  name: string,
  table: TableMetadata,
  metadata: SchemaMetadata,
  hint?: string,
): ResolvedRelation | null {
  const parentCandidates: { fk: ForeignKeyMetadata; target: TableMetadata }[] = [];
  for (const fk of table.foreignKeys) {
    if (fk.referencedTable === name || (hint && fk.columns.includes(hint))) {
      const refTable = metadata.tables.get(`${fk.referencedSchema}.${fk.referencedTable}`);
      if (refTable) {
        parentCandidates.push({ fk, target: refTable });
      }
    }
  }

  if (parentCandidates.length === 1) {
    const { fk, target } = parentCandidates[0];
    return { relation: name, table: target, fkColumns: fk.columns, parentColumns: fk.referencedColumns, isParent: true, hint };
  }

  if (parentCandidates.length > 1 && hint) {
    const match = parentCandidates.find(c => c.fk.columns.includes(hint) || c.fk.constraintName === hint);
    if (match) {
      return { relation: name, table: match.target, fkColumns: match.fk.columns, parentColumns: match.fk.referencedColumns, isParent: true, hint };
    }
  }

  if (parentCandidates.length > 1) {
    throw new ValidationError(
      `Ambiguous relation "${name}" from "${table.name}": multiple FKs found. Use hint: ${name}(fk_column)`
    );
  }

  const childCandidates: { fk: ForeignKeyMetadata; target: TableMetadata }[] = [];
  for (const ref of table.referencedBy) {
    if (ref.referencedTable === name || (hint && ref.referencedColumns.includes(hint))) {
      const childTable = metadata.tables.get(`${ref.referencedSchema}.${ref.referencedTable}`);
      if (childTable) {
        childCandidates.push({ fk: ref, target: childTable });
      }
    }
  }

  // Self-reference
  if (childCandidates.length === 0 && name === table.name) {
    for (const fk of table.foreignKeys) {
      if (fk.referencedTable === table.name) {
        childCandidates.push({ fk, target: table });
      }
    }
    if (childCandidates.length > 0) {
      const match = hint
        ? childCandidates.find(c => c.fk.columns.includes(hint)) || childCandidates[0]
        : childCandidates[0];
      return {
        relation: name, table: match.target,
        fkColumns: match.fk.columns, parentColumns: match.fk.referencedColumns,
        isParent: false, hint,
      };
    }
  }

  if (childCandidates.length === 1) {
    const { fk, target } = childCandidates[0];
    return { relation: name, table: target, fkColumns: fk.referencedColumns, parentColumns: fk.columns, isParent: false, hint };
  }

  if (childCandidates.length > 1 && hint) {
    const match = childCandidates.find(c => c.fk.referencedColumns.includes(hint) || c.fk.constraintName === hint);
    if (match) {
      return { relation: name, table: match.target, fkColumns: match.fk.referencedColumns, parentColumns: match.fk.columns, isParent: false, hint };
    }
  }

  if (childCandidates.length > 1) {
    throw new ValidationError(
      `Ambiguous relation "${name}" from "${table.name}": multiple incoming FKs. Use hint: ${name}(fk_column)`
    );
  }

  // Broader search
  for (const [, t] of metadata.tables) {
    if (t.name === name && t !== table) {
      const fk = t.foreignKeys.find(f => f.referencedTable === table.name);
      if (fk) {
        return { relation: name, table: t, fkColumns: fk.columns, parentColumns: fk.referencedColumns, isParent: false, hint };
      }
      const reverseFk = table.foreignKeys.find(f => f.referencedTable === t.name);
      if (reverseFk) {
        return { relation: name, table: t, fkColumns: reverseFk.columns, parentColumns: reverseFk.referencedColumns, isParent: true, hint };
      }
    }
  }

  return null;
}

export function buildJoinQuery(
  baseTable: TableMetadata,
  embeds: EmbedRequest[],
): { joinClauses: string[]; selectAliases: string[] } {
  const joinClauses: string[] = [];
  const selectAliases: string[] = [];
  let aliasIdx = 0;

  function traverse(parentAlias: string, parentTable: TableMetadata, embedList: EmbedRequest[]) {
    for (const embed of embedList) {
      aliasIdx++;
      const alias = `_e${aliasIdx}`;
      const targetFull = `${quote(embed.table.schema)}.${quote(embed.table.name)}`;

      const joinConditions: string[] = [];
      for (let i = 0; i < embed.fkColumns.length; i++) {
        if (embed.isParent) {
          joinConditions.push(
            `${parentAlias}.${quote(embed.fkColumns[i])} = ${alias}.${quote(embed.parentColumns[i])}`
          );
        } else {
          joinConditions.push(
            `${parentAlias}.${quote(embed.parentColumns[i])} = ${alias}.${quote(embed.fkColumns[i])}`
          );
        }
      }

      joinClauses.push(
        `LEFT JOIN ${targetFull} AS ${alias} ON ${joinConditions.join(' AND ')}`
      );
      selectAliases.push(alias);

      if (embed.nested && embed.nested.length > 0) {
        traverse(alias, embed.table, embed.nested);
      }
    }
  }

  const baseAlias = quote(baseTable.name);
  traverse(baseAlias, baseTable, embeds);

  return { joinClauses, selectAliases };
}
