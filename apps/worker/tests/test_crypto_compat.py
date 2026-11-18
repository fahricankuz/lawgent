"""API (TypeScript) ile şifrelenen veriyi worker (Python) açabilmeli."""
import base64
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from lawgent_worker.crypto import LocalKeyWrapper, derive_key, open_sealed

ROOT = Path(__file__).resolve().parents[3]

SCRIPT = """
import { LocalKeyWrapper, newDek, deriveKey, seal } from '@lawgent/crypto';
const w = new LocalKeyWrapper(process.env.MK);
const dek = newDek();
const wrapped = await w.wrap(dek);
const obj = seal(deriveKey(dek, 'object'), Buffer.from('Kira sözleşmesi – TÜFE'), Buffer.from('t/m/d/v'));
console.log(JSON.stringify({ wrapped: wrapped.toString('base64'), obj: obj.toString('base64'), kek: w.kekId }));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="node yok")
def test_ts_sealed_object_opens_in_python(tmp_path):
    mk = base64.b64encode(os.urandom(32)).decode()
    script = ROOT / "packages" / "crypto" / "compat-check.mts"
    script.write_text(SCRIPT)
    try:
        out = subprocess.run(
            ["npx", "tsx", str(script)], cwd=ROOT / "apps" / "api", env={**os.environ, "MK": mk},
            capture_output=True, check=True, timeout=60,
        ).stdout
    finally:
        script.unlink(missing_ok=True)
    data = json.loads(out)
    w = LocalKeyWrapper(mk)
    assert w.kek_id == data["kek"]
    dek = w.unwrap(base64.b64decode(data["wrapped"]))
    plain = open_sealed(derive_key(dek, "object"), base64.b64decode(data["obj"]), b"t/m/d/v")
    assert plain.decode() == "Kira sözleşmesi – TÜFE"
