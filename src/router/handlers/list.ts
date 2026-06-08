import { Request, Response } from 'express';
import { Pool } from 'pg';
import { TableMetadata, SchemaMetadata, MetadataStore } from '../../introspection';
import {
  QueryBuilder, parseFilters, parseSelect, parseOrder, parsePagination,
  parseEmbed, EmbedRequest, parseCountStrategy,
  parseCursor, decodeCursor, encodeCursor, buildKeysetCondition,
  ensureStableSort, getCursorColumns, reverseOrder,
} from '../../query-builder';
import { executeInTransaction, TransactionContext } from '../../transaction';
import { txCtxFromRequest } from '../../utils/tx-context';
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
    const rawOrder = parseOrder(query.order, table);
    const order = ensureStableSort(rawOrder, table);
    const pagination = parsePagination(query, config.pagination);
    const embeds = parseEmbed(query.embed, table, metadataStore.get());
    const countStrategy = parseCountStrategy(req.headers['prefer'] as string | undefined);
    const cursor = parseCursor(query);

    const extra = extraWhere ? { column: extraWhere.column, value: req.params[extraWhere.paramName] } : undefined;
    const txCtx = txCtxFromRequest(req);
    const isCursorMode = !!(cursor.after || cursor.before);
    const isBackward = !!cursor.before;

    const result = await executeInTransaction(pool, txCtx, async (client) => {
      const qb = new QueryBuilder(table);

      let keysetCondition: { sql: string; params: unknown[] } | undefined;
      let effectiveOrder = order;

      if (cursor.after) {
        const decoded = decodeCursor(cursor.after);
        if (decoded) {
          keysetCondition = buildKeysetCondition(decoded, order, 'forward');
        }
      } else if (cursor.before) {
        const decoded = decodeCursor(cursor.before);
        if (decoded) {
          keysetCondition = buildKeysetCondition(decoded, order, 'backward');
          effectiveOrder = reverseOrder(order);
        }
      }

      const selectQuery = qb.buildSelect({
        columns,
        filters,
        order: effectiveOrder,
        limit: pagination.limit,
        offset: isCursorMode ? undefined : pagination.offset,
        extraWhere: extra,
        keysetCondition,
      });

      let total: number;

      if (countStrategy === 'estimated') {
        const estQuery = qb.buildEstimateCount();
        const estResult = await client.query(estQuery.sql, estQuery.params);
        total = Math.max(0, parseInt(estResult.rows[0]?.total ?? '0', 10));
      } else if (countStrategy === 'planned') {
        const planQuery = qb.buildPlannedCount({ filters, extraWhere: extra });
        const planResult = await client.query(planQuery.sql, planQuery.params);
        const plan = planResult.rows[0]?.['QUERY PLAN'];
        total = Array.isArray(plan) ? Math.round(plan[0]?.Plan?.['Plan Rows'] ?? 0) : 0;
      } else {
        const countQuery = qb.buildCount({ filters, extraWhere: extra });
        const countResult = await client.query(countQuery.sql, countQuery.params);
        total = parseInt(countResult.rows[0].total, 10);
      }

      const dataResult = await client.query(selectQuery.sql, selectQuery.params);
      let rows = dataResult.rows;

      if (isBackward) {
        rows = rows.reverse();
      }

      if (embeds.length > 0) {
        await resolveEmbeds(client, rows, embeds, table, metadataStore.get());
      }

      return { rows, total };
    });

    const { rows, total } = result;

    const rangeStart = isCursorMode ? 0 : pagination.offset;
    const rangeEnd = rangeStart + rows.length - 1;

    res.set('X-Total-Count', String(total));
    res.set('Content-Range', rows.length > 0
      ? `items ${rangeStart}-${rangeEnd}/${total}`
      : `items */${total}`);
    res.set('Preference-Applied', `count=${countStrategy}`);

    if (rows.length > 0) {
      const cursorCols = getCursorColumns(order);
      const links: string[] = [];

      const lastRow = rows[rows.length - 1];
      const nextCursor = encodeCursor(lastRow, cursorCols);
      links.push(`<${req.path}?after=${encodeURIComponent(nextCursor)}&limit=${pagination.limit}>; rel="next"`);

      const firstRow = rows[0];
      const prevCursor = encodeCursor(firstRow, cursorCols);
      links.push(`<${req.path}?before=${encodeURIComponent(prevCursor)}&limit=${pagination.limit}>; rel="prev"`);

      res.set('Link', links.join(', '));
    }

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
