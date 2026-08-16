/**
 * passwordReset.ts — Flujo de recuperación de contraseña.
 *
 * Endpoints:
 *  POST /api/auth/forgot-password  → genera token, envía email con enlace
 *  POST /api/auth/reset-password   → valida token, actualiza contraseña
 *
 * Compatible con LOCAL_AUTH=true. En modo Manus, estos endpoints no se montan.
 */
import bcrypt from "bcryptjs";
import crypto from "crypto";
import express, { type Request, type Response, type Router } from "express";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { users, passwordResetTokens, userCommunities, notificationDeliveries } from "../drizzle/schema";
import { createNotification } from "./segolife/engagement/notificationService";
import { renderTemplate } from "./segolife/engagement/templates";

// ─── Configuración ────────────────────────────────────────────────────────────
const TOKEN_EXPIRY_MINUTES = 60; // El enlace caduca en 1 hora
const BCRYPT_ROUNDS = 12;

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * Migrado al Communication Center (Segolife) — antes usaba
 * server/emailTemplates.ts (branding Náyade/Skicenter heredado, incl. el
 * fallback de asunto "Recuperar contraseña — Skicenter" si `brand_name` no
 * estaba sembrado). Nunca se toca aquí la generación/validación del token —
 * solo qué plantilla/remitente construye el email.
 */
async function sendResetEmail(user: { id: number; email: string; name: string | null }, resetPath: string, resetUrl: string, tokenId: number, db: Db) {
  // Comunidad de origen best-effort (para resolver EN/ES) — un usuario de
  // staff sin comunidad simplemente cae al fallback de plataforma "es".
  const [membership] = await db.select({ communityId: userCommunities.communityId })
    .from(userCommunities).where(eq(userCommunities.userId, user.id)).orderBy(asc(userCommunities.joinedAt)).limit(1);
  const communityId = membership?.communityId ?? null;

  const rendered = renderTemplate("password_reset_requested", { expiryMinutes: String(TOKEN_EXPIRY_MINUTES) }, resetPath);

  const result = await createNotification({
    userId: user.id,
    communityId,
    type: "password_reset_requested",
    category: "account",
    audienceType: "transactional",
    rendered,
    templateKey: "password_reset_requested",
    templateVersion: 1,
    sourceType: "password_reset_token",
    sourceId: tokenId,
    // Único por TOKEN (no por usuario) — cada solicitud de reset genera un
    // token nuevo y debe poder enviar su propio email, a diferencia de
    // benefit_granted/ticket_purchased donde el idempotencyKey identifica
    // una entidad de negocio ya única de por sí.
    idempotencyKey: `password_reset_requested:${tokenId}`,
    additionalChannels: ["email"],
    sendImmediately: true,
    recipient: { email: user.email },
  }, db as any);

  // Fallback de desarrollo: si el provider de email no está configurado
  // (SEGOLIFE_ENGAGEMENT_EMAIL_FROM vacío en local), imprimir el enlace en
  // consola — mismo comportamiento de antes, ahora leído de la entrega real.
  //
  // Fase 16 (auditoría de seguridad) — este `if` nunca comprobaba NODE_ENV a
  // pesar de que el propio comentario lo describe como "fallback de
  // desarrollo": cualquier fallo de entrega de email en PRODUCCIÓN (Brevo
  // caído, remitente mal configurado, lo que sea) escribía el enlace de
  // reseteo — con el token real, capaz de tomar la cuenta — en texto plano
  // en los logs del servidor, accesibles a cualquiera con acceso a Railway.
  // Nunca se debe imprimir un secreto de sesión/cuenta en logs de producción.
  if (result.status === "created" && process.env.NODE_ENV !== "production") {
    const [delivery] = await db.select({ status: notificationDeliveries.status })
      .from(notificationDeliveries)
      .where(and(eq(notificationDeliveries.notificationId, result.notification.id), eq(notificationDeliveries.channel, "email")))
      .limit(1);
    if (delivery?.status !== "sent") {
      console.log(`\n[PasswordReset] 📧 Enlace de recuperación para ${user.email}:\n  ${resetUrl}\n`);
    }
  }
}

/** Notificación de seguridad — hueco real detectado en auditoría (PasswordChanged nunca se notificaba). Solo email — el usuario puede no tener sesión activa en este dispositivo para ver un in-app. */
async function sendPasswordChangedNotification(userId: number, db: Db) {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.email) return;
  const [membership] = await db.select({ communityId: userCommunities.communityId })
    .from(userCommunities).where(eq(userCommunities.userId, userId)).orderBy(asc(userCommunities.joinedAt)).limit(1);

  const rendered = renderTemplate("password_changed", {});
  await createNotification({
    userId,
    communityId: membership?.communityId ?? null,
    type: "password_changed",
    category: "account",
    audienceType: "transactional",
    rendered,
    templateKey: "password_changed",
    templateVersion: 1,
    sourceType: "user",
    sourceId: userId,
    idempotencyKey: `password_changed:${userId}:${Date.now()}`,
    additionalChannels: ["email"],
    sendImmediately: true,
    recipient: { email: user.email },
  }, db as any);
}

