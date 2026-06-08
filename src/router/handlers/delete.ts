import { Request, Response } from 'express';
import { Pool } from 'pg';
import { TableMetadata } from '../../introspection';
import { QueryBuilder } from '../../query-builder';
import { executeInTransaction } from '../../transaction';
import { txCtxFromRequest } from '../../utils/tx-context';
import { AuditLogger } from '../../audit/audit-logger';
import { NotFoundError, ConflictError } from '../../errors';
import { Config } from '../../config';
import { quote } from '../../utils/naming';
import { parseIfMatch } from '../../utils/etag';

export function createDeleteHandler(
  table: TableMetadata,
  pool: Pool,
  config?: Config,
) {
  const audit = config ? new AuditLogger(config.audit) : null;

  return async (req: Request, res: Response) => {
    const id = req.params.id;
    const pkCol = table.primaryKey?.columns[0] || 'id';

    let versionCheck: number | undefined;
    if (table.hasVersionColumn) {
      versionCheck = parseIfMatch(req.headers['if-match'] as string | undefined);
    }

    const result = await executeInTransaction(pool, txCtxFromRequest(req), async (client) => {
      const qb = new QueryBuilder(table);
      let sql: string;
      let params: unknown[];

      if (versionCheck !== undefined) {
        sql = `DELETE FROM ${quote(table.schema)}.${quote(table.name)} WHERE ${quote(pkCol)} = $1 AND ${quote('version')} = $2 RETURNING *`;
        params = [id, versionCheck];
      } else {
        const built = qb.buildDelete(id);
        sql = built.sql;
        params = built.params;
      }

      const deleteResult = await client.query(sql, params);

      if (deleteResult.rowCount === 0) {
        if (versionCheck !== undefined) {
          const checkExists = await client.query(
            `SELECT 1 FROM ${quote(table.schema)}.${quote(table.name)} WHERE ${quote(pkCol)} = $1`,
            [id],
          );
          if (checkExists.rowCount! > 0) {
            throw new ConflictError('Version conflict: record has been modified by another request');
          }
        }
        throw new NotFoundError(`${table.name} not found`);
      }

      const record = deleteResult.rows[0];

      if (audit?.enabled) {
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
