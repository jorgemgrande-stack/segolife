import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Cookie, X, ChevronDown, ChevronUp, Shield, BarChart2, Megaphone, Settings } from "lucide-react";
import { isPotentialCommunityRequest } from "@shared/segolife/routing";

const STORAGE_KEY = "nayade_cookie_consent";

interface ConsentState {
  accepted: boolean;
  necessary: boolean;
  analytics: boolean;
  marketing: boolean;
  preferences: boolean;
  timestamp: number;
}

function loadConsent(): ConsentState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ConsentState;
  } catch {
    return null;
  }
}

function saveConsent(state: ConsentState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event('cookieConsentChanged'));
}

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [preferences, setPreferences] = useState(false);
  const { t } = useTranslation();
  const [location] = useLocation();
  // Fase 6 hardening: mismo consentimiento/lógica, tratamiento visual y copy
  // distintos en rutas de Segolife — el banner oscuro/corporativo heredado de
  // Náyade desentonaba con el diseño claro tipo app (ver revisión visual).
  // Fase 8.5: "/" pasó a ser la Home pública de Segolife (antes no era ruta
  // de ninguna comunidad, por eso isPotentialCommunityRequest no la cubría)
  // — se comprueba aparte, junto con las páginas de login/legales/auth que
  // en el cierre de Fase 8.5 se rebrandearon a SEGOLIFE (antes mostraban
  // marca Náyade y por tanto no importaba que el banner tampoco encajara).
  const SEGOLIFE_EXTRA_ROUTES = ["/login", "/recuperar-contrasena", "/nueva-contrasena", "/establecer-contrasena", "/privacidad", "/cookies"];
  const isSegolife = location === "/" || SEGOLIFE_EXTRA_ROUTES.includes(location) || isPotentialCommunityRequest({
    pathname: location,
    hostname: typeof window !== "undefined" ? window.location.hostname : undefined,
  });

  useEffect(() => {
    const consent = loadConsent();
    if (!consent || !consent.accepted) {
      // Small delay so the page renders first
      const timer = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  if (!visible) return null;

  const handleAcceptAll = () => {
    saveConsent({
      accepted: true,
      necessary: true,
      analytics: true,
      marketing: true,
      preferences: true,
      timestamp: Date.now(),
    });
    setVisible(false);
  };

  const handleNecessaryOnly = () => {
    saveConsent({
      accepted: true,
      necessary: true,
      analytics: false,
      marketing: false,
      preferences: false,
      timestamp: Date.now(),
    });
    setVisible(false);
  };

  const handleSaveCustom = () => {
    saveConsent({
      accepted: true,
      necessary: true,
      analytics,
      marketing,
      preferences,
      timestamp: Date.now(),
    });
    setVisible(false);
  };

  if (isSegolife) {
    return (
      <div className="segolife-theme fixed bottom-0 left-0 right-0 z-[9999] p-4 pointer-events-none">
        <div className="segolife-elevated-shadow pointer-events-auto mx-auto max-w-md rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex flex-col gap-3 p-4">
            <div className="flex items-start gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Cookie className="size-4" aria-hidden="true" />
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("cookie.message")}{" "}
                <Link href="/cookies" className="underline underline-offset-2 text-foreground">
                  {t("cookie.learnMore")}
                </Link>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setExpanded(v => !v)}
                className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <Settings className="size-3" aria-hidden="true" />
                {t("cookie.manage")}
                {expanded ? <ChevronUp className="size-3" aria-hidden="true" /> : <ChevronDown className="size-3" aria-hidden="true" />}
              </button>
              <button
                onClick={handleNecessaryOnly}
                className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                {t("cookie.necessaryOnly")}
              </button>
              <button
                onClick={handleAcceptAll}
                className="ml-auto rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground"
              >
                {t("cookie.acceptAll")}
              </button>
            </div>
            {expanded && (
              <div className="space-y-2 border-t border-border pt-3">
                {[
                  { title: t("cookie.necessaryTitle"), desc: t("cookie.necessaryDescription"), icon: Shield, locked: true, value: true, onToggle: undefined },
                  { title: t("cookie.analyticsTitle"), desc: t("cookie.analyticsDescription"), icon: BarChart2, locked: false, value: analytics, onToggle: () => setAnalytics(v => !v) },
                  { title: t("cookie.marketingTitle"), desc: t("cookie.marketingDescription"), icon: Megaphone, locked: false, value: marketing, onToggle: () => setMarketing(v => !v) },
                ].map(row => (
                  <div key={row.title} className="flex items-start justify-between gap-3 rounded-xl bg-secondary/50 p-3">
                    <div className="flex items-start gap-2">
                      <row.icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <div>
                        <p className="text-xs font-semibold text-foreground">
                          {row.title}
                          {row.locked && <span className="ml-1.5 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">{t("cookie.necessaryAlwaysOn")}</span>}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{row.desc}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={row.locked}
                      onClick={row.onToggle}
                      aria-label={row.title}
                      className="mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors disabled:cursor-not-allowed"
                      style={{ background: row.value ? "var(--primary)" : "var(--secondary)", justifyContent: row.value ? "flex-end" : "flex-start" }}
                    >
                      <div className="h-4 w-4 rounded-full bg-white shadow" />
                    </button>
                  </div>
                ))}
                <div className="flex justify-end pt-1">
                  <button
                    onClick={handleSaveCustom}
                    className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground"
                  >
                    {t("cookie.savePreferences")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[9999] p-4 md:p-6 pointer-events-none">
      <div
        className="pointer-events-auto mx-auto max-w-4xl rounded-2xl shadow-2xl overflow-hidden"
        style={{
          background: "linear-gradient(135deg, oklch(0.14 0.06 235) 0%, oklch(0.20 0.09 225) 100%)",
          border: "1px solid oklch(0.30 0.08 225 / 0.6)",
        }}
      >
        {/* Main banner row */}
        <div className="flex flex-col md:flex-row items-start md:items-center gap-4 p-5 md:p-6">
          {/* Icon + text */}
          <div className="flex items-start gap-4 flex-1 min-w-0">
            <div className="shrink-0 flex h-10 w-10 items-center justify-center rounded-full"
              style={{ background: "oklch(0.70 0.20 42 / 0.15)", border: "1px solid oklch(0.70 0.20 42 / 0.3)" }}>
              <Cookie className="h-5 w-5" style={{ color: "oklch(0.70 0.20 42)" }} />
            </div>
            <div className="min-w-0">
              <p className="text-white font-semibold text-sm mb-1">Usamos cookies para mejorar tu experiencia</p>
              <p className="text-white/60 text-xs leading-relaxed">
                Utilizamos cookies propias y de terceros para analizar el uso del sitio, personalizar contenido y mostrarte publicidad relevante.
                Puedes aceptar todas, solo las necesarias o{" "}
                <button
                  onClick={() => setExpanded(v => !v)}
                  className="underline underline-offset-2 text-white/80 hover:text-white transition-colors"
                >
                  configurar tus preferencias
                </button>.
                {" "}
                <Link href="/cookies" className="underline underline-offset-2 text-white/80 hover:text-white transition-colors">
                  Más información
                </Link>
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2 shrink-0 w-full md:w-auto">
            <button
              onClick={() => setExpanded(v => !v)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-white/70 hover:text-white hover:bg-white/10 transition-colors border border-white/15"
            >
              <Settings className="h-3.5 w-3.5" />
              Configurar
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            <button
              onClick={handleNecessaryOnly}
              className="rounded-lg px-4 py-2 text-xs font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors border border-white/20"
            >
              Solo necesarias
            </button>
            <button
              onClick={handleAcceptAll}
              className="rounded-lg px-5 py-2 text-xs font-semibold text-white transition-all hover:opacity-90 active:scale-95"
              style={{ background: "oklch(0.70 0.20 42)", boxShadow: "0 2px 12px oklch(0.70 0.20 42 / 0.35)" }}
            >
              Aceptar todas
            </button>
          </div>
        </div>

        {/* Expanded configuration panel */}
        {expanded && (
          <div className="border-t px-5 pb-5 md:px-6 md:pb-6 space-y-3" style={{ borderColor: "oklch(0.30 0.08 225 / 0.4)" }}>
            <p className="text-white/50 text-xs pt-4 pb-1">Gestiona qué tipos de cookies permites:</p>

            {/* Necessary — always on */}
            <div className="flex items-start justify-between gap-4 rounded-xl p-4"
              style={{ background: "oklch(0.20 0.07 230 / 0.5)", border: "1px solid oklch(0.32 0.08 225 / 0.4)" }}>
              <div className="flex items-start gap-3">
                <Shield className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "oklch(0.70 0.20 42)" }} />
                <div>
                  <p className="text-white text-xs font-semibold">Necesarias <span className="ml-1 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">Siempre activas</span></p>
                  <p className="text-white/50 text-xs mt-0.5">Imprescindibles para el funcionamiento del sitio: sesión, carrito, seguridad y preferencias básicas.</p>
                </div>
              </div>
              <div className="shrink-0">
                <div className="h-5 w-9 rounded-full flex items-center justify-end px-0.5 cursor-not-allowed"
                  style={{ background: "oklch(0.70 0.20 42)" }}>
                  <div className="h-4 w-4 rounded-full bg-white shadow" />
                </div>
              </div>
            </div>

            {/* Analytics */}
            <div className="flex items-start justify-between gap-4 rounded-xl p-4"
              style={{ background: "oklch(0.20 0.07 230 / 0.5)", border: "1px solid oklch(0.32 0.08 225 / 0.4)" }}>
              <div className="flex items-start gap-3">
                <BarChart2 className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "oklch(0.65 0.15 200)" }} />
                <div>
                  <p className="text-white text-xs font-semibold">Analíticas</p>
                  <p className="text-white/50 text-xs mt-0.5">Nos ayudan a entender cómo usas el sitio para mejorar la experiencia (Google Analytics, Hotjar).</p>
                </div>
              </div>
              <button
                onClick={() => setAnalytics(v => !v)}
                className="shrink-0 h-5 w-9 rounded-full flex items-center px-0.5 transition-all duration-200"
                style={{ background: analytics ? "oklch(0.70 0.20 42)" : "oklch(0.35 0.05 230)", justifyContent: analytics ? "flex-end" : "flex-start" }}
                aria-label={analytics ? "Desactivar cookies analíticas" : "Activar cookies analíticas"}
              >
                <div className="h-4 w-4 rounded-full bg-white shadow" />
              </button>
            </div>

            {/* Marketing */}
            <div className="flex items-start justify-between gap-4 rounded-xl p-4"
              style={{ background: "oklch(0.20 0.07 230 / 0.5)", border: "1px solid oklch(0.32 0.08 225 / 0.4)" }}>
              <div className="flex items-start gap-3">
                <Megaphone className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "oklch(0.72 0.18 48)" }} />
                <div>
                  <p className="text-white text-xs font-semibold">Marketing</p>
                  <p className="text-white/50 text-xs mt-0.5">Permiten mostrarte anuncios personalizados en redes sociales y plataformas de publicidad (Meta Pixel, Google Ads).</p>
                </div>
              </div>
              <button
                onClick={() => setMarketing(v => !v)}
                className="shrink-0 h-5 w-9 rounded-full flex items-center px-0.5 transition-all duration-200"
                style={{ background: marketing ? "oklch(0.70 0.20 42)" : "oklch(0.35 0.05 230)", justifyContent: marketing ? "flex-end" : "flex-start" }}
                aria-label={marketing ? "Desactivar cookies de marketing" : "Activar cookies de marketing"}
              >
                <div className="h-4 w-4 rounded-full bg-white shadow" />
              </button>
            </div>

            {/* Preferences */}
            <div className="flex items-start justify-between gap-4 rounded-xl p-4"
              style={{ background: "oklch(0.20 0.07 230 / 0.5)", border: "1px solid oklch(0.32 0.08 225 / 0.4)" }}>
              <div className="flex items-start gap-3">
                <Settings className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "oklch(0.75 0.12 280)" }} />
                <div>
                  <p className="text-white text-xs font-semibold">Preferencias</p>
                  <p className="text-white/50 text-xs mt-0.5">Recuerdan tus ajustes personales como idioma, moneda o región para ofrecerte una experiencia más personalizada.</p>
                </div>
              </div>
              <button
                onClick={() => setPreferences(v => !v)}
                className="shrink-0 h-5 w-9 rounded-full flex items-center px-0.5 transition-all duration-200"
                style={{ background: preferences ? "oklch(0.70 0.20 42)" : "oklch(0.35 0.05 230)", justifyContent: preferences ? "flex-end" : "flex-start" }}
                aria-label={preferences ? "Desactivar cookies de preferencias" : "Activar cookies de preferencias"}
              >
                <div className="h-4 w-4 rounded-full bg-white shadow" />
              </button>
            </div>

            {/* Save custom */}
            <div className="flex justify-end pt-1">
              <button
                onClick={handleSaveCustom}
                className="rounded-lg px-5 py-2 text-xs font-semibold text-white transition-all hover:opacity-90 active:scale-95"
                style={{ background: "oklch(0.70 0.20 42)", boxShadow: "0 2px 12px oklch(0.70 0.20 42 / 0.35)" }}
              >
                Guardar preferencias
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
