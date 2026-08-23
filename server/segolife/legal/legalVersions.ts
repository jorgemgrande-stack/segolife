/**
 * Versión vigente de cada documento legal — DEBE coincidir exactamente con
 * client/src/lib/legalIdentity.ts (LEGAL_DOCUMENT_VERSIONS.terms/privacy).
 * Es la cadena que se persiste en legal_acceptances.document_version al
 * aceptar en el registro (server/segolife/students/registrationService.ts).
 * Al publicar un cambio material en /terminos o /privacidad, incrementar
 * aquí Y en el cliente a la vez (p. ej. terminos_v2_2026-09-10).
 */
export const LEGAL_DOCUMENT_VERSIONS = {
  terms: "terminos_v1_2026-08-23",
  privacy: "privacidad_v1_2026-08-23",
} as const;
