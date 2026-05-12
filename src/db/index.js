import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { allTables } from './schema.js';

let pool;
let db;

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to use the Postgres backend');
  }
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

export function getDb() {
  if (!db) {
    db = drizzle(getPool(), { schema: allTables });
  }
  return db;
}

export { allTables };
