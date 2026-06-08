import { loadConfig } from './config';
import { createPool } from './db/pool';
import { Introspector, MetadataStore } from './introspection';
import { DynamicRouter } from './router';
import { OpenAPIGenerator } from './openapi';
import { SchemaScheduler } from './utils/scheduler';
import { createApp } from './app';
import logger from './logger';

async function main() {
  const config = loadConfig();
  const pool = createPool(config.database);

  try {
    await pool.query('SELECT 1');
    logger.info('Database connected successfully');
  } catch (err: any) {
    logger.fatal({ err }, 'Failed to connect to database');
    process.exit(1);
  }

  const introspector = new Introspector(pool, config.schemas, config.introspection.excludeTables);
  const metadata = await introspector.discover();
  logger.info({ schemas: config.schemas, tables: metadata.tables.size }, 'Schema introspection complete');

  const metadataStore = new MetadataStore(metadata);
  const dynamicRouter = new DynamicRouter(pool, metadataStore, config);
  const openapiGenerator = new OpenAPIGenerator(config);

  dynamicRouter.rebuild(metadata);
  openapiGenerator.rebuild(metadata);

  const scheduler = new SchemaScheduler(introspector, metadataStore, dynamicRouter, openapiGenerator);
  scheduler.start(config.introspection.intervalMs);

  const app = createApp({ config, pool, metadataStore, dynamicRouter, openapiGenerator, scheduler });

  app.listen(config.port, () => {
    logger.info({ port: config.port, docs: `http://localhost:${config.port}/docs` }, 'RestfulDB running');

    for (const [, table] of metadata.tables) {
      const kind = table.relKind === 'table' ? '' : ` [${table.relKind}]`;
      logger.debug({ table: `${table.schema}.${table.name}`, kind: table.relKind }, 'Registered endpoints');
    }
  });

  process.on('SIGTERM', async () => {
    logger.info('Shutting down...');
    scheduler.stop();
    await pool.end();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('Shutting down...');
    scheduler.stop();
    await pool.end();
    process.exit(0);
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal error');
  process.exit(1);
});
