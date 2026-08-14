/**
 * shared.tsx — SEGOLIFE ADMIN COMMAND CENTER. Panel/SectionLabel/EmptyState
 * extraídos como componentes reales compartidos (spec §28-29 — antes vivían
 * redefinidos localmente en varios archivos legacy). Acento violeta —
 * identidad real de Segolife confirmada en client/src/index.css
 * (`.segolife-theme { --primary: oklch(0.52 0.19 296); }`, "Lila/violeta —
 * identidad Segolife"), nunca el naranja/azul heredado de Náyade.
 */
import type { ReactNode } from "react";
import { AlertTriangle, Ban, Inbox, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Panel({ title, icon: Icon, children, action, badge, className }: {
  title: string; icon?: React.ElementType; children: ReactNode; action?: ReactNode; badge?: number; className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-border/50 overflow-hidden bg-card/40", className)}>
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-border/30 gap-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2 min-w-0">
          {Icon && <Icon className="w-3.5 h-3.5 text-violet-500 dark:text-violet-400 shrink-0" />}
          <span className="truncate">{title}</span>
          {badge !== undefined && badge > 0 && (
            <span className="bg-rose-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full ml-1 shrink-0">{badge}</span>
          )}
        </h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function SectionLabel({ label, action }: { label: string; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-1 h-4 rounded-full bg-gradient-to-b from-violet-400 to-violet-700" />
      <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70">{label}</span>
      <div className="flex-1 h-px bg-border/30" />
      {action}
    </div>
  );
}

export type EmptyStateKind = "zero-real" | "no-data" | "feature-off" | "error" | "loading";

const EMPTY_STATE_CONFIG: Record<Exclude<EmptyStateKind, "loading">, { icon: React.ElementType; cls: string }> = {
  "zero-real": { icon: Inbox, cls: "text-muted-foreground/60" },
  "no-data": { icon: Inbox, cls: "text-muted-foreground/60" },
  "feature-off": { icon: Ban, cls: "text-muted-foreground/50" },
  error: { icon: AlertTriangle, cls: "text-rose-500" },
};

/**
 * Estado vacío diferenciado (spec §31): ZERO REAL (hay dato pero es 0, p.ej.
 * "0 asistencias registradas hoy — esperado, event_attendance sigue vacío en
 * producción"), NO DATA (todavía no hay suficiente historial para calcular
 * esto), FEATURE OFF (loyalty LIVE bloqueado a propósito), ERROR (fallo real
 * de red/servidor). Nunca el mismo mensaje genérico para los cuatro casos.
 */
export function DashboardEmptyState({ kind, title, detail }: { kind: EmptyStateKind; title: string; detail?: string }) {
  if (kind === "loading") {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground/60">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-xs">Cargando…</span>
      </div>
    );
  }
  const { icon: Icon, cls } = EMPTY_STATE_CONFIG[kind];
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center px-4">
      <Icon className={cn("w-6 h-6", cls)} />
      <p className={cn("text-xs font-semibold", cls)}>{title}</p>
      {detail && <p className="text-[11px] text-muted-foreground/60 max-w-sm">{detail}</p>}
    </div>
  );
}

export function StatRow({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-bold tabular-nums text-right">
        {value}
        {sub && <span className="text-[10px] font-normal text-muted-foreground ml-1">{sub}</span>}
      </span>
    </div>
  );
}

/**
 * Sistema de estado semántico ÚNICO y compartido (Production Polish Gate
 * §8) — nunca "un verde distinto en cada widget". `locked` es un tono
 * DELIBERADAMENTE distinto de `warn`: un estado bloqueado a propósito
 * (Live Loyalty OFF, Email/Push/WhatsApp sin configurar) no es lo mismo que
 * una alerta que requiere acción — mezclarlos (p.ej. mostrar "LIVE OFF" en
 * ámbar) sugiere falsamente que hay algo que arreglar.
 */
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "info" | "locked" }) {
  const tones: Record<string, string> = {
    neutral: "bg-muted text-muted-foreground",
    good: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    warn: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    bad: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
    info: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
    locked: "bg-slate-500/15 text-slate-500 dark:text-slate-400",
  };
  return <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide", tones[tone])}>{children}</span>;
}

export function fmtEUR(cents: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(cents / 100);
}
export function fmtNum(n: number): string {
  return new Intl.NumberFormat("es-ES").format(n);
}
export function fmtPct(n: number | null): string {
  return n == null ? "—" : `${n}%`;
}
export function fmtDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}
export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
