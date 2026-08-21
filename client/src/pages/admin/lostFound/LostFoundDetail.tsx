import { useParams, Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import LostFoundCaseDetail from "@/components/admin/lostFound/LostFoundCaseDetail";
import { ArrowLeft } from "lucide-react";

/**
 * LNF-01 — /admin/lost-found/:id. Envoltorio de AdminLayout sobre el
 * componente compartido LostFoundCaseDetail (mismo componente que usa la
 * pestaña de la Venue App) — este archivo solo aporta el layout y el "volver
 * al listado" del Global Admin.
 */
export default function LostFoundDetail() {
  const { id } = useParams<{ id: string }>();
  const reportId = Number(id);

  return (
    <AdminLayout>
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <Link href="/admin/lost-found" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Objetos perdidos
        </Link>
        <LostFoundCaseDetail reportId={reportId} />
      </div>
    </AdminLayout>
  );
}
