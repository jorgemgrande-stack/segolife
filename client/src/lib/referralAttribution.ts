/**
 * referralAttribution.ts — SEGOLIFE REFERRAL & INVITE REWARDS ENGINE (Fase
 * 8, spec §5). Persistencia PRE-registro de "qué código de invitación abrió
 * este visitante" — deliberadamente NO hay tabla `referral_clicks` en el
 * servidor (ver server/segolife/referrals/referralService.ts, cabecera):
 * el cliente guarda código + timestamp en localStorage, y el servidor
 * revalida/liga la atribución de forma atómica en el propio registro
 * (POST /api/auth/register). Límite de confianza documentado: esto es una
 * señal de baja exigencia, no una garantía criptográfica (spec §27,
 * "sensato, no ML").
 */
const STORAGE_KEY = "segolife.referral_attribution";

export interface StoredReferralAttribution {
  code: string;
  clickedAt: number; // epoch ms
}

export function persistReferralClick(code: string): void {
  const trimmed = code.trim();
  if (!trimmed) return;
  try {
    const payload: StoredReferralAttribution = { code: trimmed, clickedAt: Date.now() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // localStorage puede no estar disponible (modo privado/cuota) — el
    // registro simplemente sigue sin código de invitación, nunca bloquea.
  }
}

export function getStoredReferralAttribution(): StoredReferralAttribution | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredReferralAttribution>;
    if (typeof parsed.code !== "string" || typeof parsed.clickedAt !== "number") return null;
    return { code: parsed.code, clickedAt: parsed.clickedAt };
  } catch {
    return null;
  }
}

export function clearReferralAttribution(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
}
