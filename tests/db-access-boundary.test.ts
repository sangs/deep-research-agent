// Only lib/db-access.ts may import the raw connection (drizzle/db.ts). Everything
// else goes through withUser() / withWorker(), so row security always applies.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const SCAN = ['app', 'lib', 'components', 'context', 'auth.ts', 'proxy.ts'];
const ALLOWED = new Set(['lib/db-access.ts']);

function files(rel: string): string[] {
  const abs = path.join(ROOT, rel);
  if (statSync(abs).isFile()) return /\.(ts|tsx)$/.test(rel) ? [rel] : [];
  return readdirSync(abs).flatMap((name) => files(path.join(rel, name)));
}

describe('database access boundary', () => {
  it('nothing but lib/db-access.ts imports drizzle/db', () => {
    const offenders = SCAN.flatMap(files).filter((f) => {
      if (ALLOWED.has(f)) return false;
      const src = readFileSync(path.join(ROOT, f), 'utf8');
      return /from ['"](@\/drizzle\/db|(\.\.\/)+drizzle\/db)['"]/.test(src) || /\bgetDb\s*\(/.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it('nothing in the backend uses the raw pool outside services/db.py', () => {
    const py = (rel: string): string[] => {
      const abs = path.join(ROOT, rel);
      if (statSync(abs).isFile()) return rel.endsWith('.py') ? [rel] : [];
      return readdirSync(abs).flatMap((n) => py(path.join(rel, n)));
    };
    const offenders = ['backend/services', 'backend/tools', 'backend/jobs', 'backend/main.py']
      .flatMap(py)
      .filter((f) => f !== 'backend/services/db.py')
      .filter((f) => /\bget_pool\b|pool\.acquire\(/.test(readFileSync(path.join(ROOT, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
