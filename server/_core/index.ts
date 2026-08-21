import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import rateLimit from "express-rate-limit";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { createLocalContext } from "./context.local";
import { createLocalAuthRouter } from "../localAuth";
import { createPasswordResetRouter } from "../passwordReset";
import { createAuthGuardMiddleware } from "../authGuard";
import uploadRouter from "../uploadRoutes";
import studentPhotoRouter from "../segolife/students/studentPhotoRoutes";
import lostFoundReportRouter from "../segolife/lostFound/lostFoundReportRoutes";
import communityProposalImageRouter from "../segolife/community/communityProposalImageRoutes";
import redsysRouter from "../redsysRoutes";
import ticketPaymentWebhookRouter from "../ticketPaymentWebhookRoutes";
import brevoWebhookRouter from "../brevoWebhookRoutes";
import { metaCapiRouter } from "../metaCapiRoute";
import settlementExportRouter from "../settlementExportRoutes";
import invoicePreviewRouter from "../invoicePreviewRouter";
import { kbRouter } from "../kbRoute";
import ghlWebhookRouter from "../ghlWebhookRouter";
import ghlInboxRouter from "../routes/ghlInboxRouter";
import vapiWebhookRouter from "../vapiWebhookRouter";
import { sitemapRouter } from "../sitemapRouter";
import { healthRouter } from "./healthRouter";
import { startCancellationStaleJob } from "../cancellationStaleJob";
import { startTokenClawbackReconciliationJob } from "../segolife/tokens/tokenClawbackReconciliationJob";
import { startEmailAutomationJob } from "../emailAutomationJob";
import { startTaxReminderJob } from "../taxReminderJob";
import { startFourvenuesScheduler } from "../segolife/integrations/integrationScheduler";
import { registerBenefitGrantedListener } from "../segolife/engagement/benefitGrantedListener";
import { registerTicketPurchasedListener } from "../segolife/engagement/ticketPurchasedListener";
import { registerOrderRefundedListener } from "../segolife/engagement/orderRefundedListener";
import { registerTicketCheckedInListener } from "../segolife/engagement/ticketCheckedInListener";
import { registerTokensEarnedListener } from "../segolife/engagement/tokensEarnedListener";
import { registerEventLifecycleListeners } from "../segolife/engagement/eventLifecycleListener";
import { registerStudentRegisteredListener } from "../segolife/engagement/studentRegisteredListener";
import { startEngagementScheduler, isEngagementDeliveryEnabled } from "../segolife/engagement/engagementScheduler";
import { startEmailIngestionJob } from "../services/emailTpvIngestionService";
import { startExpenseEmailIngestionJob } from "../services/expenseEmailIngestionService";
import { startCommercialEmailSyncJob } from "../services/commercialEmailService";
import { startMatchingJob } from "../services/cardTerminalMatchingService";
import { startRelinkJob } from "../services/cardTerminalRelinkService";
import { serveStatic, setupVite } from "./vite";
import { getFeatureFlag } from "../config";
import { canonicalRedirectTarget } from "./canonicalHost";
// seedSegolifeCommunitiesIfEmpty ya NO se importa aquí — se ejecuta solo vía
// `pnpm db:seed` (scripts/db-seed.ts). STARTUP != SEED, ver CLAUDE.md.

// --- RATE LIMITERS ------------------------------------------------------------

/**
 * Formularios públicos de lead/presupuesto: 10 req/min por IP.
 * Protege submitLead y submitBudget contra spam y bots.
 */
const leadRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Demasiadas solicitudes. Por favor espera 1 minuto antes de volver a intentarlo.",
    code: "RATE_LIMIT_EXCEEDED",
  },
});

/**
 * Autenticación local: 5 req/min por IP.
 * Previene ataques de fuerza bruta en login y recuperación de contraseña.
 */
const authRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Demasiados intentos. Espera 1 minuto antes de volver a intentarlo.",
    code: "RATE_LIMIT_EXCEEDED",
  },
});

/**
 * Endpoints de pago Redsys (IPN): 30 req/min por IP.
 * Las notificaciones IPN legítimas de Redsys son infrecuentes; este límite
 * bloquea intentos de replay o fuzzing del endpoint de notificación.
 */
const redsysRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Demasiadas peticiones al endpoint de pago.",
    code: "RATE_LIMIT_EXCEEDED",
  },
});

/**
 * Endpoint de subida de archivos: 20 req/min por IP.
 * Previene abuso de almacenamiento S3.
 */
const uploadRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Demasiadas subidas. Espera 1 minuto.",
    code: "RATE_LIMIT_EXCEEDED",
  },
});

