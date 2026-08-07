/**
 * communityAccess.ts — scoping por comunidad, ortogonal al RBAC de permisos.
 *
 * RBAC (rbac.ts) resuelve QUÉ puede hacer un usuario (verbos: "students.view").
 * Esto resuelve A QUÉ DATOS puede acceder (alcance: "solo su(s) comunidad(es)").
 * Son dos capas independientes — ver docs/SEGOLIFE_MODULE_AUDIT.md §RBAC.
 *
 * GLOBAL ADMIN: acceso a todas las comunidades. Hoy determinado por el mismo
 * criterio que adminProcedure (permiso RBAC "settings.manage" con fallback al
 * rol legacy "admin") — no se ha inventado un permiso nuevo para esto porque
 * ya existe uno equivalente y reutilizarlo evita duplicar el concepto de
 * "admin de verdad".
 *
 * COMMUNITY ADMIN: acceso solo a las comunidades donde tiene una fila en
 * `user_communities` con `role_in_community = 'community_admin'`. No existe
 * todavía ninguna UI para asignar este rol (se asignaría insertando esa fila
 * directamente) — la Fase 1C solo deja las queries preparadas para no asumir
 * que todo admin ve todo, tal como pidió el usuario.
 */
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { userCommunities } from "../../drizzle/schema";
import { checkRbacOrLegacy } from "./rbac";
import { TRPCError } from "@trpc/server";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export const COMMUNITY_ADMIN_ROLE = "community_admin";

/** "all" = sin restricción (global admin). number[] = solo esas comunidades. */
export type CommunityAccess = "all" | number[];

/**
 * Resuelve el alcance de comunidades de un usuario. Nunca lanza — un usuario
 * sin permiso global y sin ninguna fila community_admin obtiene `[]` (no ve
 * ninguna comunidad), no un error; el procedure que llama a esto decide qué
 * hacer con un alcance vacío.
 */
export async function getCommunityAccess(
  userId: number,
  legacyRole: string,
  db?: DbHandle
): Promise<CommunityAccess> {
  const isGlobalAdmin = await checkRbacOrLegacy(userId, legacyRole, "settings.manage", ["admin"]);
  if (isGlobalAdmin) return "all";

  const conn = db ?? (await getDb());
  const rows = await conn
    .select({ communityId: userCommunities.communityId })
    .from(userCommunities)
    .where(and(eq(userCommunities.userId, userId), eq(userCommunities.roleInCommunity, COMMUNITY_ADMIN_ROLE)));
  return rows.map(r => r.communityId);
}

/**
 * Combina el alcance real del usuario (`access`) con lo que pidió el
 * frontend (`requested`, el valor del selector Todas/IE/UVA) para obtener el
 * filtro EFECTIVO a aplicar en la query. El frontend nunca decide el alcance
 * por sí solo — esto es lo que hace el filtro "real" en vez de cosmético:
 *
 * - Global admin + "all"/undefined  → "all" (sin filtro)
 * - Global admin + comunidad X      → [X] (puede consultar cualquiera)
 * - Community admin + "all"/undef.  → sus propias comunidades (nunca "todas" de verdad)
 * - Community admin + comunidad X   → [X] SI X está en su alcance, si no FORBIDDEN
 * - Alcance vacío ([])              → [] siempre (no ve nada), sea lo que pida el frontend
 */
export function resolveCommunityFilter(
  access: CommunityAccess,
  requested: number | "all" | undefined
): number[] | "all" {
  if (access === "all") {
    if (requested === undefined || requested === "all") return "all";
    return [requested];
  }
  if (requested === undefined || requested === "all") return access;
  if (!access.includes(requested)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tienes acceso a esta comunidad",
    });
  }
  return [requested];
}
