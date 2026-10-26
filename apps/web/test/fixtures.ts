// Synthetic fixtures shared by tests. No real records or identifiers.
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export const LISTING_URL = 'https://tabelog.com/tokyo/A1317/A131701/13000001/';

/** A fetch stub that routes by URL prefix; unmatched requests fail like a network error. */
export function stubFetch(
  routes: Record<string, (request: Request) => Response | Promise<Response>>,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const route = Object.keys(routes).find((prefix) => request.url.startsWith(prefix));
    if (!route) throw new TypeError(`unexpected fetch ${request.url}`);
    return routes[route](request);
  }) as typeof fetch;
}

const MIGRATIONS = new URL('../migrations/owner-poc/', import.meta.url);

/** An in-memory SQLite database with every production migration applied, behind a D1 shape. */
export function migratedD1(): { db: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort())
    sqlite.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
  const prepare = (sql: string) => {
    let values: unknown[] = [];
    const statement = {
      bind(...next: unknown[]) {
        values = next;
        return statement;
      },
      async run() {
        // D1 returns rows for a read inside a batch, too.
        if (/^\s*SELECT\b/iu.test(sql))
          return {
            success: true,
            results: sqlite.prepare(sql).all(...(values as never[])),
            meta: { changes: 0 },
          };
        const result = sqlite.prepare(sql).run(...(values as never[]));
        return { success: true, meta: { changes: Number(result.changes) } };
      },
      async first() {
        return sqlite.prepare(sql).get(...(values as never[])) ?? null;
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...(values as never[])) };
      },
    };
    return statement;
  };
  const db = {
    prepare,
    async batch(statements: { run(): Promise<unknown> }[]) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { db: db as unknown as D1Database, sqlite };
}
