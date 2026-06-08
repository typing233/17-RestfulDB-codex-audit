import dotenv from 'dotenv';
dotenv.config();

function env(key: string, fallback?: string): string {
  const val = process.env[key];
  if (val !== undefined) return val;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable: ${key}`);
}

export interface Config {
  port: number;
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    poolMin: number;
    poolMax: number;
    idleTimeoutMs: number;
    connectionTimeoutMs: number;
    ssl: boolean;
  };
  schemas: string[];
  auth: {
    enabled: boolean;
    jwtSecret: string;
    jwtAlgorithm: string;
    roleClaim: string;
    anonRole: string;
  };
  introspection: {
    intervalMs: number;
    excludeTables: string[];
  };
  pagination: {
    defaultLimit: number;
    maxLimit: number;
  };
  cors: {
    origins: string[];
    credentials: boolean;
  };
  rateLimit: {
    enabled: boolean;
    windowMs: number;
    maxRequests: number;
    keyBy: 'ip' | 'role';
  };
  bodyLimit: string;
  audit: {
    enabled: boolean;
    tableName: string;
  };
  bulkMaxRows: number;
}

export function loadConfig(): Config {
  return {
    port: parseInt(env('RESTFULDB_PORT', '3000'), 10),
    database: {
      host: env('RESTFULDB_DB_HOST', 'localhost'),
      port: parseInt(env('RESTFULDB_DB_PORT', '5432'), 10),
      database: env('RESTFULDB_DB_NAME', 'postgres'),
      user: env('RESTFULDB_DB_USER', 'postgres'),
      password: env('RESTFULDB_DB_PASSWORD', ''),
      poolMin: parseInt(env('RESTFULDB_DB_POOL_MIN', '2'), 10),
      poolMax: parseInt(env('RESTFULDB_DB_POOL_MAX', '10'), 10),
      idleTimeoutMs: parseInt(env('RESTFULDB_DB_IDLE_TIMEOUT_MS', '30000'), 10),
      connectionTimeoutMs: parseInt(env('RESTFULDB_DB_CONNECTION_TIMEOUT_MS', '5000'), 10),
      ssl: env('RESTFULDB_DB_SSL', 'false') === 'true',
    },
    schemas: env('RESTFULDB_SCHEMAS', 'public').split(',').map(s => s.trim()),
    auth: {
      enabled: env('RESTFULDB_AUTH_ENABLED', 'true') === 'true',
      jwtSecret: env('RESTFULDB_JWT_SECRET', 'changeme'),
      jwtAlgorithm: env('RESTFULDB_JWT_ALGORITHM', 'HS256'),
      roleClaim: env('RESTFULDB_JWT_ROLE_CLAIM', 'role'),
      anonRole: env('RESTFULDB_ANON_ROLE', 'anon'),
    },
    introspection: {
      intervalMs: parseInt(env('RESTFULDB_INTROSPECTION_INTERVAL_MS', '60000'), 10),
      excludeTables: env('RESTFULDB_EXCLUDE_TABLES', '').split(',').map(s => s.trim()).filter(Boolean),
    },
    pagination: {
      defaultLimit: parseInt(env('RESTFULDB_DEFAULT_LIMIT', '50'), 10),
      maxLimit: parseInt(env('RESTFULDB_MAX_LIMIT', '1000'), 10),
    },
    cors: {
      origins: env('RESTFULDB_CORS_ORIGINS', '*').split(',').map(s => s.trim()),
      credentials: env('RESTFULDB_CORS_CREDENTIALS', 'true') === 'true',
    },
    rateLimit: {
      enabled: env('RESTFULDB_RATE_LIMIT_ENABLED', 'false') === 'true',
      windowMs: parseInt(env('RESTFULDB_RATE_LIMIT_WINDOW_MS', '60000'), 10),
      maxRequests: parseInt(env('RESTFULDB_RATE_LIMIT_MAX', '100'), 10),
      keyBy: env('RESTFULDB_RATE_LIMIT_KEY_BY', 'ip') as 'ip' | 'role',
    },
    bodyLimit: env('RESTFULDB_BODY_LIMIT', '10mb'),
    audit: {
      enabled: env('RESTFULDB_AUDIT_ENABLED', 'false') === 'true',
      tableName: env('RESTFULDB_AUDIT_TABLE', '_audit_log'),
    },
    bulkMaxRows: parseInt(env('RESTFULDB_BULK_MAX_ROWS', '1000'), 10),
  };
}
