import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ImagePlus, Loader2, X } from "lucide-react";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export interface ProposalImageUploaderLabels {
  fieldLabel: string;
  addImage: string;
  removeImage: string;
  invalidType: string;
  tooLarge: string;
  uploadError: string;
}

interface ProposalImageUploaderProps {
  value: string;
  onChange: (url: string) => void;
  labels: ProposalImageUploaderLabels;
  /** Se notifica mientras la subida está en curso, para que el formulario contenedor pueda deshabilitar su propio botón de enviar/guardar. */
  onUploadingChange?: (uploading: boolean) => void;
}

/**
 * Subida real de imagen de portada para propuestas de COMUNITY — reutiliza
 * SIEMPRE el mismo endpoint (`POST /api/community/proposal-image`, con
 * validación real de tipo/tamaño/dimensiones y reescalado server-side vía
 * communityProposalImageService.ts) tanto si quien sube es un Student
 * (ComunityHub.tsx ProponerTab) como un Admin (ComunityWizard.tsx,
 * ComunityEditDialog.tsx) — nunca una URL a pegar a mano (bug real
 * encontrado en producción: una imagen de portada "URL" que el admin nunca
 * rellenaba dejaba la propuesta sin imagen aunque el Student sí hubiera
 * subido una — ver convertStudentProposalToFormal en server/routers/community.ts).
 */
export function ProposalImageUploader({ value, onChange, labels, onUploadingChange }: ProposalImageUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function setUploadingState(v: boolean) {
    setUploading(v);
    onUploadingChange?.(v);
  }

  async function handleImageSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite re-seleccionar el mismo archivo dos veces seguidas
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) { toast.error(labels.invalidType); return; }
    if (file.size > MAX_IMAGE_BYTES) { toast.error(labels.tooLarge); return; }

    setUploadingState(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch("/api/community/proposal-image", { method: "POST", credentials: "include", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "upload_failed");
      }
      const body = await res.json();
      onChange(body.url);
    } catch {
      toast.error(labels.uploadError);
    } finally {
      setUploadingState(false);
    }
  }

  return (
    <div>
      <Label className="mb-1.5 block">{labels.fieldLabel}</Label>
      <input ref={fileInputRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp" className="hidden" onChange={handleImageSelected} />
      {value ? (
        <div className="relative inline-block">
          <img src={value} alt="" className="h-28 w-full max-w-xs rounded-xl object-cover" />
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label={labels.removeImage}
            className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
          {uploading ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <ImagePlus className="size-3.5 mr-1.5" />}
          {labels.addImage}
        </Button>
      )}
    </div>
  );
}
