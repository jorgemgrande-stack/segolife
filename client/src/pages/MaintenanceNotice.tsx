import { Wrench } from "lucide-react";
import { trpc } from "@/lib/trpc";

// Fase 8.5 — MaintenanceGate envuelve TODA la app, incluidas /ie /uva de
// Segolife (ver App.tsx) — el fallback nunca puede ser Náyade bajo ninguna
// circunstancia, aunque la fila de BD siga sin personalizarse.
const SEGOLIFE_LOGO_FALLBACK = "/icons/segolife-icon.svg";

const DEFAULT_MESSAGE =
  "Aviso importante\n\n" +
  "Servicio temporalmente no disponible\n\n" +
  "Estamos realizando tareas de mantenimiento. Vuelve a intentarlo en unos minutos.\n\n" +
  "Gracias por tu paciencia.";

function splitMessage(message: string) {
  const blocks = message.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length >= 3) {
    const [eyebrow, headline, ...body] = blocks;
    return { eyebrow, headline, body };
  }
  if (blocks.length === 2) {
    const [headline, ...body] = blocks;
    return { eyebrow: null, headline, body };
  }
  return { eyebrow: null, headline: blocks[0] ?? DEFAULT_MESSAGE, body: [] as string[] };
}

export default function MaintenanceNotice({ message }: { message?: string | null }) {
  const { data: publicSettings } = trpc.config.getPublicSettings.useQuery();
  const brandLogo = publicSettings?.segolife_brand_logo_url || SEGOLIFE_LOGO_FALLBACK;
  const brandName = publicSettings?.segolife_brand_name || "SEGOLIFE";
  const { eyebrow, headline, body } = splitMessage(message?.trim() || DEFAULT_MESSAGE);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4 py-16">
      <div className="max-w-lg w-full text-center">
        <img src={brandLogo} alt={brandName} className="h-16 w-16 object-contain rounded-full mx-auto mb-6" />

        <div className="flex justify-center mb-4">
          <div className="p-3 rounded-full bg-amber-500/10">
            <Wrench className="h-7 w-7 text-amber-500" />
          </div>
        </div>

        {eyebrow && (
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400 mb-2">
            {eyebrow}
          </p>
        )}

        <h1 className="text-2xl font-bold text-foreground mb-4">{headline}</h1>

        <div className="space-y-3">
          {body.map((paragraph, i) => (
            <p key={i} className="text-muted-foreground whitespace-pre-line leading-relaxed">
              {paragraph}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
