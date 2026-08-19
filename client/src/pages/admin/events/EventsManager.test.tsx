/**
 * EventsManager.test.tsx — FIX-04. Cubre exclusivamente eventStatusBadge(),
 * la función pura que decide qué badge "Estado" muestra el listado admin —
 * antes solo reflejaba events.status, así que un evento finalizado hace un
 * año seguía mostrando "Activo" (CASO A, event 119) y un borrador de
 * Fourvenues mostraba "Activo" igual que uno publicado (CASO B). Sin
 * render de componente: no hay convención previa de tests de componente en
 * este directorio (EventsManager/EventDetail nunca tuvieron .test.tsx), así
 * que se prueba la función pura directamente — mismo criterio que
 * selectUpcomingWindow en server/db/eventsDb.test.ts.
 */
import { describe, it, expect } from "vitest";
import { eventStatusBadge } from "./EventsManager";

const now = new Date();
const DAY_MS = 24 * 60 * 60 * 1000;

function baseEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    status: "active", sourceType: null, sourcePublicationStatus: null,
    startsAt: new Date(now.getTime() + 10 * DAY_MS), endsAt: null,
    ...overrides,
  };
}

describe("eventStatusBadge — CASO A (event 119, finalizado nunca 'Activo')", () => {
  it("evento nativo activo y futuro -> 'Activo'", () => {
    expect(eventStatusBadge(baseEvent()).label).toBe("Activo");
  });

  it("evento nativo activo pero YA FINALIZADO (caso real: event 119, Fourvenues active/visible=true en origen, hace 11 meses) -> 'Finalizado', NUNCA 'Activo'", () => {
    const event119 = baseEvent({
      sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "published",
      startsAt: new Date(now.getTime() - 330 * DAY_MS),
    });
    expect(eventStatusBadge(event119).label).toBe("Finalizado");
  });

  it("status='inactive' gana siempre, incluso sobre un evento futuro (acción explícita del admin)", () => {
    expect(eventStatusBadge(baseEvent({ status: "inactive" })).label).toBe("Inactivo");
  });
});

describe("eventStatusBadge — CASO B (pre-opening-x-fcking-wednesdays, borrador de Fourvenues nunca 'Activo')", () => {
  it("evento Fourvenues activo local + sourcePublicationStatus='unpublished' (caso real) -> 'Borrador Fourvenues', aunque sea futuro", () => {
    const preOpening = baseEvent({ sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "unpublished" });
    expect(eventStatusBadge(preOpening).label).toBe("Borrador Fourvenues");
  });

  it("evento Fourvenues + sourcePublicationStatus='unknown' -> también 'Borrador Fourvenues' (fail-closed, nunca 'Activo' sin confirmación)", () => {
    const event = baseEvent({ sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "unknown" });
    expect(eventStatusBadge(event).label).toBe("Borrador Fourvenues");
  });

  it("evento Fourvenues + sourcePublicationStatus=null (nunca sincronizado tras la migración) -> 'Borrador Fourvenues'", () => {
    const event = baseEvent({ sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: null });
    expect(eventStatusBadge(event).label).toBe("Borrador Fourvenues");
  });

  it("evento Fourvenues + sourcePublicationStatus='published' -> 'Activo' (comportamiento normal)", () => {
    const event = baseEvent({ sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "published" });
    expect(eventStatusBadge(event).label).toBe("Activo");
  });

  it("evento Weezevent (sourceType ajeno a Fourvenues) activo -> 'Activo', nunca sujeto al gate de borrador de Fourvenues", () => {
    const event = baseEvent({ sourceType: "weezevent", sourcePublicationStatus: null });
    expect(eventStatusBadge(event).label).toBe("Activo");
  });

  it("borrador Fourvenues que además ya finalizó -> 'Borrador Fourvenues' (más informativo que 'Finalizado': nunca llegó a publicarse)", () => {
    const event = baseEvent({
      sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "unpublished",
      startsAt: new Date(now.getTime() - 30 * DAY_MS),
    });
    expect(eventStatusBadge(event).label).toBe("Borrador Fourvenues");
  });
});
