/**
 * Capa de dominio Segolife — namespace vacío (Fase 1).
 *
 * Estos son tipos TypeScript conceptuales, NO tablas de Drizzle ni código con
 * runtime. No hay ninguna tabla nueva en drizzle/schema.ts todavía, ningún
 * router los usa, y ningún componente los importa. Existen para fijar por
 * escrito, de forma verificable por el compilador, la forma del dominio
 * propuesto en docs/SEGOLIFE_DOMAIN_MODEL.md antes de implementarlo.
 *
 * No añadir lógica aquí. Cuando una fase futura implemente estas entidades
 * de verdad (tablas Drizzle + routers), este fichero se sustituye o se borra.
 */

/** Institución académica real (IE University, Universidad de Valladolid...). */
export interface University {
  id: number;
  name: string;
  slug: string;
  emailDomain: string | null;
  country: string;
}

/**
 * Unidad de tenant real de Segolife (SEGOLIFE IE, SEGOLIFE UVA, futuros campus).
 * Todo el contenido, eventos y promociones se ancla a esto — nunca a un
 * literal "ie"/"uva" en código de negocio.
 */
export interface Community {
  id: number;
  name: string;
  slug: string;
  defaultLocale: SupportedLocale;
  status: "active" | "inactive" | "onboarding";
}

/**
 * Fila puente: universidad(es) asociadas a una comunidad — M2M, no una FK
 * directa en Community. Una comunidad puede tener 0, 1 o varias
 * universidades (y viceversa).
 */
export interface CommunityUniversityLink {
  communityId: number;
  universityId: number;
}

export type SupportedLocale = "en" | "es";

/** Fila puente: a qué comunidad(es) pertenece un usuario. */
export interface UserCommunityMembership {
  userId: number;
  communityId: number;
  roleInCommunity: string | null;
  joinedAt: Date;
}

/** Negocio (discoteca, coctelería, restaurante...). Reemplaza hotel/spa/restaurants. */
export interface Venue {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  status: "active" | "inactive";
}

/** Fila puente: a qué comunidad(es) está disponible un venue. */
export interface VenueCommunityLink {
  venueId: number;
  communityId: number;
}

/** Evento concreto en un venue. Reemplaza el hub de "experiences". */
export interface Event {
  id: number;
  venueId: number;
  name: string;
  slug: string;
  startsAt: Date;
  endsAt: Date | null;
  capacity: number | null;
}

/** Fila puente: a qué comunidad(es) está disponible un evento (exclusividad). */
export interface EventCommunityLink {
  eventId: number;
  communityId: number;
}

/**
 * Entidades futuras — SOLO firma conceptual, para verificar que el dominio de
 * arriba no las bloquea. No se implementan en esta fase (ver
 * docs/SEGOLIFE_ROADMAP.md, Fases 2 a 5). No instanciar, no importar en
 * código real todavía.
 */
export namespace Future {
  export interface Attendance {
    userId: number;
    eventId: number | null;
    venueId: number;
    checkedInAt: Date;
  }

  export interface TokenWallet {
    userId: number;
    balance: number;
  }

  export interface TokenLedgerEntry {
    id: number;
    userId: number;
    delta: number;
    reason: string;
    refType: "attendance" | "campaign" | "qr_redemption";
    refId: number;
  }

  export interface Campaign {
    id: number;
    communityId: number | null;
    venueId: number | null;
    multiplier: number;
    startsAt: Date;
    endsAt: Date;
  }

  export interface Benefit {
    id: number;
    issuingVenueId: number | null;
    title: string;
  }

  export interface QrRedemption {
    id: number;
    userId: number;
    venueId: number;
    benefitId: number | null;
    validatedByStaffId: number | null;
    redeemedAt: Date;
  }

  export interface ExternalTicketingLink {
    eventId: number;
    provider: "fourvenues";
    externalEventId: string;
    syncStatus: "pending" | "synced" | "error";
  }
}