/**
 * Canje de QR de consumición (Fase 3): 20 req/min por IP. El token en sí ya
 * tiene 256 bits de entropía real (fuerza bruta computacionalmente
 * inviable) — este límite protege contra spam/DoS del endpoint y ralentiza
 * cualquier intento automatizado, sin bloquear el uso normal de un
 * estudiante escaneando varios QR reales en una noche.
 */
const qrRedeemRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Demasiados intentos de canje. Espera 1 minuto.",
    code: "RATE_LIMIT_EXCEEDED",
  },
});

/**
 * Validación de QR de Benefit en puerta/caja (Fase 4): 30 req/min por IP —
 * reutiliza la misma infraestructura de express-rate-limit que Fase 3 (ver
 * qrRedeemRateLimit) en vez de crear un limitador nuevo desde cero. Límite
 * algo más alto que el de consumición porque un mismo terminal de puerta
 * puede validar entradas de varias personas seguidas en poco tiempo — sigue
 * sin bloquear el uso normal, solo protege contra spam/DoS del endpoint.
 */
const benefitRedeemRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Demasiados intentos de validación. Espera 1 minuto.",
    code: "RATE_LIMIT_EXCEEDED",
  },
});

/**
 * Check-in nativo de tickets en puerta (Fase 8, spec punto 33): mismo
 * límite/criterio que benefitRedeemRateLimit — reutiliza express-rate-limit
 * existente, sin infraestructura nueva.
 */
const ticketCheckinRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Demasiados intentos de validación. Espera 1 minuto.",
    code: "RATE_LIMIT_EXCEEDED",
  },
});

/**
 * Checkout/pago nativo (Fase 8, spec punto 33): límite razonable — proteger
 * contra scripts que machaquen la creación de holds/reintento de pago, sin
 * bloquear a un estudiante normal seleccionando/reintentando su compra.
 */
const ticketCheckoutRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Demasiadas solicitudes de compra. Espera 1 minuto.",
    code: "RATE_LIMIT_EXCEEDED",
  },
});

/** POS nativo (Fase 8, spec punto 33) — mismo criterio que benefitRedeemRateLimit/ticketCheckinRateLimit (un mismo terminal puede registrar varias ventas seguidas). */
const posRecordSaleRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Demasiadas operaciones de POS. Espera 1 minuto.",
    code: "RATE_LIMIT_EXCEEDED",
  },
});

/**
 * COMUNITY (spec punto 72, "abuse"): responder a una propuesta ya está
 * protegido por UNIQUE(proposal,user) — este límite es contra un script que
 * intente responder a muchas propuestas distintas muy rápido. Mismo
 * criterio/infraestructura que el resto (no hay rate limiter genérico
 * reutilizable en el repo, ver auditoría — se replica el bloque).
 */
const communityRespondRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas respuestas. Espera 1 minuto.", code: "RATE_LIMIT_EXCEEDED" },
});

/** COMUNITY — proponer un plan: límite bajo, es una acción poco frecuente en uso normal. */
const communitySubmitProposalRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas propuestas enviadas. Espera 1 minuto.", code: "RATE_LIMIT_EXCEEDED" },
});

/** COMUNITY — apoyar una idea de estudiante: protegido también por UNIQUE(proposal,user), límite generoso porque un estudiante puede apoyar varias ideas seguidas legítimamente. */
const communitySupportRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados apoyos. Espera 1 minuto.", code: "RATE_LIMIT_EXCEEDED" },
});

/** COM-01 — respuesta de Student en una conversación: generoso (una conversación real puede tener varios mensajes seguidos) pero acotado, nunca spam de cientos/segundo. */
const studentMessagesReplyRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados mensajes enviados. Espera 1 minuto.", code: "RATE_LIMIT_EXCEEDED" },
});

/** COM-01 — Admin inicia/responde una conversación: mismo criterio, alcance de uso administrativo normal. */
const studentMessagesAdminSendRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados mensajes enviados. Espera 1 minuto.", code: "RATE_LIMIT_EXCEEDED" },
});

