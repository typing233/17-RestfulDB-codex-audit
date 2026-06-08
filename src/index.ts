import { loadConfig } from './config';
import { createPool } from './db/pool';
import { Introspector, MetadataStore } from './introspection';
import { DynamicRouter } from './router';
import { OpenAPIGenerator } from './openapi';
import { SchemaScheduler } from './utils/scheduler';
import { createApp } from './app';

async function main() {
  const config = loadConfig();
  const pool = createPool(config.database);

  try {
    await pool.query('SELECT 1');
    console.log('Database connected successfully');
  } catch (err: any) {
    console.error('Failed to connect to database:', err.message);
    process.exit(1);
  }

  const introspector = new Introspector(pool, config.schemas, config.introspection.excludeTables);
  const metadata = await introspector.discover();
  console.log(`Discovered ${metadata.tables.size} tables in schemas: ${config.schemas.join(', ')}`);

  const metadataStore = new MetadataStore(metadata);
  const dynamicRouter = new DynamicRouter(pool, metadataStore, config);
  const openapiGenerator = new OpenAPIGenerator(config);

  dynamicRouter.rebuild(metadata);
  openapiGenerator.rebuild(metadata);

  const scheduler = new SchemaScheduler(introspector, metadataStore, dynamicRouter, openapiGenerator);
  scheduler.start(config.introspection.intervalMs);

  const app = createApp({ config, pool, metadataStore, dynamicRouter, openapiGenerator, scheduler });

  app.listen(config.port, () => {
    console.log(`RestfulDB running on http://localhost:${config.port}`);
    console.log(`Swagger docs: http://localhost:${config.port}/docs`);
    console.log(`Schema auto-refresh interval: ${config.introspection.intervalMs}ms`);

    for (const [key, table] of metadata.tables) {
      const routes = [`GET /${table.name}`, `POST /${table.name}`, `GET /${table.name}/:id`, `PUT /${table.name}/:id`, `PATCH /${table.name}/:id`, `DELETE /${table.name}/:id`];
      for (const ref of table.referencedBy) {
        routes.push(`GET /${table.name}/:id/${ref.referencedTable}`);
        routes.push(`POST /${table.name}/:id/${ref.referencedTable}`);
      }
      console.log(`  ${table.schema}.${table.name}: ${routes.length} endpoints`);
    }
  });

  process.on('SIGTERM', async () => {
    console.log('Shutting down...');
    scheduler.stop();
    await pool.end();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('Shutting down...');
    scheduler.stop();
    await pool.end();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
