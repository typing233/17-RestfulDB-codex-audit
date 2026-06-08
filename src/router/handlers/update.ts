import { Request, Response } from 'express';
import { Pool } from 'pg';
import { TableMetadata, MetadataStore } from '../../introspection';
import { NestedWriter } from '../../transaction/nested-writer';
import { QueryBuilder } from '../../query-builder';
import { executeInTransaction } from '../../transaction';
import { txCtxFromRequest } from '../../utils/tx-context';
import { AuditLogger } from '../../audit/audit-logger';
import { NotFoundError } from '../../errors';
import { Config } from '../../config';
import { quote } from '../../utils/naming';
import { formatETag, parseIfMatch } from '../../utils/etag';

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
      } else {
        versionCheck = parseIfMatch(req.headers['if-match'] as string | undefined);
      }
    }

    const result = await executeInTransaction(pool, txCtxFromRequest(req), async (client) => {
      let oldData: Record<string, unknown> | null = null;

      if (audit?.enabled) {
        const qb = new QueryBuilder(table);
        const selectQ = qb.buildSelect({
          filters: [{ column: pkCol, operator: '=', value: id }],
        });
        const oldResult = await client.query(selectQ.sql, selectQ.params);
        if (oldResult.rows.length > 0) {
          oldData = oldResult.rows[0];
        }
      }

      const writer = new NestedWriter(metadataStore.get());
      const record = await writer.update(client, table, id, body, versionCheck);

      if (audit?.enabled) {
        await audit.log(client, {
          tableName: table.name,
          recordId: String(id),
          action: 'UPDATE',
          oldData,
          newData: record,
          changedBy: req.jwtPayload?.sub || null,
          role: req.dbRole || null,
          ipAddress: req.ip || null,
        });
      }

      return record;
    });

    if (table.hasVersionColumn && result.version !== undefined) {
      res.set('ETag', formatETag(result.version));
    }

    res.json(result);
  };
}
