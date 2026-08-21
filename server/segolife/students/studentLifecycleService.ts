/**
 * studentLifecycleService.ts — STU-01, borrado guardado de un Student.
 *
 * Mismo patrón EXACTO que server/db/eventsDb.ts::deleteEvent/
 * EventDeleteBlockedError (FIX-06) — comprobaciones baratas (`SELECT 1 ...
 * LIMIT 1` por fuente, nunca un COUNT ni traer filas completas), reasons
 * como strings legibles, nunca un objeto {type,count} nuevo: se sigue la
 * convención ya establecida en este repo en vez de inventar una distinta
 * para el mismo concepto.
 *
 * INTEGRIDAD > COMODIDAD UI (spec §14): un Student con CUALQUIER huella
 * económica/histórica real bloquea el borrado físico. Deliberadamente NO
 * bloquean (son metadatos administrativos, no "histórico que deba
 * conservarse" — spec §21, "cuenta esencialmente vacía"): login events,
 * notas internas, etiquetas, acciones de admin previas (incluido un
 * cambio de status), preferencias/entregas de notificaciones. Si
 * bloquearan, NINGÚN Student sería borrable nunca (todo el que inició
 * sesión al menos una vez ya tiene un login event).
 */
import { eq, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  users, studentProfiles, userCommunities,
  studentNotes, studentTagAssignments, studentLoginEvents, studentPhotoEvents,
  notifications, notificationDeliveries, notificationPreferences,
  tokenLedger, eventTickets, ticketOrders, eventAttendance, commerceTransactions,
  consumptionQrCodes, qrRedemptionAttempts, userBenefits, conversations, communityStudentProposals,
  communityResponses, communitySupports, referrals,
  venueVisits, commerceRefunds, fiscalTransactionSnapshots, fiscalDocuments,
  unresolvedOperations, tokenSpendReservations,
  tokenWallets, studentIdentityTokens, passwordResetTokens, rbacUserRoles,
  pushSubscriptions, loyaltyShadowEvaluations, externalIdentityMappings,
  engagementCampaignAudiences, communityProposalAudiences, billingProfiles,
} from "../../../drizzle/schema";
import { recordStudentAdminAction } from "./studentAdminActionsDb";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;
type TxHandle = Parameters<Parameters<DbHandle["transaction"]>[0]>[0];
type AnyDbHandle = DbHandle | TxHandle;

async function getDb(): Promise<DbHandle> {
  return _db;
}

export class StudentDeleteBlockedError extends Error {
  constructor(public reasons: string[]) {
    super(`No se puede eliminar este estudiante: ${reasons.join(", ")}. Puedes ocultarlo en su lugar.`);
    this.name = "StudentDeleteBlockedError";
  }
}

/**
 * Defensa en profundidad (spec §23-27): nunca confiar en que la UI
 * simplemente no muestre el botón. Cubre auto-borrado accidental de un
 * Admin y el caso de que esta vía se invoque alguna vez contra una cuenta
 * que no sea realmente un Student (`users.role !== "user"`).
 */
export class StudentDeleteForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudentDeleteForbiddenError";
  }
}

/**
 * Comprobaciones EXISTS-only (nunca COUNT, nunca filas completas — spec
 * §44, "no calcules eligibility completo con múltiples queries caras").
 * Reutilizada tanto por la query de elegibilidad (mostrar blockers en la
 * UI antes de intentar borrar) como por deleteStudent (revalidación
 * inmediata dentro de la propia operación — spec §36, nunca "check →
 * esperar → DELETE ciego").
 */
