/**
 * communityProposalImageRoutes.ts — MG-04. Una ruta REST (multipart), mismo
 * motivo que studentPhotoRoutes.ts: multipart/form-data de entrada no es un
 * buen encaje para JSON-RPC. Self-service SIEMPRE — el userId viene de la
 * sesión real (getUserFromRequest), nunca de un campo que el cliente pueda
 * manipular; el llamador (ComunityHub.tsx) sube la imagen ANTES de enviar
 * el formulario y solo envía la URL ya subida en `submitProposal`.
 */
import { Router, Request, Response } from "express";
import multer from "multer";
import { getUserFromRequest } from "../../localAuth";
import { uploadProposalCoverImage, ProposalImageValidationError, MAX_UPLOAD_BYTES } from "./communityProposalImageService";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    cb(null, allowed.includes(file.mimetype));
  },
});

router.post("/api/community/proposal-image", async (req: Request, res: Response) => {
  const sessionUser = await getUserFromRequest(req).catch(() => null);
  if (!sessionUser) {
    res.status(401).json({ error: "No autenticado." });
    return;
  }

  upload.single("image")(req, res, async (multerErr: unknown) => {
    if (multerErr) {
      res.status(400).json({ error: "Archivo no válido (formato o tamaño)." });
      return;
    }
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: "No se recibió ningún archivo." });
      return;
    }
    try {
      const { url } = await uploadProposalCoverImage(sessionUser.id, file.buffer, file.mimetype);
      res.status(200).json({ success: true, url });
    } catch (err) {
      if (err instanceof ProposalImageValidationError) {
        res.status(400).json({ error: err.message, code: err.code });
        return;
      }
      console.error("[CommunityProposalImage] Error al procesar la subida:", err instanceof Error ? err.message : err);
      res.status(500).json({ error: "No se pudo procesar la imagen." });
    }
  });
});

export default router;
