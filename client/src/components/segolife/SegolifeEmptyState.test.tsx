import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SegolifeEmptyState } from "./SegolifeEmptyState";

// vitest.config.ts no usa `globals: true` (este repo importa describe/it/expect
// explícitamente en todos sus tests) — el auto-cleanup de RTL depende de un
// `afterEach` global, así que se registra a mano para no arrastrar DOM entre tests.
afterEach(cleanup);

describe("SegolifeEmptyState — estados vacíos (Fase 6, punto 27)", () => {
  it("renderiza título y descripción, nunca una página en blanco", () => {
    render(<SegolifeEmptyState icon={<span>icon</span>} title="No events tonight" description="Check back later" />);
    expect(screen.getByText("No events tonight")).toBeInTheDocument();
    expect(screen.getByText("Check back later")).toBeInTheDocument();
  });

  it("sin actionLabel/onAction, no renderiza ningún botón (no invita a una acción que no existe)", () => {
    render(<SegolifeEmptyState icon={<span>icon</span>} title="Empty" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("con onAction, el CTA dispara el callback al pulsar", () => {
    const onAction = vi.fn();
    render(<SegolifeEmptyState icon={<span>icon</span>} title="Empty" actionLabel="Explore" onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Explore" }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("con actionHref, el CTA es un enlace real (no un botón sin destino)", () => {
    render(<SegolifeEmptyState icon={<span>icon</span>} title="Empty" actionLabel="Go home" actionHref="/ie" />);
    const link = screen.getByRole("link", { name: "Go home" });
    expect(link).toHaveAttribute("href", "/ie");
  });
});
