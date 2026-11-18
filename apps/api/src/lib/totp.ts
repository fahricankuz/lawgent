/** RFC 6238 TOTP (SHA-1, 6 hane, 30 sn). Authenticator uygulamalarıyla uyumlu. */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Geçersiz base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpAt(secret: string, time = Date.now(), step = 30): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 1000 / step)));
  const h = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  const code = (h.readUInt32BE(o) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

/** ±1 adım saat kaymasına izin verir. */
export function verifyTotp(secret: string, code: string, time = Date.now()): boolean {
  for (const d of [-1, 0, 1]) {
    const expected = Buffer.from(totpAt(secret, time + d * 30_000));
    const given = Buffer.from(code.padStart(6, '0').slice(0, 6));
    if (timingSafeEqual(expected, given)) return true;
  }
  return false;
}

export function otpauthUrl(secret: string, email: string) {
  return `otpauth://totp/Lawgent:${encodeURIComponent(email)}?secret=${secret}&issuer=Lawgent`;
}
