import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  UserPlus, MoreVertical, ShieldCheck, Store, UserCheck, UserX,
  Trash2, Send, CheckCircle, Clock, XCircle,
  KeyRound, Info, AlertTriangle, Star,
} from "lucide-react";
import { toast } from "sonner";

/**
 * SEGOLIFE — RBAC CONSOLIDATION (spec §58-61): /admin/usuarios pasa de un
 * selector de 6 roles heredados de Náyade (Agente Comercial, Monitor, Gestor
 * Restaurantes, Controler...) a exactamente los dos perfiles de staff reales
 * de SEGOLIFE. Los roles legacy NO se borran de BD (spec §10: "eliminar del
 * SELECTOR visible" — nunca destructivo) — un usuario que aún tenga uno de
 * esos roles se sigue mostrando correctamente vía el fallback genérico de
 * RoleBadge, simplemente ya no es asignable desde aquí. Students se excluyen
 * de este listado (spec §9): se gestionan en /admin/students.
 */
const ROLES = [
  {
    value: "admin",
    label: "Administrador general",
    description: "Acceso completo a SEGOLIFE",
    color: "bg-red-100 text-red-800 border-red-200",
    icon: ShieldCheck,
  },
  {
    value: "venue_admin",
    label: "Administrador de local",
    description: "Acceso solo a los locales asignados",
    color: "bg-violet-100 text-violet-800 border-violet-200",
    icon: Store,
  },
] as const;

type Role = (typeof ROLES)[number]["value"];

