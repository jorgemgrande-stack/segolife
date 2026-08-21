import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useLocation } from "wouter";
import { toast } from "sonner";
import { Camera, ChevronLeft, Loader2, PackageSearch, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCommunity } from "@/contexts/CommunityContext";
import { SegolifeAppShell } from "@/components/segolife/SegolifeAppShell";
import { SegolifePageContainer } from "@/components/segolife/SegolifePageContainer";
import { SegolifeEmptyState } from "@/components/segolife/SegolifeEmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Mismos límites que lostFoundDb.ts/lostFoundPhotoService.ts (validación
// client-side es solo feedback rápido; la real es siempre server-side).
const DESCRIPTION_MAX_LENGTH = 2000;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

function todayInMadrid(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/**
 * LNF-01 — /:community/venues/:slug/lost-item. Formulario de autoservicio
 * del Student: identidad, venue y comunidad se resuelven SIEMPRE server-side
 * (sesión real + slug del venue de la URL, spec §1/§2) — nada de esto es un
 * campo editable aquí, nombre/email/teléfono son solo lectura contextual (si
 * el Student necesita corregirlos, lo hace en su Profile real, nunca un
 * segundo perfil). Un único envío multipart a POST /api/lost-found (foto
 * opcional incluida en la misma petición, spec §4/§19) — nunca dos pasos que
 * puedan dejar un caso a medias sin foto asociada.
 */
export default function LostItemForm() {
  const { t } = useTranslation();
  const { slug: communitySlug, community } = useCommunity();
  const { slug: venueSlug } = useParams<{ community: string; slug: string }>();
  const [, navigate] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: venueDetail, isLoading: venueLoading } = trpc.venues.publicGetBySlug.useQuery(
    { slug: venueSlug },
    { enabled: !!venueSlug }
  );
  const venue = venueDetail?.venue;
  const { data: me } = trpc.students.me.useQuery();

  const [lostDate, setLostDate] = useState(todayInMadrid());
  const [approximateTime, setApproximateTime] = useState("");
  const [description, setDescription] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<{ lostDate?: string; description?: string }>({});

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
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
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  function handleRemovePhoto() {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(null);
    setPhotoPreview(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting || !venue) return;

    const nextErrors: { lostDate?: string; description?: string } = {};
    if (!lostDate || lostDate > todayInMadrid()) nextErrors.lostDate = t("lostFound.futureDateError");
    if (!description.trim()) nextErrors.description = t("lostFound.descriptionRequiredError");
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("venueId", String(venue.id));
      if (community?.id) formData.append("communityId", String(community.id));
      formData.append("lostDate", lostDate);
      if (approximateTime) formData.append("approximateTime", approximateTime);
      formData.append("description", description.trim());
      if (photoFile) formData.append("photo", photoFile);

      const res = await fetch("/api/lost-found", { method: "POST", credentials: "include", body: formData });
      const resBody = await res.json().catch(() => null);
      if (!res.ok || !resBody?.success) throw new Error(resBody?.error ?? "failed");
      setSubmitted(true);
    } catch {
      toast.error(t("lostFound.genericError"));
    } finally {
      setSubmitting(false);
    }
  }

  if (venueLoading) {
    return (
      <SegolifeAppShell requireAuth hideNav title={t("lostFound.formTitle")}>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
        </div>
      </SegolifeAppShell>
    );
  }

  if (!venue) {
    return (
      <SegolifeAppShell requireAuth hideNav title={t("lostFound.formTitle")}>
        <SegolifePageContainer>
          <SegolifeEmptyState
            icon={<PackageSearch className="size-5" aria-hidden="true" />}
            title={t("venueDetail.notFoundTitle")}
            description={t("venueDetail.notFoundDescription")}
            actionLabel={t("nav.explore")}
            actionHref={`/${communitySlug}/explore`}
          />
        </SegolifePageContainer>
      </SegolifeAppShell>
    );
  }

  if (submitted) {
    return (
      <SegolifeAppShell requireAuth hideNav title={t("lostFound.formTitle")}>
        <SegolifePageContainer>
          <SegolifeEmptyState
            icon={<PackageSearch className="size-5" aria-hidden="true" />}
            title={t("lostFound.successTitle")}
            description={t("lostFound.successDescription")}
            actionLabel={t("lostFound.myLostItems")}
            actionHref={`/${communitySlug}/lost-items`}
          />
        </SegolifePageContainer>
      </SegolifeAppShell>
    );
  }

  return (
    <SegolifeAppShell requireAuth hideNav title={t("lostFound.formTitle")}>
      <SegolifePageContainer>
        <div className="mb-2">
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate(`/${communitySlug}/venues/${venueSlug}`)}>
            <ChevronLeft className="mr-1 size-4" aria-hidden="true" /> {t("common.back")}
          </Button>
        </div>

        <h1 className="mb-1 text-xl font-bold text-foreground">{t("lostFound.formTitle")}</h1>
        <p className="mb-5 text-sm text-muted-foreground">{venue.name}</p>

        <form onSubmit={handleSubmit} className="space-y-6" noValidate>
          <section className="segolife-card-shadow space-y-3 rounded-2xl bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">{t("lostFound.yourDetails")}</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">{t("lostFound.fullName")}</p>
                <p className="truncate text-sm text-foreground">{me?.user.name || "—"}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">{t("lostFound.email")}</p>
                <p className="truncate text-sm text-foreground">{me?.user.email || "—"}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">{t("lostFound.phone")}</p>
                <p className="truncate text-sm text-foreground">{me?.user.phone || "—"}</p>
              </div>
            </div>
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="lnf-lostDate">{t("lostFound.dateLostLabel")}</Label>
              <Input
                id="lnf-lostDate"
                type="date"
                max={todayInMadrid()}
                value={lostDate}
                onChange={e => setLostDate(e.target.value)}
                aria-invalid={!!errors.lostDate}
                aria-describedby={errors.lostDate ? "lnf-lostDate-error" : undefined}
              />
              {errors.lostDate && <p id="lnf-lostDate-error" className="text-xs text-destructive">{errors.lostDate}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lnf-approxTime">{t("lostFound.approximateTimeLabel")}</Label>
              <Input
                id="lnf-approxTime"
                type="time"
                value={approximateTime}
                onChange={e => setApproximateTime(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("lostFound.approximateTimeHint")}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lnf-description">{t("lostFound.descriptionLabel")}</Label>
            <Textarea
              id="lnf-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              maxLength={DESCRIPTION_MAX_LENGTH}
              rows={5}
              placeholder={t("lostFound.descriptionPlaceholder")}
              aria-invalid={!!errors.description}
              aria-describedby={errors.description ? "lnf-description-error" : undefined}
            />
            {errors.description && <p id="lnf-description-error" className="text-xs text-destructive">{errors.description}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lnf-photo">{t("lostFound.photoLabel")}</Label>
            <p className="text-xs text-muted-foreground">{t("lostFound.photoHint")}</p>
            {photoPreview ? (
              <div className="relative mt-1 inline-block">
                <img src={photoPreview} alt="" className="h-32 w-32 rounded-2xl object-cover" />
                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  aria-label={t("lostFound.photoRemove")}
                  className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-md"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-1.5 block text-xs font-medium text-primary"
                >
                  {t("lostFound.photoReplace")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-1 flex h-32 w-32 flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <Camera className="size-5" aria-hidden="true" />
                <span className="text-xs font-medium">{t("lostFound.photoLabel")}</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              id="lnf-photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={handleFileSelected}
            />
          </div>

          <Button type="submit" disabled={submitting} className="w-full rounded-full">
            {submitting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> {t("lostFound.submitting")}
              </>
            ) : (
              t("lostFound.submit")
            )}
          </Button>
        </form>
      </SegolifePageContainer>
    </SegolifeAppShell>
  );
}
