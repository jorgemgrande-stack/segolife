import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Pencil, Eye, EyeOff, Trash2, AlertTriangle, MessageCircle } from "lucide-react";

/**
 * STU-01 — diálogos de ciclo de vida del Student (Editar / Ocultar-Mostrar /
 * Borrar), compartidos entre StudentsManager (fila) y StudentDetail (ficha)
 * — mismo patrón que DeleteEventDialog (FIX-06): un único componente
 * reutilizado desde las dos superficies para que NUNCA diverjan en qué
 * llaman ni en qué muestran. Cada diálogo recibe solo `studentProfileId` y
 * resuelve internamente los datos que necesita mostrar (vía
 * students.getById), en vez de exigir que cada superficie le pase distintos
 * subconjuntos de campos ya cargados.
 */

interface BaseDialogProps {
  studentProfileId: number | null;
  onClose: () => void;
  onSuccess?: () => void;
}

// ─── Editar ─────────────────────────────────────────────────────────────────

type EditFormState = {
  firstName: string; lastName: string; email: string; phone: string;
  dateOfBirth: string; nationality: string; countryOfOrigin: string;
  degreeProgram: string; academicYear: string;
  arrivalDate: string; expectedDepartureDate: string;
  addressLine: string; postalCode: string; city: string;
};

const EMPTY_FORM: EditFormState = {
  firstName: "", lastName: "", email: "", phone: "",
  dateOfBirth: "", nationality: "", countryOfOrigin: "",
  degreeProgram: "", academicYear: "",
  arrivalDate: "", expectedDepartureDate: "",
  addressLine: "", postalCode: "", city: "",
};

