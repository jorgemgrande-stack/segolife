import type { Page } from "@playwright/test";

/**
 * El CookieBanner (client/src/components/CookieBanner.tsx) se muestra en la
 * primera carga de cada contexto de navegador nuevo y su botón "Aceptar
 * todas"/"Accept all" queda fijo en la parte inferior, interceptando clicks
 * sobre la barra de composición de comentarios si no se descarta antes.
 */
export async function dismissCookieBanner(page: Page) {
  const btn = page.getByRole("button", { name: /^(Aceptar todas|Accept all)$/ });
  // El banner puede montarse unos instantes después del navigate/login (no
  // está presente en el primer paint) — esperar activamente en vez de un
  // chequeo instantáneo de visibilidad, si no aparece en el plazo simplemente
  // no había banner que descartar (p.ej. ya se descartó antes en este mismo
  // contexto de navegador).
  await btn.waitFor({ state: "visible", timeout: 4000 }).catch(() => null);
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await btn.waitFor({ state: "hidden", timeout: 4000 }).catch(() => null);
  }
}
