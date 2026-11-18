/**
 * Büro ve kullanıcı oluşturma (yönetim işlemi). Tablo sahibi bağlantısıyla çalışır;
 * uygulama rolü bu işlemleri yapamaz. İleride yönetim paneline taşınacak.
 */
import { hash } from '@node-rs/argon2';
import type { Sql } from '@lawgent/db';
import type { TenantKeys } from './keys.js';

export async function createTenant(owner: Sql, keys: TenantKeys, input: { name: string; slug: string }) {
  const [t] = await owner<{ id: string }[]>`
    insert into tenants (name, slug) values (${input.name}, ${input.slug})
    on conflict (slug) do update set name = excluded.name returning id`;
  await keys.provision(owner, t!.id);
  return t!.id;
}

export async function createUser(
  owner: Sql,
  input: { tenantId: string; email: string; fullName: string; password: string; role: 'owner' | 'partner' | 'lawyer' | 'staff'; title?: string },
) {
  const passwordHash = await hash(input.password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const [u] = await owner<{ id: string }[]>`
    insert into users (email, full_name, password_hash) values (${input.email}, ${input.fullName}, ${passwordHash})
    on conflict (email) do update set full_name = excluded.full_name returning id`;
  await owner`insert into tenant_members (tenant_id, user_id, role, title)
              values (${input.tenantId}, ${u!.id}, ${input.role}, ${input.title ?? null})
              on conflict do nothing`;
  return u!.id;
}