// Modo de autenticación: LOCAL_AUTH=true usa email+password local en lugar de Manus OAuth
const USE_LOCAL_AUTH = process.env.LOCAL_AUTH === "true";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Confiar en el proxy de Railway (necesario para que express-rate-limit identifique IPs correctamente)
  app.set("trust proxy", 1);

  // Healthcheck — montado antes que nada más (sin rate limit, sin auth, sin
  // body parser) para responder lo más rápido posible. Es lo que usa
  // railway.toml como healthcheckPath.
  app.use(healthRouter);

  // Fase 15 (spec §33, "ROOT DOMAIN" — "Choose ONE canonical host"):
  // auditoría confirmó que segolife.es y www.segolife.es se servían de forma
  // IDÉNTICA, sin ningún redirect entre ambos — cada uno indexable por
  // separado (SEO duplicado) y, combinado con el bug de cookie sin `domain`
  // ya corregido en localAuth.ts, una fuente real de "sesión perdida" al
  // rebotar entre hosts. Canónico = www.segolife.es (coincide con
  // RAILWAY_PUBLIC_DOMAIN ya configurado en producción). Solo redirige el
  // apex EXACTO — nunca el dominio interno de Railway, nunca localhost,
  // nunca un preview domain — para no arriesgar el propio healthcheck de
  // Railway (que además ya respondió arriba si la request era /api/health).
  app.use((req, res, next) => {
    const target = canonicalRedirectTarget(req.hostname, req.originalUrl);
    if (target) { res.redirect(301, target); return; }
    next();
  });

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  if (USE_LOCAL_AUTH) {
    // Rate limiting en endpoints de autenticación (5 req/min por IP)
    app.use("/api/auth/login", authRateLimit);
    app.use("/api/auth/register", authRateLimit);
    app.use("/api/auth/forgot-password", authRateLimit);
    // Modo local: rutas de auth propias (login/logout/me) en lugar de Manus OAuth
    app.use(createLocalAuthRouter());
    app.use(createPasswordResetRouter());
    console.log("[Auth] Modo LOCAL_AUTH activado — usando email+password local");
  } else {
    // Modo Manus: OAuth callback
    registerOAuthRoutes(app);
  }

  // Rate limiting en formularios públicos de lead/presupuesto (10 req/min por IP)
  app.use("/api/trpc/submitLead", leadRateLimit);
  app.use("/api/trpc/submitBudget", leadRateLimit);

  // -- AUDIT: log ALL incoming requests to /api/redsys/* ------------------------
  // Este middleware corre ANTES del rate-limiter para capturar si la petición llega.
  app.use("/api/redsys", (req, _res, next) => {
    const ts = new Date().toISOString();
    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip;
    const bodyKeys = req.body ? Object.keys(req.body) : [];
    console.log(
      `[Redsys AUDIT] ${ts} | ${req.method} ${req.path} | IP=${ip} | CF-IP=${req.headers["cf-connecting-ip"] ?? "-"} | CT=${req.headers["content-type"] ?? "-"} | CL=${req.headers["content-length"] ?? "-"} | BodyKeys=[${bodyKeys.join(",")}]`
    );
    next();
  });

  // Rate limiting en endpoints de pago Redsys (30 req/min por IP)
  app.use("/api/redsys/notification", redsysRateLimit);
  app.use("/api/redsys/restaurant-notification", redsysRateLimit);
  // Mismo límite para el webhook de pago de ticketing nativo (spec §37 — mismo criterio de replay/fuzzing)
  app.use("/api/ticket-payments/webhook", redsysRateLimit);
  // Communication Center — webhook de entrega de Brevo (spec §20/§29, mismo criterio de replay/fuzzing)
  app.use("/api/engagement/brevo-webhook", redsysRateLimit);

  // Rate limiting en endpoint de subida de archivos (20 req/min por IP)
  app.use("/api/upload", uploadRateLimit);
  app.use("/api/upload-media", uploadRateLimit);
  // /api/upload-coupon (canje anónimo de cupón Groupon, sin sesión por
  // diseño) no coincidía con ninguno de los dos prefijos anteriores — subida
  // de hasta 10MB sin autenticación NI límite de frecuencia (Block J).
  app.use("/api/upload-coupon", uploadRateLimit);
  // SEGOLIFE MG-03/MG-04 — foto de perfil de Student e imagen de portada de
  // idea de Community: mismos endpoints de subida (sharp() decode + escritura
  // a storage), sin límite hasta ahora pese a exigir sesión (closure security
  // sweep, hallazgo #2/5 — mismo criterio que el resto de subidas de arriba).
  app.use("/api/students/me/photo", uploadRateLimit);
  app.use("/api/lost-found", uploadRateLimit);
  app.use("/api/community/proposal-image", uploadRateLimit);

  // Rate limiting en canje de QR de consumición (Fase 3, 20 req/min por IP)
  app.use("/api/trpc/consumptionQr.redeem", qrRedeemRateLimit);

  // Rate limiting en validación de QR de Benefit (Fase 4, 30 req/min por IP)
  app.use("/api/trpc/benefits.staffRedeem", benefitRedeemRateLimit);

  // Rate limiting en check-in nativo de tickets (Fase 8, 30 req/min por IP)
  app.use("/api/trpc/staffCheckin.checkIn", ticketCheckinRateLimit);

  // Rate limiting en checkout/pago nativo (Fase 8, 20 req/min por IP)
  app.use("/api/trpc/ticketPurchase.startCheckout", ticketCheckoutRateLimit);
  app.use("/api/trpc/ticketPurchase.initiatePayment", ticketCheckoutRateLimit);

  // Rate limiting en POS nativo (Fase 8, 30 req/min por IP)
  app.use("/api/trpc/commerce.posRecordSale", posRecordSaleRateLimit);

  // Rate limiting en COMUNITY (spec punto 72) — responder/proponer/apoyar.
  app.use("/api/trpc/community.respond", communityRespondRateLimit);
  app.use("/api/trpc/community.submitProposal", communitySubmitProposalRateLimit);
  app.use("/api/trpc/community.support", communitySupportRateLimit);

  // Rate limiting en COM-01 (Student Messages) — envío de mensajes Student/Admin.
  app.use("/api/trpc/studentMessages.reply", studentMessagesReplyRateLimit);
  app.use("/api/trpc/studentMessages.adminCreateConversation", studentMessagesAdminSendRateLimit);
  app.use("/api/trpc/studentMessages.adminReply", studentMessagesAdminSendRateLimit);

  // Middleware de protección: bloquea rutas /api/trpc de procedimientos protegidos
  // si no hay sesión válida. Funciona en ambos modos (local y Manus OAuth).
  app.use("/api/trpc", createAuthGuardMiddleware(USE_LOCAL_AUTH));
  // Servir archivos del storage local (fallback cuando S3/Forge no está configurado)
  const localStorageDir = process.env.LOCAL_STORAGE_PATH ?? "/tmp/local-storage";
  // SEGOLIFE MG-03 — el subdirectorio "private/" del mismo volumen (fotos de
  // perfil de Student, ver server/storage.ts::privateStoragePut) NUNCA debe
  // ser servible por el montaje estático público de abajo. Va ANTES de
  // express.static a propósito — sin esto, cualquiera con la clave (aunque
  // sea difícil de adivinar) podría descargar la foto sin ninguna
  // autenticación real, exactamente el riesgo que este directorio existe
  // para evitar.
  app.use("/local-storage/private", (_req, res) => {
    res.status(403).json({ error: "No autorizado." });
  });
  app.use("/local-storage", express.static(localStorageDir));
  // File upload endpoint
  app.use(uploadRouter);
  // SEGOLIFE MG-03 — Student Profile Photo (subida propia + servido autenticado)
  app.use(studentPhotoRouter);
  app.use(lostFoundReportRouter);
  // SEGOLIFE MG-04 — Community Proposals 2.0: imagen de portada pública de una idea de Student
  app.use(communityProposalImageRouter);

  // Redsys IPN notification endpoint
  app.use(redsysRouter);
  // Native ticketing — payment webhook (SEGOLIFE — Native Ticket Sales, spec §10)
  app.use(ticketPaymentWebhookRouter);
  // Communication Center — Brevo delivery webhook (spec §20)
  app.use(brevoWebhookRouter);
  // Meta Conversions API proxy (recibe eventos del cliente para envío server-side)
  app.use(metaCapiRouter);
  // Settlement Excel export endpoint
  app.use(settlementExportRouter);
  // Invoice HTML on-demand preview (no storage required)
  app.use(invoicePreviewRouter);
  app.use(kbRouter);
  // GHL webhook receiver (leads/contactos — existente)
  app.use(ghlWebhookRouter);
  // GHL Inbox — WhatsApp conversations, mensajes y SSE
  app.use(ghlInboxRouter);
  // VAPI webhook receiver (lead + presupuesto síncrono)
  app.use(vapiWebhookRouter);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext: USE_LOCAL_AUTH ? createLocalContext : createContext,
    })
  );
  // Sitemap dinámico (debe ir ANTES de serveStatic para que Express lo intercepte)
  app.use(sitemapRouter);
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

