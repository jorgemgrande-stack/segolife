/**
 * integrationCredentialCrypto.ts — cifrado at rest de credenciales de
 * Integration Hub (Fase 5). MISMO algoritmo/patrón que
 * server/utils/emailCrypto.ts (AES-256-GCM, clave derivada por scrypt) —
 * módulo propio en vez de reutilizar literalmente esa función para no
 * acoplar semánticamente "credenciales de Fourvenues/Weezevent" a "email"
 * (auditoría Fase 5, punto 17: "si existe infraestructura segura,
 * reutilízala" — se reutiliza el PATRÓN, con su propia variable de entorno).
 *
 * Requisitos de la fase (nunca violar):
 *  - Las credenciales en claro NUNCA se devuelven al frontend — los routers
 *    solo exponen `credentialsConfigured: boolean` y, como mucho,
 *    `credentialsLast4`.
 *  - NUNCA se loguean ni se incluyen en audit payloads/API responses.
 *  - `encryptCredentials`/`decryptCredentials` operan sobre un objeto
 *    JSON completo (p.ej. `{ apiKey, accessToken }`) — cada proveedor
 *    define su propia forma de credenciales, este módulo es agnóstico.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const raw =
    process.env.INTEGRATION_ENCRYPTION_KEY ||
    process.env.DATABASE_URL ||
    "segolife-integrations-key-please-set-env";
  return scryptSync(raw, "segolife-integrations-salt-v1", KEY_LEN) as Buffer;
}

/** Serializa y cifra un objeto de credenciales completo. Nunca lanza con input vacío — devuelve "". */
export function encryptCredentials(credentials: Record<string, string | undefined>): string {
  const plaintext = JSON.stringify(credentials ?? {});
  if (!plaintext || plaintext === "{}") return "";
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

/** Descifra y parsea — solo debe llamarse desde el adapter en el momento exacto de la petición externa, nunca para exponer al frontend. */
export function decryptCredentials<T extends Record<string, string | undefined> = Record<string, string | undefined>>(encoded: string | null | undefined): T | null {
  if (!encoded) return null;
  try {
    const key = getKey();
    const buf = Buffer.from(encoded, "base64");
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const encrypted = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    return JSON.parse(plaintext) as T;
  } catch {
    return null;
  }
}

/** Últimos 4 caracteres de un valor "representativo" de las credenciales (p.ej. la API key) — solo para mostrar en admin, nunca el secreto completo. */
export function last4(value: string | undefined | null): string | null {
  if (!value || value.length < 4) return null;
  return value.slice(-4);
}
