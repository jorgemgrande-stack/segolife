import type { ReactNode } from "react";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";

/**
 * Estado vacío estándar de Segolife (Fase 6) — invita a seguir explorando en
 * vez de dejar una página en blanco. Un solo componente reutilizado en
 * Home/Explore/Rewards/Benefits/Activity, nunca CSS/markup repetido por página.
 */
export function SegolifeEmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  actionHref,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionHref?: string;
}) {
  return (
    <Empty className="border-none py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="bg-secondary text-primary size-14 rounded-2xl">
          {icon}
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {(actionLabel && (onAction || actionHref)) && (
        <EmptyContent>
          {actionHref ? (
            <Button asChild className="rounded-full px-6"><a href={actionHref}>{actionLabel}</a></Button>
          ) : (
            <Button onClick={onAction} className="rounded-full px-6">{actionLabel}</Button>
          )}
        </EmptyContent>
      )}
    </Empty>
  );
}
