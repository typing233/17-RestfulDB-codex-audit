import { Router, Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { SchemaMetadata, TableMetadata, MetadataStore } from '../introspection';
import { Config } from '../config';
import { createListHandler } from './handlers/list';
import { createDetailHandler } from './handlers/detail';
import { createCreateHandler } from './handlers/create';
import { createUpdateHandler } from './handlers/update';
import { createDeleteHandler } from './handlers/delete';
import { createBulkUpdateHandler, createBulkDeleteHandler } from './handlers/bulk';
import { createPermissionCheck } from '../middleware/permission-check';

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

    for (const [, table] of metadata.tables) {
      const isReadOnly = table.relKind === 'view' || table.relKind === 'matview';
      const hasId = !!table.primaryKey;
      const basePath = `/${table.name}`;

      router.get(
        basePath,
        createPermissionCheck(table, this.metadataStore, 'select', this.config),
        this.asyncHandler(createListHandler(table, this.pool, this.metadataStore, this.config)),
      );

      if (hasId) {
        router.get(
          `${basePath}/:id`,
          createPermissionCheck(table, this.metadataStore, 'select', this.config),
          this.asyncHandler(createDetailHandler(table, this.pool, this.metadataStore, this.config)),
        );
      }

      if (!isReadOnly && hasId) {
        router.post(
          basePath,
          createPermissionCheck(table, this.metadataStore, 'insert', this.config),
          this.asyncHandler(createCreateHandler(table, this.pool, this.metadataStore, this.config)),
        );

        router.put(
          `${basePath}/:id`,
          createPermissionCheck(table, this.metadataStore, 'update', this.config),
          this.asyncHandler(createUpdateHandler(table, this.pool, this.metadataStore, this.config)),
        );

        router.patch(
          `${basePath}/:id`,
          createPermissionCheck(table, this.metadataStore, 'update', this.config),
          this.asyncHandler(createUpdateHandler(table, this.pool, this.metadataStore, this.config)),
        );

        router.delete(
          `${basePath}/:id`,
          createPermissionCheck(table, this.metadataStore, 'delete', this.config),
          this.asyncHandler(createDeleteHandler(table, this.pool, this.config)),
        );

        router.patch(
          basePath,
          createPermissionCheck(table, this.metadataStore, 'update', this.config),
          this.asyncHandler(createBulkUpdateHandler(table, this.pool, this.metadataStore, this.config)),
        );

        router.delete(
          basePath,
          createPermissionCheck(table, this.metadataStore, 'delete', this.config),
          this.asyncHandler(createBulkDeleteHandler(table, this.pool, this.config)),
        );

        this.registerNestedRoutes(router, table, metadata);
      }
    }

    this.currentRouter = router;
  }

  private registerNestedRoutes(router: Router, table: TableMetadata, metadata: SchemaMetadata): void {
    const registered = new Set<string>();

    for (const ref of table.referencedBy) {
      const childTable = metadata.tables.get(`${ref.referencedSchema}.${ref.referencedTable}`);
      if (!childTable || !childTable.primaryKey) continue;
      if (childTable.relKind !== 'table') continue;

      const fkCol = ref.referencedColumns[0];
      const routeKey = `${table.name}/${childTable.name}/${fkCol}`;
      if (registered.has(routeKey)) continue;
      registered.add(routeKey);

      const parentParam = `${table.name}Id`;
      const nestedBase = `/${table.name}/:${parentParam}/${childTable.name}`;

      router.get(
        nestedBase,
        createPermissionCheck(childTable, this.metadataStore, 'select', this.config),
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
        createPermissionCheck(childTable, this.metadataStore, 'select', this.config),
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
        createPermissionCheck(childTable, this.metadataStore, 'insert', this.config),
        this.asyncHandler(createCreateHandler(
          childTable,
          this.pool,
          this.metadataStore,
          this.config,
          { column: fkCol, paramName: parentParam },
        )),
      );

      // Second-level nesting: parent/:id/child/:childId/grandchild
      for (const childRef of childTable.referencedBy) {
        const grandchildTable = metadata.tables.get(`${childRef.referencedSchema}.${childRef.referencedTable}`);
        if (!grandchildTable || !grandchildTable.primaryKey) continue;
        if (grandchildTable.relKind !== 'table') continue;
        if (grandchildTable.name === table.name) continue;

        const childPkParam = `${childTable.name}Id`;
        const grandFkCol = childRef.referencedColumns[0];
        const deepBase = `${nestedBase}/:${childPkParam}/${grandchildTable.name}`;

        router.get(
          deepBase,
          createPermissionCheck(grandchildTable, this.metadataStore, 'select', this.config),
          this.asyncHandler(createListHandler(
            grandchildTable,
            this.pool,
            this.metadataStore,
            this.config,
            { column: grandFkCol, paramName: childPkParam },
          )),
        );

        router.post(
          deepBase,
          createPermissionCheck(grandchildTable, this.metadataStore, 'insert', this.config),
          this.asyncHandler(createCreateHandler(
            grandchildTable,
            this.pool,
            this.metadataStore,
            this.config,
            { column: grandFkCol, paramName: childPkParam },
          )),
        );
      }
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
