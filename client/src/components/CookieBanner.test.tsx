/**
 * CookieBanner.test.tsx — FASE LEGAL (2026-08-23). Primera cobertura de este
 * componente (no tenía tests). Se centra en el comportamiento tocado en esta
 * fase: (a) bug real corregido — /terminos y /condiciones-cancelacion caían
 * antes en el banner oscuro heredado de Náyade en vez del banner claro
 * SEGOLIFE; (b) el nuevo evento para reabrir el banner desde "Configuración
 * de cookies" (footer / página de Cookies).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import "@/lib/i18n";

const { mockUseLocation } = vi.hoisted(() => ({ mockUseLocation: vi.fn(() => ["/"]) }));

vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return { ...actual, useLocation: mockUseLocation };
});

import CookieBanner from "./CookieBanner";
import { openCookiePreferences } from "@/lib/cookiePreferences";

const STORAGE_KEY = "nayade_cookie_consent";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  mockUseLocation.mockReturnValue(["/"]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function waitForBanner() {
  vi.advanceTimersByTime(900);
  await waitFor(() => expect(screen.getByText("Aceptar todas")).toBeInTheDocument());
}

describe("CookieBanner — variante SEGOLIFE por ruta (bug real corregido en esta fase)", () => {
  it.each(["/", "/login", "/register", "/privacidad", "/cookies", "/terminos", "/condiciones-cancelacion", "/aviso-legal"])(
    "%s usa el banner claro SEGOLIFE (i18n), nunca el oscuro heredado de Náyade",
    async (path) => {
      mockUseLocation.mockReturnValue([path]);
      render(<CookieBanner />);
      await waitForBanner();
      // El banner SEGOLIFE usa la clave i18n cookie.acceptAll ("Aceptar todas");
      // el heredado tiene el mismo texto pero además un H2 hardcodeado propio
      // ("Usamos cookies para mejorar tu experiencia") que el SEGOLIFE no tiene.
      expect(screen.queryByText("Usamos cookies para mejorar tu experiencia")).not.toBeInTheDocument();
      expect(screen.getByText("Aceptar todas")).toBeInTheDocument();
    }
  );
});

describe("CookieBanner — aceptar / solo necesarias", () => {
  it("sin consentimiento guardado, el banner aparece tras la carga inicial", async () => {
    render(<CookieBanner />);
    await waitForBanner();
  });

  it("con consentimiento ya guardado (accepted:true), el banner no aparece", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ accepted: true, necessary: true, analytics: false, marketing: false, preferences: false, timestamp: Date.now() }));
    render(<CookieBanner />);
    vi.advanceTimersByTime(900);
    expect(screen.queryByText("Aceptar todas")).not.toBeInTheDocument();
  });

  it("'Aceptar todas' guarda marketing/analytics en true y oculta el banner", async () => {
    render(<CookieBanner />);
    await waitForBanner();
    fireEvent.click(screen.getByText("Aceptar todas"));

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved).toMatchObject({ accepted: true, necessary: true, analytics: true, marketing: true });
    expect(screen.queryByText("Aceptar todas")).not.toBeInTheDocument();
  });

  it("'Solo necesarias' guarda marketing/analytics en false", async () => {
    render(<CookieBanner />);
    await waitForBanner();
    fireEvent.click(screen.getByText("Solo necesarias"));

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved).toMatchObject({ accepted: true, necessary: true, analytics: false, marketing: false });
  });
});

describe("CookieBanner — reabrir desde 'Configuración de cookies' (FASE LEGAL, spec punto 12)", () => {
  it("tras aceptar y cerrar, despachar el evento reabre el banner directamente en el panel de configuración", async () => {
    render(<CookieBanner />);
    await waitForBanner();
    fireEvent.click(screen.getByText("Aceptar todas"));
    expect(screen.queryByText("Aceptar todas")).not.toBeInTheDocument();

    openCookiePreferences();
    await waitFor(() => expect(screen.getByText("Guardar preferencias")).toBeInTheDocument());
  });
});
