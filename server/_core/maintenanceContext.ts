/**
 * maintenanceContext.ts — regla compartida por context.ts y context.local.ts
 * (Manus OAuth y LOCAL_AUTH construyen el TrpcContext por separado, pero
 * ambos deben aplicar el mismo bloqueo de mantenimiento).
 *
 * Mientras site_maintenance_mode_enabled esté activo, cualquier sesión que no
 * sea la del administrador general se trata como no autenticada de cara a
 * tRPC — así protectedProcedure/adminProcedure/staffProcedure/etc. quedan
 * bloqueados para todos los demás sin tocar cada middleware individualmente.
 */

import type { User } from "../../drizzle/schema";
import { MAINTENANCE_BYPASS_EMAIL } from "@shared/const";
import { getSystemSetting } from "../config";

export async function applyMaintenanceBypass(user: User | null): Promise<User | null> {
  if (!user || user.email === MAINTENANCE_BYPASS_EMAIL) return user;
  const maintenanceOn = await getSystemSetting("site_maintenance_mode_enabled", "false") === "true";
  return maintenanceOn ? null : user;
}
