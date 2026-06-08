import { Request, Response } from 'express';
import { Pool } from 'pg';
import { TableMetadata, MetadataStore } from '../../introspection';
import { NestedWriter } from '../../transaction/nested-writer';
import { executeInTransaction } from '../../transaction';
import { AuditLogger } from '../../audit/audit-logger';
import { createBulkCreateHandler } from './bulk';
import { Config } from '../../config';

export function createCreateHandler(
  table: TableMetadata,
  pool: Pool,
  metadataStore: MetadataStore,
  config: Config,
  prefill?: { column: string; paramName: string },
) {
  const bulkHandler = createBulkCreateHandler(table, pool, metadataStore, config);
  const audit = new AuditLogger(config.audit);

  return async (req: Request, res: Response) => {
    if (Array.isArray(req.body)) {
      return bulkHandler(req, res);
    }

    const body = req.body as Record<string, unknown>;

    if (prefill) {
      body[prefill.column] = req.params[prefill.paramName];
    }

    const result = await executeInTransaction(pool, req.dbRole, async (client) => {
      const writer = new NestedWriter(metadataStore.get());
      const record = await writer.create(client, table, body);

      if (audit.enabled) {
        const pkCol = table.primaryKey?.columns[0] || 'id';
        await audit.log(client, {
          tableName: table.name,
          recordId: String(record[pkCol] ?? null),
          action: 'INSERT',
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

    res.status(201).json(result);
  };
}
