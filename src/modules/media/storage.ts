import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

export interface ObjectStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

/** Local filesystem storage (development, tests, single-instance deployments with a persistent volume). */
export class LocalDiskStorage implements ObjectStorage {
  private readonly root: string;
  constructor(dir: string) {
    this.root = resolve(dir);
  }

  private path(key: string) {
    if (!/^[a-z0-9/_-]+\.[a-z0-9]+$/i.test(key)) throw new Error("invalid storage key");
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error("path traversal");
    return p;
  }

  async put(key: string, data: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data, { flag: "wx" });
  }

  async get(key: string) {
    try {
      return await readFile(this.path(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
}

/**
 * Amazon S3 storage for production (several API instances share it). Credentials come from the default AWS
 * provider chain (the ECS task role in production) — never from configuration files. Objects are written once
 * (`If-None-Match: *`, like the local driver's exclusive create), encrypted at rest, and never public: the API
 * serves them through /media with its own access rules, and CloudFront may cache the public ones.
 */
export class S3Storage implements ObjectStorage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly prefix = "",
  ) {}

  private key(key: string) {
    if (!/^[a-z0-9/_-]+\.[a-z0-9]+$/i.test(key) || key.includes(".."))
      throw new Error("invalid storage key");
    return `${this.prefix}${key}`;
  }

  async put(key: string, data: Buffer) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(key),
        Body: data,
        IfNoneMatch: "*",
        ServerSideEncryption: "AES256",
      }),
    );
  }

  async get(key: string) {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key(key) }),
      );
      return res.Body ? Buffer.from(await res.Body.transformToByteArray()) : null;
    } catch (e) {
      if (e instanceof NoSuchKey || (e as { name?: string }).name === "NoSuchKey") return null;
      throw e;
    }
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
  }
}
