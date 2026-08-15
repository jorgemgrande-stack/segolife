import {
  bigint,
  boolean,
  date,
  decimal,
  index,
  int,
  json,
  mediumtext,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/mysql-core";

// ─── USERS & AUTH ────────────────────────────────────────────────────────────

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  // unique (no notNull: OAuth heredado permite usuarios sin email) — añadido
  // para el registro de estudiantes (SEGOLIFE — STUDENT REGISTRATION): antes
  // de esto la unicidad de email solo se comprobaba a nivel de aplicación,
  // sin ninguna garantía real ante una carrera de dos registros simultáneos
  // con el mismo email. Verificado sin duplicados existentes en local antes
  // de añadir esta restricción (ver migración 0140).
  email: varchar("email", { length: 320 }).unique(),
  loginMethod: varchar("loginMethod", { length: 64 }),
  // "venue_admin" (SEGOLIFE — RBAC CONSOLIDATION): Administrador de Local,
  // scoped a los venues donde tenga fila real en venue_staff (nunca "todos"
  // por omisión). Necesita ser un valor real del enum (y no solo un rol RBAC
  // en rbac_user_roles) porque el login actual decide el destino post-login
  // comparando literalmente users.role (ver client/src/pages/Login.tsx,
  // homeForRole) — un venue_admin con role="user" aterrizaría en la Student
  // App por error.
  role: mysqlEnum("role", ["user", "admin", "monitor", "agente", "adminrest", "controler", "partner_admin", "partner_user", "supplier", "employee", "gestoria", "venue_admin"]).default("user").notNull(),
  partnerId: int("partnerId"),
  supplierId: int("supplierId"), // vínculo a suppliers.id para usuarios con rol "supplier" (portal de proveedor)
  phone: varchar("phone", { length: 32 }),
  avatarUrl: text("avatarUrl"),
  isActive: boolean("isActive").default(true).notNull(),
  passwordHash: text("passwordHash"),
  inviteToken: varchar("inviteToken", { length: 128 }),
  inviteTokenExpiry: timestamp("inviteTokenExpiry"),
  inviteAccepted: boolean("inviteAccepted").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── CMS: SITE SETTINGS ──────────────────────────────────────────────────────

export const siteSettings = mysqlTable("site_settings", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 128 }).notNull().unique(),
  value: text("value"),
  type: mysqlEnum("type", ["text", "json", "image", "boolean"]).default("text").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const slideshowItems = mysqlTable("slideshow_items", {
  id: int("id").autoincrement().primaryKey(),
  imageUrl: text("imageUrl").notNull(),
  badge: varchar("badge", { length: 128 }),
  title: varchar("title", { length: 256 }),
  subtitle: text("subtitle"),
  description: text("description"),
  ctaText: varchar("ctaText", { length: 128 }),
  ctaUrl: varchar("ctaUrl", { length: 512 }),
  reserveUrl: varchar("reserveUrl", { length: 512 }),
  sortOrder: int("sortOrder").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const menuItems = mysqlTable("menu_items", {
  id: int("id").autoincrement().primaryKey(),
  parentId: int("parentId"),
  label: varchar("label", { length: 128 }).notNull(),
  url: varchar("url", { length: 512 }),
  target: mysqlEnum("target", ["_self", "_blank"]).default("_self").notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  menuZone: mysqlEnum("menuZone", ["header", "footer"]).default("header").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const mediaFiles = mysqlTable("media_files", {
  id: int("id").autoincrement().primaryKey(),
  filename: varchar("filename", { length: 256 }).notNull(),
  originalName: varchar("originalName", { length: 256 }).notNull(),
  url: text("url").notNull(),
  fileKey: text("fileKey").notNull(),
  mimeType: varchar("mimeType", { length: 128 }).notNull(),
  size: int("size").notNull(),
  type: mysqlEnum("type", ["image", "video", "document"]).default("image").notNull(),
  altText: text("altText"),
  uploadedBy: int("uploadedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const staticPages = mysqlTable("static_pages", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 256 }).notNull().unique(),
  title: varchar("title", { length: 256 }).notNull(),
  content: text("content"),
  metaTitle: varchar("metaTitle", { length: 256 }),
  metaDescription: text("metaDescription"),
  isPublished: boolean("isPublished").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── LOCATIONS ───────────────────────────────────────────────────────────────

export const locations = mysqlTable("locations", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 256 }).notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  description: text("description"),
  imageUrl: text("imageUrl"),
  address: text("address"),
  latitude: decimal("latitude", { precision: 10, scale: 8 }),
  longitude: decimal("longitude", { precision: 11, scale: 8 }),
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── CATEGORIES ──────────────────────────────────────────────────────────────

export const categories = mysqlTable("categories", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 256 }).notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  description: text("description"),
  imageUrl: text("imageUrl"),
  image1: text("image1"),
  iconName: varchar("iconName", { length: 64 }),
  sortOrder: int("sortOrder").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── EXPERIENCES (PRODUCTS) ──────────────────────────────────────────────────

export const experiences = mysqlTable("experiences", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 256 }).notNull().unique(),
  title: varchar("title", { length: 256 }).notNull(),
  shortDescription: text("shortDescription"),
  description: text("description"),
  categoryId: int("categoryId").notNull(),
  locationId: int("locationId").notNull(),
  coverImageUrl: text("coverImageUrl"),
  image1: text("image1"),
  image2: text("image2"),
  image3: text("image3"),
  image4: text("image4"),
  gallery: json("gallery").$type<string[]>().default([]),
  basePrice: decimal("basePrice", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("EUR").notNull(),
  duration: varchar("duration", { length: 128 }),
  minPersons: int("minPersons").default(1),
  maxPersons: int("maxPersons"),
  difficulty: mysqlEnum("difficulty", ["facil", "moderado", "dificil", "experto"]).default("facil"),
  includes: json("includes").$type<string[]>().default([]),
  excludes: json("excludes").$type<string[]>().default([]),
  requirements: text("requirements"),
  discountPercent: decimal("discountPercent", { precision: 5, scale: 2 }),
  discountExpiresAt: timestamp("discountExpiresAt"),
  // Fiscal regime (REAV module) — "general" + taxRate sustituye a "general_21"
  fiscalRegime: mysqlEnum("fiscalRegime", ["reav", "general", "mixed"]).default("general").notNull(),
  taxRate: decimal("taxRate", { precision: 5, scale: 2 }).default("21"),
  productType: mysqlEnum("productType", ["own", "semi_own", "third_party", "actividad", "alojamiento", "restauracion", "transporte", "pack"]).default("actividad").notNull(),
  providerPercent: decimal("providerPercent", { precision: 5, scale: 2 }).default("0"),
  agencyMarginPercent: decimal("agencyMarginPercent", { precision: 5, scale: 2 }).default("0"),
  // Supplier / Liquidaciones module
  supplierId: int("supplierId"),
  supplierCommissionPercent: decimal("supplierCommissionPercent", { precision: 5, scale: 2 }).default("0.00"),
  supplierCostType: mysqlEnum("supplierCostType", ["comision_sobre_venta", "coste_fijo", "porcentaje_margen", "hibrido"]).default("comision_sobre_venta"),
  settlementFrequency: mysqlEnum("settlementFrequency", ["semanal", "quincenal", "mensual", "manual"]).default("manual"),
  isSettlable: boolean("isSettlable").default(false).notNull(),
  isFeatured: boolean("isFeatured").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  isPublished: boolean("isPublished").default(true).notNull(),
  isPresentialSale: boolean("isPresentialSale").default(false).notNull(),
  // Pricing mode (retrocompatible: default = per_person)
  pricingType: mysqlEnum("pricing_type", ["per_person", "per_unit"]).default("per_person").notNull(),
  unitCapacity: int("unit_capacity"),   // personas por unidad (solo si pricingType=per_unit)
  maxUnits: int("max_units"),           // máximo de unidades disponibles (opcional)
  // Time slots module (optional, retrocompatible)
  hasTimeSlots: boolean("has_time_slots").default(false).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  metaTitle: varchar("metaTitle", { length: 256 }),
  metaDescription: text("metaDescription"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const experienceVariants = mysqlTable("experience_variants", {
  id: int("id").autoincrement().primaryKey(),
  experienceId: int("experienceId").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  priceModifier: decimal("priceModifier", { precision: 10, scale: 2 }).default("0"),
  priceType: mysqlEnum("priceType", ["fixed", "percentage", "per_person"]).default("fixed").notNull(),
  options: json("options").$type<{ label: string; value: string; priceAdjustment: number }[]>().default([]),
  isRequired: boolean("isRequired").default(false).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── LEAD SOURCES CATALOG ────────────────────────────────────────────────────

export const crmLeadSources = mysqlTable("crm_lead_sources", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  color: varchar("color", { length: 20 }),
  icon: varchar("icon", { length: 50 }),
  sortOrder: int("sort_order").default(0),
  isActive: boolean("is_active").default(true).notNull(),
  isSystem: boolean("is_system").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type CrmLeadSource = typeof crmLeadSources.$inferSelect;
export type InsertCrmLeadSource = typeof crmLeadSources.$inferInsert;

// ─── LEADS & QUOTES ──────────────────────────────────────────────────────────

export const leads = mysqlTable("leads", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 32 }),
  company: varchar("company", { length: 256 }),
  message: text("message"),
  experienceId: int("experienceId"),
  locationId: int("locationId"),
  preferredDate: timestamp("preferredDate"),
  numberOfPersons: int("numberOfPersons"),
  budget: decimal("budget", { precision: 10, scale: 2 }),
  status: mysqlEnum("status", ["nuevo", "contactado", "en_proceso", "convertido", "perdido"]).default("nuevo").notNull(),
  // CRM fields
  opportunityStatus: mysqlEnum("opportunityStatus", ["nueva", "enviada", "ganada", "perdida"]).default("nueva").notNull(),
  priority: mysqlEnum("priority", ["baja", "media", "alta"]).default("media").notNull(),
  lastContactAt: timestamp("lastContactAt"),
  lostReason: text("lostReason"),
  seenAt: timestamp("seenAt"),
  internalNotes: json("internalNotes").$type<{ text: string; authorId: number; authorName: string; createdAt: string }[]>().default([]),
  assignedTo: int("assignedTo"),
  ghlContactId: varchar("ghlContactId", { length: 128 }),
  source: varchar("source", { length: 128 }).default("web"),
  partnerId: int("partnerId"),
  partnerUserId: int("partnerUserId"),
  selectedCategory: varchar("selectedCategory", { length: 128 }),
  selectedProduct: varchar("selectedProduct", { length: 256 }),
  activitiesJson: json("activitiesJson").$type<{
    experienceId: number;
    experienceTitle: string;
    family: string;
    participants: number;
    details: Record<string, string | number>;
  }[]>(),
  numberOfAdults: int("numberOfAdults"),
  numberOfChildren: int("numberOfChildren"),
  cartMetadata: json("cart_metadata").$type<{
    merchantOrder: string;
    items: { productId: number; productName: string; people: number; amountCents: number; bookingDate: string }[];
    totalAmountCents: number;
    checkoutAt: string;
  } | null>(),
  leadSourceId: int("lead_source_id"),
  preferredTime: varchar("preferred_time", { length: 10 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── PROPOSALS (Propuestas Comerciales) ───────────────────────────────────────
export const proposals = mysqlTable("proposals", {
  id: int("id").autoincrement().primaryKey(),
  proposalNumber: varchar("proposalNumber", { length: 32 }).notNull().unique(),
  leadId: int("leadId").notNull(),
  agentId: int("agentId").notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  description: text("description"),
  mode: mysqlEnum("mode", ["configurable", "multi_option"]).default("configurable").notNull(),
  // For "configurable" mode — same shape as quotes.items
  items: json("items").$type<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
    fiscalRegime?: "reav" | "general";
    taxRate?: number;
    isOptional?: boolean;
    productId?: number;
  }[]>().default([]),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull().default("0"),
  discount: decimal("discount", { precision: 10, scale: 2 }).default("0"),
  tax: decimal("tax", { precision: 10, scale: 2 }).default("0"),
  total: decimal("total", { precision: 10, scale: 2 }).notNull().default("0"),
  currency: varchar("currency", { length: 8 }).default("EUR").notNull(),
  status: mysqlEnum("status", [
    "borrador",
    "enviado",
    "visualizado",
    "aceptado",
    "rechazado",
    "expirado",
  ]).default("borrador").notNull(),
  token: varchar("token", { length: 128 }).unique(),
  publicUrl: text("publicUrl"),
  validUntil: timestamp("validUntil"),
  conditions: text("conditions"),
  notes: text("notes"),
  sentAt: timestamp("sentAt"),
  viewedAt: timestamp("viewedAt"),
  acceptedAt: timestamp("acceptedAt"),
  // Which multi_option was selected by the client
  selectedOptionId: int("selectedOptionId"),
  // If proposal was converted to a quote
  convertedToQuoteId: int("convertedToQuoteId"),
  ghlOpportunityId: varchar("ghlOpportunityId", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Proposal = typeof proposals.$inferSelect;
export type InsertProposal = typeof proposals.$inferInsert;

// Options for multi_option proposals — each option is a full alternative
export const proposalOptions = mysqlTable("proposal_options", {
  id: int("id").autoincrement().primaryKey(),
  proposalId: int("proposalId").notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  description: text("description"),
  items: json("items").$type<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
    fiscalRegime?: "reav" | "general";
    taxRate?: number;
    productId?: number;
  }[]>().default([]),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull().default("0"),
  discount: decimal("discount", { precision: 10, scale: 2 }).default("0"),
  tax: decimal("tax", { precision: 10, scale: 2 }).default("0"),
  total: decimal("total", { precision: 10, scale: 2 }).notNull().default("0"),
  isRecommended: boolean("isRecommended").default(false).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ProposalOption = typeof proposalOptions.$inferSelect;
export type InsertProposalOption = typeof proposalOptions.$inferInsert;

export const quotes = mysqlTable("quotes", {
  id: int("id").autoincrement().primaryKey(),
  quoteNumber: varchar("quoteNumber", { length: 32 }).notNull().unique(),
  leadId: int("leadId").notNull(),
  agentId: int("agentId").notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  description: text("description"),
  items: json("items").$type<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
    fiscalRegime?: "reav" | "general";
    taxRate?: number;
    productId?: number;
  }[]>().default([]),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  discount: decimal("discount", { precision: 10, scale: 2 }).default("0"),
  tax: decimal("tax", { precision: 10, scale: 2 }).default("0"),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("EUR").notNull(),
  validUntil: timestamp("validUntil"),
  activityDate: varchar("activity_date", { length: 20 }),
  status: mysqlEnum("status", [
    "borrador",
    "enviado",
    "visualizado",
    "aceptado",
    "convertido_carrito",
    "pago_fallido",
    "pagado",
    "convertido_reserva",
    "facturado",
    "rechazado",
    "expirado",
    "perdido",
  ]).default("borrador").notNull(),
  // Plan de pagos fraccionado (null = pago total clásico, sin cambios en el flujo)
  paymentPlanId: int("payment_plan_id"),
  // CRM fields
  sentAt: timestamp("sentAt"),
  viewedAt: timestamp("viewedAt"),
  acceptedAt: timestamp("acceptedAt"),
  conditions: text("conditions"),
  redsysOrderId: varchar("redsysOrderId", { length: 32 }),
  invoiceNumber: varchar("invoiceNumber", { length: 32 }),
  invoicePdfUrl: text("invoicePdfUrl"),
  invoiceGeneratedAt: timestamp("invoiceGeneratedAt"),
  // Justificante de pago por transferencia bancaria
  transferProofUrl: text("transfer_proof_url"),
  transferProofKey: text("transfer_proof_key"),
  transferConfirmedAt: timestamp("transfer_confirmed_at"),
  transferConfirmedBy: varchar("transfer_confirmed_by", { length: 255 }),
  paymentMethod: mysqlEnum("payment_method", ["redsys", "transferencia", "efectivo", "otro", "tarjeta_fisica", "tarjeta_redsys"]),
  paymentLinkToken: varchar("paymentLinkToken", { length: 128 }).unique(),
  paymentLinkUrl: text("paymentLinkUrl"),
  paidAt: timestamp("paidAt"),
  notes: text("notes"),
  isAutoGenerated: boolean("isAutoGenerated").default(false).notNull(),
  reminderCount: int("reminderCount").default(0),
  lastReminderAt: timestamp("lastReminderAt"),
  ghlOpportunityId: varchar("ghlOpportunityId", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── CRM ACTIVITY LOG ─────────────────────────────────────────────────────────
export const crmActivityLog = mysqlTable("crm_activity_log", {
  id: int("id").autoincrement().primaryKey(),
  entityType: mysqlEnum("entityType", ["lead", "quote", "reservation", "invoice"]).notNull(),
  entityId: int("entityId").notNull(),
  action: varchar("action", { length: 128 }).notNull(),
  actorId: int("actorId"),
  actorName: varchar("actorName", { length: 256 }),
  details: json("details").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CrmActivityLog = typeof crmActivityLog.$inferSelect;
export type InsertCrmActivityLog = typeof crmActivityLog.$inferInsert;

// ─── INVOICES ─────────────────────────────────────────────────────────────────
export const invoices = mysqlTable("invoices", {
  id: int("id").autoincrement().primaryKey(),
  invoiceNumber: varchar("invoiceNumber", { length: 32 }).notNull().unique(),
  quoteId: int("quoteId"),
  reservationId: int("reservationId"),
  clientName: varchar("clientName", { length: 256 }).notNull(),
  clientEmail: varchar("clientEmail", { length: 320 }).notNull(),
  clientPhone: varchar("clientPhone", { length: 32 }),
  clientNif: varchar("clientNif", { length: 32 }),
  clientAddress: text("clientAddress"),
  itemsJson: json("itemsJson").$type<{ description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general"; taxRate?: number; productId?: number }[]>().default([]),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  discount: decimal("discount", { precision: 10, scale: 2 }).default("0.00").notNull(),
  discountReason: varchar("discount_reason", { length: 255 }),
  taxRate: decimal("taxRate", { precision: 5, scale: 2 }).default("21"),
  taxAmount: decimal("taxAmount", { precision: 10, scale: 2 }).default("0"),
  taxBreakdown: json("taxBreakdown").$type<{ rate: number; base: number; amount: number }[]>(),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("EUR").notNull(),
  pdfUrl: text("pdfUrl"),
  pdfKey: text("pdfKey"),
  status: mysqlEnum("status", ["generada", "enviada", "cobrada", "anulada", "abonada"]).default("generada").notNull(),
  invoiceType: mysqlEnum("invoiceType", ["factura", "abono"]).default("factura").notNull(),
  // Payment traceability
  paymentMethod: mysqlEnum("paymentMethod", ["redsys", "transferencia", "efectivo", "otro", "tarjeta_fisica", "tarjeta_redsys"]).default("redsys"),
  paymentValidatedBy: int("paymentValidatedBy"),   // userId who validated manual payment
  paymentValidatedAt: timestamp("paymentValidatedAt"),
  transferProofUrl: text("transferProofUrl"),       // S3 URL of bank transfer proof
  transferProofKey: text("transferProofKey"),
  isAutomatic: boolean("isAutomatic").default(true).notNull(), // true = Redsys, false = manual
  // Credit note (abono) fields
  creditNoteForId: int("creditNoteForId"),          // FK to original invoice if this is a credit note
  creditNoteReason: text("creditNoteReason"),
  // Email tracking
  sentAt: timestamp("sentAt"),
  lastSentAt: timestamp("lastSentAt"),
  sentCount: int("sentCount").default(0).notNull(),
  issuedAt: timestamp("issuedAt").defaultNow().notNull(),
  // Partner billing
  partnerId: int("partnerId"),
  partnerBillingBatchId: int("partnerBillingBatchId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = typeof invoices.$inferInsert;

// ─── BOOKINGS & CALENDAR ─────────────────────────────────────────────────────

export const bookings = mysqlTable("bookings", {
  id: int("id").autoincrement().primaryKey(),
  bookingNumber: varchar("bookingNumber", { length: 32 }).notNull().unique(),
  experienceId: int("experienceId").notNull(),
  quoteId: int("quoteId"),
  clientName: varchar("clientName", { length: 256 }).notNull(),
  clientEmail: varchar("clientEmail", { length: 320 }).notNull(),
  clientPhone: varchar("clientPhone", { length: 32 }),
  scheduledDate: timestamp("scheduledDate").notNull(),
  endDate: timestamp("endDate"),
  numberOfPersons: int("numberOfPersons").notNull(),
  totalAmount: decimal("totalAmount", { precision: 10, scale: 2 }).notNull(),
  status: mysqlEnum("status", ["pendiente", "confirmado", "en_curso", "completado", "cancelado"]).default("pendiente").notNull(),
  notes: text("notes"),
  internalNotes: text("internalNotes"),
  // Link to source reservation (when auto-created from a paid reservation)
  reservationId: int("reservationId"),
  sourceChannel: mysqlEnum("sourceChannel", ["manual", "redsys", "transferencia", "efectivo", "otro"]).default("manual"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const bookingMonitors = mysqlTable("booking_monitors", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(),
  monitorId: int("monitorId").notNull(),
  role: varchar("role", { length: 128 }).default("monitor"),
  notifiedAt: timestamp("notifiedAt"),
  confirmedAt: timestamp("confirmedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const dailyOrders = mysqlTable("daily_orders", {
  id: int("id").autoincrement().primaryKey(),
  date: timestamp("date").notNull(),
  bookingId: int("bookingId").notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  description: text("description"),
  meetingPoint: text("meetingPoint"),
  equipment: json("equipment").$type<string[]>().default([]),
  specialInstructions: text("specialInstructions"),
  status: mysqlEnum("status", ["borrador", "publicado", "completado"]).default("borrador").notNull(),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── TRANSACTIONS & ACCOUNTING ───────────────────────────────────────────────

export const transactions = mysqlTable("transactions", {
  id: int("id").autoincrement().primaryKey(),
  transactionNumber: varchar("transactionNumber", { length: 32 }).notNull().unique(),
  bookingId: int("bookingId"),
  quoteId: int("quoteId"),
  type: mysqlEnum("type", ["ingreso", "reembolso", "comision", "gasto"]).default("ingreso").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("EUR").notNull(),
  paymentMethod: mysqlEnum("paymentMethod", ["tarjeta", "transferencia", "efectivo", "link_pago", "otro", "tarjeta_fisica", "tarjeta_redsys"]).default("tarjeta"),
  status: mysqlEnum("status", ["pendiente", "completado", "fallido", "reembolsado"]).default("pendiente").notNull(),
  description: text("description"),
  externalRef: varchar("externalRef", { length: 256 }),
  processedAt: timestamp("processedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  // Libro maestro ampliado
  clientName:      varchar("clientName",      { length: 200 }),
  clientEmail:     varchar("clientEmail",     { length: 200 }),
  clientPhone:     varchar("clientPhone",     { length: 50 }),
  productName:     varchar("productName",     { length: 300 }),
  operativeCenter: varchar("operativeCenter", { length: 100 }),
  sellerUserId:    int("sellerUserId"),
  sellerName:      varchar("sellerName",      { length: 200 }),
  saleChannel:     mysqlEnum("saleChannel", ["tpv", "online", "crm", "admin", "delegado"]).default("admin"),
  taxBase:         decimal("taxBase",         { precision: 10, scale: 2 }).default("0"),
  taxAmount:       decimal("taxAmount",       { precision: 10, scale: 2 }).default("0"),
  taxRate:         decimal("taxRate_tx",      { precision: 5,  scale: 2 }).default("21"),
  reavMargin:      decimal("reavMargin",      { precision: 10, scale: 2 }).default("0"),
  fiscalRegime:    mysqlEnum("fiscalRegime_tx", ["reav", "general", "mixed"]).default("general"),
  tpvSaleId:       int("tpvSaleId"),
  reservationId:   int("reservationId_tx"),
  invoiceNumber:   varchar("invoiceNumber",   { length: 32 }),
  reservationRef:  varchar("reservationRef",  { length: 32 }),
  operationStatus: mysqlEnum("operationStatus", ["confirmada", "anulada", "reembolsada"]).default("confirmada"),
});

// ─── GHL INTEGRATION ─────────────────────────────────────────────────────────

export const ghlWebhookLogs = mysqlTable("ghl_webhook_logs", {
  id: int("id").autoincrement().primaryKey(),
  event: varchar("event", { length: 128 }).notNull(),
  payload: json("payload"),
  status: mysqlEnum("status", ["recibido", "procesado", "error"]).default("recibido").notNull(),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── GHL INBOX (WhatsApp) ─────────────────────────────────────────────────────

export const ghlConversations = mysqlTable("ghl_conversations", {
  id: int("id").autoincrement().primaryKey(),
  ghlConversationId: varchar("ghlConversationId", { length: 64 }).notNull().unique(),
  ghlContactId: varchar("ghlContactId", { length: 64 }),
  locationId: varchar("locationId", { length: 64 }),
  channel: varchar("channel", { length: 32 }).notNull().default("whatsapp"),
  customerName: varchar("customerName", { length: 255 }),
  phone: varchar("phone", { length: 32 }),
  email: varchar("email", { length: 320 }),
  lastMessagePreview: text("lastMessagePreview"),
  lastMessageAt: timestamp("lastMessageAt"),
  unreadCount: int("unreadCount").notNull().default(0),
  inbox: varchar("inbox", { length: 64 }),
  starred: boolean("starred").notNull().default(false),
  status: mysqlEnum("status", ["new", "open", "pending", "replied", "closed"]).notNull().default("new"),
  assignedUserId: int("assignedUserId"),
  linkedQuoteId: int("linkedQuoteId"),
  linkedReservationId: int("linkedReservationId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const ghlMessages = mysqlTable("ghl_messages", {
  id: int("id").autoincrement().primaryKey(),
  ghlMessageId: varchar("ghlMessageId", { length: 64 }).notNull().unique(),
  ghlConversationId: varchar("ghlConversationId", { length: 64 }).notNull(),
  direction: mysqlEnum("direction", ["inbound", "outbound"]).notNull().default("inbound"),
  messageType: varchar("messageType", { length: 32 }).default("text"),
  body: text("body"),
  attachmentsJson: json("attachmentsJson"),
  senderName: varchar("senderName", { length: 255 }),
  sentAt: timestamp("sentAt"),
  deliveryStatus: varchar("deliveryStatus", { length: 32 }),
  rawPayloadJson: json("rawPayloadJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const ghlWebhookEvents = mysqlTable("ghl_webhook_events", {
  id: int("id").autoincrement().primaryKey(),
  eventId: varchar("eventId", { length: 128 }),
  eventType: varchar("eventType", { length: 128 }).notNull(),
  ghlConversationId: varchar("ghlConversationId", { length: 64 }),
  ghlContactId: varchar("ghlContactId", { length: 64 }),
  locationId: varchar("locationId", { length: 64 }),
  rawPayloadJson: json("rawPayloadJson"),
  processedStatus: mysqlEnum("processedStatus", ["pending", "processed", "failed", "ignored"]).notNull().default("pending"),
  errorMessage: text("errorMessage"),
  receivedAt: timestamp("receivedAt").defaultNow().notNull(),
  processedAt: timestamp("processedAt"),
});

// ─── HOME MODULES ────────────────────────────────────────────────────────────
export const homeModuleItems = mysqlTable("home_module_items", {
  id: int("id").autoincrement().primaryKey(),
  moduleKey: varchar("module_key", { length: 64 }).notNull(),
  experienceId: int("experience_id").notNull(),
  sortOrder: int("sort_order").default(0).notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// ─── RESERVATIONS (Redsys) ─────────────────────────────────────────────────────────────────────────────────
export const reservations = mysqlTable("reservations", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("product_id").notNull(),
  productName: varchar("product_name", { length: 255 }).notNull(),
  bookingDate: varchar("booking_date", { length: 20 }).notNull(),
  people: int("people").default(1).notNull(),
  extrasJson: text("extras_json"),
  amountTotal: int("amount_total").notNull(),
  amountPaid: int("amount_paid").default(0),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }).default("0.00").notNull(),
  discountReason: varchar("discount_reason", { length: 255 }),
  status: mysqlEnum("status", ["draft", "pending_payment", "paid", "failed", "cancelled"]).default("draft").notNull(),
  customerName: varchar("customer_name", { length: 255 }).notNull(),
  customerEmail: varchar("customer_email", { length: 255 }),
  customerPhone: varchar("customer_phone", { length: 50 }),
  merchantOrder: varchar("merchant_order", { length: 30 }).notNull(),
  redsysResponse: text("redsys_response"),
  redsysDsResponse: varchar("redsys_ds_response", { length: 10 }),
  notes: text("notes"),
  quoteId: int("quote_id").references(() => quotes.id, { onDelete: "set null" }),
  quoteSource: varchar("quoteSource", { length: 32 }), // 'presupuesto' | 'directo'
  // Invoice link
  invoiceId: int("invoiceId"),
  invoiceNumber: varchar("invoiceNumber", { length: 32 }),
  // Payment details
  paymentMethod: mysqlEnum("paymentMethod", ["redsys", "transferencia", "efectivo", "otro", "tarjeta_fisica", "tarjeta_redsys"]),
  paymentValidatedBy: int("paymentValidatedBy"),
  paymentValidatedAt: bigint("paymentValidatedAt", { mode: "number" }),
  transferProofUrl: text("transferProofUrl"),
  // Justificante de reserva delegada (creada por el admin para un partner)
  delegationProofUrl: text("delegation_proof_url"),
  delegationProofKey: varchar("delegation_proof_key", { length: 512 }),
  delegationNote: text("delegation_note"),
  // Channel & metadata
  channel: mysqlEnum("channel", [
    "ONLINE_DIRECTO", "ONLINE_ASISTIDO", "VENTA_DELEGADA",
    "TELEFONO", "EMAIL",
    "TPV_FISICO", "PARTNER", "TICKETING", "MANUAL", "API",
  ]).default("ONLINE_DIRECTO"),
  channelDetail: varchar("channel_detail", { length: 128 }), // e.g. "Groupon", "Smartbox"
  originSource: varchar("origin_source", { length: 64 }), // 'coupon_redemption' | null
  platformName: varchar("platform_name", { length: 128 }), // Nombre de plataforma (Groupon, Smartbox, etc.)
  redemptionId: int("redemption_id"), // FK → coupon_redemptions.id
  // ─── Separación de estados (Fase 3) ─────────────────────────────────────────
  statusReservation: mysqlEnum("status_reservation", [
    "PENDIENTE_CONFIRMACION", "CONFIRMADA", "EN_CURSO", "FINALIZADA", "NO_SHOW", "ANULADA"
  ]).default("PENDIENTE_CONFIRMACION"),
  statusPayment: mysqlEnum("status_payment", [
    "PENDIENTE", "PAGO_PARCIAL", "PENDIENTE_VALIDACION", "PAGADO"
  ]).default("PENDIENTE"),
  // ─── Cambio de fecha ──────────────────────────────────────────────────────
  dateChangedReason: text("date_changed_reason"),
  dateModified: boolean("date_modified").default(false),
  // ─── Trazabilidad ─────────────────────────────────────────────────────────
  changesLog: json("changes_log").$type<Array<{
    ts: number;
    actor: string;
    action: string;
    from?: string;
    to?: string;
    reason?: string;
  }>>().default([]),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  paidAt: bigint("paid_at", { mode: "number" }),
  // Pricing snapshot (retrocompatible: null = per_person legacy)
  pricingType: varchar("pricing_type", { length: 16 }),      // "per_person" | "per_unit"
  unitCapacity: int("unit_capacity"),                         // personas por unidad al reservar
  unitsBooked: int("units_booked"),                          // unidades reservadas
  // Time slots (optional, retrocompatible - null = no time slot required)
  selectedTimeSlotId: int("selected_time_slot_id"),
  selectedTime: varchar("selected_time", { length: 10 }),
  // REAV link
  reavExpedientId: int("reav_expedient_id"),
  // Número de referencia interna (RES-2026-XXXX)
  reservationNumber: varchar("reservation_number", { length: 32 }).unique(),
  // Anulación vinculada (FK → cancellation_requests.id)
  cancellationRequestId: int("cancellation_request_id"),
  // Partner
  partnerId: int("partner_id"),
  partnerUserId: int("partner_user_id"),
  // Meta CAPI attribution — capturados al crear la reserva para enriquecer Purchase server-side
  fbp: varchar("fbp", { length: 255 }),
  fbc: varchar("fbc", { length: 255 }),
  clientIpAddress: varchar("client_ip_address", { length: 45 }),
  clientUserAgent: varchar("client_user_agent", { length: 500 }),
  // Token público para que el cliente acceda a su reserva sin login.
  // URL: https://www.nayadeexperiences.es/presupuesto/{publicToken}
  // Se genera automáticamente al crear cada reserva (todos los canales).
  publicToken: varchar("public_token", { length: 128 }).unique(),
  // Marca de trazabilidad: cuándo se envió el email de confirmación al cliente,
  // sin importar el canal. Sirve de guarda de idempotencia y de señal fiable
  // para saber si una reserva se quedó sin notificar.
  confirmationEmailSentAt: timestamp("confirmation_email_sent_at"),
});

// ─── PRODUCT TIME SLOTS ────────────────────────────────────────────────────────

export const productTimeSlots = mysqlTable("product_time_slots", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("product_id").notNull(),
  type: mysqlEnum("type", ["fixed", "flexible", "range"]).notNull().default("fixed"),
  label: varchar("label", { length: 128 }).notNull(),
  startTime: varchar("start_time", { length: 10 }),   // e.g. "10:00"
  endTime: varchar("end_time", { length: 10 }),         // e.g. "14:00"
  daysOfWeek: varchar("days_of_week", { length: 32 }), // e.g. "1,2,3,4,5" (Mon-Fri)
  capacity: int("capacity"),
  priceOverride: decimal("price_override", { precision: 10, scale: 2 }),
  sortOrder: int("sort_order").default(0).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type ProductTimeSlot = typeof productTimeSlots.$inferSelect;
export type InsertProductTimeSlot = typeof productTimeSlots.$inferInsert;

// ─── PACKS ──────────────────────────────────────────────────────────────────

export const packs = mysqlTable("packs", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 256 }).notNull().unique(),
  category: mysqlEnum("category", ["dia", "escolar", "empresa"]).notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  subtitle: varchar("subtitle", { length: 512 }),
  shortDescription: text("shortDescription"),
  description: text("description"),
  includes: json("includes").$type<string[]>().default([]),
  excludes: json("excludes").$type<string[]>().default([]),
  schedule: text("schedule"),
  note: text("note"),
  image1: text("image1"),
  image2: text("image2"),
  image3: text("image3"),
  image4: text("image4"),
  basePrice: decimal("basePrice", { precision: 10, scale: 2 }).notNull().default("0"),
  priceLabel: varchar("priceLabel", { length: 128 }),
  duration: varchar("duration", { length: 128 }),
  minPersons: int("minPersons").default(1),
  maxPersons: int("maxPersons"),
  targetAudience: varchar("targetAudience", { length: 256 }),
  badge: varchar("badge", { length: 64 }),
  hasStay: boolean("hasStay").default(false).notNull(),
  isOnlinePurchase: boolean("isOnlinePurchase").default(false).notNull(),
   discountPercent: decimal("discountPercent", { precision: 5, scale: 2 }),
  discountExpiresAt: timestamp("discountExpiresAt"),
  // Fiscal regime (REAV module)
  fiscalRegime: mysqlEnum("fiscalRegime", ["reav", "general", "mixed"]).default("general").notNull(),
  taxRate: decimal("taxRate", { precision: 5, scale: 2 }).default("21"),
  productType: mysqlEnum("productType", ["own", "semi_own", "third_party", "actividad", "alojamiento", "restauracion", "transporte", "pack"]).default("pack").notNull(),
  providerPercent: decimal("providerPercent", { precision: 5, scale: 2 }).default("0"),
  agencyMarginPercent: decimal("agencyMarginPercent", { precision: 5, scale: 2 }).default("0"),
  // Supplier / Liquidaciones module
  supplierId: int("supplierId"),
  supplierCommissionPercent: decimal("supplierCommissionPercent", { precision: 5, scale: 2 }).default("0.00"),
  supplierCostType: mysqlEnum("supplierCostType", ["comision_sobre_venta", "coste_fijo", "porcentaje_margen", "hibrido"]).default("comision_sobre_venta"),
  settlementFrequency: mysqlEnum("settlementFrequency", ["semanal", "quincenal", "mensual", "manual"]).default("manual"),
  isSettlable: boolean("isSettlable").default(false).notNull(),
  isFeatured: boolean("isFeatured").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  isPresentialSale: boolean("isPresentialSale").default(false).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  metaTitle: varchar("metaTitle", { length: 256 }),
  metaDescription: text("metaDescription"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export const packCrossSells = mysqlTable("pack_cross_sells", {
  id: int("id").autoincrement().primaryKey(),
  packId: int("packId").notNull(),
  relatedPackId: int("relatedPackId").notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
});

export type Pack = typeof packs.$inferSelect;
export type InsertPack = typeof packs.$inferInsert;

// ─── TYPE EXPORTS ─────────────────────────────────────────────────────────────────────────────────
export type Reservation = typeof reservations.$inferSelect;
export type HomeModuleItem = typeof homeModuleItems.$inferSelect;
export type SlideshowItem = typeof slideshowItems.$inferSelect;
export type MenuItem = typeof menuItems.$inferSelect;
export type MediaFile = typeof mediaFiles.$inferSelect;
export type Location = typeof locations.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Experience = typeof experiences.$inferSelect;
export type ExperienceVariant = typeof experienceVariants.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Quote = typeof quotes.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type BookingMonitor = typeof bookingMonitors.$inferSelect;
export type DailyOrder = typeof dailyOrders.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;

// ─── PAGE BLOCKS ─────────────────────────────────────────────────────────────
export const pageBlocks = mysqlTable("page_blocks", {
  id: int("id").autoincrement().primaryKey(),
  pageSlug: varchar("pageSlug", { length: 256 }).notNull(),
  blockType: varchar("blockType", { length: 64 }).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  data: json("data").notNull(),
  isVisible: boolean("isVisible").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PageBlock = typeof pageBlocks.$inferSelect;
export type InsertPageBlock = typeof pageBlocks.$inferInsert;

// ─── HOTEL ───────────────────────────────────────────────────────────────────

/** Tipologías de habitación (equivalente a experiences) */
export const roomTypes = mysqlTable("room_types", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 256 }).notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  shortDescription: text("shortDescription"),
  description: text("description"),
  coverImageUrl: text("coverImageUrl"),
  image1: text("image1"),
  image2: text("image2"),
  image3: text("image3"),
  image4: text("image4"),
  gallery: json("gallery").$type<string[]>().default([]),
  maxAdults: int("maxAdults").default(2).notNull(),
  maxChildren: int("maxChildren").default(0).notNull(),
  maxOccupancy: int("maxOccupancy").default(2).notNull(),
  surfaceM2: int("surfaceM2"),
  amenities: json("amenities").$type<string[]>().default([]),
  basePrice: decimal("basePrice", { precision: 10, scale: 2 }).notNull().default("0"),
  currency: varchar("currency", { length: 8 }).default("EUR").notNull(),
  totalUnits: int("totalUnits").default(1).notNull(),
  internalTags: json("internalTags").$type<string[]>().default([]),
  // Descuento promocional
  discountPercent: decimal("discountPercent", { precision: 5, scale: 2 }),
  discountLabel: varchar("discountLabel", { length: 128 }),
  discountExpiresAt: timestamp("discountExpiresAt"),
  // Régimen fiscal
  fiscalRegime: mysqlEnum("fiscalRegime", ["reav", "general", "mixed"]).default("general").notNull(),
  taxRate: decimal("taxRate", { precision: 5, scale: 2 }).default("21"),
  productType: mysqlEnum("productType", ["own", "semi_own", "third_party", "actividad", "alojamiento", "restauracion", "transporte", "pack"]).default("alojamiento").notNull(),
  providerPercent: decimal("providerPercent", { precision: 5, scale: 2 }).default("0"),
  agencyMarginPercent: decimal("agencyMarginPercent", { precision: 5, scale: 2 }).default("0"),
  // Proveedor y liquidaciones
  supplierId: int("supplierId"),
  supplierCommissionPercent: decimal("supplierCommissionPercent", { precision: 5, scale: 2 }).default("0.00"),
  supplierCostType: mysqlEnum("supplierCostType", ["comision_sobre_venta", "coste_fijo", "porcentaje_margen", "hibrido"]).default("comision_sobre_venta"),
  settlementFrequency: mysqlEnum("settlementFrequency", ["semanal", "quincenal", "mensual", "manual"]).default("manual"),
  isSettlable: boolean("isSettlable").default(false).notNull(),
  isFeatured: boolean("isFeatured").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  isPresentialSale: boolean("isPresentialSale").default(false).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  metaTitle: varchar("metaTitle", { length: 256 }),
  metaDescription: text("metaDescription"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Temporadas de precio (ej: alta, media, baja) */
export const roomRateSeasons = mysqlTable("room_rate_seasons", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  startDate: varchar("startDate", { length: 10 }).notNull(), // YYYY-MM-DD
  endDate: varchar("endDate", { length: 10 }).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/** Tarifas por tipología + temporada + día semana */
export const roomRates = mysqlTable("room_rates", {
  id: int("id").autoincrement().primaryKey(),
  roomTypeId: int("roomTypeId").notNull(),
  seasonId: int("seasonId"),
  dayOfWeek: int("dayOfWeek"), // 0=Dom … 6=Sáb, null=todos
  specificDate: varchar("specificDate", { length: 10 }), // YYYY-MM-DD override
  pricePerNight: decimal("pricePerNight", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("EUR").notNull(),
  supplement: decimal("supplement", { precision: 10, scale: 2 }).default("0"),
  supplementLabel: varchar("supplementLabel", { length: 128 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Bloqueos y ajustes de inventario por fecha */
export const roomBlocks = mysqlTable("room_blocks", {
  id: int("id").autoincrement().primaryKey(),
  roomTypeId: int("roomTypeId").notNull(),
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  availableUnits: int("availableUnits").default(0).notNull(), // 0 = cerrado
  reason: varchar("reason", { length: 256 }),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type RoomType = typeof roomTypes.$inferSelect;
export type InsertRoomType = typeof roomTypes.$inferInsert;
export type RoomRateSeason = typeof roomRateSeasons.$inferSelect;
export type RoomRate = typeof roomRates.$inferSelect;
export type RoomBlock = typeof roomBlocks.$inferSelect;

// ─── SPA ─────────────────────────────────────────────────────────────────────

/** Categorías de tratamiento SPA */
export const spaCategories = mysqlTable("spa_categories", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 128 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  iconName: varchar("iconName", { length: 64 }),
  sortOrder: int("sortOrder").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/** Tratamientos y circuitos SPA (equivalente a experiences) */
export const spaTreatments = mysqlTable("spa_treatments", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 256 }).notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  categoryId: int("categoryId"),
  shortDescription: text("shortDescription"),
  description: text("description"),
  benefits: json("benefits").$type<string[]>().default([]),
  coverImageUrl: text("coverImageUrl"),
  image1: text("image1"),
  image2: text("image2"),
  gallery: json("gallery").$type<string[]>().default([]),
  durationMinutes: int("durationMinutes").default(60).notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull().default("0"),
  currency: varchar("currency", { length: 8 }).default("EUR").notNull(),
  maxPersons: int("maxPersons").default(1).notNull(),
  cabinRequired: boolean("cabinRequired").default(true).notNull(),
  // Descuento promocional
  discountPercent: decimal("discountPercent", { precision: 5, scale: 2 }),
  discountLabel: varchar("discountLabel", { length: 128 }),
  discountExpiresAt: timestamp("discountExpiresAt"),
  // Régimen fiscal
  fiscalRegime: mysqlEnum("fiscalRegime", ["reav", "general", "mixed"]).default("general").notNull(),
  taxRate: decimal("taxRate", { precision: 5, scale: 2 }).default("21"),
  productType: mysqlEnum("productType", ["own", "semi_own", "third_party", "actividad", "alojamiento", "restauracion", "transporte", "pack"]).default("actividad").notNull(),
  providerPercent: decimal("providerPercent", { precision: 5, scale: 2 }).default("0"),
  agencyMarginPercent: decimal("agencyMarginPercent", { precision: 5, scale: 2 }).default("0"),
  // Proveedor y liquidaciones
  supplierId: int("supplierId"),
  supplierCommissionPercent: decimal("supplierCommissionPercent", { precision: 5, scale: 2 }).default("0.00"),
  supplierCostType: mysqlEnum("supplierCostType", ["comision_sobre_venta", "coste_fijo", "porcentaje_margen", "hibrido"]).default("comision_sobre_venta"),
  settlementFrequency: mysqlEnum("settlementFrequency", ["semanal", "quincenal", "mensual", "manual"]).default("manual"),
  isSettlable: boolean("isSettlable").default(false).notNull(),
  isFeatured: boolean("isFeatured").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  isPresentialSale: boolean("isPresentialSale").default(false).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  metaTitle: varchar("metaTitle", { length: 256 }),
  metaDescription: text("metaDescription"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Recursos SPA: cabinas y terapeutas */
export const spaResources = mysqlTable("spa_resources", {
  id: int("id").autoincrement().primaryKey(),
  type: mysqlEnum("type", ["cabina", "terapeuta"]).notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/** Slots de agenda SPA (franjas horarias disponibles) */
export const spaSlots = mysqlTable("spa_slots", {
  id: int("id").autoincrement().primaryKey(),
  treatmentId: int("treatmentId").notNull(),
  resourceId: int("resourceId"),
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  startTime: varchar("startTime", { length: 5 }).notNull(), // HH:MM
  endTime: varchar("endTime", { length: 5 }).notNull(),
  capacity: int("capacity").default(1).notNull(),
  bookedCount: int("bookedCount").default(0).notNull(),
  status: mysqlEnum("status", ["disponible", "reservado", "bloqueado"]).default("disponible").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Plantillas de horario semanal para auto-generar slots */
export const spaScheduleTemplates = mysqlTable("spa_schedule_templates", {
  id: int("id").autoincrement().primaryKey(),
  treatmentId: int("treatmentId").notNull(),
  resourceId: int("resourceId"),
  dayOfWeek: int("dayOfWeek").notNull(), // 0=Dom … 6=Sáb
  startTime: varchar("startTime", { length: 5 }).notNull(),
  endTime: varchar("endTime", { length: 5 }).notNull(),
  capacity: int("capacity").default(1).notNull(),
  // Minutos de cada slot dentro del rango [startTime, endTime]. 0 = un único slot
  // que cubre todo el rango (comportamiento histórico). >0 = se trocea en slots
  // de esa duración (ej. 60 → slots de cada hora).
  slotIntervalMinutes: int("slotIntervalMinutes").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SpaCategory = typeof spaCategories.$inferSelect;
export type SpaTreatment = typeof spaTreatments.$inferSelect;
export type InsertSpaTreatment = typeof spaTreatments.$inferInsert;
export type SpaResource = typeof spaResources.$inferSelect;
export type SpaSlot = typeof spaSlots.$inferSelect;
export type SpaScheduleTemplate = typeof spaScheduleTemplates.$inferSelect;

// ─── REVIEWS ─────────────────────────────────────────────────────────────────

/**
 * Reseñas y valoraciones de usuarios para habitaciones del hotel y tratamientos del SPA.
 * entityType: 'hotel' | 'spa'
 * entityId: id de la room_type o spa_treatment correspondiente
 */
export const reviews = mysqlTable("reviews", {
  id: int("id").autoincrement().primaryKey(),
  entityType: mysqlEnum("entityType", ["hotel", "spa", "experience", "pack", "restaurant"]).notNull(),
  entityId: int("entityId").notNull(),
  authorName: varchar("authorName", { length: 256 }).notNull(),
  authorEmail: varchar("authorEmail", { length: 320 }),
  rating: int("rating").notNull(), // 1-5
  title: varchar("title", { length: 256 }),
  body: text("body").notNull(),
  status: mysqlEnum("status", ["pending", "approved", "rejected"]).default("pending").notNull(),
  adminReply: text("adminReply"),
  adminRepliedAt: timestamp("adminRepliedAt"),
  stayDate: varchar("stayDate", { length: 10 }), // YYYY-MM-DD (fecha de la estancia/tratamiento)
  verifiedBooking: boolean("verifiedBooking").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Review = typeof reviews.$inferSelect;
export type InsertReview = typeof reviews.$inferInsert;

// ─── PASSWORD RESET TOKENS ───────────────────────────────────────────────────
export const passwordResetTokens = mysqlTable("password_reset_tokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  token: varchar("token", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type InsertPasswordResetToken = typeof passwordResetTokens.$inferInsert;

// ─── RESTAURANTS ─────────────────────────────────────────────────────────────

export const restaurants = mysqlTable("restaurants", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 128 }).notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  shortDesc: text("shortDesc"),
  longDesc: text("longDesc"),
  cuisine: varchar("cuisine", { length: 256 }),
  heroImage: text("heroImage"),
  galleryImages: json("galleryImages").$type<string[]>().default([]),
  menuUrl: text("menuUrl"),
  phone: varchar("phone", { length: 32 }),
  email: varchar("email", { length: 320 }),
  location: varchar("location", { length: 512 }),
  badge: varchar("badge", { length: 128 }),
  // Configuración operativa
  depositPerGuest: decimal("depositPerGuest", { precision: 8, scale: 2 }).default("5.00").notNull(),
  maxGroupSize: int("maxGroupSize").default(20).notNull(),
  minAdvanceHours: int("minAdvanceHours").default(2).notNull(),
  maxAdvanceDays: int("maxAdvanceDays").default(60).notNull(),
  cancellationHours: int("cancellationHours").default(24).notNull(),
  cancellationPolicy: text("cancellationPolicy"),
  legalText: text("legalText"),
  operativeEmail: varchar("operativeEmail", { length: 320 }),
  acceptsOnlineBooking: boolean("acceptsOnlineBooking").default(true).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Restaurant = typeof restaurants.$inferSelect;
export type InsertRestaurant = typeof restaurants.$inferInsert;

// Turnos / franjas horarias por restaurante
export const restaurantShifts = mysqlTable("restaurant_shifts", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  name: varchar("name", { length: 128 }).notNull(), // ej: "Comida", "Cena", "Brunch"
  startTime: varchar("startTime", { length: 5 }).notNull(), // HH:MM
  endTime: varchar("endTime", { length: 5 }).notNull(),
  maxCapacity: int("maxCapacity").notNull(),
  daysOfWeek: json("daysOfWeek").$type<number[]>().default([0,1,2,3,4,5,6]), // 0=Dom..6=Sáb
  slotMinutes: int("slotMinutes").default(30).notNull(), // Granularidad de slots: 15, 30 o 60 min
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
});
export type RestaurantShift = typeof restaurantShifts.$inferSelect;
export type InsertRestaurantShift = typeof restaurantShifts.$inferInsert;

// Cierres puntuales
export const restaurantClosures = mysqlTable("restaurant_closures", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  shiftId: int("shiftId"), // null = cierre total del día
  reason: varchar("reason", { length: 512 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type RestaurantClosure = typeof restaurantClosures.$inferSelect;

// Reservas de restaurante
export const restaurantBookings = mysqlTable("restaurant_bookings", {
  id: int("id").autoincrement().primaryKey(),
  locator: varchar("locator", { length: 16 }).notNull().unique(), // ej: NR-A3F9K2
  restaurantId: int("restaurantId").notNull(),
  shiftId: int("shiftId").notNull(),
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  time: varchar("time", { length: 5 }).notNull(), // HH:MM
  guests: int("guests").notNull(),
  depositAmount: decimal("depositAmount", { precision: 8, scale: 2 }).notNull(),
  // Datos del titular
  guestName: varchar("guestName", { length: 256 }).notNull(),
  guestLastName: varchar("guestLastName", { length: 256 }),
  guestEmail: varchar("guestEmail", { length: 320 }).notNull(),
  guestPhone: varchar("guestPhone", { length: 32 }),
  // Observaciones
  highchair: boolean("highchair").default(false),
  allergies: text("allergies"),
  birthday: boolean("birthday").default(false),
  specialRequests: text("specialRequests"),
  accessibility: boolean("accessibility").default(false),
  isVip: boolean("isVip").default(false),
  // Estado
  status: mysqlEnum("status", ["pending_payment", "confirmed", "payment_failed", "cancelled", "modified", "no_show", "completed"]).default("pending_payment").notNull(),
  cancellationReason: text("cancellationReason"),
  adminNotes: text("adminNotes"),
  // Canal y admin
  channel: mysqlEnum("channel", ["web", "manual", "admin"]).default("web").notNull(),
  createdByUserId: int("createdByUserId"),
  // Pago
  paymentStatus: mysqlEnum("paymentStatus", ["pending", "paid", "failed", "refunded"]).default("pending").notNull(),
  paymentTransactionId: varchar("paymentTransactionId", { length: 256 }),
  paymentMethod: varchar("paymentMethod", { length: 64 }),
  merchantOrder: varchar("merchantOrder", { length: 32 }),
  paidAt: timestamp("paidAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type RestaurantBooking = typeof restaurantBookings.$inferSelect;
export type InsertRestaurantBooking = typeof restaurantBookings.$inferInsert;

// Log de actividad de reservas
export const restaurantBookingLogs = mysqlTable("restaurant_booking_logs", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(),
  action: varchar("action", { length: 128 }).notNull(),
  details: text("details"),
  userId: int("userId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type RestaurantBookingLog = typeof restaurantBookingLogs.$inferSelect;

// Asignación de staff a restaurantes (para rol adminrest)
export const restaurantStaff = mysqlTable("restaurant_staff", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  restaurantId: int("restaurantId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type RestaurantStaff = typeof restaurantStaff.$inferSelect;

// ─── GALLERY ─────────────────────────────────────────────────────────────────
export const galleryItems = mysqlTable("gallery_items", {
  id: int("id").autoincrement().primaryKey(),
  imageUrl: text("imageUrl").notNull(),
  fileKey: varchar("fileKey", { length: 512 }).notNull(),
  title: varchar("title", { length: 256 }).default(""),
  category: varchar("category", { length: 128 }).notNull().default("General"),
  // Fase 8.5 — asociación media↔venue mínima (sin FK real, mismo criterio que
  // el resto del schema heredado): nullable a propósito, una foto de galería
  // puede no pertenecer a ningún local concreto (foto general de Segovia).
  venueId: int("venueId"),
  sortOrder: int("sortOrder").notNull().default(0),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type GalleryItem = typeof galleryItems.$inferSelect;
export type NewGalleryItem = typeof galleryItems.$inferInsert;

// ─── CLIENTS (CRM) ───────────────────────────────────────────────────────────
export const clients = mysqlTable("clients", {
  id: int("id").autoincrement().primaryKey(),
  // Origen del cliente
  leadId: int("leadId"),                          // Lead que originó este cliente (puede ser null si se creó manualmente)
  source: varchar("source", { length: 64 }).default("lead").notNull(), // 'lead' | 'manual' | 'reservation'
  // Datos básicos (rellenados desde el lead)
  name: varchar("name", { length: 256 }).notNull(),
  email: varchar("email", { length: 256 }).notNull().unique(),
  phone: varchar("phone", { length: 64 }).default(""),
  company: varchar("company", { length: 256 }).default(""),
  // Datos ampliados (se completan cuando el presupuesto se convierte en reserva)
  nif: varchar("nif", { length: 64 }).default(""),
  address: text("address"),
  city: varchar("city", { length: 128 }).default(""),
  postalCode: varchar("postalCode", { length: 16 }).default(""),
  country: varchar("country", { length: 64 }).default("ES"),
  birthDate: varchar("birthDate", { length: 10 }),  // YYYY-MM-DD
  // Preferencias y notas
  notes: text("notes"),
  tags: json("tags").$type<string[]>().default([]),
  // Estado del cliente
  isConverted: boolean("isConverted").default(false).notNull(), // true cuando ha tenido al menos una reserva confirmada
  totalBookings: int("totalBookings").default(0).notNull(),
  totalSpent: decimal("totalSpent", { precision: 10, scale: 2 }).default("0"),
  lastBookingAt: timestamp("lastBookingAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Client = typeof clients.$inferSelect;
export type InsertClient = typeof clients.$inferInsert;

// ─── REAV MODULE ─────────────────────────────────────────────────────────────

/**
 * Expediente REAV: se crea automáticamente cuando se emite una factura con
 * al menos una línea en régimen REAV. Agrupa toda la documentación fiscal,
 * los costes internos y el estado del expediente.
 */
export const reavExpedients = mysqlTable("reav_expedients", {
  id: int("id").autoincrement().primaryKey(),
  expedientNumber: varchar("expedientNumber", { length: 32 }).notNull().unique(), // EXP-REAV-2026-0001
  // Relaciones
  invoiceId: int("invoiceId"),          // Factura que originó el expediente
  reservationId: int("reservationId"),  // Reserva asociada (si existe)
  clientId: int("clientId"),            // Cliente
  agentId: int("agentId"),              // Agente responsable
  // Datos del servicio
  serviceDescription: text("serviceDescription"),
  serviceDate: varchar("serviceDate", { length: 10 }),   // YYYY-MM-DD
  serviceEndDate: varchar("serviceEndDate", { length: 10 }),
  destination: varchar("destination", { length: 256 }),
  numberOfPax: int("numberOfPax").default(1),
  // Importes (calculados al crear / recalculados al introducir costes reales)
  saleAmountTotal: decimal("saleAmountTotal", { precision: 10, scale: 2 }).default("0"),
  providerCostEstimated: decimal("providerCostEstimated", { precision: 10, scale: 2 }).default("0"),
  providerCostReal: decimal("providerCostReal", { precision: 10, scale: 2 }).default("0"),
  agencyMarginEstimated: decimal("agencyMarginEstimated", { precision: 10, scale: 2 }).default("0"),
  agencyMarginReal: decimal("agencyMarginReal", { precision: 10, scale: 2 }).default("0"),
  reavTaxBase: decimal("reavTaxBase", { precision: 10, scale: 2 }).default("0"),    // margen bruto tributable
  reavTaxAmount: decimal("reavTaxAmount", { precision: 10, scale: 2 }).default("0"), // 21% sobre margen
  // Estado fiscal
  fiscalStatus: mysqlEnum("fiscalStatus", [
    "pendiente_documentacion",
    "documentacion_completa",
    "en_revision",
    "cerrado",
    "anulado",
  ]).default("pendiente_documentacion").notNull(),
  // Estado operativo
  operativeStatus: mysqlEnum("operativeStatus", [
    "abierto",
    "en_proceso",
    "cerrado",
    "anulado",
  ]).default("abierto").notNull(),
  // Datos del cliente (copiados en el momento de creación para trazabilidad)
  clientName: varchar("clientName", { length: 256 }),
  clientEmail: varchar("clientEmail", { length: 256 }),
  clientPhone: varchar("clientPhone", { length: 64 }),
  clientDni: varchar("clientDni", { length: 64 }),
  clientAddress: varchar("clientAddress", { length: 512 }),
  // Canal de origen y referencia
  channel: mysqlEnum("channel", ["tpv", "online", "crm", "manual"]).default("manual"),
  sourceRef: varchar("sourceRef", { length: 128 }), // Nº ticket, factura, presupuesto...
  tpvSaleId: int("tpvSaleId"),
  quoteId: int("quoteId"),
  // Notas internas
  internalNotes: text("internalNotes"),
  closedAt: timestamp("closedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ReavExpedient = typeof reavExpedients.$inferSelect;
export type InsertReavExpedient = typeof reavExpedients.$inferInsert;

/**
 * Documentos del expediente REAV.
 * Bloque 2: documentos del cliente (facturas emitidas, contratos, vouchers)
 * Bloque 3: documentos del proveedor (facturas recibidas, confirmaciones)
 */
export const reavDocuments = mysqlTable("reav_documents", {
  id: int("id").autoincrement().primaryKey(),
  expedientId: int("expedientId").notNull(),
  side: mysqlEnum("side", ["client", "provider"]).notNull(), // Bloque 2 o Bloque 3
  docType: mysqlEnum("docType", [
    "factura_emitida",
    "factura_recibida",
    "contrato",
    "voucher",
    "confirmacion_proveedor",
    "otro",
  ]).default("otro").notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  fileUrl: text("fileUrl"),
  fileKey: text("fileKey"),
  mimeType: varchar("mimeType", { length: 128 }),
  fileSize: int("fileSize"),
  notes: text("notes"),
  uploadedBy: int("uploadedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ReavDocument = typeof reavDocuments.$inferSelect;
export type InsertReavDocument = typeof reavDocuments.$inferInsert;

/**
 * Costes internos del expediente REAV (Bloque 4: panel económico).
 * Cada línea representa un coste real de proveedor.
 */
export const reavCosts = mysqlTable("reav_costs", {
  id: int("id").autoincrement().primaryKey(),
  expedientId: int("expedientId").notNull(),
  description: varchar("description", { length: 256 }).notNull(),
  providerName: varchar("providerName", { length: 256 }),
  providerNif: varchar("providerNif", { length: 64 }),
  invoiceRef: varchar("invoiceRef", { length: 128 }),
  invoiceDate: varchar("invoiceDate", { length: 10 }), // YYYY-MM-DD
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("EUR").notNull(),
  category: mysqlEnum("category", [
    "transporte",
    "alojamiento",
    "actividad",
    "restauracion",
    "guia",
    "seguro",
    "otros",
  ]).default("otros").notNull(),
  isPaid: boolean("isPaid").default(false).notNull(),
  paidAt: timestamp("paidAt"),
  // Si el importe incluye IVA (true) o es neto sin IVA (false)
  includesVat: boolean("includes_vat").default(true).notNull(),
  notes: text("notes"),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ReavCost = typeof reavCosts.$inferSelect;
export type InsertReavCost = typeof reavCosts.$inferInsert;

// ─── SUPPLIERS (Proveedores) ──────────────────────────────────────────────────

/**
 * Tabla de proveedores del sistema.
 * Contiene datos fiscales, comerciales, bancarios y operativos.
 */
export const suppliers = mysqlTable("suppliers", {
  id: int("id").autoincrement().primaryKey(),
  // Datos fiscales
  fiscalName: varchar("fiscalName", { length: 256 }).notNull(),
  commercialName: varchar("commercialName", { length: 256 }),
  nif: varchar("nif", { length: 32 }),
  fiscalAddress: text("fiscalAddress"),
  // Datos de contacto
  adminEmail: varchar("adminEmail", { length: 320 }),
  phone: varchar("phone", { length: 32 }),
  contactPerson: varchar("contactPerson", { length: 256 }),
  // Datos bancarios
  iban: varchar("iban", { length: 64 }),
  paymentMethod: mysqlEnum("paymentMethod", [
    "transferencia",
    "confirming",
    "efectivo",
    "compensacion",
  ]).default("transferencia").notNull(),
  // Datos operativos
  standardCommissionPercent: decimal("standardCommissionPercent", { precision: 5, scale: 2 }).default("0.00"),
  // Configuración de liquidaciones
  settlementFrequency: mysqlEnum("settlementFrequency", [
    "quincenal",
    "mensual",
    "trimestral",
    "semestral",
    "anual",
    "manual",
  ]).default("manual").notNull(),
  settlementDayOfMonth: int("settlementDayOfMonth").default(1), // Día del mes para liquidar (1-28)
  autoGenerateSettlements: boolean("autoGenerateSettlements").default(false).notNull(),
  internalNotes: text("internalNotes"),
  status: mysqlEnum("status", ["activo", "inactivo", "bloqueado"]).default("activo").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Supplier = typeof suppliers.$inferSelect;
export type InsertSupplier = typeof suppliers.$inferInsert;

// ─── SUPPLIER SETTLEMENTS (Liquidaciones) ────────────────────────────────────

/**
 * Cabecera de cada liquidación generada para un proveedor.
 */
export const supplierSettlements = mysqlTable("supplier_settlements", {
  id: int("id").autoincrement().primaryKey(),
  settlementNumber: varchar("settlementNumber", { length: 64 }).notNull().unique(),
  supplierId: int("supplierId").notNull(),
  // Periodo liquidado
  periodFrom: varchar("periodFrom", { length: 10 }).notNull(), // YYYY-MM-DD
  periodTo: varchar("periodTo", { length: 10 }).notNull(),     // YYYY-MM-DD
  // Totales calculados
  grossAmount: decimal("grossAmount", { precision: 12, scale: 2 }).default("0.00").notNull(),
  commissionAmount: decimal("commissionAmount", { precision: 12, scale: 2 }).default("0.00").notNull(),
  netAmountProvider: decimal("netAmountProvider", { precision: 12, scale: 2 }).default("0.00").notNull(),
  currency: varchar("currency", { length: 8 }).default("EUR").notNull(),
  // Workflow de estados
  status: mysqlEnum("status", [
    "borrador",
    "emitida",
    "pendiente_abono",
    "abonada",
    "incidencia",
    "recalculada",
  ]).default("emitida").notNull(),
  // Trazabilidad
  pdfUrl: text("pdfUrl"),
  pdfKey: text("pdfKey"),
  sentAt: timestamp("sentAt"),
  paidAt: timestamp("paidAt"),
  internalNotes: text("internalNotes"),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type SupplierSettlement = typeof supplierSettlements.$inferSelect;
export type InsertSupplierSettlement = typeof supplierSettlements.$inferInsert;

// ─── SETTLEMENT LINES (Líneas de liquidación) ────────────────────────────────

/**
 * Cada línea representa una reserva/servicio incluido en la liquidación.
 */
export const settlementLines = mysqlTable("settlement_lines", {
  id: int("id").autoincrement().primaryKey(),
  settlementId: int("settlementId").notNull(),
  reservationId: int("reservationId"),
  invoiceId: int("invoiceId"),
  productId: int("productId"),
  productName: varchar("productName", { length: 256 }),
  serviceDate: varchar("serviceDate", { length: 10 }), // YYYY-MM-DD
  paxCount: int("paxCount").default(1).notNull(),
  // Importes
  saleAmount: decimal("saleAmount", { precision: 12, scale: 2 }).notNull(),       // Importe cobrado al cliente
  commissionPercent: decimal("commissionPercent", { precision: 5, scale: 2 }).notNull(), // % comisión Nayade
  commissionAmount: decimal("commissionAmount", { precision: 12, scale: 2 }).notNull(),  // Importe comisión
  netAmountProvider: decimal("netAmountProvider", { precision: 12, scale: 2 }).notNull(), // Neto proveedor
  costType: mysqlEnum("costType", [
    "comision_sobre_venta",
    "coste_fijo",
    "porcentaje_margen",
    "hibrido",
  ]).default("comision_sobre_venta").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type SettlementLine = typeof settlementLines.$inferSelect;
export type InsertSettlementLine = typeof settlementLines.$inferInsert;

// ─── SETTLEMENT DOCUMENTS (Documentos adjuntos) ──────────────────────────────

export const settlementDocuments = mysqlTable("settlement_documents", {
  id: int("id").autoincrement().primaryKey(),
  settlementId: int("settlementId").notNull(),
  docType: mysqlEnum("docType", [
    "factura_recibida",
    "contrato",
    "justificante_pago",
    "email",
    "acuerdo_comision",
    "otro",
  ]).default("otro").notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  fileUrl: text("fileUrl"),
  fileKey: text("fileKey"),
  notes: text("notes"),
  uploadedBy: int("uploadedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type SettlementDocument = typeof settlementDocuments.$inferSelect;
export type InsertSettlementDocument = typeof settlementDocuments.$inferInsert;

// ─── SETTLEMENT STATUS LOG (Historial de estados) ────────────────────────────

export const settlementStatusLog = mysqlTable("settlement_status_log", {
  id: int("id").autoincrement().primaryKey(),
  settlementId: int("settlementId").notNull(),
  fromStatus: varchar("fromStatus", { length: 64 }),
  toStatus: varchar("toStatus", { length: 64 }).notNull(),
  changedBy: int("changedBy"),
  changedByName: varchar("changedByName", { length: 256 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type SettlementStatusLog = typeof settlementStatusLog.$inferSelect;
export type InsertSettlementStatusLog = typeof settlementStatusLog.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// TPV — TERMINAL PUNTO DE VENTA
// ═══════════════════════════════════════════════════════════════════════════════

// ─── CASH REGISTERS (Cajas físicas) ──────────────────────────────────────────
export const cashRegisters = mysqlTable("cash_registers", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  location: varchar("location", { length: 200 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: bigint("createdAt", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
});
export type CashRegister = typeof cashRegisters.$inferSelect;

// ─── CASH SESSIONS (Turnos de caja) ──────────────────────────────────────────
export const cashSessions = mysqlTable("cash_sessions", {
  id: int("id").autoincrement().primaryKey(),
  registerId: int("registerId").notNull(),
  cashierUserId: int("cashierUserId").notNull(),
  cashierName: varchar("cashierName", { length: 200 }).notNull(),
  openingAmount: decimal("openingAmount", { precision: 10, scale: 2 }).notNull().default("0"),
  closingAmount: decimal("closingAmount", { precision: 10, scale: 2 }),
  countedCash: decimal("countedCash", { precision: 10, scale: 2 }),
  cashDifference: decimal("cashDifference", { precision: 10, scale: 2 }),
  totalCash: decimal("totalCash", { precision: 10, scale: 2 }).default("0"),
  totalCard: decimal("totalCard", { precision: 10, scale: 2 }).default("0"),
  totalBizum: decimal("totalBizum", { precision: 10, scale: 2 }).default("0"),
  totalMixed: decimal("totalMixed", { precision: 10, scale: 2 }).default("0"),
  totalManualOut: decimal("totalManualOut", { precision: 10, scale: 2 }).default("0"),
  totalManualIn: decimal("totalManualIn", { precision: 10, scale: 2 }).default("0"),
  status: mysqlEnum("status_cs", ["open", "closed"]).default("open").notNull(),
  notes: text("notes"),
  openedAt: bigint("openedAt", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
  closedAt: bigint("closedAt", { mode: "number" }),
});
export type CashSession = typeof cashSessions.$inferSelect;

// ─── CASH MOVEMENTS (Movimientos manuales) ───────────────────────────────────
export const cashMovements = mysqlTable("cash_movements", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId").notNull(),
  type: mysqlEnum("type_cm", ["out", "in"]).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  reason: varchar("reason", { length: 300 }).notNull(),
  cashierName: varchar("cashierName", { length: 200 }),
  createdAt: bigint("createdAt", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
});
export type CashMovement = typeof cashMovements.$inferSelect;

// ─── TPV SALES (Ventas TPV) ───────────────────────────────────────────────────
export const tpvSales = mysqlTable("tpv_sales", {
  id: int("id").autoincrement().primaryKey(),
  ticketNumber: varchar("ticketNumber", { length: 50 }).notNull().unique(),
  sessionId: int("sessionId").notNull(),
  reservationId: int("reservationId"),
  invoiceId: int("invoiceId"),
  customerName: varchar("customerName", { length: 200 }),
  customerEmail: varchar("customerEmail", { length: 200 }),
  customerPhone: varchar("customerPhone", { length: 50 }),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull().default("0"),
  discountAmount: decimal("discountAmount", { precision: 10, scale: 2 }).default("0"),
  discountReason: varchar("discountReason", { length: 200 }),
  total: decimal("total", { precision: 10, scale: 2 }).notNull().default("0"),
  status: mysqlEnum("status_ts", ["pending", "paid", "cancelled", "refunded"]).default("pending").notNull(),
  notes: text("notes"),
  serviceDate: varchar("serviceDate", { length: 10 }), // YYYY-MM-DD fecha de la actividad
  createdAt: bigint("createdAt", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
  paidAt: bigint("paidAt", { mode: "number" }),
  // Fiscalidad
  taxBase:        decimal("taxBase",        { precision: 10, scale: 2 }).default("0"),
  taxAmount:      decimal("taxAmount",      { precision: 10, scale: 2 }).default("0"),
  taxRate:        decimal("taxRate",        { precision: 5,  scale: 2 }).default("21"),
  reavMargin:     decimal("reavMargin",     { precision: 10, scale: 2 }).default("0"),
  reavCost:       decimal("reavCost",       { precision: 10, scale: 2 }).default("0"),
  reavTax:        decimal("reavTax",        { precision: 10, scale: 2 }).default("0"),
  fiscalSummary:  varchar("fiscalSummary",  { length: 20 }).default("mixed"),
  // Canal y vendedor
  saleChannel:    varchar("saleChannel",    { length: 20 }).default("tpv"),
  sellerUserId:   int("sellerUserId"),
  sellerName:     varchar("sellerName",     { length: 200 }),
  operativeCenter:varchar("operativeCenter",{ length: 100 }),
});
export type TpvSale = typeof tpvSales.$inferSelect;

// ─── TPV SALE ITEMS (Líneas de venta) ────────────────────────────────────────
export const tpvSaleItems = mysqlTable("tpv_sale_items", {
  id: int("id").autoincrement().primaryKey(),
  saleId: int("saleId").notNull(),
  productType: mysqlEnum("productType_tsi", ["experience", "pack", "spa", "hotel", "restaurant", "extra", "legoPack"]).notNull(),
  productId: int("productId").notNull(),
  productName: varchar("productName", { length: 300 }).notNull(),
  quantity: int("quantity").notNull().default(1),
  unitPrice: decimal("unitPrice", { precision: 10, scale: 2 }).notNull(),
  discountPercent: decimal("discountPercent_tsi", { precision: 5, scale: 2 }).default("0"),
  subtotal: decimal("subtotal_tsi", { precision: 10, scale: 2 }).notNull(),
  eventDate: varchar("eventDate", { length: 10 }),
  eventTime: varchar("eventTime", { length: 10 }),
  participants: int("participants").default(1),
  notes: varchar("notes_tsi", { length: 500 }),
  // Fiscalidad por línea
  fiscalRegime: mysqlEnum("fiscalRegime_tsi", ["reav", "general", "mixed"]).default("general"),
  taxBase:      decimal("taxBase_tsi",   { precision: 10, scale: 2 }).default("0"),
  taxAmount:    decimal("taxAmount_tsi", { precision: 10, scale: 2 }).default("0"),
  taxRate:      decimal("taxRate_tsi",   { precision: 5,  scale: 2 }).default("21"),
  reavCost:     decimal("reavCost_tsi",  { precision: 10, scale: 2 }).default("0"),
  reavMargin:   decimal("reavMargin_tsi",{ precision: 10, scale: 2 }).default("0"),
  reavTax:      decimal("reavTax_tsi",   { precision: 10, scale: 2 }).default("0"),
  isManual:     boolean("is_manual").notNull().default(false),
  conceptText:  varchar("concept_text",  { length: 500 }),
});
export type TpvSaleItem = typeof tpvSaleItems.$inferSelect;

// ─── TPV SALE PAYMENTS (Subpagos) ────────────────────────────────────────────
export const tpvSalePayments = mysqlTable("tpv_sale_payments", {
  id: int("id").autoincrement().primaryKey(),
  saleId: int("saleId").notNull(),
  payerName: varchar("payerName", { length: 200 }),
  method: mysqlEnum("method_tsp", ["cash", "card", "bizum", "other"]).notNull(),
  amount: decimal("amount_tsp", { precision: 10, scale: 2 }).notNull(),
  amountTendered: decimal("amountTendered", { precision: 10, scale: 2 }),
  changeGiven: decimal("changeGiven", { precision: 10, scale: 2 }).default("0"),
  status: mysqlEnum("status_tsp", ["pending", "completed", "failed", "refunded"]).default("pending").notNull(),
  reference: varchar("reference", { length: 200 }),
  createdAt: bigint("createdAt", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
});
export type TpvSalePayment = typeof tpvSalePayments.$inferSelect;

// ─── DISCOUNT CODES ──────────────────────────────────────────────────────────
export const discountCodes = mysqlTable("discount_codes", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  // Tipo de descuento: percent = porcentaje, fixed = importe fijo en euros
  discountType: mysqlEnum("discount_type", ["percent", "fixed"]).default("percent").notNull(),
  discountPercent: decimal("discount_percent", { precision: 5, scale: 2 }).notNull().default("0"),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }),
  expiresAt: timestamp("expires_at"),
  status: mysqlEnum("status", ["active", "inactive", "expired"]).default("active").notNull(),
  maxUses: int("max_uses"),
  currentUses: int("current_uses").default(0).notNull(),
  observations: text("observations"),
  // Origen del código: manual (creado por admin), voucher (bono compensatorio de anulación)
  origin: mysqlEnum("origin", ["manual", "voucher"]).default("manual").notNull(),
  // FK al bono compensatorio que originó este código (solo si origin=voucher)
  compensationVoucherId: int("compensation_voucher_id"),
  // Email del cliente al que se emitió (para uso exclusivo)
  clientEmail: varchar("client_email", { length: 256 }),
  clientName: varchar("client_name", { length: 256 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type DiscountCode = typeof discountCodes.$inferSelect;
export type InsertDiscountCode = typeof discountCodes.$inferInsert;

// ─── DISCOUNT CODE USES (Trazabilidad) ───────────────────────────────────────
export const discountCodeUses = mysqlTable("discount_code_uses", {
  id: int("id").autoincrement().primaryKey(),
  discountCodeId: int("discount_code_id").notNull(),
  code: varchar("code_use", { length: 50 }).notNull(),
  discountPercent: decimal("discount_percent_use", { precision: 5, scale: 2 }).notNull(),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }).notNull(),
  originalAmount: decimal("original_amount_use", { precision: 10, scale: 2 }).notNull(),
  finalAmount: decimal("final_amount", { precision: 10, scale: 2 }).notNull(),
  channel: mysqlEnum("channel_dcu", ["tpv", "online", "crm", "delegated"]).notNull(),
  reservationId: int("reservation_id"),
  tpvSaleId: int("tpv_sale_id"),
  appliedByUserId: varchar("applied_by_user_id", { length: 100 }),
  appliedAt: timestamp("applied_at").defaultNow().notNull(),
});
export type DiscountCodeUse = typeof discountCodeUses.$inferSelect;

// ─── LEGO PACKS ──────────────────────────────────────────────────────────────
// Un Lego Pack es un producto compuesto preconfigurado exclusivamente por el
// administrador. El cliente solo puede activar/desactivar líneas opcionales.
export const legoPacks = mysqlTable("lego_packs", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 256 }).notNull().unique(),
  title: varchar("title", { length: 256 }).notNull(),
  subtitle: varchar("subtitle", { length: 512 }),
  shortDescription: text("shortDescription"),
  description: text("description"),
  // Galería
  coverImageUrl: text("coverImageUrl"),
  image1: text("image1"),
  image2: text("image2"),
  image3: text("image3"),
  image4: text("image4"),
  gallery: json("gallery").$type<string[]>().default([]),
  // Comercial
  badge: varchar("badge", { length: 64 }),
  priceLabel: varchar("priceLabel", { length: 128 }),
  // Categorías / filtros
  categoryId: int("categoryId"),
  category: mysqlEnum("category", ["dia", "escolar", "empresa", "estancia"]).default("dia").notNull(),
  targetAudience: varchar("targetAudience", { length: 256 }),
  // Disponibilidad
  availabilityMode: mysqlEnum("availabilityMode", ["strict", "flexible"]).default("strict").notNull(),
  // Descuento promocional
  discountPercent: decimal("discountPercent", { precision: 5, scale: 2 }),
  discountExpiresAt: timestamp("discountExpiresAt"),
  // Estado
  isActive: boolean("isActive").default(true).notNull(),
  isPublished: boolean("isPublished").default(false).notNull(),
  isFeatured: boolean("isFeatured").default(false).notNull(),
  isPresentialSale: boolean("isPresentialSale").default(true).notNull(),
  isOnlineSale: boolean("isOnlineSale").default(false).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  // SEO
  metaTitle: varchar("metaTitle", { length: 256 }),
  metaDescription: text("metaDescription"),
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type LegoPack = typeof legoPacks.$inferSelect;
export type InsertLegoPack = typeof legoPacks.$inferInsert;

// ─── LEGO PACK LINES (Líneas de composición) ─────────────────────────────────
// Cada línea referencia un producto simple (experience o pack) del catálogo.
// Hereda fiscalidad, proveedor, variables y disponibilidad del producto origen.
export const legoPackLines = mysqlTable("lego_pack_lines", {
  id: int("id").autoincrement().primaryKey(),
  legoPackId: int("legoPackId").notNull(),
  // Producto origen
  sourceType: mysqlEnum("sourceType", ["experience", "pack"]).notNull(),
  sourceId: int("sourceId").notNull(),
  // Metadatos de línea
  internalName: varchar("internalName", { length: 256 }),
  groupLabel: varchar("groupLabel", { length: 128 }),   // ej: "alojamiento", "experiencia", "spa"
  sortOrder: int("sortOrder").default(0).notNull(),
  // Flags de comportamiento
  isActive: boolean("isActive").default(true).notNull(),
  isRequired: boolean("isRequired").default(true).notNull(),    // obligatorio: no se puede quitar
  isOptional: boolean("isOptional").default(false).notNull(),   // opcional: cliente puede quitar
  isClientEditable: boolean("isClientEditable").default(false).notNull(), // cliente puede quitar si es opcional
  isClientVisible: boolean("isClientVisible").default(true).notNull(),
  // Cantidad
  defaultQuantity: int("defaultQuantity").default(1).notNull(),
  isQuantityEditable: boolean("isQuantityEditable").default(false).notNull(),
  // Descuento específico por pack
  discountType: mysqlEnum("discountType", ["percent", "fixed"]).default("percent").notNull(),
  discountValue: decimal("discountValue", { precision: 10, scale: 2 }).default("0").notNull(),
  // Precio override para líneas de alojamiento u otros productos sin precio estático
  // Solo visual — NO afecta al cálculo final del carrito ni a reservas reales
  overridePrice: decimal("overridePrice", { precision: 10, scale: 2 }),
  overridePriceLabel: varchar("overridePriceLabel", { length: 64 }),  // ej: "/ noche", "/ persona", "estimado"
  // Texto informativo para frontend
  frontendNote: text("frontendNote"),
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type LegoPackLine = typeof legoPackLines.$inferSelect;
export type InsertLegoPackLine = typeof legoPackLines.$inferInsert;

// ─── LEGO PACK SNAPSHOTS (Snapshot por operación) ────────────────────────────
// Guarda el estado exacto del pack en el momento de la operación.
// Las operaciones históricas no se alteran si el pack cambia en catálogo.
export const legoPackSnapshots = mysqlTable("lego_pack_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  legoPackId: int("legoPackId").notNull(),
  legoPackTitle: varchar("legoPackTitle", { length: 256 }).notNull(),
  // Referencia a la operación
  operationType: mysqlEnum("operationType", ["reservation", "quote", "tpv_sale", "invoice"]).notNull(),
  operationId: int("operationId").notNull(),
  // Snapshot completo de líneas activas en JSON
  linesSnapshot: json("linesSnapshot").$type<{
    lineId: number;
    sourceType: string;
    sourceId: number;
    sourceName: string;
    internalName?: string;
    groupLabel?: string;
    isRequired: boolean;
    isOptional: boolean;
    isActive: boolean;         // estado elegido por cliente/cajero
    quantity: number;
    basePrice: number;
    discountType: string;
    discountValue: number;
    finalPrice: number;
    fiscalRegime: string;      // heredado del producto origen
    supplierId?: number;
    supplierName?: string;
    supplierCommissionPercent?: number;
    parentLegoPackId: number;
    parentLegoPackName: string;
  }[]>().notNull(),
  // Totales calculados
  totalOriginal: decimal("totalOriginal", { precision: 12, scale: 2 }).notNull(),
  totalDiscount: decimal("totalDiscount", { precision: 12, scale: 2 }).notNull(),
  totalFinal: decimal("totalFinal", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type LegoPackSnapshot = typeof legoPackSnapshots.$inferSelect;
export type InsertLegoPackSnapshot = typeof legoPackSnapshots.$inferInsert;

// ─── FINANCIAL MODULE — GASTOS & CUENTA DE RESULTADOS ────────────────────────

// ── Centros de coste ──────────────────────────────────────────────────────────
export const costCenters = mysqlTable("cost_centers", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CostCenter = typeof costCenters.$inferSelect;
export type InsertCostCenter = typeof costCenters.$inferInsert;

// ── Categorías de gasto ───────────────────────────────────────────────────────
export const expenseCategories = mysqlTable("expense_categories", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ExpenseCategory = typeof expenseCategories.$inferSelect;
export type InsertExpenseCategory = typeof expenseCategories.$inferInsert;

// ── Proveedores de gasto ──────────────────────────────────────────────────────
export const expenseSuppliers = mysqlTable("expense_suppliers", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  fiscalName: varchar("fiscalName", { length: 256 }),
  vatNumber: varchar("vatNumber", { length: 32 }),
  address: text("address"),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 32 }),
  iban: varchar("iban", { length: 64 }),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ExpenseSupplier = typeof expenseSuppliers.$inferSelect;
export type InsertExpenseSupplier = typeof expenseSuppliers.$inferInsert;

// ── Gastos ────────────────────────────────────────────────────────────────────
export const expenses = mysqlTable("expenses", {
  id: int("id").autoincrement().primaryKey(),
  date: varchar("date", { length: 20 }).notNull(),
  concept: varchar("concept", { length: 512 }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  categoryId: int("categoryId").notNull(),
  supplierId: int("supplierId"),
  costCenterId: int("costCenterId").notNull(),
  paymentMethod: mysqlEnum("paymentMethod", [
    "cash", "card", "transfer", "direct_debit", "tpv_cash",
  ]).notNull().default("transfer"),
  status: mysqlEnum("status", ["pending", "justified", "accounted", "conciliado"]).notNull().default("pending"),
  reservationId: int("reservationId"),
  productId: int("productId"),
  notes: text("notes"),
  source: varchar("source", { length: 32 }).default("manual"),
  emailMessageId: varchar("emailMessageId", { length: 512 }),
  emailFrom: varchar("emailFrom", { length: 256 }),
  missingAttachment: boolean("missingAttachment").default(false),
  // ── Gestoría e Impuestos (Fase 0) — desglose fiscal del IVA soportado ──
  // `amount` es el total CON IVA; taxBase = amount / (1 + taxRate/100).
  taxBase: decimal("taxBase", { precision: 12, scale: 2 }),
  taxRate: decimal("taxRate", { precision: 5, scale: 2 }).default("21"),
  taxAmount: decimal("taxAmount", { precision: 12, scale: 2 }),
  deductiblePercent: decimal("deductiblePercent", { precision: 5, scale: 2 }).default("100"),
  supplierNif: varchar("supplierNif", { length: 32 }),
  supplierName: varchar("supplierName", { length: 256 }),
  retentionPercent: decimal("retentionPercent", { precision: 5, scale: 2 }),
  retentionAmount: decimal("retentionAmount", { precision: 12, scale: 2 }),
  invoiceType: mysqlEnum("invoiceType", [
    "ordinaria", "simplificada", "intracomunitaria", "importacion", "exenta", "sin_factura",
  ]).default("ordinaria"),
  accrualDate: varchar("accrualDate", { length: 10 }),
  fiscalReviewStatus: mysqlEnum("fiscalReviewStatus", ["pendiente", "revisado"]).default("pendiente"),
  // ── Tratamiento contable interno ──────────────────────────────────────
  // isOperational = true  → el gasto computa en P&L operativo, EBITDA,
  //                         márgenes, executive summary y dashboards de
  //                         rendimiento del negocio.
  // isOperational = false → "solo fiscal": sigue computando en gestoría,
  //                         IVA (Modelo 303), Impuesto Sociedades, cashflow
  //                         y tesorería, pero NO en KPIs operativos.
  // Default true para compatibilidad total con datos previos.
  isOperational: boolean("isOperational").default(true).notNull(),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Expense = typeof expenses.$inferSelect;
export type InsertExpense = typeof expenses.$inferInsert;

// ── Adjuntos de gasto ─────────────────────────────────────────────────────────
export const expenseFiles = mysqlTable("expense_files", {
  id: int("id").autoincrement().primaryKey(),
  expenseId: int("expenseId").notNull(),
  filePath: varchar("filePath", { length: 1024 }).notNull(),
  fileName: varchar("fileName", { length: 256 }),
  mimeType: varchar("mimeType", { length: 128 }),
  uploadedAt: timestamp("uploadedAt").defaultNow().notNull(),
});
export type ExpenseFile = typeof expenseFiles.$inferSelect;
export type InsertExpenseFile = typeof expenseFiles.$inferInsert;

// ── Gastos recurrentes ────────────────────────────────────────────────────────
export const recurringExpenses = mysqlTable("recurring_expenses", {
  id: int("id").autoincrement().primaryKey(),
  concept: varchar("concept", { length: 512 }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  categoryId: int("categoryId").notNull(),
  costCenterId: int("costCenterId").notNull(),
  supplierId: int("supplierId"),
  recurrenceType: mysqlEnum("recurrenceType", ["monthly", "weekly", "yearly"]).notNull().default("monthly"),
  nextExecutionDate: varchar("nextExecutionDate", { length: 20 }).notNull(),
  active: boolean("active").default(true).notNull(),
  // Tratamiento operativo heredado por los gastos que genera el cron.
  // Ver comentario en `expenses.isOperational`.
  isOperational: boolean("isOperational").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type RecurringExpense = typeof recurringExpenses.$inferSelect;
export type InsertRecurringExpense = typeof recurringExpenses.$inferInsert;

// ─── TICKETING / CUPONES GROUPON ─────────────────────────────────────────────

// Catálogo de productos ticketing (ocultos en frontend normal)
export const ticketingProducts = mysqlTable("ticketing_products", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  provider: varchar("provider", { length: 64 }).notNull().default("Groupon"),
  linkedProductId: int("linkedProductId"), // → experiences.id
  stationsAllowed: json("stationsAllowed"), // array de strings
  rules: text("rules"),
  commission: decimal("commission", { precision: 5, scale: 2 }).default("20.00"),
  expectedPrice: decimal("expectedPrice", { precision: 10, scale: 2 }),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type TicketingProduct = typeof ticketingProducts.$inferSelect;
export type InsertTicketingProduct = typeof ticketingProducts.$inferInsert;

// Solicitudes de canje de cupones
export const couponRedemptions = mysqlTable("coupon_redemptions", {
  id: int("id").autoincrement().primaryKey(),
  provider: varchar("provider", { length: 64 }).notNull().default("Groupon"),
  productTicketingId: int("productTicketingId"), // → ticketingProducts.id
  productRealId: int("productRealId"), // → experiences.id (asignado tras validación)

  // Datos cliente
  customerName: varchar("customerName", { length: 256 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 32 }),

  // Datos cupón
  couponCode: varchar("couponCode", { length: 128 }).notNull(),
  securityCode: varchar("securityCode", { length: 128 }),
  attachmentUrl: mediumtext("attachmentUrl"), // URL S3 o data URL base64 del PDF/imagen del cupón

  // Datos de experiencia solicitada
  requestedDate: varchar("requestedDate", { length: 20 }),
  station: varchar("station", { length: 128 }),
  participants: int("participants").default(1),
  children: int("children").default(0),
  comments: text("comments"),

  // Estados
  statusOperational: mysqlEnum("statusOperational", [
    "recibido", "pendiente", "reserva_generada"
  ]).default("recibido").notNull(),
  statusFinancial: mysqlEnum("statusFinancial", [
    "pendiente_canjear", "canjeado", "incidencia"
  ]).default("pendiente_canjear").notNull(),

  // OCR
  ocrConfidenceScore: int("ocrConfidenceScore"), // 0-100
  ocrStatus: mysqlEnum("ocrStatus", ["alta", "media", "baja", "conflicto"]),
  ocrRawData: json("ocrRawData"), // datos extraídos por OCR

  // Antifraude
  duplicateFlag: boolean("duplicateFlag").default(false).notNull(),
  duplicateNotes: text("duplicateNotes"),

  // Conciliación financiera
  realAmount: decimal("realAmount", { precision: 10, scale: 2 }),
  settlementJustificantUrl: text("settlementJustificantUrl"),
  settledAt: timestamp("settledAt"),

  // Conversión a reserva
  reservationId: int("reservationId"),           // → reservations.id si se convirtió
  platformProductId: int("platformProductId"),   // → platform_products.id (producto de plataforma usado en la conversión)
  settlementId: int("settlementId"),             // → platform_settlements.id (liquidación a la que pertenece este cupón)

  // Agrupación multi-cupón
  submissionId: varchar("submissionId", { length: 64 }), // UUID del envío (varios cupones = mismo submissionId)
  // Origen y canal
  originSource: mysqlEnum("originSource", ["web", "admin_manual_entry"]).default("web").notNull(),
  channelEntry: mysqlEnum("channelEntry", ["web", "email", "whatsapp", "telefono", "presencial", "manual"]).default("web").notNull(),
  createdByAdminId: int("createdByAdminId"), // → users.id si fue alta manual
  // Admin
  adminUserId: int("adminUserId"),
  notes: text("notes"),
  ghlContactId: varchar("ghlContactId", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type CouponRedemption = typeof couponRedemptions.$inferSelect;
export type InsertCouponRedemption = typeof couponRedemptions.$inferInsert;

// ── Configuración de emails automáticos de cupones ──────────────────────────
export const couponEmailConfig = mysqlTable("coupon_email_config", {
  id: int("id").autoincrement().primaryKey(),
  autoSendCouponReceived: boolean("autoSendCouponReceived").default(true).notNull(),
  autoSendCouponValidated: boolean("autoSendCouponValidated").default(true).notNull(),
  autoSendInternalAlert: boolean("autoSendInternalAlert").default(true).notNull(),
  emailMode: mysqlEnum("emailMode", ["per_submission", "per_coupon"]).default("per_submission").notNull(),
  internalAlertEmail: varchar("internalAlertEmail", { length: 320 }).default("reservas@nayadeexperiences.es").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type CouponEmailConfig = typeof couponEmailConfig.$inferSelect;

// ── Plataformas de venta externa (Groupon, Smartbox, etc.) ──────────────────
export const platforms = mysqlTable("platforms", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  logoUrl: text("logo_url"),
  active: boolean("active").default(true).notNull(),
  settlementFrequency: mysqlEnum("settlement_frequency", ["quincenal", "mensual", "trimestral"]).default("mensual").notNull(),
  commissionPct: decimal("commission_pct", { precision: 5, scale: 2 }).default("20.00"),
  externalUrl: text("external_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type Platform = typeof platforms.$inferSelect;
export type InsertPlatform = typeof platforms.$inferInsert;
// ── Productos publicados en plataformas ──────────────────────────────────────────────
export const platformProducts = mysqlTable("platform_products", {
  id: int("id").autoincrement().primaryKey(),
  platformId: int("platform_id").notNull(),           // → platforms.id
  experienceId: int("experience_id"),                 // → experiences.id (producto interno)
  externalLink: text("external_link"),                // URL del producto en la plataforma
  externalProductName: varchar("external_product_name", { length: 256 }),
  pvpPrice: decimal("pvp_price", { precision: 10, scale: 2 }),  // Precio PVP público en la plataforma
  netPrice: decimal("net_price", { precision: 10, scale: 2 }),  // Precio neto que recibimos de la plataforma
  expiresAt: timestamp("expires_at"),                           // Fecha de caducidad del producto en la plataforma
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type PlatformProduct = typeof platformProducts.$inferSelect;
export type InsertPlatformProduct = typeof platformProducts.$inferInsert;

// ── Liquidaciones de plataformas ───────────────────────────────────────────
export const platformSettlements = mysqlTable("platform_settlements", {
  id: int("id").autoincrement().primaryKey(),
  platformId: int("platform_id").notNull(), // → platforms.id
  periodLabel: varchar("period_label", { length: 64 }).notNull(), // ej: "2025-01"
  periodFrom: varchar("period_from", { length: 20 }),
  periodTo: varchar("period_to", { length: 20 }),
  totalCoupons: int("total_coupons").default(0).notNull(),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).default("0.00").notNull(),
  status: mysqlEnum("status", ["pendiente", "emitida", "pagada"]).default("pendiente").notNull(),
  justificantUrl: text("justificant_url"),
  invoiceRef: varchar("invoice_ref", { length: 128 }),  // Referencia de factura / número de liquidación emitida
  couponIds: json("coupon_ids").$type<number[]>().default([]),  // IDs de cupones incluidos en esta liquidación
  netTotal: decimal("net_total", { precision: 10, scale: 2 }).default("0.00"), // Suma de precios netos de los cupones
  notes: text("notes"),
  emittedAt: timestamp("emitted_at"),  // Fecha en que se emitió la liquidación al proveedor
  paidAt: timestamp("paid_at"),        // Fecha en que el proveedor pagó
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type PlatformSettlement = typeof platformSettlements.$inferSelect;
export type InsertPlatformSettlement = typeof platformSettlements.$inferInsert;

// ─── SOLICITUDES DE ANULACIÓN ─────────────────────────────────────────────────
export const cancellationRequests = mysqlTable("cancellation_requests", {
  id: int("id").autoincrement().primaryKey(),
  fullName: varchar("full_name", { length: 256 }).notNull(),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 32 }),
  activityDate: varchar("activity_date", { length: 32 }).notNull(),
  reason: mysqlEnum("reason", [
    "meteorologicas",
    "accidente",
    "enfermedad",
    "desistimiento",
    "otra",
  ]).notNull(),
  reasonDetail: text("reason_detail"),
  termsChecked: boolean("terms_checked").default(false).notNull(),
  source: varchar("source", { length: 64 }).default("landing_publica").notNull(),
  locator: varchar("locator", { length: 128 }),
  originUrl: text("origin_url"),
  ipAddress: varchar("ip_address", { length: 64 }),
  formLanguage: varchar("form_language", { length: 8 }).default("es"),
  linkedReservationId: int("linked_reservation_id"),
  linkedQuoteId: int("linked_quote_id"),
  linkedInvoiceId: int("linked_invoice_id"),
  originalAmount: decimal("original_amount", { precision: 10, scale: 2 }),
  refundableAmount: decimal("refundable_amount", { precision: 10, scale: 2 }),
  resolvedAmount: decimal("resolved_amount", { precision: 10, scale: 2 }),
  activityType: varchar("activity_type", { length: 128 }),
  saleChannel: varchar("sale_channel", { length: 64 }),
  invoiceRef: varchar("invoice_ref", { length: 128 }),
  operationalStatus: mysqlEnum("operational_status", [
    "recibida",
    "en_revision",
    "pendiente_documentacion",
    "pendiente_decision",
    "resuelta",
    "cerrada",
    "incidencia",
  ]).default("recibida").notNull(),
  resolutionStatus: mysqlEnum("resolution_status", [
    "sin_resolver",
    "rechazada",
    "aceptada_total",
    "aceptada_parcial",
  ]).default("sin_resolver").notNull(),
  financialStatus: mysqlEnum("financial_status", [
    "sin_compensacion",
    "pendiente_devolucion",
    "devuelta_economicamente",
    "pendiente_bono",
    "compensada_bono",
    "compensacion_mixta",
    "incidencia_economica",
  ]).default("sin_compensacion").notNull(),
  compensationType: mysqlEnum("compensation_type", [
    "ninguna",
    "devolucion",
    "bono",
    "mixta",
  ]).default("ninguna"),
  voucherId: int("voucher_id"),
  cancellationNumber: varchar("cancellation_number", { length: 32 }),
  // Scope of cancellation: "total" = whole reservation, "lineas" = specific extra lines only
  cancellationScope: varchar("cancellation_scope", { length: 10 }),
  cancelledItemsJson: text("cancelled_items_json"),
  refundExecutedAt: timestamp("refund_executed_at"),
  refundProofUrl: varchar("refund_proof_url", { length: 512 }),
  adminNotes: text("admin_notes"),
  assignedUserId: int("assigned_user_id"),
  ghlContactId: varchar("ghl_contact_id", { length: 128 }),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type CancellationRequest = typeof cancellationRequests.$inferSelect;
export type InsertCancellationRequest = typeof cancellationRequests.$inferInsert;

// ── Importaciones de ficheros bancarios ────────────────────────────────────────
export const bankFileImports = mysqlTable("bank_file_imports", {
  id: int("id").autoincrement().primaryKey(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileType: varchar("file_type", { length: 10 }).notNull(), // xls, xlsx, csv
  importedRows: int("imported_rows").default(0).notNull(),
  duplicatesSkipped: int("duplicates_skipped").default(0).notNull(),
  status: mysqlEnum("status", ["ok", "error", "parcial"]).default("ok").notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type BankFileImport = typeof bankFileImports.$inferSelect;
export type InsertBankFileImport = typeof bankFileImports.$inferInsert;

// ── Movimientos bancarios ──────────────────────────────────────────────────────
export const bankMovements = mysqlTable("bank_movements", {
  id: int("id").autoincrement().primaryKey(),
  importId: int("import_id").notNull(), // → bank_file_imports.id
  fecha: varchar("fecha", { length: 12 }).notNull(),           // YYYY-MM-DD
  fechaValor: varchar("fecha_valor", { length: 12 }),          // YYYY-MM-DD
  movimiento: varchar("movimiento", { length: 255 }),
  masDatos: text("mas_datos"),
  importe: decimal("importe", { precision: 12, scale: 2 }).notNull(),
  saldo: decimal("saldo", { precision: 12, scale: 2 }),
  duplicateKey: varchar("duplicate_key", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["pendiente", "ignorado"]).default("pendiente").notNull(),
  conciliationStatus: mysqlEnum("conciliation_status", ["pendiente", "conciliado"]).default("pendiente").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type BankMovement = typeof bankMovements.$inferSelect;
export type InsertBankMovement = typeof bankMovements.$inferInsert;

// ── Vínculos movimiento bancario ↔ entidad ─────────────────────────────────────
export const bankMovementLinks = mysqlTable("bank_movement_links", {
  id: int("id").autoincrement().primaryKey(),
  bankMovementId: int("bank_movement_id").notNull(),
  entityType: mysqlEnum("entity_type", ["quote", "reservation", "invoice", "expense", "card_terminal_batch", "manual"]).notNull(),
  entityId: int("entity_id").notNull(),
  linkType: mysqlEnum("link_type", ["income_transfer", "card_income", "cash_income", "expense_payment", "manual_conciliation"]).notNull().default("income_transfer"),
  amountLinked: decimal("amount_linked", { precision: 12, scale: 2 }).notNull(),
  status: mysqlEnum("status", ["proposed", "confirmed", "rejected", "unlinked"]).notNull().default("proposed"),
  confidenceScore: int("confidence_score").default(0),
  matchedBy: varchar("matched_by", { length: 255 }),
  matchedAt: timestamp("matched_at"),
  rejectedAt: timestamp("rejected_at"),
  unlinkedAt: timestamp("unlinked_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type BankMovementLink = typeof bankMovementLinks.$inferSelect;
export type InsertBankMovementLink = typeof bankMovementLinks.$inferInsert;

// ─── LOGS / TIMELINE DE SOLICITUDES DE ANULACIÓN ─────────────────────────────
export const cancellationLogs = mysqlTable("cancellation_logs", {
  id: int("id").autoincrement().primaryKey(),
  requestId: int("request_id").notNull(),
  actionType: varchar("action_type", { length: 64 }).notNull(),
  oldStatus: varchar("old_status", { length: 64 }),
  newStatus: varchar("new_status", { length: 64 }),
  payload: json("payload").$type<Record<string, unknown>>(),
  adminUserId: int("admin_user_id"),
  adminUserName: varchar("admin_user_name", { length: 256 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type CancellationLog = typeof cancellationLogs.$inferSelect;
export type InsertCancellationLog = typeof cancellationLogs.$inferInsert;

// ─── BONOS DE COMPENSACIÓN ────────────────────────────────────────────────────
export const compensationVouchers = mysqlTable("compensation_vouchers", {
  id: int("id").autoincrement().primaryKey(),
  requestId: int("request_id").notNull(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  type: mysqlEnum("type", ["actividad", "servicio", "monetario"]).default("actividad").notNull(),
  activityId: int("activity_id"),
  activityName: varchar("activity_name", { length: 256 }),
  value: decimal("value", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("EUR").notNull(),
  issuedAt: timestamp("issued_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
  status: mysqlEnum("status", [
    "generado",
    "enviado",
    "canjeado",
    "caducado",
    "anulado",
  ]).default("generado").notNull(),
  pdfUrl: text("pdf_url"),
  conditions: text("conditions"),
  notes: text("notes"),
  sentAt: timestamp("sent_at"),
  redeemedAt: timestamp("redeemed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type CompensationVoucher = typeof compensationVouchers.$inferSelect;
export type InsertCompensationVoucher = typeof compensationVouchers.$inferInsert;

// ─── Email Templates (editable desde el CRM) ─────────────────────────────────
export const emailTemplates = mysqlTable("email_templates", {
  id: varchar("id", { length: 100 }).primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 50 }).notNull().default("general"),
  recipient: varchar("recipient", { length: 20 }).notNull().default("cliente"),
  subject: varchar("subject", { length: 300 }).notNull(),
  headerImageUrl: text("header_image_url"),
  headerTitle: varchar("header_title", { length: 200 }),
  headerSubtitle: varchar("header_subtitle", { length: 300 }),
  bodyHtml: text("body_html").notNull(),
  footerText: text("footer_text"),
  ctaLabel: varchar("cta_label", { length: 100 }),
  ctaUrl: text("cta_url"),
  variables: text("variables"),
  isCustom: boolean("is_custom").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type InsertEmailTemplate = typeof emailTemplates.$inferInsert;

// ─── PDF Templates (editable desde el CRM) ───────────────────────────────────
export const pdfTemplates = mysqlTable("pdf_templates", {
  id: varchar("id", { length: 100 }).primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 50 }).notNull().default("general"),
  logoUrl: text("logo_url"),
  headerColor: varchar("header_color", { length: 20 }).default("#0a1628"),
  accentColor: varchar("accent_color", { length: 20 }).default("#f97316"),
  companyName: varchar("company_name", { length: 200 }),
  companyAddress: text("company_address"),
  companyPhone: varchar("company_phone", { length: 50 }),
  companyEmail: varchar("company_email", { length: 200 }),
  companyNif: varchar("company_nif", { length: 50 }),
  footerText: text("footer_text"),
  legalText: text("legal_text"),
  showLogo: boolean("show_logo").default(true).notNull(),
  showWatermark: boolean("show_watermark").default(false).notNull(),
  bodyHtml: text("body_html").notNull(),
  variables: text("variables"),
  isCustom: boolean("is_custom").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type PdfTemplate = typeof pdfTemplates.$inferSelect;
export type InsertPdfTemplate = typeof pdfTemplates.$inferInsert;

// ─── MONITORS / EMPLEADOS ────────────────────────────────────────────────────
// Tabla física: `monitors`. En código nuevo se accede como `employees` (alias
// más abajo) — siguiendo el plan de Fase 1 del módulo Personal/RRHH:
// reutilizamos la tabla sin renombrar para preservar FKs como
// reservation_operational.monitor_id.
export const monitors = mysqlTable("monitors", {
  id: int("id").autoincrement().primaryKey(),
  // Datos personales
  fullName: varchar("full_name", { length: 255 }).notNull(),
  dni: varchar("dni", { length: 20 }),
  phone: varchar("phone", { length: 30 }),
  email: varchar("email", { length: 255 }),
  address: text("address"),
  birthDate: timestamp("birth_date"),
  photoUrl: text("photo_url"),
  photoKey: varchar("photo_key", { length: 512 }),
  // Contacto de emergencia
  emergencyName: varchar("emergency_name", { length: 255 }),
  emergencyRelation: varchar("emergency_relation", { length: 128 }),
  emergencyPhone: varchar("emergency_phone", { length: 30 }),
  // Datos bancarios
  iban: varchar("iban", { length: 34 }),
  ibanHolder: varchar("iban_holder", { length: 255 }),
  // Contrato
  contractType: mysqlEnum("contract_type", ["indefinido", "temporal", "autonomo", "practicas", "otro"]).default("temporal"),
  contractStart: timestamp("contract_start"),
  contractEnd: timestamp("contract_end"),
  contractConditions: text("contract_conditions"),
  // Estado
  isActive: boolean("is_active").default(true).notNull(),
  notes: text("notes"),
  // Vínculo con usuario del sistema (opcional)
  userId: int("user_id"),
  // ─── Fase 1 RRHH (migración 0100): datos de empleado ──
  position: varchar("position", { length: 64 }),
  department: varchar("department", { length: 64 }),
  weeklyHours: decimal("weekly_hours", { precision: 5, scale: 2 }),
  holidayDaysYear: int("holiday_days_year").default(22),
  nss: varchar("nss", { length: 20 }),
  irpfPercent: decimal("irpf_percent", { precision: 5, scale: 2 }),
  costCenterId: int("cost_center_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type Monitor = typeof monitors.$inferSelect;
export type InsertMonitor = typeof monitors.$inferInsert;

// Alias conceptual para el código nuevo de RRHH. Apunta a la misma tabla MySQL.
export const employees = monitors;
export type Employee = Monitor;
export type InsertEmployee = InsertMonitor;

// ─── MONITOR DOCUMENTS / EMPLOYEE DOCUMENTS ──────────────────────────────────
export const monitorDocuments = mysqlTable("monitor_documents", {
  id: int("id").autoincrement().primaryKey(),
  monitorId: int("monitor_id").notNull(),
  type: mysqlEnum("type", [
    "dni",
    "contrato",
    "certificado",
    // Ampliado por migración 0101 (Fase 1 RRHH)
    "prl",
    "formacion",
    "nomina_pdf",
    "baja_medica",
    "finiquito",
    "otro",
  ]).notNull().default("otro"),
  name: varchar("name", { length: 255 }).notNull(),
  fileUrl: text("file_url").notNull(),
  fileKey: varchar("file_key", { length: 512 }).notNull(),
  uploadedBy: int("uploaded_by"),
  // ─── Fase 1 RRHH (migración 0101) ──
  expiresAt: date("expires_at"),
  signedByEmployeeAt: timestamp("signed_by_employee_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type MonitorDocument = typeof monitorDocuments.$inferSelect;

// Alias conceptual para RRHH.
export const employeeDocuments = monitorDocuments;
export type EmployeeDocument = MonitorDocument;

// ─── MONITOR PAYROLL (Nóminas) ───────────────────────────────────────────────
export const monitorPayroll = mysqlTable("monitor_payroll", {
  id: int("id").autoincrement().primaryKey(),
  monitorId: int("monitor_id").notNull(),
  year: int("year").notNull(),
  month: int("month").notNull(), // 1-12
  baseSalary: decimal("base_salary", { precision: 10, scale: 2 }).notNull().default("0"),
  extras: json("extras").$type<Array<{concept: string; amount: number; type: string}>>().default([]),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  status: mysqlEnum("status", ["pendiente", "pagado"]).default("pendiente").notNull(),
  paidAt: timestamp("paid_at"),
  notes: text("notes"),
  createdBy: int("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type MonitorPayroll = typeof monitorPayroll.$inferSelect;

// ─── RESERVATION OPERATIONAL FIELDS (campos operativos en reservas) ──────────
export const reservationOperational = mysqlTable("reservation_operational", {
  id: int("id").autoincrement().primaryKey(),
  reservationId: int("reservation_id").notNull().unique(),
  reservationType: mysqlEnum("reservation_type", ["activity", "restaurant", "hotel", "spa", "pack"]).notNull().default("activity"),
  clientConfirmed: boolean("client_confirmed").default(false).notNull(),
  clientConfirmedAt: timestamp("client_confirmed_at"),
  clientConfirmedBy: int("client_confirmed_by"),
  arrivalTime: varchar("arrival_time", { length: 10 }), // "HH:MM"
  opNotes: text("op_notes"),
  monitorId: int("monitor_id"),
  opStatus: mysqlEnum("op_status", ["pendiente", "confirmado", "incidencia", "completado", "anulado"]).default("pendiente").notNull(),
  activitiesOpJson: json("activities_op_json").$type<Array<{ index: number; monitorId?: number | null; arrivalTime?: string; opNotes?: string }>>(),
  updatedBy: int("updated_by"),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type ReservationOperational = typeof reservationOperational.$inferSelect;

// ─── DOCUMENT COUNTERS (sistema de numeración correlativa centralizado) ───────
export const documentCounters = mysqlTable("document_counters", {
  id: int("id").autoincrement().primaryKey(),
  documentType: varchar("document_type", { length: 32 }).notNull(), // presupuesto, factura, reserva, tpv, cupon, liquidacion, anulacion
  year: int("year").notNull(),
  currentNumber: int("current_number").notNull().default(0),
  prefix: varchar("prefix", { length: 16 }).notNull(), // PRES, FAC, RES, TPV, CUP, LIQ, ANU
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type DocumentCounter = typeof documentCounters.$inferSelect;

// ─── DOCUMENT NUMBER LOGS (auditoría de generación de números) ────────────────
export const documentNumberLogs = mysqlTable("document_number_logs", {
  id: int("id").autoincrement().primaryKey(),
  documentType: varchar("document_type", { length: 32 }).notNull(),
  documentNumber: varchar("document_number", { length: 64 }).notNull(),
  year: int("year").notNull(),
  sequence: int("sequence").notNull(),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
  generatedBy: varchar("generated_by", { length: 64 }), // userId o 'system'
  context: varchar("context", { length: 128 }), // e.g. 'crm:confirmPayment', 'tpv:createSale'
});
export type DocumentNumberLog = typeof documentNumberLogs.$inferSelect;

// ─── PENDING PAYMENTS (pagos pendientes de cobro) ────────────────────────────
export const pendingPayments = mysqlTable("pending_payments", {
  id: int("id").autoincrement().primaryKey(),
  quoteId: int("quote_id").notNull(),
  reservationId: int("reservation_id"),
  clientName: varchar("client_name", { length: 255 }).notNull(),
  clientEmail: varchar("client_email", { length: 255 }),
  clientPhone: varchar("client_phone", { length: 64 }),
  productName: varchar("product_name", { length: 255 }),
  amountCents: int("amount_cents").notNull(),
  dueDate: varchar("due_date", { length: 32 }).notNull(),
  reason: text("reason").notNull(),
  status: mysqlEnum("pp_status", ["pending", "paid", "cancelled", "incidentado"]).default("pending").notNull(),
  paymentMethod: varchar("payment_method", { length: 32 }),
  paymentNote: text("payment_note"),
  transferProofUrl: text("transfer_proof_url"),
  paidAt: bigint("paid_at", { mode: "number" }),
  reminderSentAt: bigint("reminder_sent_at", { mode: "number" }),
  createdBy: int("created_by"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});
export type PendingPayment = typeof pendingPayments.$inferSelect;

// ─── PLANES DE PAGO FRACCIONADO ──────────────────────────────────────────────
// Un presupuesto puede tener como máximo UN plan de pagos.
// Si paymentPlanId en quotes es NULL → flujo de pago total clásico (sin cambios).
// Si existe un plan → el cobro se gestiona mediante cuotas/installments.

export const paymentPlans = mysqlTable("payment_plans", {
  id: int("id").autoincrement().primaryKey(),
  quoteId: int("quote_id").notNull(),
  planType: mysqlEnum("plan_type", ["full", "installment"]).default("installment").notNull(),
  totalAmountCents: int("total_amount_cents").notNull(),
  createdBy: int("created_by").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PaymentPlan = typeof paymentPlans.$inferSelect;

export const paymentInstallments = mysqlTable("payment_installments", {
  id: int("id").autoincrement().primaryKey(),
  planId: int("plan_id").notNull(),
  quoteId: int("quote_id").notNull(),        // denormalizado para queries directas
  installmentNumber: int("installment_number").notNull(),
  amountCents: int("amount_cents").notNull(),
  dueDate: varchar("due_date", { length: 20 }).notNull(),
  status: mysqlEnum("status", [
    "pending",
    "paid",
    "overdue",
    "cancelled",
  ]).default("pending").notNull(),
  // Si true, el pago de esta cuota permite confirmar la reserva principal
  isRequiredForConfirmation: boolean("is_required_for_confirmation").default(false).notNull(),
  // Referencia al intento de pago Redsys para esta cuota (su propio merchantOrder)
  merchantOrder: varchar("merchant_order", { length: 30 }),
  // Reserva creada para el pago de esta cuota vía Redsys
  reservationId: int("reservation_id"),
  // Datos del pago confirmado
  paymentMethod: varchar("payment_method", { length: 32 }),
  paidAt: timestamp("paidAt"),
  paidBy: varchar("paid_by", { length: 128 }),   // "redsys" | "admin:userId"
  // Trazabilidad de recordatorios
  remindersSent: int("reminders_sent").default(0).notNull(),
  lastReminderAt: timestamp("lastReminderAt"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PaymentInstallment = typeof paymentInstallments.$inferSelect;

// ── TPV (Datafono / Card Terminal) Operations ─────────────────────────────────

export const cardTerminalOperations = mysqlTable("card_terminal_operations", {
  id: int("id").primaryKey().autoincrement(),
  // Datos del extracto
  operationDatetime: timestamp("operation_datetime").notNull(),
  operationNumber: varchar("operation_number", { length: 64 }).notNull(),
  commerceCode: varchar("commerce_code", { length: 64 }),
  terminalCode: varchar("terminal_code", { length: 64 }),
  operationType: mysqlEnum("operation_type", ["VENTA", "DEVOLUCION", "ANULACION", "OTRO"]).notNull().default("VENTA"),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  card: varchar("card", { length: 32 }),
  authorizationCode: varchar("authorization_code", { length: 32 }),
  // Conciliación
  linkedEntityType: mysqlEnum("linked_entity_type", ["reservation", "quote", "none"]).default("none"),
  linkedEntityId: int("linked_entity_id"),
  linkedAt: timestamp("linked_at"),
  linkedBy: varchar("linked_by", { length: 128 }),
  // Estado
  status: mysqlEnum("status", ["pendiente", "conciliado", "incidencia", "ignorado", "included_in_batch", "settled"]).notNull().default("pendiente"),
  incidentReason: text("incident_reason"),
  notes: text("notes"),
  // Importación
  importId: int("import_id"),
  duplicateKey: varchar("duplicate_key", { length: 255 }).notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const tpvFileImports = mysqlTable("tpv_file_imports", {
  id: int("id").primaryKey().autoincrement(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileType: varchar("file_type", { length: 16 }).notNull(),
  importedRows: int("imported_rows").notNull().default(0),
  duplicatesSkipped: int("duplicates_skipped").notNull().default(0),
  status: mysqlEnum("status", ["ok", "error"]).notNull().default("ok"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type CardTerminalOperation = typeof cardTerminalOperations.$inferSelect;
export type TpvFileImport = typeof tpvFileImports.$inferSelect;

// ── Remesas TPV (Card Terminal Batches) ──────────────────────────────────────

export const cardTerminalBatches = mysqlTable("card_terminal_batches", {
  id: int("id").primaryKey().autoincrement(),
  batchDate: varchar("batch_date", { length: 12 }).notNull(),
  commerceCode: varchar("commerce_code", { length: 64 }),
  terminalCode: varchar("terminal_code", { length: 64 }),
  currency: varchar("currency", { length: 8 }).notNull().default("EUR"),
  totalSales: decimal("total_sales", { precision: 12, scale: 2 }).notNull().default("0.00"),
  totalRefunds: decimal("total_refunds", { precision: 12, scale: 2 }).notNull().default("0.00"),
  totalNet: decimal("total_net", { precision: 12, scale: 2 }).notNull().default("0.00"),
  operationCount: int("operation_count").notNull().default(0),
  linkedOperationsCount: int("linked_operations_count").notNull().default(0),
  status: mysqlEnum("status", ["pending", "suggested", "auto_ready", "reconciled", "difference", "ignored", "review_required"]).notNull().default("pending"),
  bankMovementId: int("bank_movement_id"),
  suggestedBankMovementId: int("suggested_bank_movement_id"),
  suggestedScore: int("suggested_score"),
  matchingRunAt: timestamp("matching_run_at"),
  suggestionRejected: boolean("suggestion_rejected").notNull().default(false),
  reconciledAt: timestamp("reconciled_at"),
  reconciledBy: varchar("reconciled_by", { length: 128 }),
  differenceAmount: decimal("difference_amount", { precision: 12, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type CardTerminalBatch = typeof cardTerminalBatches.$inferSelect;
export type InsertCardTerminalBatch = typeof cardTerminalBatches.$inferInsert;

export const cardTerminalBatchOperations = mysqlTable("card_terminal_batch_operations", {
  id: int("id").primaryKey().autoincrement(),
  batchId: int("batch_id").notNull(),
  cardTerminalOperationId: int("card_terminal_operation_id").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  operationType: mysqlEnum("operation_type", ["VENTA", "DEVOLUCION", "ANULACION", "OTRO"]).notNull().default("VENTA"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type CardTerminalBatchOperation = typeof cardTerminalBatchOperations.$inferSelect;

// ── Audit log for batch matching and reconciliation ───────────────────────────

export const cardTerminalBatchAuditLogs = mysqlTable("card_terminal_batch_audit_logs", {
  id: int("id").primaryKey().autoincrement(),
  batchId: int("batch_id").notNull(),
  action: mysqlEnum("action", [
    "match_suggested",
    "match_auto_ready",
    "match_no_candidate",
    "match_review_required",
    "suggestion_accepted",
    "suggestion_rejected",
    "auto_reconciled",
    "manual_reconciled",
    "unreconciled",
    "review_flagged",
  ]).notNull(),
  bankMovementId: int("bank_movement_id"),
  score: int("score"),
  autoReconciled: boolean("auto_reconciled").notNull().default(false),
  performedBy: varchar("performed_by", { length: 128 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type CardTerminalBatchAuditLog = typeof cardTerminalBatchAuditLogs.$inferSelect;

export const emailIngestionLogs = mysqlTable("email_ingestion_logs", {
  id: int("id").primaryKey().autoincrement(),
  messageId: varchar("message_id", { length: 512 }).notNull(),
  subject: varchar("subject", { length: 512 }),
  sender: varchar("sender", { length: 255 }),
  receivedAt: timestamp("received_at"),
  status: mysqlEnum("status", ["ok", "error", "skipped"]).notNull().default("ok"),
  parsingStrategy: varchar("parsing_strategy", { length: 16 }),
  operationsDetected: int("operations_detected").notNull().default(0),
  operationsInserted: int("operations_inserted").notNull().default(0),
  operationsDuplicate: int("operations_duplicate").notNull().default(0),
  operationsLinked: int("operations_linked").notNull().default(0),
  operationsFailed: int("operations_failed").notNull().default(0),
  retryCount: int("retry_count").notNull().default(0),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type EmailIngestionLog = typeof emailIngestionLogs.$inferSelect;

// ─── Logs de ingesta de gastos por email ─────────────────────────────────────
export const expenseEmailIngestionLogs = mysqlTable("expense_email_ingestion_logs", {
  id: int("id").primaryKey().autoincrement(),
  messageId: varchar("message_id", { length: 512 }).notNull(),
  subject: varchar("subject", { length: 512 }),
  sender: varchar("sender", { length: 256 }),
  receivedAt: timestamp("received_at"),
  status: mysqlEnum("status", ["processed", "duplicated", "invalid_subject", "missing_amount", "error"]).notNull(),
  expenseId: int("expense_id"),
  amountDetected: decimal("amount_detected", { precision: 12, scale: 2 }),
  attachmentsCount: int("attachments_count").default(0),
  errorMessage: text("error_message"),
  processedAt: timestamp("processed_at").defaultNow().notNull(),
});
export type ExpenseEmailIngestionLog = typeof expenseEmailIngestionLogs.$inferSelect;

// ─── MÓDULO CAJA CONTABLE (Financial Cash Register) ──────────────────────────

export const finCashAccounts = mysqlTable("fin_cash_accounts", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  type: mysqlEnum("type", ["principal", "secondary", "petty_cash", "other"]).notNull().default("principal"),
  currentBalance: decimal("current_balance", { precision: 12, scale: 2 }).notNull().default("0.00"),
  initialBalance: decimal("initial_balance", { precision: 12, scale: 2 }).notNull().default("0.00"),
  currency: varchar("currency", { length: 8 }).notNull().default("EUR"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type FinCashAccount = typeof finCashAccounts.$inferSelect;
export type InsertFinCashAccount = typeof finCashAccounts.$inferInsert;

export const finCashMovements = mysqlTable("fin_cash_movements", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("account_id").notNull(),
  date: varchar("date", { length: 10 }).notNull(),
  type: mysqlEnum("type_fcm", ["income", "expense", "transfer_in", "transfer_out", "opening_balance", "adjustment"]).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  concept: varchar("concept", { length: 512 }).notNull(),
  counterparty: varchar("counterparty", { length: 256 }),
  category: varchar("category", { length: 128 }),
  relatedEntityType: mysqlEnum("related_entity_type", ["reservation", "expense", "tpv_sale", "bank_deposit", "manual"]).default("manual"),
  relatedEntityId: int("related_entity_id"),
  transferToAccountId: int("transfer_to_account_id"),
  notes: text("notes"),
  createdBy: int("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type FinCashMovement = typeof finCashMovements.$inferSelect;
export type InsertFinCashMovement = typeof finCashMovements.$inferInsert;

export const finCashClosures = mysqlTable("fin_cash_closures", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("account_id").notNull(),
  date: varchar("date", { length: 10 }).notNull(),
  openingBalance: decimal("opening_balance", { precision: 12, scale: 2 }).notNull().default("0.00"),
  totalIncome: decimal("total_income", { precision: 12, scale: 2 }).notNull().default("0.00"),
  totalExpenses: decimal("total_expenses", { precision: 12, scale: 2 }).notNull().default("0.00"),
  closingBalance: decimal("closing_balance", { precision: 12, scale: 2 }).notNull().default("0.00"),
  countedAmount: decimal("counted_amount", { precision: 12, scale: 2 }),
  difference: decimal("difference", { precision: 12, scale: 2 }),
  status: mysqlEnum("status_fcc", ["open", "closed", "reconciled", "balanced", "difference", "reviewed", "adjusted", "accepted_difference"]).notNull().default("open"),
  sourceEntityType: varchar("source_entity_type", { length: 32 }),
  sourceEntityId: int("source_entity_id"),
  notes: text("notes"),
  closedBy: int("closed_by"),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type FinCashClosure = typeof finCashClosures.$inferSelect;
export type InsertFinCashClosure = typeof finCashClosures.$inferInsert;

export const finCashAlerts = mysqlTable("fin_cash_alerts", {
  id: int("id").autoincrement().primaryKey(),
  type: varchar("type", { length: 64 }).notNull().default("cash_difference"),
  severity: mysqlEnum("severity_fca", ["info", "warning", "critical"]).notNull().default("warning"),
  amount: decimal("amount", { precision: 12, scale: 2 }),
  closureId: int("closure_id"),
  sessionId: int("session_id"),
  message: text("message"),
  isRead: boolean("is_read").notNull().default(false),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: varchar("resolved_by", { length: 128 }),
  resolutionNotes: text("resolution_notes"),
  resolutionAction: varchar("resolution_action", { length: 64 }),
  createdBy: int("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type FinCashAlert = typeof finCashAlerts.$inferSelect;
export type InsertFinCashAlert = typeof finCashAlerts.$inferInsert;

export const finCashClosureActions = mysqlTable("fin_cash_closure_actions", {
  id: int("id").autoincrement().primaryKey(),
  closureId: int("closure_id").notNull(),
  actionType: mysqlEnum("action_type_fcca", ["review", "adjustment_created", "accepted_difference", "note_added", "alert_resolved"]).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }),
  notes: text("notes"),
  createdById: int("created_by_id"),
  createdByName: varchar("created_by_name", { length: 128 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type FinCashClosureAction = typeof finCashClosureActions.$inferSelect;

// ─── FEATURE FLAGS ────────────────────────────────────────────────────────────

export const featureFlags = mysqlTable("feature_flags", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 128 }).notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  description: text("description"),
  module: varchar("module", { length: 64 }).notNull().default("general"),
  enabled: boolean("enabled").notNull().default(true),
  defaultEnabled: boolean("default_enabled").notNull().default(true),
  riskLevel: mysqlEnum("risk_level", ["low", "medium", "high"]).notNull().default("low"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type FeatureFlag = typeof featureFlags.$inferSelect;

// ─── SYSTEM SETTINGS ─────────────────────────────────────────────────────────

export const systemSettings = mysqlTable("system_settings", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 128 }).notNull().unique(),
  value: text("value"),
  valueType: mysqlEnum("value_type", ["string", "number", "boolean", "json"]).notNull().default("string"),
  category: varchar("category", { length: 64 }).notNull().default("general"),
  label: varchar("label", { length: 256 }).notNull(),
  description: text("description"),
  isSensitive: boolean("is_sensitive").notNull().default(false),
  isPublic: boolean("is_public").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type SystemSetting = typeof systemSettings.$inferSelect;

// ─── CONFIG CHANGE LOGS ───────────────────────────────────────────────────────

export const configChangeLogs = mysqlTable("config_change_logs", {
  id: int("id").autoincrement().primaryKey(),
  entityType: mysqlEnum("entity_type", ["feature_flag", "system_setting"]).notNull(),
  key: varchar("key", { length: 128 }).notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  changedById: int("changed_by_id"),
  changedByName: varchar("changed_by_name", { length: 128 }),
  changedAt: timestamp("changed_at").defaultNow().notNull(),
});
export type ConfigChangeLog = typeof configChangeLogs.$inferSelect;

// ─── ORGANIZATIONS ────────────────────────────────────────────────────────────

export const organizations = mysqlTable("organizations", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  slug: varchar("slug", { length: 128 }).notNull().unique(),
  status: mysqlEnum("status", ["active", "inactive", "onboarding"]).notNull().default("onboarding"),
  ownerUserId: int("owner_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type Organization = typeof organizations.$inferSelect;

// ─── ONBOARDING STATUS ────────────────────────────────────────────────────────

export const onboardingStatus = mysqlTable("onboarding_status", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organization_id").notNull().unique(),
  businessInfoCompleted: boolean("business_info_completed").notNull().default(false),
  fiscalCompleted: boolean("fiscal_completed").notNull().default(false),
  brandingCompleted: boolean("branding_completed").notNull().default(false),
  emailsCompleted: boolean("emails_completed").notNull().default(false),
  modulesCompleted: boolean("modules_completed").notNull().default(false),
  integrationsReviewed: boolean("integrations_reviewed").notNull().default(false),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type OnboardingStatus = typeof onboardingStatus.$inferSelect;

// ─── RBAC: ROLES ─────────────────────────────────────────────────────────────
// Catálogo de roles. Los roles con is_legacy=true mapean 1:1 con users.role enum.
// Los nuevos roles (is_legacy=false) están preparados para la siguiente fase
// donde se asignarán permisos y se migrará users.role al sistema RBAC completo.

// ─── RBAC: USER ROLE ASSIGNMENTS ─────────────────────────────────────────────
// Asigna roles RBAC a usuarios. Coexiste con users.role (legacy) sin reemplazarlo.
// Composite PK (user_id, role_id) enforced at DB level.

export const rbacUserRoles = mysqlTable("rbac_user_roles", {
  userId: int("user_id").notNull(),
  roleId: int("role_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type RbacUserRole = typeof rbacUserRoles.$inferSelect;

// ─── RBAC: PERMISSIONS ───────────────────────────────────────────────────────

export const rbacPermissions = mysqlTable("rbac_permissions", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 128 }).notNull().unique(),
  module: varchar("module", { length: 64 }).notNull(),
  action: varchar("action", { length: 128 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type RbacPermission = typeof rbacPermissions.$inferSelect;

// Composite PK (role_id, permission_id) enforced at DB level in the migration.
export const rbacRolePermissions = mysqlTable("rbac_role_permissions", {
  roleId: int("role_id").notNull(),
  permissionId: int("permission_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type RbacRolePermission = typeof rbacRolePermissions.$inferSelect;

// ─── RBAC: ROLES ─────────────────────────────────────────────────────────────
// Catálogo de roles. Los roles con is_legacy=true mapean 1:1 con users.role enum.
// Los nuevos roles (is_legacy=false) están preparados para la siguiente fase
// donde se asignarán permisos y se migrará users.role al sistema RBAC completo.

export const rbacRoles = mysqlTable("rbac_roles", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  isLegacy: boolean("is_legacy").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: int("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type RbacRole = typeof rbacRoles.$inferSelect;

// ─── MÓDULO ATENCIÓN COMERCIAL ────────────────────────────────────────────────
// commercial_followup_settings y commercial_followup_rules eliminadas en Fase 5.
// La configuración global y las reglas viven ahora en email_automation_rules.

export const quoteCommercialTracking = mysqlTable("quote_commercial_tracking", {
  id: int("id").autoincrement().primaryKey(),
  quoteId: int("quoteId").notNull().unique(),
  commercialStatus: mysqlEnum("commercialStatus", [
    "pending_followup", "reminder_1_sent", "reminder_2_sent", "reminder_3_sent",
    "interested", "paused", "lost", "converted", "discarded",
  ]).notNull().default("pending_followup"),
  reminderPaused: boolean("reminderPaused").notNull().default(false),
  reminderPausedReason: text("reminderPausedReason"),
  reminderCount: int("reminderCount").notNull().default(0),
  lastReminderAt: timestamp("lastReminderAt"),
  nextFollowupAt: timestamp("nextFollowupAt"),
  lastContactAt: timestamp("lastContactAt"),
  lastContactChannel: mysqlEnum("lastContactChannel", ["email", "phone", "whatsapp", "internal"]),
  lostReason: text("lostReason"),
  internalNotes: text("internalNotes"),
  assignedToUserId: int("assignedToUserId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type QuoteCommercialTracking = typeof quoteCommercialTracking.$inferSelect;

// commercial_communications eliminada en Fase 5. Su contenido se migró a
// email_comm_log (emails) y quote_internal_notes (notas) por la migración 0098.

// ─── VAPI CALLS ───────────────────────────────────────────────────────────────

export const vapiCalls = mysqlTable("vapi_calls", {
  id: int("id").autoincrement().primaryKey(),
  vapiCallId: varchar("vapiCallId", { length: 128 }).notNull().unique(),
  assistantId: varchar("assistantId", { length: 128 }),
  phoneNumber: varchar("phoneNumber", { length: 32 }),
  customerName: varchar("customerName", { length: 255 }),
  customerEmail: varchar("customerEmail", { length: 320 }),
  startedAt: timestamp("startedAt"),
  endedAt: timestamp("endedAt"),
  durationSeconds: int("durationSeconds"),
  status: varchar("status", { length: 64 }),
  endedReason: varchar("endedReason", { length: 128 }),
  recordingUrl: text("recordingUrl"),
  transcript: mediumtext("transcript"),
  summary: text("summary"),
  structuredData: json("structuredData"),
  rawPayload: json("rawPayload"),
  linkedLeadId: int("linkedLeadId"),
  linkedBudgetId: int("linkedBudgetId"),
  linkedReservationId: int("linkedReservationId"),
  reviewed: boolean("reviewed").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VapiCall = typeof vapiCalls.$inferSelect;
export type InsertVapiCall = typeof vapiCalls.$inferInsert;

export type InsertFinCashClosureAction = typeof finCashClosureActions.$inferInsert;

// ─── COMMERCIAL EMAIL MODULE ──────────────────────────────────────────────────

export const emailAccounts = mysqlTable("email_accounts", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  imapHost: varchar("imap_host", { length: 255 }).notNull().default(""),
  imapPort: int("imap_port").notNull().default(993),
  imapSecure: boolean("imap_secure").notNull().default(true),
  imapUser: varchar("imap_user", { length: 320 }).notNull().default(""),
  imapPasswordEnc: text("imap_password_enc").notNull().default(""),
  smtpHost: varchar("smtp_host", { length: 255 }).notNull().default(""),
  smtpPort: int("smtp_port").notNull().default(587),
  smtpSecure: boolean("smtp_secure").notNull().default(false),
  smtpUser: varchar("smtp_user", { length: 320 }).notNull().default(""),
  smtpPasswordEnc: text("smtp_password_enc").notNull().default(""),
  fromName: varchar("from_name", { length: 255 }).notNull().default(""),
  fromEmail: varchar("from_email", { length: 320 }).notNull().default(""),
  isActive: boolean("is_active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  syncEnabled: boolean("sync_enabled").notNull().default(true),
  syncIntervalMinutes: int("sync_interval_min").notNull().default(5),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncError: text("last_sync_error"),
  folderInbox: varchar("folder_inbox", { length: 100 }).notNull().default("INBOX"),
  folderSent: varchar("folder_sent", { length: 100 }).notNull().default("Sent"),
  folderArchive: varchar("folder_archive", { length: 100 }).notNull().default("Archive"),
  folderTrash: varchar("folder_trash", { length: 100 }).notNull().default("Trash"),
  maxEmailsPerSync: int("max_emails_per_sync").notNull().default(50),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type EmailAccount = typeof emailAccounts.$inferSelect;
export type InsertEmailAccount = typeof emailAccounts.$inferInsert;

export const commercialEmails = mysqlTable("commercial_emails", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("account_id").notNull(),
  messageId: varchar("message_id", { length: 512 }).notNull(),
  inReplyTo: varchar("in_reply_to", { length: 512 }),
  fromEmail: varchar("from_email", { length: 320 }).notNull(),
  fromName: varchar("from_name", { length: 255 }),
  toEmails: json("to_emails").$type<string[]>().notNull(),
  ccEmails: json("cc_emails").$type<string[]>().default([]),
  subject: varchar("subject", { length: 512 }).notNull(),
  bodyHtml: mediumtext("body_html"),
  bodyText: mediumtext("body_text"),
  snippet: varchar("snippet", { length: 300 }),
  sentAt: timestamp("sent_at"),
  isRead: boolean("is_read").notNull().default(false),
  isAnswered: boolean("is_answered").notNull().default(false),
  isArchived: boolean("is_archived").notNull().default(false),
  isDeleted: boolean("is_deleted").notNull().default(false),
  isSent: boolean("is_sent").notNull().default(false),
  folder: varchar("folder", { length: 100 }).notNull().default("INBOX"),
  hasAttachments: boolean("has_attachments").notNull().default(false),
  labels: json("labels").$type<string[]>().default([]),
  assignedUserId: int("assigned_user_id"),
  linkedLeadId: int("linked_lead_id"),
  linkedClientId: int("linked_client_id"),
  linkedQuoteId: int("linked_quote_id"),
  linkedReservationId: int("linked_reservation_id"),
  imapUid: int("imap_uid"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type CommercialEmail = typeof commercialEmails.$inferSelect;

// ─── EMAIL COMMUNICATIONS SYSTEM (Fase 2) ────────────────────────────────────

/** Configuración operativa por plantilla de email (overlay sobre build* functions) */
export const emailTemplateConfigs = mysqlTable("email_template_configs", {
  id:             int("id").autoincrement().primaryKey(),
  key:            varchar("key", { length: 128 }).notNull().unique(),
  category:       varchar("category", { length: 64 }),
  friendlyName:   varchar("friendlyName", { length: 256 }),
  isActive:       boolean("isActive").notNull().default(true),
  sendToCustomer: boolean("sendToCustomer").notNull().default(true),
  sendToAdmin:    boolean("sendToAdmin").notNull().default(false),
  adminCopyEmail: varchar("adminCopyEmail", { length: 320 }),
  customSubject:  varchar("customSubject", { length: 512 }),
  notes:          text("notes"),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
  updatedAt:      timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type EmailTemplateConfig = typeof emailTemplateConfigs.$inferSelect;
export type InsertEmailTemplateConfig = typeof emailTemplateConfigs.$inferInsert;

/** Reglas de automatización: reenvíos programados por plantilla */
export const emailAutomationRules = mysqlTable("email_automation_rules", {
  id:                 int("id").autoincrement().primaryKey(),
  templateKey:        varchar("templateKey", { length: 128 }).notNull(),
  name:               varchar("name", { length: 256 }).notNull(),
  isActive:           boolean("isActive").notNull().default(true),
  sortOrder:          int("sortOrder").notNull().default(0),
  delayHours:         int("delayHours").notNull().default(24),
  calculateFrom:      mysqlEnum("calculateFrom", ["trigger_time", "last_reminder", "created_at", "viewed_at", "expires_at"]).notNull().default("trigger_time"),
  conditionsJson:     json("conditionsJson").$type<Record<string, unknown>>(),
  maxSendsPerEntity:  int("maxSendsPerEntity").notNull().default(1),
  allowedSendStart:   varchar("allowedSendStart", { length: 5 }).notNull().default("09:00"),
  allowedSendEnd:     varchar("allowedSendEnd", { length: 5 }).notNull().default("21:00"),
  stopIfConverted:    boolean("stopIfConverted").notNull().default(true),
  stopIfPaid:         boolean("stopIfPaid").notNull().default(true),
  // Añadidos en Fase 2 para cubrir lo que hoy hace commercial_followup_rules.
  onlyIfNotViewed:             boolean("onlyIfNotViewed").notNull().default(false),
  allowIfViewedButUnpaid:      boolean("allowIfViewedButUnpaid").notNull().default(true),
  maxCumulativeSendsPerEntity: int("maxCumulativeSendsPerEntity"),
  stopAfterDays:               int("stopAfterDays"),
  respectCommercialPause:      boolean("respectCommercialPause").notNull().default(false),
  emailSubject:       varchar("emailSubject", { length: 512 }),
  emailBody:          text("emailBody"),
  createdAt:          timestamp("createdAt").defaultNow().notNull(),
  updatedAt:          timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type EmailAutomationRule = typeof emailAutomationRules.$inferSelect;
export type InsertEmailAutomationRule = typeof emailAutomationRules.$inferInsert;

/** Notas internas no-email asociadas a un presupuesto.
 *  Reemplaza las filas type='internal_note' de commercial_communications.
 *  Introducida en Fase 2; las filas existentes se migrarán en Fase 3. */
export const quoteInternalNotes = mysqlTable("quote_internal_notes", {
  id:           int("id").autoincrement().primaryKey(),
  quoteId:      int("quoteId").notNull(),
  channel:      mysqlEnum("channel", ["email", "phone", "whatsapp", "internal"]).notNull().default("internal"),
  body:         text("body").notNull(),
  authorUserId: int("authorUserId"),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
});
export type QuoteInternalNote = typeof quoteInternalNotes.$inferSelect;
export type InsertQuoteInternalNote = typeof quoteInternalNotes.$inferInsert;

/** Log global de todos los emails salientes */
export const emailCommLog = mysqlTable("email_comm_log", {
  id:                 int("id").autoincrement().primaryKey(),
  leadId:             int("leadId"),
  quoteId:            int("quoteId"),
  reservationId:      int("reservationId"),
  relatedEntityType:  varchar("relatedEntityType", { length: 64 }),
  relatedEntityId:    int("relatedEntityId"),
  templateKey:        varchar("templateKey", { length: 128 }),
  ruleId:             int("ruleId"),
  triggerEvent:       varchar("triggerEvent", { length: 128 }),
  channel:            varchar("channel", { length: 32 }).notNull().default("email"),
  recipientEmail:     varchar("recipientEmail", { length: 320 }),
  ccEmail:            varchar("ccEmail", { length: 320 }),
  subject:            varchar("subject", { length: 512 }),
  status:             mysqlEnum("status", ["sent", "failed", "skipped"]).notNull().default("sent"),
  provider:           varchar("provider", { length: 32 }),
  errorMessage:       text("errorMessage"),
  sentByUserId:       int("sentByUserId"),
  isAutomatic:        boolean("isAutomatic").notNull().default(false),
  skipReason:         varchar("skipReason", { length: 256 }),
  createdAt:          timestamp("createdAt").defaultNow().notNull(),
});
export type EmailCommLog = typeof emailCommLog.$inferSelect;
export type InsertEmailCommLog = typeof emailCommLog.$inferInsert;

/** Cola de jobs programados para reenvíos automáticos */
export const emailScheduledJobs = mysqlTable("email_scheduled_jobs", {
  id:                 int("id").autoincrement().primaryKey(),
  relatedEntityType:  varchar("relatedEntityType", { length: 64 }).notNull(),
  relatedEntityId:    int("relatedEntityId").notNull(),
  templateKey:        varchar("templateKey", { length: 128 }).notNull(),
  ruleId:             int("ruleId").notNull(),
  recipientEmail:     varchar("recipientEmail", { length: 320 }),
  scheduledFor:       timestamp("scheduledFor").notNull(),
  status:             mysqlEnum("status", ["pending", "sent", "skipped", "failed", "cancelled"]).notNull().default("pending"),
  attempts:           int("attempts").notNull().default(0),
  lastAttemptAt:      timestamp("lastAttemptAt"),
  errorMessage:       text("errorMessage"),
  skipReason:         varchar("skipReason", { length: 256 }),
  lockedAt:           timestamp("lockedAt"),
  metadataJson:       json("metadataJson").$type<Record<string, unknown>>(),
  createdAt:          timestamp("createdAt").defaultNow().notNull(),
  updatedAt:          timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type EmailScheduledJob = typeof emailScheduledJobs.$inferSelect;
export type InsertEmailScheduledJob = typeof emailScheduledJobs.$inferInsert;

/** Preferencias de automatización por cliente (email) */
export const customerEmailPrefs = mysqlTable("customer_email_prefs", {
  id:                 int("id").autoincrement().primaryKey(),
  email:              varchar("email", { length: 320 }).notNull().unique(),
  automationsPaused:  boolean("automationsPaused").notNull().default(false),
  pauseReason:        text("pauseReason"),
  pausedAt:           timestamp("pausedAt"),
  pausedByUserId:     int("pausedByUserId"),
  createdAt:          timestamp("createdAt").defaultNow().notNull(),
  updatedAt:          timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type CustomerEmailPref = typeof customerEmailPrefs.$inferSelect;
export type InsertCommercialEmail = typeof commercialEmails.$inferInsert;

// ─── PARTNERS / COLABORADORES ────────────────────────────────────────────────

export const partners = mysqlTable("partners", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  slug: varchar("slug", { length: 128 }).notNull().unique(),
  // Datos fiscales
  fiscalName: varchar("fiscalName", { length: 256 }),
  nif: varchar("nif", { length: 32 }),
  address: text("address"),
  city: varchar("city", { length: 128 }),
  postalCode: varchar("postalCode", { length: 16 }),
  country: varchar("country", { length: 4 }).default("ES").notNull(),
  // Contacto
  contactName: varchar("contactName", { length: 256 }),
  contactEmail: varchar("contactEmail", { length: 320 }),
  contactPhone: varchar("contactPhone", { length: 32 }),
  billingEmail: varchar("billingEmail", { length: 320 }),
  // Capacidades
  canCreateReservations: boolean("canCreateReservations").default(false).notNull(),
  canCreateLeads: boolean("canCreateLeads").default(true).notNull(),
  // Productos permitidos (null = todos)
  allowedReservationProductIds: json("allowedReservationProductIds").$type<number[]>(),
  allowedLeadProductIds: json("allowedLeadProductIds").$type<number[]>(),
  // Comisiones (preparado, por defecto sin comisión)
  commissionType: mysqlEnum("commissionType", ["none", "fixed_lead", "fixed_reservation", "percent", "per_product", "manual"]).default("none").notNull(),
  commissionValue: decimal("commissionValue", { precision: 10, scale: 4 }),
  // Facturación agrupada
  billingEnabled: boolean("billingEnabled").default(false).notNull(),
  billingPeriod: mysqlEnum("billingPeriod", ["weekly", "biweekly", "monthly", "manual"]).default("monthly").notNull(),
  // Control de cupos (null = sin límite)
  monthlyQuota: int("monthlyQuota"),
  // Estado
  isActive: boolean("isActive").default(true).notNull(),
  notes: text("notes"),
  // Notas visibles para los recepcionistas del partner (modal de alertas)
  announcements: json("announcements").$type<{id: string; text: string; isNew: boolean; createdAt: string; expiresAt?: string | null}[]>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Partner = typeof partners.$inferSelect;
export type InsertPartner = typeof partners.$inferInsert;

export const partnerBillingBatches = mysqlTable("partner_billing_batches", {
  id: int("id").autoincrement().primaryKey(),
  batchNumber: varchar("batchNumber", { length: 32 }).notNull().unique(),
  partnerId: int("partnerId").notNull(),
  periodType: mysqlEnum("periodType", ["weekly", "biweekly", "monthly", "manual"]).default("monthly").notNull(),
  periodStart: varchar("periodStart", { length: 10 }).notNull(),
  periodEnd: varchar("periodEnd", { length: 10 }).notNull(),
  totalAmount: decimal("totalAmount", { precision: 12, scale: 2 }).default("0").notNull(),
  status: mysqlEnum("status", ["borrador", "emitida", "cobrada", "anulada"]).default("borrador").notNull(),
  invoiceId: int("invoiceId"),
  notes: text("notes"),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PartnerBillingBatch = typeof partnerBillingBatches.$inferSelect;

export const partnerBillingBatchItems = mysqlTable("partner_billing_batch_items", {
  id: int("id").autoincrement().primaryKey(),
  batchId: int("batchId").notNull(),
  reservationId: int("reservationId").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).default("0").notNull(),
  description: varchar("description", { length: 512 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type PartnerBillingBatchItem = typeof partnerBillingBatchItems.$inferSelect;

// ─── HR — REGISTRO HORARIO (Fase 4) ──────────────────────────────────────────
// Tabla física: hr_time_clock. Cada fila es un par entrada/salida del empleado.
// employeeId apunta a monitors.id (la tabla aliasada como `employees`).
export const hrTimeClock = mysqlTable("hr_time_clock", {
  id: int("id").autoincrement().primaryKey(),
  employeeId: int("employee_id").notNull(),
  clockInAt: timestamp("clock_in_at").notNull(),
  clockOutAt: timestamp("clock_out_at"),
  source: mysqlEnum("source", ["portal", "admin", "tablet", "external"]).notNull().default("portal"),
  metaJson: text("meta_json"),
  status: mysqlEnum("status", ["open", "closed", "incomplete", "edited", "cancelled"]).notNull().default("open"),
  notes: text("notes"),
  createdBy: int("created_by"),
  updatedBy: int("updated_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type HrTimeClockRow = typeof hrTimeClock.$inferSelect;
export type InsertHrTimeClock = typeof hrTimeClock.$inferInsert;

// ─── HR — CALENDARIO LABORAL TEÓRICO (Fase 4) ────────────────────────────────
// Tramos semanales recurrentes por empleado. weekday: 0=Dom … 6=Sáb (JS Date).
// start_time / end_time son strings "HH:MM" en hora local de España.
export const hrScheduleTemplates = mysqlTable("hr_schedule_templates", {
  id: int("id").autoincrement().primaryKey(),
  employeeId: int("employee_id").notNull(),
  weekday: int("weekday").notNull(), // 0-6 (tinyint en MySQL)
  startTime: varchar("start_time", { length: 5 }).notNull(),
  endTime: varchar("end_time", { length: 5 }).notNull(),
  validFrom: date("valid_from", { mode: "string" }),
  validUntil: date("valid_until", { mode: "string" }),
  notes: varchar("notes", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type HrScheduleTemplate = typeof hrScheduleTemplates.$inferSelect;

// Excepciones al calendario teórico. employeeId null = festivo global.
export const hrScheduleExceptions = mysqlTable("hr_schedule_exceptions", {
  id: int("id").autoincrement().primaryKey(),
  employeeId: int("employee_id"),
  date: date("date", { mode: "string" }).notNull(),
  type: mysqlEnum("type", ["festivo", "vacaciones", "baja", "permiso", "otro"]).notNull().default("festivo"),
  notes: varchar("notes", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type HrScheduleException = typeof hrScheduleExceptions.$inferSelect;

// ─── HR — NÓMINAS Y REMESAS (Fase 5) ────────────────────────────────────────
// hr_payslips: nómina oficial mensual (la que firma la gestoría).
// UNIQUE (employeeId, period) impone una sola nómina por mes y empleado.
export const hrPayslips = mysqlTable("hr_payslips", {
  id: int("id").autoincrement().primaryKey(),
  employeeId: int("employee_id").notNull(),
  period: varchar("period", { length: 7 }).notNull(), // "YYYY-MM"
  grossSalary: decimal("gross_salary", { precision: 12, scale: 2 }).notNull().default("0"),
  irpfAmount: decimal("irpf_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  ssEmployee: decimal("ss_employee", { precision: 12, scale: 2 }).notNull().default("0"),
  netSalary: decimal("net_salary", { precision: 12, scale: 2 }).notNull().default("0"),
  ssCompanyEstimated: decimal("ss_company_estimated", { precision: 12, scale: 2 }).notNull().default("0"),
  ssCompanyReal: decimal("ss_company_real", { precision: 12, scale: 2 }),
  batchId: int("batch_id"),
  pdfUrl: text("pdf_url"),
  pdfKey: varchar("pdf_key", { length: 512 }),
  notes: text("notes"),
  status: mysqlEnum("status", ["borrador", "registrada", "pagada", "anulada"]).notNull().default("borrador"),
  fiscalStatus: mysqlEnum("fiscal_status", ["pendiente", "revisado", "exportado", "presentado"]).notNull().default("pendiente"),
  createdBy: int("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type HrPayslip = typeof hrPayslips.$inferSelect;
export type InsertHrPayslip = typeof hrPayslips.$inferInsert;

// hr_payroll_batches: remesa mensual. Una fila por periodo (UNIQUE).
export const hrPayrollBatches = mysqlTable("hr_payroll_batches", {
  id: int("id").autoincrement().primaryKey(),
  period: varchar("period", { length: 7 }).notNull(),
  status: mysqlEnum("status", ["open", "closed", "exported"]).notNull().default("open"),
  fiscalStatus: mysqlEnum("fiscal_status", ["pendiente", "revisado", "exportado", "presentado"]).notNull().default("pendiente"),
  totalGross: decimal("total_gross", { precision: 12, scale: 2 }).notNull().default("0"),
  totalIrpf: decimal("total_irpf", { precision: 12, scale: 2 }).notNull().default("0"),
  totalSsEmployee: decimal("total_ss_employee", { precision: 12, scale: 2 }).notNull().default("0"),
  totalNet: decimal("total_net", { precision: 12, scale: 2 }).notNull().default("0"),
  totalSsCompanyEstimated: decimal("total_ss_company_estimated", { precision: 12, scale: 2 }).notNull().default("0"),
  totalSsCompanyReal: decimal("total_ss_company_real", { precision: 12, scale: 2 }),
  expenseIdsJson: text("expense_ids_json"),
  notes: text("notes"),
  closedAt: timestamp("closed_at"),
  closedBy: int("closed_by"),
  createdBy: int("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type HrPayrollBatch = typeof hrPayrollBatches.$inferSelect;

// hr_irpf_ledger: una fila por nómina o bonus con retención IRPF.
// Alimentará el modelo 111 trimestral y el 190 anual (Gestoría).
export const hrIrpfLedger = mysqlTable("hr_irpf_ledger", {
  id: int("id").autoincrement().primaryKey(),
  period: varchar("period", { length: 7 }).notNull(),
  employeeId: int("employee_id").notNull(),
  taxableBase: decimal("taxable_base", { precision: 12, scale: 2 }).notNull().default("0"),
  retainedAmount: decimal("retained_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  payslipId: int("payslip_id"),
  bonusId: int("bonus_id"),
  fiscalStatus: mysqlEnum("fiscal_status", ["pendiente", "revisado", "exportado", "presentado"]).notNull().default("pendiente"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type HrIrpfLedgerRow = typeof hrIrpfLedger.$inferSelect;

// hr_ss_ledger: una fila por periodo (UNIQUE). Estimación al cerrar batch,
// real cuando llega el cargo TGSS.
export const hrSsLedger = mysqlTable("hr_ss_ledger", {
  id: int("id").autoincrement().primaryKey(),
  period: varchar("period", { length: 7 }).notNull(),
  estimatedAmount: decimal("estimated_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  realAmount: decimal("real_amount", { precision: 12, scale: 2 }),
  realChargedAt: timestamp("real_charged_at"),
  bankMovementId: int("bank_movement_id"),
  batchId: int("batch_id"),
  fiscalStatus: mysqlEnum("fiscal_status", ["pendiente", "revisado", "exportado", "presentado"]).notNull().default("pendiente"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type HrSsLedgerRow = typeof hrSsLedger.$inferSelect;

// hr_bonus: bonus e incentivos (Fase 6). Pagos adicionales a la nómina.
// payment_method:
//   cash     → expense + cash_movement (vía helper, anti-duplicidad)
//   transfer → expense (sin cash_movement)
//   payroll  → sin expense propio (se incluye en la nómina de included_in_payslip_id)
export const hrBonus = mysqlTable("hr_bonus", {
  id: int("id").autoincrement().primaryKey(),
  employeeId: int("employee_id").notNull(),
  type: mysqlEnum("type", ["bonus", "comision", "prima", "gratificacion", "anticipo", "ajuste"]).notNull().default("bonus"),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull().default("0"),
  irpfAmount: decimal("irpf_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  concept: varchar("concept", { length: 256 }).notNull(),
  notes: text("notes"),
  paidAt: timestamp("paid_at"),
  paymentMethod: mysqlEnum("payment_method", ["cash", "transfer", "payroll"]),
  expenseId: int("expense_id"),
  cashMovementId: int("cash_movement_id"),
  includedInPayslipId: int("included_in_payslip_id"),
  status: mysqlEnum("status", ["pendiente", "pagado", "anulado"]).notNull().default("pendiente"),
  fiscalStatus: mysqlEnum("fiscal_status", ["pendiente", "revisado", "exportado", "presentado"]).notNull().default("pendiente"),
  createdBy: int("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type HrBonus = typeof hrBonus.$inferSelect;
export type InsertHrBonus = typeof hrBonus.$inferInsert;

// ─── HR — VACACIONES Y PERMISOS (Fase 8) ────────────────────────────────────
// hr_leave_requests: solicitudes del empleado, aprobadas/rechazadas por admin.
export const hrLeaveRequests = mysqlTable("hr_leave_requests", {
  id: int("id").autoincrement().primaryKey(),
  employeeId: int("employee_id").notNull(),
  type: mysqlEnum("type", ["vacaciones", "asuntos_propios", "baja_medica", "permiso", "otro"]).notNull().default("vacaciones"),
  fromDate: date("from_date", { mode: "string" }).notNull(),
  toDate: date("to_date", { mode: "string" }).notNull(),
  days: decimal("days", { precision: 5, scale: 1 }).notNull().default("0"),
  status: mysqlEnum("status", ["pendiente", "aprobada", "rechazada", "cancelada"]).notNull().default("pendiente"),
  reason: text("reason"),
  decisionReason: text("decision_reason"),
  approvedBy: int("approved_by"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type HrLeaveRequest = typeof hrLeaveRequests.$inferSelect;
export type InsertHrLeaveRequest = typeof hrLeaveRequests.$inferInsert;

// hr_leave_balance: días de vacaciones asignados por empleado y año.
// taken / pending NO se almacenan — se calculan en vivo desde requests.
export const hrLeaveBalance = mysqlTable("hr_leave_balance", {
  id: int("id").autoincrement().primaryKey(),
  employeeId: int("employee_id").notNull(),
  year: int("year").notNull(),
  accruedDays: decimal("accrued_days", { precision: 5, scale: 1 }).notNull().default("22"),
  notes: varchar("notes", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type HrLeaveBalance = typeof hrLeaveBalance.$inferSelect;

// hr_settings: singleton (id=1) con configuración global del módulo.
export const hrSettings = mysqlTable("hr_settings", {
  id: int("id").primaryKey().default(1),
  ssCompanyPercent: decimal("ss_company_percent", { precision: 5, scale: 2 }).notNull().default("31"),
  defaultHolidayDays: int("default_holiday_days").notNull().default(22),
  defaultWeeklyHours: decimal("default_weekly_hours", { precision: 5, scale: 2 }).notNull().default("40"),
  irpfDefaultPercent: decimal("irpf_default_percent", { precision: 5, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type HrSettings = typeof hrSettings.$inferSelect;

// ─── GESTORÍA E IMPUESTOS (Fase 1) ───────────────────────────────────────────

// Espina dorsal: una fila por modelo fiscal + periodo.
export const taxObligations = mysqlTable("tax_obligations", {
  id: int("id").autoincrement().primaryKey(),
  model: mysqlEnum("model", ["303", "390", "111", "190", "200", "202"]).notNull(),
  year: int("year").notNull(),
  periodType: mysqlEnum("period_type", ["trimestral", "anual", "mensual"]).notNull(),
  periodKey: varchar("period_key", { length: 16 }).notNull(),
  periodLabel: varchar("period_label", { length: 96 }).notNull(),
  dueDate: varchar("due_date", { length: 10 }).notNull(),
  estimatedAmount: decimal("estimated_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  presentedAmount: decimal("presented_amount", { precision: 12, scale: 2 }),
  paidAmount: decimal("paid_amount", { precision: 12, scale: 2 }),
  status: mysqlEnum("status", [
    "pendiente", "estimado", "revisado", "enviado_gestoria", "presentado", "pagado", "aplazado", "cerrado",
  ]).notNull().default("pendiente"),
  deferralId: int("deferral_id"),
  presentedAt: timestamp("presented_at"),
  paidAt: timestamp("paid_at"),
  notes: text("notes"),
  // Último umbral (días) con aviso de vencimiento enviado — idempotencia del cron.
  lastReminderDays: int("last_reminder_days"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type TaxObligation = typeof taxObligations.$inferSelect;

// Desglose trazable del importe estimado de cada obligación.
export const taxObligationLines = mysqlTable("tax_obligation_lines", {
  id: int("id").autoincrement().primaryKey(),
  obligationId: int("obligation_id").notNull(),
  concept: varchar("concept", { length: 256 }).notNull(),
  base: decimal("base", { precision: 12, scale: 2 }).notNull().default("0"),
  rate: decimal("rate", { precision: 5, scale: 2 }),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull().default("0"),
  sourceType: varchar("source_type", { length: 32 }),
  sourceRef: varchar("source_ref", { length: 64 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type TaxObligationLine = typeof taxObligationLines.$inferSelect;

// Auditoría de cambios de estado de una obligación.
export const taxObligationLog = mysqlTable("tax_obligation_log", {
  id: int("id").autoincrement().primaryKey(),
  obligationId: int("obligation_id").notNull(),
  fromStatus: varchar("from_status", { length: 32 }),
  toStatus: varchar("to_status", { length: 32 }).notNull(),
  userId: int("user_id"),
  userName: varchar("user_name", { length: 128 }),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type TaxObligationLog = typeof taxObligationLog.$inferSelect;

// Documentos adjuntos a una obligación (modelo presentado, justificante…).
export const taxDocuments = mysqlTable("tax_documents", {
  id: int("id").autoincrement().primaryKey(),
  obligationId: int("obligation_id").notNull(),
  docType: mysqlEnum("doc_type", [
    "modelo_presentado", "justificante_pago", "resolucion", "otro",
  ]).notNull().default("otro"),
  title: varchar("title", { length: 256 }).notNull(),
  fileUrl: text("file_url").notNull(),
  fileKey: varchar("file_key", { length: 512 }),
  uploadedBy: int("uploaded_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type TaxDocument = typeof taxDocuments.$inferSelect;

// Configuración singleton del módulo (id=1).
export const taxSettings = mysqlTable("tax_settings", {
  id: int("id").primaryKey().default(1),
  corporateTaxRate: decimal("corporate_tax_rate", { precision: 5, scale: 2 }).notNull().default("25"),
  fiscalYearEndMonth: int("fiscal_year_end_month").notNull().default(12),
  companyNif: varchar("company_nif", { length: 32 }),
  companyName: varchar("company_name", { length: 256 }),
  companyAddress: text("company_address"),
  gestoriaEmails: text("gestoria_emails"),
  iaeEpigraphs: text("iae_epigraphs"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type TaxSettings = typeof taxSettings.$inferSelect;

// Expedientes ZIP generados para la gestoría (Fase 5).
export const taxDossiers = mysqlTable("tax_dossiers", {
  id: int("id").autoincrement().primaryKey(),
  year: int("year").notNull(),
  scope: mysqlEnum("scope", ["iva", "laboral", "sociedades", "global"]).notNull().default("global"),
  periodKey: varchar("period_key", { length: 16 }).notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  fileUrl: text("file_url"),
  fileKey: varchar("file_key", { length: 512 }),
  fileSize: int("file_size"),
  fileCount: int("file_count"),
  generatedBy: int("generated_by"),
  sentToGestoriaAt: timestamp("sent_to_gestoria_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type TaxDossier = typeof taxDossiers.$inferSelect;

// Aplazamientos y fraccionamientos de obligaciones ante la AEAT (Fase 6).
export const taxDeferrals = mysqlTable("tax_deferrals", {
  id: int("id").autoincrement().primaryKey(),
  obligationId: int("obligation_id").notNull(),
  status: mysqlEnum("status", ["solicitado", "concedido", "denegado", "fraccionado"]).notNull().default("solicitado"),
  requestedAt: varchar("requested_at", { length: 10 }),
  resolutionAt: varchar("resolution_at", { length: 10 }),
  principal: decimal("principal", { precision: 12, scale: 2 }).notNull().default("0"),
  interestRate: decimal("interest_rate", { precision: 5, scale: 2 }),
  installmentCount: int("installment_count").notNull().default(1),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type TaxDeferral = typeof taxDeferrals.$inferSelect;

// Calendario de vencimientos de un aplazamiento.
export const taxDeferralInstallments = mysqlTable("tax_deferral_installments", {
  id: int("id").autoincrement().primaryKey(),
  deferralId: int("deferral_id").notNull(),
  number: int("number").notNull(),
  dueDate: varchar("due_date", { length: 10 }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull().default("0"),
  interest: decimal("interest", { precision: 12, scale: 2 }).notNull().default("0"),
  paidAt: varchar("paid_at", { length: 10 }),
  status: mysqlEnum("status", ["pendiente", "pagada"]).notNull().default("pendiente"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type TaxDeferralInstallment = typeof taxDeferralInstallments.$inferSelect;

// ─── Notification dismissals (campana del AdminLayout) ──────────────────────
// Cada fila representa un item del feed que un admin concreto ha silenciado.
// El feed se construye en server/routers/notifications.ts agregando 6
// fuentes (leads, quotes, cancellations, pending_payments, tpv_alerts,
// upcoming_reservations). El dismiss es por-usuario: silenciar no afecta
// al resto del equipo.
export const adminNotificationDismissals = mysqlTable("admin_notification_dismissals", {
  id:           int("id").autoincrement().primaryKey(),
  userId:       int("user_id").notNull(),
  kind:         varchar("kind", { length: 40 }).notNull(),
  entityId:     int("entity_id").notNull(),
  dismissedAt:  bigint("dismissed_at", { mode: "number" }).notNull(),
});
export type AdminNotificationDismissal = typeof adminNotificationDismissals.$inferSelect;

// ─── SEGOLIFE: UNIVERSITIES ───────────────────────────────────────────────────
// Institución académica real (IE University, Universidad de Valladolid...).
// Uso principal: referencia/verificación (dominio de email), nombre oficial.
// No confundir con `communities` — una universidad puede no tener ninguna
// comunidad Segolife todavía, o (a futuro) tener más de una.
// Ver docs/SEGOLIFE_DOMAIN_MODEL.md.

export const universities = mysqlTable("universities", {
  id:           int("id").autoincrement().primaryKey(),
  name:         varchar("name", { length: 256 }).notNull(),
  slug:         varchar("slug", { length: 128 }).notNull().unique(),
  emailDomain:  varchar("email_domain", { length: 128 }),
  country:      varchar("country", { length: 2 }).notNull().default("ES"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type University = typeof universities.$inferSelect;
export type InsertUniversity = typeof universities.$inferInsert;

// ─── SEGOLIFE: COMMUNITIES ─────────────────────────────────────────────────────
// La unidad real de tenant de Segolife (SEGOLIFE IE, SEGOLIFE UVA, futuros
// campus). Todo el contenido, eventos y promociones se ancla a esto — nunca
// a un literal "ie"/"uva" en código de negocio (ver CLAUDE.md, regla
// arquitectónica fundamental). `defaultLocale`/`availableLocales` son DATOS,
// no lógica: la app nunca decide el idioma comparando el slug de comunidad,
// siempre lee estas columnas.
//
// Reutiliza la forma de la tabla `organizations` (multi-tenant heredada de
// Náyade, existente pero desconectada de todo el resto del sistema — ver
// docs/SEGOLIFE_DOMAIN_MODEL.md §4) como tabla independiente y propia de
// Segolife, en vez de reutilizar `organizations` directamente: `organizations`
// sigue existiendo intacta (no se toca, no se borra) por si en el futuro se
// necesita para otro propósito multi-tenant heredado.
//
// NO tiene columna university_id — ver `communityUniversities` justo debajo.
// Una comunidad puede tener 0, 1 o (a futuro) varias universidades.

export const communities = mysqlTable("communities", {
  id:               int("id").autoincrement().primaryKey(),
  name:             varchar("name", { length: 256 }).notNull(),
  slug:             varchar("slug", { length: 128 }).notNull().unique(),
  defaultLocale:    varchar("default_locale", { length: 8 }).notNull().default("es"),
  availableLocales: json("available_locales").$type<string[]>().notNull().default(["es"]),
  status:           mysqlEnum("status", ["active", "inactive", "onboarding"]).notNull().default("onboarding"),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type Community = typeof communities.$inferSelect;
export type InsertCommunity = typeof communities.$inferInsert;

// ─── SEGOLIFE: COMMUNITY_UNIVERSITIES ──────────────────────────────────────────
// Tabla puente M2M entre `communities` y `universities`. Reemplaza a un
// `communities.university_id` directo (1:N) que se implementó inicialmente
// y contradecía docs/SEGOLIFE_MULTICOMMUNITY_ARCHITECTURE.md: una comunidad
// debe poder abarcar 0, 1 o varias universidades (y una universidad puede
// tener varias comunidades). Corregido antes del primer commit del schema.
// unique(community_id, university_id) evita duplicar el mismo enlace.

export const communityUniversities = mysqlTable("community_universities", {
  id:             int("id").autoincrement().primaryKey(),
  communityId:    int("community_id").notNull(),
  universityId:   int("university_id").notNull(),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  communityUniversityUnique: unique("community_universities_unique").on(table.communityId, table.universityId),
}));
export type CommunityUniversity = typeof communityUniversities.$inferSelect;
export type InsertCommunityUniversity = typeof communityUniversities.$inferInsert;

// ─── SEGOLIFE: USER_COMMUNITIES ────────────────────────────────────────────────
// Tabla puente M2M: a qué comunidad(es) pertenece un usuario. Modelada como
// M2M (no una columna community_id directa en `users`) a propósito: el caso
// normal es 1 usuario = 1 comunidad, pero esto evita tener que migrar `users`
// el día que aparezca un admin global sin comunidad fija o un caso de doble
// afiliación. unique(user_id, community_id) impide duplicar la misma
// membresía a nivel de motor — la capa de aplicación (addUserToCommunity en
// communitiesDb.ts) sigue comprobando primero para devolver un no-op
// silencioso en vez de depender del error de MySQL.
//
// Sin FK real a `users`/`communities` — el schema heredado de Náyade no usa
// FKs reales en ninguna de sus 152 tablas (ver docs/SEGOLIFE_DOMAIN_MODEL.md,
// "Advertencia estructural"); seguimos esa convención aquí para no introducir
// un patrón inconsistente con el resto del proyecto. Consecuencia: borrar un
// usuario o una comunidad NO borra en cascada sus filas de user_communities
// (quedarían huérfanas), igual que en el resto del schema — no se ha
// inventado ninguna cascada destructiva nueva.

export const userCommunities = mysqlTable("user_communities", {
  id:               int("id").autoincrement().primaryKey(),
  userId:           int("user_id").notNull(),
  communityId:      int("community_id").notNull(),
  roleInCommunity:  varchar("role_in_community", { length: 64 }),
  joinedAt:         timestamp("joined_at").defaultNow().notNull(),
}, (table) => ({
  userCommunityUnique: unique("user_communities_user_community_unique").on(table.userId, table.communityId),
}));
export type UserCommunity = typeof userCommunities.$inferSelect;
export type InsertUserCommunity = typeof userCommunities.$inferInsert;

// ─── SEGOLIFE: STUDENT_PROFILES (Fase 1C) ──────────────────────────────────────
// Datos específicos de estudiante, separados de `users` (identidad/auth).
//
// AUDITORÍA — qué vive dónde (ver docs/SEGOLIFE_ROADMAP.md para el detalle):
//   En `users` (reutilizado, NO duplicado aquí): name, email, phone, avatarUrl,
//   isActive, passwordHash/inviteToken/lastSignedIn (auth). `users.role` sigue
//   siendo el enum legacy de Náyade — un estudiante normal usa role="user".
//   En `student_profiles` (nuevo, porque `users.name` es un único campo de
//   texto sin separar nombre/apellidos, y el resto no tiene ningún equivalente
//   heredado): first_name/last_name, y todos los campos académicos/de estancia.
//
// NO tiene community_id — la comunidad del estudiante vive en `user_communities`
// (Fase 1B), nunca duplicada aquí (ver CLAUDE.md, regla arquitectónica).
//
// university_id SÍ es una columna directa aquí (no M2M) — decisión deliberada,
// distinta de `community_universities`: ese M2M modela qué universidades sirve
// una COMUNIDAD (organizativo); esto modela en qué universidad está
// matriculado UN ESTUDIANTE (atributo personal, igual de singular que
// degree_program o academic_year). Para el MVP un estudiante tiene una única
// universidad principal — no se ha bloqueado ningún cambio futuro a M2M
// (`student_universities`) si apareciera un caso real de doble titulación;
// no se ha construido de más sin necesidad.

export const studentProfiles = mysqlTable("student_profiles", {
  id:                     int("id").autoincrement().primaryKey(),
  userId:                 int("user_id").notNull(),
  firstName:              varchar("first_name", { length: 128 }),
  lastName:               varchar("last_name", { length: 128 }),
  dateOfBirth:            varchar("date_of_birth", { length: 10 }), // YYYY-MM-DD
  nationality:            varchar("nationality", { length: 2 }),    // ISO-3166-1 alpha-2
  countryOfOrigin:        varchar("country_of_origin", { length: 2 }),
  preferredLocale:        varchar("preferred_locale", { length: 8 }), // null = usa el default_locale de su comunidad
  universityId:           int("university_id"),
  degreeProgram:          varchar("degree_program", { length: 256 }),
  academicYear:           varchar("academic_year", { length: 32 }), // string libre: "1", "2", "Máster", "PhD"...
  arrivalDate:            varchar("arrival_date", { length: 10 }),
  expectedDepartureDate:  varchar("expected_departure_date", { length: 10 }),
  addressLine:            varchar("address_line", { length: 256 }), // privado — nunca expuesto en endpoints públicos
  postalCode:             varchar("postal_code", { length: 16 }),
  city:                   varchar("city", { length: 128 }),
  profileCompleted:       boolean("profile_completed").notNull().default(false),
  status:                 mysqlEnum("status", ["active", "inactive"]).notNull().default("active"),
  // SEGOLIFE — REFERRAL & INVITE REWARDS ENGINE (Fase 8, spec §2): identidad
  // pública y permanente de invitación — opaca, no secuencial, sin PII
  // codificada. Nullable/lazy: se genera bajo demanda (ensureReferralCode en
  // referralService.ts) en vez de forzar el registro a calcularla siempre —
  // cubre tanto altas nuevas (generada dentro de la misma transacción de
  // registerStudent) como estudiantes ya existentes que abren "Invitar
  // amigos" por primera vez tras este despliegue (nunca backfill masivo).
  referralCode:           varchar("referral_code", { length: 16 }),
  createdAt:              timestamp("created_at").defaultNow().notNull(),
  updatedAt:              timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userIdUnique: unique("student_profiles_user_id_unique").on(table.userId),
  referralCodeUnique: unique("student_profiles_referral_code_unique").on(table.referralCode),
}));
export type StudentProfile = typeof studentProfiles.$inferSelect;
export type InsertStudentProfile = typeof studentProfiles.$inferInsert;

// ─── SEGOLIFE: STUDENT_TAGS / STUDENT_TAG_ASSIGNMENTS ──────────────────────────
// El CRM heredado tiene `clients.tags` (json string[] sin catálogo) — insuficiente
// porque el requisito pide etiquetas CONFIGURABLES (gestionables por un admin,
// sin typos/duplicados, sin tocar código para añadir una nueva). Por eso catálogo
// + tabla puente en vez de una columna JSON: nunca se hardcodean nombres de
// etiqueta en el schema ni en el código — "VIP"/"Ambassador"/etc. son filas,
// no un enum.

export const studentTags = mysqlTable("student_tags", {
  id:         int("id").autoincrement().primaryKey(),
  name:       varchar("name", { length: 64 }).notNull().unique(),
  color:      varchar("color", { length: 16 }), // hex opcional, para el badge en UI
  createdAt:  timestamp("created_at").defaultNow().notNull(),
});
export type StudentTag = typeof studentTags.$inferSelect;
export type InsertStudentTag = typeof studentTags.$inferInsert;

export const studentTagAssignments = mysqlTable("student_tag_assignments", {
  id:                 int("id").autoincrement().primaryKey(),
  studentProfileId:   int("student_profile_id").notNull(),
  tagId:              int("tag_id").notNull(),
  assignedByUserId:   int("assigned_by_user_id"),
  assignedAt:         timestamp("assigned_at").defaultNow().notNull(),
}, (table) => ({
  studentTagUnique: unique("student_tag_assignments_unique").on(table.studentProfileId, table.tagId),
}));
export type StudentTagAssignment = typeof studentTagAssignments.$inferSelect;
export type InsertStudentTagAssignment = typeof studentTagAssignments.$inferInsert;

// ─── SEGOLIFE: STUDENT_NOTES ────────────────────────────────────────────────────
// Notas internas de administración sobre un estudiante — privadas, nunca
// expuestas al propio estudiante (ver server/routers/students.ts, procedures
// separadas para "mi perfil" vs. "ficha admin"). Tabla dedicada en vez de un
// blob JSON embebido, mismo patrón que `quote_internal_notes` (precedente
// heredado): permite listar/paginar/ordenar notas reales.

export const studentNotes = mysqlTable("student_notes", {
  id:                 int("id").autoincrement().primaryKey(),
  studentProfileId:   int("student_profile_id").notNull(),
  authorUserId:       int("author_user_id"),
  note:               text("note").notNull(),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
  updatedAt:          timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type StudentNote = typeof studentNotes.$inferSelect;
export type InsertStudentNote = typeof studentNotes.$inferInsert;

// ─── SEGOLIFE: STUDENT_LOGIN_EVENTS (Student 360) ──────────────────────────────
// Auditado antes de crearse (docs/students/student-360-audit-and-architecture.md
// §G): no existe ningún histórico de login en el repo, solo users.lastSignedIn
// (timestamp único, se sobreescribe). Tabla mínima, sin IP/user-agent/device
// fingerprint (nada de eso existe hoy en server/localAuth.ts, así que añadirlo
// sería tracking nuevo, no reutilización). Empieza a registrar SOLO desde el
// login exitoso a partir de esta fase — nunca se fabrica histórico retroactivo.

export const studentLoginEvents = mysqlTable("student_login_events", {
  id:           int("id").autoincrement().primaryKey(),
  userId:       int("user_id").notNull(),
  occurredAt:   timestamp("occurred_at").defaultNow().notNull(),
  method:       varchar("method", { length: 32 }).notNull().default("password"),
}, (table) => ({
  userIdIdx: index("student_login_events_user_id_idx").on(table.userId),
}));
export type StudentLoginEvent = typeof studentLoginEvents.$inferSelect;
export type InsertStudentLoginEvent = typeof studentLoginEvents.$inferInsert;

// ─── SEGOLIFE: STUDENT_ADMIN_ACTIONS (Student 360) ─────────────────────────────
// Auditado antes de crearse (docs/students/student-360-audit-and-architecture.md
// §7): para ajustes de SegoTokens y Benefits la trazabilidad YA existe
// (token_ledger.createdByUserId/reason, user_benefits.grantedByUserId/
// cancelledByUserId/cancellationReason) — esta tabla NO los duplica. El único
// hueco real confirmado es el cambio de student_profiles.status (activo/
// inactivo), que hoy es un UPDATE sin actor ni motivo ni histórico.
// Se prefiere una tabla dedicada mínima en vez de extender crm_activity_log
// porque ese log es semánticamente CRM comercial (lead/quote/reservation/
// invoice) y su entityId es un int genérico sin FK — mezclar el dominio
// estudiante ahí cruzaría la frontera de aislamiento por dominio que el resto
// del repo respeta sin excepción (ver auditoría). beforeValue/afterValue
// guardan el valor plano (string) para no obligar a un shape JSON por acción.

export const studentAdminActions = mysqlTable("student_admin_actions", {
  id:                 int("id").autoincrement().primaryKey(),
  studentProfileId:   int("student_profile_id").notNull(),
  actorUserId:         int("actor_user_id").notNull(),
  action:             varchar("action", { length: 64 }).notNull(),
  beforeValue:        varchar("before_value", { length: 256 }),
  afterValue:         varchar("after_value", { length: 256 }),
  reason:             varchar("reason", { length: 512 }),
  metadata:           json("metadata").$type<Record<string, unknown>>(),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  studentProfileIdIdx: index("student_admin_actions_student_profile_id_idx").on(table.studentProfileId),
}));
export type StudentAdminAction = typeof studentAdminActions.$inferSelect;
export type InsertStudentAdminAction = typeof studentAdminActions.$inferInsert;

// ─── SEGOLIFE: VENUE_CATEGORIES (Fase 1D) ──────────────────────────────────────
// Catálogo configurable de categorías de venue (bar, coworking, tienda,
// alojamiento...) — mismo patrón que student_tags: nunca se hardcodea un
// enum de categorías en código, son filas gestionables desde el admin.

export const venueCategories = mysqlTable("venue_categories", {
  id:         int("id").autoincrement().primaryKey(),
  name:       varchar("name", { length: 64 }).notNull().unique(),
  slug:       varchar("slug", { length: 64 }).notNull().unique(),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
});
export type VenueCategory = typeof venueCategories.$inferSelect;
export type InsertVenueCategory = typeof venueCategories.$inferInsert;

// ─── SEGOLIFE: VENUES (Fase 1D) ─────────────────────────────────────────────────
// Negocio/local físico (bar, tienda, espacio) que puede acoger eventos y (a
// futuro, Fase 2+) beneficios/redenciones — ver shared/segolife/domain.ts y
// docs/SEGOLIFE_DOMAIN_MODEL.md. Tabla nueva, no reutiliza ninguna tabla
// heredada de Náyade (`restaurants`/`experiences`/`partners`/`organizations`
// evaluadas y descartadas — cada una arrastra lógica de negocio turístico
// específica de Náyade: depósitos Redsys, IVA de agencia de viajes, comisión
// B2B... ninguna es un "venue" genérico). category_id sin FK real (igual que
// el resto del schema) — nullable porque un venue puede quedar sin
// categorizar hasta que un admin lo clasifique.
//
// NO tiene community_id directo — un venue puede estar vinculado a varias
// comunidades (IE, UVA, ambas) a la vez, igual que community_universities.
// Ver `communityVenues` justo debajo.

export const venues = mysqlTable("venues", {
  id:           int("id").autoincrement().primaryKey(),
  name:         varchar("name", { length: 256 }).notNull(),
  slug:         varchar("slug", { length: 128 }).notNull().unique(),
  // Frase corta para el hero editorial (p.ej. "Discoteca · Segovia centro") —
  // distinta de `description` (texto largo de la sección About). Nullable:
  // sin ella, la ficha usa solo categoría/ciudad como subtítulo.
  tagline:      varchar("tagline", { length: 256 }),
  description:  text("description"),
  categoryId:   int("category_id"),
  address:      varchar("address", { length: 256 }),
  city:         varchar("city", { length: 128 }).notNull().default("Segovia"),
  phone:        varchar("phone", { length: 32 }),
  email:        varchar("email", { length: 256 }),
  website:      varchar("website", { length: 256 }),
  // Fase 8.6 — distinción real LOGO vs COVER pedida en el dominio de Venue:
  // `imageUrl` (heredado) pasa a representar el LOGO (object-contain, puede
  // tener transparencia); `coverImageUrl` es la fotografía grande del hero
  // (object-cover). Ambos nullable — sin cover, el hero cae al mismo
  // fallback de gradiente que ya usa PublicHome sin fotos.
  coverImageUrl: varchar("cover_image_url", { length: 512 }),
  imageUrl:     varchar("image_url", { length: 512 }),
  // Único campo social añadido — necesidad real y explícita del dominio
  // Venue (nightlife/hospitality), no copiado de Fourvenues por comodidad.
  instagramUrl: varchar("instagram_url", { length: 256 }),
  status:       mysqlEnum("status", ["active", "inactive"]).notNull().default("active"),
  // Misma bandera editorial simple que events.isFeatured (Fase 1D) — destacar
  // en "Esta noche en Segovia" (PublicHome.tsx), no un sistema de ranking.
  isFeatured:   boolean("is_featured").notNull().default(false),
  // Orden explícito curado a mano desde /admin/cms/inicio (menor = primero)
  // — sustituye el orden implícito por created_at que dejaba el venue más
  // antiguo (Casanova) fuera del slice(0,6) de la Home. Todos arrancan en 0
  // (empate → createdAt desc como desempate, ver listVenues).
  homeSortOrder: int("home_sort_order").notNull().default(0),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type Venue = typeof venues.$inferSelect;
export type InsertVenue = typeof venues.$inferInsert;

// ─── SEGOLIFE: COMMUNITY_VENUES (Fase 1D) ──────────────────────────────────────
// Tabla puente M2M entre `communities` y `venues` — mismo patrón exacto que
// `communityUniversities`: un venue puede acoger a 0, 1 o varias comunidades.
// unique(community_id, venue_id) evita duplicar el mismo enlace.

export const communityVenues = mysqlTable("community_venues", {
  id:           int("id").autoincrement().primaryKey(),
  communityId:  int("community_id").notNull(),
  venueId:      int("venue_id").notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  communityVenueUnique: unique("community_venues_unique").on(table.communityId, table.venueId),
}));
export type CommunityVenue = typeof communityVenues.$inferSelect;
export type InsertCommunityVenue = typeof communityVenues.$inferInsert;

// ─── SEGOLIFE: EVENTS (Fase 1D) ─────────────────────────────────────────────────
// Evento de comunidad (fiesta, charla, actividad...) — puede anclarse a un
// venue (venue_id, sin FK real, nullable: un evento online o itinerante no
// tiene local fijo) y a 1+ comunidades vía `communityEvents` (no un
// community_id directo, mismo razonamiento que venues/comunidades).
// is_featured es una bandera editorial simple (destacar en portada) — no un
// sistema de ranking, a propósito, para no construir de más sin necesidad.

export const events = mysqlTable("events", {
  id:           int("id").autoincrement().primaryKey(),
  name:         varchar("name", { length: 256 }).notNull(),
  slug:         varchar("slug", { length: 128 }).notNull().unique(),
  description:  text("description"),
  venueId:      int("venue_id"),
  startsAt:     timestamp("starts_at").notNull(),
  endsAt:       timestamp("ends_at"),
  capacity:     int("capacity"),
  imageUrl:     varchar("image_url", { length: 512 }),
  status:       mysqlEnum("status", ["active", "inactive"]).notNull().default("active"),
  isFeatured:   boolean("is_featured").notNull().default(false),
  // Mismo criterio que venues.homeSortOrder — orden curado a mano en la Home.
  homeSortOrder: int("home_sort_order").notNull().default(0),
  // Origen del evento — auditado antes de añadirse (COMUNITY, docs/comunity/
  // event-conversion.md): no existía ningún rastro de "de dónde vino este
  // evento". Mismo patrón que token_ledger.sourceType/sourceId (varchar libre
  // + int sin FK real, nunca un enum cerrado que ataría events a un único
  // origen posible). Ambas nullable — la inmensa mayoría de eventos se siguen
  // creando a mano, sin origen.
  sourceType:   varchar("source_type", { length: 64 }),
  sourceId:     int("source_id"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type SegolifeEvent = typeof events.$inferSelect;
export type InsertSegolifeEvent = typeof events.$inferInsert;

// ─── SEGOLIFE: COMMUNITY_EVENTS (Fase 1D) ──────────────────────────────────────
// Tabla puente M2M entre `communities` y `events` — mismo patrón que
// community_venues/community_universities. unique(community_id, event_id).

export const communityEvents = mysqlTable("community_events", {
  id:           int("id").autoincrement().primaryKey(),
  communityId:  int("community_id").notNull(),
  eventId:      int("event_id").notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  communityEventUnique: unique("community_events_unique").on(table.communityId, table.eventId),
}));
export type CommunityEvent = typeof communityEvents.$inferSelect;
export type InsertCommunityEvent = typeof communityEvents.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// SEGOLIFE FASE 2 — MOTOR DE SEGOTOKENS
// ═══════════════════════════════════════════════════════════════════════════
// Auditoría previa (ver informe de fase): no existe infraestructura heredada
// reutilizable. `transactions` es el libro mayor fiscal REAL de Náyade (EUR,
// IVA, régimen REAV) — reutilizarlo mezclaría dinero real con puntos
// internos. `discount_codes`/`coupon_redemptions` son cupones de canje
// externo (Groupon/Smartbox), sin relación con un saldo de usuario. No existe
// ninguna tabla "wallet"/"points"/"loyalty"/"token" previa. Todo lo de abajo
// es nuevo.

// ─── SEGOLIFE: TOKEN_WALLETS (Fase 2) ───────────────────────────────────────────
// Una wallet por usuario. Los tokens son unidades ENTERAS (int, nunca float)
// — evita errores de redondeo acumulados en un sistema de puntos vivo.
// `balance` es un saldo MATERIALIZADO por rendimiento (evita sumar todo
// token_ledger en cada lectura), pero NUNCA es la fuente de verdad: solo se
// escribe dentro de la misma transacción atómica que inserta la fila de
// token_ledger correspondiente (ver server/segolife/tokens/tokenLedgerService.ts,
// postLedgerMovement). El saldo siempre debe ser reconstruible sumando
// direction=credit menos direction=debit de token_ledger para ese wallet_id.

export const tokenWallets = mysqlTable("token_wallets", {
  id:             int("id").autoincrement().primaryKey(),
  userId:         int("user_id").notNull(),
  balance:        int("balance").notNull().default(0),
  lifetimeEarned: int("lifetime_earned").notNull().default(0),
  lifetimeSpent:  int("lifetime_spent").notNull().default(0),
  status:         mysqlEnum("status", ["active", "inactive"]).notNull().default("active"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
  updatedAt:      timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userIdUnique: unique("token_wallets_user_id_unique").on(table.userId),
}));
export type TokenWallet = typeof tokenWallets.$inferSelect;
export type InsertTokenWallet = typeof tokenWallets.$inferInsert;

// ─── SEGOLIFE: TOKEN_LEDGER (Fase 2) ────────────────────────────────────────────
// Ledger INMUTABLE — fuente de verdad real del saldo. Un movimiento POSTED
// nunca se edita ni se borra (sin UPDATE de amount/direction, sin DELETE);
// una corrección se modela como un movimiento de signo opuesto que referencia
// al original vía `reversed_ledger_id` (ver reverseTransaction en
// tokenLedgerService.ts). `balance_after` se materializa en el momento de
// insertar (dentro de la misma transacción que actualiza token_wallets) para
// poder auditar/depurar sin recalcular todo el histórico.
//
// `idempotency_key` es UNIQUE cuando no es null (MySQL permite múltiples NULL
// en un índice UNIQUE — comportamiento exactamente deseado: solo se exige
// unicidad cuando el llamador la proporciona). Protege contra doble concesión
// si un futuro origen (QR, Fourvenues, asistencia) reenvía el mismo evento
// más de una vez.
//
// venue_id/event_id/rule_id/campaign_id sin FK real (convención del schema,
// ver community_universities) — son referencias informativas para trazar de
// dónde vino cada movimiento, usadas también para poder filtrar el histórico
// del admin/estudiante por venue o evento.

export const tokenLedger = mysqlTable("token_ledger", {
  id:                 int("id").autoincrement().primaryKey(),
  walletId:           int("wallet_id").notNull(),
  userId:             int("user_id").notNull(),
  direction:          mysqlEnum("direction", ["credit", "debit"]).notNull(),
  amount:             int("amount").notNull(),
  balanceAfter:       int("balance_after").notNull(),
  reason:             varchar("reason", { length: 256 }).notNull(),
  sourceType:         varchar("source_type", { length: 64 }).notNull(),
  sourceId:           int("source_id"),
  venueId:            int("venue_id"),
  eventId:            int("event_id"),
  ruleId:             int("rule_id"),
  campaignId:         int("campaign_id"),
  idempotencyKey:     varchar("idempotency_key", { length: 191 }),
  metadata:           json("metadata").$type<Record<string, unknown>>(),
  createdByUserId:    int("created_by_user_id"),
  reversedLedgerId:   int("reversed_ledger_id"),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  idempotencyKeyUnique: unique("token_ledger_idempotency_key_unique").on(table.idempotencyKey),
}));
export type TokenLedgerEntry = typeof tokenLedger.$inferSelect;
export type InsertTokenLedgerEntry = typeof tokenLedger.$inferInsert;

// ─── SEGOLIFE: VENUE_PRODUCTS (Fase 2) ──────────────────────────────────────────
// Catálogo MÍNIMO de conceptos de un venue que pueden originar una regla
// SegoTokens (copa, menú, entrada...) — deliberadamente NO es un TPV: sin
// stock, sin variantes, sin impuestos. `price` es opcional y solo se usa como
// referencia para reglas per_euro/percentage (ver token_rules.calc_method).
// unique(venue_id, slug) evita duplicar el mismo producto dentro de un venue
// (el mismo slug SÍ puede repetirse en venues distintos).

export const venueProducts = mysqlTable("venue_products", {
  id:           int("id").autoincrement().primaryKey(),
  venueId:      int("venue_id").notNull(),
  name:         varchar("name", { length: 256 }).notNull(),
  slug:         varchar("slug", { length: 128 }).notNull(),
  category:     varchar("category", { length: 64 }),
  price:        decimal("price", { precision: 10, scale: 2 }),
  isActive:     boolean("is_active").notNull().default(true),
  metadata:     json("metadata").$type<Record<string, unknown>>(),
  // SEGOLIFE — FASE 10 (spec §7/§28/§39): tipo de IVA configurado (NULL =
  // sin configurar todavía, nunca se adivina). stockTracked=false por
  // defecto — la mayoría de conceptos (entrada, servicio) no tienen stock
  // físico; solo productos consumibles reales lo activan explícitamente.
  // currentStockCached es solo una caché de lectura — la verdad canónica
  // siempre es SUM(inventory_movements.delta_quantity) (spec §30).
  taxRateId:          int("tax_rate_id"),
  stockTracked:       boolean("stock_tracked").notNull().default(false),
  currentStockCached: int("current_stock_cached"),
  lowStockThreshold:  int("low_stock_threshold"),
  allowNegativeStock: boolean("allow_negative_stock").notNull().default(false),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  venueSlugUnique: unique("venue_products_venue_slug_unique").on(table.venueId, table.slug),
}));
export type VenueProduct = typeof venueProducts.$inferSelect;
export type InsertVenueProduct = typeof venueProducts.$inferInsert;

// ─── SEGOLIFE: TOKEN_RULES (Fase 2) ─────────────────────────────────────────────
// Motor de reglas configurable — nunca se hardcodean ratios en código
// (tokenRuleEngine.ts solo interpreta filas de esta tabla). Una fila define
// CUÁNDO aplica (direction/origin/scope) y CUÁNTO otorga (calc_method +
// parámetros). El scope usa columnas nullable (scope_venue_id, etc.) en vez
// de tablas puente M2M: a diferencia de venues/events (que pueden pertenecer
// a varias comunidades), una regla aplica a UN alcance concreto a la vez —
// para cubrir "esta regla en 3 venues" se crean 3 filas (o se usa
// scope=global si el matiz por venue no importa). `priority` (mayor gana)
// es el único criterio de desempate cuando varias reglas encajan — así el
// admin controla explícitamente qué regla es "más específica", sin que el
// motor tenga que adivinar jerarquías.
//
// recurrence_window/recurrence_threshold/recurrence_mode solo se usan cuando
// origin='recurrence' (ver tokenRuleEngine.applyRecurrenceBonus): p.ej.
// window='week', threshold=2, mode='visit_count' → bonus en la 2ª visita de
// la semana. mode='distinct_venues' cuenta venues distintos visitados en vez
// de visitas. No se creó una tabla de contadores aparte (user_activity_counters)
// — el conteo se calcula en caliente contando token_ledger (ver
// countRecentEarnEvents/countDistinctVenuesVisited), evitando un contador
// duplicado que podría desincronizarse del ledger real.
//
// daily_limit/monthly_limit son límites de la propia regla (no globales del
// usuario): el motor recorta (clamp) el importe final para no superarlos en
// vez de rechazar la operación entera — ver tokenEngine.ts, paso "límites".
//
// LOYALTY PRODUCTION HARDENING (2026-08-14):
// - weekly_limit/lifetime_limit siguen EXACTAMENTE el mismo patrón de clamp
//   que daily_limit/monthly_limit (ver tokenEngine.ts). lifetime_limit es el
//   máximo que ESA REGLA puede conceder a UN Student en toda su vida — no
//   confundir con el saldo del wallet ni con el presupuesto de una campaña.
// - recurrence_window="lifetime" (nuevo valor de enum) permite hitos/first-
//   action reales sin reinicio periódico (p.ej. "5ª visita = +50, nunca se
//   repite") — windowStart() lo resuelve como "desde siempre" (epoch), sin
//   necesitar ninguna columna ni lógica nueva en tokenRuleEngine.ts más allá
//   del propio valor de enum.
// - scope="ticket_type" + scope_ticket_type_id: alcance determinista por
//   tipo de entrada/tarifa real de Fourvenues — SIEMPRE vía el mismo id
//   interno ya resuelto por eventCatalogSync.ts (event_ticket_types.id vía
//   external_entity_mappings), nunca por nombre.
// Todas las columnas nuevas son NULLABLE y no tienen ninguna fila real que
// las use hoy (2 reglas reales en producción, ninguna las necesita) — su
// sola existencia no cambia ningún cálculo hasta que un admin las configure.

export const tokenRules = mysqlTable("token_rules", {
  id:                   int("id").autoincrement().primaryKey(),
  name:                 varchar("name", { length: 256 }).notNull(),
  description:          text("description"),
  direction:            mysqlEnum("direction", ["earn", "spend"]).notNull(),
  origin:               mysqlEnum("origin", ["attendance", "event", "ticket", "purchase", "consumption", "product", "manual", "recurrence", "campaign", "community_response", "community_proposal_approved"]).notNull(),
  scope:                mysqlEnum("scope", ["global", "community", "venue", "event", "product", "ticket_type"]).notNull().default("global"),
  scopeCommunityId:     int("scope_community_id"),
  scopeVenueId:         int("scope_venue_id"),
  scopeEventId:         int("scope_event_id"),
  scopeProductId:       int("scope_product_id"),
  scopeTicketTypeId:    int("scope_ticket_type_id"),
  calcMethod:           mysqlEnum("calc_method", ["fixed", "per_euro", "percentage", "multiplier"]).notNull().default("fixed"),
  fixedAmount:          int("fixed_amount"),
  rate:                 decimal("rate", { precision: 10, scale: 4 }),
  multiplier:           decimal("multiplier", { precision: 6, scale: 2 }),
  minSpend:             decimal("min_spend", { precision: 10, scale: 2 }),
  maxTokens:            int("max_tokens"),
  dailyLimit:           int("daily_limit"),
  weeklyLimit:          int("weekly_limit"),
  monthlyLimit:         int("monthly_limit"),
  lifetimeLimit:        int("lifetime_limit"),
  recurrenceWindow:     mysqlEnum("recurrence_window", ["day", "week", "month", "lifetime"]),
  recurrenceThreshold:  int("recurrence_threshold"),
  recurrenceMode:       mysqlEnum("recurrence_mode", ["visit_count", "distinct_venues"]),
  startsAt:             timestamp("starts_at"),
  endsAt:               timestamp("ends_at"),
  active:               boolean("active").notNull().default(true),
  priority:             int("priority").notNull().default(0),
  createdAt:            timestamp("created_at").defaultNow().notNull(),
  updatedAt:            timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type TokenRule = typeof tokenRules.$inferSelect;
export type InsertTokenRule = typeof tokenRules.$inferInsert;

// ─── SEGOLIFE: TOKEN_CAMPAIGNS (Fase 2) ─────────────────────────────────────────
// Campañas temporales (x2, x3, bonus fijo) que se aplican DESPUÉS de calcular
// el importe base de una regla (ver tokenRuleEngine.applyCampaignBonus). Solo
// se aplica la campaña activa de mayor prioridad que encaje — evita
// apilamientos ambiguos/inexplicables (x2 + x3 simultáneos). El alcance
// (comunidad/venue/evento) es M2M vía las 3 tablas puente de abajo, NUNCA un
// literal "ie"/"uva" — una campaña sin ninguna fila en las 3 tablas puente
// aplica GLOBALMENTE (sin restricción de alcance).

export const tokenCampaigns = mysqlTable("token_campaigns", {
  id:           int("id").autoincrement().primaryKey(),
  name:         varchar("name", { length: 256 }).notNull(),
  description:  text("description"),
  multiplier:   decimal("multiplier", { precision: 6, scale: 2 }),
  bonusTokens:  int("bonus_tokens"),
  // Loyalty Production Hardening (2026-08-14) — presupuesto total de tokens
  // que esta campaña puede conceder en toda su vida. NULL = sin presupuesto
  // (comportamiento actual, sin cambio). Cuando tiene valor, tokenEngine.ts
  // recorta (clamp) el importe final al remanente real, bajo el MISMO lock
  // de fila que ya protege token_wallets — ver postLedgerMovementInTx.
  maxTotalTokens: int("max_total_tokens"),
  startsAt:     timestamp("starts_at"),
  endsAt:       timestamp("ends_at"),
  active:       boolean("active").notNull().default(true),
  priority:     int("priority").notNull().default(0),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type TokenCampaign = typeof tokenCampaigns.$inferSelect;
export type InsertTokenCampaign = typeof tokenCampaigns.$inferInsert;

// ─── SEGOLIFE: TOKEN_REDEMPTION_POLICIES (Fase 7) ───────────────────────────
// SegoTokens Universal Spend & Mixed Payments. Responde "¿cuántos céntimos de
// valor promocional da 1 SegoToken al aplicarse contra un precio real?" —
// una pregunta que NINGUNA tabla existente contestaba: token_rules define
// tarifas de GANANCIA (earn), no de canje monetario; el analítico
// system_settings.estimated_token_value_cents es solo una estimación de
// pasivo para el dashboard admin (server/segolife/tokens/economyOverviewService.ts),
// nunca la tasa de conversión real — ver auditoría de fase.
//
// TASA como RATIO ENTERO, nunca decimal/float (spec §12): tokensPerUnit=100,
// valueCentsPerUnit=100 significa "100 ST = 100 céntimos" (1 ST = 1 céntimo).
// promotionalValueCents = floor(tokensToSpend * valueCentsPerUnit / tokensPerUnit)
// — TRUNCA, nunca redondea al alza (spec: "never give more promotional value
// than mathematically allowed").
//
// ALCANCE (event_id/venue_id/community_id, todos nullable = comodín) —
// mismo criterio que benefit_rules, pero la RESOLUCIÓN es distinta: aquí
// gana LA MÁS ESPECÍFICA (una sola política aplica), nunca todas las que
// encajan (ver tokenSpendService.ts::resolveRedemptionPolicy) — spec §6
// exige determinismo, no aditividad.
export const tokenRedemptionPolicies = mysqlTable("token_redemption_policies", {
  id:                       int("id").autoincrement().primaryKey(),
  name:                     varchar("name", { length: 256 }).notNull(),
  description:              text("description"),
  active:                   boolean("active").notNull().default(true),
  communityId:              int("community_id"),
  venueId:                  int("venue_id"),
  eventId:                  int("event_id"),
  tokensPerUnit:            int("tokens_per_unit").notNull().default(1),
  valueCentsPerUnit:        int("value_cents_per_unit").notNull(),
  minTokenSpend:            int("min_token_spend"),
  maxTokenSpend:            int("max_token_spend"),
  /** 0-100 — porcentaje máximo del importe bruto pagable con SegoTokens. NULL = sin tope de porcentaje (solo limitado por maxTokenSpend/saldo). */
  maxPercentage:            int("max_percentage"),
  allowFullTokenPayment:    boolean("allow_full_token_payment").notNull().default(false),
  startsAt:                 timestamp("starts_at"),
  endsAt:                   timestamp("ends_at"),
  /** Desempate explícito cuando dos políticas tienen el mismo grado de especificidad (spec §6: "test conflicts explicitly"). */
  priority:                 int("priority").notNull().default(0),
  createdByUserId:          int("created_by_user_id"),
  createdAt:                timestamp("created_at").defaultNow().notNull(),
  updatedAt:                timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  activeIdx: index("token_redemption_policies_active_idx").on(table.active),
}));
export type TokenRedemptionPolicy = typeof tokenRedemptionPolicies.$inferSelect;
export type InsertTokenRedemptionPolicy = typeof tokenRedemptionPolicies.$inferInsert;

// ─── SEGOLIFE: TOKEN_SPEND_RESERVATIONS (Fase 7) ────────────────────────────
// Ciclo de vida RESERVED → CAPTURED (gasto real en token_ledger) | RELEASED
// | EXPIRED | REVERSED. Reservar NUNCA mueve el ledger — solo "aparta"
// tokens restando de countActiveReservations() al calcular saldo disponible
// (tokenSpendService.ts), dentro de la MISMA transacción que bloquea
// token_wallets vía FOR UPDATE (mismo patrón que postLedgerMovementInTx) —
// así dos reservas concurrentes del mismo wallet nunca sobre-comprometen el
// saldo. El movimiento real de ledger solo ocurre al CAPTURAR — por eso un
// pago externo fallido nunca necesita revertir nada en el ledger, solo
// liberar la reserva (spec §15/§30).
//
// reference_type/reference_id apuntan al registro propio del dominio
// llamador (p.ej. commerce_transactions.id) cuando existe — deliberadamente
// genérico para que Fase 9 (puerta/consumo/eventos) pueda reutilizar esta
// misma tabla sin una migración nueva por dominio.
//
// Snapshot económico completo en el momento de la reserva
// (gross/tokens/promo/money) — spec §51: cambiar la política mañana NUNCA
// debe alterar el significado de una reserva ya capturada.
export const tokenSpendReservations = mysqlTable("token_spend_reservations", {
  id:                   int("id").autoincrement().primaryKey(),
  userId:               int("user_id").notNull(),
  walletId:             int("wallet_id").notNull(),
  policyId:             int("policy_id"),
  venueId:              int("venue_id"),
  eventId:              int("event_id"),
  communityId:          int("community_id"),
  referenceType:        varchar("reference_type", { length: 64 }).notNull(),
  referenceId:          int("reference_id"),
  grossAmountCents:     int("gross_amount_cents").notNull(),
  tokensReserved:       int("tokens_reserved").notNull(),
  promotionalValueCents: int("promotional_value_cents").notNull(),
  moneyDueCents:        int("money_due_cents").notNull(),
  status:               mysqlEnum("status", ["reserved", "captured", "released", "expired", "reversed"]).notNull().default("reserved"),
  idempotencyKey:       varchar("idempotency_key", { length: 191 }).notNull(),
  ledgerId:             int("ledger_id"),
  reversalLedgerId:     int("reversal_ledger_id"),
  expiresAt:            timestamp("expires_at").notNull(),
  createdByUserId:      int("created_by_user_id"),
  createdAt:            timestamp("created_at").defaultNow().notNull(),
  capturedAt:           timestamp("captured_at"),
  releasedAt:           timestamp("released_at"),
  reversedAt:           timestamp("reversed_at"),
}, (table) => ({
  idempotencyKeyUnique: unique("token_spend_reservations_idempotency_key_unique").on(table.idempotencyKey),
  userIdIdx: index("token_spend_reservations_user_id_idx").on(table.userId),
  statusIdx: index("token_spend_reservations_status_idx").on(table.status),
}));
export type TokenSpendReservation = typeof tokenSpendReservations.$inferSelect;
export type InsertTokenSpendReservation = typeof tokenSpendReservations.$inferInsert;

// ─── SEGOLIFE: CAMPAIGN_COMMUNITIES / CAMPAIGN_VENUES / CAMPAIGN_EVENTS (Fase 2) ─
// Tablas puente M2M del alcance de una campaña — mismo patrón exacto que
// community_venues/community_events. Una campaña puede afectar a varias
// comunidades/venues/eventos a la vez; si las 3 quedan vacías para una
// campaña, esa campaña se considera global (ver tokenRuleEngine.ts).

export const campaignCommunities = mysqlTable("campaign_communities", {
  id:           int("id").autoincrement().primaryKey(),
  campaignId:   int("campaign_id").notNull(),
  communityId:  int("community_id").notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  campaignCommunityUnique: unique("campaign_communities_unique").on(table.campaignId, table.communityId),
}));
export type CampaignCommunity = typeof campaignCommunities.$inferSelect;
export type InsertCampaignCommunity = typeof campaignCommunities.$inferInsert;

export const campaignVenues = mysqlTable("campaign_venues", {
  id:           int("id").autoincrement().primaryKey(),
  campaignId:   int("campaign_id").notNull(),
  venueId:      int("venue_id").notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  campaignVenueUnique: unique("campaign_venues_unique").on(table.campaignId, table.venueId),
}));
export type CampaignVenue = typeof campaignVenues.$inferSelect;
export type InsertCampaignVenue = typeof campaignVenues.$inferInsert;

export const campaignEvents = mysqlTable("campaign_events", {
  id:           int("id").autoincrement().primaryKey(),
  campaignId:   int("campaign_id").notNull(),
  eventId:      int("event_id").notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  campaignEventUnique: unique("campaign_events_unique").on(table.campaignId, table.eventId),
}));
export type CampaignEvent = typeof campaignEvents.$inferSelect;
export type InsertCampaignEvent = typeof campaignEvents.$inferInsert;

// ─── SEGOLIFE: VENUE_TOKEN_SCHEDULES (Fase 2) ───────────────────────────────────
// Horarios en los que un venue permite GANAR y/o GASTAR tokens — dos
// operation_type independientes (un venue puede ganar tokens todo el día
// pero solo dejar gastarlos por la noche). Varias filas = varias franjas al
// mismo día. day_of_week según JS Date#getDay() (0=domingo..6=sábado), para
// que el servicio de horarios no tenga que traducir convenciones distintas.
// start_time/end_time como varchar "HH:MM" (mismo patrón que las fechas
// calendario del schema, p.ej. student_profiles.date_of_birth) en vez de un
// tipo TIME nativo — más simple de comparar en JS sin líos de zona horaria
// del driver. Si end_time < start_time, la franja cruza medianoche (p.ej.
// 22:00–02:00) — la interpretación de ese cruce vive en
// tokenScheduleService.ts, no en el schema.
//
// SIN NINGUNA FILA para un venue+operation_type = SIN RESTRICCIÓN (permitido
// siempre) — decisión deliberada: un venue recién adherido no debe quedar
// bloqueado por defecto solo por no haber configurado horarios todavía.
// timezone por fila (no global) para poder soportar honestamente un futuro
// venue fuera de Europe/Madrid sin migrar nada.

export const venueTokenSchedules = mysqlTable("venue_token_schedules", {
  id:             int("id").autoincrement().primaryKey(),
  venueId:        int("venue_id").notNull(),
  operationType:  mysqlEnum("operation_type", ["earn", "spend"]).notNull(),
  dayOfWeek:      int("day_of_week").notNull(),
  startTime:      varchar("start_time", { length: 5 }).notNull(),
  endTime:        varchar("end_time", { length: 5 }).notNull(),
  active:         boolean("active").notNull().default(true),
  timezone:       varchar("timezone", { length: 64 }).notNull().default("Europe/Madrid"),
  validFrom:      varchar("valid_from", { length: 10 }),
  validTo:        varchar("valid_to", { length: 10 }),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
  updatedAt:      timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type VenueTokenSchedule = typeof venueTokenSchedules.$inferSelect;
export type InsertVenueTokenSchedule = typeof venueTokenSchedules.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// SEGOLIFE — LOYALTY SHADOW MODE
// ═══════════════════════════════════════════════════════════════════════════
// Observabilidad pura sobre tráfico real: qué habría hecho el Reward Engine
// (rewardEngine.ts, evaluateReward(ctx, "SIMULATION")) si loyalty estuviera
// activo. Tabla NUEVA, aditiva, completamente aislada — nunca se relaciona
// con token_ledger/token_wallets/user_benefits, ni con foreign keys hacia
// ellas (ver loyaltyShadowService.ts, que garantiza cero escritura en esas
// tres tablas). Sin PII: solo user_id (nullable — null = identidad histórica
// sin Student resuelto, nunca inferida), venue_id/event_id/rule_id/
// campaign_id — nunca email/teléfono/nombre.
//
// Idempotencia (provider, external_operation_id, trigger) UNIQUE: reevaluar
// la MISMA operación bajo el MISMO trigger (p.ej. un pedido "paid" visto de
// nuevo en la siguiente pasada del scheduler) es la MISMA observación —
// nunca duplica filas. Un cambio de estado real (paid→refunded) usa un
// trigger DISTINTO (EVENT_REFUND), así que genera una fila nueva de forma
// natural sin ninguna lógica adicional de "state/version".
//
// rule_policy_version/campaign_policy_version = updatedAt de la regla/
// campaña en el momento exacto de evaluar (spec §16, reproducibilidad) — si
// la regla cambia mañana, esta fila sigue explicando con qué versión se
// calculó, sin necesidad de un sistema de versionado propio.

export const loyaltyShadowEvaluations = mysqlTable("loyalty_shadow_evaluations", {
  id:                          int("id").autoincrement().primaryKey(),
  provider:                    varchar("provider", { length: 32 }).notNull(),
  externalOperationId:         varchar("external_operation_id", { length: 191 }).notNull(),
  trigger:                     mysqlEnum("trigger", ["EVENT_PURCHASE", "EVENT_ATTENDANCE", "EVENT_REFUND", "EVENT_CANCEL", "PENDING_TO_PAID"]).notNull(),
  operationState:              varchar("operation_state", { length: 32 }),
  userId:                      int("user_id"),
  venueId:                     int("venue_id"),
  eventId:                     int("event_id"),
  communityId:                 int("community_id"),
  ruleId:                      int("rule_id"),
  rulePolicyVersion:           timestamp("rule_policy_version"),
  campaignId:                  int("campaign_id"),
  campaignPolicyVersion:       timestamp("campaign_policy_version"),
  eligible:                    boolean("eligible").notNull(),
  decision:                    mysqlEnum("decision", ["GRANTED", "DENIED", "SIMULATED_REVERSAL"]).notNull(),
  denialReason:                varchar("denial_reason", { length: 32 }),
  baseTokens:                  int("base_tokens"),
  recurrenceTokens:            int("recurrence_tokens"),
  campaignTokens:              int("campaign_tokens"),
  capApplied:                  boolean("cap_applied").notNull().default(false),
  finalTokens:                 int("final_tokens"),
  isReversal:                  boolean("is_reversal").notNull().default(false),
  originalShadowEvaluationId:  int("original_shadow_evaluation_id"),
  evaluatedAt:                 timestamp("evaluated_at").notNull(),
  createdAt:                   timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  operationTriggerUnique: unique("loyalty_shadow_evaluations_operation_trigger_unique").on(table.provider, table.externalOperationId, table.trigger),
  userIdIdx: index("loyalty_shadow_evaluations_user_id_idx").on(table.userId),
  venueIdIdx: index("loyalty_shadow_evaluations_venue_id_idx").on(table.venueId),
  evaluatedAtIdx: index("loyalty_shadow_evaluations_evaluated_at_idx").on(table.evaluatedAt),
  triggerIdx: index("loyalty_shadow_evaluations_trigger_idx").on(table.trigger),
}));
export type LoyaltyShadowEvaluation = typeof loyaltyShadowEvaluations.$inferSelect;
export type InsertLoyaltyShadowEvaluation = typeof loyaltyShadowEvaluations.$inferInsert;

// Observabilidad de fallos (spec §42: "Dropped evaluations = MUST BE 0
// unless explained" / "No silent drop") — sin esta tabla, un fallo de
// observeShadow() solo quedaría en console.error, invisible para el admin
// UI. Tabla mínima, aditiva, separada de loyaltyShadowEvaluations (un fallo
// significa que NO se pudo crear una fila ahí).
export const loyaltyShadowErrors = mysqlTable("loyalty_shadow_errors", {
  id:                   int("id").autoincrement().primaryKey(),
  provider:             varchar("provider", { length: 32 }),
  externalOperationId:  varchar("external_operation_id", { length: 191 }),
  trigger:              varchar("trigger", { length: 32 }),
  errorMessage:         varchar("error_message", { length: 512 }).notNull(),
  occurredAt:           timestamp("occurred_at").defaultNow().notNull(),
}, (table) => ({
  occurredAtIdx: index("loyalty_shadow_errors_occurred_at_idx").on(table.occurredAt),
}));
export type LoyaltyShadowError = typeof loyaltyShadowErrors.$inferSelect;
export type InsertLoyaltyShadowError = typeof loyaltyShadowErrors.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// SEGOLIFE FASE 3 — QR DE CONSUMICIONES
// ═══════════════════════════════════════════════════════════════════════════
// Auditoría previa (ver informe de fase): sin infraestructura reutilizable.
// `coupon_redemptions`/`ticketing_products` son el flujo de cupones externos
// Groupon/Smartbox (foto+OCR+conciliación financiera, sin token seguro ni
// single-use real). `compensation_vouchers` es más cercano en FORMA (code
// único, issued/expires/redeemed, estados canjeado/caducado/anulado) pero es
// un vale de atención al cliente ligado a `request_id` (incidencias), sin
// concepto de venue/producto/importe ni requisito de seguridad criptográfica
// — solo sirve como referencia de patrón, no se reutiliza. No existe ninguna
// tabla `qr`/`ticket`/`checkin`/`barcode`/`access_code` previa.
//
// DECISIÓN DE SEGURIDAD DEL TOKEN: a diferencia de `password_reset_tokens`
// (que guarda el token en claro — aceptable ahí: 1 destinatario, canal
// privado por email, de un solo uso inmediato), un QR de consumición puede
// imprimirse en papel o mostrarse en pantalla, ser fotografiado por
// cualquiera, y cada canje acredita tokens con valor económico real. Por eso
// aquí SÍ se aplica hash: se genera un token aleatorio de 256 bits (32 bytes,
// crypto.randomBytes, codificado base64url), se muestra en claro UNA sola vez
// (al emitirlo, para el QR/impresión) y solo se guarda su SHA-256 en
// `code_hash` — una fuga de esta tabla no expone ningún QR válido reutilizable.

// ─── SEGOLIFE: QR_BATCHES (Fase 3) ──────────────────────────────────────────────
// Agrupa una tanda de QR generados de una vez para imprimir/organizar — no es
// una entidad operativa por sí sola, cada `consumption_qr_codes.batch_id` es
// la referencia real. amount_cents/product_id nullable porque un batch puede
// generarse "en blanco" (solo venue) si el importe se decide por regla.

export const qrBatches = mysqlTable("qr_batches", {
  id:               int("id").autoincrement().primaryKey(),
  venueId:          int("venue_id").notNull(),
  productId:        int("product_id"),
  amountCents:      int("amount_cents"),
  quantity:         int("quantity").notNull(),
  expiresAt:        timestamp("expires_at"),
  createdByUserId:  int("created_by_user_id"),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
});
export type QrBatch = typeof qrBatches.$inferSelect;
export type InsertQrBatch = typeof qrBatches.$inferInsert;

// ─── SEGOLIFE: CONSUMPTION_QR_CODES (Fase 3) ────────────────────────────────────
// Un QR de consumición individual. `code_hash` (SHA-256 hex, 64 caracteres)
// es lo único que se persiste del token — el token en claro nunca se guarda
// (ver nota de seguridad arriba). `amount_cents` en enteros (nunca float) —
// 18,50€ se guarda como 1850; tokenEngine.calculateBaseTokens ya sabe
// convertir a euros para reglas per_euro/percentage.
//
// SINGLE-USE real: el canje se resuelve con un UPDATE condicional
// (`WHERE status='issued'`, comprobando affectedRows=1) dentro de la misma
// transacción que crea el movimiento de ledger — ver
// server/segolife/qr/consumptionQrService.ts. Dos peticiones simultáneas
// para el mismo QR nunca pueden ganar ambas: MySQL serializa el UPDATE a
// nivel de fila, no hace falta un lock explícito adicional.
//
// `ledger_id` se rellena tras el canje con el movimiento creado por
// tokenEngine.earnTokens() — permite navegar QR→ledger para auditoría y para
// que una reversión administrativa (reverseTransaction, Fase 2) sepa qué
// movimiento corregir. El QR NO vuelve a `issued` tras una reversión (ver
// comentario de cancelled_at más abajo) — sigue marcando fielmente que fue
// canjeado; es el ledger quien refleja la corrección.
//
// cancelled_at/cancelled_by_user_id/cancel_reason viven aquí (no en una tabla
// aparte) porque cancelar es un estado terminal simple de UN QR concreto, no
// una entidad con vida propia. Un QR `redeemed` nunca pasa a `cancelled`
// directamente (ver PASO 20 del roadmap) — ese caso usa reverseTransaction.

export const consumptionQrCodes = mysqlTable("consumption_qr_codes", {
  id:                 int("id").autoincrement().primaryKey(),
  codeHash:           varchar("code_hash", { length: 64 }).notNull(),
  venueId:            int("venue_id").notNull(),
  productId:          int("product_id"),
  amountCents:        int("amount_cents"),
  quantity:           int("quantity").notNull().default(1),
  batchId:            int("batch_id"),
  issuedAt:           timestamp("issued_at").defaultNow().notNull(),
  expiresAt:          timestamp("expires_at"),
  status:             mysqlEnum("status", ["issued", "redeemed", "expired", "cancelled"]).notNull().default("issued"),
  redeemedAt:         timestamp("redeemed_at"),
  redeemedByUserId:   int("redeemed_by_user_id"),
  ledgerId:           int("ledger_id"),
  sourceType:         varchar("source_type", { length: 64 }).notNull().default("manual"),
  sourceReference:    varchar("source_reference", { length: 128 }),
  issuedByUserId:     int("issued_by_user_id"),
  terminalId:         varchar("terminal_id", { length: 64 }),
  cancelledAt:        timestamp("cancelled_at"),
  cancelledByUserId:  int("cancelled_by_user_id"),
  cancelReason:       varchar("cancel_reason", { length: 256 }),
  metadata:           json("metadata").$type<Record<string, unknown>>(),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
  updatedAt:          timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  codeHashUnique: unique("consumption_qr_codes_code_hash_unique").on(table.codeHash),
}));
export type ConsumptionQrCode = typeof consumptionQrCodes.$inferSelect;
export type InsertConsumptionQrCode = typeof consumptionQrCodes.$inferInsert;

// ─── SEGOLIFE: QR_REDEMPTION_ATTEMPTS (Fase 3) ──────────────────────────────────
// Log de auditoría/antifraude — INSERT-only, nunca se actualiza ni se borra.
// Registra TODO intento de canje, incluido uno con un token que no resuelve
// a ningún QR real (`qr_id` null, `token_fingerprint` = SHA-256 del token
// recibido — el mismo hash que ya se calcula para la búsqueda, nunca el
// token en claro). Permite detectar patrones de fuerza bruta (muchos
// `invalid_token`/`not_found` desde la misma IP) sin guardar nada sensible.

export const qrRedemptionAttempts = mysqlTable("qr_redemption_attempts", {
  id:                 int("id").autoincrement().primaryKey(),
  qrId:               int("qr_id"),
  tokenFingerprint:   varchar("token_fingerprint", { length: 64 }),
  userId:             int("user_id"),
  result:             mysqlEnum("result", [
    "success", "already_redeemed", "expired", "cancelled",
    "invalid_token", "not_found", "venue_inactive", "product_inactive",
    "community_not_authorized", "outside_schedule", "no_rule", "rate_limited", "error",
  ]).notNull(),
  ipAddress:          varchar("ip_address", { length: 64 }),
  userAgent:          varchar("user_agent", { length: 256 }),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
});
export type QrRedemptionAttempt = typeof qrRedemptionAttempts.$inferSelect;
export type InsertQrRedemptionAttempt = typeof qrRedemptionAttempts.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// SEGOLIFE FASE 4 — MOTOR DE BENEFITS
// ═══════════════════════════════════════════════════════════════════════════
// Auditoría previa (ver informe de fase): `discount_codes`/`discount_code_uses`
// son cupones de descuento de reserva (importe fijo/%, ligados a `booking_id`,
// sin concepto de venue destino ni de vigencia relativa a un evento origen).
// `ticketing_products`/`coupon_redemptions` son el flujo de cupones externos
// Groupon/Smartbox (foto+OCR+conciliación financiera). `compensation_vouchers`
// es un vale de atención al cliente ligado a `request_id` (incidencias de
// reserva). Ninguna de las tres modela "una acción en el venue A desbloquea
// una entrada gratis en el venue B, válida en una ventana horaria futura" —
// acoplar cualquiera de ellas aquí introduciría semántica incorrecta de
// reservas/incidencias/comercio externo. Todo lo de abajo es nuevo. `qr_batches`/
// `consumption_qr_codes` (Fase 3) tampoco se reutilizan: ese QR lo escanea el
// ESTUDIANTE para GANAR tokens; el QR de Benefit lo MUESTRA el estudiante y lo
// ESCANEA EL STAFF para CONSUMIR un derecho ya concedido — flujo inverso,
// infraestructura deliberadamente separada (ver comentario de user_benefits).
//
// DISTINCIÓN DE DOMINIO: un SegoToken es saldo fungible (Fase 2). Un Benefit
// es un derecho concreto ya desbloqueado (entrada gratis, descuento, acceso
// VIP...). `benefit_definitions` es la PLANTILLA reutilizable ("Entrada
// gratis Casanova"); `user_benefits` es la CONCESIÓN individual a un usuario
// concreto ("Jorge tiene una entrada gratis en Casanova, válida mañana").

// ─── SEGOLIFE: BENEFIT_DEFINITIONS (Fase 4) ─────────────────────────────────
// Plantilla de beneficio — nunca se concede directamente, solo la referencia
// `user_benefits.benefit_definition_id`. `benefit_type` es la categoría
// semántica (usada por el frontend para icono/copy genérico); `discount_type`
// + `discount_value` son los PARÁMETROS cuando el tipo es un descuento
// (percentage → valor en puntos enteros, p.ej. 20 = 20%; fixed → céntimos
// enteros, p.ej. 500 = 5,00€ — nunca float, mismo criterio que amount_cents
// en todo el resto del schema). `value_metadata` es un JSON abierto para
// datos adicionales de un `benefit_type='custom'` sin tener que migrar el
// schema por cada variante futura — el comportamiento visual NUNCA se
// hardcodea por nombre/slug, solo por estos campos estructurados.
// `destination_venue_id`/`destination_event_id` son el DESTINO donde se
// canjea (p.ej. Casanova) — deliberadamente distinto del venue de ORIGEN que
// disparó la concesión (p.ej. Chin Chin), que vive en `benefit_rules` y
// `user_benefits.source_venue_id` (ver comentario de cross-venue más abajo).
// nameEn/nameEs/descriptionEn/descriptionEs/termsEn/termsEs son contenido de
// producto bilingüe gestionado por el admin (no textos de interfaz — esos
// siguen en client/src/locales/*/segolife.json), por eso viven en fila y no
// en el catálogo i18n.

export const benefitDefinitions = mysqlTable("benefit_definitions", {
  id:                   int("id").autoincrement().primaryKey(),
  name:                 varchar("name", { length: 256 }).notNull(),
  slug:                 varchar("slug", { length: 128 }).notNull(),
  description:          text("description"),
  benefitType:          mysqlEnum("benefit_type", [
    "free_entry", "free_product", "discount_percentage", "discount_fixed",
    "vip_access", "priority_access", "upgrade", "custom",
  ]).notNull(),
  destinationVenueId:   int("destination_venue_id"),
  destinationEventId:   int("destination_event_id"),
  productId:            int("product_id"),
  discountType:         mysqlEnum("discount_type", ["percentage", "fixed"]),
  discountValue:        int("discount_value"),
  valueMetadata:        json("value_metadata").$type<Record<string, unknown>>(),
  active:               boolean("active").notNull().default(true),
  imageUrl:             varchar("image_url", { length: 512 }),
  nameEn:               varchar("name_en", { length: 256 }),
  nameEs:               varchar("name_es", { length: 256 }),
  descriptionEn:        text("description_en"),
  descriptionEs:        text("description_es"),
  termsEn:              text("terms_en"),
  termsEs:              text("terms_es"),
  // SEGOLIFE — Benefits Marketplace & SegoTokens Redemption: columnas
  // aditivas, TODAS nullable/con default seguro — una definición histórica
  // (automática, concedida por benefit_rules) NUNCA aparece accidentalmente
  // en el marketplace solo porque tokenCost sea NULL/0 (spec §67) — la
  // condición explícita es `isMarketplaceEnabled=true` AND `tokenCost>0`,
  // nunca una sola de las dos por separado.
  tokenCost:                 int("token_cost"), // SegoTokens que cuesta canjear — NULL/0 = no comprable con tokens.
  isMarketplaceEnabled:      boolean("is_marketplace_enabled").notNull().default(false), // flag EXPLÍCITO — ver spec §67, nunca inferir de tokenCost.
  marketplaceInventoryTotal: int("marketplace_inventory_total"), // NULL = stock ilimitado. Comprometido se cuenta en caliente sobre user_benefits (mismo criterio que inventoryHoldService.ts de Native Ticketing) — nunca un contador mutable aparte.
  perStudentPurchaseLimit:   int("per_student_purchase_limit"), // NULL = sin límite por Student.
  purchaseWindowStart:       timestamp("purchase_window_start"), // cuándo puede EMPEZAR a comprarse en el marketplace (NULL = ya disponible).
  purchaseWindowEnd:         timestamp("purchase_window_end"), // cuándo deja de poder comprarse (NULL = sin fin programado).
  redemptionValidityDays:    int("redemption_validity_days"), // días desde la compra hasta que el user_benefit adquirido expira (NULL = sin caducidad) — distinto de purchaseWindow*, que regula cuándo se puede COMPRAR, no cuánto dura lo comprado.
  createdAt:            timestamp("created_at").defaultNow().notNull(),
  updatedAt:            timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  slugUnique: unique("benefit_definitions_slug_unique").on(table.slug),
}));
export type BenefitDefinition = typeof benefitDefinitions.$inferSelect;
export type InsertBenefitDefinition = typeof benefitDefinitions.$inferInsert;

// ─── SEGOLIFE: BENEFIT_COMMUNITIES (Fase 4) ─────────────────────────────────
// M2M de alcance de comunidad — mismo patrón exacto que campaign_communities.
// Una definición SIN ninguna fila aquí aplica a CUALQUIER comunidad (ver
// benefitRuleEngine.ts) — nunca se asume que el venue destino determina la
// comunidad (un venue puede ser compartido por IE y UVA pero el beneficio
// solo aplicar a una de las dos).

export const benefitCommunities = mysqlTable("benefit_communities", {
  id:                   int("id").autoincrement().primaryKey(),
  benefitDefinitionId:  int("benefit_definition_id").notNull(),
  communityId:          int("community_id").notNull(),
  createdAt:            timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  benefitCommunityUnique: unique("benefit_communities_unique").on(table.benefitDefinitionId, table.communityId),
}));
export type BenefitCommunity = typeof benefitCommunities.$inferSelect;
export type InsertBenefitCommunity = typeof benefitCommunities.$inferInsert;

// ─── SEGOLIFE: BENEFIT_RULES (Fase 4) ───────────────────────────────────────
// Mapeo ORIGEN→BENEFICIO configurable por admin — benefitRuleEngine.ts solo
// interpreta filas de esta tabla, nunca hardcodea qué origen desbloquea qué
// beneficio. `source_venue_id`/`source_event_id`/`source_product_id` son el
// ORIGEN (p.ej. consumo en Chin Chin); `benefit_definition_id` resuelve el
// DESTINO vía benefit_definitions.destination_venue_id (p.ej. Casanova) — la
// separación explícita origen≠destino es lo que permite cross-venue real.
// `community_id` filtra por comunidad del usuario que originó el evento
// (independiente de benefit_communities, que filtra la vigencia del
// beneficio ya concedido) — nullable = cualquier comunidad.
//
// VIGENCIA (ver benefitValidityEngine.ts para la interpretación exacta):
// - validity_type='immediate': valid_from=instante origen, valid_until =
//   +validity_duration_minutes (null = sin caducidad, intencional).
// - validity_type='offset': valid_from = instante origen +
//   validity_offset_minutes, valid_until = valid_from + validity_duration_minutes.
// - validity_type='day_anchored': ancla al día calendario (Europe/Madrid) del
//   instante origen + validity_days_offset. Si validity_start_time es null,
//   valid_from=instante origen (dinámico); si tiene valor "HH:MM", valid_from
//   es esa hora exacta de pared en el día ancla. Igual para
//   validity_end_time/valid_until. Si end_time <= start_time se interpreta
//   como que el fin cae al día siguiente (mismo criterio que
//   venue_token_schedules cruzando medianoche). Ejemplo canónico: consumo
//   viernes 23:45 en Chin Chin → days_offset=1, start_time="00:00",
//   end_time="01:00" → válido sábado 00:00–01:00 en Casanova.
//
// condition_days_of_week/condition_start_time/condition_end_time son
// condiciones ADICIONALES para que la regla dispare (p.ej. "solo viernes
// noche") — independientes de venue_token_schedules (que regula
// earn/spend de tokens, no la concesión de beneficios).
//
// Límites (max_per_user/max_per_day/max_total/once_per_origin/once_per_rule)
// nunca se hardcodean — ver benefitGrantService.ts, paso "límites".
//
// SEGOLIFE — BEHAVIORAL BENEFITS RULE ENGINE (Fase 6): `aggregate_metric`/
// `aggregate_threshold` son EXTENSIÓN aditiva de la condición de recurrencia
// existente (min_visits/recurrence_window), no un reemplazo — min_visits ya
// contaba eventos de earn en token_ledger (aproximación razonable cuando
// consumo≈ganancia de tokens, pero contamina el conteo si el Student gana
// tokens en el mismo venue por otro origen a la vez, p.ej. asistencia Y
// consumo la misma noche). aggregate_metric, cuando está presente, hace que
// el motor cuente sobre la tabla de hechos REAL (event_attendance/
// venue_visits/commerce_transactions/commerce_transaction_items) en vez del
// ledger — ver benefitAggregateMetrics.ts. Con aggregate_metric=null (todas
// las reglas ya existentes), el comportamiento no cambia ni un bit.
export const benefitRules = mysqlTable("benefit_rules", {
  id:                       int("id").autoincrement().primaryKey(),
  name:                     varchar("name", { length: 256 }).notNull(),
  description:              text("description"),
  sourceType:               mysqlEnum("source_type", [
    "consumption", "consumption_product", "venue_visit", "event_attendance",
    "token_earning", "recurrence", "campaign", "manual", "ticket", "future_external",
  ]).notNull(),
  sourceVenueId:            int("source_venue_id"),
  sourceEventId:            int("source_event_id"),
  sourceProductId:          int("source_product_id"),
  communityId:              int("community_id"),
  minAmountCents:           int("min_amount_cents"),
  minVisits:                int("min_visits"),
  recurrenceWindow:         mysqlEnum("recurrence_window", ["day", "week", "month"]),
  aggregateMetric:          mysqlEnum("aggregate_metric", [
    "attendance_count", "venue_visit_count", "distinct_venues", "commerce_count", "commerce_quantity", "spend_cents",
  ]),
  aggregateThreshold:       int("aggregate_threshold"),
  conditionDaysOfWeek:      json("condition_days_of_week").$type<number[]>(),
  conditionStartTime:       varchar("condition_start_time", { length: 5 }),
  conditionEndTime:         varchar("condition_end_time", { length: 5 }),
  startsAt:                 timestamp("starts_at"),
  endsAt:                   timestamp("ends_at"),
  active:                   boolean("active").notNull().default(true),
  priority:                 int("priority").notNull().default(0),
  benefitDefinitionId:      int("benefit_definition_id").notNull(),
  quantity:                 int("quantity").notNull().default(1),
  validityType:             mysqlEnum("validity_type", ["immediate", "offset", "day_anchored"]).notNull().default("immediate"),
  validityOffsetMinutes:    int("validity_offset_minutes"),
  validityDurationMinutes:  int("validity_duration_minutes"),
  validityStartTime:        varchar("validity_start_time", { length: 5 }),
  validityEndTime:          varchar("validity_end_time", { length: 5 }),
  validityDaysOffset:       int("validity_days_offset"),
  maxPerUser:               int("max_per_user"),
  maxPerDay:                int("max_per_day"),
  maxTotal:                 int("max_total"),
  oncePerOrigin:            boolean("once_per_origin").notNull().default(false),
  oncePerRule:              boolean("once_per_rule").notNull().default(false),
  createdAt:                timestamp("created_at").defaultNow().notNull(),
  updatedAt:                timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  sourceTypeActiveIdx: index("benefit_rules_source_type_active_idx").on(table.sourceType, table.active),
}));
export type BenefitRule = typeof benefitRules.$inferSelect;
export type InsertBenefitRule = typeof benefitRules.$inferInsert;

// ─── SEGOLIFE: USER_BENEFITS (Fase 4) ───────────────────────────────────────
// La concesión individual — nunca se borra (histórico permanente, incluso
// used/expired/cancelled). `source_*` traza de dónde vino (consumo, QR de
// Fase 3, manual...); `used_at_venue_id`/`used_at_event_id` registran DÓNDE
// se canjeó realmente, permitiendo separar origen≠destino incluso en el
// histórico (ver benefit_rules, comentario de cross-venue).
//
// DECISIÓN DE SEGURIDAD DEL QR — DELIBERADAMENTE DISTINTA DE FASE 3: el QR de
// consumición (Fase 3) se genera una vez, en un contexto controlado por el
// admin, y se muestra/imprime una única vez — por eso ahí solo se guarda el
// hash. Un QR de Benefit lo debe poder volver a mostrar EL PROPIO ESTUDIANTE
// en cualquier momento dentro de su ventana de vigencia (p.ej. concedido hoy,
// mostrado en la puerta mañana por la noche) — un diseño hash-only sería
// incapaz de volver a renderizar el código tras la respuesta inicial de
// concesión, rompiendo "Mis Beneficios". Por eso aquí se persiste `qr_token`
// en claro (mismo perfil de riesgo aceptado que `password_reset_tokens`) *a
// la vez* que `qr_token_hash` — el flujo de canje (staff) SIEMPRE resuelve
// por hash, nunca compara el campo en claro directamente, evitando timing
// attacks sobre esa columna. Mitigaciones: 256 bits de entropía real, single-
// use vía UPDATE condicional (igual que Fase 3), ventana de vigencia acotada,
// el campo en claro nunca se devuelve en listados (solo en el procedure
// `getMyBenefit` de UN beneficio propio, activo y vigente). El usuario pidió
// explícitamente NO implementar rotación TOTP para el MVP (ver informe de
// fase) — un token estático durante toda la vigencia es la decisión aceptada.
//
// idempotency_key (p.ej. "benefit_rule:12:consumption_qr:34:user:56") es
// UNIQUE cuando no es null — impide conceder el mismo beneficio dos veces
// ante un reintento, mismo patrón que token_ledger.idempotency_key.
//
// MVP security decision (revisión de cierre de Fase 4, confirmada, no
// rehacer sin instrucción explícita nueva):
// "the reusable benefit QR secret is persisted because the owner must be
// able to retrieve it repeatedly during the validity window. It is
// 256-bit random, single-use, time-bound and ownership-protected. Future
// hardening may migrate the secret to encrypted-at-rest token storage
// without changing the benefit domain."
// Exposición auditada (ver server/db/benefitsDb.ts, UserBenefitSafeFields /
// omitQrSecret y server/routers/benefits.ts, getMyBenefit): qr_token/
// qr_token_hash NUNCA viajan en listados (admin, CRM, ficha de venue,
// "Mis Beneficios" en lista), nunca en benefit_redemption_attempts (solo su
// SHA-256 como token_fingerprint), nunca en metadata, nunca en logs. El
// único punto de salida del valor en claro es getMyBenefit, y solo cuando
// el que pregunta es el dueño real (userId de sesión) Y el beneficio está
// vigente ahora mismo.

export const userBenefits = mysqlTable("user_benefits", {
  id:                   int("id").autoincrement().primaryKey(),
  userId:               int("user_id").notNull(),
  benefitDefinitionId:  int("benefit_definition_id").notNull(),
  benefitRuleId:        int("benefit_rule_id"),
  sourceType:           varchar("source_type", { length: 64 }).notNull(),
  sourceId:             int("source_id"),
  sourceVenueId:        int("source_venue_id"),
  sourceEventId:        int("source_event_id"),
  sourceLedgerId:       int("source_ledger_id"),
  communityId:          int("community_id"),
  status:               mysqlEnum("status", ["active", "used", "expired", "cancelled"]).notNull().default("active"),
  grantedAt:            timestamp("granted_at").defaultNow().notNull(),
  validFrom:            timestamp("valid_from").notNull(),
  validUntil:           timestamp("valid_until"),
  usedAt:               timestamp("used_at"),
  usedAtVenueId:        int("used_at_venue_id"),
  usedAtEventId:        int("used_at_event_id"),
  usedByStaffUserId:    int("used_by_staff_user_id"),
  qrToken:              varchar("qr_token", { length: 64 }),
  qrTokenHash:          varchar("qr_token_hash", { length: 64 }),
  idempotencyKey:       varchar("idempotency_key", { length: 191 }),
  metadata:             json("metadata").$type<Record<string, unknown>>(),
  grantedByUserId:      int("granted_by_user_id"),
  cancelledAt:          timestamp("cancelled_at"),
  cancelledByUserId:    int("cancelled_by_user_id"),
  cancellationReason:   varchar("cancellation_reason", { length: 256 }),
  createdAt:            timestamp("created_at").defaultNow().notNull(),
  updatedAt:            timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  idempotencyKeyUnique: unique("user_benefits_idempotency_key_unique").on(table.idempotencyKey),
  qrTokenHashUnique: unique("user_benefits_qr_token_hash_unique").on(table.qrTokenHash),
  // SEGOLIFE — BEHAVIORAL BENEFITS RULE ENGINE (Fase 6): passesLimits() ya
  // consultaba estas columnas sin índice (countGrantsByRuleForUser* /
  // hasGrantForOrigin) — cada evaluación de regla en cada asistencia/consumo
  // hacía un table scan completo de user_benefits.
  userIdIdx: index("user_benefits_user_id_idx").on(table.userId),
  benefitRuleIdIdx: index("user_benefits_benefit_rule_id_idx").on(table.benefitRuleId),
}));
export type UserBenefit = typeof userBenefits.$inferSelect;
export type InsertUserBenefit = typeof userBenefits.$inferInsert;

// ─── SEGOLIFE: BENEFIT_REDEMPTION_ATTEMPTS (Fase 4) ─────────────────────────
// Log de auditoría/antifraude del CANJE (staff escaneando) — INSERT-only,
// mismo patrón que qr_redemption_attempts de Fase 3. `token_fingerprint` es
// el SHA-256 del token escaneado (nunca el token en claro), igual que Fase 3.

export const benefitRedemptionAttempts = mysqlTable("benefit_redemption_attempts", {
  id:                 int("id").autoincrement().primaryKey(),
  userBenefitId:      int("user_benefit_id"),
  tokenFingerprint:   varchar("token_fingerprint", { length: 64 }),
  staffUserId:        int("staff_user_id"),
  venueId:            int("venue_id"),
  result:             mysqlEnum("result", [
    "valid", "already_used", "expired", "not_active_yet", "cancelled",
    "wrong_venue", "wrong_event", "unauthorized_staff", "invalid_token",
    "not_found", "rate_limited", "error",
  ]).notNull(),
  ipAddress:          varchar("ip_address", { length: 64 }),
  userAgent:          varchar("user_agent", { length: 256 }),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
});
export type BenefitRedemptionAttempt = typeof benefitRedemptionAttempts.$inferSelect;
export type InsertBenefitRedemptionAttempt = typeof benefitRedemptionAttempts.$inferInsert;

// ─── SEGOLIFE: VENUE_STAFF (Fase 4) ──────────────────────────────────────────
// Nueva dimensión de alcance RBAC — no existía en el codebase hasta ahora
// (community_admin de communityAccess.ts escopa por COMUNIDAD, no por venue
// concreto). Un usuario con permiso `benefits.redeem` pero SIN permiso global
// (`benefits.manage`) solo puede validar beneficios cuyo venue de canje tenga
// una fila aquí para su user_id — ver server/segolife/benefits/venueStaffAccess.ts.
// Sin ninguna fila para un usuario = sin ningún venue asignado (no "todos"),
// deliberadamente restrictivo por defecto en un flujo de puerta/caja.

export const venueStaff = mysqlTable("venue_staff", {
  id:         int("id").autoincrement().primaryKey(),
  userId:     int("user_id").notNull(),
  venueId:    int("venue_id").notNull(),
  active:     boolean("active").notNull().default(true),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  venueStaffUnique: unique("venue_staff_unique").on(table.userId, table.venueId),
}));
export type VenueStaff = typeof venueStaff.$inferSelect;
export type InsertVenueStaff = typeof venueStaff.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// SEGOLIFE FASE 5 — TICKETING CORE
// ═══════════════════════════════════════════════════════════════════════════
// Auditoría previa (ver docs/integrations/ticketing-commerce-architecture.md):
// NO se reutiliza `transactions` (libro fiscal REAL de Náyade — REAV/IVA/
// Redsys/comisiones), ni `bookings`/`dailyOrders`/`reservations` (reserva
// turística + pago Redsys), ni `discountCodes`/`couponRedemptions` (cupón
// externo tipo Groupon/Smartbox). Dominio nuevo, propio, se engancha a
// `events`/`venues` (Fase 1D) vía event_id/venue_id SIN tocar esas tablas.
// Dinero siempre en céntimos (int), nunca float/decimal. Sin FKs reales
// (mismo criterio que el resto del schema — ver drizzle/relations.ts vacío),
// integridad aplicada en el servicio, no en MySQL.
//
// El order/ticket/transacción Segolife EXISTE incluso si viene de un
// proveedor externo — provider + external_*_id lo trazan hasta el origen sin
// que CRM/analítica necesiten saber de dónde vino. Nunca se crean entidades
// "FourvenuesTicket"/"WeezeventOrder" — solo Segolife* con un mapping.

// ─── SALES_CHANNELS ──────────────────────────────────────────────────────────
// Un evento puede venderse por varios canales a la vez (Fourvenues +
// Segolife Native + futura Guest List). "hybrid" NUNCA se almacena — se
// DERIVA de tener >1 fila con status=active para el mismo event_id (evita
// que el dato se desincronice de la realidad). integration_type+integration_id
// es un patrón polimórfico reutilizado en todo Fase 5 (puede apuntar a
// venue_integrations o event_integrations) — ver comentario de
// external_entity_mappings más abajo.

export const salesChannels = mysqlTable("sales_channels", {
  id:               int("id").autoincrement().primaryKey(),
  eventId:          int("event_id").notNull(),
  channelType:      mysqlEnum("channel_type", ["fourvenues", "weezevent", "segolife_native", "manual", "partner"]).notNull(),
  salesMode:        mysqlEnum("sales_mode", ["external_redirect", "external_checkout", "native"]).notNull(),
  externalUrl:      varchar("external_url", { length: 1024 }),
  integrationType:  mysqlEnum("integration_type", ["venue_integration", "event_integration"]),
  integrationId:    int("integration_id"),
  status:           mysqlEnum("status", ["active", "inactive"]).notNull().default("active"),
  isPrimary:        boolean("is_primary").notNull().default(false),
  sortOrder:        int("sort_order").notNull().default(0),
  metadata:         json("metadata").$type<Record<string, unknown>>(),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type SalesChannel = typeof salesChannels.$inferSelect;
export type InsertSalesChannel = typeof salesChannels.$inferInsert;

// ─── EVENT_TICKET_TYPES ──────────────────────────────────────────────────────

export const eventTicketTypes = mysqlTable("event_ticket_types", {
  id:           int("id").autoincrement().primaryKey(),
  eventId:      int("event_id").notNull(),
  name:         varchar("name", { length: 256 }).notNull(),
  description:  text("description"),
  priceCents:   int("price_cents").notNull(),
  currency:     varchar("currency", { length: 8 }).notNull().default("EUR"),
  capacity:     int("capacity"),
  salesStart:   timestamp("sales_start"),
  salesEnd:     timestamp("sales_end"),
  status:       mysqlEnum("status", ["active", "inactive"]).notNull().default("active"),
  // SEGOLIFE — COMMERCE CORE / DOOR SALES (Fase 9, spec §14): marca un tipo
  // de entrada como vendible EN PUERTA por staff — nunca en el listado
  // público de compra online (client/src/pages/segolife/EventDetail.tsx
  // filtra por este flag), solo elegible en el picker de venta de puerta de
  // Venue App. Reutiliza TODA la infraestructura de event_ticket_types/
  // ticket_orders/event_tickets ya existente (aforo con locking real,
  // máquina de estados, emisión con QR) — spec §18: "prefer minimal safe
  // consolidation", nunca una tabla de "puerta" paralela.
  isDoorEntry:  boolean("is_door_entry").notNull().default(false),
  // SEGOLIFE — FASE 10 (spec §7): tipo de IVA de la entrada/admisión. NULL =
  // sin configurar (nunca se adivina un tipo por defecto).
  taxRateId:    int("tax_rate_id"),
  metadata:     json("metadata").$type<Record<string, unknown>>(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type EventTicketType = typeof eventTicketTypes.$inferSelect;
export type InsertEventTicketType = typeof eventTicketTypes.$inferInsert;

// ─── TICKET_ORDERS / TICKET_ORDER_ITEMS ──────────────────────────────────────
// Inventory (capacity/reserved/sold/available) se calcula EN CALIENTE desde
// event_ticket_types.capacity − SUM(ticket_order_items.quantity) de orders
// con status paid/confirmed — mismo criterio que token_ledger en Fase 2 (no
// crear una segunda fuente de verdad mutable que pueda desincronizarse). Ver
// docs/integrations/ticketing-commerce-architecture.md para la estrategia
// futura de reservation-timeout (NO implementada aún, no hace falta todavía).

// FASE 8: status ampliado (aditivo — nunca se quitan valores existentes) para
// representar la state machine real de compra nativa: pending (hold recién
// creado) → awaiting_payment (PaymentProvider invocado) → paid; pending/
// awaiting_payment → expired (hold caducado, ver expiresAt) o cancelled;
// paid → refunded/partially_refunded; cualquier estado → reconciliation_required
// si un refund no puede compensar SegoTokens/Benefits de forma automática
// (mismo criterio que commerce_transactions.status, spec Fase 8 punto 18).
// `expiresAt` es el mecanismo de HOLD temporal de inventario (spec punto 4):
// mientras status IN (pending, awaiting_payment) y expiresAt > NOW(), el
// order cuenta como inventario ocupado; pasado ese instante, deja de contar
// (se considera liberado) SIN necesidad de un job que lo borre activamente
// — getTicketTypeInventory() lo calcula en caliente igual que "sold".
export const ticketOrders = mysqlTable("ticket_orders", {
  id:                 int("id").autoincrement().primaryKey(),
  userId:             int("user_id"),
  eventId:            int("event_id").notNull(),
  salesChannelId:     int("sales_channel_id"),
  provider:           varchar("provider", { length: 32 }),
  externalOrderId:    varchar("external_order_id", { length: 128 }),
  externalPaymentId:  varchar("external_payment_id", { length: 128 }),
  status:             mysqlEnum("status", ["pending", "awaiting_payment", "paid", "cancelled", "expired", "refunded", "partially_refunded", "failed", "reconciliation_required"]).notNull().default("pending"),
  subtotalCents:      int("subtotal_cents").notNull().default(0),
  feesCents:          int("fees_cents").notNull().default(0),
  totalCents:         int("total_cents").notNull().default(0),
  currency:           varchar("currency", { length: 8 }).notNull().default("EUR"),
  buyerName:          varchar("buyer_name", { length: 256 }),
  buyerEmail:         varchar("buyer_email", { length: 320 }),
  buyerPhone:         varchar("buyer_phone", { length: 32 }),
  purchasedAt:        timestamp("purchased_at"),
  expiresAt:          timestamp("expires_at"),
  cancelledAt:        timestamp("cancelled_at"),
  refundedAt:         timestamp("refunded_at"),
  idempotencyKey:     varchar("idempotency_key", { length: 191 }),
  // ─── SEGOLIFE — COMMERCE CORE (Fase 9) ────────────────────────────────────
  // `channel` distingue CÓMO se originó un pedido nativo (spec §4: source
  // != channel) — solo tiene sentido para provider="segolife" ("online" =
  // autoservicio del Student vía checkoutService.ts, "door" = venta de
  // puerta por staff vía doorSaleService.ts); null para pedidos Fourvenues,
  // cuyo canal externo es irrelevante aquí (el `provider` ya lo dice todo).
  channel:            mysqlEnum("channel", ["online", "door"]),
  // Staff que operó una venta de puerta (spec §60, auditoría de operador) —
  // null para autoservicio online y para Fourvenues.
  operatorUserId:     int("operator_user_id"),
  // Método de pago SOLO para canales confirmados por staff (spec §46/§47:
  // "CASH"/"CARD_EXTERNAL"/"SEGOTOKENS"/"MIXED", nunca inventado) — un
  // pedido online gated por PaymentProvider deja esto null (su detalle real
  // vive en ticket_payments, con su propio proveedor/estado).
  paymentMethod:      varchar("payment_method", { length: 32 }),
  // Enlace opcional a la reserva que aplicó SegoTokens Universal Spend
  // (Fase 7) contra este pedido — mismo patrón exacto que
  // commerce_transactions.token_reservation_id, nunca muta subtotal/total.
  tokenReservationId: int("token_reservation_id"),
  metadata:           json("metadata").$type<Record<string, unknown>>(),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
  updatedAt:          timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  idempotencyKeyUnique: unique("ticket_orders_idempotency_key_unique").on(table.idempotencyKey),
  providerExternalOrderUnique: unique("ticket_orders_provider_external_unique").on(table.provider, table.externalOrderId),
  userIdIdx: index("ticket_orders_user_id_idx").on(table.userId),
}));
export type TicketOrder = typeof ticketOrders.$inferSelect;
export type InsertTicketOrder = typeof ticketOrders.$inferInsert;

// ─── TICKET_PAYMENTS (Fase 8) ─────────────────────────────────────────────────
// Auditoría antes de crearla (spec punto 7): ticket_orders.status ya cubre el
// resultado final, pero no el DETALLE de cada intento de pago (proveedor,
// referencia externa, importe, idempotencia por intento) — necesario para que
// PaymentProvider.createPayment()/confirmPayment()/refundPayment() tengan
// dónde registrar cada llamada real sin sobreescribir la anterior. NUNCA
// contiene PAN/CVV/datos de tarjeta — solo lo que el proveedor devuelve como
// referencia (id de pago, estado, importe).
export const ticketPayments = mysqlTable("ticket_payments", {
  id:                 int("id").autoincrement().primaryKey(),
  orderId:            int("order_id").notNull(),
  provider:           varchar("provider", { length: 32 }).notNull(),
  externalPaymentId:  varchar("external_payment_id", { length: 128 }),
  amountCents:        int("amount_cents").notNull(),
  currency:           varchar("currency", { length: 8 }).notNull().default("EUR"),
  status:             mysqlEnum("status", ["pending", "succeeded", "failed", "refunded"]).notNull().default("pending"),
  idempotencyKey:     varchar("idempotency_key", { length: 191 }).notNull(),
  failureReason:      varchar("failure_reason", { length: 256 }),
  metadata:           json("metadata").$type<Record<string, unknown>>(),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
  updatedAt:          timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  idempotencyKeyUnique: unique("ticket_payments_idempotency_key_unique").on(table.idempotencyKey),
}));
export type TicketPayment = typeof ticketPayments.$inferSelect;
export type InsertTicketPayment = typeof ticketPayments.$inferInsert;

export const ticketOrderItems = mysqlTable("ticket_order_items", {
  id:               int("id").autoincrement().primaryKey(),
  orderId:          int("order_id").notNull(),
  ticketTypeId:     int("ticket_type_id"),
  quantity:         int("quantity").notNull(),
  unitPriceCents:   int("unit_price_cents").notNull(),
  totalPriceCents:  int("total_price_cents").notNull(),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
});
export type TicketOrderItem = typeof ticketOrderItems.$inferSelect;
export type InsertTicketOrderItem = typeof ticketOrderItems.$inferInsert;

// ─── EVENT_TICKETS ────────────────────────────────────────────────────────────
// 1 fila por entrada individual, nativa o externa. qr_token/qr_token_hash
// nullable a propósito — deja sitio para Native Ticketing QR (spec Fase 5,
// punto 47) sin migración destructiva futura; hoy siempre null salvo que un
// proveedor externo exponga su propio código de barras/QR en metadata.

export const eventTickets = mysqlTable("event_tickets", {
  id:                     int("id").autoincrement().primaryKey(),
  eventId:                int("event_id").notNull(),
  ticketTypeId:           int("ticket_type_id"),
  orderId:                int("order_id"),
  userId:                 int("user_id"),
  salesChannel:           mysqlEnum("sales_channel", ["native", "external"]).notNull(),
  provider:               varchar("provider", { length: 32 }),
  externalTicketId:       varchar("external_ticket_id", { length: 128 }),
  externalParticipantId:  varchar("external_participant_id", { length: 128 }),
  status:                 mysqlEnum("status", ["issued", "cancelled", "refunded", "used"]).notNull().default("issued"),
  qrToken:                varchar("qr_token", { length: 64 }),
  qrTokenHash:            varchar("qr_token_hash", { length: 64 }),
  issuedAt:               timestamp("issued_at"),
  cancelledAt:            timestamp("cancelled_at"),
  refundedAt:             timestamp("refunded_at"),
  metadata:               json("metadata").$type<Record<string, unknown>>(),
  createdAt:              timestamp("created_at").defaultNow().notNull(),
  updatedAt:              timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  providerExternalTicketUnique: unique("event_tickets_provider_external_unique").on(table.provider, table.externalTicketId),
  userIdIdx: index("event_tickets_user_id_idx").on(table.userId),
}));
export type EventTicket = typeof eventTickets.$inferSelect;
export type InsertEventTicket = typeof eventTickets.$inferInsert;

// ─── EVENT_ATTENDANCE ─────────────────────────────────────────────────────────
// Fuente de verdad ÚNICA de asistencia Segolife. Idempotente por
// idempotency_key real (provider+integration+external_attendance_id
// compuesto por el servicio que inserta) — polling repetido nunca duplica.
// provider='segolife' queda preparado para un scanner de check-in propio
// futuro (spec punto 48) — dominio distinto del scanner de Benefits, no se
// reutiliza ese QR/flujo.

export const eventAttendance = mysqlTable("event_attendance", {
  id:                     int("id").autoincrement().primaryKey(),
  eventId:                int("event_id").notNull(),
  ticketId:               int("ticket_id"),
  userId:                 int("user_id").notNull(),
  venueId:                int("venue_id"),
  provider:               varchar("provider", { length: 32 }).notNull(),
  integrationType:        mysqlEnum("integration_type", ["venue_integration", "event_integration"]),
  integrationId:          int("integration_id"),
  externalAttendanceId:   varchar("external_attendance_id", { length: 128 }),
  occurredAt:             timestamp("occurred_at").notNull(),
  idempotencyKey:         varchar("idempotency_key", { length: 191 }).notNull(),
  tokensLedgerId:         int("tokens_ledger_id"),
  metadata:               json("metadata").$type<Record<string, unknown>>(),
  createdAt:              timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  idempotencyKeyUnique: unique("event_attendance_idempotency_key_unique").on(table.idempotencyKey),
  userIdIdx: index("event_attendance_user_id_idx").on(table.userId),
}));
export type EventAttendance = typeof eventAttendance.$inferSelect;
export type InsertEventAttendance = typeof eventAttendance.$inferInsert;

// SEGOLIFE — VENUE & PARTNER APP (Fase 5, spec §10-11). Hecho canónico
// SEPARADO de event_attendance, nunca un reemplazo — event_attendance sigue
// siendo la única fuente de verdad de "Student asistió a EVENTO" (eventId
// NOT NULL, deliberado, ver comentario de esa tabla). venue_visits modela
// "Student estuvo en VENUE" cuando NO hay ningún evento vigente que
// resolver — auditado antes de crear: no existía ningún equivalente (ni
// tabla de check-in de venue, ni "sesión", ni "visita" — solo un valor de
// enum sin usar en benefit_rules.source_type). Ambos hechos son mutuamente
// excluyentes por construcción: unifiedCheckinService.ts solo crea una fila
// aquí cuando resolveCurrentEventForVenue() devuelve "none" — nunca los dos
// a la vez para el mismo escaneo.
//
// IDEMPOTENCIA — día operativo de nightlife, NUNCA fecha de calendario
// (mismo problema de medianoche que event_attendance ya resolvía vía
// idempotencyKey por evento, pero aquí no hay evento que ancle nada): el
// límite de "día" se desplaza a las 06:00 Europe/Madrid en vez de 00:00 —
// una visita a las 23:55 y un rescan a las 00:20 caen en el MISMO
// operational_date ("ayer"), así que idempotencyKey =
// `venue_visit:{venueId}:{userId}:{operationalDate}` los colapsa en una
// única fila. No existen horarios de apertura configurados por venue
// todavía (venues.ts auditado, sin columna hours) — 06:00 es el modelo más
// simple y robusto documentado (spec §11: "choose the smallest robust
// model and make future configuration possible"), no una tabla de config
// nueva sin necesidad real todavía.
export const venueVisits = mysqlTable("venue_visits", {
  id:                 int("id").autoincrement().primaryKey(),
  userId:             int("user_id").notNull(),
  venueId:            int("venue_id").notNull(),
  /** Relación opcional con event_attendance — reservado para cuando SÍ hubo evento pero además queremos modelar la visita en sí (hoy: siempre null, son mutuamente excluyentes por diseño; ver comentario de arriba). */
  eventAttendanceId:  int("event_attendance_id"),
  occurredAt:         timestamp("occurred_at").notNull(),
  /** YYYY-MM-DD, día operativo (límite 06:00 Europe/Madrid) — NUNCA el día de calendario de occurredAt. */
  operationalDate:    varchar("operational_date", { length: 10 }).notNull(),
  source:             varchar("source", { length: 32 }).notNull(),
  operatorUserId:     int("operator_user_id"),
  idempotencyKey:     varchar("idempotency_key", { length: 191 }).notNull(),
  metadata:           json("metadata").$type<Record<string, unknown>>(),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  idempotencyKeyUnique: unique("venue_visits_idempotency_key_unique").on(table.idempotencyKey),
  userIdIdx: index("venue_visits_user_id_idx").on(table.userId),
  venueIdIdx: index("venue_visits_venue_id_idx").on(table.venueId),
}));
export type VenueVisit = typeof venueVisits.$inferSelect;
export type InsertVenueVisit = typeof venueVisits.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// SEGOLIFE FASE 5 — INTEGRATION HUB
// ═══════════════════════════════════════════════════════════════════════════
// Arquitectura provider-agnostic. Un adapter (Fourvenues, Weezevent, futuros)
// declara sus `capabilities` explícitas en integration_providers.capabilities
// (catálogo) y, si difieren por integración concreta (p.ej. el scope real
// autorizado a Casanova puede no incluir "consumptions" aunque la API lo
// soporte en teoría), se sobreescriben en capabilities de
// venue_integrations/event_integrations. El código SIEMPRE consulta
// capabilities, nunca asume.

export const integrationProviders = mysqlTable("integration_providers", {
  id:            int("id").autoincrement().primaryKey(),
  key:           varchar("key", { length: 32 }).notNull(),
  name:          varchar("name", { length: 128 }).notNull(),
  capabilities:  json("capabilities").$type<Record<string, boolean | "unknown">>().notNull(),
  active:        boolean("active").notNull().default(true),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  keyUnique: unique("integration_providers_key_unique").on(table.key),
}));
export type IntegrationProviderRow = typeof integrationProviders.$inferSelect;
export type InsertIntegrationProviderRow = typeof integrationProviders.$inferInsert;

// Fourvenues se configura POR VENUE — cada local (Casanova, Tía Felisa,
// Limoncello) tendrá su propia fila cuando se dé de alta, con credenciales,
// estado y sync completamente independientes entre sí. NO se siembran estos
// tres locales en esta fase — solo la infraestructura que los soportará.
export const venueIntegrations = mysqlTable("venue_integrations", {
  id:                    int("id").autoincrement().primaryKey(),
  venueId:               int("venue_id").notNull(),
  providerId:            int("provider_id").notNull(),
  externalAccountId:     varchar("external_account_id", { length: 128 }),
  externalVenueId:       varchar("external_venue_id", { length: 128 }),
  environment:           mysqlEnum("environment", ["sandbox", "production"]).notNull().default("sandbox"),
  enabled:               boolean("enabled").notNull().default(false),
  status:                mysqlEnum("status", ["not_configured", "configured", "connected", "error", "disabled"]).notNull().default("not_configured"),
  capabilities:          json("capabilities").$type<Record<string, boolean | "unknown">>(),
  // Nunca se devuelve al frontend — ver server/segolife/integrations/integrationCredentialCrypto.ts.
  credentialsEncrypted:  text("credentials_encrypted"),
  credentialsLast4:      varchar("credentials_last4", { length: 8 }),
  syncEnabled:           boolean("sync_enabled").notNull().default(false),
  syncIntervalMinutes:   int("sync_interval_minutes"),
  // Production Scheduler (2026-08-13) — gate DECOUPLADO de syncEnabled: los
  // datos (events/orders/tickets/paymentless/attendance) pueden sincronizarse
  // en vivo con loyaltyEnabled=false (default) sin conceder ni un solo
  // SegoToken/Benefit — earnTokens/evaluateBenefitsForOrigin se suprimen
  // exactamente igual que con suppressLoyalty=true. Activar loyalty real es
  // una decisión explícita posterior (flip de esta columna), nunca un efecto
  // colateral de activar el scheduler — ver integrationSyncService.ts.
  loyaltyEnabled:        boolean("loyalty_enabled").notNull().default(false),
  // Loyalty Production Hardening (2026-08-14) — override de corte SOLO para
  // este venue, por encima del corte global (ver system_settings,
  // key="loyalty_global_cutoff_at") — precedencia: override de venue > corte
  // global > sin corte. NULL = usa el corte global (o ninguno si tampoco hay
  // global). Nunca se configura una fecha real en esta fase — queda NULL.
  loyaltyCutoffOverrideAt: timestamp("loyalty_cutoff_override_at"),
  lastSyncAt:            timestamp("last_sync_at"),
  lastSuccessAt:         timestamp("last_success_at"),
  lastErrorAt:           timestamp("last_error_at"),
  lastErrorMessage:      varchar("last_error_message", { length: 512 }),
  createdAt:             timestamp("created_at").defaultNow().notNull(),
  updatedAt:             timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  venueProviderUnique: unique("venue_integrations_venue_provider_unique").on(table.venueId, table.providerId),
}));
export type VenueIntegration = typeof venueIntegrations.$inferSelect;
export type InsertVenueIntegration = typeof venueIntegrations.$inferInsert;

// Weezevent se configura POR EVENTO — no exige venue (Tankers/Mambo no
// necesitan existir como venue permanente). NO se siembran estos eventos.
export const eventIntegrations = mysqlTable("event_integrations", {
  id:                    int("id").autoincrement().primaryKey(),
  eventId:               int("event_id").notNull(),
  providerId:            int("provider_id").notNull(),
  externalEventId:       varchar("external_event_id", { length: 128 }),
  environment:           mysqlEnum("environment", ["sandbox", "production"]).notNull().default("sandbox"),
  enabled:               boolean("enabled").notNull().default(false),
  status:                mysqlEnum("status", ["not_configured", "configured", "connected", "error", "disabled"]).notNull().default("not_configured"),
  capabilities:          json("capabilities").$type<Record<string, boolean | "unknown">>(),
  credentialsEncrypted:  text("credentials_encrypted"),
  credentialsLast4:      varchar("credentials_last4", { length: 8 }),
  syncEnabled:           boolean("sync_enabled").notNull().default(false),
  syncIntervalMinutes:   int("sync_interval_minutes"),
  lastSyncAt:            timestamp("last_sync_at"),
  lastSuccessAt:         timestamp("last_success_at"),
  lastErrorAt:           timestamp("last_error_at"),
  lastErrorMessage:      varchar("last_error_message", { length: 512 }),
  createdAt:             timestamp("created_at").defaultNow().notNull(),
  updatedAt:             timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  eventProviderUnique: unique("event_integrations_event_provider_unique").on(table.eventId, table.providerId),
}));
export type EventIntegration = typeof eventIntegrations.$inferSelect;
export type InsertEventIntegration = typeof eventIntegrations.$inferInsert;

export const externalEntityMappings = mysqlTable("external_entity_mappings", {
  id:               int("id").autoincrement().primaryKey(),
  provider:         varchar("provider", { length: 32 }).notNull(),
  integrationType:  mysqlEnum("integration_type", ["venue_integration", "event_integration"]).notNull(),
  integrationId:    int("integration_id").notNull(),
  externalType:     varchar("external_type", { length: 32 }).notNull(),
  externalId:       varchar("external_id", { length: 128 }).notNull(),
  internalType:     varchar("internal_type", { length: 32 }).notNull(),
  internalId:       int("internal_id").notNull(),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  externalMappingUnique: unique("external_entity_mappings_unique").on(table.provider, table.externalType, table.externalId),
}));
export type ExternalEntityMapping = typeof externalEntityMappings.$inferSelect;
export type InsertExternalEntityMapping = typeof externalEntityMappings.$inferInsert;

export const integrationSyncRuns = mysqlTable("integration_sync_runs", {
  id:               int("id").autoincrement().primaryKey(),
  integrationType:  mysqlEnum("integration_type", ["venue_integration", "event_integration"]).notNull(),
  integrationId:    int("integration_id").notNull(),
  syncType:         mysqlEnum("sync_type", ["full", "incremental"]).notNull(),
  status:           mysqlEnum("status", ["running", "success", "partial", "failed"]).notNull().default("running"),
  fetchedCount:     int("fetched_count").notNull().default(0),
  createdCount:     int("created_count").notNull().default(0),
  updatedCount:     int("updated_count").notNull().default(0),
  unresolvedCount:  int("unresolved_count").notNull().default(0),
  failedCount:      int("failed_count").notNull().default(0),
  errorMessage:     varchar("error_message", { length: 512 }),
  // Production Scheduler (2026-08-13) — trigger ("manual"|"scheduler"),
  // mode ("incremental"|"reconciliation") y la ventana usada en ESTE run
  // concreto. Nullable: los runs anteriores a esta columna, y los disparados
  // por los scripts CLI históricos, simplemente no la rellenan — nunca se
  // exige en ningún WHERE, solo se lee para observabilidad.
  metadata:         json("metadata").$type<Record<string, unknown>>(),
  startedAt:        timestamp("started_at").defaultNow().notNull(),
  finishedAt:       timestamp("finished_at"),
});
export type IntegrationSyncRun = typeof integrationSyncRuns.$inferSelect;
export type InsertIntegrationSyncRun = typeof integrationSyncRuns.$inferInsert;

export const integrationSyncState = mysqlTable("integration_sync_state", {
  id:               int("id").autoincrement().primaryKey(),
  integrationType:  mysqlEnum("integration_type", ["venue_integration", "event_integration"]).notNull(),
  integrationId:    int("integration_id").notNull(),
  cursor:           varchar("cursor", { length: 256 }),
  updatedSince:     timestamp("updated_since"),
  updatedAt:        timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  integrationUnique: unique("integration_sync_state_unique").on(table.integrationType, table.integrationId),
}));
export type IntegrationSyncStateRow = typeof integrationSyncState.$inferSelect;
export type InsertIntegrationSyncStateRow = typeof integrationSyncState.$inferInsert;

// ─── IDENTITY RESOLUTION ──────────────────────────────────────────────────────
// Política de resolución (nunca fuzzy-match por nombre): 1) mapping previo,
// 2) email de participante, 3) teléfono de participante, 4) email de
// comprador (solo si es semánticamente la misma persona), 5) unresolved.

export const externalIdentityMappings = mysqlTable("external_identity_mappings", {
  id:                  int("id").autoincrement().primaryKey(),
  provider:            varchar("provider", { length: 32 }).notNull(),
  externalCustomerId:  varchar("external_customer_id", { length: 128 }),
  buyerEmail:          varchar("buyer_email", { length: 320 }),
  buyerPhone:          varchar("buyer_phone", { length: 32 }),
  participantEmail:    varchar("participant_email", { length: 320 }),
  participantPhone:    varchar("participant_phone", { length: 32 }),
  name:                varchar("name", { length: 256 }),
  userId:              int("user_id").notNull(),
  resolutionMethod:    mysqlEnum("resolution_method", ["previous_mapping", "participant_email", "participant_phone", "buyer_email", "manual"]).notNull(),
  createdAt:           timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  providerCustomerUnique: unique("external_identity_mappings_provider_customer_unique").on(table.provider, table.externalCustomerId),
}));
export type ExternalIdentityMapping = typeof externalIdentityMappings.$inferSelect;
export type InsertExternalIdentityMapping = typeof externalIdentityMappings.$inferInsert;

// Cola de operaciones (asistencia/comercio/pedido) que llegaron sin poder
// resolver a un userId Segolife. NUNCA se pierde una operación — queda aquí
// hasta que el admin la vincula manualmente o la descarta explícitamente.
//
// reference_type/reference_id apuntan a una fila interna YA CREADA (p.ej.
// commerce_transactions, cuyo user_id es nullable — la fila existe aunque
// la identidad no se resuelva) — nullable porque NO aplica a `attendance`:
// event_attendance.user_id es NOT NULL por diseño (spec Fase 5, punto 11 —
// la asistencia es intrínsecamente un hecho por-usuario), así que si no se
// resuelve identidad, NO existe ninguna fila event_attendance a la que
// apuntar — el contexto completo (event_id/venue_id/occurred_at/
// external_reference_id) se guarda AQUÍ MISMO para poder reprocesar una vez
// vinculado. `external_reference_id` + provider + operation_type es la
// idempotencia real contra polling repetido, para los tres tipos.
export const unresolvedOperations = mysqlTable("unresolved_operations", {
  id:                   int("id").autoincrement().primaryKey(),
  operationType:        mysqlEnum("operation_type", ["attendance", "commerce", "order"]).notNull(),
  provider:             varchar("provider", { length: 32 }).notNull(),
  integrationType:      mysqlEnum("integration_type", ["venue_integration", "event_integration"]),
  integrationId:        int("integration_id"),
  referenceType:        varchar("reference_type", { length: 32 }),
  referenceId:          int("reference_id"),
  externalReferenceId:  varchar("external_reference_id", { length: 128 }),
  eventId:              int("event_id"),
  venueId:              int("venue_id"),
  occurredAt:           timestamp("occurred_at"),
  identityHintEmail:    varchar("identity_hint_email", { length: 320 }),
  identityHintPhone:    varchar("identity_hint_phone", { length: 32 }),
  identityHintName:     varchar("identity_hint_name", { length: 256 }),
  amountCents:          int("amount_cents"),
  status:               mysqlEnum("status", ["unresolved", "linked", "ignored", "conflict"]).notNull().default("unresolved"),
  linkedUserId:         int("linked_user_id"),
  linkedByUserId:       int("linked_by_user_id"),
  linkedAt:             timestamp("linked_at"),
  createdAt:            timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  externalReferenceUnique: unique("unresolved_operations_external_reference_unique").on(table.provider, table.operationType, table.externalReferenceId),
}));
export type UnresolvedOperation = typeof unresolvedOperations.$inferSelect;
export type InsertUnresolvedOperation = typeof unresolvedOperations.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// SEGOLIFE FASE 5 — COMMERCE CORE
// ═══════════════════════════════════════════════════════════════════════════
// Dominio propio para consumiciones/operaciones de venta dentro de un local
// (Fourvenues POS futuro si el scope real lo permite, y Segolife POS nativo
// futuro) — NUNCA `transactions` (legacy fiscal). provider='segolife' queda
// preparado para un POS propio futuro: misma entidad CommerceTransaction,
// distinto provider, sin migración adicional (spec Fase 5, punto 44).

export const commerceTransactions = mysqlTable("commerce_transactions", {
  id:                     int("id").autoincrement().primaryKey(),
  userId:                 int("user_id"),
  venueId:                int("venue_id").notNull(),
  eventId:                int("event_id"),
  provider:               varchar("provider", { length: 32 }).notNull(),
  integrationType:        mysqlEnum("integration_type", ["venue_integration", "event_integration"]),
  integrationId:          int("integration_id"),
  salesChannelId:         int("sales_channel_id"),
  externalTransactionId:  varchar("external_transaction_id", { length: 128 }),
  // "partially_refunded" añadido en Fase 9 (Commerce Core) — aditivo, mismo
  // criterio que ticket_orders.status en Fase 8: ningún valor existente se
  // quita. refundedAmountCents/commerce_transaction_items.refundedQuantity
  // son la fuente de verdad de CUÁNTO se ha devuelto ya; el status solo
  // resume si queda algo por devolver.
  status:                 mysqlEnum("status", ["pending", "confirmed", "cancelled", "refunded", "partially_refunded", "reconciliation_required"]).notNull().default("pending"),
  subtotalCents:          int("subtotal_cents").notNull().default(0),
  feesCents:              int("fees_cents").notNull().default(0),
  totalCents:             int("total_cents").notNull().default(0),
  currency:               varchar("currency", { length: 8 }).notNull().default("EUR"),
  paymentMethod:          varchar("payment_method", { length: 32 }),
  occurredAt:             timestamp("occurred_at").notNull(),
  idempotencyKey:         varchar("idempotency_key", { length: 191 }).notNull(),
  loyaltyProcessedAt:     timestamp("loyalty_processed_at"),
  loyaltyLedgerId:        int("loyalty_ledger_id"),
  /** SEGOLIFE — SEGOTOKENS UNIVERSAL SPEND (Fase 7): enlace opcional a la reserva que aplicó SegoTokens a esta venta — nunca muta subtotal_cents/total_cents (siguen siendo el precio bruto real, spec §10), el valor promocional/dinero debido vive en token_spend_reservations. refundCommerceTransaction() la usa para revertir el canje simétricamente al reembolso. */
  tokenReservationId:     int("token_reservation_id"),
  // SEGOLIFE — COMMERCE CORE (Fase 9, spec §60): staff que registró la
  // venta — nativeCommerceService.recordNativeSale ya recibía staffUserId
  // pero nunca lo persistía en la propia fila (solo como createdByUserId
  // del movimiento de ledger de SegoTokens); auditoría real de "quién
  // vendió" lo necesita en la propia transacción.
  operatorUserId:         int("operator_user_id"),
  // Total ya devuelto en céntimos (spec §21, reembolso parcial) — running
  // total sobre posibles varios reembolsos parciales de la misma venta;
  // nunca puede superar totalCents (aplicación lo valida antes de escribir).
  refundedAmountCents:    int("refunded_amount_cents").notNull().default(0),
  metadata:               json("metadata").$type<Record<string, unknown>>(),
  createdAt:              timestamp("created_at").defaultNow().notNull(),
  updatedAt:              timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  idempotencyKeyUnique: unique("commerce_transactions_idempotency_key_unique").on(table.idempotencyKey),
  userIdIdx: index("commerce_transactions_user_id_idx").on(table.userId),
}));
export type CommerceTransaction = typeof commerceTransactions.$inferSelect;
export type InsertCommerceTransaction = typeof commerceTransactions.$inferInsert;

export const commerceTransactionItems = mysqlTable("commerce_transaction_items", {
  id:                 int("id").autoincrement().primaryKey(),
  transactionId:      int("transaction_id").notNull(),
  venueProductId:     int("venue_product_id"),
  externalProductId:  varchar("external_product_id", { length: 128 }),
  description:        varchar("description", { length: 256 }).notNull(),
  quantity:           int("quantity").notNull().default(1),
  unitAmountCents:    int("unit_amount_cents").notNull(),
  totalAmountCents:   int("total_amount_cents").notNull(),
  // SEGOLIFE — COMMERCE CORE (Fase 9, spec §21): cuántas unidades de ESTA
  // línea ya se han reembolsado — nunca puede superar `quantity`. Permite
  // reembolso parcial determinista por línea (p.ej. "1 de las 2 cervezas")
  // sin inventar una tabla de auditoría de líneas aparte — la propia fila
  // ya es la unidad de reembolso más pequeña que existe hoy en el POS.
  refundedQuantity:   int("refunded_quantity").notNull().default(0),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
});
export type CommerceTransactionItem = typeof commerceTransactionItems.$inferSelect;
export type InsertCommerceTransactionItem = typeof commerceTransactionItems.$inferInsert;

// ─── SEGOLIFE: COMMERCE_REFUNDS (Fase 9) ───────────────────────────────────────
// Auditado antes de crearse (spec §59/§92): ni commerce_transactions ni
// ticket_orders llevan un historial de CADA reembolso — solo su estado
// actual + un `metadata.refund` de un único objeto (se sobrescribiría en un
// segundo reembolso parcial). Tabla mínima y genérica (nunca dos tablas de
// auditoría de reembolso paralelas, una por dominio) — un evento por
// reembolso real, completo o parcial, de cualquiera de los dos dominios.
// Es el feed que alimenta la vista admin "Devoluciones" (spec §59) y el
// contador de actividad reciente de Daily Operations (spec §73) — nunca la
// fuente de verdad del propio reembolso (esa sigue siendo
// commerce_transactions/ticket_orders + event_tickets, cada una revertida
// por su propio servicio de dominio ya existente y probado).
export const commerceRefunds = mysqlTable("commerce_refunds", {
  id:                   int("id").autoincrement().primaryKey(),
  sourceType:           mysqlEnum("source_type", ["commerce_transaction", "ticket_order"]).notNull(),
  sourceId:             int("source_id").notNull(),
  venueId:              int("venue_id"),
  eventId:              int("event_id"),
  userId:               int("user_id"),
  amountCents:          int("amount_cents").notNull(),
  tokensRestored:       int("tokens_restored").notNull().default(0),
  // "completed" = dinero real devuelto (staff-confirmado o provider real);
  // "provider_unavailable" = spec §21, "calcular/registrar sin fingir que
  // el proveedor completó el reembolso" — el importe queda auditado pero
  // NUNCA se marca como devuelto de verdad si no lo fue.
  moneyRefundStatus:    mysqlEnum("money_refund_status", ["completed", "provider_unavailable"]).notNull(),
  reason:               varchar("reason", { length: 500 }).notNull(),
  partial:              boolean("partial").notNull().default(false),
  refundedByUserId:     int("refunded_by_user_id").notNull(),
  idempotencyKey:       varchar("idempotency_key", { length: 191 }),
  createdAt:            timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  idempotencyKeyUnique: unique("commerce_refunds_idempotency_key_unique").on(table.idempotencyKey),
  sourceIdx: index("commerce_refunds_source_idx").on(table.sourceType, table.sourceId),
  createdAtIdx: index("commerce_refunds_created_at_idx").on(table.createdAt),
}));
export type CommerceRefund = typeof commerceRefunds.$inferSelect;
export type InsertCommerceRefund = typeof commerceRefunds.$inferInsert;

// ─── STUDENT_IDENTITY_TOKENS (Fase 8) ─────────────────────────────────────────
// QR de identidad para POS nativo — auditado antes de crear (spec punto 23):
// NUNCA reutiliza el QR de Benefits (autoriza un canje real), el de
// Consumption (de un solo uso, hash-only) ni el de un Ticket (identifica una
// ENTRADA, no una persona). Este token identifica solo AL ESTUDIANTE frente
// al staff de un POS — el staff sigue eligiendo productos/importe a mano, el
// QR nunca autoriza un cargo por sí mismo (perfil de riesgo bajo, igual que
// llevar puesta una pulsera con nombre). Mismo patrón cripto que Benefits:
// token en claro recuperable (se muestra repetidamente desde el perfil) +
// hash único para la búsqueda del staff — nunca se compara el texto plano.
export const studentIdentityTokens = mysqlTable("student_identity_tokens", {
  id:          int("id").autoincrement().primaryKey(),
  userId:      int("user_id").notNull(),
  token:       varchar("token", { length: 64 }).notNull(),
  tokenHash:   varchar("token_hash", { length: 64 }).notNull(),
  rotatedAt:   timestamp("rotated_at"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdUnique: unique("student_identity_tokens_user_id_unique").on(table.userId),
  tokenHashUnique: unique("student_identity_tokens_token_hash_unique").on(table.tokenHash),
}));
export type StudentIdentityToken = typeof studentIdentityTokens.$inferSelect;
export type InsertStudentIdentityToken = typeof studentIdentityTokens.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// SEGOLIFE FASE 7 — ENGAGEMENT, NOTIFICATIONS & COMMUNICATIONS CORE
// ═══════════════════════════════════════════════════════════════════════════
// Auditoría previa (ver docs/engagement/architecture.md): NO se reutiliza
// `emailManager.ts`/`email_template_configs`/`email_comm_log`/
// `email_scheduled_jobs`/`customer_email_prefs` (pipeline comercial de
// Náyade — presupuestos/reservas, dominio ajeno), ni `emailTemplates.ts`
// (marca real Náyade), ni GHL/Vapi/Meta CAPI (explícitamente prohibidos).
// server/routers/notifications.ts YA EXISTE (campana admin legacy de 6
// fuentes de negocio heredadas) — el router de estudiante de esta fase se
// registra como `studentNotifications`, nunca se toca ese archivo.
//
// Sin tabla de eventos de dominio crudos — el catálogo vive en código
// (engagementEvents.ts, mismo patrón que benefitEvents.ts). La fila de
// `notifications` ES el punto de durabilidad: una vez escrita, sobrevive a
// cualquier reinicio del proceso.

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
// Entidad canónica — alimenta la inbox in-app. title/body YA RENDERIZADOS
// (snapshot inmutable, spec punto 72): editar una plantilla mañana no
// cambia lo que un estudiante ya recibió. template_key/template_version
// trazan el origen sin depender de él para mostrar el contenido.

export const notifications = mysqlTable("notifications", {
  id:               int("id").autoincrement().primaryKey(),
  userId:           int("user_id").notNull(),
  communityId:      int("community_id"),
  type:             varchar("type", { length: 64 }).notNull(),
  category:         mysqlEnum("category", ["events", "rewards", "benefits", "promotions", "account"]).notNull(),
  audienceType:     mysqlEnum("audience_type", ["transactional", "marketing"]).notNull(),
  titleEn:          varchar("title_en", { length: 256 }).notNull(),
  titleEs:          varchar("title_es", { length: 256 }).notNull(),
  bodyEn:           text("body_en").notNull(),
  bodyEs:           text("body_es").notNull(),
  deepLink:         varchar("deep_link", { length: 512 }),
  imageUrl:         varchar("image_url", { length: 512 }),
  status:           mysqlEnum("status", ["active", "archived"]).notNull().default("active"),
  priority:         mysqlEnum("priority", ["low", "normal", "high"]).notNull().default("normal"),
  templateKey:      varchar("template_key", { length: 128 }),
  templateVersion:  int("template_version"),
  sourceType:       varchar("source_type", { length: 64 }),
  sourceId:         int("source_id"),
  campaignId:       int("campaign_id"),
  idempotencyKey:   varchar("idempotency_key", { length: 191 }),
  readAt:           timestamp("read_at"),
  clickedAt:        timestamp("clicked_at"),
  expiresAt:        timestamp("expires_at"),
  metadata:         json("metadata").$type<Record<string, unknown>>(),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  idempotencyKeyUnique: unique("notifications_idempotency_key_unique").on(table.idempotencyKey),
}));
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

// ─── NOTIFICATION_DELIVERIES ──────────────────────────────────────────────────
// Separa la notificación del canal — 1 fila por canal intentado. in_app no
// necesita retry real (ya está "entregada" al escribirse notifications).

export const notificationDeliveries = mysqlTable("notification_deliveries", {
  id:                 int("id").autoincrement().primaryKey(),
  notificationId:     int("notification_id").notNull(),
  channel:            mysqlEnum("channel", ["in_app", "email", "push", "whatsapp"]).notNull(),
  provider:           varchar("provider", { length: 32 }),
  status:             mysqlEnum("status", ["pending", "sent", "delivered", "failed", "skipped", "cancelled"]).notNull().default("pending"),
  attemptCount:       int("attempt_count").notNull().default(0),
  maxAttempts:        int("max_attempts").notNull().default(3),
  scheduledAt:        timestamp("scheduled_at").notNull(),
  sentAt:             timestamp("sent_at"),
  deliveredAt:        timestamp("delivered_at"),
  failedAt:           timestamp("failed_at"),
  lastError:          varchar("last_error", { length: 512 }),
  externalMessageId:  varchar("external_message_id", { length: 191 }),
  // Communication Center — Brevo webhook (spec §20). Timestamps separados de
  // `status` a propósito: un email puede estar `delivered` Y abierto Y
  // clicado — no son estados mutuamente excluyentes de una máquina de
  // estados, son hechos que se acumulan sobre la misma entrega.
  openedAt:           timestamp("opened_at"),
  clickedAt:          timestamp("clicked_at"),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
  updatedAt:          timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  notificationChannelUnique: unique("notification_deliveries_notification_channel_unique").on(table.notificationId, table.channel),
}));
export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;
export type InsertNotificationDelivery = typeof notificationDeliveries.$inferInsert;

// ─── EMAIL_SUPPRESSIONS (Communication Center, spec §21) ───────────────────────
// Distinto de notification_preferences (opt-out de MARKETING, por elección
// del Student) — esto es supresión TÉCNICA (la dirección en sí no es
// entregable: hard bounce/blocked/spam), aplica a CUALQUIER envío
// transactional o marketing por igual. Poblada por el webhook de Brevo.

export const emailSuppressions = mysqlTable("email_suppressions", {
  id:             int("id").autoincrement().primaryKey(),
  email:          varchar("email", { length: 320 }).notNull(),
  reason:         mysqlEnum("reason", ["hard_bounce", "blocked", "spam", "manual"]).notNull(),
  source:         varchar("source", { length: 64 }).notNull(),
  notes:          varchar("notes", { length: 512 }),
  suppressedAt:   timestamp("suppressed_at").defaultNow().notNull(),
}, (table) => ({
  emailUnique: unique("email_suppressions_email_unique").on(table.email),
}));
export type EmailSuppression = typeof emailSuppressions.$inferSelect;
export type InsertEmailSuppression = typeof emailSuppressions.$inferInsert;

// ─── NOTIFICATION_PREFERENCES ─────────────────────────────────────────────────
// (user_id, category, channel) → enabled. AUSENCIA de fila = default de
// política (ver notificationPreferencesService.ts): marketing OFF,
// transactional siempre permitido independientemente de esta tabla. Esta
// tabla ES el registro de consentimiento de marketing — no hay tabla de
// consent separada (spec punto 10).

export const notificationPreferences = mysqlTable("notification_preferences", {
  id:         int("id").autoincrement().primaryKey(),
  userId:     int("user_id").notNull(),
  category:   mysqlEnum("category", ["events", "rewards", "benefits", "promotions", "account"]).notNull(),
  channel:    mysqlEnum("channel", ["in_app", "email", "push", "whatsapp"]).notNull(),
  enabled:    boolean("enabled").notNull(),
  updatedAt:  timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userCategoryChannelUnique: unique("notification_preferences_unique").on(table.userId, table.category, table.channel),
}));
export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type InsertNotificationPreference = typeof notificationPreferences.$inferInsert;

// ─── PUSH_SUBSCRIPTIONS (preparado, Push NO activado) ─────────────────────────

export const pushSubscriptions = mysqlTable("push_subscriptions", {
  id:         int("id").autoincrement().primaryKey(),
  userId:     int("user_id").notNull(),
  endpoint:   varchar("endpoint", { length: 512 }).notNull(),
  keysP256dh: varchar("keys_p256dh", { length: 256 }),
  keysAuth:   varchar("keys_auth", { length: 256 }),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
  revokedAt:  timestamp("revoked_at"),
}, (table) => ({
  endpointUnique: unique("push_subscriptions_endpoint_unique").on(table.endpoint),
}));
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type InsertPushSubscription = typeof pushSubscriptions.$inferInsert;

// ─── ENGAGEMENT_CAMPAIGNS ──────────────────────────────────────────────────────
// manual (envío inmediato) | scheduled (fecha futura) | triggered (por
// evento de dominio, spec punto 26 — infraestructura preparada, sin
// triggers activados salvo BenefitGranted → in-app, ya cubierto sin pasar
// por campaign). community_id nullable = todas las comunidades.

export const engagementCampaigns = mysqlTable("engagement_campaigns", {
  id:                   int("id").autoincrement().primaryKey(),
  name:                 varchar("name", { length: 256 }).notNull(),
  type:                 mysqlEnum("type", ["manual", "scheduled", "triggered"]).notNull(),
  status:               mysqlEnum("status", ["draft", "scheduled", "running", "completed", "cancelled"]).notNull().default("draft"),
  communityId:          int("community_id"),
  audienceDefinition:   json("audience_definition").$type<Record<string, unknown>>().notNull(),
  triggerEventType:     varchar("trigger_event_type", { length: 64 }),
  scheduledAt:          timestamp("scheduled_at"),
  audienceSnapshotAt:   timestamp("audience_snapshot_at"),
  startedAt:            timestamp("started_at"),
  completedAt:          timestamp("completed_at"),
  cancelledAt:          timestamp("cancelled_at"),
  cancelledByUserId:    int("cancelled_by_user_id"),
  createdByUserId:      int("created_by_user_id").notNull(),
  createdAt:            timestamp("created_at").defaultNow().notNull(),
  updatedAt:            timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type EngagementCampaign = typeof engagementCampaigns.$inferSelect;
export type InsertEngagementCampaign = typeof engagementCampaigns.$inferInsert;

// ─── ENGAGEMENT_CAMPAIGN_AUDIENCES ─────────────────────────────────────────────
// Snapshot de destinatarios ÚNICOS resuelto al programar/enviar (spec punto
// 70) — dos filtros que coinciden en el mismo usuario nunca lo duplican
// (spec punto 46, dedupe real vía UNIQUE, no solo por convención de código).

export const engagementCampaignAudiences = mysqlTable("engagement_campaign_audiences", {
  id:           int("id").autoincrement().primaryKey(),
  campaignId:   int("campaign_id").notNull(),
  userId:       int("user_id").notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  campaignUserUnique: unique("engagement_campaign_audiences_unique").on(table.campaignId, table.userId),
}));
export type EngagementCampaignAudience = typeof engagementCampaignAudiences.$inferSelect;
export type InsertEngagementCampaignAudience = typeof engagementCampaignAudiences.$inferInsert;

// ─── ENGAGEMENT_CAMPAIGN_MESSAGES ──────────────────────────────────────────────
// Contenido por canal — audiencia y contenido deliberadamente separados
// (spec punto 24). 1 fila por canal seleccionado en la campaña.

export const engagementCampaignMessages = mysqlTable("engagement_campaign_messages", {
  id:           int("id").autoincrement().primaryKey(),
  campaignId:   int("campaign_id").notNull(),
  channel:      mysqlEnum("channel", ["in_app", "email", "push", "whatsapp"]).notNull(),
  category:     mysqlEnum("category", ["events", "rewards", "benefits", "promotions", "account"]).notNull(),
  titleEn:      varchar("title_en", { length: 256 }).notNull(),
  titleEs:      varchar("title_es", { length: 256 }).notNull(),
  bodyEn:       text("body_en").notNull(),
  bodyEs:       text("body_es").notNull(),
  deepLink:     varchar("deep_link", { length: 512 }),
  imageUrl:     varchar("image_url", { length: 512 }),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  campaignChannelUnique: unique("engagement_campaign_messages_campaign_channel_unique").on(table.campaignId, table.channel),
}));
export type EngagementCampaignMessage = typeof engagementCampaignMessages.$inferSelect;
export type InsertEngagementCampaignMessage = typeof engagementCampaignMessages.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// SEGOLIFE — COMUNITY (Social Intelligence, Polls, Proposals & Rapid Activation)
// ═══════════════════════════════════════════════════════════════════════════
// Auditado antes de crear nada — docs/comunity/architecture.md. Conclusión de
// auditoría: no existe NINGÚN sistema de encuestas/votación/propuestas en
// todo el repo — 7 tablas nuevas, justificadas una por una (spec: "no crear
// 12 tablas si 5 resuelven correctamente el dominio").
//
// COLISIÓN DE NOMBRE evitada a propósito: ya existe `proposals`/
// `proposalOptions` (Propuestas Comerciales Náyade — Lead→Propuesta→
// Presupuesto→Reserva→Factura, drizzle/schema.ts:287-362), dominio y
// lifecycle completamente distintos. Todo lo de COMUNITY usa el prefijo
// `community_` para no chocar ni confundirse con esa infraestructura.
//
// Sin FK reales — mismo criterio consistente en todo el repo (comentarios de
// diseño en events/venues/tokenLedger etc.).

// ─── COMMUNITY_PROPOSALS ────────────────────────────────────────────────────
// Entidad central: una pregunta/encuesta publicada (creada directamente por
// un admin, o convertida desde una idea de estudiante vía
// source_student_proposal_id). audienceDefinition reutiliza EXACTAMENTE el
// mismo shape JSON que engagement_campaigns.audienceDefinition — mismo motor
// (audienceEngine.resolveAudience), nunca un segmentador paralelo.

export const communityProposals = mysqlTable("community_proposals", {
  id:                       int("id").autoincrement().primaryKey(),
  title:                    varchar("title", { length: 256 }).notNull(),
  description:              text("description"),
  questionType:             mysqlEnum("question_type", [
    "single_choice", "yes_no", "percentage_scale", "scale_1_5",
    "multiselect", "ranking", "attendance_intention", "me_apunto", "open_text",
  ]).notNull(),
  status:                   mysqlEnum("status", ["draft", "scheduled", "active", "closed", "cancelled", "converted"]).notNull().default("draft"),
  urgencyType:              mysqlEnum("urgency_type", ["flash", "scheduled"]).notNull().default("scheduled"),
  startsAt:                 timestamp("starts_at"),
  endsAt:                   timestamp("ends_at"),
  resultsVisibility:        mysqlEnum("results_visibility", ["immediate", "after_vote", "after_close", "never"]).notNull().default("after_vote"),
  allowChangeResponse:      boolean("allow_change_response").notNull().default(true),
  tokenReward:              int("token_reward"),
  coverImageUrl:            varchar("cover_image_url", { length: 512 }),
  venueId:                  int("venue_id"),
  relatedEventId:           int("related_event_id"),
  convertedEventId:         int("converted_event_id"),
  sourceStudentProposalId:  int("source_student_proposal_id"),
  audienceDefinition:       json("audience_definition").$type<Record<string, unknown>>(),
  audienceSnapshotAt:       timestamp("audience_snapshot_at"),
  // Nunca mostrar desglose por segmento con menos muestra que esto —
  // spec punto 43, "no mostrar microsegmentos que puedan identificar individuos".
  minSampleSize:            int("min_sample_size").notNull().default(5),
  createdByUserId:          int("created_by_user_id").notNull(),
  publishedAt:              timestamp("published_at"),
  closedAt:                 timestamp("closed_at"),
  cancelledAt:              timestamp("cancelled_at"),
  createdAt:                timestamp("created_at").defaultNow().notNull(),
  updatedAt:                timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  statusIdx:                index("community_proposals_status_idx").on(table.status),
  startsAtIdx:               index("community_proposals_starts_at_idx").on(table.startsAt),
  endsAtIdx:                 index("community_proposals_ends_at_idx").on(table.endsAt),
  venueIdx:                  index("community_proposals_venue_id_idx").on(table.venueId),
  sourceStudentProposalIdx:  index("community_proposals_source_student_proposal_idx").on(table.sourceStudentProposalId),
}));
export type CommunityProposal = typeof communityProposals.$inferSelect;
export type InsertCommunityProposal = typeof communityProposals.$inferInsert;

// ─── COMMUNITY_PROPOSAL_COMMUNITIES ─────────────────────────────────────────
// M2M de ALCANCE administrativo — mismo patrón exacto que benefit_communities/
// campaign_communities: sin fila = la propuesta es global (TODOS, spec punto
// 9), visible/gestionable por cualquier admin. Con filas, un community_admin
// solo puede crear/ver/gestionar si su alcance solapa con estas comunidades
// (mismo criterio que assertStudentAccessible, aplicado aquí a un bridge
// table curado en vez de a la membresía real de un estudiante). Distinto,
// a propósito, de `audienceDefinition` (JSON, en community_proposals): esta
// tabla es para SCOPING de quién puede ADMINISTRAR la propuesta; la
// audiencia real que puede RESPONDER se resuelve vía audienceEngine y puede
// ser más granular (tags, SegoScore, etc.) que el simple alcance de comunidad.

export const communityProposalCommunities = mysqlTable("community_proposal_communities", {
  id:           int("id").autoincrement().primaryKey(),
  proposalId:   int("proposal_id").notNull(),
  communityId:  int("community_id").notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  proposalCommunityUnique: unique("community_proposal_communities_unique").on(table.proposalId, table.communityId),
}));
export type CommunityProposalCommunity = typeof communityProposalCommunities.$inferSelect;
export type InsertCommunityProposalCommunity = typeof communityProposalCommunities.$inferInsert;

// ─── COMMUNITY_OPTIONS ──────────────────────────────────────────────────────
// Solo para tipos con opciones discretas (single_choice/multiselect/ranking/
// percentage_scale — cada criterio de una escala porcentual ES una "opción").
// yes_no/scale_1_5/attendance_intention/me_apunto/open_text NUNCA tienen
// filas aquí — sus respuestas posibles son fijas, resueltas en código, no
// datos configurables (evita filas vacías sin sentido).

export const communityOptions = mysqlTable("community_options", {
  id:                 int("id").autoincrement().primaryKey(),
  proposalId:         int("proposal_id").notNull(),
  label:              varchar("label", { length: 256 }).notNull(),
  sortOrder:          int("sort_order").notNull().default(0),
  // Solo relevante para single_choice — spec punto 48: "admin define qué
  // opciones cuentan como positive intent". Ignorado en el resto de tipos
  // (yes_no/attendance_intention/me_apunto tienen semántica fija en código,
  // ver communityIntentService.ts).
  isPositiveIntent:   boolean("is_positive_intent").notNull().default(false),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  proposalIdx:  index("community_options_proposal_id_idx").on(table.proposalId),
}));
export type CommunityOption = typeof communityOptions.$inferSelect;
export type InsertCommunityOption = typeof communityOptions.$inferInsert;

// ─── COMMUNITY_PROPOSAL_AUDIENCES ───────────────────────────────────────────
// Snapshot de audiencia al PUBLICAR — mismo patrón exacto que
// engagement_campaign_audiences (drizzle/schema.ts arriba): quién PODÍA
// responder queda fijado en ese momento, no cambia si luego cambian tags/
// segmentos del estudiante (spec punto 11, decisión documentada).

export const communityProposalAudiences = mysqlTable("community_proposal_audiences", {
  id:           int("id").autoincrement().primaryKey(),
  proposalId:   int("proposal_id").notNull(),
  userId:       int("user_id").notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  proposalUserUnique: unique("community_proposal_audiences_unique").on(table.proposalId, table.userId),
  userIdx:      index("community_proposal_audiences_user_id_idx").on(table.userId),
}));
export type CommunityProposalAudience = typeof communityProposalAudiences.$inferSelect;
export type InsertCommunityProposalAudience = typeof communityProposalAudiences.$inferInsert;

// ─── COMMUNITY_RESPONSES ────────────────────────────────────────────────────
// Cabecera de UN acto de respuesta (proposal+user) — separada de los VALORES
// (community_response_values) porque un multiselect/percentage_scale/ranking
// genera varias filas de valor para una única respuesta; la cabecera es la
// que sostiene la invariante UNIQUE(proposal,user) (spec punto 27),
// allow_change_response y la idempotencia de la recompensa (spec punto 77:
// "si cambia respuesta, NO volver a premiar").

export const communityResponses = mysqlTable("community_responses", {
  id:               int("id").autoincrement().primaryKey(),
  proposalId:       int("proposal_id").notNull(),
  userId:           int("user_id").notNull(),
  respondedAt:      timestamp("responded_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  rewardGranted:    boolean("reward_granted").notNull().default(false),
  tokenLedgerId:    int("token_ledger_id"),
}, (table) => ({
  proposalUserUnique: unique("community_responses_unique").on(table.proposalId, table.userId),
  userIdx:          index("community_responses_user_id_idx").on(table.userId),
}));
export type CommunityResponse = typeof communityResponses.$inferSelect;
export type InsertCommunityResponse = typeof communityResponses.$inferInsert;

// ─── COMMUNITY_RESPONSE_VALUES ──────────────────────────────────────────────
// El VALOR real de la respuesta — equilibrio deliberado (spec punto 66): ni
// todo en JSON (perderíamos agregación SQL: AVG/COUNT/GROUP BY por opción),
// ni una tabla distinta por tipo de pregunta (9 tipos → 9 tablas, exceso).
// Una fila por "unidad de valor": single_choice/yes_no/scale_1_5/
// attendance_intention/me_apunto → 1 fila; multiselect/ranking/
// percentage_scale → N filas (una por opción marcada/ordenada/puntuada).

export const communityResponseValues = mysqlTable("community_response_values", {
  id:           int("id").autoincrement().primaryKey(),
  responseId:   int("response_id").notNull(),
  // Solo relevante para single_choice/multiselect/ranking/percentage_scale.
  optionId:     int("option_id"),
  // open_text (texto libre) y yes_no ("yes"/"no").
  valueText:    text("value_text"),
  // percentage_scale (0-100 por opción), scale_1_5 (1-5), ranking (posición
  // 1..N), attendance_intention (código 0-3, ver comunityIntentService.ts).
  valueNumber:  int("value_number"),
  // Moderación — solo aplica en la práctica a open_text (spec punto 30).
  isHidden:     boolean("is_hidden").notNull().default(false),
  isFeatured:   boolean("is_featured").notNull().default(false),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  responseIdx:  index("community_response_values_response_id_idx").on(table.responseId),
  optionIdx:    index("community_response_values_option_id_idx").on(table.optionId),
}));
export type CommunityResponseValue = typeof communityResponseValues.$inferSelect;
export type InsertCommunityResponseValue = typeof communityResponseValues.$inferInsert;

// ─── COMMUNITY_STUDENT_PROPOSALS ────────────────────────────────────────────
// Ideas de estudiantes SIN estructurar (título+descripción libre) — lifecycle
// y forma distintos de community_proposals (que ya es una pregunta
// estructurada con tipo/opciones). Al aprobar y "Convertir en COMUNITY
// formal", el admin crea una fila nueva en community_proposals enlazada vía
// source_student_proposal_id — nunca se reescribe esta fila como si fuera
// ya una encuesta.

export const communityStudentProposals = mysqlTable("community_student_proposals", {
  id:                       int("id").autoincrement().primaryKey(),
  studentUserId:            int("student_user_id").notNull(),
  communityId:              int("community_id").notNull(),
  title:                    varchar("title", { length: 256 }).notNull(),
  description:              text("description"),
  venueId:                  int("venue_id"),
  suggestedDate:            date("suggested_date", { mode: "string" }),
  category:                 varchar("category", { length: 64 }),
  status:                   mysqlEnum("status", [
    "pending_moderation", "approved", "rejected", "scheduled", "active", "closed", "converted",
  ]).notNull().default("pending_moderation"),
  rejectionReasonInternal:  varchar("rejection_reason_internal", { length: 512 }),
  rejectionReasonStudent:   varchar("rejection_reason_student", { length: 512 }),
  moderatedByUserId:        int("moderated_by_user_id"),
  moderatedAt:              timestamp("moderated_at"),
  convertedProposalId:      int("converted_proposal_id"),
  createdAt:                timestamp("created_at").defaultNow().notNull(),
  updatedAt:                timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  statusIdx:        index("community_student_proposals_status_idx").on(table.status),
  studentUserIdx:   index("community_student_proposals_student_user_id_idx").on(table.studentUserId),
  communityIdx:      index("community_student_proposals_community_id_idx").on(table.communityId),
}));
export type CommunityStudentProposal = typeof communityStudentProposals.$inferSelect;
export type InsertCommunityStudentProposal = typeof communityStudentProposals.$inferInsert;

// ─── COMMUNITY_SUPPORTS ─────────────────────────────────────────────────────
// "Apoyar" una idea de estudiante pendiente/aprobada — detecta demanda antes
// de convertirla en encuesta formal (spec punto 34). Una persona = un apoyo,
// sin SegoTokens (spec explícito). Conteo SIEMPRE agregado en vivo
// (COUNT(*) sobre esta tabla) — deliberadamente SIN columna de contador
// denormalizado, mismo criterio que token_ledger/token_wallets en todo este
// repo ("nunca un contador que pueda desincronizarse de la fuente real").

export const communitySupports = mysqlTable("community_supports", {
  id:                   int("id").autoincrement().primaryKey(),
  studentProposalId:    int("student_proposal_id").notNull(),
  userId:               int("user_id").notNull(),
  createdAt:            timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  proposalUserUnique:   unique("community_supports_unique").on(table.studentProposalId, table.userId),
  userIdx:              index("community_supports_user_id_idx").on(table.userId),
}));
export type CommunitySupport = typeof communitySupports.$inferSelect;
export type InsertCommunitySupport = typeof communitySupports.$inferInsert;

// ─── SEGOLIFE: REFERRAL & INVITE REWARDS ENGINE (Fase 8) ───────────────────────
// Auditado antes de crearse (spec §76-79): dominio de referidos genuinamente
// nuevo, sin tabla previa equivalente — el único "invite"/"invitation" del
// repo es el flujo LEGACY de alta de staff (users.inviteToken/
// createInvitedUser en server/db.ts), sin ninguna relación con esto.
//
// SOLO 2 tablas nuevas (spec §76 pide auditar antes de asumir 3-4 por
// defecto) — deliberadamente NO existe `referral_clicks`: la atribución
// pre-registro se modela en el propio cliente (localStorage con código +
// timestamp del click, ver referralAttribution.ts) y se revalida/persiste
// server-side de forma ATÓMICA dentro de la misma transacción de
// registerStudent — nunca hay una fila de "click" own su propio ciclo de
// vida. Esto significa que el estado ATTRIBUTED de spec §17 no existe como
// tal: en este modelo, atribución = registro (misma operación), así que
// `referrals.status` arranca directamente en "registered".
//
// `referral_campaigns` — economía configurable por campaña (spec §11/§45).
// `communityId` NULL = todas las comunidades (nunca "ie"/"uva" hardcodeado,
// regla arquitectónica fundamental de CLAUDE.md). `attribution_window_days`
// vive aquí (campo pedido explícitamente por el constructor de campaña, spec
// §45) pero SOLO se usa como ventana efectiva cuando esta campaña es la que
// resuelve en el momento del registro — sin ninguna campaña activa que
// encaje, se usa DEFAULT_ATTRIBUTION_WINDOW_DAYS (ver referralService.ts)
// para decidir si el click sigue siendo válido, y el referido se sigue
// registrando igualmente sin promesa de recompensa (spec §34).

export const referralCampaigns = mysqlTable("referral_campaigns", {
  id:                       int("id").autoincrement().primaryKey(),
  name:                     varchar("name", { length: 256 }).notNull(),
  status:                   mysqlEnum("status", ["draft", "active", "paused", "ended", "archived"]).notNull().default("draft"),
  communityId:              int("community_id"),
  inviterRewardTokens:      int("inviter_reward_tokens").notNull(),
  inviteeRewardTokens:      int("invitee_reward_tokens").notNull(),
  // "verified_student" se mantiene en el enum por compatibilidad futura pero
  // el admin builder NO lo ofrece hoy (spec: auditoría confirmó que no existe
  // ningún hecho real de verificación de email/teléfono en el repo — ver
  // referralConversionConditions.ts) — mismo criterio que Fase 6 ocultando
  // valores de enum sin motor real detrás.
  conversionCondition:      mysqlEnum("conversion_condition", ["account_created", "verified_student", "profile_completed", "first_venue_visit", "first_event_attendance"]).notNull(),
  attributionWindowDays:    int("attribution_window_days").notNull().default(30),
  maxRewardsPerInviter:     int("max_rewards_per_inviter"),
  maxTotalConversions:      int("max_total_conversions"),
  budgetTokens:             int("budget_tokens"),
  priority:                 int("priority").notNull().default(0),
  startsAt:                 timestamp("starts_at"),
  endsAt:                   timestamp("ends_at"),
  createdByUserId:          int("created_by_user_id"),
  activatedAt:              timestamp("activated_at"),
  activatedByUserId:        int("activated_by_user_id"),
  createdAt:                timestamp("created_at").defaultNow().notNull(),
  updatedAt:                timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  statusIdx: index("referral_campaigns_status_idx").on(table.status),
  communityIdx: index("referral_campaigns_community_id_idx").on(table.communityId),
}));
export type ReferralCampaign = typeof referralCampaigns.$inferSelect;
export type InsertReferralCampaign = typeof referralCampaigns.$inferInsert;

// `referrals` — relación canónica referrer→referred (spec §17). Creada de
// forma atómica dentro de la transacción de registerStudent (spec §18: "una
// vez el registro real tiene éxito, vincular la atribución de forma
// atómica/idempotente") — nunca en un paso posterior best-effort, para que
// nunca pueda quedar un registro sin su atribución ya decidida.
//
// `referred_user_id` UNIQUE (spec §7, "un usuario referido → un referrer
// canónico", cerrado por restricción real de MySQL, no solo por lógica de
// aplicación). `inviter_reward_tokens`/`invitee_reward_tokens`/
// `required_conversion_condition` son una FOTOGRAFÍA de la campaña resuelta
// en el momento del registro (spec §46, "LA ATRIBUCIÓN FIJA LA ECONOMÍA DE
// LA CAMPAÑA") — si el admin edita la campaña después, o si la campaña
// termina antes de que el amigo complete la condición, esta fila conserva
// los importes originales prometidos. `community_id` es la comunidad REAL a
// la que se une el estudiante referido (nunca inferida del inviter, spec
// §15).
export const referrals = mysqlTable("referrals", {
  id:                           int("id").autoincrement().primaryKey(),
  referrerUserId:               int("referrer_user_id").notNull(),
  referredUserId:               int("referred_user_id").notNull(),
  referralCode:                 varchar("referral_code", { length: 16 }).notNull(),
  campaignId:                   int("campaign_id"),
  communityId:                  int("community_id"),
  status:                       mysqlEnum("status", ["registered", "converted", "rewarded", "ineligible", "expired", "cancelled"]).notNull().default("registered"),
  requiredConversionCondition:  mysqlEnum("required_conversion_condition", ["account_created", "verified_student", "profile_completed", "first_venue_visit", "first_event_attendance"]),
  convertedVia:                 mysqlEnum("converted_via", ["account_created", "verified_student", "profile_completed", "first_venue_visit", "first_event_attendance"]),
  inviterRewardTokens:          int("inviter_reward_tokens").notNull().default(0),
  inviteeRewardTokens:          int("invitee_reward_tokens").notNull().default(0),
  inviterLedgerId:              int("inviter_ledger_id"),
  inviteeLedgerId:              int("invitee_ledger_id"),
  ineligibleReason:             varchar("ineligible_reason", { length: 64 }),
  metadata:                     json("metadata").$type<Record<string, unknown>>(),
  registeredAt:                 timestamp("registered_at").defaultNow().notNull(),
  convertedAt:                  timestamp("converted_at"),
  rewardedAt:                   timestamp("rewarded_at"),
  createdAt:                    timestamp("created_at").defaultNow().notNull(),
  updatedAt:                    timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  referredUserIdUnique: unique("referrals_referred_user_id_unique").on(table.referredUserId),
  referrerIdx: index("referrals_referrer_user_id_idx").on(table.referrerUserId),
  statusIdx: index("referrals_status_idx").on(table.status),
  campaignIdx: index("referrals_campaign_id_idx").on(table.campaignId),
}));
export type Referral = typeof referrals.$inferSelect;
export type InsertReferral = typeof referrals.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// SEGOLIFE FASE 10 — FISCAL, INVOICING, STOCK & VENUE SETTLEMENTS
// ═══════════════════════════════════════════════════════════════════════════
// Auditado antes de crearse (spec §0): no existe ningún `business_entities`/
// `business_units` en este repo (esa memoria pertenece al proyecto hermano
// Hotel Nayade, no a Segolife) — se construye desde cero. `invoices` legacy
// (más arriba en este archivo) sigue existiendo para el CRM turístico
// heredado y NO se toca — Fase 10 crea una capa fiscal propia de Segolife,
// paralela, nunca mezclada con quoteId/reservationId de Náyade.

// ─── A. COMMERCIAL ENTITIES (spec §1) — quién puede ser vendedor/cobrador ──────
// Nunca se deriva el vendedor del nombre del venue (spec §2) — un venue
// apunta a una entidad mediante venueSellerConfig, nunca al revés.
export const commercialEntities = mysqlTable("commercial_entities", {
  id:             int("id").autoincrement().primaryKey(),
  legalName:      varchar("legal_name", { length: 256 }).notNull(),
  tradeName:      varchar("trade_name", { length: 256 }),
  taxId:          varchar("tax_id", { length: 32 }).notNull(),
  country:        varchar("country", { length: 2 }).notNull().default("ES"),
  fiscalAddress:  varchar("fiscal_address", { length: 512 }),
  email:          varchar("email", { length: 256 }),
  active:         boolean("active").notNull().default(true),
  currency:       varchar("currency", { length: 8 }).notNull().default("EUR"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
  updatedAt:      timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type CommercialEntity = typeof commercialEntities.$inferSelect;
export type InsertCommercialEntity = typeof commercialEntities.$inferInsert;

// ─── B. VENUE ↔ SELLER/COLLECTOR (spec §2/§59) ─────────────────────────────────
// `collectorEntityId` NULL = el propio vendedor cobra (caso simple). Solo una
// fila activa por venue — resuelta server-side, nunca confiada al cliente
// (spec §5/§86).
export const venueSellerConfig = mysqlTable("venue_seller_config", {
  id:                 int("id").autoincrement().primaryKey(),
  venueId:            int("venue_id").notNull(),
  sellerEntityId:     int("seller_entity_id").notNull(),
  collectorEntityId:  int("collector_entity_id"),
  active:             boolean("active").notNull().default(true),
  updatedByUserId:    int("updated_by_user_id"),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
  updatedAt:          timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  venueIdUnique: unique("venue_seller_config_venue_id_unique").on(table.venueId),
}));
export type VenueSellerConfig = typeof venueSellerConfig.$inferSelect;
export type InsertVenueSellerConfig = typeof venueSellerConfig.$inferInsert;

// ─── C. TAX MODEL (spec §6/§7) ──────────────────────────────────────────────────
// rateBasisPoints entero (2100 = 21,00%) — nunca decimal flotante, redondeo
// determinista en fiscalSnapshotService.ts. Nunca se infiere un tipo por
// texto de categoría (spec §7) — siempre configurado explícitamente.
export const taxRates = mysqlTable("tax_rates", {
  id:                int("id").autoincrement().primaryKey(),
  name:              varchar("name", { length: 128 }).notNull(),
  rateBasisPoints:   int("rate_basis_points").notNull(),
  country:           varchar("country", { length: 2 }).notNull().default("ES"),
  active:            boolean("active").notNull().default(true),
  createdAt:         timestamp("created_at").defaultNow().notNull(),
});
export type TaxRate = typeof taxRates.$inferSelect;
export type InsertTaxRate = typeof taxRates.$inferInsert;

// ─── D. FISCAL TRANSACTION SNAPSHOT (spec §10) ─────────────────────────────────
// Fotografía inmutable creada UNA VEZ por cada venta nativa finalizada
// (commerce_transaction confirmada / ticket_order pagado) — no requiere que
// se emita una factura (spec §21, "fiscal truth y invoice document lifecycle
// pueden ser independientes"). unique(sourceType,sourceId) = idempotente.
// grossAmountCents/promotionalValueCents/moneyDueCents reutilizan EXACTAMENTE
// la misma fuente que Fase 7 (token_spend_reservations) — nunca recalculados
// aquí (spec §9: SegoTokens nunca se representan como dinero).
export const fiscalTransactionSnapshots = mysqlTable("fiscal_transaction_snapshots", {
  id:                     int("id").autoincrement().primaryKey(),
  sourceType:             mysqlEnum("source_type", ["commerce_transaction", "ticket_order"]).notNull(),
  sourceId:               int("source_id").notNull(),
  venueId:                int("venue_id"),
  eventId:                int("event_id"),
  // Snapshot textual, no solo FK — si la entidad cambia de nombre/CIF mañana,
  // esta venta histórica conserva lo que era CIERTO en el momento (spec §3).
  sellerEntityId:         int("seller_entity_id"),
  sellerLegalName:        varchar("seller_legal_name", { length: 256 }),
  sellerTaxId:            varchar("seller_tax_id", { length: 32 }),
  collectorEntityId:      int("collector_entity_id"),
  buyerUserId:            int("buyer_user_id"),
  occurredAt:             timestamp("occurred_at").notNull(),
  currency:               varchar("currency", { length: 8 }).notNull().default("EUR"),
  grossAmountCents:       int("gross_amount_cents").notNull(),
  promotionalValueCents:  int("promotional_value_cents").notNull().default(0),
  moneyDueCents:          int("money_due_cents").notNull().default(0),
  // NULL = sin tipo de IVA configurado todavía (spec §106: producción puede
  // empezar con 0 tipos configurados) — nunca se adivina un tipo.
  taxRateBasisPoints:     int("tax_rate_basis_points"),
  taxBaseCents:           int("tax_base_cents"),
  taxAmountCents:         int("tax_amount_cents"),
  itemsSnapshot:          json("items_snapshot").$type<Array<{ description: string; quantity: number; unitAmountCents: number; totalAmountCents: number }>>(),
  paymentMethod:          varchar("payment_method", { length: 32 }),
  createdAt:              timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  sourceUnique: unique("fiscal_snapshots_source_unique").on(table.sourceType, table.sourceId),
  venueIdx: index("fiscal_snapshots_venue_idx").on(table.venueId),
  occurredAtIdx: index("fiscal_snapshots_occurred_at_idx").on(table.occurredAt),
}));
export type FiscalTransactionSnapshot = typeof fiscalTransactionSnapshots.$inferSelect;
export type InsertFiscalTransactionSnapshot = typeof fiscalTransactionSnapshots.$inferInsert;

// ─── E. BILLING PROFILES (spec §12) — nunca sustituye la identidad Student ─────
export const billingProfiles = mysqlTable("billing_profiles", {
  id:          int("id").autoincrement().primaryKey(),
  userId:      int("user_id").notNull(),
  legalName:   varchar("legal_name", { length: 256 }).notNull(),
  taxId:       varchar("tax_id", { length: 32 }).notNull(),
  address:     varchar("address", { length: 512 }),
  country:     varchar("country", { length: 2 }).notNull().default("ES"),
  email:       varchar("email", { length: 256 }),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userIdUnique: unique("billing_profiles_user_id_unique").on(table.userId),
}));
export type BillingProfile = typeof billingProfiles.$inferSelect;
export type InsertBillingProfile = typeof billingProfiles.$inferInsert;

// ─── F. INVOICE SERIES + NUMBERING (spec §14/§15) ──────────────────────────────
// Paralelo a document_counters (legacy Náyade, server/documentNumbers.ts) —
// se REUTILIZA su técnica exacta (UPDATE atómico + fallback INSERT con
// reintento en ER_DUP_ENTRY) en fiscalDocumentService.ts, pero NUNCA su
// tabla: document_counters está indexada por DocumentType (unión fija,
// compartida con presupuesto/reserva/tpv de Náyade), mientras que Segolife
// necesita series dinámicas por entidad fiscal (spec §15, "CAS-2026",
// "TF-2026", "SEG-2026") creadas por el admin, no una unión de código.
export const invoiceSeries = mysqlTable("invoice_series", {
  id:               int("id").autoincrement().primaryKey(),
  sellerEntityId:   int("seller_entity_id").notNull(),
  documentType:     mysqlEnum("document_type", ["invoice", "credit_note"]).notNull(),
  code:             varchar("code", { length: 16 }).notNull(),
  active:           boolean("active").notNull().default(true),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  entityTypeCodeUnique: unique("invoice_series_entity_type_code_unique").on(table.sellerEntityId, table.documentType, table.code),
}));
export type InvoiceSeries = typeof invoiceSeries.$inferSelect;
export type InsertInvoiceSeries = typeof invoiceSeries.$inferInsert;

export const fiscalDocumentCounters = mysqlTable("fiscal_document_counters", {
  id:             int("id").autoincrement().primaryKey(),
  seriesId:       int("series_id").notNull(),
  year:           int("year").notNull(),
  currentNumber:  int("current_number").notNull().default(0),
  updatedAt:      timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  seriesYearUnique: unique("fiscal_document_counters_series_year_unique").on(table.seriesId, table.year),
}));
export type FiscalDocumentCounter = typeof fiscalDocumentCounters.$inferSelect;
export type InsertFiscalDocumentCounter = typeof fiscalDocumentCounters.$inferInsert;

// ─── G. FISCAL DOCUMENTS (invoice / credit note) (spec §13/§17/§18) ────────────
// Solo existe una fila aquí DESDE EL MOMENTO en que un documento se emite de
// verdad (spec §16, "never assign final invoice number to draft/failed/
// cancelled order") — no hay estado "draft" almacenado; emitir = crear la
// fila con su número ya asignado, atómico. Inmutable tras crearse — una
// corrección es SIEMPRE un nuevo credit_note con originalDocumentId, nunca
// un UPDATE sobre las líneas/importes de un documento ya emitido.
export const fiscalDocuments = mysqlTable("fiscal_documents", {
  id:                     int("id").autoincrement().primaryKey(),
  documentType:           mysqlEnum("document_type", ["invoice", "credit_note"]).notNull(),
  seriesId:               int("series_id").notNull(),
  documentNumber:         varchar("document_number", { length: 32 }).notNull(),
  sellerEntityId:         int("seller_entity_id").notNull(),
  buyerBillingProfileId:  int("buyer_billing_profile_id"),
  buyerUserId:            int("buyer_user_id"),
  fiscalSnapshotId:       int("fiscal_snapshot_id"),
  originalDocumentId:     int("original_document_id"),
  issueDate:              timestamp("issue_date").notNull(),
  currency:               varchar("currency", { length: 8 }).notNull().default("EUR"),
  taxBaseCents:           int("tax_base_cents").notNull(),
  taxAmountCents:         int("tax_amount_cents").notNull(),
  totalCents:             int("total_cents").notNull(),
  pdfKey:                 varchar("pdf_key", { length: 256 }),
  reason:                 varchar("reason", { length: 500 }),
  issuedByUserId:         int("issued_by_user_id").notNull(),
  createdAt:              timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  documentNumberUnique: unique("fiscal_documents_number_unique").on(table.documentNumber),
  snapshotIdx: index("fiscal_documents_snapshot_idx").on(table.fiscalSnapshotId),
  buyerIdx: index("fiscal_documents_buyer_user_idx").on(table.buyerUserId),
}));
export type FiscalDocument = typeof fiscalDocuments.$inferSelect;
export type InsertFiscalDocument = typeof fiscalDocuments.$inferInsert;

export const fiscalDocumentLines = mysqlTable("fiscal_document_lines", {
  id:                 int("id").autoincrement().primaryKey(),
  documentId:         int("document_id").notNull(),
  description:        varchar("description", { length: 256 }).notNull(),
  quantity:           int("quantity").notNull().default(1),
  unitAmountCents:    int("unit_amount_cents").notNull(),
  totalAmountCents:   int("total_amount_cents").notNull(),
  taxRateBasisPoints: int("tax_rate_basis_points").notNull(),
  taxBaseCents:       int("tax_base_cents").notNull(),
  taxAmountCents:     int("tax_amount_cents").notNull(),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  documentIdx: index("fiscal_document_lines_document_idx").on(table.documentId),
}));
export type FiscalDocumentLine = typeof fiscalDocumentLines.$inferSelect;
export type InsertFiscalDocumentLine = typeof fiscalDocumentLines.$inferInsert;

// ─── H. PHYSICAL STOCK / INVENTORY (spec §27-43) ───────────────────────────────
// Distinto de la capacidad de entradas (inventoryHoldService.ts) — nunca se
// fusionan (spec §27). Verdad canónica = SUM(delta_quantity) de
// inventory_movements; current_stock_cached en venue_products es solo caché
// (spec §30), actualizado transaccionalmente junto al movimiento.
export const inventoryMovements = mysqlTable("inventory_movements", {
  id:               int("id").autoincrement().primaryKey(),
  venueProductId:   int("venue_product_id").notNull(),
  venueId:          int("venue_id").notNull(),
  type:             mysqlEnum("type", ["opening", "purchase", "sale", "refund", "adjustment_in", "adjustment_out", "waste", "transfer_in", "transfer_out"]).notNull(),
  deltaQuantity:    int("delta_quantity").notNull(),
  balanceAfter:     int("balance_after").notNull(),
  referenceType:    varchar("reference_type", { length: 32 }),
  referenceId:      int("reference_id"),
  reason:           varchar("reason", { length: 500 }),
  actorUserId:       int("actor_user_id"),
  idempotencyKey:   varchar("idempotency_key", { length: 191 }),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  idempotencyKeyUnique: unique("inventory_movements_idempotency_key_unique").on(table.idempotencyKey),
  productIdx: index("inventory_movements_product_idx").on(table.venueProductId),
  venueIdx: index("inventory_movements_venue_idx").on(table.venueId),
}));
export type InventoryMovement = typeof inventoryMovements.$inferSelect;
export type InsertInventoryMovement = typeof inventoryMovements.$inferInsert;

// ─── I. CASH SESSIONS (spec §44-53) ─────────────────────────────────────────────
// Deliberadamente SIN FK desde commerce_transactions/ticket_orders (spec
// principle: no tocar pipelines de Fase 9 ya probados) — el efectivo
// esperado se calcula por RANGO DE TIEMPO (openedAt..closedAt) sobre esas
// mismas tablas en cashSessionService.ts, igual que salesReadModel normaliza
// en tiempo de consulta sin nueva tabla de almacenamiento. Solo una sesión
// "open" por venue a la vez — se aplica en la app con lock, no con índice
// parcial (MySQL no los soporta).
//
// NOMBRE "venue_cash_*" (no "cash_*"): auditoría de Fase 10 encontró que
// `cash_sessions`/`cash_movements` YA EXISTEN como tablas legacy Náyade (TPV
// hotel, más arriba en este archivo) — nombre distinto evita colisión real
// de tabla en MySQL, no solo de identificador TypeScript.
export const venueCashSessions = mysqlTable("venue_cash_sessions", {
  id:                  int("id").autoincrement().primaryKey(),
  venueId:             int("venue_id").notNull(),
  openedByUserId:      int("opened_by_user_id").notNull(),
  openedAt:            timestamp("opened_at").defaultNow().notNull(),
  openingCashCents:    int("opening_cash_cents").notNull().default(0),
  closedByUserId:      int("closed_by_user_id"),
  closedAt:            timestamp("closed_at"),
  expectedCashCents:   int("expected_cash_cents"),
  countedCashCents:    int("counted_cash_cents"),
  differenceCents:     int("difference_cents"),
  status:              mysqlEnum("status", ["open", "closed"]).notNull().default("open"),
  notes:               varchar("notes", { length: 500 }),
  createdAt:           timestamp("created_at").defaultNow().notNull(),
  updatedAt:           timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  venueIdx: index("venue_cash_sessions_venue_idx").on(table.venueId),
  statusIdx: index("venue_cash_sessions_status_idx").on(table.status),
}));
export type VenueCashSession = typeof venueCashSessions.$inferSelect;
export type InsertVenueCashSession = typeof venueCashSessions.$inferInsert;

export const venueCashMovements = mysqlTable("venue_cash_movements", {
  id:             int("id").autoincrement().primaryKey(),
  cashSessionId:  int("cash_session_id").notNull(),
  type:           mysqlEnum("type", ["cash_in", "cash_out"]).notNull(),
  amountCents:    int("amount_cents").notNull(),
  reason:         varchar("reason", { length: 500 }).notNull(),
  actorUserId:    int("actor_user_id").notNull(),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  sessionIdx: index("venue_cash_movements_session_idx").on(table.cashSessionId),
}));
export type VenueCashMovement = typeof venueCashMovements.$inferSelect;
export type InsertVenueCashMovement = typeof venueCashMovements.$inferInsert;

// ─── J. COMMERCIAL AGREEMENTS & SETTLEMENTS (spec §55-69) ──────────────────────
// Un único acuerdo ACTIVO por (venueId, eventId opcional) — resuelto por
// especificidad (evento > venue) en settlementService.ts. Nunca hardcodea un
// 50/50 ni ningún % (spec §56) — basisPoints entero, 0 = "no configurado
// todavía" (spec §106, producción puede arrancar sin acuerdos).
export const commercialAgreements = mysqlTable("commercial_agreements", {
  id:                    int("id").autoincrement().primaryKey(),
  venueId:               int("venue_id").notNull(),
  eventId:               int("event_id"),
  commissionModel:       mysqlEnum("commission_model", ["platform_commission_percent", "fixed_fee", "venue_net", "no_commission"]).notNull().default("no_commission"),
  commissionBasisPoints: int("commission_basis_points").notNull().default(0),
  fixedFeeCents:         int("fixed_fee_cents").notNull().default(0),
  tokenFundingModel:     mysqlEnum("token_funding_model", ["venue_funded", "platform_funded", "shared", "no_settlement_value"]).notNull().default("no_settlement_value"),
  benefitFundingModel:   mysqlEnum("benefit_funding_model", ["venue_funded", "platform_funded", "shared", "no_settlement_value"]).notNull().default("no_settlement_value"),
  active:                boolean("active").notNull().default(true),
  createdByUserId:       int("created_by_user_id"),
  createdAt:             timestamp("created_at").defaultNow().notNull(),
  updatedAt:             timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  venueIdx: index("commercial_agreements_venue_idx").on(table.venueId),
  eventIdx: index("commercial_agreements_event_idx").on(table.eventId),
}));
export type CommercialAgreement = typeof commercialAgreements.$inferSelect;
export type InsertCommercialAgreement = typeof commercialAgreements.$inferInsert;

// Snapshot de términos EN EL MOMENTO del cálculo (spec §58/§67) — un acuerdo
// editado mañana nunca cambia una liquidación ya calculada/aprobada/pagada.
export const settlements = mysqlTable("settlements", {
  id:                      int("id").autoincrement().primaryKey(),
  venueId:                 int("venue_id").notNull(),
  eventId:                 int("event_id"),
  periodStart:             timestamp("period_start").notNull(),
  periodEnd:               timestamp("period_end").notNull(),
  status:                  mysqlEnum("status", ["draft", "calculated", "approved", "paid", "cancelled"]).notNull().default("draft"),
  sellerEntityId:          int("seller_entity_id"),
  collectorEntityId:       int("collector_entity_id"),
  commissionModel:         varchar("commission_model", { length: 32 }),
  commissionBasisPoints:   int("commission_basis_points").notNull().default(0),
  fixedFeeCents:           int("fixed_fee_cents").notNull().default(0),
  tokenFundingModel:       varchar("token_funding_model", { length: 32 }),
  benefitFundingModel:     varchar("benefit_funding_model", { length: 32 }),
  grossSalesCents:         int("gross_sales_cents").notNull().default(0),
  refundsCents:            int("refunds_cents").notNull().default(0),
  netSalesCents:           int("net_sales_cents").notNull().default(0),
  commissionCents:         int("commission_cents").notNull().default(0),
  tokenSubsidyCents:       int("token_subsidy_cents").notNull().default(0),
  benefitSubsidyCents:     int("benefit_subsidy_cents").notNull().default(0),
  // Signo: positivo = el cobrador debe pagar al venue; negativo = el venue
  // debe pagar al cobrador (spec §59, ambos flujos de caja con el mismo motor).
  netPayableToVenueCents:  int("net_payable_to_venue_cents").notNull().default(0),
  calculatedAt:            timestamp("calculated_at"),
  approvedAt:              timestamp("approved_at"),
  approvedByUserId:        int("approved_by_user_id"),
  paidAt:                  timestamp("paid_at"),
  paidByUserId:            int("paid_by_user_id"),
  notes:                   varchar("notes", { length: 500 }),
  createdAt:               timestamp("created_at").defaultNow().notNull(),
  updatedAt:               timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  venueIdx: index("settlements_venue_idx").on(table.venueId),
  statusIdx: index("settlements_status_idx").on(table.status),
}));
export type Settlement = typeof settlements.$inferSelect;
export type InsertSettlement = typeof settlements.$inferInsert;

// NOMBRE "venue_settlement_lines" (no "settlement_lines"): esa tabla ya
// existe como legacy Náyade (liquidaciones de proveedores turísticos, más
// arriba en este archivo) — colisión real de tabla, no solo de identificador.
export const venueSettlementLines = mysqlTable("venue_settlement_lines", {
  id:             int("id").autoincrement().primaryKey(),
  settlementId:   int("settlement_id").notNull(),
  sourceType:     mysqlEnum("source_type", ["commerce_transaction", "ticket_order", "commerce_refund"]).notNull(),
  sourceId:       int("source_id").notNull(),
  grossAmountCents: int("gross_amount_cents").notNull(),
  commissionCents:  int("commission_cents").notNull().default(0),
  netCents:         int("net_cents").notNull(),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  settlementIdx: index("venue_settlement_lines_settlement_idx").on(table.settlementId),
}));
export type VenueSettlementLine = typeof venueSettlementLines.$inferSelect;
export type InsertVenueSettlementLine = typeof venueSettlementLines.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// SEGOLIFE FASE 10.5 — SEGOTOKENS ECONOMY CONTROL CENTER
// ═══════════════════════════════════════════════════════════════════════════
// Auditado antes de crearse (spec §0): token_rules/token_campaigns/
// token_redemption_policies/referral_campaigns YA existen y siguen siendo la
// ÚNICA fuente de verdad económica — esta tabla es SOLO el registro de
// auditoría de cambios (spec §56), nunca un motor paralelo. Genérica
// (entityType+entityId+fieldName) para no crear una tabla de auditoría
// distinta por cada uno de los 4 tipos de entidad configurable.
export const economyConfigChanges = mysqlTable("economy_config_changes", {
  id:             int("id").autoincrement().primaryKey(),
  entityType:     mysqlEnum("entity_type", ["token_rule", "redemption_policy", "campaign", "referral_campaign"]).notNull(),
  entityId:       int("entity_id").notNull(),
  fieldName:      varchar("field_name", { length: 64 }).notNull(),
  oldValue:       varchar("old_value", { length: 256 }),
  newValue:       varchar("new_value", { length: 256 }),
  reason:         varchar("reason", { length: 500 }),
  actorUserId:    int("actor_user_id").notNull(),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  entityIdx: index("economy_config_changes_entity_idx").on(table.entityType, table.entityId),
  createdAtIdx: index("economy_config_changes_created_at_idx").on(table.createdAt),
}));
export type EconomyConfigChange = typeof economyConfigChanges.$inferSelect;
export type InsertEconomyConfigChange = typeof economyConfigChanges.$inferInsert;
