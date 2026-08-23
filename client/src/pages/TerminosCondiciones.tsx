import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { ChevronRight, FileText } from "lucide-react";
import { PublicHomeNav } from "@/components/publicHome/PublicHomeNav";
import { PublicHomeFooter } from "@/components/publicHome/PublicHomeFooter";
import { LegalSection, InfoTable, LegalToc, PendingNote, type LegalSectionData } from "@/components/legal/LegalPageBlocks";
import { LEGAL_ENTITY, LEGAL_LAST_UPDATED, LEGAL_LAST_UPDATED_EN } from "@/lib/legalIdentity";

/**
 * Términos y Condiciones de Uso — SEGOLIFE / HAYQUE CAPITAL, S.L. (FASE
 * LEGAL, 2026-08-23). REESCRITURA COMPLETA: el contenido anterior era
 * boilerplate heredado de Náyade Experiences (actividades acuáticas, Hotel
 * Náyade, SPA, restaurantes, e incluso una referencia literal a
 * "www.skicenter.es" — bug real de cruce de proyectos encontrado en la
 * auditoría de esta fase). Es el documento que enlaza el checkbox
 * obligatorio de Register.tsx — spec punto 17: ya existía como página real
 * y ya estaba enlazada correctamente desde el registro, así que no hizo
 * falta crear una "Condiciones de Uso" nueva, solo corregir su contenido.
 */
