import { createSql } from '@lawgent/db';
import { loadConfig } from './config.js';
import { HttpAiClient } from './lib/ai.js';
import { TenantKeys } from './lib/keys.js';
import { createStorage } from './lib/storage.js';
import { buildApp } from './server.js';

const cfg = loadConfig();
const sql = createSql(cfg.DATABASE_URL);
const app = await buildApp({
  cfg,
  sql,
  storage: createStorage(cfg),
  keys: TenantKeys.local(cfg.MASTER_KEY),
  ai: new HttpAiClient(cfg),
});

const close = async () => {
  await app.close();
  await sql.end();
  process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);

await app.listen({ port: cfg.API_PORT, host: '0.0.0.0' });