// ─── Router Express ───────────────────────────────────────────────────────────
export function createPasswordResetRouter(): Router {
  const router = express.Router();

  /**
   * POST /api/auth/forgot-password
   * Body: { email: string }
   *
   * Siempre responde 200 (no revela si el email existe).
   */
  router.post("/api/auth/forgot-password", async (req: Request, res: Response) => {
    const { email, origin } = req.body ?? {};

    if (!email || typeof email !== "string") {
      res.status(400).json({ error: "Email obligatorio." });
      return;
    }

    try {
      const db = await getDb();
      if (!db) {
        res.status(503).json({ error: "Base de datos no disponible." });
        return;
      }

      const rows = await db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase().trim()))
        .limit(1);

      const user = rows[0];

      // Responder siempre 200 para no revelar si el email existe
      if (!user || !user.isActive) {
        res.json({ ok: true, message: "Si el email existe, recibirás un enlace en breve." });
        return;
      }

      // Invalidar tokens anteriores del mismo usuario (marcarlos como usados)
      await db
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));

      // Generar token seguro
      const rawToken = crypto.randomBytes(48).toString("hex");
      const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000);

      const [tokenInsertResult] = await db.insert(passwordResetTokens).values({
        userId: user.id,
        token: rawToken,
        expiresAt,
      });
      const tokenId = (tokenInsertResult as unknown as { insertId: number }).insertId;

      // Construir URL de reset
      const baseUrl = (origin && typeof origin === "string")
        ? origin.replace(/\/$/, "")
        : (process.env.APP_URL ?? "http://localhost:3000");
      const resetPath = `/nueva-contrasena?token=${rawToken}`;
      const resetUrl = `${baseUrl}${resetPath}`;

      // Fase 16 (auditoría de seguridad/comunicación) — sendResetEmail() pasa
      // este valor a renderTemplate() como `deepLink`, que sanitizeDeepLink()
      // exige que sea una ruta RELATIVA (`startsWith("/")`, nunca una URL
      // absoluta — es una whitelist anti-phishing, spec deepLinkPolicy.ts).
      // Pasar `resetUrl` (absoluto) aquí hacía que sanitizeDeepLink lo
      // rechazara SIEMPRE, así que el email de recuperación se enviaba sin
      // botón "Set new password" — el estudiante no tenía forma de resetear
      // su contraseña por email. `resetUrl` (absoluto) se sigue usando tal
      // cual para el fallback de consola en desarrollo, donde sí hace falta
      // pegable en el navegador.
      await sendResetEmail({ id: user.id, email: user.email ?? email, name: user.name ?? "" }, resetPath, resetUrl, tokenId, db);

      res.json({ ok: true, message: "Si el email existe, recibirás un enlace en breve." });
    } catch (err) {
      console.error("[PasswordReset] Error en forgot-password:", err);
      res.status(500).json({ error: "Error interno. Inténtalo más tarde." });
    }
  });

  /**
   * POST /api/auth/reset-password
   * Body: { token: string, password: string }
   */
  router.post("/api/auth/reset-password", async (req: Request, res: Response) => {
    const { token, password } = req.body ?? {};

    if (!token || !password) {
      res.status(400).json({ error: "Token y contraseña son obligatorios." });
      return;
    }

    if (typeof password !== "string" || password.length < 8) {
      res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres." });
      return;
    }

    try {
      const db = await getDb();
      if (!db) {
        res.status(503).json({ error: "Base de datos no disponible." });
        return;
      }

      const now = new Date();

      // Buscar token válido (no usado, no expirado)
      const tokenRows = await db
        .select()
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.token, String(token)),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, now)
          )
        )
        .limit(1);

      const resetToken = tokenRows[0];

      if (!resetToken) {
        res.status(400).json({ error: "El enlace no es válido o ha expirado. Solicita uno nuevo." });
        return;
      }

      // Actualizar contraseña
      const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
      await db
        .update(users)
        .set({ passwordHash, updatedAt: now })
        .where(eq(users.id, resetToken.userId));

      // Marcar token como usado
      await db
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(eq(passwordResetTokens.id, resetToken.id));

      // Hueco real detectado en auditoría: PasswordChanged nunca se
      // notificaba. Best-effort — un fallo aquí nunca debe impedir responder
      // 200 (la contraseña ya se cambió correctamente).
      sendPasswordChangedNotification(resetToken.userId, db).catch(err => {
        console.error("[PasswordReset] No se pudo enviar la notificación de password_changed:", err);
      });

      res.json({ ok: true, message: "Contraseña actualizada correctamente." });
    } catch (err) {
      console.error("[PasswordReset] Error en reset-password:", err);
      res.status(500).json({ error: "Error interno. Inténtalo más tarde." });
    }
  });

  /**
   * GET /api/auth/validate-reset-token?token=xxx
   * Verifica si un token es válido sin consumirlo.
   */
  router.get("/api/auth/validate-reset-token", async (req: Request, res: Response) => {
    const token = req.query.token as string;

    if (!token) {
      res.status(400).json({ valid: false, error: "Token requerido." });
      return;
    }

    try {
      const db = await getDb();
      if (!db) {
        res.status(503).json({ valid: false });
        return;
      }

      const now = new Date();
      const rows = await db
        .select({ id: passwordResetTokens.id })
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.token, token),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, now)
          )
        )
        .limit(1);

      res.json({ valid: rows.length > 0 });
    } catch {
      res.status(500).json({ valid: false });
    }
  });

  return router;
}
