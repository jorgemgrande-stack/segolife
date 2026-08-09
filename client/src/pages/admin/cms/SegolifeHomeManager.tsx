import { useRef, useState } from "react";
import { Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Home, Image as ImageIcon, CalendarDays, Store, Star, Upload,
  ArrowUp, ArrowDown, Trash2, ExternalLink, Search, Loader2, X,
} from "lucide-react";

/**
 * Editor real de los módulos de la Home pública actual (PublicHome.tsx),
 * pedido por el usuario tras notar que no había un sitio único para
 * gestionarlos — antes estaban repartidos entre Galería, Eventos y Venues.
 * No sustituye esos gestores (siguen siendo la vía para editar/borrar en
 * detalle), los consolida para el caso de uso "qué se ve en la Home hoy".
 *
 * "Módulos Home" (legacy, /admin/cms/modulos-home → HomeModulesManager)
 * sigue existiendo sin tocar — gestiona Home.tsx, no PublicHome.tsx.
 */
export default function SegolifeHomeManager() {
  return (
    <AdminLayout title="Módulos Home">
      <div className="space-y-8">
        <div className="flex items-center gap-3">
          <Home className="w-6 h-6 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-foreground">Módulos de la Home</h2>
            <p className="text-sm text-muted-foreground">Qué se ve hoy en la Home pública (segolife-production.up.railway.app/)</p>
          </div>
        </div>

        <HeroSection />
        <FeaturedSection
          kind="events"
          title="Lo que se cuece"
          subtitle="Eventos destacados — se muestran primero en la Home"
          icon={<CalendarDays className="w-5 h-5 text-primary" />}
          manageHref="/admin/events"
        />
        <FeaturedSection
          kind="venues"
          title="Esta noche en Segovia"
          subtitle="Locales destacados — se muestran primero en la Home"
          icon={<Store className="w-5 h-5 text-primary" />}
          manageHref="/admin/venues"
        />
      </div>
    </AdminLayout>
  );
}

// ─── HERO ───────────────────────────────────────────────────────────────────

