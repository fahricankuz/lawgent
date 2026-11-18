/**
 * Zarf şifreleme (envelope encryption).
 *
 *   Ana anahtar (KEK) ──sarar──> büro veri anahtarı (DEK) ──şifreler──> TCKN, belge
 *
 * Geliştirmede KEK ortam değişkeninden gelir. Üretimde `KeyWrapper` arayüzü
 * Vault Transit ile değiştirilir; KEK hiçbir zaman uygulama belleğine girmez.
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, createHash } from 'node:crypto';

const MAGIC = Buffer.from('LGE1');
const IV_LEN = 12;
const TAG_LEN = 16;

export interface KeyWrapper {
  readonly kekId: string;
  wrap(dek: Buffer): Promise<Buffer>;
  unwrap(wrapped: Buffer): Promise<Buffer>;
}

/** Geliştirme/CI için yerel anahtar. Üretimde VaultTransitWrapper kullanılır. */
export class LocalKeyWrapper implements KeyWrapper {
  readonly kekId: string;
  private readonly kek: Buffer;

  constructor(masterKeyBase64: string) {
    const kek = Buffer.from(masterKeyBase64, 'base64');
    if (kek.length !== 32) throw new Error('MASTER_KEY 32 bayt (base64) olmalı');
    this.kek = kek;
    this.kekId = 'local:' + createHash('sha256').update(kek).digest('hex').slice(0, 12);
  }

  async wrap(dek: Buffer) {
    return seal(this.kek, dek, Buffer.from('dek'));
  }

  async unwrap(wrapped: Buffer) {
    return open(this.kek, wrapped, Buffer.from('dek'));
  }
}

export function newDek(): Buffer {
  return randomBytes(32);
}

/** AES-256-GCM. Çıktı: MAGIC | IV | şifreli metin | etiket */
export function seal(key: Buffer, plaintext: Buffer, aad?: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const c = createCipheriv('aes-256-gcm', key, iv);
  if (aad) c.setAAD(aad);
  const body = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([MAGIC, iv, body, c.getAuthTag()]);
}

export function open(key: Buffer, sealed: Buffer, aad?: Buffer): Buffer {
  if (sealed.length < MAGIC.length + IV_LEN + TAG_LEN || !sealed.subarray(0, 4).equals(MAGIC)) {
    throw new Error('Geçersiz şifreli veri');
  }
  const iv = sealed.subarray(4, 4 + IV_LEN);
  const tag = sealed.subarray(sealed.length - TAG_LEN);
  const body = sealed.subarray(4 + IV_LEN, sealed.length - TAG_LEN);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  if (aad) d.setAAD(aad);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]);
}

/** Büro DEK'inden amaç başına alt anahtar türetir (aynı anahtar iki işte kullanılmaz). */
export function deriveKey(dek: Buffer, purpose: 'tckn' | 'tckn-hmac' | 'object'): Buffer {
  return Buffer.from(hkdfSync('sha256', dek, Buffer.alloc(0), Buffer.from('lawgent:' + purpose), 32));
}

/** TCKN'yi eşleşme için deterministik HMAC'e çevirir (büroya özgü). */
export function tcknHmac(dek: Buffer, tckn: string): Buffer {
  return createHmac('sha256', deriveKey(dek, 'tckn-hmac')).update(tckn.trim()).digest();
}

/** TCKN algoritma kontrolü (11 hane, ilk hane 0 değil, 10. ve 11. hane kontrol rakamları). */
export function isValidTckn(v: string): boolean {
  if (!/^[1-9][0-9]{10}$/.test(v)) return false;
  const d = v.split('').map(Number) as number[];
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
  const even = d[1]! + d[3]! + d[5]! + d[7]!;
  const d10 = (((odd * 7 - even) % 10) + 10) % 10;
  const d11 = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  return d[9] === d10 && d[10] === d11;
}

export function sha256(buf: Buffer): Buffer {
  return createHash('sha256').update(buf).digest();
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
