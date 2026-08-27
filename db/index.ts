import { drizzle } from 'drizzle-orm/netlify-db';
import * as schema from './schema.js';

/**
 * Netlify Database client.
 *
 * The connection is provided by the platform; no connection string is read,
 * logged or stored by application code. The client is created lazily and the
 * failure is non-fatal: with no database attached the app still runs, serving
 * clearly-labelled mock fixtures. That keeps the first deploy inspectable
 * without provisioning anything.
 */
type DrizzleReturn = ReturnType<typeof drizzle<typeof schema>>;
export type Database = Extract<DrizzleReturn, { batch: unknown }>;

let cached: Database | null | undefined;

export function getDb(): Database | null {
  if (cached !== undefined) return cached;
  try {
    cached = drizzle({ schema }) as Database;
  } catch {
    cached = null;
  }
  return cached ?? null;
}

export { schema };
