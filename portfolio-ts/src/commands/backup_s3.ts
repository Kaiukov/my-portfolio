import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSummary } from "./summary.js";
import { getStatus } from "./status.js";
import { getWidget } from "./widget.js";
import { getPriceFreshness } from "./freshness.js";

export interface BackupSnapshot {
  portfolio_value_usd: number | null;
  today: { abs: number; pct: number };
  total: { abs: number | null; pct: number | null };
  history: { date: string; value: number }[];
  prices_as_of: string | null;
  as_of_date: string;
  updatedAt: string;
}

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export interface PushResult {
  bucket: string;
  objects: string[];
}

export interface PullResult {
  bucket: string;
  key: string;
  snapshot: BackupSnapshot;
}

export function loadS3Config(): { ok: true; config: S3Config } | { ok: false; error: string } {
  const endpoint = process.env["S3_ENDPOINT"];
  const bucket = process.env["S3_BUCKET"];
  const accessKeyId = process.env["S3_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["S3_SECRET_ACCESS_KEY"];
  const region = process.env["S3_REGION"] ?? "auto";

  const missing: string[] = [];
  if (!endpoint) missing.push("S3_ENDPOINT");
  if (!bucket) missing.push("S3_BUCKET");
  if (!accessKeyId) missing.push("S3_ACCESS_KEY_ID");
  if (!secretAccessKey) missing.push("S3_SECRET_ACCESS_KEY");

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

export async function buildSnapshot(asOfDate?: string): Promise<BackupSnapshot> {
  const [summary, status, widget, freshness] = await Promise.all([
    getSummary(asOfDate),
    getStatus(asOfDate),
    getWidget(90, asOfDate),
    getPriceFreshness(asOfDate),
  ]);

  return {
    portfolio_value_usd: summary.portfolio_value_usd,
    today: {
      abs: widget.today.amount,
      pct: widget.today.pct,
    },
    total: {
      abs: status.total_gain,
      pct: status.total_gain_pct,
    },
    history: widget.series.map((s) => ({ date: s.date, value: s.value })),
    prices_as_of: freshness.prices_as_of,
    as_of_date: summary.as_of_date,
    updatedAt: new Date().toISOString(),
  };
}

export async function pushSnapshot(
  snapshot: BackupSnapshot,
  client: S3Client,
  bucket: string,
): Promise<PushResult> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const body = JSON.stringify(snapshot, null, 2);
  const timestampedKey = `backup-${ts}.json`;
  const latestKey = "latest.json";

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: timestampedKey,
      Body: body,
      ContentType: "application/json",
    }),
  );

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: latestKey,
      Body: body,
      ContentType: "application/json",
    }),
  );

  return { bucket, objects: [timestampedKey, latestKey] };
}

export async function pullLatest(
  client: S3Client,
  bucket: string,
): Promise<PullResult> {
  const key = "latest.json";

  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );

  const body = await response.Body?.transformToString("utf-8");
  if (!body) {
    throw new Error("Empty response body from S3");
  }

  const snapshot = JSON.parse(body) as BackupSnapshot;

  return { bucket, key, snapshot };
}
