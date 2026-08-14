/**
 * AdminDashboard.tsx — SEGOLIFE ADMIN COMMAND CENTER (spec Fase 15).
 * REEMPLAZA por completo el dashboard legado heredado de Náyade (Hotel/SPA/
 * Restaurantes/Leads/Presupuestos/CRM/Reservas/Cupones/Liquidaciones/Remesas
 * desaparecen de ESTA vista — sus módulos y rutas siguen existiendo, spec
 * §44 "NO borrar módulos legacy", solo dejan de tener presencia aquí).
 *
 * Cada widget se envuelve en su propio DashboardErrorBoundary (spec §32):
 * un módulo que falla nunca rompe el resto del panel. Un único filtro
 * global (Comunidad + Rango) alimenta a todos los widgets (spec §5/§33).
 */
import AdminLayout from "@/components/AdminLayout";
import { DashboardErrorBoundary } from "@/components/segolife/dashboard/DashboardErrorBoundary";
import { DashboardFilterBar } from "@/components/segolife/dashboard/DashboardFilterBar";
import { useDashboardFilters } from "@/components/segolife/dashboard/useDashboardFilters";
import { CommandCenterHeader } from "@/components/segolife/dashboard/CommandCenterHeader";
import { SegolifeLive } from "@/components/segolife/dashboard/SegolifeLive";
import { CommunityPulse } from "@/components/segolife/dashboard/CommunityPulse";
import { StudentIntelligence } from "@/components/segolife/dashboard/StudentIntelligence";
import { EventPerformance } from "@/components/segolife/dashboard/EventPerformance";
import { VenuePerformance } from "@/components/segolife/dashboard/VenuePerformance";
import { FourvenuesHealth } from "@/components/segolife/dashboard/FourvenuesHealth";
import { LoyaltyAndBenefits } from "@/components/segolife/dashboard/LoyaltyAndBenefits";
import { PlanAndPlayAndFunnel } from "@/components/segolife/dashboard/PlanAndPlayAndFunnel";
import { ActionCenterAndHealth } from "@/components/segolife/dashboard/ActionCenterAndHealth";

export default function AdminDashboard() {
  const { communityId, setCommunityId, range, setRange, queryInput, communities } = useDashboardFilters();

  return (
    <AdminLayout title="Command Center">
      <div className="space-y-6 max-w-[1680px] mx-auto">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="flex-1 min-w-0">
            <DashboardErrorBoundary moduleName="Cabecera">
              <CommandCenterHeader filters={queryInput} />
            </DashboardErrorBoundary>
          </div>
          <div className="shrink-0">
            <DashboardFilterBar communityId={communityId} onCommunityChange={setCommunityId} range={range} onRangeChange={setRange} communities={communities} />
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <DashboardErrorBoundary moduleName="Segolife Live">
            <SegolifeLive filters={queryInput} />
          </DashboardErrorBoundary>
          <DashboardErrorBoundary moduleName="Community Pulse">
            <CommunityPulse filters={queryInput} />
          </DashboardErrorBoundary>
        </div>

        <DashboardErrorBoundary moduleName="Student Intelligence">
          <StudentIntelligence filters={queryInput} />
        </DashboardErrorBoundary>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <DashboardErrorBoundary moduleName="Event Performance">
            <EventPerformance filters={queryInput} />
          </DashboardErrorBoundary>
          <DashboardErrorBoundary moduleName="Venue Performance">
            <VenuePerformance filters={queryInput} />
          </DashboardErrorBoundary>
        </div>

        <DashboardErrorBoundary moduleName="Fourvenues Health">
          <FourvenuesHealth />
        </DashboardErrorBoundary>

        <DashboardErrorBoundary moduleName="Loyalty y Benefits">
          <LoyaltyAndBenefits filters={queryInput} />
        </DashboardErrorBoundary>

        <DashboardErrorBoundary moduleName="Comunity y Funnel">
          <PlanAndPlayAndFunnel filters={queryInput} />
        </DashboardErrorBoundary>

        <DashboardErrorBoundary moduleName="Action Center">
          <ActionCenterAndHealth filters={queryInput} />
        </DashboardErrorBoundary>
      </div>
    </AdminLayout>
  );
}
