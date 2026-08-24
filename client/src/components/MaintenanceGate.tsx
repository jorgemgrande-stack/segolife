import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { MAINTENANCE_BYPASS_EMAIL } from "@shared/const";
import MaintenanceNotice from "@/pages/MaintenanceNotice";

// Rutas de login/recuperación: deben seguir accesibles sin sesión durante el
// mantenimiento para que el administrador general pueda entrar. El resto del
// panel de admin YA NO se exime por prefijo de ruta — ver isBypassUser abajo.
const AUTH_ROUTE_PREFIXES = [
  "/login",
  "/recuperar-contrasena",
  "/nueva-contrasena",
  "/establecer-contrasena",
];

export default function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data } = trpc.config.getPublicSettings.useQuery();
  // ctx.user ya viene anulado por el servidor (server/_core/context.ts) para
  // cualquier sesión que no sea la del bypass mientras dure el mantenimiento,
  // así que basta con leer auth.me tal cual.
  const { data: user, isLoading: authLoading } = trpc.auth.me.useQuery();

  const isAuthRoute = AUTH_ROUTE_PREFIXES.some((p) => location.startsWith(p));
  const maintenanceOn = data?.site_maintenance_mode_enabled === "true";
  const isBypassUser = user?.email === MAINTENANCE_BYPASS_EMAIL;

  if (maintenanceOn && !isBypassUser) {
    if (isAuthRoute) return <>{children}</>;
    if (authLoading) return null; // evita parpadeo mientras se resuelve auth.me
    return <MaintenanceNotice message={data?.site_maintenance_message} />;
  }

  return <>{children}</>;
}
