import { SchemaMetadata, TableMetadata } from '../introspection';
import { Config } from '../config';
import { pgTypeToJsonSchema } from './type-map';

interface OpenAPISpec {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: { url: string }[];
  paths: Record<string, unknown>;
  components: { schemas: Record<string, unknown>; securitySchemes?: Record<string, unknown>; parameters?: Record<string, unknown> };
  security?: unknown[];
}

export class OpenAPIGenerator {
  private spec: OpenAPISpec;

  constructor(private config: Config) {
    this.spec = this.createBaseSpec();
  }

  rebuild(metadata: SchemaMetadata): void {
    this.spec = this.createBaseSpec();
    this.spec.components.schemas = this.baseSchemas();
    this.spec.paths = {};

    this.addHealthPath();

    for (const [, table] of metadata.tables) {
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
        description: 'Automatically generated REST API from PostgreSQL schema. Supports CRUD operations, bulk writes, cursor pagination, nested resource embedding, and Row-Level Security.',
      },
      servers: [{ url: `http://localhost:${this.config.port}` }],
      paths: {},
      components: {
        schemas: {},
        securitySchemes: this.config.auth.enabled ? {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        } : undefined,
        parameters: {
          preferHeader: {
            name: 'Prefer',
            in: 'header',
            schema: { type: 'string', enum: ['count=exact', 'count=planned', 'count=estimated'] },
            description: 'Count strategy for pagination totals',
          },
          afterCursor: {
            name: 'after',
            in: 'query',
            schema: { type: 'string' },
            description: 'Cursor for forward pagination',
          },
          beforeCursor: {
            name: 'before',
            in: 'query',
            schema: { type: 'string' },
            description: 'Cursor for backward pagination',
          },
        },
      },
    };

    if (this.config.auth.enabled) {
      spec.security = [{ bearerAuth: [] }];
    }

