import { SchemaMetadata, TableMetadata } from '../introspection';
import { Config } from '../config';
import { pgTypeToJsonSchema } from './type-map';

interface OpenAPISpec {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: { url: string }[];
  paths: Record<string, unknown>;
  components: { schemas: Record<string, unknown>; securitySchemes?: Record<string, unknown> };
  security?: unknown[];
}

export class OpenAPIGenerator {
  private spec: OpenAPISpec;

  constructor(private config: Config) {
    this.spec = this.createBaseSpec();
  }

  rebuild(metadata: SchemaMetadata): void {
    this.spec = this.createBaseSpec();
    this.spec.components.schemas = {};
    this.spec.paths = {};

    for (const [key, table] of metadata.tables) {
      if (!table.primaryKey) continue;
      this.generateSchemas(table);
      this.generatePaths(table, metadata);
    }
  }

  getSpec(): OpenAPISpec {
    return this.spec;
  }

  private createBaseSpec(): OpenAPISpec {
    const spec: OpenAPISpec = {
      openapi: '3.0.3',
      info: {
        title: 'RestfulDB Auto-Generated API',
        version: '1.0.0',
        description: 'Automatically generated REST API from PostgreSQL schema',
      },
      servers: [{ url: `http://localhost:${this.config.port}` }],
      paths: {},
      components: {
        schemas: {},
        securitySchemes: this.config.auth.enabled ? {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        } : undefined,
      },
    };

    if (this.config.auth.enabled) {
      spec.security = [{ bearerAuth: [] }];
    }

    return spec;
  }

  private generateSchemas(table: TableMetadata): void {
    const responseName = this.schemaName(table.name, 'Response');
    const createName = this.schemaName(table.name, 'Create');
    const updateName = this.schemaName(table.name, 'Update');

    const responseProps: Record<string, unknown> = {};
    const createProps: Record<string, unknown> = {};
    const updateProps: Record<string, unknown> = {};
    const createRequired: string[] = [];

    for (const col of table.columns) {
      const schema = pgTypeToJsonSchema(col);
      responseProps[col.name] = schema;

      const isPk = table.primaryKey?.columns.includes(col.name);
      const isSerial = col.hasDefault && col.defaultValue?.includes('nextval');
      const isGenerated = col.isGenerated;

      if (!isPk || (!isSerial && !isGenerated)) {
        if (!isGenerated) {
          createProps[col.name] = schema;
          updateProps[col.name] = schema;

          if (!col.isNullable && !col.hasDefault && !isPk) {
            createRequired.push(col.name);
          }
        }
      }
    }

    this.spec.components.schemas[responseName] = {
      type: 'object',
      properties: responseProps,
    };

    this.spec.components.schemas[createName] = {
      type: 'object',
      properties: createProps,
      ...(createRequired.length > 0 ? { required: createRequired } : {}),
    };

    this.spec.components.schemas[updateName] = {
      type: 'object',
      properties: updateProps,
    };
  }

