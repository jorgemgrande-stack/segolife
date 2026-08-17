import { test } from "@playwright/test";
import { student, allVenueAccounts, venuePassword } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";
import fs from "fs";

const DIR = "docs/handbook/assets";
fs.mkdirSync(DIR, { recursive: true });

async function dismissCookies(page: import("@playwright/test").Page) {
  const btn = page.getByRole("button", { name: /accept all|aceptar todas/i });
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) await btn.click();
}

test("capturas — Master Home / IE / UVA", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await dismissCookies(page);
  await page.screenshot({ path: `${DIR}/01-master-home.png`, fullPage: false });

  await page.goto("/ie");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${DIR}/02-ie-landing.png`, fullPage: false });

  await page.goto("/uva");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${DIR}/03-uva-landing.png`, fullPage: false });

  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await dismissCookies(page);
  await page.screenshot({ path: `${DIR}/04-login.png`, fullPage: false });

  await page.goto("/register?community=ie");
  await page.waitForLoadState("networkidle");
  await dismissCookies(page);
  await page.screenshot({ path: `${DIR}/05-register.png`, fullPage: false });
});

test("capturas — Student App", async ({ page }) => {
  await loginViaUI(page, student.email, student.password);
  await page.waitForLoadState("networkidle");
  await dismissCookies(page);
  await page.screenshot({ path: `${DIR}/06-student-home.png`, fullPage: false });

  await page.goto(`/${student.community}/explore`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${DIR}/07-student-explore.png`, fullPage: false });

  await page.goto(`/${student.community}/rewards`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${DIR}/08-student-rewards.png`, fullPage: false });

  await page.goto(`/${student.community}/profile`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${DIR}/09-student-profile.png`, fullPage: false });

  await page.getByText(/my segolife id|mi id de segolife/i).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/10-student-qr.png`, fullPage: false });
});

test("capturas — Venue App (Casanova)", async ({ page }) => {
  const [venue] = allVenueAccounts();
  test.skip(!venue, "no hay cuentas de Venue en .env.e2e.local");
  await loginViaUI(page, venue.email, venuePassword());
  await page.goto("/admin/mi-local");
  await page.waitForLoadState("networkidle");
  await dismissCookies(page);
  await page.screenshot({ path: `${DIR}/11-venue-hoy.png`, fullPage: false });

  await page.getByRole("navigation").getByRole("button", { name: "TPV" }).click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${DIR}/12-venue-tpv.png`, fullPage: false });

  await page.getByRole("navigation").getByRole("button", { name: "Entradas" }).click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${DIR}/13-venue-entradas.png`, fullPage: false });

  await page.getByRole("navigation").getByRole("button", { name: "Caja" }).click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${DIR}/14-venue-caja.png`, fullPage: false });

  await page.getByRole("navigation").getByRole("button", { name: "Escanear" }).click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${DIR}/15-venue-escanear.png`, fullPage: false });
});

test("capturas — Employee activación (superficie pública)", async ({ page }) => {
  await page.goto("/empleado/activar?token=demo-para-manual");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${DIR}/16-empleado-activar.png`, fullPage: false });
});
