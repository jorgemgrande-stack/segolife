/**
 * context.local.ts — Contexto tRPC para ejecución local sin Manus OAuth.
 *
 * Sustituye context.ts cuando LOCAL_AUTH=true en el .env.
 * Lee la cookie JWT emitida por localAuth.ts en lugar de llamar al SDK de Manus.
 */

import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { getUserAndMaybeRenewSession } from "../localAuth";
import { applyMaintenanceBypass } from "./maintenanceContext";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

/**
 * SEC-02: cada request tRPC autenticada es "actividad real" del usuario —
 * el punto correcto para renovar la sesión de forma deslizante si procede
 * (getUserAndMaybeRenewSession decide internamente si hace falta, según
 * AUTH_SESSION_RENEWAL_THRESHOLD_SECONDS; la mayoría de requests no
 * escriben ninguna cookie nueva).
 */
export async function createLocalContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await getUserAndMaybeRenewSession(opts.req, opts.res);
  } catch {
    user = null;
  }

  user = await applyMaintenanceBypass(user);

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
