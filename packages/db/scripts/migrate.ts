/**
 * Basit, sıralı SQL migrasyon aracı. Tablo sahibi rolle çalışır.
 * Her dosya tek transaction içinde uygulanır ve schema_migrations'a yazılır.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import postgres from 'postgres';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrate(url: string, log = console.log) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`create table if not exists schema_migrations (
      name text primary key, checksum text not null, applied_at timestamptz not null default now())`;
    const applied = new Map(
      (await sql<{ name: string; checksum: string }[]>`select name, checksum from schema_migrations`).map(
        (r) => [r.name, r.checksum],
      ),
    );
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      const body = await readFile(join(dir, f), 'utf8');
      const sum = createHash('sha256').update(body).digest('hex');
      const prev = applied.get(f);
      if (prev) {
        if (prev !== sum) throw new Error(`Uygulanmış migrasyon değiştirilmiş: ${f}`);
        continue;
      }
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into schema_migrations (name, checksum) values (${f}, ${sum})`;
      });
      log(`✓ ${f}`);
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('DATABASE_OWNER_URL tanımlı değil');
  await migrate(url);
}
