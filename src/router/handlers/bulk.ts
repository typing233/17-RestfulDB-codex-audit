import { Request, Response } from 'express';
import { Pool } from 'pg';
import { TableMetadata, MetadataStore } from '../../introspection';
import { QueryBuilder, parseFilters } from '../../query-builder';
import { NestedWriter } from '../../transaction/nested-writer';
import { executeInTransaction } from '../../transaction';
import { ValidationError } from '../../errors';
import { Config } from '../../config';

export function createBulkCreateHandler(
  table: TableMetadata,
  pool: Pool,
  metadataStore: MetadataStore,
  config: Config,
) {
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

    const result = await executeInTransaction(pool, req.dbRole, async (client) => {
      if (hasNested) {
        const writer = new NestedWriter(metadataStore.get());
        const results: Record<string, unknown>[] = [];
        for (const row of body) {
          results.push(await writer.create(client, table, row));
        }
        return results;
      }

      const qb = new QueryBuilder(table);
      const { sql, params } = qb.buildBulkInsert(body);
      const dbResult = await client.query(sql, params);
      return dbResult.rows;
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

    const result = await executeInTransaction(pool, req.dbRole, async (client) => {
      const qb = new QueryBuilder(table);
      const { sql, params } = qb.buildBulkUpdate(data, filters);
      if (!sql) throw new ValidationError('No valid columns to update');
      const dbResult = await client.query(sql, params);
      return dbResult.rows;
    });

    res.json(result);
  };
}

export function createBulkDeleteHandler(
  table: TableMetadata,
  pool: Pool,
  config: Config,
) {
  return async (req: Request, res: Response) => {
    const query = req.query as Record<string, string>;
    const filters = parseFilters(query, table);

    if (filters.length === 0) {
      throw new ValidationError('Bulk delete requires at least one filter to prevent accidental full-table deletes');
    }

    const result = await executeInTransaction(pool, req.dbRole, async (client) => {
      const qb = new QueryBuilder(table);
      const { sql, params } = qb.buildBulkDelete(filters);
      const dbResult = await client.query(sql, params);
      return dbResult.rows;
    });

    res.json(result);
  };
}
