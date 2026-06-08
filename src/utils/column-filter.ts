import { Request } from 'express';
import { TableMetadata, MetadataStore } from '../introspection';

export function filterColumnsForRole(
  row: Record<string, unknown>,
  table: TableMetadata,
  metadataStore: MetadataStore,
  role: string | undefined,
): Record<string, unknown> {
  if (!role) return row;
  const allowed = metadataStore.getAccessibleColumns(table, role, 'SELECT');
  const allowedSet = new Set(allowed);
  const tableColSet = new Set(table.columns.map(c => c.name));
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (allowedSet.has(key) || !tableColSet.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

export function filterRowsColumns(
  rows: Record<string, unknown>[],
  table: TableMetadata,
  metadataStore: MetadataStore,
  role: string | undefined,
): Record<string, unknown>[] {
  if (!role) return rows;
  const allowed = metadataStore.getAccessibleColumns(table, role, 'SELECT');
  if (allowed.length === table.columns.length) return rows;
  const allowedSet = new Set(allowed);
  const tableColSet = new Set(table.columns.map(c => c.name));
  return rows.map(row => {
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (allowedSet.has(key) || !tableColSet.has(key)) {
        filtered[key] = value;
      }
    }
    return filtered;
  });
}

export function getVisibleTablesForRole(
  metadataStore: MetadataStore,
  role: string | undefined,
): TableMetadata[] {
  if (!role) return [...metadataStore.get().tables.values()];
  return [...metadataStore.get().tables.values()].filter(
    t => metadataStore.hasTablePrivilege(t, role, 'select')
  );
}

export function getVisibleColumnsForRole(
  table: TableMetadata,
  metadataStore: MetadataStore,
  role: string | undefined,
): string[] {
  if (!role) return table.columns.map(c => c.name);
  return metadataStore.getAccessibleColumns(table, role, 'SELECT');
}
