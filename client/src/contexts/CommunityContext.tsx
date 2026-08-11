import React, { createContext, useContext, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { resolveCommunitySlug } from "@shared/segolife/routing";
import type { Community } from "../../../drizzle/schema";

interface CommunityContextType {
  /** Fila completa de la comunidad resuelta, o null si no hay comunidad activa. */
  community: Community | null;
  /** Slug candidato resuelto de la URL (puede no corresponder a ninguna comunidad real). */
  slug: string | null;
  /** Idioma por defecto de la comunidad — dato de BD, nunca hardcodeado por slug. */
  defaultLocale: string | null;
  /** Idiomas disponibles para la comunidad activa — dato de BD. */
  availableLocales: string[];
  loading: boolean;
  error: string | null;
}

const CommunityContext = createContext<CommunityContextType | undefined>(undefined);

export function CommunityProvider({ children }: { children: React.ReactNode }) {
  const { i18n } = useTranslation();
  // CommunityProvider envuelve TODA la app una única vez (App.tsx) — sin
  // `location` en las dependencias, este slug se calculaba solo en el
  // primer montaje y nunca se recalculaba tras una navegación cliente
  // (wouter navigate()), aunque window.location.pathname ya estuviera
  // actualizado. Bug real: tras registrarse/iniciar sesión y ser
  // redirigido a /ie, la página mostraba "Comunidad no encontrada" hasta
  // recargar a mano (remonta CommunityProvider desde cero). Con
  // `location` en las deps, cualquier cambio de ruta recalcula el slug.
  const [location] = useLocation();

  const slug = useMemo(() => {
    if (typeof window === "undefined") return null;
    return resolveCommunitySlug({
      pathname: window.location.pathname,
      hostname: window.location.hostname,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  const { data, isLoading, error } = trpc.communities.getBySlug.useQuery(
    { slug: slug ?? "" },
    { enabled: !!slug, staleTime: 5 * 60 * 1000, retry: false }
  );

  const community = data ?? null;

  // El idioma inicial de la comunidad lo aplica CommunityContext al resolverla
  // — un componente de página puede luego cambiarlo con el selector EN/ES,
  // eso no lo controla este Provider.
  // Fase 6 hardening: `i18n` deliberadamente FUERA del array de dependencias.
  // Con él dentro, el propio changeLanguage() disparaba un re-render que
  // volvía a ejecutar este efecto con el mismo defaultLocale, revirtiendo
  // sin descanso cualquier cambio manual del selector EN/ES del header
  // (SegolifeHeader) — el selector quedaba visualmente inerte. `i18n` es el
  // singleton de client/src/lib/i18n.ts, nunca cambia de verdad.
  useEffect(() => {
    if (community?.defaultLocale) {
      i18n.changeLanguage(community.defaultLocale);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [community?.defaultLocale]);

  const value: CommunityContextType = {
    community,
    slug,
    defaultLocale: community?.defaultLocale ?? null,
    availableLocales: community?.availableLocales ?? [],
    loading: !!slug && isLoading,
    error: error ? error.message : null,
  };

  return <CommunityContext.Provider value={value}>{children}</CommunityContext.Provider>;
}

export function useCommunity() {
  const context = useContext(CommunityContext);
  if (!context) {
    throw new Error("useCommunity must be used within CommunityProvider");
  }
  return context;
}
