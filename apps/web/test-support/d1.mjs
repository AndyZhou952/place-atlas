// SQLite-backed D1 statements for offline persistence tests.
export function toD1(database) {
  function statement(sql, values = []) {
    return {
      bind(...parameters) {
        return statement(sql, parameters);
      },
      async run() {
        const result = database.prepare(sql).run(...values);
        return {
          success: true,
          meta: { changes: Number(result.changes) },
          results: [],
        };
      },
      async first() {
        return database.prepare(sql).get(...values) ?? null;
      },
      async all() {
        return { results: database.prepare(sql).all(...values) };
      },
    };
  }
  return {
    prepare: statement,
    async batch(statements) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
