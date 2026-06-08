import { Request, Response } from 'express';
import { Pool } from 'pg';
import { TableMetadata, SchemaMetadata, MetadataStore } from '../../introspection';
import { QueryBuilder, parseFilters, parseSelect, parseOrder, parsePagination, parseEmbed, EmbedRequest } from '../../query-builder';
import { executeInTransaction } from '../../transaction';
import { Config } from '../../config';
import { quote } from '../../utils/naming';

export function createListHandler(
  table: TableMetadata,
  pool: Pool,
  metadataStore: MetadataStore,
  config: Config,
  extraWhere?: { column: string; paramName: string },
) {
  return async (req: Request, res: Response) => {
    const query = req.query as Record<string, string>;
    const filters = parseFilters(query, table);
    const columns = parseSelect(query.select, table);
    const order = parseOrder(query.order, table);
    const pagination = parsePagination(query, config.pagination);
    const embeds = parseEmbed(query.embed, table, metadataStore.get());

    const extra = extraWhere ? { column: extraWhere.column, value: req.params[extraWhere.paramName] } : undefined;

    const result = await executeInTransaction(pool, req.dbRole, async (client) => {
      const qb = new QueryBuilder(table);

      const selectQuery = qb.buildSelect({
        columns,
        filters,
        order,
        limit: pagination.limit,
        offset: pagination.offset,
        extraWhere: extra,
      });

      const countQuery = qb.buildCount({ filters, extraWhere: extra });

      const [dataResult, countResult] = await Promise.all([
        client.query(selectQuery.sql, selectQuery.params),
        client.query(countQuery.sql, countQuery.params),
      ]);

      const rows = dataResult.rows;
      const total = parseInt(countResult.rows[0].total, 10);

      if (embeds.length > 0) {
        await resolveEmbeds(client, rows, embeds, table, metadataStore.get());
      }

      return { rows, total };
    });

    const { rows, total } = result;
    const start = pagination.offset;
    const end = Math.min(start + rows.length - 1, total - 1);

    res.set('X-Total-Count', String(total));
    res.set('Content-Range', `items ${start}-${end >= 0 ? end : 0}/${total}`);
    res.json(rows);
  };
}

async function resolveEmbeds(
  client: any,
  rows: Record<string, unknown>[],
  embeds: EmbedRequest[],
  parentTable: TableMetadata,
  metadata: SchemaMetadata,
): Promise<void> {
  for (const embed of embeds) {
    if (embed.isParent) {
      const fkValues = [...new Set(rows.map(r => r[embed.fkColumn]).filter(v => v != null))];
      if (fkValues.length === 0) {
        rows.forEach(r => (r[embed.relation] = null));
        continue;
      }

      const childQb = new QueryBuilder(embed.table);
      const q = childQb.buildSelect({
        filters: [{ column: embed.parentColumn, operator: '=', value: fkValues, isNull: false }],
      });
      const overrideSql = `SELECT * FROM ${quote(embed.table.schema)}.${quote(embed.table.name)} WHERE ${quote(embed.parentColumn)} = ANY($1)`;
      const result = await client.query(overrideSql, [fkValues]);
      const map = new Map<unknown, Record<string, unknown>>();
      for (const row of result.rows) {
        map.set(row[embed.parentColumn], row);
      }
      for (const row of rows) {
        row[embed.relation] = map.get(row[embed.fkColumn]) || null;
      }
    } else {
      const pkCol = parentTable.primaryKey?.columns[0] || 'id';
      const parentIds = [...new Set(rows.map(r => r[pkCol]).filter(v => v != null))];
      if (parentIds.length === 0) {
        rows.forEach(r => (r[embed.relation] = []));
        continue;
      }

      const sql = `SELECT * FROM ${quote(embed.table.schema)}.${quote(embed.table.name)} WHERE ${quote(embed.fkColumn)} = ANY($1)`;
      const result = await client.query(sql, [parentIds]);

      if (embed.nested && embed.nested.length > 0) {
        await resolveEmbeds(client, result.rows, embed.nested, embed.table, metadata);
      }

      const grouped = new Map<unknown, Record<string, unknown>[]>();
      for (const row of result.rows) {
        const key = row[embed.fkColumn];
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(row);
      }
      for (const row of rows) {
        row[embed.relation] = grouped.get(row[pkCol]) || [];
      }
    }
  }
}