function HeroSection() {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const { data: allItems, isLoading } = trpc.gallery.adminGetAll.useQuery();
  const heroPhotos = (allItems ?? [])
    .filter(i => i.category === "home_hero")
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const createMutation = trpc.gallery.adminCreate.useMutation({
    onSuccess: () => utils.gallery.adminGetAll.invalidate(),
  });
  const deleteMutation = trpc.gallery.adminDelete.useMutation({
    onSuccess: () => { utils.gallery.adminGetAll.invalidate(); toast.success("Foto quitada del hero"); },
  });
  const reorderMutation = trpc.gallery.adminReorder.useMutation({
    onSuccess: () => utils.gallery.adminGetAll.invalidate(),
  });

  const uploadFile = async (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("Solo se aceptan imágenes"); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error("El archivo supera el límite de 10 MB"); return; }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch("/api/upload/image", { method: "POST", body: formData, credentials: "include" });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Error al subir la imagen"); return; }
      await createMutation.mutateAsync({
        imageUrl: data.url, fileKey: data.key, title: file.name,
        category: "home_hero", isActive: true,
      });
      toast.success(`"${file.name}" añadida al hero`);
    } catch {
      toast.error("Error de conexión al subir la imagen");
    }
    setUploading(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    for (const file of Array.from(e.target.files || [])) await uploadFile(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= heroPhotos.length) return;
    const reordered = [...heroPhotos];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    // El resto de fotos (otras categorías) conservan su sortOrder relativo;
    // solo reescribimos el orden dentro del propio hero.
    const otherIds = (allItems ?? []).filter(i => i.category !== "home_hero").map(i => i.id);
    reorderMutation.mutate({ orderedIds: [...reordered.map(p => p.id), ...otherIds] });
  };

  return (
    <section className="bg-card border border-border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ImageIcon className="w-5 h-5 text-primary" />
          <div>
            <h3 className="font-semibold text-foreground">Hero</h3>
            <p className="text-xs text-muted-foreground">Fotos de portada de la Home — la primera es la principal</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/cms/galeria" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            Editar en Galería <ExternalLink className="w-3 h-3" />
          </Link>
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <Upload className="w-4 h-4 mr-2" />
            {uploading ? "Subiendo…" : "Añadir foto"}
          </Button>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : heroPhotos.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          Sin fotos en el hero todavía — la Home muestra un fondo con los colores de SEGOLIFE hasta que subas alguna.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {heroPhotos.map((photo, i) => (
            <div key={photo.id} className="group relative aspect-square rounded-lg overflow-hidden border border-border bg-muted">
              <img src={photo.imageUrl} alt={photo.title ?? ""} className="w-full h-full object-cover" loading="lazy" />
              {i === 0 && <Badge className="absolute top-1.5 left-1.5 text-[10px]">Principal</Badge>}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5 p-2">
                <div className="flex gap-1">
                  <Button size="sm" variant="secondary" className="h-6 w-6 p-0" onClick={() => move(i, -1)} disabled={i === 0} title="Mover antes">
                    <ArrowUp className="w-3 h-3" />
                  </Button>
                  <Button size="sm" variant="secondary" className="h-6 w-6 p-0" onClick={() => move(i, 1)} disabled={i === heroPhotos.length - 1} title="Mover después">
                    <ArrowDown className="w-3 h-3" />
                  </Button>
                </div>
                <Button
                  size="sm" variant="destructive" className="h-6 text-[10px] px-2"
                  onClick={() => deleteMutation.mutate({ id: photo.id })}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="w-3 h-3 mr-1" /> Quitar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── EVENTOS / VENUES DESTACADOS ────────────────────────────────────────────

function FeaturedSection({
  kind, title, subtitle, icon, manageHref,
}: {
  kind: "events" | "venues";
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  manageHref: string;
}) {
  const [search, setSearch] = useState("");
  const utils = trpc.useUtils();

  const featuredQuery = kind === "events"
    ? trpc.events.list.useQuery({ communityId: "all", status: "active", isFeatured: true, limit: 50, offset: 0 })
    : trpc.venues.list.useQuery({ communityId: "all", status: "active", isFeatured: true, limit: 50, offset: 0 });

  const searchQuery = kind === "events"
    ? trpc.events.list.useQuery(
        { communityId: "all", status: "active", isFeatured: false, search: search || undefined, limit: 10, offset: 0 },
        { enabled: search.length > 0 }
      )
    : trpc.venues.list.useQuery(
        { communityId: "all", status: "active", isFeatured: false, search: search || undefined, limit: 10, offset: 0 },
        { enabled: search.length > 0 }
      );

  const setFeaturedEvent = trpc.events.setFeatured.useMutation({
    onSuccess: () => { utils.events.list.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const setFeaturedVenue = trpc.venues.setFeatured.useMutation({
    onSuccess: () => { utils.venues.list.invalidate(); },
    onError: e => toast.error(e.message),
  });

  const setFeatured = (id: number, featured: boolean) => {
    if (kind === "events") setFeaturedEvent.mutate({ id, featured });
    else setFeaturedVenue.mutate({ id, featured });
  };

  const featuredItems = featuredQuery.data?.items ?? [];
  const searchResults = searchQuery.data?.items ?? [];

  return (
    <section className="bg-card border border-border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <div>
            <h3 className="font-semibold text-foreground">{title}</h3>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <Link href={manageHref} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          Gestionar todos <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      {featuredQuery.isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : featuredItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nada destacado todavía — busca abajo para añadir.</p>
      ) : (
        <div className="space-y-2">
          {featuredItems.map(item => (
            <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <Star className="w-4 h-4 fill-yellow-400 text-yellow-400 shrink-0" />
                <span className="text-sm font-medium text-foreground truncate">{item.name}</span>
              </div>
              <Button
                size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-destructive"
                onClick={() => setFeatured(item.id, false)}
                title="Quitar de destacados"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="relative pt-2 border-t border-border">
        <div className="relative mt-3">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={kind === "events" ? "Buscar evento activo para destacar…" : "Buscar local activo para destacar…"}
            className="pl-9"
          />
        </div>
        {search.length > 0 && (
          <div className="mt-2 space-y-1">
            {searchQuery.isLoading ? (
              <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
            ) : searchResults.length === 0 ? (
              <p className="text-xs text-muted-foreground px-1 py-2">Sin resultados activos que coincidan.</p>
            ) : (
              searchResults.map(item => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg hover:bg-accent/50 px-3 py-2">
                  <span className="text-sm text-foreground truncate">{item.name}</span>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setFeatured(item.id, true)}>
                    <Star className="w-3.5 h-3.5 mr-1" /> Destacar
                  </Button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </section>
  );
}
