import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { createHash } from 'node:crypto';
import { ZodError } from 'zod';
import { withContext, type RequestContext, type Sql, type Tx } from '@lawgent/db';
import type { Config } from './config.js';
import type { Storage } from './lib/storage.js';
import type { TenantKeys } from './lib/keys.js';
import type { AiClient } from './lib/ai.js';
import { HttpError } from './lib/errors.js';
import { authRoutes } from './routes/auth.js';
import { clientRoutes } from './routes/clients.js';
import { matterRoutes } from './routes/matters.js';
import { documentRoutes } from './routes/documents.js';
import { calendarRoutes } from './routes/calendar.js';
import { chatRoutes } from './routes/chat.js';
import { homeRoutes } from './routes/home.js';

export const SESSION_COOKIE = 'lg_session';

export interface Deps {
  cfg: Config;
  sql: Sql;
  storage: Storage;
  keys: TenantKeys;
  ai: AiClient;
}

export interface SessionInfo {
  userId: string;
  tenantId: string;
  role: 'owner' | 'partner' | 'lawyer' | 'staff';
  email: string;
  fullName: string;
  tenantName: string;
  mfaVerified: boolean;
  tokenHash: Buffer;
}

declare module 'fastify' {
  interface FastifyRequest {
    session: SessionInfo | null;
  }
  interface FastifyInstance {
    deps: Deps;
    /** Oturumu doğrular ve sorguları büro/kullanıcı bağlamında çalıştırır. */
    db<T>(
      req: FastifyRequest,
      fn: (tx: Tx, ctx: RequestContext & { session: SessionInfo }) => Promise<T>,
      opts?: { allowWithoutMfa?: boolean },
    ): Promise<T>;
  }
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest();

export async function buildApp(deps: Deps) {
  const app = Fastify({
    logger:
      deps.cfg.NODE_ENV === 'test'
        ? false
        : {
            level: 'info',
            // Kişisel veri ve oturum bilgisi loglara yazılmaz.
            redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
          },
    bodyLimit: 1024 * 1024,
    trustProxy: true,
  });

  app.decorate('deps', deps);
  app.decorateRequest('session', null);

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: deps.cfg.MAX_UPLOAD_MB * 1024 * 1024, files: 1 } });
  await app.register(rateLimit, { global: false });

  // CSRF: değiştiren isteklerde Origin, web uygulamasının kaynağı olmalı.
  app.addHook('onRequest', async (req) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    const origin = req.headers.origin;
    if (origin && origin !== deps.cfg.WEB_ORIGIN) throw new HttpError(403, 'Geçersiz kaynak', 'bad_origin');
  });

  // Oturum çözümleme
  app.addHook('onRequest', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token || token.length > 200) return;
    const tokenHash = hashToken(token);
    const [s] = await deps.sql<
      {
        user_id: string; tenant_id: string; role: SessionInfo['role']; mfa_verified: boolean;
        email: string; full_name: string; tenant_name: string;
      }[]
    >`select * from auth.resolve_session(${tokenHash})`;
    if (!s) return;
    req.session = {
      userId: s.user_id,
      tenantId: s.tenant_id,
      role: s.role,
      email: s.email,
      fullName: s.full_name,
      tenantName: s.tenant_name,
      mfaVerified: s.mfa_verified,
      tokenHash,
    };
  });

  app.decorate('db', async function <T>(
    req: FastifyRequest,
    fn: (tx: Tx, ctx: RequestContext & { session: SessionInfo }) => Promise<T>,
    opts: { allowWithoutMfa?: boolean } = {},
  ): Promise<T> {
    const s = req.session;
    if (!s) throw new HttpError(401, 'Oturum açmanız gerekiyor', 'unauthenticated');
    if (deps.cfg.REQUIRE_MFA && !s.mfaVerified && !opts.allowWithoutMfa) {
      throw new HttpError(403, 'İki aşamalı doğrulamayı etkinleştirin', 'mfa_required');
    }
    const ctx = { tenantId: s.tenantId, userId: s.userId };
    return withContext(deps.sql, ctx, (tx) => fn(tx, { ...ctx, session: s }));
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply: FastifyReply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: 'validation',
        message: 'Girilen bilgileri kontrol edin',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.code ?? 'error', message: err.message });
    }
    // Postgres: RLS/yetki ihlali → 403, ihlal ayrıntısı istemciye gitmez.
    if (err.code === '42501') {
      req.log.warn({ err: err.message }, 'yetki reddi');
      return reply.status(403).send({ error: 'forbidden', message: 'Bu işlem için yetkiniz yok' });
    }
    if (err.code === '23503' || err.code === '23505') {
      return reply.status(409).send({ error: 'conflict', message: 'Kayıt çakışması' });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: err.code ?? 'error', message: err.message });
    }
    req.log.error(err);
    return reply.status(500).send({ error: 'internal', message: 'Beklenmeyen bir hata oluştu' });
  });

  app.get('/health', async () => ({ ok: true }));

  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(homeRoutes);
  await app.register(clientRoutes);
  await app.register(matterRoutes);
  await app.register(documentRoutes);
  await app.register(calendarRoutes);
  await app.register(chatRoutes);

  return app;
}

export function clientIp(req: FastifyRequest) {
  return req.ip || null;
}
