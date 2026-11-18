import { describe, expect, it } from 'vitest';
import { LocalKeyWrapper, deriveKey, isValidTckn, newDek, open, seal, tcknHmac } from '../src/index.js';

const MASTER = Buffer.alloc(32, 7).toString('base64');

describe('zarf şifreleme', () => {
  it('DEK sarılır ve açılır', async () => {
    const w = new LocalKeyWrapper(MASTER);
    const dek = newDek();
    expect((await w.unwrap(await w.wrap(dek))).equals(dek)).toBe(true);
  });

  it('kurcalanmış veri reddedilir', () => {
    const key = deriveKey(newDek(), 'object');
    const s = seal(key, Buffer.from('gizli dilekçe'));
    s[s.length - 20]! ^= 1;
    expect(() => open(key, s)).toThrow();
  });

  it('TCKN HMAC büroya özgüdür', () => {
    const a = tcknHmac(newDek(), '10000000146');
    const b = tcknHmac(newDek(), '10000000146');
    expect(a.equals(b)).toBe(false);
  });

  it('TCKN doğrulama', () => {
    expect(isValidTckn('10000000146')).toBe(true);
    expect(isValidTckn('10000000147')).toBe(false);
    expect(isValidTckn('01234567890')).toBe(false);
  });
});
