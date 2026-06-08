import { Request, Response } from 'express';
import { Pool } from 'pg';
import { TableMetadata } from '../../introspection';
import { QueryBuilder } from '../../query-builder';
import { executeInTransaction } from '../../transaction';
import { AuditLogger } from '../../audit/audit-logger';
import { NotFoundError } from '../../errors';
import { Config } from '../../config';

export function createDeleteHandler(
  table: TableMetadata,
  pool: Pool,
  config?: Config,
) {
  const audit = config ? new AuditLogger(config.audit) : null;

  return async (req: Request, res: Response) => {
    const id = req.params.id;

    const result = await executeInTransaction(pool, req.dbRole, async (client) => {
      const qb = new QueryBuilder(table);
      const { sql, params } = qb.buildDelete(id);
      const deleteResult = await client.query(sql, params);
      if (deleteResult.rowCount === 0) {
        throw new NotFoundError(`${table.name} not found`);
      }

      const record = deleteResult.rows[0];

      if (audit?.enabled) {
        const pkCol = table.primaryKey?.columns[0] || 'id';
        await audit.log(client, {
          tableName: table.name,
          recordId: String(record[pkCol] ?? null),
          action: 'DELETE',
          oldData: record,
          newData: null,
          changedBy: req.jwtPayload?.sub || null,
          role: req.dbRole || null,
          ipAddress: req.ip || null,
        });
      }

      return record;
    });

    res.json(result);
  };
}
