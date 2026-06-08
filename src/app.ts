import express, { Request, Response } from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { Pool } from 'pg';
import { Config } from './config';
import { MetadataStore } from './introspection';
import { DynamicRouter } from './router';
import { OpenAPIGenerator } from './openapi';
import { createJwtMiddleware } from './auth';
import { errorHandler } from './middleware/error-handler';
import { SchemaScheduler } from './utils/scheduler';

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

  app.use(cors({
    origin: config.cors.origins.includes('*') ? true : config.cors.origins,
    credentials: config.cors.credentials,
    exposedHeaders: ['X-Total-Count', 'Content-Range'],
  }));

  app.use(express.json({ limit: '10mb' }));

  app.use(createJwtMiddleware(config.auth));

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
