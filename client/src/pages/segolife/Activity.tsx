import { useMemo } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Coins, Gift, CheckCircle2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifePageContainer } from "@/components/segolife/SegolifePageContainer";
import { SegolifeEmptyState } from "@/components/segolife/SegolifeEmptyState";
import { SegolifeRowSkeleton } from "@/components/segolife/SegolifeSkeletons";
import { Button } from "@/components/ui/button";

type ActivityEntryType = "earned" | "spent" | "clawback" | "benefitUnlocked" | "benefitUsed";

interface ActivityEntry {
  id: string;
  type: ActivityEntryType;
  label: string;
  amount?: number;
  at: Date;
  venueName?: string | null;
}

const KICKER_KEY: Record<ActivityEntryType, string> = {
  earned: "activity.typeEarned",
  spent: "activity.typeSpent",
  clawback: "activity.typeClawback",
  benefitUnlocked: "activity.typeBenefitUnlocked",
  benefitUsed: "activity.typeBenefitUsed",
};

const ICON_STYLES: Record<ActivityEntryType, string> = {
  earned: "bg-primary/10 text-primary",
  spent: "bg-secondary text-muted-foreground",
  // FIX-01 — un clawback (reversión de recompensa tras un reembolso) resta
  // igual que un "spent", pero el Student no lo decidió: se distingue con
  // el mismo tono semántico que ya usa el resto de la app para "atención",
  // nunca el acento de marca (bg-secondary/text-muted-foreground es el
  // mismo tono neutro de "spent" — aquí se usa destructive/10 a propósito,
  // deliberadamente distinto, para que no se confunda con un gasto propio).
  clawback: "bg-destructive/10 text-destructive",
  benefitUnlocked: "bg-accent/10 text-accent",
  benefitUsed: "bg-primary/10 text-primary",
};

function ActivityIcon({ type }: { type: ActivityEntryType }) {
  if (type === "benefitUnlocked") return <Gift className="size-5" aria-hidden="true" />;
  if (type === "benefitUsed") return <CheckCircle2 className="size-5" aria-hidden="true" />;
  return <Coins className="size-5" aria-hidden="true" />;
}

/**
 * Historial personal de actividad — /:community/activity (Fase 6). No es un
 * módulo de backend nuevo: compone en cliente tres queries ya existentes
 * (ledger de SegoTokens + beneficios del estudiante) en una única timeline
 * ordenada por fecha, sin inventar datos ni levantar un mega-endpoint (spec,
 * "no crear mega-endpoint si no hace falta"). myRedemptions se consulta para
 * participar del estado de carga combinado, pero no se cruza con el ledger
 * para enriquecer entradas — el `reason` del propio movimiento ya es
 * suficiente y evitamos un matching frágil por ledgerId.
 */
export default function Activity() {
  const { t, i18n } = useTranslation();
  const { slug } = useCommunity();
  const [, navigate] = useLocation();

  const { data: ledger, isLoading: ledgerLoading } = trpc.tokens.listMyLedger.useQuery({ limit: 50, offset: 0 });
  const { isLoading: redemptionsLoading } = trpc.consumptionQr.myRedemptions.useQuery({ limit: 20 });
  const { data: benefits, isLoading: benefitsLoading } = trpc.benefits.myBenefits.useQuery();

  const isLoading = ledgerLoading || redemptionsLoading || benefitsLoading;

  const entries = useMemo<ActivityEntry[]>(() => {
    const items: ActivityEntry[] = [];

    for (const entry of ledger ?? []) {
      // FIX-01 — sourceType="reversal" es exactamente lo que reverseTransaction()
      // escribe (tokenLedgerService.ts) para CUALQUIER clawback (refund de
      // compra, ajuste admin revertido, etc.) — un débito de este tipo nunca
      // debe leerse como un "spent" normal, el Student no lo decidió.
      items.push({
        id: `ledger-${entry.id}`,
        type: entry.sourceType === "reversal" ? "clawback" : (entry.direction === "credit" ? "earned" : "spent"),
        label: entry.reason,
        amount: entry.amount,
        at: new Date(entry.createdAt),
      });
    }

    for (const benefit of benefits ?? []) {
      const label = i18n.language === "en"
        ? (benefit.definition.nameEn ?? benefit.definition.name)
        : (benefit.definition.nameEs ?? benefit.definition.name);
      items.push({
        id: `benefit-granted-${benefit.id}`,
        type: "benefitUnlocked",
        label,
        at: new Date(benefit.grantedAt),
      });
      if (benefit.usedAt) {
        items.push({
          id: `benefit-used-${benefit.id}`,
          type: "benefitUsed",
          label,
          at: new Date(benefit.usedAt),
        });
      }
    }

    return items.sort((a, b) => b.at.getTime() - a.at.getTime());
  }, [ledger, benefits, i18n.language]);

  return (
    <SegolifeAppShell requireAuth hideNav title={t("activity.title")}>
      <SegolifePageContainer>
        <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={() => navigate(`/${slug}/profile`)}>
          <ChevronLeft className="mr-1 size-4" aria-hidden="true" /> {t("common.back")}
        </Button>

        <h1 className="mb-4 text-xl font-bold text-foreground">{t("activity.title")}</h1>

        {isLoading ? (
          <SegolifeRowSkeleton count={6} />
        ) : entries.length === 0 ? (
          <SegolifeEmptyState
            icon={<Coins className="size-5" aria-hidden="true" />}
            title={t("activity.empty")}
            description={t("activity.emptyDescription")}
          />
        ) : (
          <div className="space-y-2">
            {entries.map(entry => (
              <div key={entry.id} className="segolife-card-shadow flex items-center gap-3 rounded-2xl bg-card p-3">
                <div className={`flex size-11 shrink-0 items-center justify-center rounded-full ${ICON_STYLES[entry.type]}`}>
                  <ActivityIcon type={entry.type} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t(KICKER_KEY[entry.type])}</p>
                  <p className="truncate text-sm font-semibold text-foreground">{entry.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.at.toLocaleString(i18n.language, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                {entry.amount != null && (entry.type === "earned" || entry.type === "spent" || entry.type === "clawback") && (
                  <span className={`shrink-0 text-sm font-semibold tabular-nums ${entry.type === "earned" ? "text-primary" : entry.type === "clawback" ? "text-destructive" : "text-muted-foreground"}`}>
                    {entry.type === "earned" ? "+" : "-"}{entry.amount}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </SegolifePageContainer>
    </SegolifeAppShell>
  );
}
