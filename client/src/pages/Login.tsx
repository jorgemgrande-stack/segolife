/**
 * Login.tsx — Formulario de inicio de sesión local.
 *
 * Se usa cuando LOCAL_AUTH=true en el servidor.
 * Llama a POST /api/auth/login, obtiene la cookie JWT y redirige al destino.
 */

import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Lock, Mail, AlertCircle, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { isSafeInternalPath } from "@/const";

/**
 * Página de inicio según el rol del usuario. Los partners van a su panel,
 * los empleados al Portal del Empleado, el resto al panel de admin.
 * Sin esto, un empleado aterrizaba en /admin y recibía "Sin permisos".
 * Nota: 'monitor' sí tiene acceso al panel de admin (Operaciones), por eso
 * no se redirige al portal — va a /admin como el resto.
 *
 * role="user" es el estudiante (spec de registro: sin rol propio, reutiliza
 * el default heredado) — nunca debe acabar en /admin. Va a su comunidad
 * real (user_communities), nunca un slug hardcodeado — bug real corregido:
 * antes de esto, un estudiante que iniciaba sesión en /login (p.ej. desde
 * el enlace "¿Ya tienes cuenta?" de /register) aterrizaba en /admin y
 * recibía "Sin permisos", exactamente el mismo bug que ya se había
 * corregido para empleados.
 */
function homeForRole(role: string | undefined, primaryCommunitySlug: string | null | undefined): string {
  if (role === "partner_admin" || role === "partner_user") return "/partner/dashboard";
  if (role === "supplier") return "/supplier/dashboard";
  if (role === "employee") return "/empleado";
  if (role === "gestoria") return "/gestoria";
  if (role === "user") return primaryCommunitySlug ? `/${primaryCommunitySlug}` : "/";
  return "/admin";
}

// Nunca brand_logo_url/brand_name (heredado de Náyade) — mismas claves
// propias de Segolife que ya usa AdminLayout.tsx, nunca ese fallback.
const SEGOLIFE_LOGO_FALLBACK = "/icons/segolife-icon.svg";

/** returnTo saneado — misma política que Register.tsx (isSafeInternalPath), un único sistema. */
function getSafeReturnTo(): string | null {
  const raw = new URLSearchParams(window.location.search).get("returnTo");
  return isSafeInternalPath(raw) ? raw : null;
}

