import { useState } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Gift, ChevronLeft, Clock } from "lucide-react";

/**
 * "Mis Beneficios" del estudiante — /ie/benefits, /uva/benefits (un único
 * componente, mismo patrón que StudentProfile/StudentScan). El QR de un
 * beneficio solo se pide/renderiza cuando benefits.getMyBenefit confirma que
 * está realmente vigente AHORA (status=active y dentro de [valid_from,
 * valid_until]) — fuera de esa ventana se muestra "Disponible mañana"/fecha
 * en vez de un código, nunca se intenta mostrar un QR no vigente.
 */

interface BenefitListItem {
  id: number;
  status: "active" | "used" | "expired" | "cancelled";
  validFrom: string | Date;
  validUntil: string | Date | null;
  usedAt: string | Date | null;
  definition: {
    id: number; name: string; nameEn: string | null; nameEs: string | null;
    benefitType: string; imageUrl: string | null;
    destinationVenueId: number | null;
  };
}

function localizedName(def: BenefitListItem["definition"], lang: string): string {
  if (lang === "en" && def.nameEn) return def.nameEn;
  if (lang !== "en" && def.nameEs) return def.nameEs;
  return def.name;
}

function fmtDateTime(d: string | Date, lang: string) {
  return new Date(d).toLocaleString(lang, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function BenefitCard({ b, lang, onOpen }: { b: BenefitListItem; lang: string; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <button onClick={onOpen} className="w-full text-left bg-card border border-border rounded-lg p-4 flex items-center gap-3 hover:border-primary/50 transition-colors">
      <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <Gift className="w-5 h-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{localizedName(b.definition, lang)}</p>
        <p className="text-xs text-muted-foreground">
          {b.status === "active" && new Date(b.validFrom) > new Date()
            ? t("benefits.availableFrom", { date: fmtDateTime(b.validFrom, lang) })
            : b.validUntil
              ? `${t("benefits.validUntilLabel")} ${fmtDateTime(b.validUntil, lang)}`
              : t("benefits.validFromLabel") + " " + fmtDateTime(b.validFrom, lang)}
        </p>
      </div>
      <Badge variant={b.status === "active" ? "default" : b.status === "used" ? "secondary" : "outline"}>
        {t(`benefits.status${b.status[0].toUpperCase()}${b.status.slice(1)}`)}
      </Badge>
    </button>
  );
}

function BenefitDetail({ id, onBack, lang }: { id: number; onBack: () => void; lang: string }) {
  const { t } = useTranslation();
  const { data: benefit, isLoading } = trpc.benefits.getMyBenefit.useQuery({ id });

  if (isLoading || !benefit) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  const now = Date.now();
  const validFrom = new Date(benefit.validFrom).getTime();
  const validUntil = benefit.validUntil ? new Date(benefit.validUntil).getTime() : null;
  const isFuture = benefit.status === "active" && validFrom > now;
  const isCurrentlyShowable = !!benefit.qrToken;
  void validUntil;

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2"><ChevronLeft className="w-4 h-4 mr-1" /> {t("benefits.back")}</Button>

      <div className="text-center space-y-1">
        <h2 className="text-lg font-semibold text-foreground">{localizedName(benefit.definition, lang)}</h2>
        {(lang === "en" ? benefit.definition.descriptionEn : benefit.definition.descriptionEs) && (
          <p className="text-sm text-muted-foreground">{lang === "en" ? benefit.definition.descriptionEn : benefit.definition.descriptionEs}</p>
        )}
      </div>

      <div className="bg-card border border-border rounded-lg p-5 space-y-3 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">{t("benefits.validFromLabel")}</span><span className="text-foreground">{fmtDateTime(benefit.validFrom, lang)}</span></div>
        {benefit.validUntil && (
          <div className="flex justify-between"><span className="text-muted-foreground">{t("benefits.validUntilLabel")}</span><span className="text-foreground">{fmtDateTime(benefit.validUntil, lang)}</span></div>
        )}
        {benefit.usedAt && (
          <div className="flex justify-between"><span className="text-muted-foreground">{t("benefits.usedAtLabel")}</span><span className="text-foreground">{fmtDateTime(benefit.usedAt, lang)}</span></div>
        )}
      </div>

      {benefit.status === "active" && isCurrentlyShowable && (
        <div className="flex flex-col items-center gap-3 py-4">
          <div className="bg-white p-4 rounded-lg"><QRCodeSVG value={benefit.qrToken!} size={200} level="M" /></div>
          <p className="text-xs text-muted-foreground text-center">{t("benefits.showQrHint")}</p>
        </div>
      )}

      {isFuture && (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <Clock className="w-8 h-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {t("benefits.availableFrom", { date: fmtDateTime(benefit.validFrom, lang) })}
          </p>
        </div>
      )}

      {benefit.status !== "active" && (
        <div className="text-center py-4">
          <Badge variant={benefit.status === "used" ? "secondary" : "outline"}>{t(`benefits.status${benefit.status[0].toUpperCase()}${benefit.status.slice(1)}`)}</Badge>
        </div>
      )}
    </div>
  );
}

export default function MyBenefits() {
  const { t, i18n } = useTranslation();
  const { community } = useCommunity();
  const [selected, setSelected] = useState<number | null>(null);

  const { data: benefits, isLoading } = trpc.benefits.myBenefits.useQuery();

  if (selected != null) {
    return (
      <div className="min-h-screen bg-background text-foreground px-4 py-10">
        <div className="max-w-md mx-auto"><BenefitDetail id={selected} onBack={() => setSelected(null)} lang={i18n.language} /></div>
      </div>
    );
  }

  const active = (benefits ?? []).filter(b => b.status === "active");
  const used = (benefits ?? []).filter(b => b.status === "used");
  const expired = (benefits ?? []).filter(b => b.status === "expired" || b.status === "cancelled");

  return (
    <div className="min-h-screen bg-background text-foreground px-4 py-10">
      <div className="max-w-md mx-auto space-y-6">
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-2">
            <Gift className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-semibold">{t("benefits.myTitle")}</h1>
          </div>
          <p className="text-sm text-muted-foreground">{t("benefits.mySubtitle")}</p>
          {community?.name && <p className="text-xs text-muted-foreground">{community.name}</p>}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <Tabs defaultValue="active">
            <TabsList className="w-full">
              <TabsTrigger value="active" className="flex-1">{t("benefits.tabActive")} ({active.length})</TabsTrigger>
              <TabsTrigger value="used" className="flex-1">{t("benefits.tabUsed")} ({used.length})</TabsTrigger>
              <TabsTrigger value="expired" className="flex-1">{t("benefits.tabExpired")} ({expired.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="active" className="space-y-2 mt-3">
              {active.length === 0
                ? <p className="text-center text-sm text-muted-foreground py-10">{t("benefits.emptyActive")}</p>
                : active.map(b => <BenefitCard key={b.id} b={b as BenefitListItem} lang={i18n.language} onOpen={() => setSelected(b.id)} />)}
            </TabsContent>
            <TabsContent value="used" className="space-y-2 mt-3">
              {used.length === 0
                ? <p className="text-center text-sm text-muted-foreground py-10">{t("benefits.emptyUsed")}</p>
                : used.map(b => <BenefitCard key={b.id} b={b as BenefitListItem} lang={i18n.language} onOpen={() => setSelected(b.id)} />)}
            </TabsContent>
            <TabsContent value="expired" className="space-y-2 mt-3">
              {expired.length === 0
                ? <p className="text-center text-sm text-muted-foreground py-10">{t("benefits.emptyExpired")}</p>
                : expired.map(b => <BenefitCard key={b.id} b={b as BenefitListItem} lang={i18n.language} onOpen={() => setSelected(b.id)} />)}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}
