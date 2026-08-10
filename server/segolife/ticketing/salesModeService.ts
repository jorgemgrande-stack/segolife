/**
 * salesModeService.ts — orquesta cambios de MODALIDAD de venta de un Event
 * (rediseño operativo de Admin Ticketing/Sales). La UI habla en términos de
 * negocio ("Venta en SEGOLIFE" / "Venta en otra plataforma" / "Solo
 * información" + checkbox "combinar") — este servicio traduce esa decisión
 * a operaciones atómicas sobre `sales_channels` sin que el admin necesite
 * conocer channelType/salesMode/isPrimary. `sales_channels` sigue siendo el
 * modelo real, sin simplificar — solo se abstrae en la capa de UI/servicio.
 *
 * Invariante garantizada aquí (spec punto 21): como mucho 1 canal
 * isPrimary=true por evento. `setPrimarySalesChannel` siempre desactiva el
 * flag primary del resto EN LA MISMA transacción — nunca puede quedar un
 * instante con 2 primary=true simultáneos.
 *
 * "Hybrid" sigue sin guardarse como campo — se sigue derivando de contar
 * canales `status='active'` (ticketingDb.isEventHybrid), tal como ya
 * documentaba el modelo original. Este servicio es lo que decide, a partir
 * de la intención del admin, CUÁNTOS canales quedan activos a la vez.
 */
import { eq, and, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { salesChannels } from "../../../drizzle/schema";
import { listSalesChannels, createSalesChannel, updateSalesChannel, setSalesChannelStatus } from "./ticketingDb";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_pool);

type DbHandle = typeof _db;
type TxHandle = Parameters<Parameters<DbHandle["transaction"]>[0]>[0];

async function getDb(): Promise<DbHandle> {
  return _db;
}

export class SalesModeError extends Error {}

/** Versión reutilizable DENTRO de una transacción ya abierta (evita anidar conn.transaction()). */
async function setPrimaryTx(tx: TxHandle, eventId: number, channelId: number): Promise<void> {
  await tx.update(salesChannels).set({ isPrimary: false }).where(and(eq(salesChannels.eventId, eventId), ne(salesChannels.id, channelId)));
  await tx.update(salesChannels).set({ isPrimary: true }).where(eq(salesChannels.id, channelId));
}

/** Hace principal un canal de venta — API pública (botón "Hacer principal", spec punto 12). */
export async function setPrimarySalesChannel(channelId: number, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.transaction(async (tx) => {
    const [channel] = await tx.select().from(salesChannels).where(eq(salesChannels.id, channelId)).limit(1);
    if (!channel) throw new SalesModeError("Canal de venta no encontrado");
    await setPrimaryTx(tx, channel.eventId, channelId);
  });
}

export interface ExternalChannelInput {
  channelType: "fourvenues" | "weezevent" | "manual" | "partner";
  externalUrl: string | null;
  buttonText: string | null;
  openInNewTab: boolean;
}

export type SalesMode = "native" | "external" | "none";

export interface ConfigureSalesModeInput {
  mode: SalesMode;
  hybridEnabled: boolean;
  external?: ExternalChannelInput;
}

/**
 * Traduce la selección de modalidad del admin (+ "combinar") a operaciones
 * concretas sobre sales_channels, todo en una única transacción:
 *  - "native": asegura un canal segolife_native activo y primary; si
 *    hybridEnabled=false, desactiva el externo (si existe).
 *  - "external": asegura un canal external_redirect activo y primary con
 *    los datos dados; si hybridEnabled=false, desactiva el nativo.
 *  - "none": desactiva TODOS los canales — nunca los borra (purchaseAction
 *    cae a "unavailable", igual que si no hubiera canales).
 *  - hybridEnabled=true reactiva el canal secundario sin tocar cuál de los
 *    dos es primary (salvo que el mode elegido cambie el primary).
 * Nunca crea/borra event_ticket_types ni toca orders/payments/tickets.
 */
export async function configureSalesMode(eventId: number, input: ConfigureSalesModeInput, db?: DbHandle): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.transaction(async (tx) => {
    const channels = await listSalesChannels(eventId, tx);
    const native = channels.find(c => c.salesMode === "native") ?? null;
    const external = channels.find(c => c.salesMode === "external_redirect") ?? null;

    if (input.mode === "none") {
      for (const c of channels) {
        if (c.status === "active") await setSalesChannelStatus(c.id, "inactive", tx);
      }
      return;
    }

    if (input.mode === "native") {
      let nativeId = native?.id;
      if (!nativeId) {
        const created = await createSalesChannel(
          { eventId, channelType: "segolife_native", salesMode: "native", externalUrl: null, status: "active", isPrimary: false, sortOrder: 0 },
          tx
        );
        nativeId = created.id;
      } else {
        await updateSalesChannel(nativeId, { status: "active" }, tx);
      }
      await setPrimaryTx(tx, eventId, nativeId);
      if (external) await setSalesChannelStatus(external.id, input.hybridEnabled ? "active" : "inactive", tx);
    }

    if (input.mode === "external") {
      if (!input.external) throw new SalesModeError("Faltan los datos del canal externo");
      const externalUrl = input.external.externalUrl?.trim() || null;
      const metadata = { buttonText: input.external.buttonText?.trim() || null, openInNewTab: input.external.openInNewTab };
      let externalId = external?.id;
      if (!externalId) {
        const created = await createSalesChannel(
          { eventId, channelType: input.external.channelType, salesMode: "external_redirect", externalUrl, status: "active", isPrimary: false, sortOrder: 1, metadata },
          tx
        );
        externalId = created.id;
      } else {
        await updateSalesChannel(externalId, { channelType: input.external.channelType, externalUrl, status: "active", metadata }, tx);
      }
      await setPrimaryTx(tx, eventId, externalId);
      if (native) await setSalesChannelStatus(native.id, input.hybridEnabled ? "active" : "inactive", tx);
    }
  });
}
