import { Request, Response } from 'express';
import { Pool } from 'pg';
import { TableMetadata, MetadataStore } from '../../introspection';
import { QueryBuilder, parseFilters } from '../../query-builder';
import { NestedWriter } from '../../transaction/nested-writer';
import { executeInTransaction } from '../../transaction';
import { txCtxFromRequest } from '../../utils/tx-context';
import { AuditLogger } from '../../audit/audit-logger';
import { ValidationError, ConflictError } from '../../errors';
import { Config } from '../../config';
import { quote } from '../../utils/naming';
import { formatETag, parseIfMatch } from '../../utils/etag';

export function createBulkCreateHandler(
  table: TableMetadata,
  pool: Pool,
  metadataStore: MetadataStore,
  config: Config,
) {
  const audit = new AuditLogger(config.audit);

  return async (req: Request, res: Response) => {
    const body = req.body;
    if (!Array.isArray(body)) {
      throw new ValidationError('Bulk create requires an array body');
    }
    if (body.length === 0) {
      res.status(201).json([]);
      return;
    }
    if (body.length > config.bulkMaxRows) {
      throw new ValidationError(`Bulk create limited to ${config.bulkMaxRows} rows`);
    }

    const hasNested = body.some((row: Record<string, unknown>) =>
      Object.values(row).some(v => Array.isArray(v))
    );

    const result = await executeInTransaction(pool, txCtxFromRequest(req), async (client) => {
      let results: Record<string, unknown>[];

      if (hasNested) {
        const writer = new NestedWriter(metadataStore.get());
        results = [];
        for (const row of body) {
          results.push(await writer.create(client, table, row));
        }
      } else {
        const qb = new QueryBuilder(table);
        const { sql, params } = qb.buildBulkInsert(body);
        const dbResult = await client.query(sql, params);
        results = dbResult.rows;
      }

      if (audit.enabled) {
        const pkCol = table.primaryKey?.columns[0] || 'id';
        for (const record of results) {
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
      }

      return results;
    });

    res.status(201).json(result);
  };
}

export function createBulkUpdateHandler(
  table: TableMetadata,
  pool: Pool,
  metadataStore: MetadataStore,
  config: Config,
) {
  const audit = new AuditLogger(config.audit);

  return async (req: Request, res: Response) => {
    const query = req.query as Record<string, string>;
    const filters = parseFilters(query, table);

    if (filters.length === 0) {
      throw new ValidationError('Bulk update requires at least one filter to prevent accidental full-table updates');
    }

    const data = req.body as Record<string, unknown>;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ValidationError('Bulk update body must be an object with fields to update');
    }

    const versionCheck = table.hasVersionColumn
      ? parseIfMatch(req.headers['if-match'] as string | undefined)
      : undefined;

    const result = await executeInTransaction(pool, txCtxFromRequest(req), async (client) => {
      const qb = new QueryBuilder(table);
      const pkCol = table.primaryKey?.columns[0] || 'id';

      let oldRows: Record<string, unknown>[] = [];
      if (audit.enabled || versionCheck !== undefined) {
        const selectQ = qb.buildSelect({ filters });
        const oldResult = await client.query(selectQ.sql, selectQ.params);
        oldRows = oldResult.rows;
      }

      if (versionCheck !== undefined && oldRows.length > 0) {
        const mismatch = oldRows.find(r => Number(r.version) !== versionCheck);
        if (mismatch) {
          throw new ConflictError(
            `Version conflict: record ${mismatch[pkCol]} has version ${mismatch.version}, expected ${versionCheck}`
          );
        }
      }

      const { sql, params } = qb.buildBulkUpdate(data, filters);
      if (!sql) throw new ValidationError('No valid columns to update');
      const dbResult = await client.query(sql, params);
      const results = dbResult.rows;

      if (audit.enabled) {
        const oldMap = new Map(oldRows.map(r => [String(r[pkCol]), r]));
        for (const record of results) {
          await audit.log(client, {
            tableName: table.name,
            recordId: String(record[pkCol] ?? null),
            action: 'UPDATE',
            oldData: oldMap.get(String(record[pkCol])) || null,
            newData: record,
            changedBy: req.jwtPayload?.sub || null,
            role: req.dbRole || null,
            ipAddress: req.ip || null,
          });
        }
      }

      return results;
    });

    if (table.hasVersionColumn && result.length > 0 && result[0].version !== undefined) {
      res.set('ETag', formatETag(result[0].version));
    }

    res.json(result);
  };
}

export function createBulkDeleteHandler(
  table: TableMetadata,
  pool: Pool,
  config: Config,
) {
  const audit = new AuditLogger(config.audit);

  return async (req: Request, res: Response) => {
    const query = req.query as Record<string, string>;
    const filters = parseFilters(query, table);

    if (filters.length === 0) {
      throw new ValidationError('Bulk delete requires at least one filter to prevent accidental full-table deletes');
    }

    const versionCheck = table.hasVersionColumn
      ? parseIfMatch(req.headers['if-match'] as string | undefined)
      : undefined;

    const result = await executeInTransaction(pool, txCtxFromRequest(req), async (client) => {
      const qb = new QueryBuilder(table);
      const pkCol = table.primaryKey?.columns[0] || 'id';

      if (versionCheck !== undefined) {
        const selectQ = qb.buildSelect({ filters });
        const existingResult = await client.query(selectQ.sql, selectQ.params);
        const mismatch = existingResult.rows.find(r => Number(r.version) !== versionCheck);
        if (mismatch) {
          throw new ConflictError(
            `Version conflict: record ${mismatch[pkCol]} has version ${mismatch.version}, expected ${versionCheck}`
          );
        }
      }

      const { sql, params } = qb.buildBulkDelete(filters);
      const dbResult = await client.query(sql, params);
      const results = dbResult.rows;

      if (audit.enabled) {
        for (const record of results) {
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
      }

      return results;
    });

    res.json(result);
  };
}
