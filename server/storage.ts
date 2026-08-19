// Storage helpers — soporta tres backends:
//  1. Manus Forge proxy  (BUILT_IN_FORGE_API_URL + BUILT_IN_FORGE_API_KEY)
//  2. S3 / MinIO local  (S3_ENDPOINT + S3_ACCESS_KEY + S3_SECRET_KEY + S3_BUCKET)
//  3. Fallback local     (/tmp/local-storage — útil en Railway sin S3 configurado)

import { ENV } from './_core/env';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { writeFile, mkdir, readFile, unlink } from "fs/promises";
import path from "path";

const LOCAL_STORAGE_DIR = process.env.LOCAL_STORAGE_PATH ?? "/tmp/local-storage";
// SEGOLIFE MG-03 — subcarpeta DENTRO del mismo volumen persistente que
// LOCAL_STORAGE_DIR (nunca un directorio nuevo: aquí no hay volumen montado
// aparte, escribir fuera de LOCAL_STORAGE_DIR se perdería en cada deploy),
// pero bloqueada explícitamente del montaje estático público `/local-storage`
// (ver server/_core/index.ts, el middleware justo antes de esa línea) — la
// única forma de leer algo de aquí es a través de un endpoint autenticado
// que llame a privateStorageGetBytes(), nunca una URL directa.
const PRIVATE_SUBDIR = "private";

// ─── Backend selector ─────────────────────────────────────────────────────────

function useForge(): boolean {
  return !!(ENV.forgeApiUrl && ENV.forgeApiKey);
}

// ─── S3 / MinIO client (lazy) ────────────────────────────────────────────────

let _s3: S3Client | null = null;

function getS3(): S3Client {
  if (_s3) return _s3;
  _s3 = new S3Client({
    endpoint: ENV.s3Endpoint || undefined,
    region: ENV.s3Region,
    credentials: {
      accessKeyId: ENV.s3AccessKey,
      secretAccessKey: ENV.s3SecretKey,
    },
    forcePathStyle: true, // necesario para MinIO
  });
  return _s3;
}

// ─── Fallback local (cuando no hay Forge ni S3) ───────────────────────────────

async function localPut(
  key: string,
  data: Buffer | Uint8Array | string
): Promise<{ key: string; url: string }> {
  const filePath = path.join(LOCAL_STORAGE_DIR, key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, data as Buffer);
  const base = (process.env.APP_URL ?? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "")).replace(/\/+$/, "");
  const url = base ? `${base}/local-storage/${key}` : `/local-storage/${key}`;
  console.warn(`[Storage] Sin S3/Forge — archivo guardado en ${filePath} (persiste solo si este directorio está en un volumen montado; si no, se perderá en el próximo deploy)`);
  return { key, url };
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

