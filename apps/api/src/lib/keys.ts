/**
 * Büro veri anahtarlarının (DEK) yönetimi. Açılmış anahtarlar kısa süre bellekte tutulur.
 */
import { LocalKeyWrapper, deriveKey, newDek, open, seal, tcknHmac, type KeyWrapper } from '@lawgent/crypto';
import type { Sql, Tx } from '@lawgent/db';

const TTL_MS = 5 * 60 * 1000;

export class TenantKeys {
  private cache = new Map<string, { dek: Buffer; at: number }>();
  constructor(readonly wrapper: KeyWrapper) {}

  static local(masterKey: string) {
    return new TenantKeys(new LocalKeyWrapper(masterKey));
  }

  /** Büro anahtarını okur (RLS: yalnızca bağlamdaki büronunki görünür). */
  async dek(tx: Tx, tenantId: string): Promise<Buffer> {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.dek;
    const [row] = await tx<{ wrapped_dek: Buffer }[]>`select wrapped_dek from tenant_keys where tenant_id = ${tenantId}`;
    if (!row) throw new Error('Büro anahtarı bulunamadı');
    const dek = await this.wrapper.unwrap(row.wrapped_dek);
    this.cache.set(tenantId, { dek, at: Date.now() });
    return dek;
  }

  /** Yeni büro için anahtar oluşturur (tablo sahibi bağlantısıyla çağrılır). */
  async provision(ownerSql: Sql, tenantId: string) {
    const wrapped = await this.wrapper.wrap(newDek());
    await ownerSql`insert into tenant_keys (tenant_id, wrapped_dek, kek_id)
                   values (${tenantId}, ${wrapped}, ${this.wrapper.kekId}) on conflict do nothing`;
  }

  async encryptObject(tx: Tx, tenantId: string, objectKey: string, plain: Buffer) {
    return seal(deriveKey(await this.dek(tx, tenantId), 'object'), plain, Buffer.from(objectKey));
  }

  async decryptObject(tx: Tx, tenantId: string, objectKey: string, sealed: Buffer) {
    return open(deriveKey(await this.dek(tx, tenantId), 'object'), sealed, Buffer.from(objectKey));
  }

  async encryptTckn(tx: Tx, tenantId: string, tckn: string) {
    const dek = await this.dek(tx, tenantId);
    return { enc: seal(deriveKey(dek, 'tckn'), Buffer.from(tckn)), hmac: tcknHmac(dek, tckn) };
  }

  async tcknHmac(tx: Tx, tenantId: string, tckn: string) {
    return tcknHmac(await this.dek(tx, tenantId), tckn);
  }
}