async function findDeleteBlockers(userId: number, conn: AnyDbHandle): Promise<string[]> {
  const reasons: string[] = [];

  const [ledgerRow] = await conn.select({ id: tokenLedger.id }).from(tokenLedger).where(eq(tokenLedger.userId, userId)).limit(1);
  if (ledgerRow) reasons.push("tiene movimientos de SegoTokens");

  const [ticketRow] = await conn.select({ id: eventTickets.id }).from(eventTickets).where(eq(eventTickets.userId, userId)).limit(1);
  if (ticketRow) reasons.push("tiene entradas emitidas");

  const [orderRow] = await conn.select({ id: ticketOrders.id }).from(ticketOrders).where(eq(ticketOrders.userId, userId)).limit(1);
  if (orderRow) reasons.push("tiene pedidos reales");

  const [attendanceRow] = await conn.select({ id: eventAttendance.id }).from(eventAttendance).where(eq(eventAttendance.userId, userId)).limit(1);
  if (attendanceRow) reasons.push("tiene asistencia registrada");

  const [commerceRow] = await conn.select({ id: commerceTransactions.id }).from(commerceTransactions).where(eq(commerceTransactions.userId, userId)).limit(1);
  if (commerceRow) reasons.push("tiene consumo registrado (TPV)");

  const [benefitRow] = await conn.select({ id: userBenefits.id }).from(userBenefits).where(eq(userBenefits.userId, userId)).limit(1);
  if (benefitRow) reasons.push("tiene Benefits concedidos");

  const [conversationRow] = await conn.select({ id: conversations.id }).from(conversations).where(eq(conversations.studentUserId, userId)).limit(1);
  if (conversationRow) reasons.push("tiene conversaciones (Mensajes)");

  const [proposalRow] = await conn.select({ id: communityStudentProposals.id }).from(communityStudentProposals).where(eq(communityStudentProposals.studentUserId, userId)).limit(1);
  if (proposalRow) reasons.push("tiene ideas propuestas en Comunity");

  const [responseRow] = await conn.select({ id: communityResponses.id }).from(communityResponses).where(eq(communityResponses.userId, userId)).limit(1);
  if (responseRow) reasons.push("tiene respuestas en Comunity");

  const [supportRow] = await conn.select({ id: communitySupports.id }).from(communitySupports).where(eq(communitySupports.userId, userId)).limit(1);
  if (supportRow) reasons.push("tiene apoyos a ideas de Comunity");

  const [referralRow] = await conn.select({ id: referrals.id }).from(referrals)
    .where(or(eq(referrals.referrerUserId, userId), eq(referrals.referredUserId, userId))).limit(1);
  if (referralRow) reasons.push("tiene referidos/invitaciones vinculadas");

  // consumption_qr_codes.redeemed_by_user_id no tiene comentario que aclare
  // si guarda al Student o al staff que procesó el canje — se bloquea por
  // las dos vías (esta + qr_redemption_attempts, que SÍ documenta
  // explícitamente que es la identidad del Student) en vez de asumir.
  const [qrCodeRow] = await conn.select({ id: consumptionQrCodes.id }).from(consumptionQrCodes).where(eq(consumptionQrCodes.redeemedByUserId, userId)).limit(1);
  if (qrCodeRow) reasons.push("tiene canjes de QR de consumición");

  const [qrAttemptRow] = await conn.select({ id: qrRedemptionAttempts.id }).from(qrRedemptionAttempts).where(eq(qrRedemptionAttempts.userId, userId)).limit(1);
  if (qrAttemptRow) reasons.push("tiene intentos de canje de QR registrados");

  const [venueVisitRow] = await conn.select({ id: venueVisits.id }).from(venueVisits).where(eq(venueVisits.userId, userId)).limit(1);
  if (venueVisitRow) reasons.push("tiene visitas a venues registradas");

  const [refundRow] = await conn.select({ id: commerceRefunds.id }).from(commerceRefunds).where(eq(commerceRefunds.userId, userId)).limit(1);
  if (refundRow) reasons.push("tiene reembolsos asociados");

  // Retención legal fiscal — nunca borrable de todos modos; se bloquea la
  // eliminación del Student en vez de dejar el snapshot/factura huérfano.
  const [fiscalSnapshotRow] = await conn.select({ id: fiscalTransactionSnapshots.id }).from(fiscalTransactionSnapshots).where(eq(fiscalTransactionSnapshots.buyerUserId, userId)).limit(1);
  if (fiscalSnapshotRow) reasons.push("tiene operaciones fiscales registradas");

  const [fiscalDocRow] = await conn.select({ id: fiscalDocuments.id }).from(fiscalDocuments).where(eq(fiscalDocuments.buyerUserId, userId)).limit(1);
  if (fiscalDocRow) reasons.push("tiene facturas o justificantes fiscales emitidos");

  const [unresolvedOpRow] = await conn.select({ id: unresolvedOperations.id }).from(unresolvedOperations).where(eq(unresolvedOperations.linkedUserId, userId)).limit(1);
  if (unresolvedOpRow) reasons.push("tiene operaciones sin resolver vinculadas");

  const [spendReservationRow] = await conn.select({ id: tokenSpendReservations.id }).from(tokenSpendReservations).where(eq(tokenSpendReservations.userId, userId)).limit(1);
  if (spendReservationRow) reasons.push("tiene reservas de gasto de SegoTokens");

  return reasons;
}

export interface StudentDeletionEligibility {
  canDelete: boolean;
  reasons: string[];
}

export async function evaluateStudentDeletionEligibility(userId: number, db?: DbHandle): Promise<StudentDeletionEligibility> {
  const conn = db ?? (await getDb());
  const reasons = await findDeleteBlockers(userId, conn);
  return { canDelete: reasons.length === 0, reasons };
}