// runMigrations() se movió a scripts/db-migrate.ts (comando explícito `pnpm db:migrate`).
// STARTUP != MIGRATION — ver CLAUDE.md, fase de saneamiento de startup.
// ensureCriticalSeeds() se eliminó de aquí. Su parte de reparación de schema
// (fiscal general_21->general, ENUM role, tablas proposals) se movió a
// applyLegacyFiscalAndRoleSchemaFixes() en server/_core/legacyMaintenance.ts
// (solo vía `pnpm db:migrate`). Su parte de datos NUNCA se movió a ningún
// sitio y se eliminó por completo: forzaba el teléfono real de Náyade
// Experiences en system_settings, inyectaba reservas@nayadeexperiences.es en
// el HTML de plantillas de email guardadas, y sembraba una home de CMS con
// marca real de Náyade — ver CLAUDE.md, fase de saneamiento de startup.
// migrateSiteSettingsToSystemSettings() se movió a server/_core/legacyMaintenance.ts
// (solo vía `pnpm db:migrate`).
//
// seedExperiencesIfEmpty() se movió a server/_core/legacyNayadeContentSeeds.ts,
// deliberadamente DESCONECTADO de cualquier script — sembraba el catálogo real
// de experiencias de Náyade (textos e imágenes de su CDN). Ver CLAUDE.md.

