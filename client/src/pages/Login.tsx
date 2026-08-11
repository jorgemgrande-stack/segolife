/**
 * Login.tsx — Formulario de inicio de sesión local.
 *
 * Se usa cuando LOCAL_AUTH=true en el servidor.
 * Llama a POST /api/auth/login, obtiene la cookie JWT y redirige al destino.
 */

import { useState, useEffect } from "react";
import { useLocation } from "wouter";
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
 */
function homeForRole(role: string | undefined): string {
  if (role === "partner_admin" || role === "partner_user") return "/partner/dashboard";
  if (role === "supplier") return "/supplier/dashboard";
  if (role === "employee") return "/empleado";
  if (role === "gestoria") return "/gestoria";
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
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Si ya hay sesión activa, redirigir al admin
  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Mismas claves de marca que AdminLayout.tsx (este login lleva a /admin
  // para casi todos los roles) — el look and feel es el del panel real, no
  // una paleta hex aparte heredada de la plantilla original.
  const { data: publicSettings } = trpc.config.getPublicSettings.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const brandLogo = publicSettings?.segolife_brand_logo_url || SEGOLIFE_LOGO_FALLBACK;
  const brandName = publicSettings?.segolife_brand_name || "SEGOLIFE";

  useEffect(() => {
    if (meQuery.data) {
      const role = (meQuery.data as any)?.role as string | undefined;
      navigate(getSafeReturnTo() ?? homeForRole(role));
    }
  }, [meQuery.data, navigate]);

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
        setError(data.error ?? "Credenciales incorrectas. Inténtalo de nuevo.");
        return;
      }

      // Invalidar caché de auth para que useAuth recargue el usuario
      await utils.auth.me.invalidate();
      const me = await utils.auth.me.fetch();

      // Redirigir al destino según rol
      const role = (me as any)?.role as string | undefined;
      navigate(getSafeReturnTo() ?? homeForRole(role));
    } catch {
      setError("Error de conexión. Comprueba que el servidor está en marcha.");
    } finally {
      setLoading(false);
    }
  }

  if (meQuery.isLoading) {
    return (
      <div className="dark min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="dark min-h-screen flex bg-background">
      {/* Panel izquierdo — imagen / marca */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden bg-sidebar">
        {/* Fondo con gradiente — mismo acento ámbar que el panel de admin real, nunca un morado ajeno al tema. */}
        <div className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: "radial-gradient(circle at 30% 50%, var(--primary) 0%, transparent 50%), radial-gradient(circle at 70% 20%, var(--sidebar-ring) 0%, transparent 40%)"
          }}
        />

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <img src={brandLogo} alt={brandName} className="w-10 h-10 rounded-xl object-contain" />
          <div className="text-sidebar-foreground font-bold text-lg leading-tight">{brandName}</div>
        </div>

        {/* Texto central */}
        <div className="relative z-10">
          <h1 className="text-4xl font-bold text-sidebar-foreground leading-tight mb-4">
            Panel de<br />
            <span className="text-primary">Administración</span>
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed">
            Gestiona comunidades, eventos y contenido desde un único lugar.
          </p>
        </div>

        {/* Footer */}
        <div className="relative z-10 text-muted-foreground text-sm">
          Segovia · Vida universitaria
        </div>
      </div>

      {/* Panel derecho — formulario */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          {/* Logo móvil */}
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <img src={brandLogo} alt={brandName} className="w-10 h-10 rounded-xl object-contain" />
            <div className="text-foreground font-bold text-lg leading-tight">{brandName}</div>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-foreground mb-2">Iniciar sesión</h2>
            <p className="text-muted-foreground">Accede con tu email y contraseña de administrador.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-foreground/80 text-sm font-medium">
                Email
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
                Contraseña
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
                  ¿Olvidaste tu contraseña?
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
                  Iniciando sesión…
                </span>
              ) : (
                "Iniciar sesión"
              )}
            </Button>
          </form>

          {/* Alta de estudiante (spec: registro de estudiante vive en /register,
              nunca duplicando este formulario de admin) */}
          <div className="mt-6 text-center text-sm text-muted-foreground">
            ¿No tienes cuenta?{" "}
            <Link href={`/register${getSafeReturnTo() ? `?returnTo=${encodeURIComponent(getSafeReturnTo()!)}` : ""}`}>
              <span className="text-primary hover:text-primary/80 font-medium cursor-pointer">Crear cuenta</span>
            </Link>
          </div>

          {/* Enlace a la web pública */}
          <div className="mt-4 text-center">
            <a
              href="/"
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              ← Volver a la web pública
            </a>
          </div>

          {/* Nota de entorno */}
          <div className="mt-6 p-3 rounded-lg bg-secondary/50 border border-border text-muted-foreground text-xs text-center">
            Modo de autenticación local activo
          </div>
        </div>
      </div>
    </div>
  );
}
