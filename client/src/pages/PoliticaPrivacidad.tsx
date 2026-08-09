import { Link } from "wouter";
import { ChevronRight, Shield } from "lucide-react";
import { PublicHomeNav } from "@/components/publicHome/PublicHomeNav";
import { PublicHomeFooter } from "@/components/publicHome/PublicHomeFooter";

// Fase 8.5 — corrección de cierre: ver nota equivalente en PoliticaCookies.tsx.
export default function PoliticaPrivacidad() {
  return (
    <div className="segolife-theme flex min-h-screen flex-col bg-background">
      <PublicHomeNav variant="solid" />
      {/* Hero */}
      <section className="bg-[oklch(0.14_0.03_240)] py-16">
        <div className="container">
          <div className="flex items-center gap-2 text-white/50 text-sm mb-4">
            <Link href="/" className="hover:text-primary transition-colors">Inicio</Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-white/80">Política de Privacidad</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center">
              <Shield className="w-6 h-6 text-accent" />
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-display font-bold text-white">Política de Privacidad</h1>
              <p className="text-white/55 text-sm mt-1">Última actualización: marzo 2026</p>
            </div>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="bg-[oklch(0.11_0.02_240)] py-16">
        <div className="container max-w-4xl">
          <div className="prose prose-invert prose-lg max-w-none space-y-10">

            <LegalSection number="1" title="Responsable del tratamiento">
              <p>
                De conformidad con lo dispuesto en el Reglamento (UE) 2016/679 (RGPD) y la Ley Orgánica 3/2018
                (LOPDGDD), se informa al usuario que los datos personales que facilite a través de este sitio web
                serán tratados por SEGOLIFE. Los datos identificativos y de contacto completos del responsable del
                tratamiento se publicarán en este apartado en cuanto estén formalizados.
              </p>
            </LegalSection>

            <LegalSection number="2" title="Finalidad del tratamiento">
              <p>Los datos personales recogidos se tratarán con las siguientes finalidades:</p>
              <ul>
                <li>Gestionar la cuenta del usuario y su participación en la comunidad universitaria de SEGOLIFE (eventos, entradas, recompensas y beneficios).</li>
                <li>Dar respuesta a consultas o solicitudes de información recibidas a través de los formularios del sitio web.</li>
                <li>Remitir comunicaciones sobre eventos, recompensas y novedades de la comunidad, cuando el usuario lo haya consentido.</li>
                <li>Gestionar la compra de entradas y la prestación de los servicios contratados.</li>
                <li>Mejorar la experiencia del usuario y la calidad de los servicios prestados.</li>
              </ul>
            </LegalSection>

            <LegalSection number="3" title="Conservación de los datos">
              <p>
                Los datos se conservarán mientras se mantenga la relación comercial o el usuario no solicite su
                supresión, y durante los plazos necesarios para cumplir con obligaciones legales o atender posibles
                responsabilidades. En particular, los datos fiscales y de facturación se conservarán durante el plazo
                mínimo exigido por la normativa tributaria vigente (5 años).
              </p>
            </LegalSection>

            <LegalSection number="4" title="Legitimación">
              <p>El tratamiento de los datos se basa en:</p>
              <ul>
                <li><strong>La ejecución de un contrato:</strong> cuando el usuario crea una cuenta o contrata servicios a través del sitio web.</li>
                <li><strong>El consentimiento expreso del usuario:</strong> al aceptar la presente política de privacidad, al marcar casillas habilitadas o al enviar formularios.</li>
                <li><strong>Interés legítimo:</strong> para el envío de comunicaciones comerciales a clientes con relación contractual previa sobre servicios similares a los contratados.</li>
              </ul>
              <p>La negativa a facilitar datos puede impedir la prestación de los servicios solicitados.</p>
            </LegalSection>

            <LegalSection number="5" title="Destinatarios">
              <p>
                Los datos no se comunicarán a terceros salvo obligación legal o cuando sea necesario para la
                prestación del servicio (por ejemplo, proveedores de alojamiento web, pasarelas de pago o servicios
                administrativos).
              </p>
              <p>
                SEGOLIFE trabaja con proveedores que cumplen la normativa vigente en materia de protección
                de datos. En ningún caso se cederán datos a terceros con fines de marketing sin el consentimiento
                expreso del usuario.
              </p>
            </LegalSection>

            <LegalSection number="6" title="Derechos del usuario">
              <p>El usuario puede ejercer en cualquier momento los derechos reconocidos por el RGPD:</p>
              <ul>
                <li><strong>Acceso</strong> — conocer qué datos personales se están tratando.</li>
                <li><strong>Rectificación</strong> — corregir datos inexactos o incompletos.</li>
                <li><strong>Supresión</strong> — solicitar la eliminación de los datos cuando ya no sean necesarios.</li>
                <li><strong>Limitación</strong> — solicitar la restricción del tratamiento en determinadas circunstancias.</li>
                <li><strong>Oposición</strong> — oponerse al tratamiento de sus datos por motivos relacionados con su situación particular.</li>
                <li><strong>Portabilidad</strong> — recibir sus datos en un formato estructurado y de uso común.</li>
              </ul>
              <p>
                Para ello deberá enviar una solicitud a través de los canales de contacto de SEGOLIFE, acompañada de
                un documento que acredite su identidad. Asimismo, tiene derecho a presentar una reclamación ante la
                Agencia Española de Protección de Datos (www.aepd.es) si considera que el tratamiento no se ajusta a
                la normativa vigente.
              </p>
            </LegalSection>

            <LegalSection number="7" title="Seguridad y confidencialidad">
              <p>
                SEGOLIFE adopta las medidas técnicas y organizativas necesarias para garantizar la seguridad,
                integridad y confidencialidad de los datos personales, de acuerdo con lo establecido en el RGPD y la
                LOPDGDD. No obstante, ningún sistema de transmisión o almacenamiento de datos es completamente seguro
                y no puede garantizarse la ausencia absoluta de accesos no autorizados.
              </p>
            </LegalSection>

            <LegalSection number="8" title="Comunicaciones comerciales">
              <p>
                De acuerdo con la Ley 34/2002 de Servicios de la Sociedad de la Información y Comercio Electrónico
                (LSSI-CE), SEGOLIFE no enviará comunicaciones comerciales sin el consentimiento previo del
                usuario. En el caso de clientes con relación contractual previa, podrá enviar comunicaciones sobre
                servicios similares a los inicialmente contratados, con opción de darse de baja en cualquier momento
                a través del enlace incluido en cada comunicación.
              </p>
            </LegalSection>

            <LegalSection number="9" title="Cookies">
              <p>
                SEGOLIFE podrá utilizar cookies propias y de terceros para mejorar la experiencia de
                navegación, analizar el tráfico y personalizar el contenido. El usuario puede configurar su navegador
                para rechazar las cookies o recibir avisos al respecto. Para más información, consulte nuestra{" "}
                <Link href="/politica-de-cookies">
                  <span className="text-accent hover:underline cursor-pointer">Política de Cookies</span>
                </Link>.
              </p>
            </LegalSection>

            <LegalSection number="10" title="Modificaciones">
              <p>
                SEGOLIFE podrá modificar la presente política para adaptarla a novedades legislativas o a
                cambios en sus servicios. La fecha de última actualización figurará siempre en el encabezado del
                presente documento. Se recomienda al usuario revisar periódicamente esta política.
              </p>
            </LegalSection>

          </div>
        </div>
      </section>
      <PublicHomeFooter />
    </div>
  );
}

function LegalSection({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xl font-display font-bold text-white mb-4 flex items-center gap-3">
        <span className="w-8 h-8 rounded-lg bg-accent/20 text-accent text-sm font-bold flex items-center justify-center flex-shrink-0">
          {number}
        </span>
        {title}
      </h2>
      <div className="text-white/70 leading-relaxed space-y-3 pl-11">
        {children}
      </div>
    </div>
  );
}

function InfoTable({ rows }: { rows: [string, string][] }) {
  return (
    <div className="mt-4 rounded-xl border border-white/10 overflow-hidden">
      {rows.map(([label, value], i) => (
        <div key={i} className={`flex gap-4 px-5 py-3 ${i % 2 === 0 ? "bg-white/5" : "bg-transparent"}`}>
          <span className="text-white/50 text-sm font-medium w-40 flex-shrink-0">{label}</span>
          <span className="text-white/80 text-sm">{value}</span>
        </div>
      ))}
    </div>
  );
}
