/**
 * studentPhotoService.ts — SEGOLIFE MG-03 (Student Profile Photo & Visual
 * Identity). Única fuente de verdad de la foto de perfil de un Student:
 * validación real (nunca confía en la extensión ni en el Content-Type
 * declarado por el cliente — sharp() debe poder decodificarla de verdad),
 * normalización (auto-orientación EXIF, recorte centrado a cuadrado,
 * redimensionado, eliminación de metadatos EXIF incl. geolocalización,
 * reencodado a JPEG), almacenamiento PRIVADO (server/storage.ts::
 * privateStoragePut/Delete — nunca una URL pública) y limpieza segura en
 * reemplazo/eliminación.
 *
 * FUERA DE ALCANCE A PROPÓSITO (spec MG-03 §0): esto es una ayuda de
 * identificación VISUAL. Nunca reconocimiento facial, nunca biometría,
 * nunca comparación automática de rostros, nunca embeddings, nunca un
 * servicio externo — sharp() solo redimensiona/reencoda bytes, no
 * interpreta el contenido de la imagen.
 */
import { randomUUID } from "crypto";
import sharp, { type Metadata } from "sharp";
import { privateStoragePut, privateStorageDelete, privateStorageGetBytes } from "../../storage";
import { getStudentAvatarKey, updateStudentAvatarKey, buildStudentPhotoUrl } from "../../db/studentsDb";

export { buildStudentPhotoUrl };

/** Formatos aceptados — spec MG-03 §4: "como mínimo JPEG/PNG/WebP", SVG rechazado por defecto (riesgo XSS/XXE, y no es una fotografía real). */
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const ALLOWED_SHARP_FORMATS = new Set(["jpeg", "png", "webp"]);

/** 8 MB — generoso para una foto de móvil real, acotado frente a payloads excesivos (spec §4/§17). */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/** Defensa frente a "decompression bomb" — una imagen de más de 8000px de lado no aporta nada a una foto de identificación. */
const MAX_DIMENSION = 8000;
const MIN_DIMENSION = 32;
/** Tamaño final de almacenamiento — suficiente para identificación visual real (spec §5), nunca el original potencialmente enorme. */
const OUTPUT_SIZE = 512;
const OUTPUT_JPEG_QUALITY = 85;

export class StudentPhotoValidationError extends Error {
  constructor(public code: "INVALID_MIME" | "TOO_LARGE" | "NOT_AN_IMAGE" | "DIMENSIONS_OUT_OF_RANGE", message: string) {
    super(message);
    this.name = "StudentPhotoValidationError";
  }
}

/**
 * Valida MIME declarado + tamaño + que sea una imagen real y procesable
 * (sharp() falla si no lo es — cubre "ejecutable/HTML/script renombrado
 * como .jpg", spec §4) y normaliza: auto-orienta por EXIF, recorta al
 * centro a cuadrado, redimensiona, reencoda como JPEG sin metadatos (sharp
 * NUNCA copia EXIF al output salvo que se llame a .withMetadata(), que
 * aquí deliberadamente no se llama — así se elimina geolocalización y
 * cualquier otro metadato innecesario, spec §5/§I).
 */
export async function validateAndNormalizeImage(buffer: Buffer, declaredMimeType: string): Promise<Buffer> {
  if (!ALLOWED_MIME_TYPES.has(declaredMimeType.toLowerCase())) {
    throw new StudentPhotoValidationError("INVALID_MIME", `Tipo de archivo no permitido: ${declaredMimeType}`);
  }
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new StudentPhotoValidationError("TOO_LARGE", `El archivo supera el máximo de ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`);
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    throw new StudentPhotoValidationError("NOT_AN_IMAGE", "El archivo no es una imagen válida o está corrupto");
  }

  if (!metadata.format || !ALLOWED_SHARP_FORMATS.has(metadata.format)) {
    throw new StudentPhotoValidationError("NOT_AN_IMAGE", `Formato de imagen no soportado: ${metadata.format ?? "desconocido"}`);
  }
  const { width, height } = metadata;
  if (!width || !height || width < MIN_DIMENSION || height < MIN_DIMENSION || width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new StudentPhotoValidationError("DIMENSIONS_OUT_OF_RANGE", `Dimensiones de imagen fuera de rango: ${width}x${height}`);
  }

  return sharp(buffer)
    .rotate() // auto-orienta según EXIF antes de recortar — nunca al revés
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: "cover", position: "centre" })
    .jpeg({ quality: OUTPUT_JPEG_QUALITY })
    .toBuffer();
}

function photoStorageKey(userId: number, uuid: string): string {
  return `student-photos/${userId}/${uuid}.jpg`;
}

/**
 * Sustituye (o crea) la foto del propio Student — orden de operaciones
 * tolerante a fallos (spec §14): sube el archivo NUEVO primero, y solo si
 * eso tiene éxito actualiza la referencia en BD y borra el anterior. Si el
 * upload nuevo falla, el Student conserva su foto anterior intacta — nunca
 * al revés.
 */
export async function replaceMyPhoto(userId: number, rawBuffer: Buffer, declaredMimeType: string): Promise<{ url: string }> {
  const normalized = await validateAndNormalizeImage(rawBuffer, declaredMimeType);

  const previousKey = await getStudentAvatarKey(userId);
  const newKey = photoStorageKey(userId, randomUUID());

  await privateStoragePut(newKey, normalized, "image/jpeg");
  await updateStudentAvatarKey(userId, newKey);

  if (previousKey && previousKey !== newKey) {
    await privateStorageDelete(previousKey);
  }

  return { url: buildStudentPhotoUrl(userId) };
}

/** Elimina la foto del propio Student — nunca afecta cuenta/QR/tickets/wallet/memberships (spec §15). */
export async function removeMyPhoto(userId: number): Promise<void> {
  const previousKey = await getStudentAvatarKey(userId);
  await updateStudentAvatarKey(userId, null);
  if (previousKey) {
    await privateStorageDelete(previousKey);
  }
}

/** Bytes de la foto (para el endpoint autenticado GET /api/students/:userId/photo). `null` si el Student no tiene foto o el objeto no se puede leer. */
export async function getMyPhotoBytes(userId: number): Promise<Buffer | null> {
  const key = await getStudentAvatarKey(userId);
  if (!key) return null;
  return privateStorageGetBytes(key);
}

/**
 * Data URI base64 lista para embeber DIRECTAMENTE en una respuesta tRPC ya
 * autorizada (StudentCard del Venue App — spec §8/§11/§12: la foto NUNCA
 * viaja por un endpoint nuevo separado hacia el operador, reutiliza la
 * MISMA autorización que ya resuelve el resto de esa respuesta). `null` si
 * no hay foto — el frontend cae a las iniciales, nunca a un placeholder
 * inventado.
 */
export async function getStudentPhotoDataUri(userId: number): Promise<string | null> {
  const bytes = await getMyPhotoBytes(userId);
  if (!bytes) return null;
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}
