import { Request, Response, NextFunction } from 'express';
import { TableMetadata, MetadataStore } from '../introspection';
import { ForbiddenError, NotFoundError } from '../errors';

type Action = 'select' | 'insert' | 'update' | 'delete';

export function createPermissionCheck(
  table: TableMetadata,
  metadataStore: MetadataStore,
  action: Action,
) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const role = req.dbRole;
    if (!role) return next();

    const store = metadataStore;
    const hasAccess = store.hasTablePrivilege(table, role, 'select');

    if (!hasAccess) {
      return next(new NotFoundError('Route not found'));
    }

    if (action !== 'select') {
      const hasWriteAccess = store.hasTablePrivilege(table, role, action);
      if (!hasWriteAccess) {
        return next(new ForbiddenError(`Insufficient privileges for ${action} on ${table.name}`));
      }
    }

    next();
  };
}
