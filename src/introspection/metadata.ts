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

export interface TableMetadata {
  schema: string;
  name: string;
  columns: ColumnMetadata[];
  primaryKey: PrimaryKeyMetadata | null;
  foreignKeys: ForeignKeyMetadata[];
  referencedBy: ForeignKeyMetadata[];
  uniqueConstraints: UniqueConstraintMetadata[];
  hasVersionColumn: boolean;
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
    for (const [key, table] of this.metadata.tables) {
      if (table.name === name) return table;
    }
    return undefined;
  }
}
