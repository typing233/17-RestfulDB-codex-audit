import { Request, Response } from 'express';
import { Pool } from 'pg';
import { TableMetadata } from '../../introspection';
import { QueryBuilder } from '../../query-builder';
import { executeInTransaction } from '../../transaction';
import { NotFoundError } from '../../errors';

export function createDeleteHandler(
  table: TableMetadata,
  pool: Pool,
) {
  return async (req: Request, res: Response) => {
    const id = req.params.id;

    const result = await executeInTransaction(pool, req.dbRole, async (client) => {
      const qb = new QueryBuilder(table);
      const { sql, params } = qb.buildDelete(id);
      const deleteResult = await client.query(sql, params);
      if (deleteResult.rowCount === 0) {
        throw new NotFoundError(`${table.name} not found`);
      }
      return deleteResult.rows[0];
    });

    res.json(result);
  };
}
