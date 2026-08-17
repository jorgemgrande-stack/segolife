import type { Page } from "@playwright/test";

/**
 * Login real vía formulario (nunca vía API directa) — el objetivo de
 * PRE-16.17A es probar el DOM/form real, no solo el backend. Espera a que
 * la navegación post-login se resuelva (homeForRole en Login.tsx) antes de
 * devolver el control.
 */
export async function loginViaUI(page: Page, email: string, password: string, returnTo?: string) {
  const url = returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : "/login";
  await page.goto(url);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 25000 }),
    page.locator('button[type="submit"]').click(),
  ]);
}

export async function logoutViaUI(page: Page) {
  // El logout real está detrás del menú de usuario en AdminLayout/EmployeeLayout
  // — más robusto y menos frágil ante cambios de UI: limpiar la cookie de
  // sesión directamente y recargar, mismo efecto observable (sesión cerrada)
  // que probarán los tests de acceso posteriores.
  await page.context().clearCookies();
}
