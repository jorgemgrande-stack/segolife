import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { ChevronRight, AlertTriangle } from "lucide-react";
import { PublicHomeNav } from "@/components/publicHome/PublicHomeNav";
import { PublicHomeFooter } from "@/components/publicHome/PublicHomeFooter";
import { LegalSection, InfoTable, AlertBox, LegalToc, PendingNote, type LegalSectionData } from "@/components/legal/LegalPageBlocks";
import { LEGAL_ENTITY, LEGAL_LAST_UPDATED, LEGAL_LAST_UPDATED_EN } from "@/lib/legalIdentity";

/**
 * Política de Devolución y Reembolso — SEGOLIFE / HAYQUE CAPITAL, S.L.
 * (FASE LEGAL, 2026-08-23). REESCRITURA COMPLETA: el contenido anterior
 * ("Condiciones de Cancelación") era boilerplate de Náyade sobre
 * actividades acuáticas, Hotel Náyade, SPA y restaurantes — ninguno de esos
 * servicios existe en SEGOLIFE. Reescrito a partir de la auditoría real de
 * pagos/ticketing (spec punto 13): hoy SEGOLIFE no cobra dinero real de
 * forma nativa (paymentProviderRegistry siempre resuelve a
 * unconfiguredPaymentProvider en producción), y los eventos con ticketing
 * externo (Weezevent/Fourvenues) redirigen al checkout del propio operador
 * — SEGOLIFE nunca procesa ese cobro.
 */
export default function CondicionesCancelacion() {
  const { i18n } = useTranslation();
  const isEn = i18n.language === "en";
  const sections = getSections(isEn);

  return (
    <div className="segolife-theme flex min-h-screen flex-col bg-background">
      <PublicHomeNav variant="solid" />
      <section className="bg-[oklch(0.14_0.03_240)] py-16">
        <div className="container">
          <div className="flex items-center gap-2 text-white/50 text-sm mb-4">
            <Link href="/" className="hover:text-amber-400 transition-colors">{isEn ? "Home" : "Inicio"}</Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-white/80">{isEn ? "Refunds and Returns" : "Devolución y Reembolso"}</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-accent" />
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-display font-bold text-white">{isEn ? "Refunds and Returns Policy" : "Política de Devolución y Reembolso"}</h1>
              <p className="text-white/55 text-sm mt-1">{isEn ? `Last updated: ${LEGAL_LAST_UPDATED_EN}` : `Última actualización: ${LEGAL_LAST_UPDATED}`}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[oklch(0.11_0.02_240)] py-16">
        <div className="container max-w-4xl">
          <div className="prose prose-invert prose-lg max-w-none space-y-10">
            <LegalToc sections={sections} label={isEn ? "Contents" : "Índice"} />
            {sections.map((s) => (
              <LegalSection key={s.number} number={s.number} title={s.title}>
                {s.content}
              </LegalSection>
            ))}
          </div>
        </div>
      </section>
      <PublicHomeFooter />
    </div>
  );
}

