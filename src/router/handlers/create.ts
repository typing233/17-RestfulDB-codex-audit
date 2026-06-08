import { Request, Response } from 'express';
import { Pool } from 'pg';
import { TableMetadata, MetadataStore } from '../../introspection';
import { NestedWriter } from '../../transaction/nested-writer';
import { executeInTransaction } from '../../transaction';

export function createCreateHandler(
  table: TableMetadata,
  pool: Pool,
  metadataStore: MetadataStore,
  prefill?: { column: string; paramName: string },
) {
  return async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;

    if (prefill) {
      body[prefill.column] = req.params[prefill.paramName];
    }

    const result = await executeInTransaction(pool, req.dbRole, async (client) => {
      const writer = new NestedWriter(metadataStore.get());
      return writer.create(client, table, body);
    });

    res.status(201).json(result);
  };
}
