/**
 * communityRespondentPhotoRoutes.ts — foto de un estudiante que respondió a
 * una propuesta COMUNITY, visible para SUS COMPAÑEROS de audiencia (petición
 * del cliente, "avatar-stack estilo Instagram", 2026-08-22 — decisión de
 * producto explícita: ampliar deliberadamente la visibilidad de la foto más
 * allá de self/admin, confirmada por el cliente tras plantearle el trade-off).
 *
 * NUNCA se toca /api/students/:userId/photo (studentPhotoRoutes.ts) — esa
 * ruta sigue siendo self/admin-only (spec §10, decisión de seguridad previa
 * intacta). Esta es una ruta NUEVA y DELIBERADAMENTE más estrecha: solo
 * sirve la foto de userId si (a) quien pide está autenticado, (b) quien pide
 * pertenece a la MISMA audiencia snapshoteada de esa propuesta
 * (isInProposalAudience — mismo criterio que community.myActive/
 * getRespondents), (c) los resultados de esa propuesta son visibles ahora
 * mismo (computeResultsVisible, misma política que getPublicById), y (d)
 * userId realmente respondió a ESA propuesta (isProposalRespondent) O ES SU
 * AUTOR (resolveProposalAuthor — COM-02, Social Results: el autor de una
 * idea convertida no necesariamente votó su propia propuesta ya cerrada,
 * pero su foto en la cabecera social es un objetivo legítimo igual). Nunca
 * se sirve la foto de alguien que ni participó ni es el autor, aunque
 * comparta audiencia. Revalida las condiciones en CADA petición, nunca
 * cachea la autorización.
 */
import { Router, Request, Response } from "express";
import { getUserFromRequest } from "../../localAuth";
import { getMyPhotoBytes } from "../students/studentPhotoService";
import { getProposalById, isInProposalAudience, computeResultsVisible } from "./communityDb";
import { getUserResponse } from "./communityResponseService";
import { isProposalRespondent } from "./communityResultsService";
import { resolveProposalAuthor } from "./communitySocialDb";

const router = Router();

router.get("/api/community/proposals/:proposalId/respondents/:userId/photo", async (req: Request, res: Response) => {
  const sessionUser = await getUserFromRequest(req).catch(() => null);
  if (!sessionUser) {
    res.status(401).json({ error: "No autenticado." });
    return;
  }

  const proposalId = Number(req.params.proposalId);
  const targetUserId = Number(req.params.userId);
  if (!Number.isInteger(proposalId) || proposalId <= 0 || !Number.isInteger(targetUserId) || targetUserId <= 0) {
    res.status(400).json({ error: "Identificador no válido." });
    return;
  }

  const proposal = await getProposalById(proposalId);
  if (!proposal) {
    res.status(404).json({ error: "Propuesta no encontrada." });
    return;
  }

  const inAudience = await isInProposalAudience(proposalId, sessionUser.id);
  if (!inAudience) {
    res.status(403).json({ error: "No autorizado." });
    return;
  }

  const myResponse = await getUserResponse(proposalId, sessionUser.id);
  const showResults = computeResultsVisible(proposal, !!myResponse, new Date());
  if (!showResults) {
    res.status(403).json({ error: "No autorizado." });
    return;
  }

  // COM-02 — el autor de una propuesta (idea de Student convertida, ver
  // resolveProposalAuthor) no necesariamente respondió/votó su propia
  // propuesta ya cerrada — su foto en la cabecera social también es un
  // objetivo legítimo de esta ruta, no solo un respondiente.
  const targetResponded = await isProposalRespondent(proposalId, targetUserId);
  const author = targetResponded ? null : await resolveProposalAuthor(proposal);
  const targetIsAuthor = author?.userId === targetUserId;
  if (!targetResponded && !targetIsAuthor) {
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
