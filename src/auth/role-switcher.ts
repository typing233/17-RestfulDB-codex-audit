import { PoolClient } from 'pg';

const VALID_ROLE_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export async function switchRole(client: PoolClient, role: string): Promise<void> {
  if (!VALID_ROLE_REGEX.test(role)) {
    throw new Error(`Invalid role name: ${role}`);
  }
  await client.query(`SET LOCAL ROLE "${role}"`);
}
