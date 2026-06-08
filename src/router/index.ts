import { Router, Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { SchemaMetadata, TableMetadata, MetadataStore } from '../introspection';
import { Config } from '../config';
import { createListHandler } from './handlers/list';
import { createDetailHandler } from './handlers/detail';
import { createCreateHandler } from './handlers/create';
import { createUpdateHandler } from './handlers/update';
import { createDeleteHandler } from './handlers/delete';

export class DynamicRouter {
  private currentRouter: Router;

  constructor(
    private pool: Pool,
    private metadataStore: MetadataStore,
    private config: Config,
  ) {
    this.currentRouter = Router();
  }

  rebuild(metadata: SchemaMetadata): void {
    const router = Router();

    for (const [key, table] of metadata.tables) {
      if (!table.primaryKey) continue;

      const basePath = `/${table.name}`;

      router.get(
        basePath,
        this.asyncHandler(createListHandler(table, this.pool, this.metadataStore, this.config)),
      );

      router.get(
        `${basePath}/:id`,
        this.asyncHandler(createDetailHandler(table, this.pool, this.metadataStore, this.config)),
      );

      router.post(
        basePath,
        this.asyncHandler(createCreateHandler(table, this.pool, this.metadataStore)),
      );

      router.put(
        `${basePath}/:id`,
        this.asyncHandler(createUpdateHandler(table, this.pool, this.metadataStore)),
      );

      router.patch(
        `${basePath}/:id`,
        this.asyncHandler(createUpdateHandler(table, this.pool, this.metadataStore)),
      );

      router.delete(
        `${basePath}/:id`,
        this.asyncHandler(createDeleteHandler(table, this.pool)),
      );

      this.registerNestedRoutes(router, table, metadata);
    }

    this.currentRouter = router;
  }

  private registerNestedRoutes(router: Router, table: TableMetadata, metadata: SchemaMetadata): void {
    for (const ref of table.referencedBy) {
      const childTable = metadata.tables.get(`${ref.referencedSchema}.${ref.referencedTable}`);
      if (!childTable || !childTable.primaryKey) continue;

      const pkCol = table.primaryKey?.columns[0] || 'id';
      const parentParam = `${table.name}Id`;
      const nestedBase = `/${table.name}/:${parentParam}/${childTable.name}`;

      const fkCol = ref.referencedColumns[0];

      router.get(
        nestedBase,
        this.asyncHandler(createListHandler(
          childTable,
          this.pool,
          this.metadataStore,
          this.config,
          { column: fkCol, paramName: parentParam },
        )),
      );

      router.get(
        `${nestedBase}/:id`,
        this.asyncHandler(createDetailHandler(
          childTable,
          this.pool,
          this.metadataStore,
          this.config,
          { column: fkCol, paramName: parentParam },
        )),
      );

      router.post(
        nestedBase,
        this.asyncHandler(createCreateHandler(
          childTable,
          this.pool,
          this.metadataStore,
          { column: fkCol, paramName: parentParam },
        )),
      );
    }
  }

  handler(): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction) => {
      this.currentRouter(req, res, next);
    };
  }

  private asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
    return (req: Request, res: Response, next: NextFunction) => {
      fn(req, res).catch(next);
    };
  }
}
