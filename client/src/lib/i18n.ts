/**
 * i18n de Segolife — infraestructura nueva, aislada de la app heredada.
 *
 * Alcance de esta fase (1B): SOLO los componentes nuevos de Segolife
 * (CommunityHome, selector admin) usan este namespace. El resto de la
 * aplicación heredada de Náyade sigue con su texto en español hardcodeado
 * tal cual — no se traduce en esta fase (ver docs/SEGOLIFE_ROADMAP.md,
 * Fase 6 para la extracción sistemática futura).
 *
 * El idioma inicial lo decide CommunityContext a partir de
 * `community.defaultLocale` (dato de BD, ver drizzle/schema.ts), nunca un
 * literal de comunidad en código.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../locales/en/segolife.json";
import es from "../locales/es/segolife.json";

export const SEGOLIFE_NAMESPACE = "segolife";
export type SupportedLocale = "en" | "es";
export const SUPPORTED_LOCALES: SupportedLocale[] = ["en", "es"];

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    lng: "es",
    fallbackLng: "es",
    ns: [SEGOLIFE_NAMESPACE],
    defaultNS: SEGOLIFE_NAMESPACE,
    resources: {
      en: { [SEGOLIFE_NAMESPACE]: en },
      es: { [SEGOLIFE_NAMESPACE]: es },
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}

export function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as string[]).includes(value);
}

export default i18n;
