import pg from 'pg';

export interface PoolOptions {
  /** Puts this schema first on the search path; tests use a schema per test. */
  schema?: string;
  max?: number;
}

export function createPool(connectionString: string, options: PoolOptions = {}): pg.Pool {
  if (options.schema !== undefined && !/^[a-z_][a-z0-9_]*$/.test(options.schema)) {
    throw new Error(`invalid schema name ${options.schema}`);
  }
  return new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    ...(options.schema ? { options: `-c search_path=${options.schema}` } : {}),
  });
}
