import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { ChevronRight, Scale } from "lucide-react";
import { PublicHomeNav } from "@/components/publicHome/PublicHomeNav";
import { PublicHomeFooter } from "@/components/publicHome/PublicHomeFooter";
import { LegalSection, InfoTable, LegalToc, type LegalSectionData } from "@/components/legal/LegalPageBlocks";
import { LEGAL_ENTITY, LEGAL_LAST_UPDATED, LEGAL_LAST_UPDATED_EN } from "@/lib/legalIdentity";

/**
 * Aviso Legal — SEGOLIFE / HAYQUE CAPITAL, S.L. (FASE LEGAL, 2026-08-23).
 *
 * Página nueva (no existía ninguna versión previa de "Aviso Legal" en el
 * repo — a diferencia de /terminos, /privacidad, /cookies y
 * /condiciones-cancelacion, que ya existían con contenido heredado de
 * Náyade y solo hubo que reescribir). Cubre identificación LSSI-CE, acceso y
 * uso general del sitio, contenido generado por usuarios (Community/Events)
 * y responsabilidad; el detalle contractual del registro y de la cuenta
 * vive en /terminos para no duplicar el mismo texto dos veces.
 */
export default function AvisoLegal() {
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
            <span className="text-white/80">{isEn ? "Legal Notice" : "Aviso Legal"}</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center">
              <Scale className="w-6 h-6 text-accent" />
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-display font-bold text-white">{isEn ? "Legal Notice" : "Aviso Legal"}</h1>
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
        number: "1", title: "Site owner identification",
        content: (
          <>
            <p>In compliance with Spanish Law 34/2002, of 11 July, on Information Society Services and Electronic Commerce (LSSI-CE), this website is owned by:</p>
            <InfoTable rows={[
              ["Company name", LEGAL_ENTITY.name],
              ["Tax ID (CIF)", LEGAL_ENTITY.cif],
              ["Registered address", LEGAL_ENTITY.address],
              ["Commercial Registry", <span key="p" className="rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-300 font-medium">Pending confirmation — see LEGAL_REVIEW_REQUIRED.md</span>],
              ["Website", LEGAL_ENTITY.website],
              ["Contact email", LEGAL_ENTITY.contactEmail],
            ]} />
            <p>SEGOLIFE is a digital platform owned by {LEGAL_ENTITY.name}. References to "SEGOLIFE" throughout this and the other legal documents mean the platform/service operated by {LEGAL_ENTITY.name}, not a separate legal entity.</p>
          </>
        ),
      },
      {
        number: "2", title: "Purpose of SEGOLIFE",
        content: (
          <p>
            SEGOLIFE is a digital platform for university student life in Segovia, organised around communities (currently IE University and UVa Segovia, with more planned). It gives students access to: a community space to post and discuss proposals and comments ("Community"), an events agenda with access to tickets — either sold natively or via redirection to external ticketing operators —, a loyalty programme ("SegoTokens") and a benefits/rewards marketplace, and a referral programme. The exact features available to a given student depend on their community.
          </p>
        ),
      },
      {
        number: "3", title: "Access and use conditions",
        content: (
          <p>
            General browsing of the public areas of segolife.es does not require registration. Certain features — participating in Community, using the Events social layer (likes/comments), purchasing or reserving tickets, and accessing SegoTokens/Benefits — require creating an account. By using SEGOLIFE you agree to use the site and its services diligently, lawfully, and in accordance with this Legal Notice and the <Link href="/terminos"><span className="text-accent hover:underline cursor-pointer">Terms and Conditions of Use</span></Link>.
          </p>
        ),
      },
      {
        number: "4", title: "User registration",
        content: (
          <p>
            The registration process, the data collected, and the contractual conditions of holding a SEGOLIFE account are governed by the <Link href="/terminos"><span className="text-accent hover:underline cursor-pointer">Terms and Conditions of Use</span></Link>, to avoid duplicating the same rules in two documents.
          </p>
        ),
      },
      {
        number: "5", title: "User obligations",
        content: (
          <ul>
            <li>Provide truthful information when registering and keep it up to date.</li>
            <li>Keep your password confidential and use your account only for yourself — accounts are personal and non-transferable.</li>
            <li>Use SEGOLIFE for lawful purposes and never to harm the platform, other users, or third parties.</li>
            <li>Never impersonate another person, organisation, venue, or event organiser.</li>
          </ul>
        ),
      },
      {
        number: "6", title: "Proper use of Community",
        content: (
          <>
            <p>Community lets students post proposals, comments, and reactions ("likes") visible to other members of their community, and the same social layer (likes and comments) exists on Event pages. Posting there, you agree not to publish content that:</p>
            <ul>
              <li>Is unlawful, defamatory, threatening, or an incitement to violence.</li>
              <li>Constitutes insults, harassment, or hate speech.</li>
              <li>Is spam or unsolicited commercial content.</li>
              <li>Impersonates another person or entity.</li>
              <li>Infringes the intellectual property, privacy, or other rights of third parties.</li>
            </ul>
            <p>SEGOLIFE may hide or remove content that breaches these rules (the platform already supports moderating/hiding a comment without deleting the underlying record, for accountability). This power is used proportionately, only in response to an actual breach, never arbitrarily.</p>
          </>
        ),
      },
      {
        number: "7", title: "Content published by students",
        content: (
          <p>
            The author of a proposal, comment, or reaction keeps ownership of it. By publishing it on SEGOLIFE, the author grants {LEGAL_ENTITY.name} a non-exclusive licence to store, display, and distribute that content within the platform, for as long as it remains published. Responsibility for the content's lawfulness and accuracy lies with its author, not with {LEGAL_ENTITY.name}.
          </p>
        ),
      },
      {
        number: "8", title: "Intellectual and industrial property",
        content: (
          <p>
            All content on this website (text, design, source code, logos) that is not user-generated content is the property of {LEGAL_ENTITY.name} or its licensors and is protected by Spanish and international intellectual and industrial property law. Reproduction, distribution, public communication, or transformation without express written authorisation is prohibited.
          </p>
        ),
      },
      {
        number: "9", title: "Third-party links and services",
        content: (
          <p>
            SEGOLIFE may link to, embed, or redirect to services operated by third parties — including external ticketing operators (Weezevent, Fourvenues), maps, and social networks. {LEGAL_ENTITY.name} does not control and is not responsible for the content, availability, or policies of those third-party services; use of them is subject to their own terms.
          </p>
        ),
      },
      {
        number: "10", title: "Events and ticketing",
        content: (
          <p>
            Some events published on SEGOLIFE are sold and managed directly through external ticketing operators (currently Weezevent and/or Fourvenues, depending on the event) — for these, purchasing a ticket happens on the operator's own platform, and {LEGAL_ENTITY.name} does not process that payment. Other events may in the future be sold natively through segolife.es. See the <Link href="/condiciones-cancelacion"><span className="text-accent hover:underline cursor-pointer">Refunds and Returns Policy</span></Link> for who is responsible for cancellations and refunds in each case.
          </p>
        ),
      },
      {
        number: "11", title: "Limitation of liability",
        content: (
          <p>
            {LEGAL_ENTITY.name} is not liable for damages arising from misuse of the platform by users, from the content of third-party services linked from SEGOLIFE, or from circumstances beyond its reasonable control that affect the availability of the site.
          </p>
        ),
      },
      {
        number: "12", title: "Security and service availability",
        content: (
          <p>
            {LEGAL_ENTITY.name} applies reasonable technical and organisational measures to keep the platform secure and available, but cannot guarantee uninterrupted availability or the complete absence of errors.
          </p>
        ),
      },
      {
        number: "13", title: "User support",
        content: <p>For any query about the platform, contact <a href={`mailto:${LEGAL_ENTITY.contactEmail}`} className="text-accent hover:underline">{LEGAL_ENTITY.contactEmail}</a>.</p>,
      },
      {
        number: "14", title: "Data protection",
        content: (
          <p>
            The processing of personal data collected through SEGOLIFE is described in the <Link href="/privacidad"><span className="text-accent hover:underline cursor-pointer">Privacy Policy</span></Link>.
          </p>
        ),
      },
      {
        number: "15", title: "Applicable law",
        content: <p>This Legal Notice is governed by Spanish law.</p>,
      },
      {
        number: "16", title: "Jurisdiction",
        content: (
          <p>
            For any dispute arising from the use of this website, the parties submit to the Courts of Segovia, Spain, except where mandatory consumer-protection law grants the user the right to a different forum, in which case that mandatory rule prevails.
          </p>
        ),
      },
    ];
  }

  return [
    {
      number: "1", title: "Identificación del titular",
      content: (
        <>
          <p>En cumplimiento de la Ley 34/2002, de 11 de julio, de Servicios de la Sociedad de la Información y Comercio Electrónico (LSSI-CE), se informa que el presente sitio web es titularidad de:</p>
          <InfoTable rows={[
            ["Denominación social", LEGAL_ENTITY.name],
            ["CIF", LEGAL_ENTITY.cif],
            ["Domicilio social", LEGAL_ENTITY.address],
            ["Registro Mercantil", <span key="p" className="rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-300 font-medium">Pendiente de confirmar — ver LEGAL_REVIEW_REQUIRED.md</span>],
            ["Sitio web", LEGAL_ENTITY.website],
            ["Email de contacto", LEGAL_ENTITY.contactEmail],
          ]} />
          <p>SEGOLIFE es una plataforma digital titularidad de {LEGAL_ENTITY.name}. Las referencias a "SEGOLIFE" en este y en el resto de documentos legales se refieren a la plataforma/servicio operado por {LEGAL_ENTITY.name}, no a una sociedad distinta.</p>
        </>
      ),
    },
    {
      number: "2", title: "Objeto de SEGOLIFE",
      content: (
        <p>
          SEGOLIFE es una plataforma digital de vida universitaria en Segovia, organizada en comunidades (actualmente IE University y UVa Segovia, con más comunidades previstas). Ofrece a los estudiantes: un espacio de comunidad para publicar y comentar propuestas ("Community"), una agenda de eventos con acceso a entradas — propias o mediante redirección a operadores externos de ticketing —, un programa de fidelización ("SegoTokens") y un catálogo de beneficios/recompensas, y un programa de referidos. Las funciones concretas disponibles para cada estudiante dependen de su comunidad.
        </p>
      ),
    },
    {
      number: "3", title: "Condiciones de acceso y utilización",
      content: (
        <p>
          La navegación general por las áreas públicas de segolife.es no requiere registro. Determinadas funciones — participar en Community, usar la capa social de Events (likes/comentarios), comprar o reservar entradas, y acceder a SegoTokens/Benefits — requieren crear una cuenta. Al usar SEGOLIFE, el usuario se compromete a utilizar el sitio y sus servicios con diligencia, de forma lícita y conforme a este Aviso Legal y a las <Link href="/terminos"><span className="text-accent hover:underline cursor-pointer">Condiciones de Uso</span></Link>.
        </p>
      ),
    },
    {
      number: "4", title: "Registro de usuarios",
      content: (
        <p>
          El proceso de registro, los datos recogidos y las condiciones contractuales de disponer de una cuenta en SEGOLIFE se regulan en las <Link href="/terminos"><span className="text-accent hover:underline cursor-pointer">Condiciones de Uso</span></Link>, para no duplicar las mismas reglas en dos documentos distintos.
        </p>
      ),
    },
    {
      number: "5", title: "Obligaciones del usuario",
      content: (
        <ul>
          <li>Facilitar información veraz al registrarse y mantenerla actualizada.</li>
          <li>Custodiar su contraseña y usar su cuenta únicamente para sí mismo — las cuentas son personales e intransferibles.</li>
          <li>Usar SEGOLIFE con fines lícitos y nunca para perjudicar a la plataforma, a otros usuarios o a terceros.</li>
          <li>No suplantar nunca a otra persona, organización, local o promotor de eventos.</li>
        </ul>
      ),
    },
    {
      number: "6", title: "Uso correcto de Community",
      content: (
        <>
          <p>Community permite a los estudiantes publicar propuestas, comentarios y reacciones ("likes") visibles para el resto de miembros de su comunidad, y esa misma capa social (likes y comentarios) existe también en las fichas de Events. Al publicar, el usuario se compromete a no incluir contenido que:</p>
          <ul>
            <li>Sea ilícito, difamatorio, amenazante o incite a la violencia.</li>
            <li>Constituya insultos, acoso o discurso de odio.</li>
            <li>Sea spam o publicidad no solicitada.</li>
            <li>Suplante a otra persona o entidad.</li>
            <li>Vulnere derechos de propiedad intelectual, privacidad u otros derechos de terceros.</li>
          </ul>
          <p>SEGOLIFE puede ocultar o eliminar contenido que incumpla estas normas (la plataforma ya soporta moderar/ocultar un comentario sin borrar el registro subyacente, para dejar constancia). Esta facultad se ejerce de forma proporcionada, únicamente ante un incumplimiento real, nunca de manera arbitraria.</p>
        </>
      ),
    },
    {
      number: "7", title: "Contenido publicado por estudiantes",
      content: (
        <p>
          El autor de una propuesta, comentario o reacción conserva su titularidad. Al publicarlo en SEGOLIFE, el autor concede a {LEGAL_ENTITY.name} una licencia no exclusiva para almacenar, mostrar y distribuir ese contenido dentro de la plataforma, mientras permanezca publicado. La responsabilidad sobre la licitud y veracidad del contenido corresponde a su autor, no a {LEGAL_ENTITY.name}.
        </p>
      ),
    },
    {
      number: "8", title: "Propiedad intelectual e industrial",
      content: (
        <p>
          Todos los contenidos de este sitio web (textos, diseño, código fuente, logotipos) que no sean contenido generado por usuarios son propiedad de {LEGAL_ENTITY.name} o de sus licenciantes, y están protegidos por la legislación española e internacional sobre propiedad intelectual e industrial. Queda prohibida su reproducción, distribución, comunicación pública o transformación sin autorización expresa y por escrito.
        </p>
      ),
    },
    {
      number: "9", title: "Enlaces y servicios de terceros",
      content: (
        <p>
          SEGOLIFE puede enlazar, incrustar o redirigir a servicios operados por terceros — incluyendo operadores externos de ticketing (Weezevent, Fourvenues), mapas y redes sociales. {LEGAL_ENTITY.name} no controla ni es responsable del contenido, disponibilidad o políticas de esos servicios de terceros; su uso queda sujeto a sus propias condiciones.
        </p>
      ),
    },
    {
      number: "10", title: "Events y ticketing",
      content: (
        <p>
          Algunos eventos publicados en SEGOLIFE se venden y gestionan directamente a través de operadores externos de ticketing (actualmente Weezevent y/o Fourvenues, según el evento) — en esos casos, la compra de la entrada ocurre en la plataforma del propio operador y {LEGAL_ENTITY.name} no procesa ese pago. Otros eventos podrán en el futuro venderse de forma nativa a través de segolife.es. Consulte la <Link href="/condiciones-cancelacion"><span className="text-accent hover:underline cursor-pointer">Política de Devolución y Reembolso</span></Link> para saber quién responde de las cancelaciones y devoluciones en cada caso.
        </p>
      ),
    },
    {
      number: "11", title: "Limitaciones de responsabilidad",
      content: (
        <p>
          {LEGAL_ENTITY.name} no responde de los daños derivados de un uso indebido de la plataforma por parte de los usuarios, del contenido de servicios de terceros enlazados desde SEGOLIFE, ni de circunstancias ajenas a su control razonable que afecten a la disponibilidad del sitio.
        </p>
      ),
    },
    {
      number: "12", title: "Seguridad y disponibilidad del servicio",
      content: (
        <p>
          {LEGAL_ENTITY.name} aplica medidas técnicas y organizativas razonables para mantener la plataforma segura y disponible, sin que ello suponga garantizar una disponibilidad ininterrumpida ni la ausencia total de errores.
        </p>
      ),
    },
    {
      number: "13", title: "Atención al usuario",
      content: <p>Para cualquier consulta sobre la plataforma, puede escribir a <a href={`mailto:${LEGAL_ENTITY.contactEmail}`} className="text-accent hover:underline">{LEGAL_ENTITY.contactEmail}</a>.</p>,
    },
    {
      number: "14", title: "Protección de datos",
      content: (
        <p>
          El tratamiento de los datos personales recogidos a través de SEGOLIFE se describe en la <Link href="/privacidad"><span className="text-accent hover:underline cursor-pointer">Política de Privacidad</span></Link>.
        </p>
      ),
    },
    {
      number: "15", title: "Legislación aplicable",
      content: <p>El presente Aviso Legal se rige por la legislación española.</p>,
    },
    {
      number: "16", title: "Jurisdicción",
      content: (
        <p>
          Para cualquier controversia derivada del uso de este sitio web, las partes se someten a los Juzgados y Tribunales de Segovia, salvo que la normativa imperativa de protección al consumidor reconozca al usuario el derecho a un fuero distinto, en cuyo caso prevalecerá esa norma imperativa.
        </p>
      ),
    },
  ];
}
