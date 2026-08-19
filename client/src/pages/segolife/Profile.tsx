import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { toast } from "sonner";
import { Coins, ChevronRight, Loader2, LogOut, Sparkles, Bell, Ticket, IdCard, Archive, UserPlus, Camera, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { isSupportedLocale, type SupportedLocale } from "@/lib/i18n";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifePageContainer } from "@/components/segolife/SegolifePageContainer";
import { SegolifeIdentityQrContent } from "@/components/segolife/SegolifeIdentityQr";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Perfil definitivo de Segolife (Fase 6) — /:community/profile. Autoservicio
 * del estudiante: cabecera + nudge de perfil incompleto + SegoTokens +
 * idioma (solo si la comunidad tiene más de uno) + datos personales
 * editables + logout. Reutiliza la capa de datos de la antigua
 * StudentProfile.tsx (students.me / updateProfile / listUniversities /
 * getMyWallet) pero con el layout mobile-first de Fase 6 (SegolifeAppShell).
 *
 * Nunca muestra ni permite editar: notas internas, etiquetas, rol,
 * membresía de comunidad — eso es exclusivo de la ficha admin
 * (client/src/pages/admin/students/StudentDetail.tsx).
 */

type FormState = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  nationality: string;
  countryOfOrigin: string;
  universityId: string;
  degreeProgram: string;
  academicYear: string;
  arrivalDate: string;
  expectedDepartureDate: string;
  addressLine: string;
  postalCode: string;
  city: string;
};

const EMPTY_FORM: FormState = {
  firstName: "", lastName: "", dateOfBirth: "", nationality: "", countryOfOrigin: "",
  universityId: "", degreeProgram: "", academicYear: "", arrivalDate: "",
  expectedDepartureDate: "", addressLine: "", postalCode: "", city: "",
};

/**
 * QR permanente de identidad del Student (Fase 8, spec punto 23; ampliado en
 * SEGOLIFE — STUDENT IDENTITY, UNIVERSAL QR & UNIFIED CHECK-IN) — identifica
 * al estudiante frente al staff, NUNCA autoriza un cargo ni una asistencia
 * por sí mismo sin que el staff/servidor lo valide. Contenido delegado a
 * SegolifeIdentityQrContent (misma fuente que el botón de acceso rápido del
 * header — nunca dos implementaciones que puedan divergir visualmente). Se
 * muestra siempre plegado por defecto para no competir visualmente con
 * SegoTokens (la sección más importante de Profile) — el acceso realmente
 * rápido de un toque ahora vive en el header (spec: "reach their QR
 * quickly" desde cualquier página, no solo desde Profile).
 */
