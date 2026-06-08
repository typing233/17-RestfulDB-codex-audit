import { Pool, PoolClient } from 'pg';
import { switchRole } from '../auth/role-switcher';
import { translatePgError } from '../errors';

export interface TransactionContext {
  role?: string;
  sub?: string;
  ip?: string;
  claims?: Record<string, unknown>;
}

export async function executeInTransaction<T>(
  pool: Pool,
  ctx: TransactionContext | string | undefined,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const context: TransactionContext = typeof ctx === 'string'
    ? { role: ctx }
    : (ctx || {});

  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');

    if (context.role) {
      await switchRole(client, context.role);
    }

    if (context.claims) {
      await client.query(
        `SELECT set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify(context.claims)],
      );
    }
    if (context.sub) {
      await client.query(
        `SELECT set_config('request.jwt.sub', $1, true)`,
        [context.sub],
      );
    }
    if (context.role) {
      await client.query(
        `SELECT set_config('request.jwt.role', $1, true)`,
        [context.role],
      );
    }

    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error: any) {
    await client.query('ROLLBACK');
    if (error.code && error.code.match(/^[0-9]{5}$/)) {
      throw translatePgError(error);
    }
    throw error;
  } finally {
    client.release();
  }
}
