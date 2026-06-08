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
import { filterRowsColumns, getVisibleColumnsForRole } from '../../utils/column-filter';

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
    const userColumns = parseSelect(query.select, table);
    const visibleColumns = getVisibleColumnsForRole(table, metadataStore, req.dbRole);
    const columns = userColumns
      ? userColumns.filter(c => visibleColumns.includes(c))
      : visibleColumns;
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

    res.set('X-Total-Count', String(total));
    res.set('Preference-Applied', `count=${countStrategy}`);

    if (isCursorMode) {
      res.set('Content-Range', rows.length > 0
        ? `items */${total}`
        : `items */${total}`);
    } else {
      const rangeStart = pagination.offset;
      const rangeEnd = rangeStart + rows.length - 1;
      res.set('Content-Range', rows.length > 0
        ? `items ${rangeStart}-${rangeEnd}/${total}`
        : `items */${total}`);
    }

    if (rows.length > 0) {
      const cursorCols = getCursorColumns(order);
      const links: string[] = [];

      const preservedParams = new URLSearchParams();
      for (const [key, val] of Object.entries(query)) {
        if (key === 'after' || key === 'before' || key === 'offset') continue;
        preservedParams.set(key, val);
      }

      if (rows.length >= pagination.limit) {
        const lastRow = rows[rows.length - 1];
        const nextCursor = encodeCursor(lastRow, cursorCols);
        const nextParams = new URLSearchParams(preservedParams);
        nextParams.set('after', nextCursor);
        nextParams.set('limit', String(pagination.limit));
        links.push(`<${req.path}?${nextParams.toString()}>; rel="next"`);
      }

      if (cursor.after || cursor.before) {
        const firstRow = rows[0];
        const prevCursor = encodeCursor(firstRow, cursorCols);
        const prevParams = new URLSearchParams(preservedParams);
        prevParams.set('before', prevCursor);
        prevParams.set('limit', String(pagination.limit));
        links.push(`<${req.path}?${prevParams.toString()}>; rel="prev"`);
      }

      if (links.length > 0) {
        res.set('Link', links.join(', '));
      }
    }

    const filtered = filterRowsColumns(rows, table, metadataStore, req.dbRole);
    res.json(filtered);
  };
}

async function resolveEmbeds(
  client: any,
  rows: Record<string, unknown>[],
  embeds: EmbedRequest[],
  parentTable: TableMetadata,
  metadata: SchemaMetadata,
): Promise<void> {
  if (rows.length === 0) return;

  const baseAlias = '_base';
  const { joinClauses, selectAliases } = buildJoinQueryWithMeta(baseAlias, embeds);

  const pkCol = parentTable.primaryKey?.columns[0] || 'id';
  const parentIds = [...new Set(rows.map(r => r[pkCol]).filter(v => v != null))];
  if (parentIds.length === 0) return;

  const baseFull = `${quote(parentTable.schema)}.${quote(parentTable.name)}`;
  const selectParts = [`${baseAlias}.${quote(pkCol)} AS "_base_pk"`];

  let aliasIdx = 0;
  const embedMeta: { alias: string; embed: EmbedRequest; columns: string[] }[] = [];

  function collectMeta(embedList: EmbedRequest[]) {
    for (const embed of embedList) {
      aliasIdx++;
      const alias = `_e${aliasIdx}`;
      const cols = embed.table.columns.map(c => c.name);
      embedMeta.push({ alias, embed, columns: cols });
      for (const col of cols) {
        selectParts.push(`${alias}.${quote(col)} AS "${alias}__${col}"`);
      }
      if (embed.nested && embed.nested.length > 0) {
        collectMeta(embed.nested);
      }
    }
  }
  collectMeta(embeds);

  const sql = `SELECT ${selectParts.join(', ')} FROM ${baseFull} AS ${baseAlias} ${joinClauses.join(' ')} WHERE ${baseAlias}.${quote(pkCol)} = ANY($1)`;
  const result = await client.query(sql, [parentIds]);

  const rowMap = new Map<unknown, Record<string, unknown>>();
  for (const row of rows) {
    rowMap.set(row[pkCol], row);
    for (const em of embedMeta) {
      if (em.embed.isParent) {
        row[em.embed.relation] = row[em.embed.relation] ?? null;
      } else {
        row[em.embed.relation] = row[em.embed.relation] ?? [];
      }
    }
  }

  const childSets = new Map<string, Set<string>>();

  for (const joinRow of result.rows) {
    const basePk = joinRow['_base_pk'];
    const parentRow = rowMap.get(basePk);
    if (!parentRow) continue;

    for (const em of embedMeta) {
      const keyCol = `${em.alias}__${em.embed.table.primaryKey?.columns[0] || 'id'}`;
      const childPk = joinRow[keyCol];
      if (childPk == null) continue;

      const childObj: Record<string, unknown> = {};
      for (const col of em.columns) {
        childObj[col] = joinRow[`${em.alias}__${col}`];
      }

      if (em.embed.isParent) {
        parentRow[em.embed.relation] = childObj;
      } else {
        const dedupeKey = `${basePk}:${em.alias}:${childPk}`;
        if (!childSets.has(dedupeKey)) {
          childSets.set(dedupeKey, new Set());
          (parentRow[em.embed.relation] as Record<string, unknown>[]).push(childObj);
        }
      }
    }
  }
}

function buildJoinQueryWithMeta(
  baseAlias: string,
  embeds: EmbedRequest[],
): { joinClauses: string[]; selectAliases: string[] } {
  const joinClauses: string[] = [];
  const selectAliases: string[] = [];
  let aliasIdx = 0;

  function traverse(parentAlias: string, embedList: EmbedRequest[]) {
    for (const embed of embedList) {
      aliasIdx++;
      const alias = `_e${aliasIdx}`;
      const targetFull = `${quote(embed.table.schema)}.${quote(embed.table.name)}`;

      const joinConditions: string[] = [];
      for (let i = 0; i < embed.fkColumns.length; i++) {
        if (embed.isParent) {
          joinConditions.push(
            `${parentAlias}.${quote(embed.fkColumns[i])} = ${alias}.${quote(embed.parentColumns[i])}`
          );
        } else {
          joinConditions.push(
            `${parentAlias}.${quote(embed.parentColumns[i])} = ${alias}.${quote(embed.fkColumns[i])}`
          );
        }
      }

      joinClauses.push(
        `LEFT JOIN ${targetFull} AS ${alias} ON ${joinConditions.join(' AND ')}`
      );
      selectAliases.push(alias);

      if (embed.nested && embed.nested.length > 0) {
        traverse(alias, embed.nested);
      }
    }
  }

  traverse(baseAlias, embeds);
  return { joinClauses, selectAliases };
}
