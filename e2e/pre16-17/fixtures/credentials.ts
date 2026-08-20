/**
 * PRE-16.17A — credenciales de QA leídas SIEMPRE de variables de entorno
 * (.env.e2e.local, gitignored — ver playwright.production.config.ts).
 * Ningún spec de este directorio debe hardcodear un email o password real.
 */
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[e2e credentials] falta ${name} en .env.e2e.local`);
  return v;
}

export const student = {
  email: required("E2E_STUDENT_EMAIL"),
  password: required("E2E_STUDENT_PASSWORD"),
  community: required("E2E_STUDENT_COMMUNITY"),
};

/** FINAL ZERO-DEBT (Block B) — cuenta Admin QA dedicada, ver docs/QA_ACCOUNTS.md. Nunca la cuenta personal del usuario. */
export const admin = {
  email: required("E2E_ADMIN_EMAIL"),
  password: required("E2E_ADMIN_PASSWORD"),
};

export interface VenueAccount {
  key: string;
  name: string;
  email: string;
}

const VENUE_PASSWORD_ENV = "E2E_VENUE_PASSWORD";

export function venuePassword(): string {
  return required(VENUE_PASSWORD_ENV);
}

/** Lista dinámica — cualquier E2E_VENUE_<KEY>_EMAIL presente en el entorno entra en la matriz, nunca una lista fija hardcodeada. */
export function allVenueAccounts(): VenueAccount[] {
  const accounts: VenueAccount[] = [];
  for (const key of Object.keys(process.env)) {
    const m = key.match(/^E2E_VENUE_([A-Z0-9]+)_EMAIL$/);
    if (!m) continue;
    const email = process.env[key];
    if (!email) continue;
    accounts.push({ key: m[1], name: m[1], email });
  }
  return accounts.sort((a, b) => a.key.localeCompare(b.key));
}
