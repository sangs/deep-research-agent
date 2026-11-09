import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Isolation suite (design 14 §5.4). The database tests need a disposable
// Postgres prepared by scripts/test-db.sh; run everything with `npm test`.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname) } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false, // the database tests share one disposable database
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
