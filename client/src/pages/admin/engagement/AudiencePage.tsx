import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { Users } from "lucide-react";
import { AudienceFilterBuilder, EMPTY_AUDIENCE_FORM } from "@/components/admin/engagement/AudienceFilterBuilder";

/**
 * Exploración de audiencia — /admin/engagement/audience (Fase 7, spec punto
 * 69). Herramienta de solo consulta: deja probar combinaciones de filtros y
 * ver el conteo estimado antes de comprometerse a crear una campaña — nunca
 * devuelve una lista masiva de emails/PII, solo el conteo.
 */
export default function AudiencePage() {
  const [audience, setAudience] = useState(EMPTY_AUDIENCE_FORM);

  return (
    <AdminLayout title="Audiencia">
      <div className="max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-foreground">Explorar audiencia</h2>
            <p className="text-sm text-muted-foreground">Prueba combinaciones de filtros y ve el conteo estimado — sin crear ninguna campaña.</p>
          </div>
        </div>
        <AudienceFilterBuilder value={audience} onChange={setAudience} />
      </div>
    </AdminLayout>
  );
}
