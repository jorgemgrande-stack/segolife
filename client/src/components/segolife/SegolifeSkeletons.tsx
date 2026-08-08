import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton de una card de evento/venue (imagen + 2 líneas de texto) — Fase 6, punto 28. */
export function SegolifeCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={className}>
      <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
      <Skeleton className="mt-2.5 h-4 w-3/4 rounded-full" />
      <Skeleton className="mt-1.5 h-3 w-1/2 rounded-full" />
    </div>
  );
}

/** Fila horizontal de N cards en skeleton — para carruseles Tonight/Featured. */
export function SegolifeCardRowSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex gap-3 overflow-hidden">
      {Array.from({ length: count }).map((_, i) => (
        <SegolifeCardSkeleton key={i} className="w-40 shrink-0" />
      ))}
    </div>
  );
}

/** Grid de N cards en skeleton — para Explore/listados. */
export function SegolifeCardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <SegolifeCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Skeleton del bloque de saldo/wallet en Home. */
export function SegolifeWalletSkeleton() {
  return (
    <div className="segolife-card-shadow rounded-3xl bg-card p-5">
      <Skeleton className="h-3 w-24 rounded-full" />
      <Skeleton className="mt-3 h-9 w-40 rounded-full" />
      <Skeleton className="mt-3 h-3 w-32 rounded-full" />
    </div>
  );
}

/** Skeleton de una fila simple de lista (historial, beneficios). */
export function SegolifeRowSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl bg-card p-3 segolife-card-shadow">
          <Skeleton className="size-11 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/3 rounded-full" />
            <Skeleton className="h-3 w-1/3 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