// ensurePricingColumns() / ensureLeadSourceColumn() / ensureTicketingChannel()
// se movieron a server/_core/legacyMaintenance.ts (solo vía `pnpm db:migrate`).

// ensureExpenseEmailIngestionSchema() se movió a server/_core/legacyMaintenance.ts
// (solo vía `pnpm db:migrate`). Los feature flags que registraba con
// enabled=1/default_enabled=1 (card_terminal_relink_enabled, partners_module_enabled)
// ahora se registran desactivados (0,0) — ver CLAUDE.md.
// ensureReservationPublicToken() / ensureRefundColumns() / ensureDiscountColumns()
// se movieron a server/_core/legacyMaintenance.ts (solo vía `pnpm db:migrate`).

// --- WIPE TEST DATA (one-shot, gated by WIPE_TEST_DATA=true env var) ----------
async function wipeTestDataIfRequested() {
  if (process.env.WIPE_TEST_DATA !== "true" || process.env.NODE_ENV === "production") return;

  console.log("[Wipe] ??  WIPE_TEST_DATA=true detectado — limpiando datos de prueba...");
  const mysql = await import("mysql2/promise");
  const conn = await mysql.default.createConnection(process.env.DATABASE_URL!);

  // Helper: count + truncate with log
  async function wipe(table: string) {
    const [rows] = await conn.execute(`SELECT COUNT(*) as cnt FROM \`${table}\``) as any[];
    const cnt = rows[0].cnt;
    if (cnt > 0) {
      await conn.execute(`DELETE FROM \`${table}\``);
      console.log(`[Wipe] ? ${table}: ${cnt} registros eliminados`);
    } else {
      console.log(`[Wipe] — ${table}: ya vacía`);
    }
  }

  try {
    await conn.execute("SET FOREIGN_KEY_CHECKS=0");

    // Child tables first (FK dependencies)
    await wipe("discount_code_uses");      // Bonos (usos)
    await wipe("booking_monitors");        // Reservas (hijos de bookings)
    await wipe("reservation_operational"); // Reservas operacional
    await wipe("cancellation_requests");   // Anulaciones
    await wipe("crm_activity_log");        // Leads activity
    await wipe("ghl_webhook_logs");        // Leads GHL

    // Parent tables
    await wipe("pending_payments");        // Pagos Pendientes
    await wipe("daily_orders");            // Calendario / Actividades del día
    await wipe("invoices");                // Facturas
    await wipe("bookings");                // Reservas
    await wipe("reservations");            // Reservas principal
    await wipe("quotes");                  // Presupuestos
    await wipe("leads");                   // Leads

    await conn.execute("SET FOREIGN_KEY_CHECKS=1");
    console.log("[Wipe] ? Limpieza completada. REAV, liquidaciones, transacciones y catálogo intactos.");
    console.log("[Wipe] ??  Retira la variable WIPE_TEST_DATA del entorno para el próximo deploy.");
  } catch (err: any) {
    await conn.execute("SET FOREIGN_KEY_CHECKS=1").catch(() => {});
    console.error("[Wipe] ? Error durante la limpieza:", err.message);
  } finally {
    await conn.end();
  }
}

