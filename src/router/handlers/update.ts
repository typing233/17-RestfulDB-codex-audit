import { Request, Response } from 'express';
import { Pool } from 'pg';
import { TableMetadata, MetadataStore } from '../../introspection';
import { NestedWriter } from '../../transaction/nested-writer';
import { executeInTransaction } from '../../transaction';
import { NotFoundError } from '../../errors';

export function createUpdateHandler(
  table: TableMetadata,
  pool: Pool,
  metadataStore: MetadataStore,
) {
  return async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const pkCol = table.primaryKey?.columns[0] || 'id';
    const id = req.params.id;

    let versionCheck: number | undefined;
    if (table.hasVersionColumn) {
      if (body.version !== undefined) {
        versionCheck = Number(body.version);
      } else if (req.headers['if-match']) {
        versionCheck = Number(req.headers['if-match']);
      }
    }

    const result = await executeInTransaction(pool, req.dbRole, async (client) => {
      const writer = new NestedWriter(metadataStore.get());
      return writer.update(client, table, id, body, versionCheck);
    });

    res.json(result);
  };
}
