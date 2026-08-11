/**
 * Register.tsx — alta de estudiante (SEGOLIFE — STUDENT REGISTRATION &
 * ONBOARDING). Convierte el CTA "Únete a SEGOLIFE" de PublicHome en un
 * registro real: Cuenta → Comunidad (+ consentimientos) → sesión iniciada.
 *
 * Tema `.segolife-theme` (violeta/lila), NUNCA el tema oscuro de admin que
 * usa Login.tsx — esta página es cara al estudiante/público, no al staff.
 * Estructura de "página de auth" (panel editorial + formulario) igual que
 * Login.tsx, con copy y colores propios — mismo esqueleto ya validado, sin
 * inventar un tercer layout.
 *
 * Llama a POST /api/auth/register (REST, igual que /api/auth/login — ver
 * CLAUDE.md: única excepción a "todo por tRPC"), abre sesión automáticamente
 * al terminar (spec punto 19) y redirige a la comunidad elegida o a
 * `returnTo` si es una ruta interna segura (isSafeInternalPath — mismo
 * sistema que Login.tsx, nunca dos implementaciones de returnTo).
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { isSafeInternalPath } from "@/const";

const SEGOLIFE_LOGO_FALLBACK = "/icons/segolife-icon.svg";

type Community = { id: number; slug: string; name: string; status: string };

type ErrorCode =
  | "INVALID_INPUT" | "INVALID_EMAIL" | "WEAK_PASSWORD" | "PASSWORD_MISMATCH"
  | "EMAIL_EXISTS" | "COMMUNITY_NOT_FOUND" | "RATE_LIMIT_EXCEEDED" | "GENERIC" | "NETWORK";

function mapErrorCode(code: string | undefined): string {
  switch (code) {
    case "INVALID_INPUT": return "register.errors.INVALID_INPUT";
    case "INVALID_EMAIL": return "register.errors.INVALID_EMAIL";
    case "WEAK_PASSWORD": return "register.errors.WEAK_PASSWORD";
    case "EMAIL_EXISTS": return "register.errors.EMAIL_EXISTS";
    case "COMMUNITY_NOT_FOUND": return "register.errors.COMMUNITY_NOT_FOUND";
    case "RATE_LIMIT_EXCEEDED": return "register.errors.RATE_LIMITED";
    default: return "register.errors.GENERIC";
  }
}

export default function Register() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const params = new URLSearchParams(window.location.search);
  const rawReturnTo = params.get("returnTo");
  const returnTo = isSafeInternalPath(rawReturnTo) ? rawReturnTo : null;
  const preselectSlug = params.get("community");

  const [step, setStep] = useState<1 | 2>(1);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [communitySlug, setCommunitySlug] = useState<string | null>(null);
  const [academicYear, setAcademicYear] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [website, setWebsite] = useState(""); // honeypot — un humano nunca lo rellena
  const [error, setError] = useState<{ code?: ErrorCode; messageKey: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const meQuery = trpc.auth.me.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const { data: communities } = trpc.communities.list.useQuery();
  const { data: publicSettings } = trpc.config.getPublicSettings.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const brandLogo = publicSettings?.segolife_brand_logo_url || SEGOLIFE_LOGO_FALLBACK;
  const brandName = publicSettings?.segolife_brand_name || "SEGOLIFE";

  const activeCommunities: Community[] = (communities ?? []).filter((c) => c.status === "active");

  // Preseleccionar por ?community=slug (spec punto 77) — solo si es una
  // comunidad activa real, y el estudiante siempre puede cambiarla.
  useEffect(() => {
    if (preselectSlug && communitySlug === null && activeCommunities.some((c) => c.slug === preselectSlug)) {
      setCommunitySlug(preselectSlug);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectSlug, communities]);

  useEffect(() => {
    document.title = t("register.meta.title");
  }, [t]);

  // Ya autenticado → nunca mostrar el formulario de nuevo (spec punto 21).
  useEffect(() => {
    if (meQuery.data) {
      navigate(returnTo ?? "/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meQuery.data, navigate]);

  function goToStep2(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      setError({ messageKey: "register.errors.INVALID_INPUT" });
      return;
    }
    if (password.length < 8) {
      setError({ code: "WEAK_PASSWORD", messageKey: "register.errors.WEAK_PASSWORD" });
      return;
    }
    if (password !== passwordConfirm) {
      setError({ code: "PASSWORD_MISMATCH", messageKey: "register.errors.PASSWORD_MISMATCH" });
      return;
    }
    setStep(2);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!communitySlug) {
      setError({ code: "COMMUNITY_NOT_FOUND", messageKey: "register.errors.COMMUNITY_NOT_FOUND" });
      return;
    }
    if (!acceptTerms) {
      setError({ messageKey: "register.errors.INVALID_INPUT" });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim().toLowerCase(),
          password,
          communitySlug,
          academicYear: academicYear.trim() || undefined,
          marketingConsent,
          website,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError({ code: data.code, messageKey: mapErrorCode(data.code) });
        setLoading(false);
        return;
      }

      // El honeypot (server/localAuth.ts) responde 201 sin crear cuenta ni
      // cookie de sesión para no delatar al bot — pero un 201 sin `id` real
      // NUNCA debe pintar el estado de éxito (no hay sesión que mostrar).
      // Un humano real nunca rellena el campo oculto, así que esta rama solo
      // la alcanza tráfico automatizado — a quien no le afecta la UX, pero
      // tampoco debe quedar como un estado inconsistente si algún día se
      // inspecciona manualmente.
      if (!data.id) {
        setLoading(false);
        return;
      }

      await utils.auth.me.invalidate();
      setSuccess(true);
      setTimeout(() => {
        navigate(returnTo ?? `/${communitySlug}`);
      }, 900);
    } catch {
      setError({ code: "NETWORK", messageKey: "register.errors.NETWORK" });
      setLoading(false);
    }
  }

  // Cargando la sesión, o ya autenticado (el useEffect de arriba está
  // redirigiendo): nunca mostrar el formulario en ninguno de los dos casos
  // (spec punto 21 — "nunca volver a mostrar el registro").
  if (meQuery.isLoading || meQuery.data) {
    return (
      <div className="segolife-theme min-h-dvh flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (success) {
    return (
      <div className="segolife-theme min-h-dvh flex flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <CheckCircle2 className="w-14 h-14 text-primary" />
        <h1 className="text-2xl font-bold text-foreground">{t("register.success.title")}</h1>
        <p className="text-muted-foreground">{t("register.success.subtitle")}</p>
      </div>
    );
  }

  return (
    <div className="segolife-theme min-h-dvh flex bg-background">
      {/* Panel izquierdo — editorial, oculto en mobile (mismo patrón que Login.tsx) */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden bg-[#150a28]">
        <div
          className="absolute inset-0 opacity-80"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, oklch(0.30 0.14 296) 0%, transparent 45%), radial-gradient(circle at 85% 75%, oklch(0.30 0.16 350) 0%, transparent 50%)",
          }}
        />
        <div className="relative z-10 flex items-center gap-3">
          <img src={brandLogo} alt={brandName} className="w-10 h-10 rounded-xl object-contain" />
          <div className="text-white font-bold text-lg leading-tight">{brandName}</div>
        </div>
        <div className="relative z-10">
          <h1 className="text-4xl font-bold text-white leading-tight mb-4">{t("register.title")}</h1>
          <p className="text-white/75 text-lg leading-relaxed">{t("register.subtitle")}</p>
        </div>
        <div className="relative z-10 text-white/50 text-sm">{t("register.eyebrow")}</div>
      </div>

      {/* Panel derecho — formulario. items-start (no centrado) + pb-40 en
          mobile/tablet: con dos tarjetas de comunidad + dos checkboxes de
          consentimiento, el paso 2 centrado verticalmente alcanzaba el
          CookieBanner fijo (bottom-0) y tapaba el botón "Crear mi cuenta"
          — bug real detectado en QA visual (ver
          register-step2-community-selected-390.png). Centrado solo desde
          lg:, donde el layout partido de escritorio nunca llega tan abajo. */}
      <div className="w-full lg:w-1/2 flex items-start lg:items-center justify-center p-6 pt-10 pb-40 lg:p-12">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <img src={brandLogo} alt={brandName} className="w-10 h-10 rounded-xl object-contain" />
            <div className="text-foreground font-bold text-lg leading-tight">{brandName}</div>
          </div>

          {/* Indicador de pasos */}
          <div className="flex items-center gap-2 mb-6 text-sm font-medium">
            <span className={step === 1 ? "text-primary" : "text-muted-foreground"}>1. {t("register.steps.account")}</span>
            <span className="text-border">—</span>
            <span className={step === 2 ? "text-primary" : "text-muted-foreground"}>2. {t("register.steps.community")}</span>
          </div>

          {step === 1 ? (
            <form onSubmit={goToStep2} className="space-y-5" noValidate>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">{t("register.account.firstName")}</Label>
                  <Input id="firstName" autoComplete="given-name" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">{t("register.account.lastName")}</Label>
                  <Input id="lastName" autoComplete="family-name" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">{t("register.account.email")}</Label>
                <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">{t("register.account.password")}</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? t("register.account.hidePassword") : t("register.account.showPassword")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">{t("register.account.passwordHint")}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="passwordConfirm">{t("register.account.passwordConfirm")}</Label>
                <Input
                  id="passwordConfirm"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                />
              </div>

              {/* Honeypot — invisible para una persona, un bot que rellena todos los campos cae aquí. */}
              <div className="hidden" aria-hidden="true">
                <label htmlFor="website">Website</label>
                <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{t(error.messageKey)}</span>
                </div>
              )}

              <Button type="submit" className="w-full">{t("register.account.continue")}</Button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-foreground">{t("register.community.title")}</h2>
                <p className="text-sm text-muted-foreground">{t("register.community.subtitle")}</p>
              </div>

              {activeCommunities.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("register.community.empty")}</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {activeCommunities.map((c) => (
                    <button
                      key={c.slug}
                      type="button"
                      onClick={() => setCommunitySlug(c.slug)}
                      aria-pressed={communitySlug === c.slug}
                      className={`rounded-2xl border p-4 text-left transition-colors ${
                        communitySlug === c.slug
                          ? "border-primary bg-primary/10"
                          : "border-border bg-card hover:border-primary/40"
                      }`}
                    >
                      <div className="font-semibold text-foreground">{c.name}</div>
                    </button>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="academicYear">{t("register.community.academicYear")}</Label>
                <Input id="academicYear" value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} />
              </div>

              <div className="space-y-3 pt-2">
                <div className="flex items-start gap-2">
                  <Checkbox id="acceptTerms" checked={acceptTerms} onCheckedChange={(v) => setAcceptTerms(v === true)} className="mt-0.5" />
                  <Label htmlFor="acceptTerms" className="text-sm font-normal leading-snug">
                    {t("register.consent.termsPrefix")}{" "}
                    <a href="/privacidad" target="_blank" rel="noreferrer" className="text-primary underline">
                      {t("register.consent.termsPrivacy")}
                    </a>{" "}
                    {t("register.consent.termsAnd")}{" "}
                    <a href="/terminos" target="_blank" rel="noreferrer" className="text-primary underline">{t("register.consent.termsUsage")}.</a>
                  </Label>
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox id="marketingConsent" checked={marketingConsent} onCheckedChange={(v) => setMarketingConsent(v === true)} className="mt-0.5" />
                  <Label htmlFor="marketingConsent" className="text-sm font-normal leading-snug">
                    {t("register.consent.marketing")}
                  </Label>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{t(error.messageKey)}</span>
                  {error.code === "EMAIL_EXISTS" && (
                    <a href={`/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`} className="underline whitespace-nowrap">
                      {t("register.errors.loginCta")}
                    </a>
                  )}
                </div>
              )}

              <div className="flex gap-3">
                <Button type="button" variant="outline" onClick={() => setStep(1)} disabled={loading}>
                  {t("register.community.back")}
                </Button>
                <Button type="submit" className="flex-1" disabled={loading || !acceptTerms || !communitySlug}>
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {t("register.consent.submitting")}
                    </span>
                  ) : (
                    t("register.consent.submit")
                  )}
                </Button>
              </div>
            </form>
          )}

          <div className="mt-8 text-center text-sm text-muted-foreground">
            {t("register.footer.hasAccount")}{" "}
            <a href={`/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`} className="text-primary hover:text-primary/80 font-medium">
              {t("register.footer.login")}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
