export type RelKind = 'table' | 'view' | 'matview';

export interface ColumnMetadata {
  name: string;
  dataType: string;
  udtName: string;
  isNullable: boolean;
  hasDefault: boolean;
  defaultValue: string | null;
  maxLength: number | null;
  isGenerated: boolean;
  ordinalPosition: number;
}

export interface PrimaryKeyMetadata {
  constraintName: string;
  columns: string[];
}

export interface ForeignKeyMetadata {
  constraintName: string;
  columns: string[];
  referencedTable: string;
  referencedSchema: string;
  referencedColumns: string[];
  onDelete: string;
  onUpdate: string;
}

export interface UniqueConstraintMetadata {
  constraintName: string;
  columns: string[];
}

export interface ColumnPrivilege {
  column: string;
  grantee: string;
  privilegeType: 'SELECT' | 'INSERT' | 'UPDATE';
}

export interface TablePrivileges {
  select: Set<string>;
  insert: Set<string>;
  update: Set<string>;
  delete: Set<string>;
}

export interface TableMetadata {
  schema: string;
  name: string;
  relKind: RelKind;
  columns: ColumnMetadata[];
  primaryKey: PrimaryKeyMetadata | null;
  foreignKeys: ForeignKeyMetadata[];
  referencedBy: ForeignKeyMetadata[];
  uniqueConstraints: UniqueConstraintMetadata[];
  hasVersionColumn: boolean;
  privileges: TablePrivileges;
  columnPrivileges: ColumnPrivilege[];
}

export interface SchemaMetadata {
  tables: Map<string, TableMetadata>;
  lastRefreshed: Date;
}

export class MetadataStore {
  private metadata: SchemaMetadata;

  constructor(metadata: SchemaMetadata) {
    this.metadata = metadata;
  }

  get(): SchemaMetadata {
    return this.metadata;
  }

  update(metadata: SchemaMetadata): void {
    this.metadata = metadata;
  }

  getTable(schema: string, name: string): TableMetadata | undefined {
    return this.metadata.tables.get(`${schema}.${name}`);
  }

  findTableByName(name: string): TableMetadata | undefined {
    for (const [, table] of this.metadata.tables) {
      if (table.name === name) return table;
    }
    return undefined;
  }

  getAccessibleColumns(table: TableMetadata, role: string, privilege: 'SELECT' | 'INSERT' | 'UPDATE'): string[] {
    if (table.columnPrivileges.length === 0) {
      return table.columns.map(c => c.name);
    }

    const rolePrivileges = table.columnPrivileges.filter(
      cp => cp.grantee === role && cp.privilegeType === privilege
    );

    if (rolePrivileges.length === 0) {
      return table.columns.map(c => c.name);
    }

    return rolePrivileges.map(cp => cp.column);
  }

  hasTablePrivilege(table: TableMetadata, role: string, privilege: 'select' | 'insert' | 'update' | 'delete'): boolean {
    if (table.privileges[privilege].size === 0) return true;
    return table.privileges[privilege].has(role);
  }
}
