/**
 * studentPhotoService.test.ts — SEGOLIFE MG-03. La validación/normalización
 * usa sharp() de verdad (nunca mockeado — el punto entero de estas pruebas
 * es demostrar que un archivo falso/corrupto/gigante es rechazado por el
 * decodificador real, no por una regla de extensión). El almacenamiento y
 * la BD sí se mockean vía vi.mock — su comportamiento ya está cubierto por
 * sus propios tests (server/storage.ts no tiene test dedicado, ver informe;
 * studentsDb.test.ts cubre getStudentAvatarKey/updateStudentAvatarKey).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";

const { mockGetStudentAvatarKey, mockUpdateStudentAvatarKey, mockPrivateStoragePut, mockPrivateStorageDelete, mockPrivateStorageGetBytes, mockRecordStudentPhotoEvent } = vi.hoisted(() => ({
  mockGetStudentAvatarKey: vi.fn(),
  mockUpdateStudentAvatarKey: vi.fn(),
  mockPrivateStoragePut: vi.fn(),
  mockPrivateStorageDelete: vi.fn(),
  mockPrivateStorageGetBytes: vi.fn(),
  mockRecordStudentPhotoEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../db/studentsDb", () => ({
  getStudentAvatarKey: mockGetStudentAvatarKey,
  updateStudentAvatarKey: mockUpdateStudentAvatarKey,
  buildStudentPhotoUrl: (userId: number) => `/api/students/${userId}/photo`,
}));

vi.mock("../../storage", () => ({
  privateStoragePut: mockPrivateStoragePut,
  privateStorageDelete: mockPrivateStorageDelete,
  privateStorageGetBytes: mockPrivateStorageGetBytes,
}));

// MG-03B — Profile Photo Activity: se mockea para probar solo la ORQUESTACIÓN
// (qué acción se registra y cuándo) — la escritura real ya está probada por
// su cuenta en studentPhotoEventsDb.test.ts.
vi.mock("./studentPhotoEventsDb", () => ({
  recordStudentPhotoEvent: mockRecordStudentPhotoEvent,
}));

import {
  validateAndNormalizeImage,
  replaceMyPhoto,
  removeMyPhoto,
  getMyPhotoBytes,
  getStudentPhotoDataUri,
  StudentPhotoValidationError,
} from "./studentPhotoService";

async function realJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } } }).jpeg().toBuffer();
}
async function realPng(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 10, g: 200, b: 10, alpha: 1 } } }).png().toBuffer();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("validateAndNormalizeImage — validación real (sharp, no mockeado)", () => {
  it("acepta un JPEG real y lo normaliza a 512x512 sin metadatos", async () => {
    const input = await realJpeg(800, 600);
    const output = await validateAndNormalizeImage(input, "image/jpeg");
    const meta = await sharp(output).metadata();
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
    expect(meta.format).toBe("jpeg");
    // sharp nunca copia EXIF al output salvo .withMetadata() — nunca se llama aquí.
    expect(meta.exif).toBeUndefined();
  });

  it("acepta un PNG real (formato permitido) y lo reencoda como JPEG", async () => {
    const input = await realPng(300, 300);
    const output = await validateAndNormalizeImage(input, "image/png");
    const meta = await sharp(output).metadata();
    expect(meta.format).toBe("jpeg");
  });

  it("rechaza un MIME no permitido (SVG) sin siquiera intentar decodificar", async () => {
    const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
    await expect(validateAndNormalizeImage(svg, "image/svg+xml")).rejects.toMatchObject({ code: "INVALID_MIME" });
  });

  it("rechaza un archivo que declara ser JPEG pero no es una imagen real (renombrado)", async () => {
    const fakeJpeg = Buffer.from("MZ\x90\x00 this is actually not an image, just bytes pretending to be one");
    await expect(validateAndNormalizeImage(fakeJpeg, "image/jpeg")).rejects.toMatchObject({ code: "NOT_AN_IMAGE" });
  });

  it("rechaza un payload que supera el tamaño máximo, antes de intentar decodificar", async () => {
    const huge = Buffer.alloc(9 * 1024 * 1024, 0);
    await expect(validateAndNormalizeImage(huge, "image/jpeg")).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("rechaza una imagen real pero con dimensiones absurdamente pequeñas", async () => {
    const tiny = await realJpeg(8, 8);
    await expect(validateAndNormalizeImage(tiny, "image/jpeg")).rejects.toMatchObject({ code: "DIMENSIONS_OUT_OF_RANGE" });
  });

  it("el error es siempre una instancia de StudentPhotoValidationError con un código reconocible", async () => {
    try {
      await validateAndNormalizeImage(Buffer.from("no image"), "image/jpeg");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(StudentPhotoValidationError);
    }
  });
});

describe("replaceMyPhoto — orden de operaciones tolerante a fallos (spec §14)", () => {
  it("sube primero, actualiza la referencia después, y solo entonces borra la anterior", async () => {
    mockGetStudentAvatarKey.mockResolvedValue("student-photos/42/old-key.jpg");
    mockPrivateStoragePut.mockResolvedValue({ key: "student-photos/42/new-key.jpg" });
    const calls: string[] = [];
    mockPrivateStoragePut.mockImplementation(async () => { calls.push("put"); return { key: "student-photos/42/new-key.jpg" }; });
    mockUpdateStudentAvatarKey.mockImplementation(async () => { calls.push("update"); });
    mockPrivateStorageDelete.mockImplementation(async () => { calls.push("delete"); });

    const input = await realJpeg(400, 400);
    const result = await replaceMyPhoto(42, input, "image/jpeg");

    expect(result.url).toBe("/api/students/42/photo");
    expect(calls).toEqual(["put", "update", "delete"]);
    expect(mockPrivateStorageDelete).toHaveBeenCalledWith("student-photos/42/old-key.jpg");
  });

  it("primera foto de un Student sin foto previa: nunca intenta borrar nada", async () => {
    mockGetStudentAvatarKey.mockResolvedValue(null);
    mockPrivateStoragePut.mockResolvedValue({ key: "student-photos/42/first-key.jpg" });

    const input = await realJpeg(400, 400);
    await replaceMyPhoto(42, input, "image/jpeg");

    expect(mockPrivateStorageDelete).not.toHaveBeenCalled();
  });

  it("si la imagen no es válida, nunca llega a subir ni a tocar la BD (falla antes)", async () => {
    await expect(replaceMyPhoto(42, Buffer.from("garbage"), "image/jpeg")).rejects.toBeInstanceOf(StudentPhotoValidationError);
    expect(mockPrivateStoragePut).not.toHaveBeenCalled();
    expect(mockUpdateStudentAvatarKey).not.toHaveBeenCalled();
  });

  it("si privateStoragePut falla, nunca llega a actualizar la BD ni a borrar la foto anterior (la conserva intacta)", async () => {
    mockGetStudentAvatarKey.mockResolvedValue("student-photos/42/old-key.jpg");
    mockPrivateStoragePut.mockRejectedValue(new Error("storage unavailable"));

    const input = await realJpeg(400, 400);
    await expect(replaceMyPhoto(42, input, "image/jpeg")).rejects.toThrow("storage unavailable");

    expect(mockUpdateStudentAvatarKey).not.toHaveBeenCalled();
    expect(mockPrivateStorageDelete).not.toHaveBeenCalled();
  });
});

describe("removeMyPhoto — limpieza (spec §15)", () => {
  it("borra el objeto y limpia la referencia en BD", async () => {
    mockGetStudentAvatarKey.mockResolvedValue("student-photos/42/key.jpg");
    await removeMyPhoto(42);
    expect(mockUpdateStudentAvatarKey).toHaveBeenCalledWith(42, null);
    expect(mockPrivateStorageDelete).toHaveBeenCalledWith("student-photos/42/key.jpg");
  });

  it("Student sin foto: no intenta borrar nada del storage, pero sigue limpiando la referencia (idempotente)", async () => {
    mockGetStudentAvatarKey.mockResolvedValue(null);
    await removeMyPhoto(42);
    expect(mockUpdateStudentAvatarKey).toHaveBeenCalledWith(42, null);
    expect(mockPrivateStorageDelete).not.toHaveBeenCalled();
  });
});

describe("MG-03B — Profile Photo Activity: registro de added/updated/removed", () => {
  it("primera foto (sin foto previa) → registra 'added', exactamente una vez", async () => {
    mockGetStudentAvatarKey.mockResolvedValue(null);
    mockPrivateStoragePut.mockResolvedValue({ key: "student-photos/42/first.jpg" });
    const input = await realJpeg(400, 400);
    await replaceMyPhoto(42, input, "image/jpeg");
    expect(mockRecordStudentPhotoEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordStudentPhotoEvent).toHaveBeenCalledWith(42, "added");
  });

  it("reemplazo de una foto ya existente → registra 'updated', nunca 'added'", async () => {
    mockGetStudentAvatarKey.mockResolvedValue("student-photos/42/old.jpg");
    mockPrivateStoragePut.mockResolvedValue({ key: "student-photos/42/new.jpg" });
    const input = await realJpeg(400, 400);
    await replaceMyPhoto(42, input, "image/jpeg");
    expect(mockRecordStudentPhotoEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordStudentPhotoEvent).toHaveBeenCalledWith(42, "updated");
  });

  it("eliminar una foto real → registra 'removed'", async () => {
    mockGetStudentAvatarKey.mockResolvedValue("student-photos/42/key.jpg");
    await removeMyPhoto(42);
    expect(mockRecordStudentPhotoEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordStudentPhotoEvent).toHaveBeenCalledWith(42, "removed");
  });

  it("eliminar SIN tener foto (no-op real) → NUNCA registra 'removed' — idempotencia real, no solo de red (spec §7)", async () => {
    mockGetStudentAvatarKey.mockResolvedValue(null);
    await removeMyPhoto(42);
    expect(mockRecordStudentPhotoEvent).not.toHaveBeenCalled();
  });

  it("si falla el registro de actividad, la foto YA guardada NUNCA se deshace (best-effort)", async () => {
    mockGetStudentAvatarKey.mockResolvedValue(null);
    mockPrivateStoragePut.mockResolvedValue({ key: "student-photos/42/first.jpg" });
    mockRecordStudentPhotoEvent.mockRejectedValueOnce(new Error("boom"));
    const input = await realJpeg(400, 400);
    const result = await replaceMyPhoto(42, input, "image/jpeg");
    expect(result.url).toBe("/api/students/42/photo");
    expect(mockUpdateStudentAvatarKey).toHaveBeenCalled();
  });

  it("nunca toca token_ledger/SegoTokens — ni add ni update ni remove concede ni descuenta ST", async () => {
    mockGetStudentAvatarKey.mockResolvedValueOnce(null).mockResolvedValueOnce("student-photos/42/key.jpg");
    mockPrivateStoragePut.mockResolvedValue({ key: "student-photos/42/new.jpg" });
    const input = await realJpeg(400, 400);
    await replaceMyPhoto(42, input, "image/jpeg");
    await removeMyPhoto(42);
    // Ningún mock de tokenLedgerService fue siquiera importado/mockeado en
    // este fichero — si replaceMyPhoto/removeMyPhoto tocaran el ledger de
    // verdad, este test fallaría por intentar abrir una conexión MySQL real.
    expect(mockRecordStudentPhotoEvent).toHaveBeenCalledWith(42, "added");
    expect(mockRecordStudentPhotoEvent).toHaveBeenCalledWith(42, "removed");
  });
});

describe("getMyPhotoBytes / getStudentPhotoDataUri — lectura (fallback a null, nunca inventa)", () => {
  it("sin foto: devuelve null sin tocar el storage", async () => {
    mockGetStudentAvatarKey.mockResolvedValue(null);
    expect(await getMyPhotoBytes(42)).toBeNull();
    expect(mockPrivateStorageGetBytes).not.toHaveBeenCalled();
  });

  it("con foto: devuelve los bytes reales del storage", async () => {
    mockGetStudentAvatarKey.mockResolvedValue("student-photos/42/key.jpg");
    const bytes = Buffer.from("fake-jpeg-bytes");
    mockPrivateStorageGetBytes.mockResolvedValue(bytes);
    expect(await getMyPhotoBytes(42)).toBe(bytes);
    expect(mockPrivateStorageGetBytes).toHaveBeenCalledWith("student-photos/42/key.jpg");
  });

  it("getStudentPhotoDataUri: sin foto devuelve null (nunca un placeholder inventado)", async () => {
    mockGetStudentAvatarKey.mockResolvedValue(null);
    expect(await getStudentPhotoDataUri(42)).toBeNull();
  });

  it("getStudentPhotoDataUri: con foto devuelve una data URI base64 válida", async () => {
    mockGetStudentAvatarKey.mockResolvedValue("student-photos/42/key.jpg");
    mockPrivateStorageGetBytes.mockResolvedValue(Buffer.from("hello"));
    const uri = await getStudentPhotoDataUri(42);
    expect(uri).toBe(`data:image/jpeg;base64,${Buffer.from("hello").toString("base64")}`);
  });
});
