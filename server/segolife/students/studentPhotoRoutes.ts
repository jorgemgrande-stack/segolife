/**
 * studentPhotoRoutes.ts — SEGOLIFE MG-03. Dos rutas REST (no tRPC, por lo
 * mismo que server/uploadRoutes.ts: multipart/form-data de entrada y bytes
 * binarios de salida no son un buen encaje para JSON-RPC):
 *
 *  POST /api/students/me/photo   — subida/reemplazo, SIEMPRE self-service
 *                                   (nunca un userId del cliente — ver
 *                                   getUserFromRequest, mismo patrón que
 *                                   requireAdmin en uploadRoutes.ts).
 *  GET  /api/students/:userId/photo — servido autenticado. Autoriza SOLO
 *                                   dueño o admin (spec §10: "no crees un
 *                                   endpoint GET /student/:id/photo
 *                                   públicamente explotable" — este NUNCA
 *                                   es público, exige sesión real y, si no
 *                                   es la propia, exige role=admin). El
 *                                   acceso operativo de Venue/staff NO pasa
 *                                   por aquí — va embebido como data URI en
 *                                   la MISMA respuesta ya autorizada de
 *                                   venueApp.studentCard (ver
 *                                   venueAppService.ts), sin superficie de
 *                                   IDOR nueva.
 *
 * Eliminar foto es una mutación tRPC (students.removeMyPhoto) — no necesita
 * multipart/bytes, así que sigue el patrón normal del resto del router de
 * students en vez de vivir aquí.
 */
import { Router, Request, Response } from "express";
import multer from "multer";
import { getUserFromRequest } from "../../localAuth";
import { replaceMyPhoto, getMyPhotoBytes, StudentPhotoValidationError, MAX_UPLOAD_BYTES } from "./studentPhotoService";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    // Primer filtro barato por Content-Type declarado — la validación REAL
    // (sharp() decodificando de verdad los bytes) vive en
    // studentPhotoService.ts::validateAndNormalizeImage, esto es solo para
    // no ni siquiera bufferizar en memoria algo obviamente no-imagen.
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    cb(null, allowed.includes(file.mimetype));
  },
});

router.post("/api/students/me/photo", async (req: Request, res: Response) => {
  const sessionUser = await getUserFromRequest(req).catch(() => null);
  if (!sessionUser) {
    res.status(401).json({ error: "No autenticado." });
    return;
  }

  upload.single("photo")(req, res, async (multerErr: unknown) => {
    if (multerErr) {
      // multer's own size/fileFilter rejection — nunca detalle interno de infraestructura en el mensaje.
      res.status(400).json({ error: "Archivo no válido (formato o tamaño)." });
      return;
    }
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: "No se recibió ningún archivo." });
      return;
    }
    try {
      const { url } = await replaceMyPhoto(sessionUser.id, file.buffer, file.mimetype);
      res.status(200).json({ success: true, url });
    } catch (err) {
      if (err instanceof StudentPhotoValidationError) {
        res.status(400).json({ error: err.message, code: err.code });
        return;
      }
      console.error("[StudentPhoto] Error al procesar la subida:", err instanceof Error ? err.message : err);
      res.status(500).json({ error: "No se pudo procesar la imagen." });
    }
  });
});

router.get("/api/students/:userId/photo", async (req: Request, res: Response) => {
  const sessionUser = await getUserFromRequest(req).catch(() => null);
  if (!sessionUser) {
    res.status(401).json({ error: "No autenticado." });
    return;
  }
  const targetUserId = Number(req.params.userId);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    res.status(400).json({ error: "Identificador no válido." });
    return;
  }
  const isSelf = sessionUser.id === targetUserId;
  const isAdmin = sessionUser.role === "admin";
  if (!isSelf && !isAdmin) {
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