  private generatePaths(table: TableMetadata, metadata: SchemaMetadata): void {
    const basePath = `/${table.name}`;
    const pkCol = table.primaryKey?.columns[0] || 'id';
    const responseName = this.schemaName(table.name, 'Response');
    const createName = this.schemaName(table.name, 'Create');
    const updateName = this.schemaName(table.name, 'Update');

    this.spec.paths[basePath] = {
      get: {
        summary: `List ${table.name}`,
        tags: [table.name],
        parameters: this.listParameters(table),
        responses: {
          '200': {
            description: 'Success',
            headers: {
              'X-Total-Count': { schema: { type: 'integer' } },
              'Content-Range': { schema: { type: 'string' } },
            },
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: `#/components/schemas/${responseName}` } },
              },
            },
          },
        },
      },
      post: {
        summary: `Create ${table.name}`,
        tags: [table.name],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: `#/components/schemas/${createName}` } },
          },
        },
        responses: {
          '201': {
            description: 'Created',
            content: {
              'application/json': { schema: { $ref: `#/components/schemas/${responseName}` } },
            },
          },
        },
      },
    };

    this.spec.paths[`${basePath}/{id}`] = {
      get: {
        summary: `Get ${table.name} by ID`,
        tags: [table.name],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'select', in: 'query', schema: { type: 'string' }, description: 'Comma-separated fields' },
          { name: 'embed', in: 'query', schema: { type: 'string' }, description: 'Relations to embed' },
        ],
        responses: {
          '200': {
            description: 'Success',
            content: {
              'application/json': { schema: { $ref: `#/components/schemas/${responseName}` } },
            },
          },
          '404': { description: 'Not found' },
        },
      },
      put: {
        summary: `Replace ${table.name}`,
        tags: [table.name],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: `#/components/schemas/${updateName}` } },
          },
        },
        responses: {
          '200': {
            description: 'Updated',
            content: {
              'application/json': { schema: { $ref: `#/components/schemas/${responseName}` } },
            },
          },
          '404': { description: 'Not found' },
          '409': { description: 'Version conflict' },
        },
      },
      patch: {
        summary: `Partially update ${table.name}`,
        tags: [table.name],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: `#/components/schemas/${updateName}` } },
          },
        },
        responses: {
          '200': {
            description: 'Updated',
            content: {
              'application/json': { schema: { $ref: `#/components/schemas/${responseName}` } },
            },
          },
          '404': { description: 'Not found' },
          '409': { description: 'Version conflict' },
        },
      },
      delete: {
        summary: `Delete ${table.name}`,
        tags: [table.name],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Deleted',
            content: {
              'application/json': { schema: { $ref: `#/components/schemas/${responseName}` } },
            },
          },
          '404': { description: 'Not found' },
        },
      },
    };

    for (const ref of table.referencedBy) {
      const childTable = metadata.tables.get(`${ref.referencedSchema}.${ref.referencedTable}`);
      if (!childTable || !childTable.primaryKey) continue;

      const childResponseName = this.schemaName(childTable.name, 'Response');
      const childCreateName = this.schemaName(childTable.name, 'Create');
      const nestedPath = `${basePath}/{${table.name}Id}/${childTable.name}`;

      this.spec.paths[nestedPath] = {
        get: {
          summary: `List ${childTable.name} for ${table.name}`,
          tags: [table.name, childTable.name],
          parameters: [
            { name: `${table.name}Id`, in: 'path', required: true, schema: { type: 'string' } },
            ...this.listParameters(childTable),
          ],
          responses: {
            '200': {
              description: 'Success',
              headers: {
                'X-Total-Count': { schema: { type: 'integer' } },
                'Content-Range': { schema: { type: 'string' } },
              },
              content: {
                'application/json': {
                  schema: { type: 'array', items: { $ref: `#/components/schemas/${childResponseName}` } },
                },
              },
            },
          },
        },
        post: {
          summary: `Create ${childTable.name} for ${table.name}`,
          tags: [table.name, childTable.name],
          parameters: [
            { name: `${table.name}Id`, in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: `#/components/schemas/${childCreateName}` } },
            },
          },
          responses: {
            '201': {
              description: 'Created',
              content: {
                'application/json': { schema: { $ref: `#/components/schemas/${childResponseName}` } },
              },
            },
          },
        },
      };
    }
  }

  private listParameters(table: TableMetadata): unknown[] {
    const params: unknown[] = [
      { name: 'select', in: 'query', schema: { type: 'string' }, description: 'Comma-separated fields to return' },
      { name: 'order', in: 'query', schema: { type: 'string' }, description: 'Sort: column.asc or column.desc' },
      { name: 'limit', in: 'query', schema: { type: 'integer', default: this.config.pagination.defaultLimit } },
      { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
      { name: 'embed', in: 'query', schema: { type: 'string' }, description: 'Relations to preload' },
    ];

    for (const col of table.columns) {
      params.push({
        name: col.name,
        in: 'query',
        schema: { type: 'string' },
        description: `Filter by ${col.name}. Operators: eq, neq, gt, gte, lt, lte, like, ilike, in, between`,
      });
    }

    return params;
  }

  private schemaName(tableName: string, suffix: string): string {
    const pascal = tableName.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    return `${pascal}${suffix}`;
  }
}
