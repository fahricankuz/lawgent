import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string(),
  MASTER_KEY: z.string(),
  SESSION_TTL_HOURS: z.coerce.number().default(12),
  // true: iki aşamalı doğrulaması olmayan oturum yalnızca /auth uçlarını kullanabilir.
  REQUIRE_MFA: z.stringbool().default(false),
  STORAGE_DRIVER: z.enum(['s3', 'fs']).default('s3'),
  STORAGE_FS_ROOT: z.string().default('.data/objects'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('tr-ist-1'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKET: z.string().default('lawgent-documents'),
  // none: model yok, yalnızca ilgili bölümleri döndür (geliştirme/demo).
  LLM_PROVIDER: z.enum(['openai-compatible', 'none']).default('openai-compatible'),
  LLM_BASE_URL: z.string().default('http://localhost:11434/v1'),
  LLM_MODEL: z.string().default('qwen2.5:7b-instruct'),
  LLM_TIMEOUT_MS: z.coerce.number().default(120_000),
  EMBEDDING_URL: z.string().optional(),
  MAX_UPLOAD_MB: z.coerce.number().default(100),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = schema.safeParse(env);
  if (!r.success) {
    throw new Error('Geçersiz yapılandırma: ' + r.error.issues.map((i) => i.path.join('.')).join(', '));
  }
  if (r.data.NODE_ENV === 'production' && r.data.STORAGE_DRIVER !== 's3') {
    throw new Error('Üretimde STORAGE_DRIVER=s3 olmalı');
  }
  if (r.data.NODE_ENV === 'production' && !r.data.REQUIRE_MFA) {
    throw new Error('Üretimde REQUIRE_MFA=true olmalı');
  }
  return r.data;
}
