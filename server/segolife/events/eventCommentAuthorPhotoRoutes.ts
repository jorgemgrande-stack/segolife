/**
 * eventCommentAuthorPhotoRoutes.ts — Social Layer para Events (2026-08-23):
 * foto de un estudiante que comentó en un evento, visible para cualquiera
 * con acceso a ESE evento (mismo criterio "avatar-stack estilo Instagram"
 * que communityRespondentPhotoRoutes.ts, adaptado a Events).
 *
 * NUNCA se toca /api/students/:userId/photo (studentPhotoRoutes.ts, self/
 * admin-only) ni /api/community/proposals/:id/respondents/:userId/photo
 * (Community, dominio distinto). Ruta NUEVA y DELIBERADAMENTE estrecha: solo
 * sirve la foto de userId si (a) quien pide está autenticado, (b) quien pide
 * tiene acceso real a ESE evento (assertCanInteractWithEvent — misma puerta
 * exacta que dar like/comentar/leer comentarios, nunca una copia), y (c)
 * userId tiene AL MENOS un comentario NO oculto en ese evento — nunca se
 * sirve la foto de alguien que ni comentó, aunque comparta acceso al evento.
 * Revalida las condiciones en CADA petición, nunca cachea la autorización.
 */
import { Router, Request, Response } from "express";
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eventComments } from "../../../drizzle/schema";
import { getUserFromRequest } from "../../localAuth";
import { getMyPhotoBytes } from "../students/studentPhotoService";
import { assertCanInteractWithEvent, EventSocialError } from "./eventSocialDb";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

const router = Router();

router.get("/api/events/:eventId/comment-authors/:userId/photo", async (req: Request, res: Response) => {
  const sessionUser = await getUserFromRequest(req).catch(() => null);
  if (!sessionUser) {
    res.status(401).json({ error: "No autenticado." });
    return;
  }

  const eventId = Number(req.params.eventId);
  const targetUserId = Number(req.params.userId);
  if (!Number.isInteger(eventId) || eventId <= 0 || !Number.isInteger(targetUserId) || targetUserId <= 0) {
    res.status(400).json({ error: "Identificador no válido." });
    return;
  }

  try {
    await assertCanInteractWithEvent(eventId, sessionUser.id, _db);
  } catch (err) {
    if (err instanceof EventSocialError) {
      res.status(err.code === "NOT_FOUND" ? 404 : 403).json({ error: err.message });
      return;
    }
    throw err;
  }

  const [hasComment] = await _db.select({ id: eventComments.id }).from(eventComments)
    .where(and(eq(eventComments.eventId, eventId), eq(eventComments.userId, targetUserId), eq(eventComments.isHidden, false)))
    .limit(1);
  if (!hasComment) {
    res.status(403).json({ error: "No autorizado." });
    return;
  }

  const bytes = await getMyPhotoBytes(targetUserId);
  if (!bytes) {
    res.status(404).json({ error: "Sin fotografía." });
    return;
  }
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.status(200).send(bytes);
});

export default router;