export function EditStudentDialog({ studentProfileId, onClose, onSuccess }: BaseDialogProps) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<EditFormState>(EMPTY_FORM);
  const { data: student, isLoading } = trpc.students.getById.useQuery(
    { id: studentProfileId ?? 0 },
    { enabled: studentProfileId !== null }
  );

  useEffect(() => {
    if (!student) return;
    setForm({
      firstName: student.profile.firstName ?? "",
      lastName: student.profile.lastName ?? "",
      email: student.user.email ?? "",
      phone: student.user.phone ?? "",
      dateOfBirth: student.profile.dateOfBirth ?? "",
      nationality: student.profile.nationality ?? "",
      countryOfOrigin: student.profile.countryOfOrigin ?? "",
      degreeProgram: student.profile.degreeProgram ?? "",
      academicYear: student.profile.academicYear ?? "",
      arrivalDate: student.profile.arrivalDate ?? "",
      expectedDepartureDate: student.profile.expectedDepartureDate ?? "",
      addressLine: student.profile.addressLine ?? "",
      postalCode: student.profile.postalCode ?? "",
      city: student.profile.city ?? "",
    });
  }, [student]);

  const updateMut = trpc.students.adminUpdateProfile.useMutation({
    onSuccess: () => {
      toast.success("Estudiante actualizado");
      if (studentProfileId !== null) {
        utils.students.getById.invalidate({ id: studentProfileId });
        utils.students360.getAdminActivity.invalidate({ studentProfileId });
      }
      utils.students.list.invalidate();
      onSuccess?.();
      onClose();
    },
    onError: e => toast.error(e.message),
  });

  const set = <K extends keyof EditFormState>(key: K, value: string) => setForm(f => ({ ...f, [key]: value }));

  const handleSubmit = () => {
    if (studentProfileId === null) return;
    updateMut.mutate({
      studentProfileId,
      firstName: form.firstName.trim() || null,
      lastName: form.lastName.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      dateOfBirth: form.dateOfBirth.trim() || null,
      nationality: form.nationality.trim().toUpperCase() || null,
      countryOfOrigin: form.countryOfOrigin.trim().toUpperCase() || null,
      degreeProgram: form.degreeProgram.trim() || null,
      academicYear: form.academicYear.trim() || null,
      arrivalDate: form.arrivalDate.trim() || null,
      expectedDepartureDate: form.expectedDepartureDate.trim() || null,
      addressLine: form.addressLine.trim() || null,
      postalCode: form.postalCode.trim() || null,
      city: form.city.trim() || null,
    });
  };

  return (
    <Dialog open={studentProfileId !== null} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Pencil className="size-4" /> Editar estudiante</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              Comunidad, universidad como relación, rol, SegoTokens, tickets y datos de autenticación no se editan desde
              aquí — cada uno tiene su propio flujo o está fuera de alcance por seguridad.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="stu-edit-firstName">Nombre</Label><Input id="stu-edit-firstName" value={form.firstName} onChange={e => set("firstName", e.target.value)} maxLength={128} /></div>
              <div><Label htmlFor="stu-edit-lastName">Apellidos</Label><Input id="stu-edit-lastName" value={form.lastName} onChange={e => set("lastName", e.target.value)} maxLength={128} /></div>
              <div><Label htmlFor="stu-edit-email">Email</Label><Input id="stu-edit-email" type="email" value={form.email} onChange={e => set("email", e.target.value)} maxLength={320} /></div>
              <div><Label htmlFor="stu-edit-phone">Teléfono</Label><Input id="stu-edit-phone" value={form.phone} onChange={e => set("phone", e.target.value)} maxLength={32} /></div>
              <div><Label htmlFor="stu-edit-dob">Fecha de nacimiento</Label><Input id="stu-edit-dob" placeholder="YYYY-MM-DD" value={form.dateOfBirth} onChange={e => set("dateOfBirth", e.target.value)} maxLength={10} /></div>
              <div><Label htmlFor="stu-edit-nationality">Nacionalidad</Label><Input id="stu-edit-nationality" placeholder="ES" value={form.nationality} onChange={e => set("nationality", e.target.value.slice(0, 2))} maxLength={2} /></div>
              <div><Label htmlFor="stu-edit-country">País de origen</Label><Input id="stu-edit-country" placeholder="ES" value={form.countryOfOrigin} onChange={e => set("countryOfOrigin", e.target.value.slice(0, 2))} maxLength={2} /></div>
              <div><Label htmlFor="stu-edit-degree">Programa / grado</Label><Input id="stu-edit-degree" value={form.degreeProgram} onChange={e => set("degreeProgram", e.target.value)} maxLength={256} /></div>
              <div><Label htmlFor="stu-edit-year">Curso académico</Label><Input id="stu-edit-year" value={form.academicYear} onChange={e => set("academicYear", e.target.value)} maxLength={32} /></div>
              <div><Label htmlFor="stu-edit-arrival">Fecha de llegada</Label><Input id="stu-edit-arrival" placeholder="YYYY-MM-DD" value={form.arrivalDate} onChange={e => set("arrivalDate", e.target.value)} maxLength={10} /></div>
              <div><Label htmlFor="stu-edit-departure">Fecha prevista de salida</Label><Input id="stu-edit-departure" placeholder="YYYY-MM-DD" value={form.expectedDepartureDate} onChange={e => set("expectedDepartureDate", e.target.value)} maxLength={10} /></div>
              <div><Label htmlFor="stu-edit-city">Ciudad</Label><Input id="stu-edit-city" value={form.city} onChange={e => set("city", e.target.value)} maxLength={128} /></div>
              <div><Label htmlFor="stu-edit-postal">Código postal</Label><Input id="stu-edit-postal" value={form.postalCode} onChange={e => set("postalCode", e.target.value)} maxLength={16} /></div>
              <div className="col-span-2"><Label htmlFor="stu-edit-address">Dirección (privada)</Label><Input id="stu-edit-address" value={form.addressLine} onChange={e => set("addressLine", e.target.value)} maxLength={256} /></div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={updateMut.isPending}>Cancelar</Button>
          <Button disabled={isLoading || updateMut.isPending} onClick={handleSubmit}>
            {updateMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Guardar cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Ocultar / Mostrar ──────────────────────────────────────────────────────
// Reutiliza EXACTAMENTE el mismo mecanismo que StatusChangeControl
// (students.updateAdminFields, student_profiles.status) — nunca un
// isHidden nuevo. "Oculto" = active/inactive administrativo, sin relación
// con users.isActive (login), spec §10-13.

export function HideStudentDialog({ studentProfileId, onClose, onSuccess }: BaseDialogProps) {
  const utils = trpc.useUtils();
  const [reason, setReason] = useState("");
  const { data: student } = trpc.students.getById.useQuery(
    { id: studentProfileId ?? 0 },
    { enabled: studentProfileId !== null }
  );

  const updateStatus = trpc.students.updateAdminFields.useMutation({
    onSuccess: () => {
      toast.success("Estado actualizado");
      setReason("");
      if (studentProfileId !== null) utils.students.getById.invalidate({ id: studentProfileId });
      utils.students.list.invalidate();
      onSuccess?.();
      onClose();
    },
    onError: e => toast.error(e.message),
  });

  if (!student) return null;
  const willHide = student.profile.status === "active";
  const nextStatus = willHide ? "inactive" : "active";

  return (
    <Dialog open={studentProfileId !== null} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {willHide ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            {willHide ? "¿Ocultar este estudiante?" : "¿Mostrar este estudiante?"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="bg-secondary/50 rounded-lg p-3 text-sm">
            <p className="font-medium text-foreground">{[student.profile.firstName, student.profile.lastName].filter(Boolean).join(" ") || student.user.name || "(sin nombre)"}</p>
            <p className="text-muted-foreground">{student.user.email ?? "—"}</p>
          </div>
          <p className="text-sm text-muted-foreground">
            {willHide
              ? "El estudiante deja de aparecer en el listado por defecto. Su historial, SegoTokens, tickets y conversaciones permanecen intactos y puedes mostrarlo de nuevo cuando quieras."
              : "El estudiante vuelve a aparecer en el listado por defecto."}
          </p>
          <div>
            <Label htmlFor="stu-hide-reason">Motivo</Label>
            <Input id="stu-hide-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="Obligatorio…" autoFocus />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={updateStatus.isPending}>Cancelar</Button>
          <Button
            disabled={!reason.trim() || updateStatus.isPending}
            onClick={() => studentProfileId !== null && updateStatus.mutate({ studentProfileId, status: nextStatus, reason: reason.trim() })}
          >
            {updateStatus.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {willHide ? "Ocultar" : "Mostrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Borrar ─────────────────────────────────────────────────────────────────
// Nunca borra al primer clic — consulta elegibilidad real primero (spec
// §22): si hay bloqueos, se muestran los motivos reales y se recomienda
// Ocultar, sin ofrecer un botón de confirmación falso.

export function DeleteStudentDialog({ studentProfileId, onClose, onSuccess }: BaseDialogProps) {
  const utils = trpc.useUtils();
  const [reason, setReason] = useState("");
  const { data: student } = trpc.students.getById.useQuery(
    { id: studentProfileId ?? 0 },
    { enabled: studentProfileId !== null }
  );
  const { data: eligibility, isLoading: eligibilityLoading } = trpc.students.deleteEligibility.useQuery(
    { studentProfileId: studentProfileId ?? 0 },
    { enabled: studentProfileId !== null }
  );

  const deleteMut = trpc.students.delete.useMutation({
    onSuccess: () => {
      toast.success("Estudiante eliminado");
      setReason("");
      utils.students.list.invalidate();
      onSuccess?.();
      onClose();
    },
    onError: e => toast.error(e.message),
  });

  return (
    <Dialog open={studentProfileId !== null} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive"><Trash2 className="size-4" /> ¿Eliminar este estudiante?</DialogTitle>
        </DialogHeader>
        {(!student || eligibilityLoading) ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="bg-secondary/50 rounded-lg p-3 text-sm">
              <p className="font-medium text-foreground">{[student.profile.firstName, student.profile.lastName].filter(Boolean).join(" ") || student.user.name || "(sin nombre)"}</p>
              <p className="text-muted-foreground">{student.user.email ?? "—"}</p>
              {student.communities.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {student.communities.map(c => <Badge key={c.id} variant="secondary">{c.name}</Badge>)}
                </div>
              )}
            </div>
            {eligibility && !eligibility.canDelete ? (
              <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 space-y-1.5">
                <p className="text-sm font-medium text-destructive flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> No se puede eliminar</p>
                <ul className="text-sm text-muted-foreground list-disc list-inside">
                  {eligibility.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
                <p className="text-xs text-muted-foreground pt-1">Puedes ocultarlo provisionalmente en su lugar — su historial permanece intacto.</p>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Esta acción es permanente. Solo es posible porque esta cuenta no tiene ninguna actividad histórica
                  real (SegoTokens, tickets, asistencia, consumo, conversaciones, comunidad).
                </p>
                <div>
                  <Label htmlFor="stu-delete-reason">Motivo</Label>
                  <Input id="stu-delete-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="Obligatorio…" autoFocus />
                </div>
              </>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={deleteMut.isPending}>Cancelar</Button>
          {eligibility?.canDelete && (
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!reason.trim() || deleteMut.isPending || studentProfileId === null}
              onClick={() => studentProfileId !== null && deleteMut.mutate({ studentProfileId, reason: reason.trim() })}
            >
              {deleteMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Eliminar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Comunicarse (STU-02) ───────────────────────────────────────────────────
// COM-01 — abre una conversación bidireccional real (histórico persistente,
// el Student puede responder), a diferencia de "Enviar mensaje"
// (SendMessageDialog en StudentDetail.tsx) que sigue siendo un aviso de un
// solo sentido — ambos coexisten a propósito, no se sustituyen. Movido aquí
// desde StudentDetail.tsx (STU-02) para poder reutilizarlo también desde
// StudentsManager — mismo criterio "un único componente, nunca diverge"
// que el resto de este archivo.

interface ComunicarDialogProps {
  studentUserId: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function ComunicarDialog({ studentUserId, open, onOpenChange }: ComunicarDialogProps) {
  const [, navigate] = useLocation();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const createMut = trpc.studentMessages.adminCreateConversation.useMutation({
    onSuccess: (res) => {
      toast.success("Conversación iniciada");
      setSubject(""); setBody(""); onOpenChange(false);
      navigate(`/admin/students/messages/${res.conversation.id}`);
    },
    onError: e => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Comunicarse con el Student</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div><Label htmlFor="stu-comunicar-subject">Asunto</Label><Input id="stu-comunicar-subject" value={subject} onChange={e => setSubject(e.target.value)} maxLength={256} placeholder="Asunto de la conversación" /></div>
          <div><Label htmlFor="stu-comunicar-body">Mensaje</Label><Textarea id="stu-comunicar-body" rows={5} value={body} onChange={e => setBody(e.target.value)} maxLength={5000} placeholder="Escribe tu mensaje…" /></div>
          <p className="text-xs text-muted-foreground">El Student recibirá una notificación y podrá responder — el hilo queda guardado en Mensajes.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            disabled={!subject.trim() || !body.trim() || createMut.isPending}
            onClick={() => createMut.mutate({ studentUserId, subject: subject.trim(), body: body.trim() })}
          >
            {createMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MessageCircle className="w-4 h-4 mr-2" />}
            Iniciar conversación
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * STU-02 — lógica compartida del botón "Comunicarse": localiza LA
 * conversación general del Student (adminFindGeneralConversation, nunca
 * crea nada) y, si existe, navega directo a ese hilo exacto (abierto o
 * cerrado — StudentMessageDetail ya resuelve "reabrir" por su cuenta); si
 * no existe ninguna, abre ComunicarDialog para crear la primera. Esto es lo
 * que hace que pulsar "Comunicarse" varias veces nunca cree conversaciones
 * duplicadas: solo el envío del formulario de ComunicarDialog crea algo, y
 * esa creación es idempotente en el propio backend
 * (createGeneralConversationForStudent). Un único hook consumido desde la
 * fila del listado, la cabecera de la ficha, y la pestaña Engagement —
 * nunca 3 implementaciones distintas.
 */
export function useCommunicateAction(studentUserId: number) {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const [checking, setChecking] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const communicate = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const result = await utils.studentMessages.adminFindGeneralConversation.fetch({ studentUserId });
      if (result.conversationId) {
        navigate(`/admin/students/messages/${result.conversationId}`);
      } else {
        setDialogOpen(true);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo comprobar la conversación con este estudiante");
    } finally {
      setChecking(false);
    }
  };

  return { communicate, checking, dialogOpen, setDialogOpen };
}
