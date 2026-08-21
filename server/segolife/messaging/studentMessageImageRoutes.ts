/**
 * studentMessageImageRoutes.ts — COM-01, imagen adjunta en el chat
 * Admin→Student. Dos rutas REST (no tRPC — multipart/form-data de entrada
 * y bytes binarios de salida no encajan bien en JSON-RPC, mismo criterio
 * que lostFoundReportRoutes.ts/studentPhotoRoutes.ts):
 *
 *  POST /api/student-messages/:conversationId/admin-reply — responde en la
 *       conversación (texto y/o imagen, al menos uno de los dos), imagen
 *       OPCIONAL en la misma petición. Admin-only (student_messages.manage,
 *       mismo permiso que el resto de COM-01 — nunca un segundo criterio).
 *  GET  /api/student-messages/messages/:messageId/image — servida
 *       autenticada. Autoriza SOLO el Student dueño de la conversación o un
 *       Admin con student_messages.view.
 */
import { Router, Request, Response } from "express";
import multer from "multer";
import { getUserFromRequest } from "../../localAuth";
import { replyAsAdmin, getMessageConversationId, StudentMessagesError } from "./studentMessagesDb";
import {
  validateAndNormalizeChatImage, storeChatImage, getChatImageBytes,
  ChatImageValidationError, MAX_UPLOAD_BYTES,
} from "./chatImageService";
import { checkRbacOrLegacy } from "../../_core/rbac";
import { notifyStudentNewMessage } from "../../routers/studentMessages";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    // Filtro barato por Content-Type declarado — la validación REAL vive en chatImageService.ts.
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    cb(null, allowed.includes(file.mimetype));
  },
});

function mapError(err: unknown, res: Response): void {
  if (err instanceof StudentMessagesError) {
    const status = err.code === "NOT_FOUND" ? 404 : err.code === "CONVERSATION_CLOSED" ? 409 : 400;
    res.status(status).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof ChatImageValidationError) {
    res.status(400).json({ error: err.message, code: err.code });
    return;
  }
  console.error("[ChatImage] Error inesperado:", err instanceof Error ? err.message : err);
  res.status(500).json({ error: "No se pudo procesar la solicitud." });
}

router.post("/api/student-messages/:conversationId/admin-reply", async (req: Request, res: Response) => {
  const sessionUser = await getUserFromRequest(req).catch(() => null);
  if (!sessionUser) {
    res.status(401).json({ error: "No autenticado." });
    return;
  }
  const isAdmin = await checkRbacOrLegacy(sessionUser.id, sessionUser.role as string, "student_messages.manage", ["admin"]);
  if (!isAdmin) {
    res.status(403).json({ error: "No autorizado." });
    return;
  }

  upload.single("image")(req, res, async (multerErr: unknown) => {
    if (multerErr) {
      res.status(400).json({ error: "Archivo no válido (formato o tamaño)." });
      return;
    }
    try {
      const conversationId = Number(req.params.conversationId);
      if (!Number.isInteger(conversationId) || conversationId <= 0) {
        res.status(400).json({ error: "Conversación no válida." });
        return;
      }
      const body = req.body as Record<string, string>;
      const text = typeof body.body === "string" ? body.body : "";
      const visibility = body.visibility === "internal" ? "internal" : "public";
      const file = (req as Request & { file?: Express.Multer.File }).file;

      let imageStorageKey: string | null = null;
      if (file) {
        const normalized = await validateAndNormalizeChatImage(file.buffer, file.mimetype);
        imageStorageKey = await storeChatImage(conversationId, normalized);
      }

      const result = await replyAsAdmin({
        conversationId,
        adminUserId: sessionUser.id,
        body: text,
        visibility,
        imageStorageKey,
      });

      if (visibility === "public") {
        await notifyStudentNewMessage(result.conversation.studentUserId, result.conversation.id, result.conversation.subject).catch(err => {
          console.error("[ChatImage] No se pudo notificar al Student:", err instanceof Error ? err.message : err);
        });
      }

      res.status(201).json({ success: true, message: result.message });
    } catch (err) {
      mapError(err, res);
    }
  });
});

router.get("/api/student-messages/messages/:messageId/image", async (req: Request, res: Response) => {
  const sessionUser = await getUserFromRequest(req).catch(() => null);
  if (!sessionUser) {
    res.status(401).json({ error: "No autenticado." });
    return;
  }
  const messageId = Number(req.params.messageId);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    res.status(400).json({ error: "Identificador no válido." });
    return;
  }

  const info = await getMessageConversationId(messageId);
  if (!info) {
    res.status(404).json({ error: "No encontrado." });
    return;
  }

  const isOwner = sessionUser.id === info.studentUserId;
  if (!isOwner) {
    const isAdmin = await checkRbacOrLegacy(sessionUser.id, sessionUser.role as string, "student_messages.view", ["admin"]);
    if (!isAdmin) {
      res.status(403).json({ error: "No autorizado." });
      return;
    }
  }

  if (!info.imageStorageKey) {
    res.status(404).json({ error: "Sin imagen." });
    return;
  }
  const bytes = await getChatImageBytes(info.imageStorageKey);
  if (!bytes) {
    res.status(404).json({ error: "Sin imagen." });
    return;
  }
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.status(200).send(bytes);
});

export default router;
