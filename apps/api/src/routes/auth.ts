import type { FastifyInstance } from 'fastify';
import { verify, hash } from '@node-rs/argon2';
import { randomToken } from '@lawgent/crypto';
import { audit, withContext } from '@lawgent/db';
import { loginInput } from '@lawgent/shared';
import { z } from 'zod';
import { HttpError } from '../lib/errors.js';
import { newTotpSecret, otpauthUrl, verifyTotp } from '../lib/totp.js';
import { SESSION_COOKIE, clientIp, hashToken } from '../server.js';

// Bilinmeyen e-postada da aynı süreyi harcamak için (kullanıcı varlığını sızdırmaz).
const DUMMY_HASH = await hash('lawgent-dummy-password');

interface LoginRow {
  user_id: string;
  password_hash: string;
  totp_enabled: boolean;
  totp_secret_enc: Buffer | null;
  tenant_id: string;
  tenant_name: string;
  role: string;
}

export async function authRoutes(app: FastifyInstance) {
  const { sql, cfg, keys } = app.deps;

  app.post(
    '/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const input = loginInput.parse(req.body);
      const rows = await sql<LoginRow[]>`select * from auth.login_lookup(${input.email})`;
      const first = rows[0];
      const ok = await verify(first?.password_hash ?? DUMMY_HASH, input.password).catch(() => false);
      if (!first || !ok) {
        if (first) {
          await withContext(sql, { tenantId: first.tenant_id, userId: first.user_id }, (tx) =>
            audit(tx, { action: 'auth.login_failed', ip: clientIp(req) ?? undefined }),
          );
        }
        throw new HttpError(401, 'E-posta veya parola hatalı', 'invalid_credentials');
      }

      let mfaVerified = false;
      if (first.totp_enabled && first.totp_secret_enc) {
        if (!input.totp) return reply.send({ status: 'totp_required' });
        const secret = (await keys.wrapper.unwrap(first.totp_secret_enc)).toString();
        if (!verifyTotp(secret, input.totp)) throw new HttpError(401, 'Doğrulama kodu hatalı', 'invalid_totp');
        mfaVerified = true;
      }

      const tenant = input.tenantId ? rows.find((r) => r.tenant_id === input.tenantId) : rows.length === 1 ? first : undefined;
      if (!tenant) {
        return reply.send({
          status: 'choose_tenant',
          tenants: rows.map((r) => ({ id: r.tenant_id, name: r.tenant_name, role: r.role })),
        });
      }

      const token = randomToken();
      const ttl = `${cfg.SESSION_TTL_HOURS} hours`;
      const [{ exp }] = (await sql`select auth.create_session(${hashToken(token)}, ${tenant.user_id}, ${tenant.tenant_id},
        ${mfaVerified}, ${ttl}::interval, ${clientIp(req)}::inet, ${req.headers['user-agent'] ?? null}) as exp`) as unknown as [
        { exp: Date },
      ];
      await withContext(sql, { tenantId: tenant.tenant_id, userId: tenant.user_id }, (tx) =>
        audit(tx, { action: 'auth.login', meta: { mfa: mfaVerified }, ip: clientIp(req) ?? undefined }),
      );
      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: cfg.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        expires: exp,
      });
      return { status: 'ok', mfaSetupRequired: !first.totp_enabled };
    },
  );

  app.post('/logout', async (req, reply) => {
    if (req.session) {
      await app.db(req, (tx) => audit(tx, { action: 'auth.logout' }), { allowWithoutMfa: true });
      await sql`select auth.revoke_session(${req.session.tokenHash})`;
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/me', async (req) => {
    return app.db(
      req,
      async (tx, { session: s }) => {
        const [t] = await tx<{ external_ai_enabled: boolean }[]>`select external_ai_enabled from tenants where id = ${s.tenantId}`;
        const [u] = await tx<{ totp_enabled: boolean }[]>`select totp_enabled from users where id = ${s.userId}`;
        return {
          user: { id: s.userId, email: s.email, fullName: s.fullName, role: s.role, totpEnabled: u?.totp_enabled ?? false },
          tenant: { id: s.tenantId, name: s.tenantName, externalAiEnabled: t?.external_ai_enabled ?? false },
          mfaVerified: s.mfaVerified,
        };
      },
      { allowWithoutMfa: true },
    );
  });

  app.post('/totp/setup', async (req) => {
    return app.db(
      req,
      async (tx, { session: s }) => {
        const [cur] = await tx<{ totp_enabled: boolean }[]>`select * from auth.get_own_totp()`;
        if (cur?.totp_enabled) throw new HttpError(409, 'İki aşamalı doğrulama zaten etkin', 'already_enabled');
        const secret = newTotpSecret();
        await tx`select auth.set_own_totp(${await keys.wrapper.wrap(Buffer.from(secret))}, false)`;
        return { secret, otpauthUrl: otpauthUrl(secret, s.email) };
      },
      { allowWithoutMfa: true },
    );
  });

  app.post('/totp/enable', async (req) => {
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(req.body);
    return app.db(
      req,
      async (tx) => {
        const [cur] = await tx<{ totp_secret_enc: Buffer | null; totp_enabled: boolean }[]>`select * from auth.get_own_totp()`;
        if (!cur?.totp_secret_enc) throw new HttpError(400, 'Önce kurulumu başlatın', 'no_secret');
        const secret = (await keys.wrapper.unwrap(cur.totp_secret_enc)).toString();
        if (!verifyTotp(secret, code)) throw new HttpError(400, 'Doğrulama kodu hatalı', 'invalid_totp');
        await tx`select auth.set_own_totp(${cur.totp_secret_enc}, true)`;
        await audit(tx, { action: 'auth.totp_enabled' });
        return { ok: true, reloginRequired: true };
      },
      { allowWithoutMfa: true },
    );
  });
}
