import type { ReactNode } from "react";

/**
 * Plantilla legal SEGOLIFE — bloques de presentación compartidos por las 5
 * páginas legales (/aviso-legal, /terminos, /privacidad, /cookies,
 * /condiciones-cancelacion). Extraído de los 4 componentes que ya duplicaban
 * exactamente este mismo LegalSection/InfoTable (ver PoliticaPrivacidad.tsx,
 * PoliticaCookies.tsx, CondicionesCancelacion.tsx, TerminosCondiciones.tsx
 * previos) — dedup mecánico y sin riesgo (puramente presentacional, mismo
 * markup/clases de siempre), no una reescritura de arquitectura.
 */
export function LegalSection({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return (
    <div id={`s${number}`}>
      <h2 className="text-xl font-display font-bold text-white mb-4 flex items-center gap-3 scroll-mt-24">
        <span className="w-8 h-8 rounded-lg bg-accent/20 text-accent text-sm font-bold flex items-center justify-center flex-shrink-0">
          {number}
        </span>
        {title}
      </h2>
      <div className="text-white/70 leading-relaxed space-y-3 pl-11">
        {children}
      </div>
    </div>
  );
}

export function InfoTable({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className="mt-4 rounded-xl border border-white/10 overflow-hidden">
      {rows.map(([label, value], i) => (
        <div key={i} className={`flex flex-col gap-1 px-5 py-3 sm:flex-row sm:gap-4 ${i % 2 === 0 ? "bg-white/5" : "bg-transparent"}`}>
          <span className="text-white/50 text-sm font-medium sm:w-48 flex-shrink-0">{label}</span>
          <span className="text-white/80 text-sm">{value}</span>
        </div>
      ))}
    </div>
  );
}

export function CookieTable({ rows }: { rows: [string, string, string, string][] }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
      <div className="min-w-[560px]">
        <div className="flex gap-4 px-5 py-2 bg-white/10">
          <span className="text-white/50 text-xs font-semibold uppercase tracking-wider w-36 flex-shrink-0">Cookie / tecnología</span>
          <span className="text-white/50 text-xs font-semibold uppercase tracking-wider w-28 flex-shrink-0">Proveedor</span>
          <span className="text-white/50 text-xs font-semibold uppercase tracking-wider w-24 flex-shrink-0">Duración</span>
          <span className="text-white/50 text-xs font-semibold uppercase tracking-wider flex-1">Finalidad</span>
        </div>
        {rows.map(([name, provider, duration, purpose], i) => (
          <div key={i} className={`flex gap-4 px-5 py-3 ${i % 2 === 0 ? "bg-white/5" : "bg-transparent"}`}>
            <span className="text-accent text-sm font-mono w-36 flex-shrink-0 break-all">{name}</span>
            <span className="text-white/70 text-sm w-28 flex-shrink-0">{provider}</span>
            <span className="text-white/70 text-sm w-24 flex-shrink-0">{duration}</span>
            <span className="text-white/70 text-sm flex-1">{purpose}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AlertBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-amber-200/80 text-sm leading-relaxed">
      {children}
    </div>
  );
}

/** Placeholder visualmente distinguible para un dato pendiente de confirmar — nunca texto inventado (ver LEGAL_REVIEW_REQUIRED.md). */
export function PendingNote({ children }: { children: ReactNode }) {
  return <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-300 font-medium">{children}</span>;
}

export type LegalSectionData = { number: string; title: string; content: ReactNode };

/** Índice de contenidos — ancla a cada #sN generado por LegalSection. */
export function LegalToc({ sections, label }: { sections: LegalSectionData[]; label: string }) {
  return (
    <nav aria-label={label} className="mb-10 rounded-xl border border-white/10 bg-white/5 p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-white/40 mb-3">{label}</p>
      <ol className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2 text-sm">
        {sections.map((s) => (
          <li key={s.number}>
            <a href={`#s${s.number}`} className="text-white/60 hover:text-accent transition-colors">
              {s.number}. {s.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
