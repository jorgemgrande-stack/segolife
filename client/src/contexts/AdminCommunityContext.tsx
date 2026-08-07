import React, { createContext, useContext, useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import type { Community } from "../../../drizzle/schema";
import {
  ADMIN_COMMUNITY_FILTER_ALL,
  ADMIN_COMMUNITY_FILTER_STORAGE_KEY,
  parseAdminCommunityFilter,
  serializeAdminCommunityFilter,
  type AdminCommunityFilterValue,
} from "@shared/segolife/adminCommunityFilter";

interface AdminCommunityContextType {
  /** "all" o el id de la comunidad seleccionada. */
  filter: AdminCommunityFilterValue;
  setFilter: (value: AdminCommunityFilterValue) => void;
  /** Lista real de comunidades desde la API — el selector nunca hardcodea IE/UVA. */
  communities: Community[];
  loading: boolean;
}

const AdminCommunityContext = createContext<AdminCommunityContextType | undefined>(undefined);

export function AdminCommunityProvider({ children }: { children: React.ReactNode }) {
  const [filter, setFilterState] = useState<AdminCommunityFilterValue>(() => {
    if (typeof window === "undefined") return ADMIN_COMMUNITY_FILTER_ALL;
    return parseAdminCommunityFilter(localStorage.getItem(ADMIN_COMMUNITY_FILTER_STORAGE_KEY));
  });

  useEffect(() => {
    localStorage.setItem(ADMIN_COMMUNITY_FILTER_STORAGE_KEY, serializeAdminCommunityFilter(filter));
  }, [filter]);

  const { data, isLoading } = trpc.communities.list.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });

  const setFilter = (value: AdminCommunityFilterValue) => setFilterState(value);

  return (
    <AdminCommunityContext.Provider
      value={{ filter, setFilter, communities: data ?? [], loading: isLoading }}
    >
      {children}
    </AdminCommunityContext.Provider>
  );
}

export function useAdminCommunity() {
  const context = useContext(AdminCommunityContext);
  if (!context) {
    throw new Error("useAdminCommunity must be used within AdminCommunityProvider");
  }
  return context;
}

export { ADMIN_COMMUNITY_FILTER_ALL };
