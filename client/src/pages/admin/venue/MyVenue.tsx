import VenueApp from "./VenueApp";

/**
 * MyVenue.tsx — punto de entrada de /admin/mi-local. Desde SEGOLIFE VENUE &
 * PARTNER APP (Fase 5) esta ruta ya no es la ficha mínima de solo-lectura
 * de la fase anterior (RBAC CONSOLIDATION) — es el shell operativo completo
 * (VenueApp.tsx). Se mantiene este archivo/ruta para no romper el único
 * ítem de navegación que ve un Administrador de Local (ver AdminLayout.tsx).
 */
export default function MyVenue() {
  return <VenueApp />;
}
