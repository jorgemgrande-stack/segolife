import type { Browser } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { loginViaUI } from "../../pre16-17/fixtures/auth";
import { dismissCookieBanner } from "./cookies";

/**
 * El rate limiter real de /api/auth/login (5 req/min por IP —
 * server/_core/index.ts authRateLimit) se dispara si cada test hace su
 * propio login por UI: esta suite tiene solo 4 cuentas fixture pero muchos
 * tests, así que se autentica UNA vez por cuenta y se reutiliza vía
 * storageState (cookies) en cada test — nunca se debilita el rate limiter
 * real para "hacer pasar" el E2E.
 */
const STATE_DIR = path.join("artifacts", "com02-local", "state");
const FRESH_MS = 30 * 60 * 1000;

function statePath(email: string): string {
  return path.join(STATE_DIR, `${email.replace(/[^a-z0-9]/gi, "_")}.json`);
}

export async function storageStateFor(browser: Browser, email: string, password: string): Promise<string> {
  const file = statePath(email);
  fs.mkdirSync(STATE_DIR, { recursive: true });
  if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < FRESH_MS) {
    return file;
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginViaUI(page, email, password);
  await dismissCookieBanner(page);
  await context.storageState({ path: file });
  await context.close();
  return file;
}
