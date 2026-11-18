/**
 * Belge deposu. Nesneler uygulama tarafında büro anahtarıyla şifrelenir;
 * depo (MinIO) ayrıca kendi sunucu tarafı şifrelemesini uygular.
 */
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import type { Config } from '../config.js';

export interface PutOptions {
  /** Delil kopyası: depoda değiştirilemez/silinemez kilitlenir. */
  evidence?: boolean;
}

export interface Storage {
  put(key: string, body: Buffer, opts?: PutOptions): Promise<void>;
  get(key: string): Promise<Buffer>;
}

export class S3Storage implements Storage {
  private readonly s3: S3Client;
  constructor(private readonly cfg: Config) {
    this.s3 = new S3Client({
      endpoint: cfg.S3_ENDPOINT,
      region: cfg.S3_REGION,
      forcePathStyle: true,
      credentials:
        cfg.S3_ACCESS_KEY && cfg.S3_SECRET_KEY
          ? { accessKeyId: cfg.S3_ACCESS_KEY, secretAccessKey: cfg.S3_SECRET_KEY }
          : undefined,
    });
  }

  async put(key: string, body: Buffer, opts: PutOptions = {}) {
    const input: PutObjectCommandInput = {
      Bucket: this.cfg.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: 'application/octet-stream',
    };
    if (opts.evidence) {
      // Kova object lock etkin oluşturulmalıdır (infra/minio). 10 yıl saklama.
      input.ObjectLockMode = 'COMPLIANCE';
      input.ObjectLockRetainUntilDate = new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000);
    }
    await this.s3.send(new PutObjectCommand(input));
  }

  async get(key: string) {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
}

/** Yalnızca geliştirme ve test için yerel disk deposu. */
export class FsStorage implements Storage {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string) {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + '/')) throw new Error('Geçersiz nesne anahtarı');
    return p;
  }

  async put(key: string, body: Buffer, opts: PutOptions = {}) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body, { flag: 'wx' });
    if (opts.evidence) await chmod(p, 0o444);
  }

  async get(key: string) {
    return readFile(this.path(key));
  }
}

export function createStorage(cfg: Config): Storage {
  return cfg.STORAGE_DRIVER === 'fs' ? new FsStorage(cfg.STORAGE_FS_ROOT) : new S3Storage(cfg);
}
