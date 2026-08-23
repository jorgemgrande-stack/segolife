/**
 * ProposalImageUploader.test.tsx — subida real de imagen de portada,
 * extraída de ComunityHub.tsx ProponerTab (2026-08-24) para reutilizarla
 * también en el wizard y el diálogo de edición de Admin (bug real: la
 * imagen de portada en Admin era una URL a pegar a mano, y la conversión de
 * idea de Student a propuesta formal ni siquiera trasladaba esa URL — ver
 * server/routers/community.test.ts).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProposalImageUploader } from "./ProposalImageUploader";

const LABELS = {
  fieldLabel: "Imagen de portada",
  addImage: "Añadir imagen",
  removeImage: "Quitar imagen",
  invalidType: "Tipo de imagen no válido",
  tooLarge: "Imagen demasiado grande",
  uploadError: "Error al subir la imagen",
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProposalImageUploader — estado inicial", () => {
  it("sin valor, muestra el botón de añadir imagen, nunca una preview", () => {
    render(<ProposalImageUploader value="" onChange={vi.fn()} labels={LABELS} />);
    expect(screen.getByRole("button", { name: "Añadir imagen" })).toBeInTheDocument();
    expect(document.querySelector("img")).not.toBeInTheDocument();
  });

  it("con un valor ya existente, muestra la preview y el botón de quitar, nunca el de añadir", () => {
    render(<ProposalImageUploader value="https://cdn.example.com/x.jpg" onChange={vi.fn()} labels={LABELS} />);
    expect(document.querySelector("img")).toHaveAttribute("src", "https://cdn.example.com/x.jpg");
    expect(screen.getByRole("button", { name: "Quitar imagen" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Añadir imagen" })).not.toBeInTheDocument();
  });
});

describe("ProposalImageUploader — subida real vía POST /api/community/proposal-image", () => {
  function getFileInput() {
    return document.querySelector('input[type="file"]') as HTMLInputElement;
  }

  it("un archivo válido se sube, y onChange recibe la URL real devuelta por el servidor", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, json: async () => ({ success: true, url: "https://cdn.example.com/community-proposals/7/abc.jpg" }),
    });
    const onChange = vi.fn();
    render(<ProposalImageUploader value="" onChange={onChange} labels={LABELS} />);

    const file = new File(["fake-image-bytes"], "cover.jpg", { type: "image/jpeg" });
    const user = userEvent.setup();
    await user.upload(getFileInput(), file);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      "/api/community/proposal-image",
      expect.objectContaining({ method: "POST", credentials: "include" })
    ));
    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(options.body).toBeInstanceOf(FormData);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("https://cdn.example.com/community-proposals/7/abc.jpg"));
  });

  it("notifica onUploadingChange(true) al empezar y onUploadingChange(false) al terminar", async () => {
    let resolveUpload: (v: unknown) => void = () => {};
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(res => { resolveUpload = res; }));
    const onUploadingChange = vi.fn();
    render(<ProposalImageUploader value="" onChange={vi.fn()} labels={LABELS} onUploadingChange={onUploadingChange} />);

    const file = new File(["fake-image-bytes"], "cover.jpg", { type: "image/jpeg" });
    const user = userEvent.setup();
    await user.upload(getFileInput(), file);
    await waitFor(() => expect(onUploadingChange).toHaveBeenCalledWith(true));

    resolveUpload({ ok: true, json: async () => ({ success: true, url: "https://cdn.example.com/x.jpg" }) });
    await waitFor(() => expect(onUploadingChange).toHaveBeenLastCalledWith(false));
  });

  it("tipo de archivo no permitido: rechazado en el cliente, nunca llega a fetch", async () => {
    const onChange = vi.fn();
    render(<ProposalImageUploader value="" onChange={onChange} labels={LABELS} />);
    const file = new File(["<svg></svg>"], "cover.svg", { type: "image/svg+xml" });
    const user = userEvent.setup();
    await user.upload(getFileInput(), file);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Añadir imagen" })).toBeInTheDocument();
  });

  it("archivo demasiado grande (>8MB): rechazado en el cliente, nunca llega a fetch", async () => {
    const onChange = vi.fn();
    render(<ProposalImageUploader value="" onChange={onChange} labels={LABELS} />);
    const bigFile = new File([new Uint8Array(9 * 1024 * 1024)], "cover.jpg", { type: "image/jpeg" });
    const user = userEvent.setup();
    await user.upload(getFileInput(), bigFile);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("error del servidor (500) durante la subida: nunca rompe el formulario, sigue ofreciendo reintentar", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, json: async () => ({ error: "upload_failed" }) });
    const onChange = vi.fn();
    render(<ProposalImageUploader value="" onChange={onChange} labels={LABELS} />);
    const file = new File(["fake-image-bytes"], "cover.jpg", { type: "image/jpeg" });
    const user = userEvent.setup();
    await user.upload(getFileInput(), file);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Añadir imagen" })).toBeInTheDocument();
  });

  it("pulsar 'Quitar imagen' llama a onChange con cadena vacía", async () => {
    const onChange = vi.fn();
    render(<ProposalImageUploader value="https://cdn.example.com/x.jpg" onChange={onChange} labels={LABELS} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Quitar imagen" }));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
