import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getConfig } from '../config/index.js';
import * as schema from './schema.js';
import { StorageError } from '../errors.js';

let connection: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!db) {
    const config = getConfig().database;
    try {
      connection = postgres({
        host: config.host,
        port: config.port,
        database: config.database,
        username: config.user,
        password: config.password,
        max: 10,
        idle_timeout: 30,
        connect_timeout: 10,
        prepare: false,
      });
      db = drizzle(connection, { schema });
    } catch (err) {
      throw new StorageError(
        `Failed to create database connection: ${(err as Error).message}`,
        err
      );
    }
  }
  return db;
}

export async function closeConnection(): Promise<void> {
  if (connection) {
    try {
      await connection.end();
    } catch (err) {
      throw new StorageError(
        `Failed to close database connection: ${(err as Error).message}`,
        err
      );
    } finally {
      connection = null;
      db = null;
    }
  }
}
