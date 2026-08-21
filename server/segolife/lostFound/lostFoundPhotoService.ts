/**
 * lostFoundPhotoService.ts — LNF-01. Reutiliza la validación real de
 * imagen ya construida para MG-03 (validateImageBuffer: MIME declarado +
 * tamaño + sharp() decodificando de verdad + límites de dimensión frente a
 * decompression-bomb) — NUNCA la duplica. El único punto que diverge a
 * propósito es el redimensionado final: MG-03 recorta a cuadrado 512×512
 * porque es una foto de identificación de PERSONA; aquí es la foto de un
 * OBJETO perdido, recortarla a cuadrado le cortaría partes arbitrarias
 * (una cartera apaisada, unas llaves largas...) — se conserva la
 * proporción real, solo se limita el lado más largo.
 *
 * Foto OPCIONAL (spec LNF-01 §2/§4): estas funciones solo se llaman si el
 * Student adjuntó un archivo. Almacenamiento PRIVADO (server/storage.ts),
 * NUNCA una URL pública — misma clave conceptual que
 * users.avatarStorageKey, servida vía un endpoint autenticado que
 * comprueba ownership/permiso real (ver lostFoundPhotoRoutes.ts).
 */
import { randomUUID } from "crypto";
import sharp from "sharp";
import { privateStoragePut, privateStorageGetBytes, privateStorageDelete } from "../../storage";
import { validateImageBuffer, StudentPhotoValidationError, MAX_UPLOAD_BYTES } from "../students/studentPhotoService";

export { StudentPhotoValidationError as LostFoundPhotoValidationError, MAX_UPLOAD_BYTES };

/** Lado más largo tras redimensionar — suficiente para reconocer un objeto real, nunca el original potencialmente enorme. */
const MAX_OUTPUT_DIMENSION = 1600;
const OUTPUT_JPEG_QUALITY = 85;

function lostFoundPhotoStorageKey(reportId: number, uuid: string): string {
  return `lost-found/${reportId}/${uuid}.jpg`;
}

/**
 * Valida (MISMA validación real que MG-03) y normaliza conservando
 * proporción — auto-orienta por EXIF, redimensiona SOLO si excede el
 * máximo (`withoutEnlargement`: una foto ya pequeña no se agranda
 * artificialmente), reencoda a JPEG sin metadatos (nunca se llama a
 * `.withMetadata()` — elimina EXIF/geolocalización, mismo criterio que
 * MG-03).
 */
export async function validateAndNormalizeLostFoundImage(buffer: Buffer, declaredMimeType: string): Promise<Buffer> {
  await validateImageBuffer(buffer, declaredMimeType);
  return sharp(buffer)
    .rotate()
    .resize(MAX_OUTPUT_DIMENSION, MAX_OUTPUT_DIMENSION, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: OUTPUT_JPEG_QUALITY })
    .toBuffer();
}

/** Sube la foto YA validada/normalizada bajo la clave del caso — se llama DESPUÉS de crear el report (necesita su id real en la clave). */
export async function storeLostFoundPhoto(reportId: number, normalizedBuffer: Buffer): Promise<string> {
  const key = lostFoundPhotoStorageKey(reportId, randomUUID());
  await privateStoragePut(key, normalizedBuffer, "image/jpeg");
  return key;
}

export async function getLostFoundPhotoBytes(imageStorageKey: string): Promise<Buffer | null> {
  return privateStorageGetBytes(imageStorageKey);
}

export async function deleteLostFoundPhoto(imageStorageKey: string): Promise<void> {
  await privateStorageDelete(imageStorageKey);
}
