/**
 * chatImageService.ts — imagen adjunta en el chat Admin→Student (COM-01).
 * Reutiliza la misma validación real de imagen ya construida para MG-03/
 * LNF-01 (validateImageBuffer) — NUNCA la duplica. Sin recorte cuadrado
 * (una captura de pantalla o foto real de un problema no debe recortarse),
 * mismo criterio que lostFoundPhotoService.ts. Almacenamiento PRIVADO,
 * NUNCA una URL pública — servida vía un endpoint autenticado que
 * comprueba ownership/permiso real (ver studentMessageImageRoutes.ts).
 */
import { randomUUID } from "crypto";
import sharp from "sharp";
import { privateStoragePut, privateStorageGetBytes } from "../../storage";
import { validateImageBuffer, StudentPhotoValidationError, MAX_UPLOAD_BYTES } from "../students/studentPhotoService";

export { StudentPhotoValidationError as ChatImageValidationError, MAX_UPLOAD_BYTES };

const MAX_OUTPUT_DIMENSION = 1600;
const OUTPUT_JPEG_QUALITY = 85;

function chatImageStorageKey(conversationId: number, uuid: string): string {
  return `chat/${conversationId}/${uuid}.jpg`;
}

export async function validateAndNormalizeChatImage(buffer: Buffer, declaredMimeType: string): Promise<Buffer> {
  await validateImageBuffer(buffer, declaredMimeType);
  return sharp(buffer)
    .rotate()
    .resize(MAX_OUTPUT_DIMENSION, MAX_OUTPUT_DIMENSION, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: OUTPUT_JPEG_QUALITY })
    .toBuffer();
}

export async function storeChatImage(conversationId: number, normalizedBuffer: Buffer): Promise<string> {
  const key = chatImageStorageKey(conversationId, randomUUID());
  await privateStoragePut(key, normalizedBuffer, "image/jpeg");
  return key;
}

export async function getChatImageBytes(imageStorageKey: string): Promise<Buffer | null> {
  return privateStorageGetBytes(imageStorageKey);
}
