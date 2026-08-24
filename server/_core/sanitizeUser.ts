import type { User } from "../../drizzle/schema";

export type PublicUser = Omit<User, "passwordHash" | "inviteToken" | "inviteTokenExpiry">;

/**
 * Quita los campos secretos de `users` antes de enviar la fila al cliente.
 * auth.me (server/routers.ts) exponía la fila completa de Drizzle, incluido
 * el hash bcrypt de la contraseña, en cada `trpc.auth.me.useQuery()` — es
 * decir, en cada carga de página autenticada (hallazgo real, no teórico).
 */
export function toPublicUser<T extends User | null | undefined>(
  user: T
): T extends User ? PublicUser : T {
  if (!user) return user as T extends User ? PublicUser : T;
  const { passwordHash, inviteToken, inviteTokenExpiry, ...safe } = user;
  return safe as T extends User ? PublicUser : T;
}
