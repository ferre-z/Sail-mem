import { IStorage, StorageProvider } from './types.js';
import { SQLiteStorage } from './sqlite.js';
import { PostgresStorage, DrizzleDB } from './postgres.js';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getConfig } from '../config/index.js';
import { StorageError } from '../errors.js';
import * as schema from '../db/schema.js';

export interface StorageFactoryOptions {
  provider?: StorageProvider;
  sqlitePath?: string;
  db?: DrizzleDB;
}

let cached: IStorage | null = null;

export async function createStorage(
  options: StorageFactoryOptions = {}
): Promise<IStorage> {
  if (cached) return cached;

  const provider = options.provider ?? 'sqlite';

  if (provider === 'sqlite') {
    const path = options.sqlitePath ?? process.env.SAIL_MEM_SQLITE_PATH ?? ':memory:';
    const storage = new SQLiteStorage({ path });
    await storage.initialize();
    cached = storage;
    return storage;
  }

  if (provider === 'postgres') {
    if (options.db) {
      cached = new PostgresStorage({ db: options.db });
      return cached;
    }
    const cfg = getConfig().database;
    if (!cfg.host || !cfg.database) {
      throw new StorageError(
        'Postgres storage requires host and database to be configured'
      );
    }
    try {
      const client = postgres({
        host: cfg.host,
        port: cfg.port,
        database: cfg.database,
        username: cfg.user,
        password: cfg.password,
      });
      const db = drizzle(client, { schema });
      cached = new PostgresStorage({ db, client });
      return cached;
    } catch (err) {
      throw new StorageError(
        `Failed to connect to postgres: ${(err as Error).message}`,
        err
      );
    }
  }

  throw new StorageError(`Unknown storage provider: ${provider}`);
}

export function resetStorageCache(): void {
  cached = null;
}

export async function closeStorage(): Promise<void> {
  if (cached) {
    await cached.close();
    cached = null;
  }
}
