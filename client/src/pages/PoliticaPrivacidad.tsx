import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { ChevronRight, Shield } from "lucide-react";
import { PublicHomeNav } from "@/components/publicHome/PublicHomeNav";
import { PublicHomeFooter } from "@/components/publicHome/PublicHomeFooter";
import { LegalSection, InfoTable, LegalToc, PendingNote, type LegalSectionData } from "@/components/legal/LegalPageBlocks";
import { LEGAL_ENTITY, LEGAL_LAST_UPDATED, LEGAL_LAST_UPDATED_EN } from "@/lib/legalIdentity";

/**
 * Política de Privacidad — SEGOLIFE / HAYQUE CAPITAL, S.L. (FASE LEGAL,
 * 2026-08-23). REESCRITURA COMPLETA a partir de un inventario real de
 * tratamientos (registro/perfil, Community, Events/ticketing, SegoTokens/
 * Benefits, Communication Center, soporte, seguridad) — el contenido
 * anterior era un placeholder genérico ("los datos... se publicarán en
 * cuanto estén formalizados") sin ese inventario.
 */
export default function PoliticaPrivacidad() {
  const { i18n } = useTranslation();
  const isEn = i18n.language === "en";
  const sections = getSections(isEn);

  return (
    <div className="segolife-theme flex min-h-screen flex-col bg-background">
      <PublicHomeNav variant="solid" />
      <section className="bg-[oklch(0.14_0.03_240)] py-16">
        <div className="container">
          <div className="flex items-center gap-2 text-white/50 text-sm mb-4">
            <Link href="/" className="hover:text-primary transition-colors">{isEn ? "Home" : "Inicio"}</Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-white/80">{isEn ? "Privacy Policy" : "Política de Privacidad"}</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center">
              <Shield className="w-6 h-6 text-accent" />
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-display font-bold text-white">{isEn ? "Privacy Policy" : "Política de Privacidad"}</h1>
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
        number: "1", title: "Data controller",
        content: (
          <>
            <p>Under Regulation (EU) 2016/679 (GDPR) and Spanish Organic Law 3/2018 (LOPDGDD), the controller for the personal data described in this policy is:</p>
            <InfoTable rows={[
              ["Company name", LEGAL_ENTITY.name],
              ["Tax ID (CIF)", LEGAL_ENTITY.cif],
              ["Registered address", LEGAL_ENTITY.address],
              ["Contact email", LEGAL_ENTITY.contactEmail],
            ]} />
          </>
        ),
      },
      {
        number: "2", title: "Processing activities",
        content: (
          <>
            <p>This is a real inventory of what SEGOLIFE processes today, not a generic list — each row only exists if the corresponding feature is actually implemented and operative.</p>
            <InfoTable rows={[
              ["Account & registration", "First/last name, email, phone, password (hashed), community and university, academic year. Purpose: creating and operating your account. Basis: performance of the contract (using SEGOLIFE requires an account)."],
              ["Student profile", "Optionally: nationality, country of origin, degree programme, address, city, dates in Segovia, profile photo. Purpose: personalising your experience. Basis: consent (you choose what to fill in)."],
              ["Community & Events social layer", "Proposals, comments, likes, shares, bookmarks you post, and the same actions (likes/comments) on Event pages. Purpose: operating the community feature. Basis: performance of the contract."],
              ["Events & ticketing", "Bookings, tickets, attendance/check-in records; for events sourced from Weezevent/Fourvenues, the corresponding external identifiers. Purpose: managing your access to events. Basis: performance of the contract."],
              ["SegoTokens & Benefits", "Wallet balance, ledger of earn/spend movements, Benefits redeemed, referral activity. Purpose: operating the loyalty programme. Basis: performance of the contract."],
              ["Communications", "In-app notifications (always on), email and — where enabled — push notifications; your marketing-communication preference by category. Purpose: operating the account (transactional) and, only with consent, sending promotional content. Basis: performance of the contract for transactional messages, consent for promotional ones."],
              ["Support", "Content of your queries and correspondence with our support team. Purpose: answering you. Basis: performance of the contract / legitimate interest."],
              ["Security & logs", "Technical access/error logs. Purpose: keeping the platform secure and diagnosing incidents. Basis: legitimate interest."],
            ]} />
          </>
        ),
      },
      {
        number: "3", title: "Legal basis",
        content: (
          <ul>
            <li><strong>Performance of a contract</strong> — most of the platform's core features (account, Community, Events, SegoTokens) require processing your data to work at all.</li>
            <li><strong>Consent</strong> — for optional profile fields, promotional communications, and non-essential cookies (analytics/marketing), which you can withdraw at any time without affecting the lawfulness of prior processing.</li>
            <li><strong>Legitimate interest</strong> — for security logs and fraud prevention.</li>
          </ul>
        ),
      },
      {
        number: "4", title: "Recipients and processors",
        content: (
          <>
            <p>SEGOLIFE relies on the following providers to operate the platform. We distinguish controller / processor / independent third party based on their actual role:</p>
            <InfoTable rows={[
              ["Railway", "Hosting and database infrastructure — processor."],
              ["Brevo", "Transactional and marketing email delivery — processor."],
              ["Weezevent / Fourvenues", "External ticketing operators for events sourced from them — independent controllers for the data they collect directly on their own checkout; SEGOLIFE only syncs in event/ticket data."],
              ["Google (Analytics, Maps)", "Web analytics and map embeds — processor for Analytics; independent third party for the Maps embed. Both load only after your consent (see the Cookie Policy)."],
              ["Meta (Pixel)", "Advertising measurement — loads only after your marketing consent (see the Cookie Policy)."],
            ]} />
            <p>Data is never sold to third parties, and is never shared for marketing purposes without your consent.</p>
          </>
        ),
      },
      {
        number: "5", title: "International transfers",
        content: (
          <p>
            Google and Meta may transfer data outside the European Economic Area as part of Analytics/Pixel processing, under the safeguards recognised by the European Commission (standard contractual clauses or an adequacy framework). <PendingNote>The hosting region and data-processing agreements for Railway and Brevo have not been independently confirmed for this report — pending confirmation, see LEGAL_REVIEW_REQUIRED.md.</PendingNote>
          </p>
        ),
      },
      {
        number: "6", title: "Data retention",
        content: (
          <p>
            Your data is kept while your account remains active, and for the legally required period after closing it where applicable (e.g. billing/tax records, if native paid ticketing is activated in the future, for the minimum period required by tax law). You can request deletion of your account at any time; some data may be kept in anonymised or aggregated form for security or statistical purposes.
          </p>
        ),
      },
      {
        number: "7", title: "Commercial communications",
        content: (
          <p>
            Under Spanish Law 34/2002 (LSSI-CE), SEGOLIFE never sends promotional communications without your prior, explicit, and separate consent — registering an account never requires accepting marketing communications. You choose this independently via an optional checkbox at registration, and can change it at any time from your notification preferences (by category: Events, Rewards, Benefits, Promotions, Account).
          </p>
        ),
      },
      {
        number: "8", title: "Minors",
        content: (
          <p>
            SEGOLIFE is designed for university students. <PendingNote>A formal minimum age for using the platform has not yet been defined as a business decision — see the Terms and Conditions and LEGAL_REVIEW_REQUIRED.md.</PendingNote> SEGOLIFE does not knowingly process data from individuals without the legal capacity to consent to it.
          </p>
        ),
      },
      {
        number: "9", title: "Your rights",
        content: (
          <>
            <p>You may exercise, at any time, the rights recognised by the GDPR:</p>
            <ul>
              <li><strong>Access</strong> — know what personal data we process about you.</li>
              <li><strong>Rectification</strong> — correct inaccurate or incomplete data.</li>
              <li><strong>Erasure</strong> — request deletion of your data when no longer necessary.</li>
              <li><strong>Restriction</strong> — request that processing be limited in certain circumstances.</li>
              <li><strong>Objection</strong> — object to processing based on your particular situation.</li>
              <li><strong>Portability</strong> — receive your data in a structured, commonly used format.</li>
              <li><strong>Withdraw consent</strong> — where processing is based on consent, at any time, without affecting prior lawfulness.</li>
            </ul>
            <p>
              To exercise these rights, write to <a href={`mailto:${LEGAL_ENTITY.contactEmail}`} className="text-accent hover:underline">{LEGAL_ENTITY.contactEmail}</a> with proof of identity. You may also lodge a complaint with the Spanish Data Protection Agency (<a href="https://www.aepd.es" target="_blank" rel="noreferrer" className="text-accent hover:underline">www.aepd.es</a>) if you believe processing does not comply with applicable law.
            </p>
          </>
        ),
      },
      {
        number: "10", title: "Security",
        content: <p>{LEGAL_ENTITY.name} applies technical and organisational measures appropriate to the risk to protect your data, in line with the GDPR and LOPDGDD. No system is completely immune to unauthorised access, and absolute security cannot be guaranteed.</p>,
      },
      {
        number: "11", title: "Cookies",
        content: (
          <p>
            SEGOLIFE uses first-party and third-party cookies as described in the <Link href="/cookies"><span className="text-accent hover:underline cursor-pointer">Cookie Policy</span></Link>, where you can also manage your preferences at any time.
          </p>
        ),
      },
      {
        number: "12", title: "Changes to this policy",
        content: <p>{LEGAL_ENTITY.name} may update this policy to reflect legal or product changes. The last-updated date is always shown at the top of this document.</p>,
      },
    ];
  }

  return [
    {
      number: "1", title: "Responsable del tratamiento",
      content: (
        <>
          <p>De conformidad con el Reglamento (UE) 2016/679 (RGPD) y la Ley Orgánica 3/2018 (LOPDGDD), el responsable de los datos personales descritos en esta política es:</p>
          <InfoTable rows={[
            ["Denominación social", LEGAL_ENTITY.name],
            ["CIF", LEGAL_ENTITY.cif],
            ["Domicilio social", LEGAL_ENTITY.address],
            ["Email de contacto", LEGAL_ENTITY.contactEmail],
          ]} />
        </>
      ),
    },
    {
      number: "2", title: "Actividades de tratamiento",
      content: (
        <>
          <p>Este es un inventario real de lo que SEGOLIFE trata hoy, no un listado genérico — cada fila existe solo si la funcionalidad correspondiente está realmente implementada y operativa.</p>
          <InfoTable rows={[
            ["Cuenta y registro", "Nombre, apellidos, email, teléfono, contraseña (cifrada), comunidad y universidad, año académico. Finalidad: crear y gestionar la cuenta. Base: ejecución del contrato (usar SEGOLIFE requiere una cuenta)."],
            ["Perfil de estudiante", "Opcionalmente: nacionalidad, país de origen, titulación, dirección, ciudad, fechas de estancia en Segovia, foto de perfil. Finalidad: personalizar la experiencia. Base: consentimiento (el usuario decide qué rellenar)."],
            ["Community y capa social de Events", "Propuestas, comentarios, likes, shares y guardados que publica, y las mismas acciones (likes/comentarios) en las fichas de eventos. Finalidad: operar la función de comunidad. Base: ejecución del contrato."],
            ["Eventos y ticketing", "Reservas, entradas, registros de asistencia/check-in; para eventos sincronizados desde Weezevent/Fourvenues, los identificadores externos correspondientes. Finalidad: gestionar el acceso a eventos. Base: ejecución del contrato."],
            ["SegoTokens y Beneficios", "Saldo de la cartera, histórico de movimientos de obtención/gasto, Beneficios canjeados, actividad de referidos. Finalidad: operar el programa de fidelización. Base: ejecución del contrato."],
            ["Comunicaciones", "Notificaciones in-app (siempre activas), email y — donde esté activado — push; preferencia de comunicaciones promocionales por categoría. Finalidad: operar la cuenta (transaccional) y, solo con consentimiento, enviar contenido promocional. Base: ejecución del contrato para las transaccionales, consentimiento para las promocionales."],
            ["Soporte", "Contenido de las consultas y la correspondencia con el equipo de soporte. Finalidad: atenderle. Base: ejecución del contrato / interés legítimo."],
            ["Seguridad y logs", "Registros técnicos de acceso/error. Finalidad: mantener la plataforma segura y diagnosticar incidencias. Base: interés legítimo."],
          ]} />
        </>
      ),
    },
    {
      number: "3", title: "Base legitimadora",
      content: (
        <ul>
          <li><strong>Ejecución de un contrato</strong> — la mayoría de las funciones esenciales de la plataforma (cuenta, Community, Events, SegoTokens) requieren tratar sus datos para poder funcionar.</li>
          <li><strong>Consentimiento</strong> — para los campos opcionales del perfil, las comunicaciones promocionales y las cookies no esenciales (analíticas/marketing), que puede retirar en cualquier momento sin afectar a la licitud del tratamiento previo.</li>
          <li><strong>Interés legítimo</strong> — para los registros de seguridad y la prevención de fraude.</li>
        </ul>
      ),
    },
    {
      number: "4", title: "Destinatarios y encargados del tratamiento",
      content: (
        <>
          <p>SEGOLIFE se apoya en los siguientes proveedores para operar la plataforma. Se distingue responsable / encargado / tercero independiente según su papel real:</p>
          <InfoTable rows={[
            ["Railway", "Infraestructura de hosting y base de datos — encargado del tratamiento."],
            ["Brevo", "Envío de email transaccional y promocional — encargado del tratamiento."],
            ["Weezevent / Fourvenues", "Operadores externos de ticketing para los eventos que gestionan — responsables independientes de los datos que recogen directamente en su propio checkout; SEGOLIFE solo sincroniza datos de eventos/entradas."],
            ["Google (Analytics, Maps)", "Analítica web e integración de mapas — encargado para Analytics; tercero independiente para el mapa incrustado. Ambos cargan solo tras su consentimiento (ver Política de Cookies)."],
            ["Meta (Pixel)", "Medición publicitaria — carga solo tras su consentimiento de marketing (ver Política de Cookies)."],
          ]} />
          <p>Los datos nunca se venden a terceros, ni se ceden con fines de marketing sin su consentimiento.</p>
        </>
      ),
    },
    {
      number: "5", title: "Transferencias internacionales",
      content: (
        <p>
          Google y Meta pueden transferir datos fuera del Espacio Económico Europeo como parte del tratamiento de Analytics/Pixel, amparadas por las garantías reconocidas por la Comisión Europea (cláusulas contractuales tipo o un marco de adecuación). <PendingNote>La ubicación de los servidores y los acuerdos de encargo de tratamiento de Railway y Brevo no se han podido confirmar de forma independiente para este informe — pendiente de confirmación, ver LEGAL_REVIEW_REQUIRED.md.</PendingNote>
        </p>
      ),
    },
    {
      number: "6", title: "Conservación de los datos",
      content: (
        <p>
          Los datos se conservan mientras la cuenta permanezca activa, y durante el plazo legalmente exigido tras su baja cuando corresponda (p. ej. registros de facturación/fiscales, si en el futuro se activa la venta nativa de pago, durante el plazo mínimo exigido por la normativa tributaria). El usuario puede solicitar la eliminación de su cuenta en cualquier momento; algunos datos podrán conservarse de forma anonimizada o agregada con fines de seguridad o estadísticos.
        </p>
      ),
    },
    {
      number: "7", title: "Comunicaciones comerciales",
      content: (
        <p>
          De acuerdo con la Ley 34/2002 (LSSI-CE), SEGOLIFE nunca envía comunicaciones promocionales sin el consentimiento previo, expreso y separado del usuario — registrarse nunca exige aceptar comunicaciones de marketing. Esta decisión se toma de forma independiente mediante una casilla opcional en el registro, y puede cambiarse en cualquier momento desde las preferencias de notificaciones (por categoría: Eventos, Rewards, Beneficios, Promociones, Cuenta).
        </p>
      ),
    },
    {
      number: "8", title: "Menores de edad",
      content: (
        <p>
          SEGOLIFE está pensado para estudiantes universitarios. <PendingNote>Todavía no se ha definido formalmente una edad mínima de uso de la plataforma como decisión de negocio — ver Términos y Condiciones y LEGAL_REVIEW_REQUIRED.md.</PendingNote> SEGOLIFE no trata conscientemente datos de personas sin capacidad legal para consentir su tratamiento.
        </p>
      ),
    },
    {
      number: "9", title: "Derechos del usuario",
      content: (
        <>
          <p>El usuario puede ejercer en cualquier momento los derechos reconocidos por el RGPD:</p>
          <ul>
            <li><strong>Acceso</strong> — conocer qué datos personales se tratan sobre usted.</li>
            <li><strong>Rectificación</strong> — corregir datos inexactos o incompletos.</li>
            <li><strong>Supresión</strong> — solicitar la eliminación de los datos cuando ya no sean necesarios.</li>
            <li><strong>Limitación</strong> — solicitar la restricción del tratamiento en determinadas circunstancias.</li>
            <li><strong>Oposición</strong> — oponerse al tratamiento por motivos relacionados con su situación particular.</li>
            <li><strong>Portabilidad</strong> — recibir sus datos en un formato estructurado y de uso común.</li>
            <li><strong>Retirar el consentimiento</strong> — cuando el tratamiento se base en él, en cualquier momento, sin afectar a la licitud previa.</li>
          </ul>
          <p>
            Para ejercerlos, escriba a <a href={`mailto:${LEGAL_ENTITY.contactEmail}`} className="text-accent hover:underline">{LEGAL_ENTITY.contactEmail}</a> acompañando un documento que acredite su identidad. También puede presentar una reclamación ante la Agencia Española de Protección de Datos (<a href="https://www.aepd.es" target="_blank" rel="noreferrer" className="text-accent hover:underline">www.aepd.es</a>) si considera que el tratamiento no se ajusta a la normativa vigente.
          </p>
        </>
      ),
    },
    {
      number: "10", title: "Seguridad",
      content: <p>{LEGAL_ENTITY.name} aplica medidas técnicas y organizativas adecuadas al riesgo para proteger sus datos, conforme al RGPD y la LOPDGDD. Ningún sistema es completamente inmune a accesos no autorizados y no puede garantizarse una seguridad absoluta.</p>,
    },
    {
      number: "11", title: "Cookies",
      content: (
        <p>
          SEGOLIFE utiliza cookies propias y de terceros descritas en la <Link href="/cookies"><span className="text-accent hover:underline cursor-pointer">Política de Cookies</span></Link>, donde también puede gestionar sus preferencias en cualquier momento.
        </p>
      ),
    },
    {
      number: "12", title: "Modificaciones de esta política",
      content: <p>{LEGAL_ENTITY.name} podrá actualizar esta política para adaptarla a cambios legislativos o del producto. La fecha de última actualización figura siempre en el encabezado de este documento.</p>,
    },
  ];
}