// --- ABANDONED CHECKOUT CLEANUP -----------------------------------------------
// Cada 20 minutos busca reservas pending_payment+ONLINE_DIRECTO sin pago durante
// más de 60 minutos. Las convierte en leads "Venta Perdida" y las cancela.
// Esto cubre el caso en que el cliente abandona el pago sin que Redsys envíe IPN.
function startAbandonedCheckoutCleanup() {
  const CHECK_INTERVAL_MS        = 10 * 60 * 1000;  // 10 min
  const STALE_DIRECT_MS          = 90 * 60 * 1000;  // Flujo 2: compra directa ? Venta Perdida tras 90 min (Redsys expira a los 30 min; 90 min garantiza que el IPN llegó)
  const STALE_QUOTE_MS           = 60 * 60 * 1000;  // Flujo 1: presupuesto ? pago_fallido tras 60 min

  let _abandonedPool: any = null;
  let _abandonedDb: any = null;

  async function run() {
    try {
      const mysql = await import("mysql2/promise");
      const { drizzle } = await import("drizzle-orm/mysql2");
      const { reservations, quotes } = await import("../../drizzle/schema");
      const { eq, and, lte, isNotNull } = await import("drizzle-orm");
      const { createVentaPerdidaLead, logActivity } = await import("../db");

      if (!_abandonedPool) {
        _abandonedPool = mysql.default.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
        _abandonedDb = drizzle(_abandonedPool);
      }
      const db = _abandonedDb;

      const staleDirectThreshold = Date.now() - STALE_DIRECT_MS;
      const staleQuoteThreshold  = Date.now() - STALE_QUOTE_MS;

      // -- Caso A: checkout directo ONLINE_DIRECTO sin presupuesto ? Venta Perdida --
      const stale = await db
        .select()
        .from(reservations)
        .where(and(
          eq(reservations.status, "pending_payment"),
          eq(reservations.channel, "ONLINE_DIRECTO"),
          lte(reservations.createdAt as any, staleDirectThreshold)
        ));

      const byOrder = new Map<string, typeof stale>();
      for (const r of stale) {
        if ((r as any).quoteId) continue; // Reservas de presupuesto: se tratan en Caso B
        const key = r.merchantOrder;
        if (!byOrder.has(key)) byOrder.set(key, []);
        byOrder.get(key)!.push(r);
      }

      for (const [order, group] of byOrder) {
        await createVentaPerdidaLead(group as any);
        await db
          .update(reservations)
          .set({ status: "cancelled", updatedAt: Date.now() } as any)
          .where(and(eq(reservations.merchantOrder, order), eq(reservations.status, "pending_payment")));
        console.log(`[AbandonedCheckout] Checkout abandonado ${order} cancelado ? Lead Venta Perdida registrado`);
      }

      // -- Caso B: reserva vinculada a presupuesto + 60 min sin pago ? pago_fallido --
      const staleQuoteReservations = await db
        .select({ id: reservations.id, quoteId: reservations.quoteId, merchantOrder: reservations.merchantOrder })
        .from(reservations)
        .where(and(
          eq(reservations.status, "pending_payment"),
          isNotNull(reservations.quoteId),
          lte(reservations.createdAt as any, staleQuoteThreshold)
        ));

      for (const resv of staleQuoteReservations) {
        if (!resv.quoteId) continue;
        try {
          const [currentQuote] = await db
            .select({ id: quotes.id, status: quotes.status, viewedAt: quotes.viewedAt })
            .from(quotes).where(eq(quotes.id, resv.quoteId)).limit(1);

          if (!currentQuote || currentQuote.status === "pagado" || currentQuote.status === "aceptado") continue;

          const now = new Date();

          // Marcar la reserva como failed para que el próximo intento genere un nuevo merchantOrder
          // Sin esto, payWithToken reutiliza el mismo merchantOrder y Redsys devuelve "Número de pedido repetido"
          await db.update(reservations).set({ status: "failed", updatedAt: Date.now() } as any)
            .where(eq(reservations.id, resv.id));

          await db.update(quotes).set({
            status: "pago_fallido",
            viewedAt: currentQuote.viewedAt ?? now,
            updatedAt: now,
          }).where(eq(quotes.id, resv.quoteId));

          await logActivity("quote", resv.quoteId, "payment_abandoned_timeout", null, "Sistema (AbandonedCheckout)", {
            merchantOrder: resv.merchantOrder,
            reservationId: resv.id,
            staleAfterMinutes: 60,
          });

          console.log(`[AbandonedCheckout] Presupuesto id=${resv.quoteId} ? pago_fallido, reserva ${resv.merchantOrder} ? failed (sin pago tras 60 min)`);
        } catch (qErr: any) {
          console.error(`[AbandonedCheckout] Error actualizando quote id=${resv.quoteId}:`, qErr.message);
        }
      }

    } catch (err: any) {
      console.error("[AbandonedCheckout] Error en limpieza:", err.message, err.cause ?? "");
    }
    setTimeout(run, CHECK_INTERVAL_MS);
  }

  // Primera ejecución tras arranque completo (evita competir con las migraciones)
  setTimeout(run, CHECK_INTERVAL_MS);
  console.log("[AbandonedCheckout] Job iniciado — checkeo de checkouts abandonados cada 20 min");
}

