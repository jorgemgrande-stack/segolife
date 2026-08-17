import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";

/**
 * Footer público de la nueva Home SEGOLIFE (Fase 8.5) — propio, nunca
 * PublicFooter.tsx (branding Náyade hardcodeado: logo, email, dirección,
 * copyright — ver auditoría de la fase, hallazgo A de mayor superficie).
 *
 * Fase 15.1 (auditoría) — la lista de comunidades del footer estaba
 * hardcodeada ("IE University"/"UVA Segovia", texto Y href fijos), la única
 * violación real encontrada de la regla "nunca comparar/hardcodear un slug
 * de comunidad en código" (CLAUDE.md) en toda la superficie pública. Ahora
 * lee `communities.list` (mismo procedure público que ya usa el selector de
 * PublicHome.tsx) — una tercera comunidad futura aparece aquí sola, sin
 * tocar este archivo. Este footer se reutiliza tal cual en
 * CommunityPublicLanding (/ie, /uva anónimo), así que también sirve de
 * selector discreto entre comunidades activas ahí (spec Fase 15.1 §17).
 */
export function PublicHomeFooter() {
  const { t } = useTranslation();
  const year = new Date().getFullYear();
  const { data: communities } = trpc.communities.list.useQuery();
  const activeCommunities = (communities ?? []).filter(c => c.status === "active");

  return (
    <footer className="border-t border-white/10 bg-[#0d0817] py-12 text-white/70">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <p className="text-lg font-bold tracking-tight text-white">SEGOLIFE</p>
            <p className="mt-2 max-w-xs text-sm text-white/60">{t("publicHome.footer.tagline")}</p>
          </div>
          {!!activeCommunities.length && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-white/40">{t("publicHome.footer.communities")}</p>
              <ul className="mt-3 space-y-2 text-sm">
                {activeCommunities.map(c => (
                  <li key={c.slug}><Link href={`/${c.slug}`} className="hover:text-white">{c.name}</Link></li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-white/40">{t("publicHome.footer.product")}</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li><a href={getLoginUrl()} className="hover:text-white">{t("publicHome.footer.login")}</a></li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-white/40">{t("publicHome.footer.legal")}</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link href="/terminos" className="hover:text-white">{t("publicHome.footer.terms")}</Link></li>
              <li><Link href="/privacidad" className="hover:text-white">{t("publicHome.footer.privacy")}</Link></li>
              <li><Link href="/cookies" className="hover:text-white">{t("publicHome.footer.cookies")}</Link></li>
              <li><Link href="/condiciones-cancelacion" className="hover:text-white">{t("publicHome.footer.cancellation")}</Link></li>
            </ul>
          </div>
        </div>
        <div className="mt-10 border-t border-white/10 pt-6 text-xs text-white/40">
          © {year} SEGOLIFE · {t("publicHome.footer.rights")}
        </div>
      </div>
    </footer>
  );
}
