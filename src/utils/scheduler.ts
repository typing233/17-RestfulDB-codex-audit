import { Introspector, MetadataStore, SchemaMetadata } from '../introspection';
import { DynamicRouter } from '../router';
import { OpenAPIGenerator } from '../openapi';
import crypto from 'crypto';
import logger from '../logger';

export class SchemaScheduler {
  private interval: NodeJS.Timeout | null = null;
  private lastHash: string = '';

  constructor(
    private introspector: Introspector,
    private metadataStore: MetadataStore,
    private dynamicRouter: DynamicRouter,
    private openapiGenerator: OpenAPIGenerator,
  ) {}

  start(intervalMs: number): void {
    this.lastHash = this.hashMetadata(this.metadataStore.get());

    this.interval = setInterval(async () => {
      try {
        await this.refresh();
      } catch (err) {
        logger.error({ err }, 'Schema refresh failed');
      }
    }, intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async refresh(): Promise<boolean> {
    const newMetadata = await this.introspector.discover();
    const newHash = this.hashMetadata(newMetadata);

    if (newHash !== this.lastHash) {
      this.metadataStore.update(newMetadata);
      this.dynamicRouter.rebuild(newMetadata);
      this.openapiGenerator.rebuild(newMetadata);
      this.lastHash = newHash;
      logger.info({ tables: newMetadata.tables.size }, 'Schema refreshed');
      return true;
    }
    return false;
  }

  private hashMetadata(metadata: SchemaMetadata): string {
    const tableKeys = [...metadata.tables.keys()].sort();
    const summary = tableKeys.map(k => {
      const t = metadata.tables.get(k)!;
      const cols = t.columns.map(c => `${c.name}:${c.udtName}`).join(',');
      const fks = t.foreignKeys.map(f => `${f.columns.join('+')}->${f.referencedTable}`).join(',');
      return `${k}[${t.relKind}][${cols}][${fks}]`;
    }).join('|');

    return crypto.createHash('md5').update(summary).digest('hex');
  }
}
