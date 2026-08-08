import { useTranslation } from "react-i18next";
import { useLocation, Link } from "wouter";
import { Gift, Coins, ChevronRight, Clock } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifeEmptyState } from "@/components/segolife/SegolifeEmptyState";
import { SegolifeRowSkeleton } from "@/components/segolife/SegolifeSkeletons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

/**
 * Rewards — /:community/rewards (Fase 6). Separa explícitamente DOS
 * conceptos que el estudiante no debe confundir (spec, punto 18): gastar
 * SegoTokens (motor spendTokens, sin catálogo de recompensas comprables
 * todavía — ver nota en SpendTab) vs Mis Beneficios (derechos ya
 * desbloqueados). `/:community/benefits` (compat con la Fase 4 ya en
 * producción) abre esta misma página con la pestaña de Beneficios activa.
 */

interface BenefitListItem {
  id: number;
  status: "active" | "used" | "expired" | "cancelled";
  validFrom: string | Date;
  validUntil: string | Date | null;
  definition: {
    id: number; name: string; nameEn: string | null; nameEs: string | null;
    benefitType: string; imageUrl: string | null;
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

function BenefitCard({ b, lang, slug }: { b: BenefitListItem; lang: string; slug: string }) {
  const { t } = useTranslation();
  const isUpcoming = b.status === "active" && new Date(b.validFrom) > new Date();
  const statusLabel = isUpcoming ? "statusUpcoming" : `status${b.status[0].toUpperCase()}${b.status.slice(1)}`;

  return (
    <Link href={`/${slug}/benefits/${b.id}`} className="segolife-card-shadow flex items-center gap-3 rounded-2xl bg-card p-3.5">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
        <Gift className="size-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{localizedName(b.definition, lang)}</p>
        <p className="text-xs text-muted-foreground">
          {isUpcoming
            ? t("benefits.availableFrom", { date: fmtDateTime(b.validFrom, lang) })
            : b.validUntil
              ? `${t("benefits.validUntilLabel")} ${fmtDateTime(b.validUntil, lang)}`
              : fmtDateTime(b.validFrom, lang)}
        </p>
      </div>
      <Badge variant={b.status === "active" ? "default" : b.status === "used" ? "secondary" : "outline"}>{t(`benefits.${statusLabel}`)}</Badge>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

function BenefitsTab({ slug }: { slug: string }) {
  const { t, i18n } = useTranslation();
  const { data: benefits, isLoading } = trpc.benefits.myBenefits.useQuery();

  if (isLoading) return <SegolifeRowSkeleton />;

  const all = (benefits ?? []) as unknown as BenefitListItem[];
  const now = Date.now();
  const active = all.filter(b => b.status === "active" && new Date(b.validFrom).getTime() <= now);
  const upcoming = all.filter(b => b.status === "active" && new Date(b.validFrom).getTime() > now);
  const used = all.filter(b => b.status === "used");
  const expired = all.filter(b => b.status === "expired" || b.status === "cancelled");

  return (
    <Tabs defaultValue="active">
      <TabsList className="w-full">
        <TabsTrigger value="active" className="flex-1">{t("benefits.tabActive")}</TabsTrigger>
        <TabsTrigger value="upcoming" className="flex-1">{t("benefits.tabUpcoming")}</TabsTrigger>
        <TabsTrigger value="used" className="flex-1">{t("benefits.tabUsed")}</TabsTrigger>
        <TabsTrigger value="expired" className="flex-1">{t("benefits.tabExpired")}</TabsTrigger>
      </TabsList>
      <TabsContent value="active" className="mt-3 space-y-2">
        {active.length === 0
          ? <SegolifeEmptyState icon={<Gift className="size-5" aria-hidden="true" />} title={t("benefits.emptyActive")} description={t("benefits.emptyActiveDescription")} />
          : active.map(b => <BenefitCard key={b.id} b={b} lang={i18n.language} slug={slug} />)}
      </TabsContent>
      <TabsContent value="upcoming" className="mt-3 space-y-2">
        {upcoming.length === 0
          ? <SegolifeEmptyState icon={<Clock className="size-5" aria-hidden="true" />} title={t("benefits.emptyUpcoming")} />
          : upcoming.map(b => <BenefitCard key={b.id} b={b} lang={i18n.language} slug={slug} />)}
      </TabsContent>
      <TabsContent value="used" className="mt-3 space-y-2">
        {used.length === 0
          ? <SegolifeEmptyState icon={<Gift className="size-5" aria-hidden="true" />} title={t("benefits.emptyUsed")} />
          : used.map(b => <BenefitCard key={b.id} b={b} lang={i18n.language} slug={slug} />)}
      </TabsContent>
      <TabsContent value="expired" className="mt-3 space-y-2">
        {expired.length === 0
          ? <SegolifeEmptyState icon={<Gift className="size-5" aria-hidden="true" />} title={t("benefits.emptyExpired")} />
          : expired.map(b => <BenefitCard key={b.id} b={b} lang={i18n.language} slug={slug} />)}
      </TabsContent>
    </Tabs>
  );
}

/**
 * Gastar SegoTokens — el motor spendTokens() ya existe (Fase 2), pero no
 * hay todavía ningún catálogo de recompensas COMPRABLES con tokens (eso es
 * distinto de una benefit_definition, que se desbloquea por regla, no se
 * compra). Construir una tienda con datos inventados violaría "REAL DATA
 * ONLY" (spec, punto 44) — se documenta el hueco en vez de simularlo: haría
 * falta un catálogo explícito de "recompensas canjeables" (nombre, coste en
 * tokens, stock/disponibilidad) que hoy no existe en el schema.
 */
function SpendTab() {
  const { t } = useTranslation();
  const { data: wallet } = trpc.tokens.getMyWallet.useQuery();

  return (
    <div className="space-y-4">
      <div className="segolife-card-shadow flex items-center justify-between rounded-2xl bg-card p-4">
        <span className="text-sm text-muted-foreground">{t("rewards.balanceLabel")}</span>
        <span className="flex items-center gap-1.5 text-lg font-bold text-foreground">
          <Coins className="size-4 text-primary" aria-hidden="true" /> {(wallet?.balance ?? 0).toLocaleString()}
        </span>
      </div>
      <SegolifeEmptyState
        icon={<Coins className="size-5" aria-hidden="true" />}
        title={t("rewards.spendEmptyTitle")}
        description={t("rewards.spendEmptyDescription")}
      />
    </div>
  );
}

export default function Rewards() {
  const { t } = useTranslation();
  const { slug } = useCommunity();
  const [location] = useLocation();
  const defaultTab = location.endsWith("/benefits") ? "benefits" : "spend";

  return (
    <SegolifeAppShell requireAuth title={t("rewards.title")}>
      <div className="mx-auto max-w-md space-y-4 px-4 py-5">
        <h1 className="text-xl font-semibold text-foreground">{t("rewards.title")}</h1>
        <Tabs defaultValue={defaultTab}>
          <TabsList className="w-full">
            <TabsTrigger value="spend" className="flex-1">{t("rewards.tabSpend")}</TabsTrigger>
            <TabsTrigger value="benefits" className="flex-1">{t("rewards.tabBenefits")}</TabsTrigger>
          </TabsList>
          <TabsContent value="spend" className="mt-4"><SpendTab /></TabsContent>
          <TabsContent value="benefits" className="mt-4">{slug && <BenefitsTab slug={slug} />}</TabsContent>
        </Tabs>
      </div>
    </SegolifeAppShell>
  );
}
