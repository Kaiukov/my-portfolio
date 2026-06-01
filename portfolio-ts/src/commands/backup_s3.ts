import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFile, writeFile } from "./bun_io.js";
import { backupDb } from "./backup.js";

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export interface PushResult {
  bucket: string;
  dump_path: string;
  dump_size_bytes: number;
  objects: string[];
}

export interface PullResult {
  bucket: string;
  key: string;
  local_path: string;
  size_bytes: number;
  restore_command: string;
}

function envVar(key: string): string | undefined {
  const primary = process.env[`PORTFOLIO_${key}`];
  return primary !== undefined ? primary : process.env[key];
}

function getS3Prefix(): string {
  const prefix = envVar("S3_PREFIX") ?? "";
  if (prefix === "") {
    return "";
  }
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

export function loadS3Config(): { ok: true; config: S3Config } | { ok: false; error: string } {
  const endpoint = envVar("S3_ENDPOINT");
  const bucket = envVar("S3_BUCKET");
  const accessKeyId = envVar("S3_ACCESS_KEY_ID");
  const secretAccessKey = envVar("S3_SECRET_ACCESS_KEY");
  const region = envVar("S3_REGION") ?? "auto";

  const missing: string[] = [];
  if (!endpoint) missing.push("PORTFOLIO_S3_ENDPOINT");
  if (!bucket) missing.push("PORTFOLIO_S3_BUCKET");
  if (!accessKeyId) missing.push("PORTFOLIO_S3_ACCESS_KEY_ID");
  if (!secretAccessKey) missing.push("PORTFOLIO_S3_SECRET_ACCESS_KEY");

  if (missing.length > 0) {
    return { ok: false, error: `Missing S3 configuration: ${missing.join(", ")}` };
  }

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return { ok: false, error: "Missing S3 configuration" };
  }

  return {
    ok: true,
    config: { endpoint, bucket, accessKeyId, secretAccessKey, region },
  };
}

export function createS3Client(config: S3Config): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
  });
}

export async function pushBackupToS3(
  client: S3Client,
  bucket: string,
  dbUrl: string,
): Promise<PushResult> {
  const dump = await backupDb({ dbUrl });
  const f = readFile(dump.backup);
  const body = await f.arrayBuffer();

  const baseName = dump.backup.split("/").pop() ?? dump.backup;
  const prefix = getS3Prefix();
  const timestampedKey = `${prefix}${baseName}`;
  const latestKey = `${prefix}latest.sql`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: timestampedKey,
      Body: new Uint8Array(body),
      ContentType: "application/sql",
    }),
  );

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: latestKey,
      Body: new Uint8Array(body),
      ContentType: "application/sql",
    }),
  );

  return {
    bucket,
    dump_path: dump.backup,
    dump_size_bytes: dump.size_bytes,
    objects: [timestampedKey, latestKey],
  };
}

export async function pullBackupFromS3(
  client: S3Client,
  bucket: string,
  dbUrl: string,
  key?: string,
): Promise<PullResult> {
  const prefix = getS3Prefix();
  const objectKey = `${prefix}${key ?? "latest.sql"}`;

  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: objectKey,
    }),
  );

  const body = await response.Body?.transformToByteArray();
  if (!body || body.length === 0) {
    throw new Error("Empty response body from S3");
  }

  const localPath = `portfolio.restored-${objectKey.replace(/[/\\]/g, "_")}`;
  await writeFile(localPath, body);

  return {
    bucket,
    key: objectKey,
    local_path: localPath,
    size_bytes: body.length,
    restore_command: `psql "${dbUrl}" -f ${localPath}`,
  };
}