// --- INSTALLMENT OVERDUE + REMINDER JOB --------------------------------------
// Cada hora: marca como 'overdue' las cuotas vencidas y envía recordatorio
// por email a los clientes con cuotas que vencen en 3 días.
function startInstallmentOverdueJob() {
  const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hora

  let _installmentPool: any = null;
  let _installmentDb: any = null;

  async function run() {
    try {
      const mysql = await import("mysql2/promise");
      const { drizzle } = await import("drizzle-orm/mysql2");
      const { paymentInstallments, quotes, leads } = await import("../../drizzle/schema");
      const { eq, and, lte, lt, ne, sql } = await import("drizzle-orm");
      const { sendEmail } = await import("../mailer");
      const { buildInstallmentReminderHtml } = await import("../emailTemplates");

      if (!_installmentPool) {
        _installmentPool = mysql.default.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
        _installmentDb = drizzle(_installmentPool);
      }
      const db = _installmentDb;
      const todayStr = new Date().toISOString().split("T")[0];

      // 1. Marcar como vencidas cuotas pending cuya fecha de vencimiento ha pasado
      const overdueResult = await db
        .update(paymentInstallments)
        .set({ status: "overdue", updatedAt: new Date() })
        .where(and(
          eq(paymentInstallments.status, "pending"),
          lte(paymentInstallments.dueDate, todayStr),
        ));
      const overdueCount = (overdueResult[0] as any).affectedRows ?? 0;
      if (overdueCount > 0) {
        console.log(`[InstallmentJob] ${overdueCount} cuota(s) marcadas como vencidas`);
      }

      // 2. Enviar recordatorio por email a cuotas que vencen en exactamente 3 días
      const reminderDate = new Date();
      reminderDate.setDate(reminderDate.getDate() + 3);
      const reminderDateStr = reminderDate.toISOString().split("T")[0];

      const dueIn3Days = await db
        .select({
          id: paymentInstallments.id,
          quoteId: paymentInstallments.quoteId,
          installmentNumber: paymentInstallments.installmentNumber,
          amountCents: paymentInstallments.amountCents,
          dueDate: paymentInstallments.dueDate,
          remindersSent: paymentInstallments.remindersSent,
          quoteNumber: quotes.quoteNumber,
          clientEmail: leads.email,
          clientName: leads.name,
        })
        .from(paymentInstallments)
        .innerJoin(quotes, eq(quotes.id, paymentInstallments.quoteId))
        .leftJoin(leads, eq(leads.id, quotes.leadId))
        .where(and(
          eq(paymentInstallments.status, "pending"),
          eq(paymentInstallments.dueDate, reminderDateStr),
          lt(paymentInstallments.remindersSent, 1),
          sql.raw(`EXISTS (SELECT 1 FROM payment_installments pi2 WHERE pi2.quote_id = payment_installments.quote_id AND pi2.status = 'paid')`),
        ));

      for (const inst of dueIn3Days) {
        if (!inst.clientEmail) continue;
        // Contar total cuotas del mismo quote
        const allInstallments = await db
          .select({ id: paymentInstallments.id })
          .from(paymentInstallments)
          .where(eq(paymentInstallments.quoteId, inst.quoteId));

        try {
          const html = buildInstallmentReminderHtml({
            clientName: inst.clientName ?? "Cliente",
            clientEmail: inst.clientEmail,
            quoteNumber: inst.quoteNumber ?? "",
            installmentNumber: inst.installmentNumber,
            totalInstallments: allInstallments.length,
            amountFormatted: `${(inst.amountCents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €`,
            dueDate: inst.dueDate,
          });
          await sendEmail({
            to: inst.clientEmail,
            subject: `Recordatorio: cuota ${inst.installmentNumber}/${allInstallments.length} vence el ${inst.dueDate}`,
            html,
          });
          await db
            .update(paymentInstallments)
            .set({ remindersSent: (inst.remindersSent ?? 0) + 1, lastReminderAt: new Date(), updatedAt: new Date() })
            .where(eq(paymentInstallments.id, inst.id));
          console.log(`[InstallmentJob] Recordatorio enviado a ${inst.clientEmail} — cuota #${inst.installmentNumber} de ${inst.quoteNumber}`);
        } catch (emailErr: any) {
          console.error(`[InstallmentJob] Error enviando recordatorio cuota ${inst.id}:`, emailErr.message);
        }
      }
    } catch (err: any) {
      console.error("[InstallmentJob] Error en job:", err.message);
    }
    setTimeout(run, CHECK_INTERVAL_MS);
  }

  setTimeout(run, 5 * 60 * 1000); // Primera ejecución 5 min tras arranque
  console.log("[InstallmentJob] Job iniciado — cuotas vencidas + recordatorios cada hora");
}

// fixBrokenInvoicePdfUrls() se movió a server/_core/legacyMaintenance.ts (solo vía `pnpm db:migrate`).

async function conditionallyStartJob(
  flagKey: string,
  start: () => void,
  label: string,
  defaultEnabled = false,
): Promise<void> {
  const enabled = await getFeatureFlag(flagKey, defaultEnabled);
  if (enabled) {
    start();
  } else {
    console.log(`[Jobs] '${label}' desactivado — feature flag '${flagKey}' está inactivo`);
  }
}

/**
 * Arranque de SEGOLIFE — STARTUP != MIGRATION / STARTUP != SEED (ver CLAUDE.md).
 *
 * `pnpm dev` / `pnpm start` (node dist/index.js) NUNCA deben crear ni alterar
 * tablas, ni sembrar datos. Se limitan a: verificar conectividad de BD, arrancar
 * Express/tRPC, y activar SOLO los jobs que un administrador haya habilitado
 * explícitamente vía feature flag (todos con default=false — un job nunca se
 * autoactiva en una base de datos sin flags sembrados).
 *
 * Migraciones de schema  -> `pnpm db:migrate` (scripts/db-migrate.ts)
 * Seeds de datos Segolife -> `pnpm db:seed`    (scripts/db-seed.ts)
 */