export default function Login() {
  const { t, i18n } = useTranslation();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Si ya hay sesión activa, redirigir al admin (o a su comunidad si es estudiante)
  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  // Comunidad real del usuario ya autenticado — solo se activa cuando ya
  // sabemos que hay sesión, mismo patrón que Register.tsx (un único sistema
  // de resolución de comunidad, no dos implementaciones).
  const membershipsQuery = trpc.communities.myMemberships.useQuery(undefined, {
    enabled: !!meQuery.data,
    retry: false,
  });

  // Mismas claves de marca que AdminLayout.tsx (este login lleva a /admin
  // para casi todos los roles) — el logo/nombre es el real configurado,
  // nunca un fallback ajeno a la marca (aunque el tema visual de esta
  // página ya no sea el oscuro de admin, ver segolife-theme más abajo).
  const { data: publicSettings } = trpc.config.getPublicSettings.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const brandLogo = publicSettings?.segolife_brand_logo_url || SEGOLIFE_LOGO_FALLBACK;
  const brandName = publicSettings?.segolife_brand_name || "SEGOLIFE";

  useEffect(() => {
    if (!meQuery.data) return;
    const returnTo = getSafeReturnTo();
    if (returnTo) {
      navigate(returnTo);
      return;
    }
    const role = (meQuery.data as any)?.role as string | undefined;
    if (role === "user" && membershipsQuery.data === undefined) return; // esperar a resolver la comunidad
    navigate(homeForRole(role, membershipsQuery.data?.[0]?.slug));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meQuery.data, membershipsQuery.data, navigate]);

  useEffect(() => {
    document.title = t("login.meta.title");
  }, [t]);

  // SEC-02: main.tsx redirige aquí con ?reason=expired cuando confirma (en
  // fresco, no por un 401 aislado) que la sesión anterior ya no es válida —
  // mostrar un mensaje claro en vez de dejar que el usuario llegue a un
  // formulario de login vacío sin saber por qué se le echó. Nunca se
  // documentan aquí detalles internos (JWT, cookies) — solo lenguaje de cara
  // al usuario.
  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("reason");
    if (reason === "expired") {
      setError(t("login.errors.sessionExpired"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? t("login.errors.invalidCredentials"));
        return;
      }

      // Invalidar caché de auth para que useAuth recargue el usuario
      await utils.auth.me.invalidate();
      const me = await utils.auth.me.fetch();

      // Redirigir al destino según rol (o a su comunidad real si es estudiante)
      const role = (me as any)?.role as string | undefined;
      const returnTo = getSafeReturnTo();
      if (returnTo) {
        navigate(returnTo);
        return;
      }
      const primaryCommunitySlug = role === "user" ? (await utils.communities.myMemberships.fetch())?.[0]?.slug : undefined;
      navigate(homeForRole(role, primaryCommunitySlug));
    } catch {
      setError(t("login.errors.network"));
    } finally {
      setLoading(false);
    }
  }

  if (meQuery.isLoading) {
    return (
      <div className="segolife-theme min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="segolife-theme min-h-screen flex bg-background">
      {/* Panel izquierdo — mismo tratamiento visual que Register.tsx
          (gradiente violeta/coral sobre fondo oscuro editorial) — look and
          feel unificado con el resto de la comunidad, a petición explícita
          del usuario: Login pasa del tema oscuro/ámbar de admin al
          claro/violeta de la comunidad. */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden bg-[#150a28]">
        <div
          className="absolute inset-0 opacity-80"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, oklch(0.30 0.14 296) 0%, transparent 45%), radial-gradient(circle at 85% 75%, oklch(0.30 0.16 350) 0%, transparent 50%)",
          }}
        />

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <img src={brandLogo} alt={brandName} className="w-10 h-10 rounded-xl object-contain" />
          <div className="text-white font-bold text-lg leading-tight">{brandName}</div>
        </div>

        {/* Texto central */}
        <div className="relative z-10">
          <h1 className="text-4xl font-bold text-white leading-tight mb-4">
            {t("login.panelTitle1")}<br />
            <span className="text-primary">{t("login.panelTitle2")}</span>
          </h1>
          <p className="text-white/75 text-lg leading-relaxed">
            {t("login.panelSubtitle")}
          </p>
        </div>

        {/* Footer */}
        <div className="relative z-10 text-white/50 text-sm">
          {t("login.footer")}
        </div>
      </div>

      {/* Panel derecho — formulario */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          {/* Selector de idioma — mismo patrón que el real de la comunidad
              (client/src/pages/segolife/Profile.tsx, sección "Idioma"):
              dos píldoras a ancho completo con el nombre del idioma, no el
              código de 2 letras — mismas claves languageSwitcher.en/es, un
              único componente visual de idioma en toda la app. */}
          <div className="flex gap-2 mb-6">
            {(["es", "en"] as const).map((locale) => (
              <button
                key={locale}
                type="button"
                onClick={() => i18n.changeLanguage(locale)}
                className={`flex-1 rounded-2xl border px-4 py-3 text-sm font-medium transition-colors ${
                  i18n.language === locale ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"
                }`}
              >
                {t(`languageSwitcher.${locale}`)}
              </button>
            ))}
          </div>
          {/* Logo móvil */}
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <img src={brandLogo} alt={brandName} className="w-10 h-10 rounded-xl object-contain" />
            <div className="text-foreground font-bold text-lg leading-tight">{brandName}</div>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-foreground mb-2">{t("login.title")}</h2>
            <p className="text-muted-foreground">{t("login.subtitle")}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-foreground/80 text-sm font-medium">
                {t("login.email")}
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="admin@segolife.es"
                  className="pl-10 bg-secondary border-border text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:ring-primary/20"
                />
              </div>
            </div>

            {/* Contraseña */}
            <div className="space-y-2">
              <Label htmlFor="password" className="text-foreground/80 text-sm font-medium">
                {t("login.password")}
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pl-10 pr-10 bg-secondary border-border text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:ring-primary/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Enlace de recuperación */}
            <div className="flex justify-end">
              <Link href="/recuperar-contrasena">
                <span className="text-primary hover:text-primary/80 text-sm transition-colors cursor-pointer">
                  {t("login.forgotPassword")}
                </span>
              </Link>
            </div>

            {/* Botón */}
            <Button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-2.5 text-base transition-colors disabled:opacity-50"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t("login.submitting")}
                </span>
              ) : (
                t("login.submit")
              )}
            </Button>
          </form>

          {/* Alta de estudiante (spec: registro de estudiante vive en /register,
              nunca duplicando este formulario de admin) */}
          <div className="mt-6 text-center text-sm text-muted-foreground">
            {t("login.noAccount")}{" "}
            <Link href={`/register${getSafeReturnTo() ? `?returnTo=${encodeURIComponent(getSafeReturnTo()!)}` : ""}`}>
              <span className="text-primary hover:text-primary/80 font-medium cursor-pointer">{t("login.registerCta")}</span>
            </Link>
          </div>

          {/* Enlace a la web pública */}
          <div className="mt-4 text-center">
            <a
              href="/"
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              {t("login.backToPublic")}
            </a>
          </div>

          {/* Nota de entorno */}
          <div className="mt-6 p-3 rounded-lg bg-secondary/50 border border-border text-muted-foreground text-xs text-center">
            {t("login.localAuthNote")}
          </div>
        </div>
      </div>
    </div>
  );
}
