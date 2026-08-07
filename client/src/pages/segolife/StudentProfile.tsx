import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { isSupportedLocale, type SupportedLocale } from "@/lib/i18n";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, GraduationCap, Coins } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * Perfil autoservicio del estudiante — /ie/profile, /uva/profile (un único
 * componente, ver client/src/App.tsx). También hace de onboarding mínimo:
 * si el perfil no está completo, esta misma pantalla es el formulario que
 * lo completa — no hay un wizard separado (ver docs/SEGOLIFE_ROADMAP.md,
 * Fase 1C, "onboarding pragmático").
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

export default function StudentProfile() {
  const { t, i18n } = useTranslation();
  const { community, availableLocales } = useCommunity();
  const utils = trpc.useUtils();

  const { data: me, isLoading } = trpc.students.me.useQuery();
  const { data: universities } = trpc.communities.listUniversities.useQuery();
  const { data: wallet } = trpc.tokens.getMyWallet.useQuery();
  const { data: ledger } = trpc.tokens.listMyLedger.useQuery({ limit: 10, offset: 0 });

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

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const showLanguageSwitcher = availableLocales.length > 1;

  return (
    <div className="min-h-screen bg-background text-foreground px-4 py-10">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GraduationCap className="w-6 h-6 text-primary" />
            <div>
              <h1 className="text-xl font-semibold">{t("brand")} — {community?.name ?? "…"}</h1>
              {!me?.profile.profileCompleted && (
                <p className="text-sm text-amber-500">
                  {t("studentProfile.incomplete", { defaultValue: "Completa tu perfil para continuar" })}
                </p>
              )}
            </div>
          </div>
          {showLanguageSwitcher && (
            <div className="flex gap-1">
              {availableLocales.filter(isSupportedLocale).map((locale: SupportedLocale) => (
                <button
                  key={locale}
                  onClick={() => i18n.changeLanguage(locale)}
                  className={`px-2.5 py-1 rounded-md text-xs border ${
                    i18n.language === locale ? "bg-primary text-primary-foreground border-primary" : "border-border"
                  }`}
                >
                  {locale.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Coins className="w-5 h-5 text-primary" />
              <span className="text-sm font-semibold text-foreground">{t("studentProfile.tokensTitle", { defaultValue: "SegoTokens" })}</span>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{t("studentProfile.tokensBalance", { defaultValue: "Saldo" })}</p>
              <p className="text-2xl font-semibold text-foreground">{wallet?.balance ?? 0}</p>
            </div>
          </div>
          {ledger && ledger.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-border">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">{t("studentProfile.tokensHistory", { defaultValue: "Historial reciente" })}</p>
              {ledger.map(l => (
                <div key={l.id} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {l.reason}
                    {l.sourceType === "consumption" && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                        {t("scan.sourceLabel", { defaultValue: "Source: Consumption" })}
                      </span>
                    )}
                  </span>
                  <Badge variant={l.direction === "credit" ? "default" : "outline"}>{l.direction === "credit" ? "+" : "-"}{l.amount}</Badge>
                </div>
              ))}
            </div>
          )}
          {(!ledger || ledger.length === 0) && (
            <p className="text-xs text-muted-foreground pt-2 border-t border-border">{t("studentProfile.tokensNoMovements", { defaultValue: "Todavía no tienes movimientos." })}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 bg-card border border-border rounded-lg p-5">
          <div className="col-span-2 text-xs uppercase tracking-widest text-muted-foreground">
            {t("studentProfile.personalData", { defaultValue: "Datos personales" })}
          </div>
          <div className="space-y-1.5">
            <Label>{t("studentProfile.firstName", { defaultValue: "Nombre" })}</Label>
            <Input value={form.firstName} onChange={e => set("firstName", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("studentProfile.lastName", { defaultValue: "Apellidos" })}</Label>
            <Input value={form.lastName} onChange={e => set("lastName", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("studentProfile.dateOfBirth", { defaultValue: "Fecha de nacimiento" })}</Label>
            <Input type="date" value={form.dateOfBirth} onChange={e => set("dateOfBirth", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("studentProfile.nationality", { defaultValue: "Nacionalidad (ISO-2)" })}</Label>
            <Input maxLength={2} value={form.nationality} onChange={e => set("nationality", e.target.value.toUpperCase())} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("studentProfile.countryOfOrigin", { defaultValue: "País de origen (ISO-2)" })}</Label>
            <Input maxLength={2} value={form.countryOfOrigin} onChange={e => set("countryOfOrigin", e.target.value.toUpperCase())} />
          </div>

          <div className="col-span-2 text-xs uppercase tracking-widest text-muted-foreground pt-2">
            {t("studentProfile.academicData", { defaultValue: "Datos académicos" })}
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label>{t("studentProfile.university", { defaultValue: "Universidad" })}</Label>
            <Select value={form.universityId} onValueChange={v => set("universityId", v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {(universities ?? []).map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("studentProfile.degreeProgram", { defaultValue: "Programa / grado" })}</Label>
            <Input value={form.degreeProgram} onChange={e => set("degreeProgram", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("studentProfile.academicYear", { defaultValue: "Curso académico" })}</Label>
            <Input value={form.academicYear} onChange={e => set("academicYear", e.target.value)} />
          </div>

          <div className="col-span-2 text-xs uppercase tracking-widest text-muted-foreground pt-2">
            {t("studentProfile.stay", { defaultValue: "Estancia en Segovia" })}
          </div>
          <div className="space-y-1.5">
            <Label>{t("studentProfile.arrivalDate", { defaultValue: "Fecha de llegada" })}</Label>
            <Input type="date" value={form.arrivalDate} onChange={e => set("arrivalDate", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("studentProfile.departureDate", { defaultValue: "Fecha prevista de salida" })}</Label>
            <Input type="date" value={form.expectedDepartureDate} onChange={e => set("expectedDepartureDate", e.target.value)} />
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label>{t("studentProfile.address", { defaultValue: "Dirección" })}</Label>
            <Input value={form.addressLine} onChange={e => set("addressLine", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("studentProfile.city", { defaultValue: "Ciudad" })}</Label>
            <Input value={form.city} onChange={e => set("city", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("studentProfile.postalCode", { defaultValue: "Código postal" })}</Label>
            <Input value={form.postalCode} onChange={e => set("postalCode", e.target.value)} />
          </div>

          <div className="col-span-2 pt-2">
            <Button onClick={handleSave} disabled={updateProfile.isPending} className="w-full">
              {updateProfile.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t("studentProfile.save", { defaultValue: "Guardar" })}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
