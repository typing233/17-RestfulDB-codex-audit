import { Request, Response } from 'express';
import { Pool } from 'pg';
import { TableMetadata, MetadataStore } from '../../introspection';
import { NestedWriter } from '../../transaction/nested-writer';
import { executeInTransaction } from '../../transaction';
import { AuditLogger } from '../../audit/audit-logger';
import { Config } from '../../config';

export function createUpdateHandler(
  table: TableMetadata,
  pool: Pool,
  metadataStore: MetadataStore,
  config?: Config,
) {
  const audit = config ? new AuditLogger(config.audit) : null;

  return async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const pkCol = table.primaryKey?.columns[0] || 'id';
    const id = req.params.id;

    let versionCheck: number | undefined;
    if (table.hasVersionColumn) {
      if (body.version !== undefined) {
        versionCheck = Number(body.version);
      } else if (req.headers['if-match']) {
        versionCheck = Number(req.headers['if-match']);
      }
    }

    const result = await executeInTransaction(pool, req.dbRole, async (client) => {
      const writer = new NestedWriter(metadataStore.get());
      const record = await writer.update(client, table, id, body, versionCheck);

      if (audit?.enabled) {
        await audit.log(client, {
          tableName: table.name,
          recordId: String(id),
          action: 'UPDATE',
          oldData: null,
          newData: record,
          changedBy: req.jwtPayload?.sub || null,
          role: req.dbRole || null,
          ipAddress: req.ip || null,
        });
      }

      return record;
    });

    if (table.hasVersionColumn && result.version !== undefined) {
      res.set('ETag', String(result.version));
    }

    res.json(result);
  };
}
