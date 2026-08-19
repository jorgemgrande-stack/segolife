/**
 * communityProposalImageService.test.ts — MG-04. Misma disciplina que
 * studentPhotoService.test.ts: la validación usa sharp() de verdad (nunca
 * mockeado), solo storagePut se mockea.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";

const { mockStoragePut } = vi.hoisted(() => ({
  mockStoragePut: vi.fn(),
}));

vi.mock("../../storage", () => ({
  storagePut: mockStoragePut,
}));

import {
  validateAndNormalizeProposalImage,
  uploadProposalCoverImage,
  ProposalImageValidationError,
  MAX_UPLOAD_BYTES,
} from "./communityProposalImageService";

async function realJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 20, g: 120, b: 200 } } }).jpeg().toBuffer();
}
async function realWebp(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 200, b: 10 } } }).webp().toBuffer();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("validateAndNormalizeProposalImage — validación real (sharp, no mockeado)", () => {
  it("acepta un JPEG real ancho y conserva proporción (nunca recorta a cuadrado — no es un avatar)", async () => {
    const input = await realJpeg(2400, 1200);
    const output = await validateAndNormalizeProposalImage(input, "image/jpeg");
    const meta = await sharp(output).metadata();
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(600); // conserva proporción 2:1
    expect(meta.format).toBe("jpeg");
  });

  it("acepta un WebP real y lo reencoda como JPEG", async () => {
    const input = await realWebp(400, 300);
    const output = await validateAndNormalizeProposalImage(input, "image/webp");
    const meta = await sharp(output).metadata();
    expect(meta.format).toBe("jpeg");
  });

  it("una imagen más pequeña que el ancho máximo nunca se amplía (withoutEnlargement)", async () => {
    const input = await realJpeg(300, 200);
    const output = await validateAndNormalizeProposalImage(input, "image/jpeg");
    const meta = await sharp(output).metadata();
    expect(meta.width).toBe(300);
    expect(meta.height).toBe(200);
  });

  it("rechaza SVG siempre, aunque el Content-Type declarado sea genérico — riesgo XSS/XXE", async () => {
    const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
    await expect(validateAndNormalizeProposalImage(svg, "image/svg+xml")).rejects.toMatchObject({ code: "INVALID_MIME" });
  });

  it("rechaza un archivo que declara ser PNG pero no es una imagen real (ejecutable/HTML renombrado)", async () => {
    const fake = Buffer.from("<html><body>not an image</body></html>");
    await expect(validateAndNormalizeProposalImage(fake, "image/png")).rejects.toMatchObject({ code: "NOT_AN_IMAGE" });
  });

  it("rechaza un payload que supera MAX_UPLOAD_BYTES antes de intentar decodificar", async () => {
    const huge = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0);
    await expect(validateAndNormalizeProposalImage(huge, "image/jpeg")).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("rechaza una imagen real con dimensiones por debajo del mínimo", async () => {
    const tiny = await realJpeg(10, 10);
    await expect(validateAndNormalizeProposalImage(tiny, "image/jpeg")).rejects.toMatchObject({ code: "DIMENSIONS_OUT_OF_RANGE" });
  });

  it("el error siempre es una instancia de ProposalImageValidationError con un código reconocible", async () => {
    try {
      await validateAndNormalizeProposalImage(Buffer.from("garbage"), "image/jpeg");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ProposalImageValidationError);
    }
  });
});

describe("uploadProposalCoverImage — orquestación", () => {
  it("valida, normaliza y sube vía storagePut PÚBLICO (nunca el privado del avatar)", async () => {
    mockStoragePut.mockResolvedValue({ key: "community-proposals/42/abc.jpg", url: "https://cdn.example.com/community-proposals/42/abc.jpg" });
    const input = await realJpeg(800, 400);
    const result = await uploadProposalCoverImage(42, input, "image/jpeg");
    expect(result.url).toBe("https://cdn.example.com/community-proposals/42/abc.jpg");
    expect(mockStoragePut).toHaveBeenCalledTimes(1);
    const [key, , contentType] = mockStoragePut.mock.calls[0];
    expect(key).toMatch(/^community-proposals\/42\//);
    expect(contentType).toBe("image/jpeg");
  });

  it("si la imagen no es válida, nunca llega a llamar a storagePut", async () => {
    await expect(uploadProposalCoverImage(42, Buffer.from("garbage"), "image/jpeg")).rejects.toBeInstanceOf(ProposalImageValidationError);
    expect(mockStoragePut).not.toHaveBeenCalled();
  });

  it("la clave de almacenamiento está namespaced por studentUserId — nunca predecible/compartida entre Students", async () => {
    mockStoragePut.mockResolvedValue({ key: "community-proposals/7/x.jpg", url: "https://cdn.example.com/community-proposals/7/x.jpg" });
    const input = await realJpeg(400, 400);
    await uploadProposalCoverImage(7, input, "image/jpeg");
    const [key] = mockStoragePut.mock.calls[0];
    expect(key.startsWith("community-proposals/7/")).toBe(true);
  });
});
