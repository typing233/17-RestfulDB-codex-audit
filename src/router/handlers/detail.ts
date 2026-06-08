import { Request, Response } from 'express';
import { Pool } from 'pg';
import { TableMetadata, MetadataStore } from '../../introspection';
import { QueryBuilder, parseSelect, parseEmbed } from '../../query-builder';
import { executeInTransaction } from '../../transaction';
import { txCtxFromRequest } from '../../utils/tx-context';
import { NotFoundError } from '../../errors';
import { Config } from '../../config';
import { quote } from '../../utils/naming';
import { filterColumnsForRole, getVisibleColumnsForRole } from '../../utils/column-filter';
import { formatETag } from '../../utils/etag';

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
    const userColumns = parseSelect(query.select, table);
    const visibleColumns = getVisibleColumnsForRole(table, metadataStore, req.dbRole);
    const columns = userColumns
      ? userColumns.filter(c => visibleColumns.includes(c))
      : visibleColumns;
    const embeds = parseEmbed(query.embed, table, metadataStore.get());

    const result = await executeInTransaction(pool, txCtxFromRequest(req), async (client) => {
      const qb = new QueryBuilder(table);

      if (embeds.length === 0) {
        const selectQuery = qb.buildSelect({
          columns,
          filters: [{ column: pkCol, operator: '=', value: id }],
          extraWhere: extraWhere ? { column: extraWhere.column, value: req.params[extraWhere.paramName] } : undefined,
        });
        const dataResult = await client.query(selectQuery.sql, selectQuery.params);
        if (dataResult.rows.length === 0) throw new NotFoundError(`${table.name} not found`);
        return dataResult.rows[0];
      }

      const baseAlias = '_base';
      const baseFull = `${quote(table.schema)}.${quote(table.name)}`;

      const selectParts: string[] = [];
      for (const col of columns) {
        selectParts.push(`${baseAlias}.${quote(col)} AS "${col}"`);
      }

      let aliasIdx = 0;
      const embedMeta: { alias: string; embed: typeof embeds[0]; columns: string[] }[] = [];

      function collectMeta(embedList: typeof embeds) {
        for (const embed of embedList) {
          aliasIdx++;
          const alias = `_e${aliasIdx}`;
          const cols = embed.table.columns.map(c => c.name);
          embedMeta.push({ alias, embed, columns: cols });
          for (const col of cols) {
            selectParts.push(`${alias}.${quote(col)} AS "${alias}__${col}"`);
          }
          if (embed.nested && embed.nested.length > 0) collectMeta(embed.nested);
        }
      }
      collectMeta(embeds);

      const joinClausesRebuilt: string[] = [];
      let idx = 0;
      function buildJoins(parentAlias: string, embedList: typeof embeds) {
        for (const embed of embedList) {
          idx++;
          const alias = `_e${idx}`;
          const targetFull = `${quote(embed.table.schema)}.${quote(embed.table.name)}`;
          const conds: string[] = [];
          for (let i = 0; i < embed.fkColumns.length; i++) {
            if (embed.isParent) {
              conds.push(`${parentAlias}.${quote(embed.fkColumns[i])} = ${alias}.${quote(embed.parentColumns[i])}`);
            } else {
              conds.push(`${parentAlias}.${quote(embed.parentColumns[i])} = ${alias}.${quote(embed.fkColumns[i])}`);
            }
          }
          joinClausesRebuilt.push(`LEFT JOIN ${targetFull} AS ${alias} ON ${conds.join(' AND ')}`);
          if (embed.nested && embed.nested.length > 0) buildJoins(alias, embed.nested);
        }
      }
      buildJoins(baseAlias, embeds);

      let whereSql = `${baseAlias}.${quote(pkCol)} = $1`;
      const params: unknown[] = [id];
      if (extraWhere) {
        params.push(req.params[extraWhere.paramName]);
        whereSql += ` AND ${baseAlias}.${quote(extraWhere.column)} = $2`;
      }

      const sql = `SELECT ${selectParts.join(', ')} FROM ${baseFull} AS ${baseAlias} ${joinClausesRebuilt.join(' ')} WHERE ${whereSql}`;
      const dataResult = await client.query(sql, params);

      if (dataResult.rows.length === 0) throw new NotFoundError(`${table.name} not found`);

      const baseRow: Record<string, unknown> = {};
      for (const col of columns) {
        baseRow[col] = dataResult.rows[0][col];
      }

      for (const em of embedMeta) {
        if (em.embed.isParent) {
          const keyCol = `${em.alias}__${em.embed.table.primaryKey?.columns[0] || 'id'}`;
          if (dataResult.rows[0][keyCol] != null) {
            const obj: Record<string, unknown> = {};
            for (const col of em.columns) obj[col] = dataResult.rows[0][`${em.alias}__${col}`];
            baseRow[em.embed.relation] = obj;
          } else {
            baseRow[em.embed.relation] = null;
          }
        } else {
          const childPkCol = em.embed.table.primaryKey?.columns[0] || 'id';
          const seen = new Set<unknown>();
          const arr: Record<string, unknown>[] = [];
          for (const joinRow of dataResult.rows) {
            const childPk = joinRow[`${em.alias}__${childPkCol}`];
            if (childPk == null || seen.has(childPk)) continue;
            seen.add(childPk);
            const obj: Record<string, unknown> = {};
            for (const col of em.columns) obj[col] = joinRow[`${em.alias}__${col}`];
            arr.push(obj);
          }
          baseRow[em.embed.relation] = arr;
        }
      }

      return baseRow;
    });

    if (table.hasVersionColumn && result.version !== undefined) {
      res.set('ETag', formatETag(result.version));
    }

    const filtered = filterColumnsForRole(result, table, metadataStore, req.dbRole);
    res.json(filtered);
  };
}