// ─── Forge helpers ────────────────────────────────────────────────────────────

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function buildAuthHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}` };
}

function toFormData(
  data: Buffer | Uint8Array | string,
  contentType: string,
  fileName: string
): FormData {
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });
  const form = new FormData();
  form.append("file", blob, fileName || "file");
  return form;
}

async function forgePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType: string
): Promise<{ key: string; url: string }> {
  const { forgeApiUrl, forgeApiKey } = ENV;
  const key = normalizeKey(relKey);
  const uploadUrl = new URL("v1/storage/upload", ensureTrailingSlash(forgeApiUrl));
  uploadUrl.searchParams.set("path", key);
  const formData = toFormData(data, contentType, key.split("/").pop() ?? key);
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: buildAuthHeaders(forgeApiKey),
    body: formData,
  });
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`Storage upload failed (${response.status}): ${message}`);
  }
  const url = (await response.json()).url;
  return { key, url };
}

async function forgeGet(relKey: string): Promise<{ key: string; url: string }> {
  const { forgeApiUrl, forgeApiKey } = ENV;
  const key = normalizeKey(relKey);
  const downloadApiUrl = new URL("v1/storage/downloadUrl", ensureTrailingSlash(forgeApiUrl));
  downloadApiUrl.searchParams.set("path", key);
  const response = await fetch(downloadApiUrl, {
    method: "GET",
    headers: buildAuthHeaders(forgeApiKey),
  });
  return { key, url: (await response.json()).url };
}

// ─── S3 / MinIO helpers ───────────────────────────────────────────────────────

async function s3Put(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType: string
): Promise<{ key: string; url: string }> {
  const s3 = getS3();
  const key = normalizeKey(relKey);
  const body = typeof data === "string" ? Buffer.from(data) : data;
  await s3.send(new PutObjectCommand({
    Bucket: ENV.s3Bucket,
    Key: key,
    Body: body as Buffer,
    ContentType: contentType,
  }));
  const publicBase = ENV.s3PublicUrl
    ? ENV.s3PublicUrl.replace(/\/+$/, "")
    : `${ENV.s3Endpoint}/${ENV.s3Bucket}`;
  const url = `${publicBase}/${key}`;
  return { key, url };
}

async function s3Get(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const publicBase = ENV.s3PublicUrl
    ? ENV.s3PublicUrl.replace(/\/+$/, "")
    : `${ENV.s3Endpoint}/${ENV.s3Bucket}`;
  return { key, url: `${publicBase}/${key}` };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  if (useForge()) return forgePut(relKey, data, contentType);
  if (ENV.s3AccessKey && ENV.s3SecretKey) return s3Put(relKey, data, contentType);
  // Fallback: almacenamiento local cuando ni Forge ni S3 están configurados
  return localPut(normalizeKey(relKey), data);
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  return useForge() ? forgeGet(relKey) : s3Get(relKey);
}

/** Retorna true si hay almacenamiento externo (Forge o S3) configurado. */
export function hasExternalStorage(): boolean {
  return useForge() || !!(ENV.s3AccessKey && ENV.s3SecretKey);
}

// ─── PRIVATE STORAGE (SEGOLIFE MG-03) ──────────────────────────────────────
//
// A diferencia de storagePut/storageGet (que SIEMPRE devuelven una URL
// pública/permanente — ver comentario de s3Put/localPut), estas funciones
// NUNCA devuelven una URL: solo bytes, y solo a quien las llame desde
// server. El endpoint HTTP que las expone (server/segolife/students/
// studentPhotoRoutes.ts) es quien decide, en cada request, si el usuario
// autenticado tiene derecho a ver estos bytes concretos — la privacidad
// vive en "nunca se entrega una URL fetcheable directamente", no en ACLs de
// bucket (que hoy no están configuradas: SEGOLIFE producción no tiene S3
// activo, ver `hasExternalStorage()` — todo cae al fallback local, motivo
// de más para no depender de una ACL de bucket que no existe).
//
// Nota: sin backend Forge — SEGOLIFE nunca lo usa (LOCAL_AUTH, ver
// CLAUDE.md), y Forge no expone un GetObject/DeleteObject genérico con el
// que implementar esto correctamente.

function privateKey(relKey: string): string {
  return `${PRIVATE_SUBDIR}/${normalizeKey(relKey)}`;
}

export async function privateStoragePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string }> {
  const key = privateKey(relKey);
  const body = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
  if (ENV.s3AccessKey && ENV.s3SecretKey) {
    const s3 = getS3();
    await s3.send(new PutObjectCommand({ Bucket: ENV.s3Bucket, Key: key, Body: body, ContentType: contentType }));
    return { key };
  }
  const filePath = path.join(LOCAL_STORAGE_DIR, key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, body);
  return { key };
}

export async function privateStorageGetBytes(relKey: string): Promise<Buffer | null> {
  const key = privateKey(relKey);
  if (ENV.s3AccessKey && ENV.s3SecretKey) {
    const s3 = getS3();
    try {
      const res = await s3.send(new GetObjectCommand({ Bucket: ENV.s3Bucket, Key: key }));
      const bytes = await res.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch {
      return null;
    }
  }
  const filePath = path.join(LOCAL_STORAGE_DIR, key);
  try {
    return await readFile(filePath);
  } catch {
    return null;
  }
}

export async function privateStorageDelete(relKey: string): Promise<void> {
  const key = privateKey(relKey);
  if (ENV.s3AccessKey && ENV.s3SecretKey) {
    const s3 = getS3();
    await s3.send(new DeleteObjectCommand({ Bucket: ENV.s3Bucket, Key: key })).catch(() => {});
    return;
  }
  const filePath = path.join(LOCAL_STORAGE_DIR, key);
  await unlink(filePath).catch(() => {});
}
