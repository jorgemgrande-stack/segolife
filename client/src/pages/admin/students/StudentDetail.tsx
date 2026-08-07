import { useState } from "react";
import { useParams, useLocation } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  ArrowLeft, Loader2, GraduationCap, MapPin, Tag as TagIcon,
  StickyNote, Sparkles, Plus, X,
} from "lucide-react";

function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "");
}

function Field({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">
        {value === null || value === undefined || value === "" ? <span className="text-muted-foreground/50">—</span> : value}
      </span>
    </div>
  );
}

/** Estructura preparada para módulos futuros — sin datos inventados. */
function FutureModulePlaceholder({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground border border-dashed border-border rounded-lg justify-center">
      <Sparkles className="w-4 h-4" />
      {label} — todavía no implementado en esta fase
    </div>
  );
}

export default function StudentDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const studentProfileId = Number(params.id);
  const utils = trpc.useUtils();
  const [newNote, setNewNote] = useState("");
  const [tagToAdd, setTagToAdd] = useState<string>("");

  const { data: student, isLoading, error } = trpc.students.getById.useQuery({ id: studentProfileId });
  const { data: notes } = trpc.students.listNotes.useQuery({ studentProfileId }, { enabled: !!studentProfileId });
  const { data: allTags } = trpc.students.listTags.useQuery();

  const updateStatus = trpc.students.updateAdminFields.useMutation({
    onSuccess: () => { toast.success("Estado actualizado"); utils.students.getById.invalidate({ id: studentProfileId }); utils.students.list.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const addNote = trpc.students.addNote.useMutation({
    onSuccess: () => { setNewNote(""); toast.success("Nota añadida"); utils.students.listNotes.invalidate({ studentProfileId }); },
    onError: e => toast.error(e.message),
  });
  const assignTag = trpc.students.assignTag.useMutation({
    onSuccess: () => { setTagToAdd(""); utils.students.getById.invalidate({ id: studentProfileId }); },
    onError: e => toast.error(e.message),
  });
  const unassignTag = trpc.students.unassignTag.useMutation({
    onSuccess: () => utils.students.getById.invalidate({ id: studentProfileId }),
    onError: e => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <AdminLayout title="Estudiante">
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      </AdminLayout>
    );
  }

  if (error || !student) {
    return (
      <AdminLayout title="Estudiante">
        <div className="py-16 text-center text-sm text-destructive">{error?.message ?? "Estudiante no encontrado"}</div>
      </AdminLayout>
    );
  }

  const assignedTagIds = new Set(student.tags.map(t => t.id));
  const availableTags = (allTags ?? []).filter(t => !assignedTagIds.has(t.id));
  const fullName = [student.profile.firstName, student.profile.lastName].filter(Boolean).join(" ") || student.user.name;

  return (
    <AdminLayout title="Estudiante">
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin/students")} className="gap-1 -ml-2">
          <ArrowLeft className="w-4 h-4" /> Volver al listado
        </Button>

        {/* ── RESUMEN ── */}
        <div className="flex items-start gap-4 bg-card border border-border rounded-lg p-5">
          <Avatar className="w-16 h-16">
            <AvatarImage src={student.user.avatarUrl ?? undefined} />
            <AvatarFallback className="text-lg">{initials(fullName)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-semibold text-foreground">{fullName || "(sin nombre)"}</h2>
              {!student.profile.profileCompleted && <Badge variant="outline">Perfil incompleto</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">{student.user.email ?? "—"}</p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {student.university && <Badge variant="secondary"><GraduationCap className="w-3 h-3 mr-1" />{student.university.name}</Badge>}
              {student.communities.map(c => <Badge key={c.id} variant="secondary">{c.name}</Badge>)}
              {student.profile.nationality && <Badge variant="outline">{student.profile.nationality}</Badge>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Estado</span>
            <Select
              value={student.profile.status}
              onValueChange={v => updateStatus.mutate({ studentProfileId, status: v as "active" | "inactive" })}
            >
              <SelectTrigger className="w-[130px] h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Activo</SelectItem>
                <SelectItem value="inactive">Inactivo</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">Alta: {fmtDate(student.profile.createdAt)}</span>
          </div>
        </div>

        <Tabs defaultValue="personal">
          <TabsList>
            <TabsTrigger value="personal">Datos personales</TabsTrigger>
            <TabsTrigger value="academico">Datos académicos</TabsTrigger>
            <TabsTrigger value="estancia">Estancia en Segovia</TabsTrigger>
            <TabsTrigger value="comunidades">Comunidades</TabsTrigger>
            <TabsTrigger value="etiquetas">Etiquetas</TabsTrigger>
            <TabsTrigger value="notas">Notas internas</TabsTrigger>
            <TabsTrigger value="futuro">Próximamente</TabsTrigger>
          </TabsList>

          <TabsContent value="personal" className="bg-card border border-border rounded-lg p-5 grid grid-cols-2 md:grid-cols-3 gap-4">
            <Field label="Nombre" value={student.profile.firstName} />
            <Field label="Apellidos" value={student.profile.lastName} />
            <Field label="Email" value={student.user.email} />
            <Field label="Teléfono" value={student.user.phone} />
            <Field label="Fecha de nacimiento" value={student.profile.dateOfBirth} />
            <Field label="Nacionalidad" value={student.profile.nationality} />
            <Field label="País de origen" value={student.profile.countryOfOrigin} />
            <Field label="Idioma preferido" value={student.profile.preferredLocale?.toUpperCase()} />
          </TabsContent>

          <TabsContent value="academico" className="bg-card border border-border rounded-lg p-5 grid grid-cols-2 md:grid-cols-3 gap-4">
            <Field label="Universidad" value={student.university?.name} />
            <Field label="Programa / grado" value={student.profile.degreeProgram} />
            <Field label="Curso académico" value={student.profile.academicYear} />
          </TabsContent>

          <TabsContent value="estancia" className="bg-card border border-border rounded-lg p-5 grid grid-cols-2 md:grid-cols-3 gap-4">
            <Field label="Fecha de llegada" value={student.profile.arrivalDate} />
            <Field label="Fecha prevista de salida" value={student.profile.expectedDepartureDate} />
            <Field label="Ciudad" value={student.profile.city} />
            <Field label="Código postal" value={student.profile.postalCode} />
            <Field label={<span className="flex items-center gap-1"><MapPin className="w-3 h-3" />Dirección (privada, no pública)</span>} value={student.profile.addressLine} />
          </TabsContent>

          <TabsContent value="comunidades" className="bg-card border border-border rounded-lg p-5">
            {student.communities.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin comunidades asignadas todavía.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {student.communities.map(c => (
                  <Badge key={c.id} variant="secondary" className="text-sm py-1.5 px-3">{c.name} · {c.slug}</Badge>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="etiquetas" className="bg-card border border-border rounded-lg p-5 space-y-4">
            <div className="flex flex-wrap gap-2">
              {student.tags.length === 0 && <p className="text-sm text-muted-foreground">Sin etiquetas.</p>}
              {student.tags.map(t => (
                <Badge key={t.id} variant="secondary" className="gap-1 py-1 px-2">
                  <TagIcon className="w-3 h-3" style={t.color ? { color: t.color } : undefined} />
                  {t.name}
                  <button onClick={() => unassignTag.mutate({ studentProfileId, tagId: t.id })} className="ml-1 hover:text-destructive">
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
            {availableTags.length > 0 && (
              <div className="flex items-center gap-2">
                <Select value={tagToAdd} onValueChange={setTagToAdd}>
                  <SelectTrigger className="w-[220px]"><SelectValue placeholder="Añadir etiqueta…" /></SelectTrigger>
                  <SelectContent>
                    {availableTags.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!tagToAdd || assignTag.isPending}
                  onClick={() => assignTag.mutate({ studentProfileId, tagId: Number(tagToAdd) })}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="notas" className="bg-card border border-border rounded-lg p-5 space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Añadir una nota interna…"
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && newNote.trim()) addNote.mutate({ studentProfileId, note: newNote.trim() }); }}
              />
              <Button
                size="sm"
                disabled={!newNote.trim() || addNote.isPending}
                onClick={() => addNote.mutate({ studentProfileId, note: newNote.trim() })}
              >
                <StickyNote className="w-4 h-4" />
              </Button>
            </div>
            <div className="space-y-2">
              {(notes ?? []).length === 0 && <p className="text-sm text-muted-foreground">Sin notas todavía.</p>}
              {(notes ?? []).map(n => (
                <div key={n.id} className="text-sm bg-accent/40 rounded-md p-3">
                  <p className="text-foreground">{n.note}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{fmtDate(n.createdAt)}</p>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="futuro" className="space-y-3">
            <FutureModulePlaceholder label="Actividad (frecuencia/recurrencia)" />
            <FutureModulePlaceholder label="SegoTokens" />
            <FutureModulePlaceholder label="Beneficios" />
            <FutureModulePlaceholder label="Eventos" />
            <FutureModulePlaceholder label="Gasto" />
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
