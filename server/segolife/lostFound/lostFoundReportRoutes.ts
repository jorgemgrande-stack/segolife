/**
 * lostFoundReportRoutes.ts — LNF-01. Dos rutas REST (no tRPC — mismo
 * motivo que studentPhotoRoutes.ts: multipart/form-data de entrada y bytes
 * binarios de salida no encajan bien en JSON-RPC):
 *
 *  POST /api/lost-found              — crea el caso (+ conversación inicial
 *                                       COM-01, spec §10) EN UNA SOLA
 *                                       petición, foto opcional incluida.
 *                                       SIEMPRE self-service — identidad
 *                                       resuelta de la sesión real, nunca
 *                                       de un studentId del cliente.
 *  GET  /api/lost-found/:id/photo    — servida autenticada. Autoriza SOLO
 *                                       dueño (Student), admin global
 *                                       (lost_found.manage) o venue_admin
 *                                       con venue_staff activo en el venue
 *                                       real del caso (nunca acceso ancho
 *                                       al CRM Student por esto).
 */
import { Router, Request, Response } from "express";
import multer from "multer";
import { getUserFromRequest } from "../../localAuth";
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { venues, userCommunities, lostFoundReports } from "../../../drizzle/schema";
import {
  createLostFoundReport, LostFoundError,
} from "./lostFoundDb";
import {
  validateAndNormalizeLostFoundImage, storeLostFoundPhoto, getLostFoundPhotoBytes,
  LostFoundPhotoValidationError, MAX_UPLOAD_BYTES,
} from "./lostFoundPhotoService";
import { getVenueStaffAccess, venueAccessAllows } from "../benefits/venueStaffAccess";
import { checkRbacOrLegacy } from "../../_core/rbac";

const router = Router();
const _pool = mysql.createPool({ uri: process.env.DATABASE_URL! });
const _db = drizzle(_pool);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    // Filtro barato por Content-Type declarado — la validación REAL (sharp()
    // decodificando de verdad los bytes) vive en lostFoundPhotoService.ts.
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    cb(null, allowed.includes(file.mimetype));
  },
});

function mapLostFoundError(err: unknown, res: Response): void {
  if (err instanceof LostFoundError) {
    const status = err.code === "NOT_FOUND" ? 404 : err.code === "INVALID_TRANSITION" ? 409 : 400;
    res.status(status).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof LostFoundPhotoValidationError) {
    res.status(400).json({ error: err.message, code: err.code });
    return;
  }
  console.error("[LostFound] Error inesperado:", err instanceof Error ? err.message : err);
  res.status(500).json({ error: "No se pudo procesar la solicitud." });
}

router.post("/api/lost-found", async (req: Request, res: Response) => {
  const sessionUser = await getUserFromRequest(req).catch(() => null);
  if (!sessionUser) {
    res.status(401).json({ error: "No autenticado." });
    return;
  }

  upload.single("photo")(req, res, async (multerErr: unknown) => {
    if (multerErr) {
      res.status(400).json({ error: "Archivo no válido (formato o tamaño)." });
      return;
    }
    try {
      const body = req.body as Record<string, string>;
      const venueId = Number(body.venueId);
      const communityIdRaw = body.communityId ? Number(body.communityId) : null;
      const lostDate = String(body.lostDate ?? "");
      const approximateTime = body.approximateTime ? String(body.approximateTime) : null;
      const description = String(body.description ?? "");

      if (!Number.isInteger(venueId) || venueId <= 0) {
        res.status(400).json({ error: "Venue no válido." });
        return;
      }
      const [venueRow] = await _db.select({ id: venues.id, name: venues.name }).from(venues).where(eq(venues.id, venueId)).limit(1);
      if (!venueRow) {
        res.status(404).json({ error: "Venue no encontrado." });
        return;
      }

      // La comunidad, si se envía, debe ser una membresía REAL del propio
      // Student — nunca un id manipulado libremente desde el cliente (spec
      // §15/§25, mismo criterio multi-comunidad que el resto del proyecto).
      let communityId: number | null = null;
      if (communityIdRaw !== null) {
        if (!Number.isInteger(communityIdRaw) || communityIdRaw <= 0) {
          res.status(400).json({ error: "Comunidad no válida." });
          return;
        }
        const [membership] = await _db.select({ id: userCommunities.id }).from(userCommunities)
          .where(and(eq(userCommunities.userId, sessionUser.id), eq(userCommunities.communityId, communityIdRaw))).limit(1);
        if (!membership) {
          res.status(403).json({ error: "No perteneces a esa comunidad." });
          return;
        }
        communityId = communityIdRaw;
      }

      const report = await createLostFoundReport({
        studentUserId: sessionUser.id,
        venueId,
        communityId,
        lostDate,
        approximateTime,
        description,
        imageStorageKey: null,
        venueName: venueRow.name,
      });

      const file = (req as Request & { file?: Express.Multer.File }).file;
      let photoWarning: string | undefined;
      if (file) {
        try {
          const normalized = await validateAndNormalizeLostFoundImage(file.buffer, file.mimetype);
          const key = await storeLostFoundPhoto(report.id, normalized);
          await _db.update(lostFoundReports).set({ imageStorageKey: key }).where(eq(lostFoundReports.id, report.id));
          report.imageStorageKey = key;
        } catch (photoErr) {
          // La foto es OPCIONAL (spec §2/§4) — un fallo de imagen NUNCA
          // deshace el caso ya creado (misma tolerancia que replaceMyPhoto
          // en MG-03, aplicada al revés: el dato principal ya está seguro).
          if (photoErr instanceof LostFoundPhotoValidationError) {
            photoWarning = photoErr.message;
          } else {
            console.error("[LostFound] No se pudo procesar la foto adjunta:", photoErr instanceof Error ? photoErr.message : photoErr);
            photoWarning = "No se pudo procesar la foto adjunta.";
          }
        }
      }

      res.status(201).json({ success: true, report, photoWarning });
    } catch (err) {
      mapLostFoundError(err, res);
    }
  });
});

router.get("/api/lost-found/:id/photo", async (req: Request, res: Response) => {
  const sessionUser = await getUserFromRequest(req).catch(() => null);
  if (!sessionUser) {
    res.status(401).json({ error: "No autenticado." });
    return;
  }
  const reportId = Number(req.params.id);
  if (!Number.isInteger(reportId) || reportId <= 0) {
    res.status(400).json({ error: "Identificador no válido." });
    return;
  }

  const [reportRow] = await _db.select().from(lostFoundReports).where(eq(lostFoundReports.id, reportId)).limit(1);
  if (!reportRow) {
    res.status(404).json({ error: "No encontrado." });
    return;
  }

  const isOwner = sessionUser.id === reportRow.studentUserId;
  if (!isOwner) {
    const isGlobalAdmin = await checkRbacOrLegacy(sessionUser.id, sessionUser.role as string, "lost_found.manage", ["admin"]);
    if (!isGlobalAdmin) {
      const access = await getVenueStaffAccess(sessionUser.id, sessionUser.role as string, undefined, "lost_found.manage");
      if (!venueAccessAllows(access, reportRow.venueId)) {
        res.status(403).json({ error: "No autorizado." });
        return;
      }
    }
  }

  if (!reportRow.imageStorageKey) {
    res.status(404).json({ error: "Sin fotografía." });
    return;
  }
  const bytes = await getLostFoundPhotoBytes(reportRow.imageStorageKey);
  if (!bytes) {
    res.status(404).json({ error: "Sin fotografía." });
    return;
  }
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.status(200).send(bytes);
});

export default router;
