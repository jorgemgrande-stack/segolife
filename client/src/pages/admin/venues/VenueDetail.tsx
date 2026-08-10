import { useState, useEffect, useRef } from "react";
import { useParams, useLocation, Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Store, Sparkles, Clock, Package, Trash2, QrCode, Image as ImageIcon, Upload, Plus, CalendarDays } from "lucide-react";
import { VenueCommerceTab } from "./VenueCommerceTab";
import { splitUpcomingPast } from "@shared/segolife/eventTiming";

const NONE = "__none__";
const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function FutureModulePlaceholder({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground border border-dashed border-border rounded-lg justify-center">
      <Sparkles className="w-4 h-4" />
      {label} — todavía no implementado en esta fase
    </div>
  );
}

/** Pestaña SegoTokens de la ficha de venue — horarios earn/spend + catálogo de productos. */
function VenueSegoTokensTab({ venueId }: { venueId: number }) {
  const utils = trpc.useUtils();
  const [scheduleForm, setScheduleForm] = useState({ operationType: "earn" as "earn" | "spend", dayOfWeek: "1", startTime: "09:00", endTime: "23:00" });
  const [productForm, setProductForm] = useState({ name: "", slug: "", category: "", price: "" });

  const { data: schedules, isLoading: loadingSchedules } = trpc.tokens.listSchedules.useQuery({ venueId });
  const { data: products, isLoading: loadingProducts } = trpc.tokens.listVenueProducts.useQuery({ venueId });

  const createScheduleMut = trpc.tokens.createSchedule.useMutation({
    onSuccess: () => { utils.tokens.listSchedules.invalidate({ venueId }); toast.success("Horario añadido"); },
    onError: e => toast.error(e.message),
  });
  const deleteScheduleMut = trpc.tokens.deleteSchedule.useMutation({
    onSuccess: () => utils.tokens.listSchedules.invalidate({ venueId }),
    onError: e => toast.error(e.message),
  });
  const setScheduleActiveMut = trpc.tokens.setScheduleActive.useMutation({
    onSuccess: () => utils.tokens.listSchedules.invalidate({ venueId }),
    onError: e => toast.error(e.message),
  });

  const createProductMut = trpc.tokens.createVenueProduct.useMutation({
    onSuccess: () => { utils.tokens.listVenueProducts.invalidate({ venueId }); toast.success("Producto añadido"); setProductForm({ name: "", slug: "", category: "", price: "" }); },
    onError: e => toast.error(e.message),
  });
  const setProductActiveMut = trpc.tokens.setVenueProductActive.useMutation({
    onSuccess: () => utils.tokens.listVenueProducts.invalidate({ venueId }),
    onError: e => toast.error(e.message),
  });

  const earnSchedules = (schedules ?? []).filter(s => s.operationType === "earn");
  const spendSchedules = (schedules ?? []).filter(s => s.operationType === "spend");

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Horarios de ganar / gastar tokens</h3>
        </div>
        <p className="text-xs text-muted-foreground">Sin ninguna franja configurada, el venue permite ganar/gastar en cualquier momento.</p>

        <div className="flex flex-wrap gap-2 items-end">
          <Select value={scheduleForm.operationType} onValueChange={v => setScheduleForm(f => ({ ...f, operationType: v as "earn" | "spend" }))}>
            <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="earn">Ganar</SelectItem><SelectItem value="spend">Gastar</SelectItem></SelectContent>
          </Select>
          <Select value={scheduleForm.dayOfWeek} onValueChange={v => setScheduleForm(f => ({ ...f, dayOfWeek: v }))}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>{WEEKDAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}</SelectContent>
          </Select>
          <Input type="time" className="w-[110px]" value={scheduleForm.startTime} onChange={e => setScheduleForm(f => ({ ...f, startTime: e.target.value }))} />
          <span className="text-muted-foreground text-sm">a</span>
          <Input type="time" className="w-[110px]" value={scheduleForm.endTime} onChange={e => setScheduleForm(f => ({ ...f, endTime: e.target.value }))} />
          <Button
            size="sm"
            disabled={createScheduleMut.isPending}
            onClick={() => createScheduleMut.mutate({ venueId, operationType: scheduleForm.operationType, dayOfWeek: Number(scheduleForm.dayOfWeek), startTime: scheduleForm.startTime, endTime: scheduleForm.endTime })}
          >
            Añadir franja
          </Button>
        </div>

        {loadingSchedules ? (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(["earn", "spend"] as const).map(type => (
              <div key={type}>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">{type === "earn" ? "Ganar" : "Gastar"}</p>
                <div className="space-y-1.5">
                  {(type === "earn" ? earnSchedules : spendSchedules).length === 0 ? (
                    <p className="text-xs text-muted-foreground">Sin restricción — permitido siempre.</p>
                  ) : (type === "earn" ? earnSchedules : spendSchedules).map(s => (
                    <div key={s.id} className="flex items-center justify-between text-sm bg-accent/40 rounded-md px-2.5 py-1.5">
                      <span className="text-foreground">{WEEKDAYS[s.dayOfWeek]} {s.startTime}–{s.endTime}</span>
                      <div className="flex items-center gap-1.5">
                        <Switch checked={s.active} onCheckedChange={v => setScheduleActiveMut.mutate({ id: s.id, active: v })} />
                        <button onClick={() => deleteScheduleMut.mutate({ id: s.id })} className="hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Productos (catálogo para reglas SegoTokens)</h3>
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <Input placeholder="Nombre (ej: Cóctel)" className="w-[180px]" value={productForm.name}
            onChange={e => setProductForm(f => ({ ...f, name: e.target.value, slug: e.target.value.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") }))} />
          <Input placeholder="slug" className="w-[140px]" value={productForm.slug} onChange={e => setProductForm(f => ({ ...f, slug: e.target.value }))} />
          <Input placeholder="Categoría" className="w-[140px]" value={productForm.category} onChange={e => setProductForm(f => ({ ...f, category: e.target.value }))} />
          <Input placeholder="Precio €" className="w-[100px]" value={productForm.price} onChange={e => setProductForm(f => ({ ...f, price: e.target.value }))} />
          <Button
            size="sm"
            disabled={createProductMut.isPending || !productForm.name || !productForm.slug}
            onClick={() => createProductMut.mutate({ venueId, name: productForm.name, slug: productForm.slug, category: productForm.category || undefined, price: productForm.price || undefined })}
          >
            Añadir producto
          </Button>
        </div>
        {loadingProducts ? (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        ) : (products ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin productos todavía.</p>
        ) : (
          <div className="space-y-1.5">
            {(products ?? []).map(p => (
              <div key={p.id} className="flex items-center justify-between text-sm bg-accent/40 rounded-md px-2.5 py-1.5">
                <span className="text-foreground">{p.name} {p.category && <span className="text-muted-foreground">· {p.category}</span>} {p.price && <span className="text-muted-foreground">· {p.price}€</span>}</span>
                <Switch checked={p.isActive} onCheckedChange={v => setProductActiveMut.mutate({ id: p.id, active: v })} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Pestaña QR de la ficha de venue — batches, últimos canjes y tasa de canje real (Fase 3). */
function VenueQrTab({ venueId }: { venueId: number }) {
  const { data, isLoading } = trpc.consumptionQr.list.useQuery({ communityId: "all", venueId, limit: 200, offset: 0 });
  const { data: batches } = trpc.consumptionQr.listBatches.useQuery({ communityId: "all", venueId });

  const items = data?.items ?? [];
  const issuedTotal = items.length;
  const redeemedTotal = items.filter(q => q.status === "redeemed").length;
  const redemptionRate = issuedTotal > 0 ? Math.round((redeemedTotal / issuedTotal) * 100) : null;
  const recentRedemptions = items.filter(q => q.status === "redeemed").slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between bg-card border border-border rounded-lg p-5">
        <div className="flex items-center gap-2">
          <QrCode className="w-5 h-5 text-primary" />
          <p className="text-sm text-muted-foreground">Generación y auditoría de QR de consumición para este venue.</p>
        </div>
        <Link href="/admin/qr"><Button size="sm"><QrCode className="w-4 h-4 mr-2" />Generar QR</Button></Link>
      </div>

      {isLoading ? (
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">QR emitidos</p>
              <p className="text-2xl font-semibold text-foreground">{issuedTotal}</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Canjeados</p>
              <p className="text-2xl font-semibold text-emerald-600">{redeemedTotal}</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Tasa de canje</p>
              <p className="text-2xl font-semibold text-foreground">{redemptionRate != null ? `${redemptionRate}%` : "—"}</p>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-sm font-semibold text-foreground mb-3">Lotes de este venue</p>
            {!batches || batches.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin lotes todavía.</p>
            ) : (
              <div className="space-y-1.5">
                {batches.map(b => (
                  <div key={b.id} className="flex items-center justify-between text-sm bg-accent/40 rounded-md px-2.5 py-1.5">
                    <span className="text-foreground">Lote #{b.id} · {b.quantity} códigos</span>
                    <span className="text-xs text-muted-foreground">{new Date(b.createdAt).toLocaleDateString("es-ES")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-sm font-semibold text-foreground mb-3">Últimos canjes</p>
            {recentRedemptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin canjes todavía.</p>
            ) : (
              <div className="space-y-1.5">
                {recentRedemptions.map(q => (
                  <div key={q.id} className="flex items-center justify-between text-sm bg-accent/40 rounded-md px-2.5 py-1.5">
                    <span className="text-foreground">{q.redeemedByName ?? `Usuario #${q.redeemedByUserId}`}{q.productName ? ` · ${q.productName}` : ""}</span>
                    <span className="text-xs text-muted-foreground">{q.redeemedAt ? new Date(q.redeemedAt).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Beneficios GENERADOS (este venue como ORIGEN de la regla que los concedió)
 * vs CANJEADOS (este venue como DESTINO donde se validaron) — nunca se
 * asume que origen y destino coinciden, ver drizzle/schema.ts comentario de
 * benefit_rules ("cross-venue").
 */
function VenueBenefitsTab({ venueId }: { venueId: number }) {
  const { data: stats, isLoading } = trpc.benefits.getVenueStats.useQuery({ venueId });
  const { data: generated } = trpc.benefits.listGrants.useQuery({ communityId: "all", sourceVenueId: venueId, limit: 10, offset: 0 });
  const { data: redeemed } = trpc.benefits.listGrants.useQuery({ communityId: "all", destinationVenueId: venueId, status: "used", limit: 10, offset: 0 });

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Beneficios generados (origen)</p>
          <p className="text-2xl font-semibold text-foreground">{stats?.generatedCount ?? 0}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Beneficios canjeados (destino)</p>
          <p className="text-2xl font-semibold text-emerald-600">{stats?.redeemedCount ?? 0}</p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-4">
        <p className="text-sm font-semibold text-foreground mb-3">Últimos generados aquí (origen)</p>
        {!generated || generated.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin beneficios generados desde este venue todavía.</p>
        ) : (
          <div className="space-y-1.5">
            {generated.items.map(g => (
              <div key={g.id} className="flex items-center justify-between text-sm bg-accent/40 rounded-md px-2.5 py-1.5">
                <span className="text-foreground">{g.definitionName}{g.destinationVenueName ? ` → ${g.destinationVenueName}` : ""}</span>
                <Badge variant={g.status === "active" ? "default" : g.status === "used" ? "secondary" : "outline"}>{g.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-lg p-4">
        <p className="text-sm font-semibold text-foreground mb-3">Últimos canjeados aquí (destino)</p>
        {!redeemed || redeemed.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin canjes en este venue todavía.</p>
        ) : (
          <div className="space-y-1.5">
            {redeemed.items.map(g => (
              <div key={g.id} className="flex items-center justify-between text-sm bg-accent/40 rounded-md px-2.5 py-1.5">
                <span className="text-foreground">{g.definitionName}{g.sourceVenueName ? ` (origen: ${g.sourceVenueName})` : ""}</span>
                <span className="text-xs text-muted-foreground">{g.usedAt ? new Date(g.usedAt).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Pestaña Media (Fase 8.6, punto 36) — logo/cover/galería del venue.
 * REUSE: mismo endpoint /api/upload/image + gallery.adminCreate/adminDelete
 * ya usados en GalleryManager.tsx/SegolifeHomeManager.tsx — sin workflow de
 * pegar URLs a mano. Logo=venues.imageUrl (object-contain), Cover=
 * venues.coverImageUrl (object-cover), Galería=gallery_items con este
 * venueId y category="venue_gallery" (distinta de "home_hero", que es solo
 * para el hero de PublicHome).
 */
function VenueMediaTab({ venueId, imageUrl, coverImageUrl }: { venueId: number; imageUrl: string | null; coverImageUrl: string | null }) {
  const utils = trpc.useUtils();
  const logoRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [uploadingSlot, setUploadingSlot] = useState<"logo" | "cover" | "gallery" | null>(null);

  const { data: allItems, isLoading: loadingGallery } = trpc.gallery.adminGetAll.useQuery();
  const galleryPhotos = (allItems ?? []).filter(i => i.venueId === venueId && i.category === "venue_gallery");

  const updateVenueMut = trpc.venues.update.useMutation({
    onSuccess: () => { utils.venues.getById.invalidate({ id: venueId }); toast.success("Imagen actualizada"); },
    onError: e => toast.error(e.message),
  });
  const createGalleryMut = trpc.gallery.adminCreate.useMutation({
    onSuccess: () => { utils.gallery.adminGetAll.invalidate(); toast.success("Foto añadida a la galería"); },
    onError: e => toast.error(e.message),
  });
  const deleteGalleryMut = trpc.gallery.adminDelete.useMutation({
    onSuccess: () => utils.gallery.adminGetAll.invalidate(),
  });

  async function uploadTo(slot: "logo" | "cover" | "gallery", file: File) {
    setUploadingSlot(slot);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch("/api/upload/image", { method: "POST", body: formData, credentials: "include" });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Error al subir la imagen"); return; }
      if (slot === "logo") updateVenueMut.mutate({ id: venueId, imageUrl: data.url });
      else if (slot === "cover") updateVenueMut.mutate({ id: venueId, coverImageUrl: data.url });
      else createGalleryMut.mutate({ imageUrl: data.url, fileKey: data.key, title: file.name, category: "venue_gallery", isActive: true, venueId });
    } catch {
      toast.error("Error de conexión al subir la imagen");
    }
    setUploadingSlot(null);
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <p className="text-sm font-semibold text-foreground">Logo</p>
          <p className="text-xs text-muted-foreground">object-contain — admite transparencia. Se usa en el hero y en las cards.</p>
          <div className="flex size-24 items-center justify-center rounded-xl border border-dashed border-border bg-secondary/30 p-2">
            {imageUrl ? <img src={imageUrl} alt="Logo" className="max-h-full max-w-full object-contain" /> : <ImageIcon className="size-6 text-muted-foreground" />}
          </div>
          <Button size="sm" variant="outline" disabled={uploadingSlot === "logo"} onClick={() => logoRef.current?.click()}>
            <Upload className="w-3.5 h-3.5 mr-1.5" /> {uploadingSlot === "logo" ? "Subiendo…" : "Cambiar logo"}
          </Button>
          <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && uploadTo("logo", e.target.files[0])} />
        </div>

        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <p className="text-sm font-semibold text-foreground">Cover</p>
          <p className="text-xs text-muted-foreground">object-cover — fotografía grande del hero de la ficha pública.</p>
          <div className="aspect-video overflow-hidden rounded-xl border border-dashed border-border bg-secondary/30">
            {coverImageUrl ? <img src={coverImageUrl} alt="Cover" className="size-full object-cover" /> : <div className="flex size-full items-center justify-center"><ImageIcon className="size-6 text-muted-foreground" /></div>}
          </div>
          <Button size="sm" variant="outline" disabled={uploadingSlot === "cover"} onClick={() => coverRef.current?.click()}>
            <Upload className="w-3.5 h-3.5 mr-1.5" /> {uploadingSlot === "cover" ? "Subiendo…" : "Cambiar cover"}
          </Button>
          <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && uploadTo("cover", e.target.files[0])} />
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">Galería ({galleryPhotos.length})</p>
          <Button size="sm" disabled={uploadingSlot === "gallery"} onClick={() => galleryRef.current?.click()}>
            <Plus className="w-3.5 h-3.5 mr-1.5" /> {uploadingSlot === "gallery" ? "Subiendo…" : "Añadir foto"}
          </Button>
          <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && uploadTo("gallery", e.target.files[0])} />
        </div>
        {loadingGallery ? (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        ) : galleryPhotos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin fotos de galería todavía.</p>
        ) : (
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {galleryPhotos.map(p => (
              <div key={p.id} className="group relative aspect-square overflow-hidden rounded-lg border border-border">
                <img src={p.imageUrl} alt={p.title ?? ""} className="size-full object-cover" />
                <button
                  onClick={() => deleteGalleryMut.mutate({ id: p.id })}
                  className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100"
                  title="Quitar de la galería"
                >
                  <Trash2 className="size-4 text-white" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function VenueDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const venueId = Number(params.id);
  const utils = trpc.useUtils();

  const { data: detail, isLoading, error } = trpc.venues.getById.useQuery({ id: venueId });
  const { data: categories } = trpc.venues.listCategories.useQuery();
  const { data: allCommunities } = trpc.communities.list.useQuery();
  const { data: events } = trpc.events.publicByVenue.useQuery({ venueId }, { enabled: !!venueId });

  const [form, setForm] = useState({
    name: "", slug: "", tagline: "", description: "", categoryId: NONE,
    address: "", city: "", phone: "", email: "", website: "", instagramUrl: "", imageUrl: "",
  });
  const [selectedCommunities, setSelectedCommunities] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!detail) return;
    setForm({
      name: detail.venue.name,
      slug: detail.venue.slug,
      tagline: detail.venue.tagline ?? "",
      description: detail.venue.description ?? "",
      categoryId: detail.venue.categoryId ? String(detail.venue.categoryId) : NONE,
      address: detail.venue.address ?? "",
      city: detail.venue.city,
      phone: detail.venue.phone ?? "",
      email: detail.venue.email ?? "",
      website: detail.venue.website ?? "",
      instagramUrl: detail.venue.instagramUrl ?? "",
      imageUrl: detail.venue.imageUrl ?? "",
    });
    setSelectedCommunities(new Set(detail.communities.map(c => c.id)));
  }, [detail]);

  const updateMut = trpc.venues.update.useMutation({
    onSuccess: () => { toast.success("Venue actualizado"); utils.venues.getById.invalidate({ id: venueId }); utils.venues.list.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const setActiveMut = trpc.venues.setActive.useMutation({
    onSuccess: () => { toast.success("Estado actualizado"); utils.venues.getById.invalidate({ id: venueId }); utils.venues.list.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const setCommunitiesMut = trpc.venues.setCommunities.useMutation({
    onSuccess: () => { toast.success("Comunidades actualizadas"); utils.venues.getById.invalidate({ id: venueId }); utils.venues.list.invalidate(); },
    onError: e => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <AdminLayout title="Venue">
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      </AdminLayout>
    );
  }

  if (error || !detail) {
    return (
      <AdminLayout title="Venue">
        <div className="py-16 text-center text-sm text-destructive">{error?.message ?? "Venue no encontrado"}</div>
      </AdminLayout>
    );
  }

  const toggleCommunity = (id: number) => {
    setSelectedCommunities(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const saveGeneral = () => {
    updateMut.mutate({
      id: venueId,
      name: form.name,
      slug: form.slug,
      tagline: form.tagline || null,
      description: form.description || null,
      categoryId: form.categoryId !== NONE ? Number(form.categoryId) : null,
      address: form.address || null,
      city: form.city || undefined,
      phone: form.phone || null,
      email: form.email || null,
      website: form.website || null,
      instagramUrl: form.instagramUrl || null,
      imageUrl: form.imageUrl || null,
    });
  };

  return (
    <AdminLayout title="Venue">
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin/venues")} className="gap-1 -ml-2">
          <ArrowLeft className="w-4 h-4" /> Volver al listado
        </Button>

        <div className="flex items-start gap-4 bg-card border border-border rounded-lg p-5">
          <div className="w-16 h-16 rounded-lg bg-primary/10 flex items-center justify-center">
            <Store className="w-8 h-8 text-primary" />
          </div>
          <div className="flex-1 space-y-1">
            <h2 className="text-xl font-semibold text-foreground">{detail.venue.name}</h2>
            <p className="text-sm text-muted-foreground">/{detail.venue.slug}</p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {detail.category && <Badge variant="secondary">{detail.category.name}</Badge>}
              {detail.communities.map(c => <Badge key={c.id} variant="secondary">{c.name}</Badge>)}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Activo</span>
            <Switch
              checked={detail.venue.status === "active"}
              onCheckedChange={v => setActiveMut.mutate({ id: venueId, active: v })}
            />
          </div>
        </div>

        <Tabs defaultValue="general">
          <TabsList>
            <TabsTrigger value="general">Datos generales</TabsTrigger>
            <TabsTrigger value="media">Media</TabsTrigger>
            <TabsTrigger value="comunidades">Comunidades</TabsTrigger>
            <TabsTrigger value="eventos">Eventos</TabsTrigger>
            <TabsTrigger value="segotokens">SegoTokens</TabsTrigger>
            <TabsTrigger value="qr">QR / Consumiciones</TabsTrigger>
            <TabsTrigger value="benefits">Benefits</TabsTrigger>
            <TabsTrigger value="commerce">Commerce / Integrations</TabsTrigger>
            <TabsTrigger value="futuro">Próximamente</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="bg-card border border-border rounded-lg p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Nombre</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <Label>Slug</Label>
                <Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} />
              </div>
              <div className="md:col-span-2">
                <Label>Tagline</Label>
                <Input value={form.tagline} onChange={e => setForm(f => ({ ...f, tagline: e.target.value }))} placeholder="Frase corta para el hero — ej: Discoteca · Segovia centro" />
              </div>
              <div>
                <Label>Categoría</Label>
                <Select value={form.categoryId} onValueChange={v => setForm(f => ({ ...f, categoryId: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sin categorizar</SelectItem>
                    {(categories ?? []).map(c => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Ciudad</Label>
                <Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
              </div>
              <div>
                <Label>Dirección</Label>
                <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
              </div>
              <div>
                <Label>Teléfono</Label>
                <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div>
                <Label>Email</Label>
                <Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div>
                <Label>Web</Label>
                <Input value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} />
              </div>
              <div>
                <Label>Instagram</Label>
                <Input value={form.instagramUrl} onChange={e => setForm(f => ({ ...f, instagramUrl: e.target.value }))} placeholder="https://instagram.com/…" />
              </div>
              <div>
                <Label>URL de logo</Label>
                <Input value={form.imageUrl} onChange={e => setForm(f => ({ ...f, imageUrl: e.target.value }))} placeholder="https://…" />
                <p className="mt-1 text-xs text-muted-foreground">El cover y la galería se gestionan en la pestaña Media.</p>
              </div>
            </div>
            <div>
              <Label>Descripción</Label>
              <Textarea rows={4} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <Button onClick={saveGeneral} disabled={updateMut.isPending}>Guardar cambios</Button>
          </TabsContent>

          <TabsContent value="comunidades" className="bg-card border border-border rounded-lg p-5 space-y-4">
            <p className="text-sm text-muted-foreground">Comunidades a las que pertenece este venue (IE, UVA, futuros campus…).</p>
            <div className="space-y-2">
              {(allCommunities ?? []).map(c => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={selectedCommunities.has(c.id)} onCheckedChange={() => toggleCommunity(c.id)} />
                  {c.name}
                </label>
              ))}
            </div>
            <Button
              onClick={() => setCommunitiesMut.mutate({ id: venueId, communityIds: Array.from(selectedCommunities) })}
              disabled={setCommunitiesMut.isPending}
            >
              Guardar comunidades
            </Button>
          </TabsContent>

          <TabsContent value="media" className="bg-card border border-border rounded-lg p-5">
            <VenueMediaTab venueId={venueId} imageUrl={detail.venue.imageUrl} coverImageUrl={detail.venue.coverImageUrl} />
          </TabsContent>

          <TabsContent value="eventos" className="bg-card border border-border rounded-lg p-5 space-y-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Eventos anclados a este venue.</p>
              <Button size="sm" onClick={() => navigate(`/admin/events/new?venueId=${venueId}`)}>
                <CalendarDays className="w-3.5 h-3.5 mr-1.5" /> Nuevo evento en este venue
              </Button>
            </div>
            {(() => {
              const { upcoming, past } = splitUpcomingPast(events ?? []);
              return (
                <>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Próximos ({upcoming.length})</p>
                    {upcoming.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Sin eventos próximos.</p>
                    ) : (
                      <div className="space-y-2">
                        {upcoming.map(e => (
                          <Link key={e.id} href={`/admin/events/${e.id}`} className="block text-sm bg-accent/40 hover:bg-accent rounded-md p-3 flex items-center justify-between">
                            <span className="text-foreground">{e.name}</span>
                            <span className="text-xs text-muted-foreground">{new Date(e.startsAt).toLocaleDateString("es-ES")}</span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Pasados ({past.length})</p>
                    {past.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Sin eventos pasados todavía.</p>
                    ) : (
                      <div className="space-y-2">
                        {past.map(e => (
                          <Link key={e.id} href={`/admin/events/${e.id}`} className="block text-sm bg-secondary/40 hover:bg-secondary rounded-md p-3 flex items-center justify-between text-muted-foreground">
                            <span>{e.name}</span>
                            <span className="text-xs">{new Date(e.startsAt).toLocaleDateString("es-ES")}</span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </TabsContent>

          <TabsContent value="segotokens">
            <VenueSegoTokensTab venueId={venueId} />
          </TabsContent>

          <TabsContent value="qr">
            <VenueQrTab venueId={venueId} />
          </TabsContent>

          <TabsContent value="benefits">
            <VenueBenefitsTab venueId={venueId} />
          </TabsContent>

          <TabsContent value="commerce" className="bg-card border border-border rounded-lg p-5">
            <VenueCommerceTab venueId={venueId} />
          </TabsContent>

          <TabsContent value="futuro" className="space-y-3">
            <FutureModulePlaceholder label="Estadísticas de actividad" />
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
