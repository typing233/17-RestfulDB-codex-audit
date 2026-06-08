import { Request, Response, NextFunction } from 'express';
import { TableMetadata, MetadataStore } from '../introspection';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../errors';
import { Config } from '../config';

type Action = 'select' | 'insert' | 'update' | 'delete';

export function createPermissionCheck(
  table: TableMetadata,
  metadataStore: MetadataStore,
  action: Action,
  config?: Config,
) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (config?.auth.enabled && !req.jwtPayload && action !== 'select') {
      if (!req.dbRole || req.dbRole === config.auth.anonRole) {
        return next(new UnauthorizedError('Authentication required'));
      }
    }

    const role = req.dbRole;
    if (!role) return next();

    const store = metadataStore;
    const canSee = store.hasTablePrivilege(table, role, 'select');

    if (!canSee) {
      return next(new NotFoundError('Route not found'));
    }

    if (action !== 'select') {
      const canWrite = store.hasTablePrivilege(table, role, action);
      if (!canWrite) {
        return next(new ForbiddenError(`Insufficient privileges for ${action} on ${table.name}`));
      }
    }

    next();
  };
}
