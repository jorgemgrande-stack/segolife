/**
 * Identidad societaria real usada en las 5 páginas legales de SEGOLIFE.
 * Auditada en el repo (scripts/apply-legal-identity-hayque-capital.cjs,
 * TerminosCondiciones.tsx original) — nunca inventada. `registryPending`
 * queda como placeholder porque los datos de inscripción en el Registro
 * Mercantil no existen en ningún sitio del repositorio (ver
 * LEGAL_REVIEW_REQUIRED.md).
 */
export const LEGAL_ENTITY = {
  name: "HAYQUE CAPITAL, S.L.",
  cif: "B13989264",
  address: "Finca Lindaraja, s/n · 40420 Segovia, España",
  website: "www.segolife.es",
  contactEmail: "soporte@segolife.es",
  registryPending: true,
} as const;

/** Versión interna de cada documento — el backend guarda esta misma cadena en `legal_acceptances.document_version` al aceptar en el registro. */
export const LEGAL_DOCUMENT_VERSIONS = {
  legalNotice: "aviso_legal_v1_2026-08-23",
  terms: "terminos_v1_2026-08-23",
  privacy: "privacidad_v1_2026-08-23",
  cookies: "cookies_v1_2026-08-23",
  refunds: "devoluciones_v1_2026-08-23",
} as const;

export const LEGAL_LAST_UPDATED = "23 de agosto de 2026";
export const LEGAL_LAST_UPDATED_EN = "August 23, 2026";
