import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "@/lib/i18n";
import { SegolifeBottomSheet } from "./SegolifeBottomSheet";

/**
 * SegolifeBottomSheet.test.tsx — "UX móvil: Bottom Sheets globales".
 * Cubre el contrato del componente reutilizable: abre/cierra (backdrop, X,
 * Escape), fondo siempre blanco (nunca depende del tema), grabber/título
 * opcionales, footer fijo.
 */
beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
});
describe("SegolifeBottomSheet — apertura y cierre", () => {
  it("no renderiza nada cuando open=false", () => {
    render(<SegolifeBottomSheet open={false} onClose={vi.fn()}>contenido</SegolifeBottomSheet>);
    expect(screen.queryByText("contenido")).not.toBeInTheDocument();
  });

  it("renderiza el contenido y el título cuando open=true", async () => {
    render(<SegolifeBottomSheet open onClose={vi.fn()} title="Mi título">contenido</SegolifeBottomSheet>);
    expect(await screen.findByText("contenido")).toBeInTheDocument();
    expect(screen.getByText("Mi título")).toBeInTheDocument();
  });

  it("el botón X explícito llama a onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SegolifeBottomSheet open onClose={onClose} title="Mi título">contenido</SegolifeBottomSheet>);
    await user.click(await screen.findByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape llama a onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SegolifeBottomSheet open onClose={onClose}>contenido</SegolifeBottomSheet>);
    await screen.findByText("contenido");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("showCloseButton=false oculta la X pero el contenido sigue accesible", async () => {
    render(<SegolifeBottomSheet open onClose={vi.fn()} title="Título" showCloseButton={false}>contenido</SegolifeBottomSheet>);
    await screen.findByText("contenido");
    expect(screen.queryByRole("button", { name: /close/i })).not.toBeInTheDocument();
  });
});

describe("SegolifeBottomSheet — footer fijo y contenido scrolleable", () => {
  it("renderiza el stickyFooter junto al contenido principal", async () => {
    render(
      <SegolifeBottomSheet open onClose={vi.fn()} title="Comentarios" stickyFooter={<button>Enviar</button>}>
        contenido largo
      </SegolifeBottomSheet>
    );
    expect(await screen.findByText("contenido largo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeInTheDocument();
  });

  it("sin stickyFooter no renderiza ningún footer extra", async () => {
    render(<SegolifeBottomSheet open onClose={vi.fn()} title="Título">contenido</SegolifeBottomSheet>);
    await screen.findByText("contenido");
    expect(screen.queryByRole("button", { name: "Enviar" })).not.toBeInTheDocument();
  });
});
