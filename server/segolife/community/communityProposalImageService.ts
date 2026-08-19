/**
 * communityProposalImageService.ts — MG-04 (Community Proposals 2.0).
 * Imagen de portada PÚBLICA de una idea de Student — a diferencia de la
 * foto de perfil (MG-03, privada, storage privado), esta imagen debe ser
 * visible por cualquier Student que vea la idea en Trending/Mis ideas, así
 * que usa `storagePut` (server/storage.ts, primitivo público ya existente,
 * mismo backend con volumen persistente real de Railway que usa CMS/eventos
 * — nunca un segundo sistema de ficheros nuevo).
 *
 * Mismo NIVEL DE RIGOR de validación que MG-03 (validateAndNormalizeImage):
 * MIME real decodificado con sharp() (nunca confía en la extensión/
 * Content-Type declarado), tamaño acotado, SVG rechazado siempre (riesgo
 * XSS/XXE — nunca "si el pipeline no lo sanitiza", aquí directamente no se
 * acepta), sin copiar EXIF al resultado. Redimensiona en "cover" (ancho
 * máximo, conserva proporción, nunca recorta a cuadrado como el avatar —
 * es una imagen de portada, no una foto de identificación).
 */
import sharp, { type Metadata } from "sharp";
import { randomUUID } from "crypto";
import { storagePut } from "../../storage";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const ALLOWED_SHARP_FORMATS = new Set(["jpeg", "png", "webp"]);

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_DIMENSION = 8000;
const MIN_DIMENSION = 32;
const OUTPUT_MAX_WIDTH = 1200;
const OUTPUT_JPEG_QUALITY = 85;

export class ProposalImageValidationError extends Error {
  constructor(public code: "INVALID_MIME" | "TOO_LARGE" | "NOT_AN_IMAGE" | "DIMENSIONS_OUT_OF_RANGE", message: string) {
    super(message);
    this.name = "ProposalImageValidationError";
  }
}

export async function validateAndNormalizeProposalImage(buffer: Buffer, declaredMimeType: string): Promise<Buffer> {
  if (!ALLOWED_MIME_TYPES.has(declaredMimeType.toLowerCase())) {
    throw new ProposalImageValidationError("INVALID_MIME", `Tipo de archivo no permitido: ${declaredMimeType}`);
  }
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new ProposalImageValidationError("TOO_LARGE", `El archivo supera el máximo de ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`);
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    throw new ProposalImageValidationError("NOT_AN_IMAGE", "El archivo no es una imagen válida o está corrupto");
  }

  if (!metadata.format || !ALLOWED_SHARP_FORMATS.has(metadata.format)) {
    throw new ProposalImageValidationError("NOT_AN_IMAGE", `Formato de imagen no soportado: ${metadata.format ?? "desconocido"}`);
  }
  const { width, height } = metadata;
  if (!width || !height || width < MIN_DIMENSION || height < MIN_DIMENSION || width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new ProposalImageValidationError("DIMENSIONS_OUT_OF_RANGE", `Dimensiones de imagen fuera de rango: ${width}x${height}`);
  }

  // "cover" — ancho máximo, conserva proporción, nunca amplía una imagen
  // pequeña (withoutEnlargement) ni recorta a cuadrado (no es un avatar).
  return sharp(buffer)
    .rotate()
    .resize(OUTPUT_MAX_WIDTH, null, { withoutEnlargement: true })
    .jpeg({ quality: OUTPUT_JPEG_QUALITY })
    .toBuffer();
}

function proposalImageKey(studentUserId: number, uuid: string): string {
  return `community-proposals/${studentUserId}/${uuid}.jpg`;
}

/** Valida+normaliza+sube — devuelve la URL pública real, nunca inventada. */
export async function uploadProposalCoverImage(studentUserId: number, rawBuffer: Buffer, declaredMimeType: string): Promise<{ url: string }> {
  const normalized = await validateAndNormalizeProposalImage(rawBuffer, declaredMimeType);
  const key = proposalImageKey(studentUserId, randomUUID());
  const { url } = await storagePut(key, normalized, "image/jpeg");
  return { url };
}
