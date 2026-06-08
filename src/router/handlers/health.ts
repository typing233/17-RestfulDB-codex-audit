import { Request, Response } from 'express';
import { Pool } from 'pg';
import { MetadataStore } from '../../introspection';

const startedAt = Date.now();

export function createHealthHandler(pool: Pool, metadataStore: MetadataStore) {
  return async (_req: Request, res: Response) => {
    const start = Date.now();
    let dbConnected = false;

    try {
      await pool.query('SELECT 1');
      dbConnected = true;
    } catch {}

    const latencyMs = Date.now() - start;
    const metadata = metadataStore.get();
    const status = dbConnected ? 'healthy' : 'unhealthy';

    res.status(dbConnected ? 200 : 503).json({
      status,
      version: process.env.npm_package_version || '1.0.0',
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      database: { connected: dbConnected, latencyMs },
      tablesDiscovered: metadata.tables.size,
      lastSchemaRefresh: metadata.lastRefreshed,
    });
  };
}
