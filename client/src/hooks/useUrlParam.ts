/**
 * useUrlParam.ts — deep navigation (Production Polish Gate, spec §72):
 * un único query param sincronizado con la URL — shareable, reload-safe,
 * back-button-safe. Usa `replace` (nunca añade una entrada nueva al
 * historial por cada cambio de filtro) salvo que se pida lo contrario.
 */
import { useLocation, useSearch } from "wouter";

export function useUrlParam(key: string): [string | null, (value: string | null) => void] {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const value = new URLSearchParams(search).get(key);

  const setValue = (next: string | null) => {
    const params = new URLSearchParams(search);
    if (next === null) params.delete(key);
    else params.set(key, next);
    const qs = params.toString();
    navigate(`${location}${qs ? `?${qs}` : ""}`, { replace: true });
  };

  return [value, setValue];
}
