import { Request, Response } from 'express';
import { Pool } from 'pg';
import { TableMetadata, MetadataStore } from '../../introspection';
import { QueryBuilder, parseSelect, parseEmbed } from '../../query-builder';
import { executeInTransaction } from '../../transaction';
import { txCtxFromRequest } from '../../utils/tx-context';
import { NotFoundError } from '../../errors';
import { Config } from '../../config';
import { quote } from '../../utils/naming';

export function createDetailHandler(
  table: TableMetadata,
  pool: Pool,
  metadataStore: MetadataStore,
  config: Config,
  extraWhere?: { column: string; paramName: string },
) {
  return async (req: Request, res: Response) => {
    const query = req.query as Record<string, string>;
    const pkCol = table.primaryKey?.columns[0] || 'id';
    const id = req.params.id || req.params[table.name + 'Id'];
    const columns = parseSelect(query.select, table);
    const embeds = parseEmbed(query.embed, table, metadataStore.get());

    const result = await executeInTransaction(pool, txCtxFromRequest(req), async (client) => {
      const qb = new QueryBuilder(table);
      const selectQuery = qb.buildSelect({
        columns,
        filters: [{ column: pkCol, operator: '=', value: id }],
        extraWhere: extraWhere ? { column: extraWhere.column, value: req.params[extraWhere.paramName] } : undefined,
      });

      const dataResult = await client.query(selectQuery.sql, selectQuery.params);
      if (dataResult.rows.length === 0) {
        throw new NotFoundError(`${table.name} not found`);
      }

      const rows = dataResult.rows;
      if (embeds.length > 0) {
        const metadata = metadataStore.get();
        for (const embed of embeds) {
          if (embed.isParent) {
            const fkVal = rows[0][embed.fkColumn];
            if (fkVal != null) {
              const sql = `SELECT * FROM ${quote(embed.table.schema)}.${quote(embed.table.name)} WHERE ${quote(embed.parentColumn)} = $1`;
              const r = await client.query(sql, [fkVal]);
              rows[0][embed.relation] = r.rows[0] || null;
            } else {
              rows[0][embed.relation] = null;
            }
          } else {
            const pkVal = rows[0][pkCol];
            const sql = `SELECT * FROM ${quote(embed.table.schema)}.${quote(embed.table.name)} WHERE ${quote(embed.fkColumn)} = $1`;
            const r = await client.query(sql, [pkVal]);
            rows[0][embed.relation] = r.rows;
          }
        }
      }

      return rows[0];
    });

    if (table.hasVersionColumn && result.version !== undefined) {
      res.set('ETag', String(result.version));
    }

    res.json(result);
  };
}