function RoleBadge({ role, isLastAdmin = false }: { role: string; isLastAdmin?: boolean }) {
  const r = ROLES.find((x) => x.value === role);
  if (!r) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-gray-100 text-gray-500 border-gray-200">
        {role} <span className="text-[9px] italic">(legacy)</span>
      </span>
    );
  }
  const Icon = r.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${r.color}`}>
      <Icon className="w-3 h-3 shrink-0" />
      {r.label}
      {isLastAdmin && (
        <span className="ml-0.5 text-[10px] font-bold text-red-700 bg-red-100 border border-red-300 rounded-full px-1">★</span>
      )}
    </span>
  );
}

function StatusBadge({ inviteAccepted, isActive }: { inviteAccepted: boolean; isActive: boolean }) {
  if (!isActive) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200">
        <XCircle className="w-3 h-3" /> Desactivado
      </span>
    );
  }
  if (inviteAccepted) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 border border-emerald-200">
        <CheckCircle className="w-3 h-3" /> Activo
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200">
      <Clock className="w-3 h-3" /> Invitación pendiente
    </span>
  );
}

/** Multi-select de venues — spec §8: obligatorio para Administrador de local, sin guardar sin al menos 1. */
function VenuePicker({
  venues, selected, onToggle,
}: {
  venues: Array<{ id: number; name: string }>;
  selected: Set<number>;
  onToggle: (venueId: number) => void;
}) {
  if (venues.length === 0) {
    return <p className="text-xs text-muted-foreground">No hay venues dados de alta todavía.</p>;
  }
  return (
    <div className="space-y-1.5 max-h-48 overflow-y-auto rounded-lg border border-border p-2.5">
      {venues.map((v) => (
        <label key={v.id} className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox checked={selected.has(v.id)} onCheckedChange={() => onToggle(v.id)} />
          {v.name}
        </label>
      ))}
    </div>
  );
}

export default function UsersManager() {
  const { user: currentUser } = useAuth();
  const utils = trpc.useUtils();

  const { data: allUsers = [], isLoading } = trpc.admin.getUsers.useQuery();
  const { data: venuesData } = trpc.venues.list.useQuery({ limit: 200 });
  const venues = useMemo(() => (venuesData?.items ?? []).map(v => ({ id: v.id, name: v.name })), [venuesData]);
  const { data: venueStaffRows = [] } = trpc.benefits.listVenueStaff.useQuery({});

  // Students se gestionan en /admin/students (spec §9) — esta pantalla es solo staff/admins.
  const users = useMemo(() => allUsers.filter((u) => u.role !== "user"), [allUsers]);

  const venuesByUser = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const row of venueStaffRows) {
      if (!row.active) continue;
      const list = map.get(row.userId) ?? [];
      list.push(row.venueId);
      map.set(row.userId, list);
    }
    return map;
  }, [venueStaffRows]);

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of ROLES) counts[r.value] = 0;
    for (const u of users) counts[u.role] = (counts[u.role] ?? 0) + 1;
    return counts;
  }, [users]);

  const activeAdminCount = useMemo(
    () => users.filter((u) => u.role === "admin" && u.isActive).length,
    [users]
  );

  // ─── Mutations ──────────────────────────────────────────────────────────────
  const createUser = trpc.admin.createUser.useMutation({
    onSuccess: async (data) => {
      utils.admin.getUsers.invalidate();
      if (data.id && form.role === "venue_admin" && pendingVenueIds.size > 0) {
        await Promise.all(
          Array.from(pendingVenueIds).map((venueId) => addVenueStaff.mutateAsync({ userId: data.id!, venueId }))
        );
        utils.benefits.listVenueStaff.invalidate();
      }
      setShowCreate(false);
      setForm({ name: "", email: "", role: "venue_admin" });
      setPendingVenueIds(new Set());
      toast.success("Usuario creado", { description: "Se ha enviado el email de invitación." });
    },
    onError: (e) => toast.error("Error", { description: e.message }),
  });

  const changeRole = trpc.admin.changeUserRole.useMutation({
    onSuccess: () => { utils.admin.getUsers.invalidate(); toast.success("Rol actualizado"); },
    onError: (e) => toast.error("Error", { description: e.message }),
  });

  const toggleActive = trpc.admin.toggleUserActive.useMutation({
    onSuccess: (data) => {
      utils.admin.getUsers.invalidate();
      toast.success(data.isActive ? "Usuario activado" : "Usuario desactivado");
    },
    onError: (e) => toast.error("Error", { description: e.message }),
  });

  const resendInvite = trpc.admin.resendInvite.useMutation({
    onSuccess: () => {
      utils.admin.getUsers.invalidate();
      toast.success("Invitación reenviada", { description: "Se ha enviado un nuevo enlace por email." });
    },
    onError: (e) => toast.error("Error", { description: e.message }),
  });

  const setUserPassword = trpc.admin.setUserPassword.useMutation({
    onSuccess: () => {
      setPasswordTarget(null);
      setNewPassword("");
      toast.success("Contraseña actualizada");
    },
    onError: (e) => toast.error("Error", { description: e.message }),
  });

  const deleteUser = trpc.admin.deleteUser.useMutation({
    onSuccess: () => {
      utils.admin.getUsers.invalidate();
      setDeleteTarget(null);
      toast.success("Usuario eliminado");
    },
    onError: (e) => toast.error("Error", { description: e.message }),
  });

  const addVenueStaff = trpc.benefits.addVenueStaff.useMutation();
  const removeVenueStaff = trpc.benefits.removeVenueStaff.useMutation({
    onSuccess: () => utils.benefits.listVenueStaff.invalidate(),
  });

  // ─── UI state ───────────────────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "venue_admin" as Role });
  const [pendingVenueIds, setPendingVenueIds] = useState<Set<number>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<{ id: number; name: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [venueEditTarget, setVenueEditTarget] = useState<{ id: number; name: string; pendingRole?: Role } | null>(null);
  const [venueEditSelection, setVenueEditSelection] = useState<Set<number>>(new Set());

  function openVenueEditor(userId: number, userName: string, currentVenueIds: number[], pendingRole?: Role) {
    setVenueEditTarget({ id: userId, name: userName, pendingRole });
    setVenueEditSelection(new Set(currentVenueIds));
  }

  async function saveVenueEditor() {
    if (!venueEditTarget) return;
    if (venueEditSelection.size === 0) {
      toast.error("Selecciona al menos un local", { description: "Un Administrador de local necesita al menos un venue asignado." });
      return;
    }
    const current = new Set(venuesByUser.get(venueEditTarget.id) ?? []);
    const toAdd = Array.from(venueEditSelection).filter((id) => !current.has(id));
    const toRemove = Array.from(current).filter((id) => !venueEditSelection.has(id));
    await Promise.all([
      ...toAdd.map((venueId) => addVenueStaff.mutateAsync({ userId: venueEditTarget.id, venueId })),
      ...toRemove.map((venueId) => removeVenueStaff.mutateAsync({ userId: venueEditTarget.id, venueId })),
    ]);
    utils.benefits.listVenueStaff.invalidate();
    if (venueEditTarget.pendingRole) {
      changeRole.mutate({ userId: venueEditTarget.id, role: venueEditTarget.pendingRole });
    }
    toast.success("Locales actualizados");
    setVenueEditTarget(null);
  }

  // ─── Guardia de cambio de rol (cliente — la guardia real es server-side, spec §33/§47) ──
  function handleRoleChange(targetUserId: number, targetUserName: string, targetUserRole: string, newRole: string) {
    if (newRole === targetUserRole) return;

    if (targetUserRole === "admin" && newRole !== "admin" && activeAdminCount <= 1) {
      toast.error("Operación bloqueada", {
        description: "No puedes cambiar el rol del único administrador general activo. Asigna primero otro.",
      });
      return;
    }

    if (newRole === "venue_admin") {
      // spec §8: no se puede guardar VENUE_ADMIN sin al menos un venue — abre el selector.
      openVenueEditor(targetUserId, targetUserName, venuesByUser.get(targetUserId) ?? [], "venue_admin");
      return;
    }

    changeRole.mutate({ userId: targetUserId, role: newRole as any });
  }

  const filteredUsers = useMemo(
    () => (roleFilter === "all" ? users : users.filter((u) => u.role === roleFilter)),
    [users, roleFilter]
  );

  const handleCreate = () => {
    if (!form.name.trim() || !form.email.trim()) {
      toast.error("Campos requeridos", { description: "Nombre y email son obligatorios." });
      return;
    }
    if (form.role === "venue_admin" && pendingVenueIds.size === 0) {
      toast.error("Selecciona al menos un local", { description: "Un Administrador de local necesita al menos un venue asignado." });
      return;
    }
    createUser.mutate({
      name: form.name,
      email: form.email,
      role: form.role,
      origin: window.location.origin,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">

        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Gestión de usuarios</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {users.length} administrador{users.length !== 1 ? "es" : ""} de plataforma. Los Students se gestionan en Estudiantes.
            </p>
          </div>
          <Button onClick={() => { setShowCreate(true); setForm({ name: "", email: "", role: "venue_admin" }); setPendingVenueIds(new Set()); }} className="bg-blue-700 hover:bg-blue-800 text-white gap-2">
            <UserPlus className="w-4 h-4" />
            Nuevo usuario
          </Button>
        </div>

        {/* ── Contadores por rol ── */}
        <div className="flex flex-wrap gap-2">
          {ROLES.filter((r) => roleCounts[r.value] > 0).map((r) => {
            const Icon = r.icon;
            const isActive = roleFilter === r.value;
            return (
              <button
                key={r.value}
                onClick={() => setRoleFilter(isActive ? "all" : r.value)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  isActive
                    ? `${r.color} shadow-sm ring-2 ring-offset-1 ring-current`
                    : `${r.color} hover:shadow-sm opacity-80 hover:opacity-100`
                }`}
              >
                <Icon className="w-3 h-3" />
                {r.label}
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-white/60 font-bold text-[10px]">
                  {roleCounts[r.value]}
                </span>
              </button>
            );
          })}
          {roleFilter !== "all" && (
            <button
              onClick={() => setRoleFilter("all")}
              className="text-xs text-gray-400 hover:text-gray-600 px-2 underline underline-offset-2"
            >
              Ver todos
            </button>
          )}
        </div>

        {/* ── Aviso si queda solo 1 admin general ── */}
        {activeAdminCount === 1 && (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
            <span>
              Solo hay <strong>1 administrador general activo</strong>. No podrás cambiar su rol hasta que haya al menos otro.
            </span>
          </div>
        )}

        {/* ── Table ── */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Nombre</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Rol</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Locales</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Estado</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Registrado</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => {
                const isLastAdmin = user.role === "admin" && activeAdminCount <= 1;
                const isSelf = currentUser?.id === user.id;
                const userVenueIds = venuesByUser.get(user.id) ?? [];
                const userVenueNames = userVenueIds
                  .map((id) => venues.find((v) => v.id === id)?.name)
                  .filter(Boolean);

                return (
                  <tr key={user.id} className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${!user.isActive ? "opacity-60" : ""}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0 ${
                          user.role === "admin" ? "bg-gradient-to-br from-red-500 to-red-700"
                          : user.role === "venue_admin" ? "bg-gradient-to-br from-violet-500 to-violet-700"
                          : "bg-gradient-to-br from-gray-400 to-gray-600"
                        }`}>
                          {(user.name ?? user.email ?? "?").charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5 font-medium text-gray-900">
                            {user.name ?? "—"}
                            {isSelf && (
                              <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-1.5 py-0.5">
                                Tú
                              </span>
                            )}
                          </div>
                          <div className="text-gray-500 text-xs">{user.email ?? "—"}</div>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <Select
                        value={user.role}
                        onValueChange={(value) => handleRoleChange(user.id, user.name ?? user.email ?? "Usuario", user.role, value)}
                        disabled={isLastAdmin && isSelf}
                      >
                        <SelectTrigger className="w-auto h-7 text-xs border-0 bg-transparent p-0 focus:ring-0 focus:ring-offset-0 gap-1">
                          <SelectValue>
                            <RoleBadge role={user.role} isLastAdmin={isLastAdmin} />
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="w-72">
                          {ROLES.map((r) => (
                            <SelectItem
                              key={r.value}
                              value={r.value}
                              disabled={r.value !== "admin" && isLastAdmin && user.role === "admin"}
                            >
                              <div className="flex items-center gap-2 py-1">
                                <RoleBadge role={r.value} />
                                <span className="text-xs text-muted-foreground">{r.description}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {isLastAdmin && (
                        <p className="text-[10px] text-amber-600 flex items-center gap-1 mt-1">
                          <Star className="w-2.5 h-2.5" />
                          Único administrador activo
                        </p>
                      )}
                    </td>

                    {/* Locales */}
                    <td className="px-4 py-3">
                      {user.role === "venue_admin" ? (
                        <button
                          onClick={() => openVenueEditor(user.id, user.name ?? user.email ?? "Usuario", userVenueIds)}
                          className="flex items-center gap-1 text-xs text-violet-700 hover:text-violet-900 font-medium"
                        >
                          <Store className="w-3 h-3" />
                          {userVenueNames.length > 0 ? userVenueNames.join(", ") : (
                            <span className="text-amber-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Sin locales — asignar</span>
                          )}
                        </button>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <StatusBadge inviteAccepted={Boolean(user.inviteAccepted)} isActive={Boolean(user.isActive)} />
                    </td>

                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {user.createdAt
                        ? new Date(user.createdAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })
                        : "—"}
                    </td>

                    <td className="px-4 py-3 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          {!user.inviteAccepted && (
                            <DropdownMenuItem
                              onClick={() => resendInvite.mutate({ userId: user.id, email: user.email ?? "", name: user.name ?? "", role: user.role, origin: window.location.origin })}
                              className="gap-2"
                            >
                              <Send className="w-4 h-4 text-blue-600" />
                              Reenviar invitación
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={() => { setPasswordTarget({ id: user.id, name: user.name ?? user.email ?? "este usuario" }); setNewPassword(""); }}
                            className="gap-2"
                          >
                            <KeyRound className="w-4 h-4 text-violet-600" />
                            Cambiar contraseña
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => toggleActive.mutate({ userId: user.id })}
                            disabled={isLastAdmin}
                            className="gap-2"
                          >
                            {user.isActive ? (
                              <><UserX className="w-4 h-4 text-amber-600" />Desactivar usuario</>
                            ) : (
                              <><UserCheck className="w-4 h-4 text-green-600" />Activar usuario</>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setDeleteTarget({ id: user.id, name: user.name ?? user.email ?? "este usuario" })}
                            disabled={isSelf || isLastAdmin}
                            className="gap-2 text-red-600 focus:text-red-600"
                          >
                            <Trash2 className="w-4 h-4" />
                            Eliminar usuario
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                    {roleFilter !== "all"
                      ? `No hay usuarios con el rol "${ROLES.find((r) => r.value === roleFilter)?.label ?? roleFilter}".`
                      : "No hay usuarios de staff registrados aún."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Venue assignment dialog (create + edit) ── */}
        <Dialog open={!!venueEditTarget} onOpenChange={(open) => { if (!open) setVenueEditTarget(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Store className="w-5 h-5 text-violet-600" />
                Locales asignados — {venueEditTarget?.name}
              </DialogTitle>
            </DialogHeader>
            <div className="py-2 space-y-2">
              <p className="text-xs text-muted-foreground">Un Administrador de local solo puede operar en los locales marcados aquí.</p>
              <VenuePicker
                venues={venues}
                selected={venueEditSelection}
                onToggle={(id) => setVenueEditSelection((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id); else next.add(id);
                  return next;
                })}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setVenueEditTarget(null)}>Cancelar</Button>
              <Button onClick={saveVenueEditor} disabled={addVenueStaff.isPending || removeVenueStaff.isPending} className="bg-violet-600 hover:bg-violet-700 text-white">
                Guardar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Create User Dialog ── */}
        <Dialog open={showCreate} onOpenChange={(open) => { setShowCreate(open); if (!open) { setForm({ name: "", email: "", role: "venue_admin" }); setPendingVenueIds(new Set()); } }}>
          <DialogContent className="sm:max-w-lg flex flex-col max-h-[90vh]">
            <DialogHeader className="shrink-0">
              <DialogTitle className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-blue-600" />
                Crear nuevo usuario
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2 overflow-y-auto flex-1 pr-1">
              <div className="space-y-1.5">
                <Label htmlFor="new-name">Nombre completo *</Label>
                <Input id="new-name" placeholder="Ej: María García" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-email">Email *</Label>
                <Input id="new-email" type="email" placeholder="maria@ejemplo.com" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-role">Rol</Label>
                <Select value={form.role} onValueChange={(v) => { setForm((f) => ({ ...f, role: v as Role })); setPendingVenueIds(new Set()); }}>
                  <SelectTrigger id="new-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="w-80">
                    {ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        <div className="flex items-center gap-2 py-1">
                          <RoleBadge role={r.value} />
                          <span className="text-xs text-muted-foreground">{r.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {form.role === "venue_admin" && (
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    <Store className="w-3.5 h-3.5 text-violet-600" />
                    Locales asignados *
                  </Label>
                  <VenuePicker
                    venues={venues}
                    selected={pendingVenueIds}
                    onToggle={(id) => setPendingVenueIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id); else next.add(id);
                      return next;
                    })}
                  />
                  {pendingVenueIds.size === 0 && (
                    <p className="text-[10px] text-amber-600 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Obligatorio seleccionar al menos un local.
                    </p>
                  )}
                </div>
              )}
            </div>
            <DialogFooter className="shrink-0">
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
              <Button onClick={handleCreate} disabled={createUser.isPending} className="bg-blue-700 hover:bg-blue-800 text-white">
                {createUser.isPending ? "Creando…" : "Crear usuario"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Set Password Dialog ── */}
        <Dialog open={!!passwordTarget} onOpenChange={(open) => !open && setPasswordTarget(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-violet-600" />
                Cambiar contraseña — {passwordTarget?.name}
              </DialogTitle>
            </DialogHeader>
            <div className="py-2 space-y-1.5">
              <Label htmlFor="new-password">Nueva contraseña</Label>
              <Input id="new-password" type="password" placeholder="Mínimo 8 caracteres" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPasswordTarget(null)}>Cancelar</Button>
              <Button
                onClick={() => passwordTarget && setUserPassword.mutate({ userId: passwordTarget.id, password: newPassword })}
                disabled={setUserPassword.isPending || newPassword.length < 8}
                className="bg-violet-600 hover:bg-violet-700 text-white"
              >
                Guardar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Delete confirmation ── */}
        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Eliminar a {deleteTarget?.name}?</AlertDialogTitle>
              <AlertDialogDescription>Esta acción no se puede deshacer. El usuario perderá acceso inmediatamente.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteTarget && deleteUser.mutate({ userId: deleteTarget.id })}
                className="bg-red-600 hover:bg-red-700"
              >
                Eliminar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
