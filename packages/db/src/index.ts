import postgres from 'postgres';

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

export interface RequestContext {
  tenantId: string;
  userId: string;
}

export function createSql(url: string, opts: postgres.Options<{}> = {}): Sql {
  return postgres(url, {
    max: 10,
    idle_timeout: 30,
    // bytea → Buffer, tarih → Date (postgres.js varsayılanları)
    ...opts,
  });
}

/**
 * Tüm uygulama sorguları bu fonksiyonun içinden geçmelidir.
 * Büro ve kullanıcı bağlamı yalnızca bu transaction için (SET LOCAL) ayarlanır;
 * havuzdaki bağlantı bir sonraki isteğe bağlam sızdırmaz.
 */
export async function withContext<T>(
  sql: Sql,
  ctx: RequestContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${ctx.tenantId}, true),
                    set_config('app.user_id', ${ctx.userId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

/** Worker için: kullanıcı yok, yalnızca büro bağlamı. */
export async function withTenant<T>(sql: Sql, tenantId: string, fn: (tx: Tx) => Promise<T>) {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

export interface AuditInput {
  action: string;
  entityType?: string;
  entityId?: string;
  matterId?: string;
  meta?: Record<string, unknown>;
  ip?: string;
}

export async function audit(tx: Tx, e: AuditInput) {
  await tx`select app.audit(${e.action}, ${e.entityType ?? null}, ${e.entityId ?? null},
                            ${e.matterId ?? null}, ${tx.json((e.meta ?? {}) as postgres.JSONValue)},
                            ${e.ip ?? null}::inet)`;
}
