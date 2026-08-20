import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

interface DeleteEventDialogProps {
  event: { id: number; name: string; startsAt: Date | string; venueName: string | null } | null;
  onClose: () => void;
  onDeleted: () => void;
}

function fmtDate(d: Date | string) {
  return new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * FIX-06 — confirmación explícita de borrado (spec §14/§15), compartida
 * entre EventsManager (fila) y EventDetail (ficha) para no duplicar el
 * mensaje de bloqueo ni el patrón de interacción. El servidor
 * (events.delete) es la única fuente de verdad sobre si el borrado es
 * seguro — este diálogo nunca decide localmente si un evento "parece"
 * borrable, solo muestra el resultado real (éxito o el motivo de bloqueo
 * devuelto por EventDeleteBlockedError).
 */
export function DeleteEventDialog({ event, onClose, onDeleted }: DeleteEventDialogProps) {
  const deleteMut = trpc.events.delete.useMutation({
    onSuccess: () => { toast.success("Evento eliminado"); onDeleted(); onClose(); },
    onError: e => toast.error(e.message),
  });

  return (
    <Dialog open={event !== null} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive"><Trash2 className="size-4" /> ¿Eliminar este evento?</DialogTitle>
        </DialogHeader>
        {event && (
          <div className="space-y-3 py-2">
            <div className="bg-secondary/50 rounded-lg p-3 text-sm">
              <p className="font-medium text-foreground">{event.name}</p>
              <p className="text-muted-foreground">{fmtDate(event.startsAt)}{event.venueName ? ` · ${event.venueName}` : ""}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              Esta acción es permanente. Solo es posible eliminar eventos manuales sin entradas, pedidos, asistencia ni
              integraciones vinculadas — si el evento tiene actividad real, se bloqueará y te sugeriremos ocultarlo en su lugar.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={deleteMut.isPending}>Cancelar</Button>
          <Button
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={!event || deleteMut.isPending}
            onClick={() => event && deleteMut.mutate({ id: event.id })}
          >
            Eliminar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
