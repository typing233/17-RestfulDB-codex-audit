import express, { Request, Response } from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import pinoHttp from 'pino-http';
import { Pool } from 'pg';
import { Config } from './config';
import { MetadataStore } from './introspection';
import { DynamicRouter } from './router';
import { OpenAPIGenerator } from './openapi';
import { createJwtMiddleware } from './auth';
import { errorHandler } from './middleware/error-handler';
import { createRateLimiter } from './middleware/rate-limiter';
import { inputValidator } from './middleware/input-validator';
import { SchemaScheduler } from './utils/scheduler';
import { createHealthHandler } from './router/handlers/health';
import logger from './logger';

interface AppDeps {
  config: Config;
  pool: Pool;
  metadataStore: MetadataStore;
  dynamicRouter: DynamicRouter;
  openapiGenerator: OpenAPIGenerator;
  scheduler: SchemaScheduler;
}

export function createApp(deps: AppDeps): express.Application {
  const { config, pool, metadataStore, dynamicRouter, openapiGenerator, scheduler } = deps;

  const app = express();

  app.use(pinoHttp({ logger: logger as any, autoLogging: { ignore: (req) => (req as any).url === '/_health' } }));

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      for (const pattern of config.cors.origins) {
        if (pattern === '*') return callback(null, true);
        if (pattern.startsWith('/') && pattern.endsWith('/')) {
          if (new RegExp(pattern.slice(1, -1)).test(origin)) return callback(null, true);
        } else if (origin === pattern) {
          return callback(null, true);
        }
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: config.cors.credentials,
    exposedHeaders: ['X-Total-Count', 'Content-Range', 'ETag', 'Link', 'Retry-After'],
  }));

  app.use(express.json({ limit: config.bodyLimit }));

  app.get('/_health', createHealthHandler(pool, metadataStore));

  app.use(createJwtMiddleware(config.auth));
  app.use(createRateLimiter(config.rateLimit));
  app.use(inputValidator);

  app.get('/docs/openapi.json', (_req: Request, res: Response) => {
    res.json(openapiGenerator.getSpec());
  });

  app.use('/docs', swaggerUi.serve, swaggerUi.setup(undefined, {
    swaggerOptions: { url: '/docs/openapi.json' },
  }));

  app.post('/_reload', async (_req: Request, res: Response) => {
    try {
      const changed = await scheduler.refresh();
      res.json({
        reloaded: changed,
        tables: metadataStore.get().tables.size,
        lastRefreshed: metadataStore.get().lastRefreshed,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/_meta', (_req: Request, res: Response) => {
    const metadata = metadataStore.get();
    const tables = [...metadata.tables.values()].map(t => ({
      schema: t.schema,
      name: t.name,
      relKind: t.relKind,
      columns: t.columns.length,
      primaryKey: t.primaryKey?.columns,
      foreignKeys: t.foreignKeys.map(fk => ({
        columns: fk.columns,
        references: `${fk.referencedTable}(${fk.referencedColumns.join(',')})`,
      })),
      hasVersionColumn: t.hasVersionColumn,
    }));
    res.json({ tables, lastRefreshed: metadata.lastRefreshed });
  });

  app.use(dynamicRouter.handler());

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  app.use(errorHandler);

  return app;
}
