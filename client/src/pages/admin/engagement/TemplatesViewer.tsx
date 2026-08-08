import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText } from "lucide-react";

/**
 * Catálogo de plantillas de sistema — /admin/engagement/templates (Fase 7,
 * spec punto 78). Solo lectura: la gestión real vive en código/versionado
 * (server/segolife/engagement/templates.ts), nunca en esta tabla/pantalla.
 */
export default function TemplatesViewer() {
  const { data: templates, isLoading } = trpc.engagement.listTemplates.useQuery();

  return (
    <AdminLayout title="Plantillas de Engagement">
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <FileText className="w-6 h-6 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-foreground">Plantillas del sistema</h2>
            <p className="text-sm text-muted-foreground">Definidas en código y versionadas por commit — no editables desde aquí.</p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {(templates ?? []).map(t => (
              <div key={t.key} className="rounded-lg border border-border bg-card p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-medium text-foreground">{t.key}</span>
                  <Badge variant="outline">v{t.version}</Badge>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary">{t.category}</Badge>
                  <Badge variant={t.audienceType === "transactional" ? "default" : "secondary"}>{t.audienceType}</Badge>
                  {t.channels.map(c => <Badge key={c} variant="outline">{c}</Badge>)}
                </div>
                <div className="text-sm">
                  <p className="text-muted-foreground">EN: <span className="text-foreground">{t.titleEn}</span> — {t.bodyEn}</p>
                  <p className="text-muted-foreground">ES: <span className="text-foreground">{t.titleEs}</span> — {t.bodyEs}</p>
                </div>
                {t.allowedVariables.length > 0 && (
                  <p className="text-xs text-muted-foreground">Variables: {t.allowedVariables.map(v => `{{${v}}}`).join(", ")}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
