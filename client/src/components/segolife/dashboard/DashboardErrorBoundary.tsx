/**
 * DashboardErrorBoundary.tsx — spec §32: un widget que falla NUNCA rompe el
 * resto de /admin. Cada módulo del Command Center se envuelve individualmente.
 */
import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props { moduleName: string; children: ReactNode }
interface State { hasError: boolean }

export class DashboardErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[Command Center] Error en el widget "${this.props.moduleName}":`, error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 flex flex-col items-center justify-center gap-2 text-center min-h-[120px]">
          <AlertTriangle className="w-5 h-5 text-rose-500" />
          <p className="text-xs font-semibold text-rose-500">No se pudo cargar "{this.props.moduleName}"</p>
          <p className="text-[11px] text-muted-foreground/60">El resto del panel sigue funcionando con normalidad.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
