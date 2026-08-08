/**
 * scripts/bootstrap-segolife-admin.ts — CLI explícito, manual y one-shot
 * para crear el PRIMER administrador global de Segolife. Wrapper fino sobre
 * server/_core/adminBootstrap.ts (ver ese archivo para el diseño/auditoría
 * completa) — parseo de argv/env, mensajes de consola y process.exit viven
 * aquí; la lógica de dominio vive allí para poder testearla sin un proceso
 * CLI real.
 *
 * NUNCA se invoca desde npm start / db:migrate / db:seed / el arranque del
 * servidor — solo cuando un operador humano lo ejecuta a propósito.
 *
 * Uso:
 *   SEGOLIFE_ADMIN_PASSWORD=... pnpm admin:bootstrap -- \
 *     --email=jorgemgrande@gmail.com --name="Jorge Grande" --target=MySQL-zWz9
 *
 * --target=<nombre> es una atestación explícita del operador (no una
 * introspección de Railway, que un script externo no puede verificar de
 * forma fiable a través de un proxy TCP) — obliga a escribir a propósito el
 * nombre del servicio destino antes de escribir en producción.
 *
 * La contraseña se lee EXCLUSIVAMENTE de la variable de entorno
 * SEGOLIFE_ADMIN_PASSWORD (nunca de un argumento de línea de comandos, nunca
 * de un prompt) — nunca se persiste en Railway, nunca en un .env versionado,
 * y el operador debe eliminarla de su entorno al terminar.
 */
import "dotenv/config";
import { bootstrapAdmin, BootstrapAdminError } from "../server/_core/adminBootstrap";

const EXPECTED_TARGET = "MySQL-zWz9";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of argv) {
    const m = /^--([a-zA-Z0-9_-]+)=(.*)$/.exec(arg);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const email = (args.email ?? "").trim().toLowerCase();
  const name = (args.name ?? "").trim();
  const target = (args.target ?? "").trim();
  const password = process.env.SEGOLIFE_ADMIN_PASSWORD ?? "";

  if (!email || !isValidEmail(email)) {
    console.error("[bootstrap-admin] --email inválido o ausente. Aborta.");
    process.exit(1);
  }
  if (!name) {
    console.error("[bootstrap-admin] --name ausente. Aborta.");
    process.exit(1);
  }
  if (target !== EXPECTED_TARGET) {
    console.error(
      `[bootstrap-admin] --target debe ser exactamente "${EXPECTED_TARGET}" (atestación explícita del operador). Recibido: "${target || "(vacío)"}". Aborta.`
    );
    process.exit(1);
  }
  if (!password || password.length < 8) {
    console.error("[bootstrap-admin] SEGOLIFE_ADMIN_PASSWORD ausente o menor de 8 caracteres. Aborta.");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("[bootstrap-admin] DATABASE_URL no está definida. Aborta.");
    process.exit(1);
  }

  console.log(`[bootstrap-admin] Objetivo declarado por el operador: ${target}`);
  console.log(`[bootstrap-admin] Email: ${email}`);
  console.log(`[bootstrap-admin] Nombre: ${name}`);
  console.log("[bootstrap-admin] Conectando...");

  try {
    const result = await bootstrapAdmin({ email, name, password });
    console.log(`[bootstrap-admin] OK — userId=${result.userId} email=${result.email} name=${result.name} isActive=${result.isActive}`);
    console.log('[bootstrap-admin] RBAC: rol "admin" asignado en rbac_user_roles (global, sin scoping por comunidad).');
    console.log("[bootstrap-admin] Completado.");
    process.exit(0);
  } catch (err) {
    if (err instanceof BootstrapAdminError) {
      console.error(`[bootstrap-admin] ${err.code}: ${err.message}. ABORTA — nunca actualiza, nunca resetea contraseña, nunca reasigna permisos.`);
      process.exit(1);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error("[bootstrap-admin] Error:", err.message);
  process.exit(1);
});
