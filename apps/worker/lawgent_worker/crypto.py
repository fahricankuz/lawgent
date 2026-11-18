"""API (packages/crypto) ile birebir uyumlu zarf şifreleme.

Biçim: b"LGE1" | IV(12) | şifreli metin | etiket(16), AES-256-GCM.
"""
import base64
import hashlib

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

MAGIC = b"LGE1"


def open_sealed(key: bytes, sealed: bytes, aad: bytes | None = None) -> bytes:
    if len(sealed) < 4 + 12 + 16 or sealed[:4] != MAGIC:
        raise ValueError("Geçersiz şifreli veri")
    iv, body = sealed[4:16], sealed[16:]
    # cryptography, etiketi şifreli metnin sonunda bekler (bizim biçimimizle aynı).
    return AESGCM(key).decrypt(iv, body, aad)


def derive_key(dek: bytes, purpose: str) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=f"lawgent:{purpose}".encode()).derive(dek)


class LocalKeyWrapper:
    def __init__(self, master_key_b64: str):
        kek = base64.b64decode(master_key_b64)
        if len(kek) != 32:
            raise ValueError("MASTER_KEY 32 bayt olmalı")
        self._kek = kek
        self.kek_id = "local:" + hashlib.sha256(kek).hexdigest()[:12]

    def unwrap(self, wrapped: bytes) -> bytes:
        return open_sealed(self._kek, wrapped, b"dek")


def seal(key: bytes, plaintext: bytes, aad: bytes | None = None) -> bytes:
    import os

    iv = os.urandom(12)
    return MAGIC + iv + AESGCM(key).encrypt(iv, plaintext, aad)
