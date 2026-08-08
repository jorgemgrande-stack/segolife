import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SegolifeImage } from "./SegolifeImage";

afterEach(cleanup);

describe("SegolifeImage — resiliencia de imagen (Fase 6, punto 36)", () => {
  it("sin src, muestra el fallback en vez de un <img> roto", () => {
    render(<SegolifeImage src={null} alt="Sin imagen" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("con src, renderiza la imagen real con lazy loading", () => {
    render(<SegolifeImage src="https://example.com/foto.jpg" alt="Evento" />);
    const img = screen.getByRole("img", { name: "Evento" });
    expect(img).toHaveAttribute("src", "https://example.com/foto.jpg");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it("si la imagen falla al cargar (onError), cambia al fallback en vez de dejar un icono roto", () => {
    render(<SegolifeImage src="https://example.com/rota.jpg" alt="Evento roto" />);
    const img = screen.getByRole("img", { name: "Evento roto" });
    fireEvent.error(img);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