/**
 * Borra físicamente un Student — SOLO si, revalidado DENTRO de la propia
 * transacción (spec §36), no tiene ningún rastro de actividad real.
 * Idempotente (spec §37): si el perfil ya no existe, retorna en silencio,
 * nunca un error.
 *
 * El registro de auditoría del propio borrado se escribe ANTES de borrar
 * la fila de studentProfiles/users (spec §31 — "no debes perder el hecho
 * administrativo de que existió una eliminación"), con un snapshot de
 * email/nombre en metadata — student_admin_actions.studentProfileId
 * queda como referencia histórica DELIBERADAMENTE sin fila detrás
 * después de esto (no hay FK real que lo impida), y es la única tabla que
 * este borrado NUNCA toca — todo lo demás (perfil, membresías, notas,
 * etiquetas, logins, fotos, notificaciones/preferencias propias, y
 * finalmente el propio user) se elimina en cascada.
 */
export async function deleteStudent(studentProfileId: number, actorUserId: number, reason: string, db?: DbHandle): Promise<{ deleted: boolean }> {
  const conn = db ?? (await getDb());

  return conn.transaction(async (tx) => {
    const [profile] = await tx.select().from(studentProfiles).where(eq(studentProfiles.id, studentProfileId)).limit(1);
    if (!profile) return { deleted: false }; // ya no existe — idempotente, nunca un error

    const userId = profile.userId;

    if (userId === actorUserId) {
      throw new StudentDeleteForbiddenError("No puedes eliminar tu propia cuenta desde este panel.");
    }

    const [userRow] = await tx.select({ email: users.email, name: users.name, role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
    if (!userRow) return { deleted: false }; // fila users ya no existe — idempotente

    // Esta vía está pensada SOLO para Students (role="user") — nunca debe
    // convertirse en un borrado genérico de cuentas admin/staff aunque, por
    // algún motivo, existiera una fila student_profiles asociada a una.
    if (userRow.role !== "user") {
      throw new StudentDeleteForbiddenError("Esta acción solo está disponible para cuentas de estudiante.");
    }

    const reasons = await findDeleteBlockers(userId, tx);
    if (reasons.length > 0) throw new StudentDeleteBlockedError(reasons);

    await recordStudentAdminAction({
      studentProfileId,
      actorUserId,
      action: "deleted",
      beforeValue: "active_account",
      afterValue: "deleted",
      reason,
      metadata: { emailSnapshot: userRow?.email ?? null, nameSnapshot: userRow?.name ?? null },
    }, tx);

    // Metadatos propios del Student — nunca "histórico que deba
    // conservarse" (spec §21), se limpian junto con la cuenta.
    const notificationRows = await tx.select({ id: notifications.id }).from(notifications).where(eq(notifications.userId, userId));
    const notificationIds = notificationRows.map(n => n.id);
    for (const notificationId of notificationIds) {
      await tx.delete(notificationDeliveries).where(eq(notificationDeliveries.notificationId, notificationId));
    }
    await tx.delete(notifications).where(eq(notifications.userId, userId));
    await tx.delete(notificationPreferences).where(eq(notificationPreferences.userId, userId));
    await tx.delete(studentLoginEvents).where(eq(studentLoginEvents.userId, userId));
    await tx.delete(studentPhotoEvents).where(eq(studentPhotoEvents.userId, userId));
    await tx.delete(studentTagAssignments).where(eq(studentTagAssignments.studentProfileId, studentProfileId));
    await tx.delete(studentNotes).where(eq(studentNotes.studentProfileId, studentProfileId));
    await tx.delete(userCommunities).where(eq(userCommunities.userId, userId));
    // token_wallets: seguro de borrar SOLO porque findDeleteBlockers ya
    // garantizó cero filas en token_ledger — un wallet sin ledger es
    // infraestructura de bootstrap (balance=0 desde registerStudent), nunca
    // saldo real perdido.
    await tx.delete(tokenWallets).where(eq(tokenWallets.userId, userId));
    await tx.delete(studentIdentityTokens).where(eq(studentIdentityTokens.userId, userId));
    await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
    await tx.delete(rbacUserRoles).where(eq(rbacUserRoles.userId, userId));
    await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    await tx.delete(loyaltyShadowEvaluations).where(eq(loyaltyShadowEvaluations.userId, userId));
    await tx.delete(externalIdentityMappings).where(eq(externalIdentityMappings.userId, userId));
    await tx.delete(engagementCampaignAudiences).where(eq(engagementCampaignAudiences.userId, userId));
    await tx.delete(communityProposalAudiences).where(eq(communityProposalAudiences.userId, userId));
    // billing_profiles: solo datos fiscales de contacto guardados por el
    // propio Student (nombre legal/CIF/dirección) — la prueba de que existió
    // una operación real vive en fiscal_transaction_snapshots/fiscal_documents
    // (ambos YA bloquean el borrado si tienen filas), así que este perfil por
    // sí solo nunca es "histórico que deba conservarse".
    await tx.delete(billingProfiles).where(eq(billingProfiles.userId, userId));
    await tx.delete(studentProfiles).where(eq(studentProfiles.id, studentProfileId));
    await tx.delete(users).where(eq(users.id, userId));

    return { deleted: true };
  });
}
