import { PoolClient } from 'pg';
import { Config } from '../config';
import { quote } from '../utils/naming';
import logger from '../logger';

export interface AuditEntry {
  tableName: string;
  recordId: string | null;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  changedBy: string | null;
  role: string | null;
  ipAddress: string | null;
}

export class AuditLogger {
  constructor(private config: Config['audit']) {}

  get enabled(): boolean {
    return this.config.enabled;
  }

  async log(client: PoolClient, entry: AuditEntry): Promise<void> {
    if (!this.config.enabled) return;

    try {
      const table = quote(this.config.tableName);
      await client.query(
        `INSERT INTO ${table} (table_name, record_id, action, old_data, new_data, changed_by, role, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::inet)`,
        [
          entry.tableName,
          entry.recordId,
          entry.action,
          entry.oldData ? JSON.stringify(entry.oldData) : null,
          entry.newData ? JSON.stringify(entry.newData) : null,
          entry.changedBy,
          entry.role,
          entry.ipAddress,
        ],
      );
    } catch (err) {
      logger.warn({ err, entry: entry.tableName }, 'Failed to write audit log');
    }
  }
}
