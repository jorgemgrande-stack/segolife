import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { ChevronRight, Cookie, Settings } from "lucide-react";
import { PublicHomeNav } from "@/components/publicHome/PublicHomeNav";
import { PublicHomeFooter } from "@/components/publicHome/PublicHomeFooter";
import { LegalSection, InfoTable, CookieTable, LegalToc, type LegalSectionData } from "@/components/legal/LegalPageBlocks";
import { LEGAL_LAST_UPDATED, LEGAL_LAST_UPDATED_EN } from "@/lib/legalIdentity";
import { openCookiePreferences } from "@/lib/cookiePreferences";

/**
 * Política de Cookies — SEGOLIFE (FASE LEGAL, 2026-08-23). REESCRITURA
 * COMPLETA: el inventario anterior (session_token/csrf_token/cart_id/
 * lang_pref/cookie_consent) estaba fabricado, ninguna de esas cookies existe
 * en el repo. Este inventario es el real, encontrado auditando
 * CookieBanner.tsx, localAuth.ts, ga4/client.ts, meta-pixel/, CartContext.tsx,
 * ThemeContext.tsx y referralAttribution.ts.
 */
export default function PoliticaCookies() {
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
            <span className="text-white/80">{isEn ? "Cookie Policy" : "Política de Cookies"}</span>
          </div>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center">
                <Cookie className="w-6 h-6 text-accent" />
              </div>
              <div>
                <h1 className="text-3xl md:text-4xl font-display font-bold text-white">{isEn ? "Cookie Policy" : "Política de Cookies"}</h1>
                <p className="text-white/55 text-sm mt-1">{isEn ? `Last updated: ${LEGAL_LAST_UPDATED_EN}` : `Última actualización: ${LEGAL_LAST_UPDATED}`}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={openCookiePreferences}
              className="inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            >
              <Settings className="w-4 h-4" />
              {isEn ? "Cookie settings" : "Configuración de cookies"}
            </button>
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
        number: "1", title: "What are cookies",
        content: (
          <p>
            Cookies are small text files a website stores on your device when you visit it. They let the site remember your actions and preferences over time, so you don't have to re-enter them every time you come back or move between pages. SEGOLIFE also uses equivalent browser-storage technologies (like <code>localStorage</code>) for some of the same purposes.
          </p>
        ),
      },
      {
        number: "2", title: "Cookies used on this site",
        content: (
          <>
            <h3 className="text-white font-semibold mt-6 mb-3">2.1 Necessary cookies (always active)</h3>
            <p>Required for the site to work at all — session, shopping/checkout state, and the record of your own cookie choice. Without these, SEGOLIFE cannot function correctly.</p>
            <CookieTable rows={[
              ["nayade_session", "SEGOLIFE (own)", "Sliding, up to 7 days", "Keeps you signed in."],
              ["nayade_cart_v1", "SEGOLIFE (own, localStorage)", "Until cleared", "Keeps your in-progress order/reservation."],
              ["nayade_cookie_consent", "SEGOLIFE (own, localStorage)", "Until changed", "Remembers your cookie choice, so this banner isn't shown on every visit."],
            ]} />

            <h3 className="text-white font-semibold mt-6 mb-3">2.2 Preference cookies</h3>
            <p>Remember non-essential personal settings.</p>
            <CookieTable rows={[
              ["nayade-public-theme / nayade-admin-theme", "SEGOLIFE (own, localStorage)", "Until changed", "Remembers your light/dark theme choice."],
              ["segolife.referral_attribution", "SEGOLIFE (own, localStorage)", "Until registration or 30 days", "Remembers an invite code so a referral reward can be attributed at signup."],
            ]} />

            <h3 className="text-white font-semibold mt-6 mb-3">2.3 Analytics cookies (require consent)</h3>
            <p>Help us understand how SEGOLIFE is used, so we can improve it. Only load after you accept analytics/marketing cookies (Google Consent Mode v2).</p>
            <CookieTable rows={[
              ["_ga, _ga_*", "Google Analytics", "Up to 2 years", "Distinguishes unique visitors and sessions."],
              ["_gid", "Google Analytics", "24 hours", "Distinguishes visitors for daily traffic analysis."],
            ]} />

            <h3 className="text-white font-semibold mt-6 mb-3">2.4 Marketing / third-party cookies (require consent)</h3>
            <p>Only load after you accept marketing cookies.</p>
            <CookieTable rows={[
              ["_fbp, _fbc", "Meta (Facebook) Pixel", "Up to 90 days", "Measures the reach of SEGOLIFE campaigns on Meta platforms."],
              ["Google Maps embed", "Google", "Set by Google, not controlled by SEGOLIFE", "Displays an interactive map; only loaded after marketing consent — otherwise a link to open the map on Google's own site is shown instead."],
            ]} />
          </>
        ),
      },
      {
        number: "3", title: "How to manage your choice",
        content: (
          <>
            <p>You can change your cookie preferences at any time using the "Cookie settings" button at the top of this page, or from the SEGOLIFE footer. You can also configure or delete cookies from your browser settings — bear in mind that disabling necessary cookies may prevent parts of the site from working:</p>
            <ul>
              <li><a href="https://support.google.com/chrome/answer/95647" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Google Chrome</a></li>
              <li><a href="https://support.mozilla.org/en-US/kb/enhanced-tracking-protection-firefox-desktop" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Mozilla Firefox</a></li>
              <li><a href="https://support.apple.com/guide/safari/sfri11471/mac" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Apple Safari</a></li>
              <li><a href="https://support.microsoft.com/microsoft-edge/delete-cookies-in-microsoft-edge-63947406-40ac-c3b8-57b9-2a946a29ae09" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Microsoft Edge</a></li>
            </ul>
          </>
        ),
      },
      {
        number: "4", title: "Legal basis",
        content: (
          <p>
            Necessary cookies rely on the legitimate interest of the controller in making the site work correctly (art. 6.1.f GDPR). Analytics and marketing cookies rely on your consent (art. 6.1.a GDPR), which you can withdraw at any time without affecting the lawfulness of processing carried out before withdrawal.
          </p>
        ),
      },
      {
        number: "5", title: "International transfers",
        content: (
          <p>
            Google Analytics and Meta Pixel may transfer data to servers outside the European Economic Area. Such transfers are covered by the standard contractual clauses approved by the European Commission or an equivalent adequacy framework.
          </p>
        ),
      },
      {
        number: "6", title: "Updates to this policy",
        content: <p>This Cookie Policy may be updated to reflect legal, technical, or product changes. The last-updated date is always shown at the top of the document.</p>,
      },
      {
        number: "7", title: "More information",
        content: (
          <p>
            For any query about cookies, contact us via the SEGOLIFE support channels. For more information about how your personal data is processed, see the <Link href="/privacidad"><span className="text-accent hover:underline cursor-pointer">Privacy Policy</span></Link>.
          </p>
        ),
      },
    ];
  }

  return [
    {
      number: "1", title: "¿Qué son las cookies?",
      content: (
        <p>
          Las cookies son pequeños archivos de texto que un sitio web guarda en su dispositivo al visitarlo. Permiten que el sitio recuerde sus acciones y preferencias durante un tiempo, para no tener que volver a introducirlas cada vez que regresa o navega entre páginas. SEGOLIFE también usa tecnologías equivalentes de almacenamiento del navegador (como <code>localStorage</code>) para algunos de estos mismos fines.
        </p>
      ),
    },
    {
      number: "2", title: "Cookies utilizadas en este sitio",
      content: (
        <>
          <h3 className="text-white font-semibold mt-6 mb-3">2.1 Cookies necesarias (siempre activas)</h3>
          <p>Imprescindibles para que el sitio funcione: sesión, estado del pedido/reserva en curso, y el registro de su propia elección de cookies. Sin ellas, SEGOLIFE no puede funcionar correctamente.</p>
          <CookieTable rows={[
            ["nayade_session", "SEGOLIFE (propia)", "Deslizante, hasta 7 días", "Mantiene su sesión iniciada."],
            ["nayade_cart_v1", "SEGOLIFE (propia, localStorage)", "Hasta que se borre", "Mantiene su pedido/reserva en curso."],
            ["nayade_cookie_consent", "SEGOLIFE (propia, localStorage)", "Hasta que se cambie", "Recuerda su elección de cookies, para no mostrar este banner en cada visita."],
          ]} />

          <h3 className="text-white font-semibold mt-6 mb-3">2.2 Cookies de preferencias</h3>
          <p>Recuerdan ajustes personales no esenciales.</p>
          <CookieTable rows={[
            ["nayade-public-theme / nayade-admin-theme", "SEGOLIFE (propia, localStorage)", "Hasta que se cambie", "Recuerda su elección de tema claro/oscuro."],
            ["segolife.referral_attribution", "SEGOLIFE (propia, localStorage)", "Hasta el registro o 30 días", "Recuerda un código de invitación para poder atribuir una recompensa de referido al registrarse."],
          ]} />

          <h3 className="text-white font-semibold mt-6 mb-3">2.3 Cookies analíticas (requieren consentimiento)</h3>
          <p>Nos ayudan a entender cómo se usa SEGOLIFE para poder mejorarlo. Solo se cargan tras aceptar cookies analíticas/marketing (Google Consent Mode v2).</p>
          <CookieTable rows={[
            ["_ga, _ga_*", "Google Analytics", "Hasta 2 años", "Distingue visitantes y sesiones únicos."],
            ["_gid", "Google Analytics", "24 horas", "Distingue visitantes para el análisis de tráfico diario."],
          ]} />

          <h3 className="text-white font-semibold mt-6 mb-3">2.4 Cookies de marketing / terceros (requieren consentimiento)</h3>
          <p>Solo se cargan tras aceptar cookies de marketing.</p>
          <CookieTable rows={[
            ["_fbp, _fbc", "Meta (Facebook) Pixel", "Hasta 90 días", "Mide el alcance de las campañas de SEGOLIFE en plataformas de Meta."],
            ["Mapa incrustado de Google Maps", "Google", "La fija Google, SEGOLIFE no la controla", "Muestra un mapa interactivo; solo se carga tras el consentimiento de marketing — si no, se muestra en su lugar un enlace para abrir el mapa en el propio sitio de Google."],
          ]} />
        </>
      ),
    },
    {
      number: "3", title: "Cómo gestionar su elección",
      content: (
        <>
          <p>Puede cambiar sus preferencias de cookies en cualquier momento con el botón "Configuración de cookies" en la parte superior de esta página, o desde el pie de página de SEGOLIFE. También puede configurar o eliminar cookies desde los ajustes de su navegador — tenga en cuenta que desactivar cookies necesarias puede impedir que partes del sitio funcionen:</p>
          <ul>
            <li><a href="https://support.google.com/chrome/answer/95647" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Google Chrome</a></li>
            <li><a href="https://support.mozilla.org/es/kb/habilitar-y-deshabilitar-cookies-sitios-web-rastrear-preferencias" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Mozilla Firefox</a></li>
            <li><a href="https://support.apple.com/es-es/guide/safari/sfri11471/mac" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Apple Safari</a></li>
            <li><a href="https://support.microsoft.com/es-es/microsoft-edge/eliminar-las-cookies-en-microsoft-edge-63947406-40ac-c3b8-57b9-2a946a29ae09" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Microsoft Edge</a></li>
          </ul>
        </>
      ),
    },
    {
      number: "4", title: "Base legal",
      content: (
        <p>
          Las cookies necesarias se basan en el interés legítimo del responsable en garantizar el correcto funcionamiento del sitio (art. 6.1.f RGPD). Las cookies analíticas y de marketing se basan en su consentimiento (art. 6.1.a RGPD), que puede retirar en cualquier momento sin que ello afecte a la licitud del tratamiento previo a su retirada.
        </p>
      ),
    },
    {
      number: "5", title: "Transferencias internacionales",
      content: (
        <p>
          Google Analytics y Meta Pixel pueden transferir datos a servidores fuera del Espacio Económico Europeo. Dichas transferencias están amparadas por las cláusulas contractuales tipo aprobadas por la Comisión Europea o un marco de adecuación equivalente.
        </p>
      ),
    },
    {
      number: "6", title: "Actualizaciones de esta política",
      content: <p>Esta Política de Cookies podrá actualizarse para reflejar cambios legislativos, técnicos o del producto. La fecha de última actualización figura siempre en el encabezado del documento.</p>,
    },
    {
      number: "7", title: "Más información",
      content: (
        <p>
          Para cualquier consulta sobre cookies, contacte con nosotros a través de los canales de soporte de SEGOLIFE. Para más información sobre cómo se tratan sus datos personales, consulte la <Link href="/privacidad"><span className="text-accent hover:underline cursor-pointer">Política de Privacidad</span></Link>.
        </p>
      ),
    },
  ];
}
