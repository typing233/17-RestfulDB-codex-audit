import { Pool, PoolClient } from 'pg';
import { switchRole } from '../auth/role-switcher';
import { translatePgError } from '../errors';

export async function executeInTransaction<T>(
  pool: Pool,
  role: string | undefined,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (role) {
      await switchRole(client, role);
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
