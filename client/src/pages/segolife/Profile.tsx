import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { toast } from "sonner";
import { Coins, ChevronRight, Loader2, LogOut, Sparkles, Bell, Ticket, IdCard, RotateCw } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { isSupportedLocale, type SupportedLocale } from "@/lib/i18n";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

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
 * QR de identidad para POS nativo (Fase 8, spec punto 23) — identifica al
 * estudiante frente al staff, nunca autoriza un cargo por sí mismo. Se
 * muestra siempre plegado por defecto para no competir visualmente con
 * SegoTokens (la sección más importante de Profile).
 */
function StudentIdentitySection() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data, isLoading } = trpc.ticketPurchase.myIdentityToken.useQuery(undefined, { enabled: open });
  const rotateMut = trpc.ticketPurchase.rotateMyIdentityToken.useMutation({
    onSuccess: () => toast.success(t("profile.identityQrRotated")),
  });

  return (
    <section className="space-y-3">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center justify-between rounded-2xl bg-secondary px-4 py-3 text-secondary-foreground">
        <span className="flex items-center gap-2 text-sm font-medium">
          <IdCard className="size-4" aria-hidden="true" /> {t("profile.identityQrTitle")}
        </span>
        <ChevronRight className={`size-4 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="segolife-card-shadow flex flex-col items-center gap-3 rounded-2xl bg-card p-5">
          {isLoading || !data ? (
            <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
          ) : (
            <>
              <div className="rounded-2xl bg-white p-3"><QRCodeSVG value={data.token} size={160} level="M" /></div>
              <p className="text-center text-xs text-muted-foreground">{t("profile.identityQrDescription")}</p>
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" disabled={rotateMut.isPending} onClick={() => rotateMut.mutate()}>
                <RotateCw className="size-3.5" aria-hidden="true" /> {t("profile.identityQrRegenerate")}
              </Button>
            </>
          )}
        </div>
      )}
    </section>
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

export default function Profile() {
  const { t, i18n } = useTranslation();
  const { community, slug, availableLocales } = useCommunity();
  const { logout } = useAuth();
  const utils = trpc.useUtils();

  const { data: me, isLoading } = trpc.students.me.useQuery();
  const { data: universities } = trpc.communities.listUniversities.useQuery();
  const { data: wallet } = trpc.tokens.getMyWallet.useQuery();

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
      <div className="mx-auto max-w-md space-y-7 px-4 py-5">
        <div className="flex items-center gap-4">
          <Avatar className="size-16">
            <AvatarFallback className="text-lg font-semibold text-foreground">
              {initials(me.profile.firstName ?? "", me.profile.lastName ?? "", me.user.name ?? "")}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-xl font-semibold text-foreground">{displayName}</p>
            <p className="truncate text-sm text-muted-foreground">
              {[university?.name, community?.name].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>

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
        </section>

        {showLanguageSwitcher && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">{t("profile.sectionLanguage")}</h2>
            <div className="flex gap-2">
              {availableLocales.filter(isSupportedLocale).map((locale: SupportedLocale) => (
                <button
                  key={locale}
                  onClick={() => i18n.changeLanguage(locale)}
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
      </div>
    </SegolifeAppShell>
  );
}