function StudentIdentitySection() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <section className="space-y-3">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center justify-between rounded-2xl bg-secondary px-4 py-3 text-secondary-foreground">
        <span className="flex items-center gap-2 text-sm font-medium">
          <IdCard className="size-4" aria-hidden="true" /> {t("profile.identityQrTitle")}
        </span>
        <ChevronRight className={`size-4 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="segolife-card-shadow rounded-2xl bg-card p-5">
          <SegolifeIdentityQrContent autoLoad={open} />
        </div>
      )}
    </section>
  );
}

/**
 * SEGOLIFE HISTORICAL STUDENT CLAIM (spec §7/§37-38) — indicador discreto,
 * nunca bloquea el resto del perfil. `myHistoricalMatch` nunca expone el
 * email/teléfono histórico ni revela si la identidad pertenece a otra
 * persona (spec §9/§30) — solo agregados (nº eventos/tickets/venues) y, una
 * vez reclamado, la fecha. El claim es SIEMPRE una acción explícita de la
 * propia persona autenticada — nunca ocurre en silencio (ver hallazgo de
 * seguridad corregido en resolveHistoricalIdentityBestEffort).
 */
function HistoricalClaimBanner() {
  const { t, i18n } = useTranslation();
  const utils = trpc.useUtils();
  const { data } = trpc.historicalIdentities.myHistoricalMatch.useQuery();
  const claimMut = trpc.historicalIdentities.claimMyHistory.useMutation({
    onSuccess: () => {
      toast.success(t("profile.historicalClaimSuccess"));
      utils.historicalIdentities.myHistoricalMatch.invalidate();
    },
    onError: () => toast.error(t("profile.historicalClaimError")),
  });

  if (!data || data.status === "NOT_AVAILABLE") return null;

  if (data.status === "ALREADY_CLAIMED") {
    return (
      <div className="flex items-center gap-2.5 rounded-2xl bg-secondary px-4 py-3 text-secondary-foreground">
        <Archive className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{t("profile.historicalClaimedBadge")}</p>
          {data.claimedAt && (
            <p className="text-xs text-muted-foreground">
              {t("profile.historicalClaimedSince", { date: new Date(data.claimedAt).toLocaleDateString(i18n.language) })}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="segolife-card-shadow rounded-2xl border border-primary/30 bg-primary/5 p-4">
      <p className="text-sm font-semibold text-foreground">{t("profile.historicalBannerTitle")}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("profile.historicalBannerDescription", { events: data.eventsCount, tickets: data.ticketsCount, venues: data.venuesCount })}
      </p>
      <Button size="sm" className="mt-3 rounded-full" disabled={claimMut.isPending} onClick={() => claimMut.mutate()}>
        {claimMut.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : t("profile.historicalBannerCta")}
      </Button>
    </div>
  );
}

function initials(firstName: string, lastName: string, fallbackName: string): string {
  const a = firstName.trim()[0];
  const b = lastName.trim()[0];
  if (a || b) return `${a ?? ""}${b ?? ""}`.toUpperCase();
  const parts = fallbackName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.slice(0, 2).map(p => p[0]).join("").toUpperCase();
}

// SEGOLIFE MG-03 — mismos límites que studentPhotoService.ts (validación
// client-side es solo feedback rápido; la validación REAL es siempre
// server-side, ver server/segolife/students/studentPhotoService.ts).
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

/**
 * Fotografía de perfil (spec MG-03) — sustituye el avatar de solo-iniciales
 * cuando el Student tiene una foto real. Sube vía REST multipart (no tRPC —
 * mismo criterio que server/uploadRoutes.ts: multipart/binary no encaja
 * bien en JSON-RPC) a POST /api/students/me/photo; eliminar sí es una
 * mutación tRPC normal (students.removeMyPhoto) porque no maneja bytes.
 *
 * `cacheBust` fuerza al navegador a repedir la imagen tras reemplazar/
 * eliminar sin necesitar logout/login — la URL en sí (`/api/students/:id/
 * photo`) es siempre la misma, así que sin esto el navegador podría seguir
 * mostrando la foto anterior desde caché (spec §6: "controla cache
 * invalidation correctamente").
 */
function StudentAvatarEditor({
  avatarUrl,
  displayInitials,
  displayName,
  subtitle,
}: {
  avatarUrl: string | null;
  displayInitials: string;
  displayName: string;
  subtitle: string;
}) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cacheBust, setCacheBust] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const removePhoto = trpc.students.removeMyPhoto.useMutation({
    onSuccess: () => {
      toast.success(t("profile.photoRemoved"));
      setCacheBust(v => v + 1);
      utils.students.me.invalidate();
    },
    onError: () => toast.error(t("profile.photoUploadError")),
  });

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite re-seleccionar el mismo archivo dos veces seguidas
    if (!file) return;

    if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
      toast.error(t("profile.photoInvalidType"));
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      toast.error(t("profile.photoTooLarge"));
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("photo", file);
      const res = await fetch("/api/students/me/photo", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "upload_failed");
      }
      toast.success(t("profile.photoUploaded"));
      setCacheBust(v => v + 1);
      await utils.students.me.invalidate();
    } catch {
      toast.error(t("profile.photoUploadError"));
    } finally {
      setUploading(false);
    }
  }

  const resolvedSrc = avatarUrl ? `${avatarUrl}${avatarUrl.includes("?") ? "&" : "?"}v=${cacheBust}` : undefined;

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0">
        <Avatar className="size-16">
          {resolvedSrc && <AvatarImage src={resolvedSrc} alt={displayName} className="object-cover" />}
          <AvatarFallback className="text-lg font-semibold text-foreground">{displayInitials}</AvatarFallback>
        </Avatar>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          aria-label={avatarUrl ? t("profile.changePhoto") : t("profile.addPhoto")}
          className="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {uploading ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Camera className="size-3.5" aria-hidden="true" />}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={handleFileSelected}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xl font-semibold text-foreground">{displayName}</p>
        {subtitle && <p className="truncate text-sm text-muted-foreground">{subtitle}</p>}
        <div className="mt-1 flex items-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="text-xs font-medium text-primary disabled:opacity-60"
          >
            {avatarUrl ? t("profile.changePhoto") : t("profile.addPhoto")}
          </button>
          {avatarUrl && (
            <button
              type="button"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={removePhoto.isPending}
              className="flex items-center gap-1 text-xs font-medium text-destructive disabled:opacity-60"
            >
              <Trash2 className="size-3" aria-hidden="true" /> {t("profile.removePhoto")}
            </button>
          )}
        </div>
      </div>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("profile.removePhotoConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("profile.removePhotoConfirmDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removePhoto.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("profile.removePhotoConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function Profile() {
  const { t, i18n } = useTranslation();
  const { community, slug, availableLocales } = useCommunity();
  const { logout } = useAuth();
  const utils = trpc.useUtils();

  const { data: me, isLoading } = trpc.students.me.useQuery();
  const { data: universities } = trpc.communities.listUniversities.useQuery();
  const { data: wallet } = trpc.tokens.getMyWallet.useQuery();
  const { data: walletValue } = trpc.tokens.myWalletPromotionalValue.useQuery();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  useEffect(() => {
    if (!me) return;
    setForm({
      firstName: me.profile.firstName ?? "",
      lastName: me.profile.lastName ?? "",
      dateOfBirth: me.profile.dateOfBirth ?? "",
      nationality: me.profile.nationality ?? "",
      countryOfOrigin: me.profile.countryOfOrigin ?? "",
      universityId: me.profile.universityId ? String(me.profile.universityId) : "",
      degreeProgram: me.profile.degreeProgram ?? "",
      academicYear: me.profile.academicYear ?? "",
      arrivalDate: me.profile.arrivalDate ?? "",
      expectedDepartureDate: me.profile.expectedDepartureDate ?? "",
      addressLine: me.profile.addressLine ?? "",
      postalCode: me.profile.postalCode ?? "",
      city: me.profile.city ?? "",
    });
  }, [me]);

  const updateProfile = trpc.students.updateProfile.useMutation({
    onSuccess: () => {
      toast.success(t("studentProfile.saved", { defaultValue: "Perfil actualizado" }));
      utils.students.me.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const set = (k: keyof FormState, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = () => {
    updateProfile.mutate({
      firstName: form.firstName || null,
      lastName: form.lastName || null,
      dateOfBirth: form.dateOfBirth || null,
      nationality: form.nationality || null,
      countryOfOrigin: form.countryOfOrigin || null,
      universityId: form.universityId ? Number(form.universityId) : null,
      degreeProgram: form.degreeProgram || null,
      academicYear: form.academicYear || null,
      arrivalDate: form.arrivalDate || null,
      expectedDepartureDate: form.expectedDepartureDate || null,
      addressLine: form.addressLine || null,
      postalCode: form.postalCode || null,
      city: form.city || null,
    });
  };

  if (isLoading || !me) {
    return (
      <SegolifeAppShell requireAuth title={t("profile.title")}>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
        </div>
      </SegolifeAppShell>
    );
  }

  const showLanguageSwitcher = availableLocales.length > 1;
  const university = universities?.find(u => u.id === me.profile.universityId);
  const displayName = [me.profile.firstName, me.profile.lastName].filter(Boolean).join(" ") || me.user.name || "";

  return (
    <SegolifeAppShell requireAuth title={t("profile.title")}>
      <SegolifePageContainer className="space-y-7">
        <StudentAvatarEditor
          avatarUrl={me.user.avatarUrl}
          displayInitials={initials(me.profile.firstName ?? "", me.profile.lastName ?? "", me.user.name ?? "")}
          displayName={displayName}
          subtitle={[university?.name, community?.name].filter(Boolean).join(" · ")}
        />

        <HistoricalClaimBanner />

        {!me.profile.profileCompleted && (
          <div className="segolife-card-shadow rounded-2xl border border-accent/30 bg-accent/10 p-4">
            <p className="text-sm font-semibold text-foreground">{t("profile.completeProfileTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("profile.completeProfileDescription")}</p>
            <a
              href="#personal-details"
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary"
            >
              {t("profile.completeProfileCta")} <ChevronRight className="size-4" aria-hidden="true" />
            </a>
          </div>
        )}

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">{t("profile.sectionTokens")}</h2>
          <Link href={`/${slug}/rewards`} className="block segolife-elevated-shadow rounded-3xl bg-primary p-5 text-primary-foreground">
            <div className="flex items-center justify-between">
              <div>
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-primary-foreground/80">
                  <Coins className="size-3.5" aria-hidden="true" /> {t("home.walletBalance")}
                </p>
                <p className="mt-1 text-4xl font-bold tabular-nums">{(wallet?.balance ?? 0).toLocaleString(i18n.language)}</p>
                {walletValue?.promotionalValue && (
                  <p className="mt-1 text-xs text-primary-foreground/80">{t("rewardPreview.approxValue", { value: walletValue.promotionalValue.formatted })}</p>
                )}
              </div>
              <ChevronRight className="size-5 text-primary-foreground/70" aria-hidden="true" />
            </div>
          </Link>
          <Link
            href={`/${slug}/activity`}
            className="flex items-center justify-between rounded-2xl bg-secondary px-4 py-3 text-secondary-foreground"
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="size-4" aria-hidden="true" /> {t("profile.viewActivity")}
            </span>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
          <Link
            href={`/${slug}/tickets`}
            className="flex items-center justify-between rounded-2xl bg-secondary px-4 py-3 text-secondary-foreground"
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <Ticket className="size-4" aria-hidden="true" /> {t("ticketing.viewMyTickets")}
            </span>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
          {/* REFERRAL & INVITE REWARDS ENGINE (Fase 8, spec §32) — segundo
              punto de entrada además de Rewards→Invitar, mismo destino
              (pestaña "invite" de Rewards.tsx), nunca una segunda
              implementación de enlace/QR/estadísticas. */}
          <Link
            href={`/${slug}/rewards?tab=invite`}
            className="flex items-center justify-between rounded-2xl bg-secondary px-4 py-3 text-secondary-foreground"
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <UserPlus className="size-4" aria-hidden="true" /> {t("profile.inviteFriends")}
            </span>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        </section>

        {showLanguageSwitcher && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">{t("profile.sectionLanguage")}</h2>
            <div className="flex gap-2">
              {availableLocales.filter(isSupportedLocale).map((locale: SupportedLocale) => (
                <button
                  key={locale}
                  onClick={() => {
                    i18n.changeLanguage(locale);
                    // Fase 15 (spec §24, "explicit Student language preference
                    // must override community default"): auditoría de esta
                    // fase confirmó que este botón SOLO cambiaba el idioma
                    // visual — nunca llegaba a student_profiles.preferredLocale,
                    // así que resolveCommunicationLocale() (ya implementado y
                    // correcto para emails) nunca veía la elección real del
                    // Student. Envío mínimo (solo este campo) — updateStudentProfile
                    // hace SET parcial, nunca toca el resto del perfil.
                    updateProfile.mutate({ preferredLocale: locale });
                  }}
                  className={`flex-1 rounded-2xl border px-4 py-3 text-sm font-medium transition-colors ${
                    i18n.language === locale
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {t(`languageSwitcher.${locale}`)}
                </button>
              ))}
            </div>
          </section>
        )}

        <section id="personal-details" className="scroll-mt-20 space-y-3">
          <h2 className="text-lg font-semibold text-foreground">{t("profile.sectionPersonal")}</h2>
          <div className="segolife-card-shadow grid grid-cols-2 gap-4 rounded-2xl bg-card p-4">
            <div className="col-span-2 space-y-1.5">
              <Label>{t("studentProfile.firstName")}</Label>
              <Input value={form.firstName} onChange={e => set("firstName", e.target.value)} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>{t("studentProfile.lastName")}</Label>
              <Input value={form.lastName} onChange={e => set("lastName", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("studentProfile.dateOfBirth")}</Label>
              <Input type="date" value={form.dateOfBirth} onChange={e => set("dateOfBirth", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("studentProfile.nationality")}</Label>
              <Input maxLength={2} value={form.nationality} onChange={e => set("nationality", e.target.value.toUpperCase())} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>{t("studentProfile.countryOfOrigin")}</Label>
              <Input maxLength={2} value={form.countryOfOrigin} onChange={e => set("countryOfOrigin", e.target.value.toUpperCase())} />
            </div>

            <div className="col-span-2 pt-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              {t("studentProfile.academicData")}
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>{t("studentProfile.university")}</Label>
              <Select value={form.universityId} onValueChange={v => set("universityId", v)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {(universities ?? []).map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>{t("studentProfile.degreeProgram")}</Label>
              <Input value={form.degreeProgram} onChange={e => set("degreeProgram", e.target.value)} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>{t("studentProfile.academicYear")}</Label>
              <Input value={form.academicYear} onChange={e => set("academicYear", e.target.value)} />
            </div>

            <div className="col-span-2 pt-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              {t("studentProfile.stay")}
            </div>
            <div className="space-y-1.5">
              <Label>{t("studentProfile.arrivalDate")}</Label>
              <Input type="date" value={form.arrivalDate} onChange={e => set("arrivalDate", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("studentProfile.departureDate")}</Label>
              <Input type="date" value={form.expectedDepartureDate} onChange={e => set("expectedDepartureDate", e.target.value)} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>{t("studentProfile.address")}</Label>
              <Input value={form.addressLine} onChange={e => set("addressLine", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("studentProfile.city")}</Label>
              <Input value={form.city} onChange={e => set("city", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("studentProfile.postalCode")}</Label>
              <Input value={form.postalCode} onChange={e => set("postalCode", e.target.value)} />
            </div>

            <div className="col-span-2 pt-2">
              <Button onClick={handleSave} disabled={updateProfile.isPending} className="w-full rounded-full">
                {updateProfile.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : t("studentProfile.save")}
              </Button>
            </div>
          </div>
        </section>

        <StudentIdentitySection />

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">{t("profile.sectionSettings")}</h2>
          <Link
            href={`/${slug}/settings/notifications`}
            className="flex items-center justify-between rounded-2xl bg-secondary px-4 py-3 text-secondary-foreground"
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <Bell className="size-4" aria-hidden="true" /> {t("notifications.openSettings")}
            </span>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
          <Button
            variant="outline"
            onClick={() => logout()}
            className="w-full justify-center gap-2 rounded-full border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="size-4" aria-hidden="true" /> {t("profile.logout")}
          </Button>
        </section>
      </SegolifePageContainer>
    </SegolifeAppShell>
  );
}