async function verifyDatabaseConnectivity(): Promise<void> {
  try {
    const mysql = await import("mysql2/promise");
    const conn = await mysql.default.createConnection(process.env.DATABASE_URL!);
    await conn.query("SELECT 1");
    await conn.end();
    console.log("[DB] Conectividad verificada");
  } catch (err: any) {
    console.error("[DB] No se pudo verificar la conectividad (arranque continúa):", err?.message ?? err);
  }
}

verifyDatabaseConnectivity()
  .then(() => wipeTestDataIfRequested())
  .then(() => startServer())
  // quoteReminderJob y commercialFollowupJob borrados en Fase 5.
  // Toda la lógica de recordatorios la gestiona ahora emailAutomationJob
  // (auto-scheduling + procesamiento de email_scheduled_jobs).
  .then(() => conditionallyStartJob("abandoned_checkout_cleanup_enabled",  startAbandonedCheckoutCleanup, "Abandoned Checkout"))
  .then(() => conditionallyStartJob("installment_overdue_job_enabled",     startInstallmentOverdueJob,    "Installment Overdue"))
  .then(() => conditionallyStartJob("cancellation_stale_job_enabled",      startCancellationStaleJob,     "Cancellation Stale"))
  .then(() => conditionallyStartJob("email_ingestion_enabled",             startEmailIngestionJob,              "Email Ingestion"))
  .then(() => conditionallyStartJob("expense_email_ingestion_enabled",     startExpenseEmailIngestionJob,       "Expense Email Ingestion"))
  .then(() => conditionallyStartJob("commercial_email_enabled",            startCommercialEmailSyncJob,          "Commercial Email Sync"))
  .then(() => conditionallyStartJob("card_terminal_matching_enabled", startMatchingJob, "Card Terminal Matching", false))
  .then(() => conditionallyStartJob("card_terminal_relink_enabled",   startRelinkJob,   "Card Terminal Relink",   false))
  .then(() => conditionallyStartJob("email_automation_job_enabled",   startEmailAutomationJob, "Email Automation"))
  .then(() => conditionallyStartJob("tax_reminder_job_enabled",       startTaxReminderJob,     "Tax Reminder", false))
  // Fourvenues Production Scheduler (2026-08-13) — Casanova piloto. Comparte
  // el kill switch global EXTERNAL_INTEGRATIONS_ENABLED (comprobado también
  // dentro del propio tick) + canSync()/loyalty_enabled por fila — este flag
  // solo controla si el proceso cron llega a registrarse. Default false: en
  // una BD nueva, o mientras no se decida activar el piloto, nunca arranca.
  .then(() => conditionallyStartJob("fourvenues_scheduler_enabled",   startFourvenuesScheduler, "Fourvenues Scheduler", false))
  // FIX-01 — red de seguridad para clawback de SegoTokens pendiente tras un
  // refund confirmado (fallo transitorio en el intento eager). El intento
  // eager en el momento del refund sigue siendo el camino principal; este
  // job solo reintenta lo que quedó marcado `loyaltyReconciliationRequired`
  // — default false, igual que el resto de jobs.
  .then(() => conditionallyStartJob("token_clawback_reconciliation_enabled", startTokenClawbackReconciliationJob, "Token Clawback Reconciliation", false))
  // Fase 7 — Engagement Core. El listener de BenefitGranted es puramente
  // in-process (nunca sale del sistema, nunca llama a un provider externo
  // directamente) — se registra siempre. El scheduler de deliveries SÍ
  // requiere el kill switch explícito (spec punto 61-63, nunca default true).
  .then(() => { registerBenefitGrantedListener(); })
  // Communication Center — TicketPurchased estaba emitido desde Fase 8
  // (checkoutService.ts) pero sin ningún listener conectado (evento "al
  // vacío", confirmado por auditoría). Mismo criterio: in-process, siempre
  // registrado, nunca depende del kill switch del scheduler.
  .then(() => { registerTicketPurchasedListener(); })
  // SEGOLIFE — Native Ticket Sales (spec §31): mismos "fires into the void"
  // que ticketPurchasedListener.ts ya corrigió, ahora para refund/check-in.
  .then(() => { registerOrderRefundedListener(); })
  .then(() => { registerTicketCheckedInListener(); })
  .then(() => { registerTokensEarnedListener(); })
  .then(() => { registerEventLifecycleListeners(); })
  .then(() => { registerStudentRegisteredListener(); })
  .then(() => {
    if (isEngagementDeliveryEnabled()) {
      startEngagementScheduler();
    } else {
      console.log("[Jobs] 'Engagement Scheduler' desactivado — ENGAGEMENT_DELIVERY_ENABLED no está en 'true'");
    }
  })
  .catch(console.error);