function getSections(isEn: boolean): LegalSectionData[] {
  if (isEn) {
    return [
      {
        number: "1", title: "Scope",
        content: (
          <p>
            This policy explains how cancellations and refunds work for tickets and services accessed through SEGOLIFE ({LEGAL_ENTITY.website}), operated by {LEGAL_ENTITY.name}. Which rules apply to a specific purchase depends on <strong>who actually processed the payment</strong> — read section 2 first.
          </p>
        ),
      },
      {
        number: "2", title: "Two ways tickets are sold on SEGOLIFE",
        content: (
          <>
            <AlertBox>
              This is the most important thing to understand: SEGOLIFE does not process payment for every event shown on the platform.
            </AlertBox>
            <p><strong>A) Tickets sold natively by SEGOLIFE.</strong> {LEGAL_ENTITY.name} does not currently operate an active payment gateway for native ticket sales — any native "purchase" today is either free or fully paid with SegoTokens, so there is no real money for {LEGAL_ENTITY.name} to refund yet. If native paid ticketing is activated in the future, this section will be updated with the applicable refund process and the version date above will change.</p>
            <p><strong>B) Tickets sold by an external ticketing operator</strong> (currently Weezevent and/or Fourvenues, depending on the event). For these, clicking "Buy tickets" takes you to the operator's own checkout — the purchase and the payment happen on their platform, not on segolife.es, and {LEGAL_ENTITY.name} never collects that money. Cancellations, changes, and refunds for these tickets are governed by that operator's own policy; please contact the operator directly (or the event's venue/organiser) rather than SEGOLIFE support.</p>
          </>
        ),
      },
      {
        number: "3", title: "Right of withdrawal",
        content: (
          <p>
            <PendingNote>Flagged for professional legal review — see LEGAL_REVIEW_REQUIRED.md.</PendingNote> Article 103.l of Royal Legislative Decree 1/2007 (TRLGDCU) excludes the standard 14-day right of withdrawal for services related to leisure activities, if the contract provides for a specific date or period of performance — which is typically the case for event tickets with a fixed date. Whether and how this exception applies to a specific purchase should be confirmed with legal counsel before native paid ticketing is activated commercially.
          </p>
        ),
      },
      {
        number: "4", title: "Event cancellation or substantial change",
        content: (
          <p>
            If an event is cancelled or substantially changed (date, venue) by its organiser, SEGOLIFE will inform affected students through the usual channels (in-app/email) when it becomes aware of it. Who is responsible for issuing a refund follows the same split as section 2: {LEGAL_ENTITY.name} for native purchases (when active), or the external ticketing operator for tickets sold through them.
          </p>
        ),
      },
      {
        number: "5", title: "SegoTokens",
        content: (
          <p>
            SegoTokens spent in the Benefits catalogue are not refundable as money — they are an internal, non-monetary currency. Where a purchase or redemption is cancelled through SEGOLIFE's own cancellation flow, the SegoTokens spent are credited back to your wallet as part of that cancellation.
          </p>
        ),
      },
      {
        number: "6", title: "Refund timeframes",
        content: <p><PendingNote>No commercial refund timeframe has been defined yet for native ticket sales — this section will be completed once that decision is made.</PendingNote></p>,
      },
      {
        number: "7", title: "Contact",
        content: (
          <p>
            For questions about a native purchase (once active) or to understand which operator is responsible for a specific ticket, contact <a href={`mailto:${LEGAL_ENTITY.contactEmail}`} className="text-accent hover:underline">{LEGAL_ENTITY.contactEmail}</a>. For more information, see the <Link href="/terminos"><span className="text-accent hover:underline cursor-pointer">Terms and Conditions</span></Link> and the <Link href="/privacidad"><span className="text-accent hover:underline cursor-pointer">Privacy Policy</span></Link>.
          </p>
        ),
      },
    ];
  }

  return [
    {
      number: "1", title: "Alcance",
      content: (
        <p>
          Esta política explica cómo funcionan las cancelaciones y devoluciones de entradas y servicios a los que se accede a través de SEGOLIFE ({LEGAL_ENTITY.website}), operado por {LEGAL_ENTITY.name}. Qué reglas se aplican a una compra concreta depende de <strong>quién ha procesado realmente el pago</strong> — lea primero el punto 2.
        </p>
      ),
    },
    {
      number: "2", title: "Dos formas de venta de entradas en SEGOLIFE",
      content: (
        <>
          <AlertBox>
            Esto es lo más importante que hay que entender: SEGOLIFE no procesa el pago de todos los eventos que aparecen en la plataforma.
          </AlertBox>
          <p><strong>A) Entradas vendidas de forma nativa por SEGOLIFE.</strong> {LEGAL_ENTITY.name} no dispone hoy de una pasarela de pago activa para la venta nativa de entradas — cualquier "compra" nativa actual es gratuita o se paga íntegramente con SegoTokens, por lo que hoy no hay dinero real que {LEGAL_ENTITY.name} tenga que reembolsar. Si en el futuro se activa la venta nativa de pago, este apartado se actualizará con el proceso de reembolso aplicable y cambiará la fecha de versión indicada arriba.</p>
          <p><strong>B) Entradas vendidas por un operador externo de ticketing</strong> (actualmente Weezevent y/o Fourvenues, según el evento). Para estas, pulsar "Comprar entradas" lleva al checkout propio del operador — la compra y el pago ocurren en su plataforma, no en segolife.es, y {LEGAL_ENTITY.name} nunca cobra ese dinero. Las cancelaciones, cambios y devoluciones de estas entradas se rigen por la política propia de ese operador; contacte directamente con él (o con el local/organizador del evento) en lugar de con el soporte de SEGOLIFE.</p>
        </>
      ),
    },
    {
      number: "3", title: "Derecho de desistimiento",
      content: (
        <p>
          <PendingNote>Marcado para revisión jurídica profesional — ver LEGAL_REVIEW_REQUIRED.md.</PendingNote> El artículo 103.l del Real Decreto Legislativo 1/2007 (TRLGDCU) excluye el derecho de desistimiento de 14 días para los servicios relacionados con actividades de esparcimiento, si el contrato prevé una fecha o periodo de ejecución específico — lo que suele ser el caso de las entradas a eventos con fecha fija. Si y cómo aplica esta excepción a una compra concreta debe confirmarse con asesoría jurídica antes de activar comercialmente la venta nativa de pago.
        </p>
      ),
    },
    {
      number: "4", title: "Cancelación o cambio sustancial del evento",
      content: (
        <p>
          Si un evento es cancelado o modificado sustancialmente (fecha, local) por su organizador, SEGOLIFE informará a los estudiantes afectados por los canales habituales (in-app/email) en cuanto tenga constancia. Quién responde del reembolso sigue la misma división del punto 2: {LEGAL_ENTITY.name} para compras nativas (cuando estén activas), o el operador externo de ticketing para las entradas vendidas a través de él.
        </p>
      ),
    },
    {
      number: "5", title: "SegoTokens",
      content: (
        <p>
          Los SegoTokens gastados en el catálogo de Beneficios no son reembolsables en dinero — son una moneda interna, sin valor monetario. Cuando una compra o canje se cancela a través del propio flujo de cancelación de SEGOLIFE, los SegoTokens gastados se abonan de nuevo a su cartera como parte de esa cancelación.
        </p>
      ),
    },
    {
      number: "6", title: "Plazos de devolución",
      content: <p><PendingNote>Todavía no se ha definido un plazo comercial de devolución para la venta nativa de entradas — este apartado se completará cuando exista esa decisión.</PendingNote></p>,
    },
    {
      number: "7", title: "Contacto",
      content: (
        <p>
          Para consultas sobre una compra nativa (cuando esté activa) o para saber qué operador responde de una entrada concreta, escriba a <a href={`mailto:${LEGAL_ENTITY.contactEmail}`} className="text-accent hover:underline">{LEGAL_ENTITY.contactEmail}</a>. Para más información, consulte los <Link href="/terminos"><span className="text-accent hover:underline cursor-pointer">Términos y Condiciones</span></Link> y la <Link href="/privacidad"><span className="text-accent hover:underline cursor-pointer">Política de Privacidad</span></Link>.
        </p>
      ),
    },
  ];
}