export default function TerminosCondiciones() {
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
            <span className="text-white/80">{isEn ? "Terms and Conditions" : "Términos y Condiciones"}</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center">
              <FileText className="w-6 h-6 text-accent" />
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-display font-bold text-white">{isEn ? "Terms and Conditions of Use" : "Términos y Condiciones de Uso"}</h1>
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
        number: "1", title: "Site owner",
        content: (
          <InfoTable rows={[
            ["Company name", LEGAL_ENTITY.name],
            ["Tax ID (CIF)", LEGAL_ENTITY.cif],
            ["Registered address", LEGAL_ENTITY.address],
            ["Website", LEGAL_ENTITY.website],
          ]} />
        ),
      },
      {
        number: "2", title: "Purpose and scope",
        content: (
          <>
            <p>These Terms and Conditions govern the use of SEGOLIFE, the university-life platform available at {LEGAL_ENTITY.website}, operated by {LEGAL_ENTITY.name}. SEGOLIFE gives access to: Community (student proposals, comments, and likes), an events agenda with access to tickets, a loyalty programme (SegoTokens) and a Benefits catalogue, and a referral programme.</p>
            <p>Creating an account implies acceptance of these Terms. If you do not agree with any part of them, please refrain from registering or using the account-only features of SEGOLIFE.</p>
          </>
        ),
      },
      {
        number: "3", title: "Registration and account",
        content: (
          <>
            <p>To create an account, you provide: first and last name, email, phone number, a password, your community (e.g. IE University, UVa Segovia), your university, and — optionally — your academic year. Registration requires accepting these Terms and confirming you have read the Privacy Policy via a mandatory, non-preselected checkbox; separately, you may opt in to receive promotional communications via an independent, optional checkbox.</p>
            <p>Each account is personal, tied to one real person, and non-transferable. You are responsible for the accuracy of the information you provide and for keeping your password confidential.</p>
          </>
        ),
      },
      {
        number: "4", title: "Minimum age",
        content: (
          <p><PendingNote>Pending business decision — not defined yet, and this document will not invent a rule that doesn't exist in the product today.</PendingNote> SEGOLIFE is designed for university students; the platform does not currently enforce a minimum-age check at registration.</p>
        ),
      },
      {
        number: "5", title: "Acceptable use",
        content: (
          <ul>
            <li>Use SEGOLIFE lawfully and in good faith.</li>
            <li>Never attempt to access another user's account or circumvent the platform's security.</li>
            <li>Never use automated tools to scrape, spam, or abuse the service.</li>
          </ul>
        ),
      },
      {
        number: "6", title: "Community: rules of conduct",
        content: (
          <p>
            Posting proposals, comments, or reactions in Community, or liking/commenting on an Event, must never include unlawful, defamatory, threatening, harassing, or hateful content, spam, impersonation, or content that infringes third-party rights. SEGOLIFE may hide or remove content that breaches these rules — see the <Link href="/aviso-legal"><span className="text-accent hover:underline cursor-pointer">Legal Notice</span></Link> for the full list.
          </p>
        ),
      },
      {
        number: "7", title: "Events and ticket purchases",
        content: (
          <>
            <p>SEGOLIFE's events agenda includes events managed through external ticketing operators (currently Weezevent and/or Fourvenues, depending on the event). For those, clicking "Buy tickets" takes you to the operator's own checkout — the purchase, the payment, and the resulting contract are between you and that operator, not with {LEGAL_ENTITY.name}.</p>
            <p>SEGOLIFE does not currently operate an active payment gateway for native ticket sales — any native purchase today is either free or fully paid with SegoTokens. If native paid ticketing is activated in the future, it will be governed by these Terms and by the <Link href="/condiciones-cancelacion"><span className="text-accent hover:underline cursor-pointer">Refunds and Returns Policy</span></Link>, updated accordingly.</p>
          </>
        ),
      },
      {
        number: "8", title: "SegoTokens and Benefits",
        content: (
          <p>
            SegoTokens are SEGOLIFE's internal loyalty currency. They are earned through activity on the platform (ticket purchases, event attendance, referrals, and similar actions defined by the programme's active rules) and can be spent in the Benefits catalogue. SegoTokens cannot be purchased with money and cannot be redeemed for money — they have no value outside SEGOLIFE and are governed by the rules in force at the time they are earned or spent, which may change.
          </p>
        ),
      },
      {
        number: "9", title: "Referral programme",
        content: <p>Inviting other students may grant SegoTokens rewards to both the inviter and the invitee, under the terms of the referral campaign active at the time.</p>,
      },
      {
        number: "10", title: "Communications",
        content: (
          <p>
            SEGOLIFE always sends transactional communications needed to operate your account (confirmations, security, password reset) regardless of your preferences. Promotional communications are only sent if you opted in, and you can withdraw that consent at any time from your notification preferences.
          </p>
        ),
      },
      {
        number: "11", title: "Intellectual property",
        content: <p>All SEGOLIFE content that is not user-generated is the property of {LEGAL_ENTITY.name} or its licensors — see the <Link href="/aviso-legal"><span className="text-accent hover:underline cursor-pointer">Legal Notice</span></Link> for details.</p>,
      },
      {
        number: "12", title: "Account suspension and closure",
        content: (
          <p>
            {LEGAL_ENTITY.name} may suspend or close an account that seriously or repeatedly breaches these Terms, proportionately to the breach. You may request closure of your account at any time by contacting <a href={`mailto:${LEGAL_ENTITY.contactEmail}`} className="text-accent hover:underline">{LEGAL_ENTITY.contactEmail}</a>.
          </p>
        ),
      },
      {
        number: "13", title: "Changes to these Terms",
        content: <p>{LEGAL_ENTITY.name} may update these Terms to reflect legal or product changes. The version and last-updated date are always shown at the top of this document; material changes will be communicated to registered users.</p>,
      },
      {
        number: "14", title: "Applicable law and jurisdiction",
        content: (
          <>
            <p>These Terms are governed by Spanish law. Any dispute will be submitted to the Courts of Segovia, Spain, except where mandatory consumer-protection law grants a different forum.</p>
            <p>Consumer disputes are additionally subject to Royal Legislative Decree 1/2007 (TRLGDCU) and applicable consumer-protection regulations.</p>
          </>
        ),
      },
      {
        number: "15", title: "Contact",
        content: <InfoTable rows={[["Support email", <a key="e" href={`mailto:${LEGAL_ENTITY.contactEmail}`} className="text-accent hover:underline">{LEGAL_ENTITY.contactEmail}</a>]]} />,
      },
    ];
  }

  return [
    {
      number: "1", title: "Titular del sitio",
      content: (
        <InfoTable rows={[
          ["Denominación social", LEGAL_ENTITY.name],
          ["CIF", LEGAL_ENTITY.cif],
          ["Domicilio", LEGAL_ENTITY.address],
          ["Sitio web", LEGAL_ENTITY.website],
        ]} />
      ),
    },
    {
      number: "2", title: "Objeto y ámbito de aplicación",
      content: (
        <>
          <p>Las presentes Condiciones regulan el uso de SEGOLIFE, la plataforma de vida universitaria disponible en {LEGAL_ENTITY.website}, operada por {LEGAL_ENTITY.name}. SEGOLIFE da acceso a: Community (propuestas, comentarios y likes de estudiantes), una agenda de eventos con acceso a entradas, un programa de fidelización (SegoTokens) y un catálogo de Beneficios, y un programa de referidos.</p>
          <p>Crear una cuenta implica la aceptación de estas Condiciones. Si no está de acuerdo con alguna de ellas, absténgase de registrarse o de usar las funciones de SEGOLIFE que requieren cuenta.</p>
        </>
      ),
    },
    {
      number: "3", title: "Registro y cuenta de usuario",
      content: (
        <>
          <p>Para crear una cuenta se facilitan: nombre y apellidos, email, teléfono, una contraseña, su comunidad (p. ej. IE University, UVa Segovia), su universidad y, opcionalmente, su año académico. El registro exige aceptar estas Condiciones y declarar haber leído la Política de Privacidad mediante una casilla obligatoria y no premarcada; de forma independiente, puede marcar otra casilla opcional para recibir comunicaciones promocionales.</p>
          <p>Cada cuenta es personal, vinculada a una persona real, e intransferible. El usuario es responsable de la veracidad de los datos facilitados y de la custodia de su contraseña.</p>
        </>
      ),
    },
    {
      number: "4", title: "Edad mínima",
      content: (
        <p><PendingNote>Pendiente de decisión de negocio — todavía no está definida, y este documento no va a inventar una regla que hoy no existe en el producto.</PendingNote> SEGOLIFE está pensado para estudiantes universitarios; la plataforma no aplica hoy ninguna comprobación de edad mínima en el registro.</p>
      ),
    },
    {
      number: "5", title: "Uso aceptable",
      content: (
        <ul>
          <li>Usar SEGOLIFE de forma lícita y de buena fe.</li>
          <li>No intentar acceder a la cuenta de otro usuario ni eludir la seguridad de la plataforma.</li>
          <li>No usar herramientas automatizadas para extraer datos, hacer spam o abusar del servicio.</li>
        </ul>
      ),
    },
    {
      number: "6", title: "Community: normas de conducta",
      content: (
        <p>
          Al publicar propuestas, comentarios o reacciones en Community, o al dar like/comentar en un evento, nunca se debe incluir contenido ilícito, difamatorio, amenazante, de acoso u odio, spam, suplantación, ni contenido que vulnere derechos de terceros. SEGOLIFE puede ocultar o eliminar contenido que incumpla estas normas — ver el <Link href="/aviso-legal"><span className="text-accent hover:underline cursor-pointer">Aviso Legal</span></Link> para el listado completo.
        </p>
      ),
    },
    {
      number: "7", title: "Events y compra de entradas",
      content: (
        <>
          <p>La agenda de eventos de SEGOLIFE incluye eventos gestionados a través de operadores externos de ticketing (actualmente Weezevent y/o Fourvenues, según el evento). Para esos, pulsar "Comprar entradas" lleva al checkout propio del operador — la compra, el pago y el contrato resultante son entre el usuario y ese operador, no con {LEGAL_ENTITY.name}.</p>
          <p>SEGOLIFE no dispone hoy de una pasarela de pago activa para venta nativa de entradas — cualquier compra nativa actual es gratuita o se paga íntegramente con SegoTokens. Si en el futuro se activa la venta nativa de pago, se regirá por estas Condiciones y por la <Link href="/condiciones-cancelacion"><span className="text-accent hover:underline cursor-pointer">Política de Devolución y Reembolso</span></Link>, actualizada en consecuencia.</p>
        </>
      ),
    },
    {
      number: "8", title: "SegoTokens y Beneficios",
      content: (
        <p>
          SegoTokens es la moneda interna de fidelización de SEGOLIFE. Se obtienen mediante actividad en la plataforma (compra de entradas, asistencia a eventos, referidos y acciones similares definidas por las reglas vigentes del programa) y pueden gastarse en el catálogo de Beneficios. Los SegoTokens no pueden comprarse con dinero ni canjearse por dinero — no tienen valor fuera de SEGOLIFE y se rigen por las reglas vigentes en el momento en que se obtienen o se gastan, que pueden cambiar.
        </p>
      ),
    },
    {
      number: "9", title: "Programa de referidos",
      content: <p>Invitar a otros estudiantes puede generar recompensas en SegoTokens tanto para quien invita como para quien es invitado, según las condiciones de la campaña de referidos vigente en cada momento.</p>,
    },
    {
      number: "10", title: "Comunicaciones",
      content: (
        <p>
          SEGOLIFE siempre envía las comunicaciones transaccionales necesarias para el funcionamiento de la cuenta (confirmaciones, seguridad, recuperación de contraseña) con independencia de las preferencias del usuario. Las comunicaciones promocionales solo se envían si el usuario las ha aceptado expresamente, y puede retirar ese consentimiento en cualquier momento desde sus preferencias de notificaciones.
        </p>
      ),
    },
    {
      number: "11", title: "Propiedad intelectual",
      content: <p>Todo el contenido de SEGOLIFE que no sea contenido generado por usuarios es propiedad de {LEGAL_ENTITY.name} o de sus licenciantes — ver el <Link href="/aviso-legal"><span className="text-accent hover:underline cursor-pointer">Aviso Legal</span></Link> para el detalle.</p>,
    },
    {
      number: "12", title: "Suspensión y baja de cuenta",
      content: (
        <p>
          {LEGAL_ENTITY.name} puede suspender o dar de baja una cuenta que incumpla estas Condiciones de forma grave o reiterada, de manera proporcionada al incumplimiento. El usuario puede solicitar la baja de su cuenta en cualquier momento escribiendo a <a href={`mailto:${LEGAL_ENTITY.contactEmail}`} className="text-accent hover:underline">{LEGAL_ENTITY.contactEmail}</a>.
        </p>
      ),
    },
    {
      number: "13", title: "Modificación de las condiciones",
      content: <p>{LEGAL_ENTITY.name} podrá actualizar estas Condiciones para adaptarlas a cambios legislativos o del producto. La versión y la fecha de última actualización figuran siempre en el encabezado de este documento; los cambios relevantes se comunicarán a los usuarios registrados.</p>,
    },
    {
      number: "14", title: "Legislación aplicable y jurisdicción",
      content: (
        <>
          <p>Estas Condiciones se rigen por la legislación española. Cualquier controversia se someterá a los Juzgados y Tribunales de Segovia, salvo que la normativa imperativa de protección al consumidor reconozca un fuero distinto.</p>
          <p>En caso de conflicto con consumidores y usuarios, se estará adicionalmente a lo dispuesto en el Real Decreto Legislativo 1/2007 (TRLGDCU) y demás normativa de protección al consumidor aplicable.</p>
        </>
      ),
    },
    {
      number: "15", title: "Contacto",
      content: <InfoTable rows={[["Email de soporte", <a key="e" href={`mailto:${LEGAL_ENTITY.contactEmail}`} className="text-accent hover:underline">{LEGAL_ENTITY.contactEmail}</a>]]} />,
    },
  ];
}