    return spec;
  }

  private baseSchemas(): Record<string, unknown> {
    return {
      ErrorResponse: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: {},
            },
            required: ['code', 'message'],
          },
        },
      },
      HealthResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['healthy', 'unhealthy'] },
          version: { type: 'string' },
          uptime: { type: 'integer' },
          database: {
            type: 'object',
            properties: {
              connected: { type: 'boolean' },
              latencyMs: { type: 'integer' },
            },
          },
          tablesDiscovered: { type: 'integer' },
          lastSchemaRefresh: { type: 'string', format: 'date-time' },
        },
      },
    };
  }

  private addHealthPath(): void {
    this.spec.paths['/_health'] = {
      get: {
        summary: 'Health check',
        tags: ['System'],
        security: [],
        responses: {
          '200': {
            description: 'Service is healthy',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } },
          },
          '503': {
            description: 'Service is unhealthy',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } },
          },
        },
      },
    };
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

    if (table.relKind === 'table') {
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
  }

  private generatePaths(table: TableMetadata, metadata: SchemaMetadata): void {
    const isReadOnly = table.relKind === 'view' || table.relKind === 'matview';
    const hasId = !!table.primaryKey;
    const basePath = `/${table.name}`;
    const responseName = this.schemaName(table.name, 'Response');
    const createName = this.schemaName(table.name, 'Create');
    const updateName = this.schemaName(table.name, 'Update');

    const tags = [table.name + (isReadOnly ? ` [${table.relKind}]` : '')];

    const listOp: any = {
      get: {
        summary: `List ${table.name}`,
        tags,
        parameters: [
          ...this.listParameters(table),
          { $ref: '#/components/parameters/preferHeader' },
          { $ref: '#/components/parameters/afterCursor' },
          { $ref: '#/components/parameters/beforeCursor' },
        ],
        responses: {
          '200': {
            description: 'Success',
            headers: {
              'X-Total-Count': { schema: { type: 'integer' } },
              'Content-Range': { schema: { type: 'string' } },
              'Link': { schema: { type: 'string' }, description: 'Cursor pagination links' },
              'Preference-Applied': { schema: { type: 'string' } },
            },
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: `#/components/schemas/${responseName}` } },
              },
            },
          },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '429': { description: 'Rate limited' },
        },
      },
    };

    if (!isReadOnly && hasId) {
      listOp.post = {
        summary: `Create ${table.name} (single or bulk)`,
        tags,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                oneOf: [
                  { $ref: `#/components/schemas/${createName}` },
                  { type: 'array', items: { $ref: `#/components/schemas/${createName}` }, maxItems: this.config.bulkMaxRows },
                ],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created',
            headers: { 'ETag': { schema: { type: 'string' } } },
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { $ref: `#/components/schemas/${responseName}` },
                    { type: 'array', items: { $ref: `#/components/schemas/${responseName}` } },
                  ],
                },
              },
            },
          },
          '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '403': { description: 'Forbidden' },
        },
      };

      listOp.patch = {
        summary: `Bulk update ${table.name}`,
        description: 'Update multiple records matching query filters',
        tags,
        parameters: this.filterParameters(table),
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: `#/components/schemas/${updateName}` } },
          },
        },
        responses: {
          '200': {
            description: 'Updated records',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: `#/components/schemas/${responseName}` } } } },
          },
          '400': { description: 'Validation error' },
        },
      };

      listOp.delete = {
        summary: `Bulk delete ${table.name}`,
        description: 'Delete multiple records matching query filters',
        tags,
        parameters: this.filterParameters(table),
        responses: {
          '200': {
            description: 'Deleted records',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: `#/components/schemas/${responseName}` } } } },
          },
          '400': { description: 'Validation error (filter required)' },
        },
      };
    }

    this.spec.paths[basePath] = listOp;

    if (hasId) {
      const detailPath: any = {
        get: {
          summary: `Get ${table.name} by ID`,
          tags,
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'select', in: 'query', schema: { type: 'string' }, description: 'Comma-separated fields' },
            { name: 'embed', in: 'query', schema: { type: 'string' }, description: 'Relations to embed' },
          ],
          responses: {
            '200': {
              description: 'Success',
              content: { 'application/json': { schema: { $ref: `#/components/schemas/${responseName}` } } },
            },
            '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      };

      if (!isReadOnly) {
        detailPath.put = {
          summary: `Replace ${table.name}`,
          tags,
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'If-Match', in: 'header', schema: { type: 'string' }, description: 'Version for optimistic locking' },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: `#/components/schemas/${updateName}` } } },
          },
          responses: {
            '200': {
              description: 'Updated',
              headers: { 'ETag': { schema: { type: 'string' } } },
              content: { 'application/json': { schema: { $ref: `#/components/schemas/${responseName}` } } },
            },
            '404': { description: 'Not found' },
            '409': { description: 'Version conflict', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        };

        detailPath.patch = {
          summary: `Partially update ${table.name}`,
          tags,
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'If-Match', in: 'header', schema: { type: 'string' }, description: 'Version for optimistic locking' },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: `#/components/schemas/${updateName}` } } },
          },
          responses: {
            '200': {
              description: 'Updated',
              headers: { 'ETag': { schema: { type: 'string' } } },
              content: { 'application/json': { schema: { $ref: `#/components/schemas/${responseName}` } } },
            },
            '404': { description: 'Not found' },
            '409': { description: 'Version conflict' },
          },
        };

        detailPath.delete = {
          summary: `Delete ${table.name}`,
          tags,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'Deleted',
              content: { 'application/json': { schema: { $ref: `#/components/schemas/${responseName}` } } },
            },
            '404': { description: 'Not found' },
          },
        };
      }

      this.spec.paths[`${basePath}/{id}`] = detailPath;
    }

    if (!isReadOnly && hasId) {
      for (const ref of table.referencedBy) {
        const childTable = metadata.tables.get(`${ref.referencedSchema}.${ref.referencedTable}`);
        if (!childTable || !childTable.primaryKey) continue;
        if (childTable.relKind !== 'table') continue;

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
  }

  private listParameters(table: TableMetadata): unknown[] {
    return [
      { name: 'select', in: 'query', schema: { type: 'string' }, description: 'Comma-separated fields to return' },
      { name: 'order', in: 'query', schema: { type: 'string' }, description: 'Sort: column.asc or column.desc' },
      { name: 'limit', in: 'query', schema: { type: 'integer', default: this.config.pagination.defaultLimit, maximum: this.config.pagination.maxLimit } },
      { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
      { name: 'embed', in: 'query', schema: { type: 'string' }, description: 'Relations to preload (dot-notation for nested)' },
      ...this.filterParameters(table),
    ];
  }

  private filterParameters(table: TableMetadata): unknown[] {
    return table.columns.map(col => ({
      name: col.name,
      in: 'query',
      schema: { type: 'string' },
      description: `Filter by ${col.name}. Operators: eq, neq, gt, gte, lt, lte, like, ilike, in, notin, is, isnot, between`,
    }));
  }

  private schemaName(tableName: string, suffix: string): string {
    const pascal = tableName.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    return `${pascal}${suffix}`;
  }
}
