/**
 * benefitEvents.ts — punto de extensión MUY LIGERO para comunicaciones
 * futuras (Fase 7: WhatsApp/push/email) sin acoplar el motor de Benefits a
 * ningún canal concreto. Mismo patrón ya usado en este codebase para el
 * emisor de eventos SSE del inbox de WhatsApp/GHL (ver
 * server/ghlInboxEvents.ts) — un `EventEmitter` de Node en singleton, sin
 * colas, sin Redis/Kafka, sin workers ni jobs de boot. Aquí se añade
 * tipado del payload (ghlInboxEvents.ts no lo necesitaba al tener un único
 * evento con forma fija).
 *
 * SEMÁNTICA DE FALLO — best-effort, nunca transaccional:
 *  - `emitBenefitGranted` se llama SIEMPRE fuera de cualquier transacción
 *    de escritura (ver benefitGrantService.ts y consumptionQrService.ts:
 *    "el emisor de este evento es responsabilidad del llamador, DESPUÉS de
 *    que su transacción haya confirmado con éxito" — nunca dentro de
 *    grantBenefit()/evaluateBenefitsForOrigin(), que pueden ejecutarse
 *    dentro de una transacción abierta por otro módulo cuyo resultado final
 *    todavía no se conoce).
 *  - Cada listener se invoca de forma aislada (microtask propio, con su
 *    propio try/catch) — si un listener lanza o rechaza, el error se
 *    registra en consola y se descarta; NUNCA se propaga a quien llamó a
 *    `emitBenefitGranted`, y NUNCA revierte ni afecta al Benefit ya
 *    concedido (que a estas alturas ya está confirmado en BD). Mismo
 *    criterio que `notifyOwner()` en server/adapters/notification.ts
 *    (nunca lanza, siempre resuelve).
 *  - Si en el futuro algún consumidor necesitara garantías reales de
 *    entrega (reintentos, cola persistente, outbox transaccional), eso es
 *    una decisión de diseño APARTE y explícita — este mecanismo
 *    deliberadamente no las ofrece hoy.
 */
import { EventEmitter } from "events";

export interface BenefitGrantedPayload {
  userId: number;
  userBenefitId: number;
  benefitDefinitionId: number;
  communityId: number | null;
  sourceType: string;
  sourceId: number | null;
  sourceVenueId: number | null;
  destinationVenueId: number | null;
  destinationEventId: number | null;
  grantedAt: Date;
  validFrom: Date;
  validUntil: Date | null;
}

interface BenefitDomainEvents {
  BenefitGranted: BenefitGrantedPayload;
}

type Listener<P> = (payload: P) => void | Promise<void>;

class BenefitEventEmitter extends EventEmitter {
  onTyped<K extends keyof BenefitDomainEvents>(event: K, listener: Listener<BenefitDomainEvents[K]>): void {
    // Envoltura por listener: aísla cada suscriptor en su propio
    // try/catch + microtask — un listener lento o que lanza no bloquea ni
    // rompe a los demás listeners ni al emisor.
    this.on(event, (payload: BenefitDomainEvents[K]) => {
      Promise.resolve()
        .then(() => listener(payload))
        .catch(err => {
          console.error(`[BenefitEvents] listener de "${event}" falló (ignorado — no afecta al Benefit ya concedido):`, err);
        });
    });
  }

  emitTyped<K extends keyof BenefitDomainEvents>(event: K, payload: BenefitDomainEvents[K]): void {
    this.emit(event, payload);
  }
}

export const benefitEvents = new BenefitEventEmitter();
benefitEvents.setMaxListeners(50);

/**
 * Único punto de emisión de `BenefitGranted` — los llamadores (ver
 * benefitGrantService.ts y consumptionQrService.ts) deben invocarlo
 * DESPUÉS de que la concesión esté confirmada de verdad (fuera de
 * cualquier `.transaction()` en curso), nunca antes.
 */
export function emitBenefitGranted(payload: BenefitGrantedPayload): void {
  benefitEvents.emitTyped("BenefitGranted", payload);
}

interface GrantedBenefitFields {
  id: number;
  userId: number;
  benefitDefinitionId: number;
  communityId: number | null;
  sourceType: string;
  sourceId: number | null;
  sourceVenueId: number | null;
  grantedAt: Date;
  validFrom: Date;
  validUntil: Date | null;
}

interface DestinationFields {
  destinationVenueId: number | null;
  destinationEventId: number | null;
}

/** Construye el payload mínimo a partir de la fila de user_benefits + los campos de destino de su definición — nunca incluye qrToken/qrTokenHash. */
export function buildBenefitGrantedPayload(benefit: GrantedBenefitFields, definition: DestinationFields): BenefitGrantedPayload {
  return {
    userId: benefit.userId,
    userBenefitId: benefit.id,
    benefitDefinitionId: benefit.benefitDefinitionId,
    communityId: benefit.communityId,
    sourceType: benefit.sourceType,
    sourceId: benefit.sourceId,
    sourceVenueId: benefit.sourceVenueId,
    destinationVenueId: definition.destinationVenueId,
    destinationEventId: definition.destinationEventId,
    grantedAt: benefit.grantedAt,
    validFrom: benefit.validFrom,
    validUntil: benefit.validUntil,
  };
}
