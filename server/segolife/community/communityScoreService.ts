/**
 * communityScoreService.ts — COMUNITY Score (spec puntos 38-39). Función
 * PURA — recibe datos ya obtenidos (mismo criterio que
 * studentIntelligenceService.ts de Student 360: sin I/O, testeable sin BD).
 *
 * Fórmula PROPUESTA, no ajustada con datos reales todavía (spec punto 39:
 * "NO hardcodear hasta confirmar datos reales") — pesos documentados en un
 * único sitio, explicables vía el desglose que devuelve la función. Nunca
 * penaliza por audiencia pequeña (spec: "no penalizar injustamente") — la
 * dimensión de calidad de muestra satura en 100 a partir de un umbral bajo,
 * no crece indefinidamente con audiencias masivas.
 */

export type CommunityScoreDimensionKey = "participation" | "positiveIntent" | "strongIntent" | "velocity" | "sampleQuality";

export interface CommunityScoreDimension {
  key: CommunityScoreDimensionKey;
  label: string;
  rawValue: number;
  normalizedScore: number; // 0-100
  weight: number; // 0-1
}

export interface CommunityScoreResult {
  score: number; // 0-100
  insufficientData: boolean;
  dimensions: CommunityScoreDimension[];
}

const WEIGHTS: Record<CommunityScoreDimensionKey, number> = {
  participation: 0.25,
  positiveIntent: 0.30,
  strongIntent: 0.20,
  velocity: 0.15,
  sampleQuality: 0.10,
};

const MIN_RESPONSES_FOR_SCORE = 3;
// A partir de esta muestra, la dimensión de calidad de muestra ya satura en
// 100 — audiencias grandes no "ganan" puntos extra solo por ser grandes.
const SAMPLE_QUALITY_SATURATION = 20;
// Velocidad de referencia: la mitad de las respuestas totales llegando en
// esta ventana (minutos) ya puntúa 100 — es una escala relativa al total de
// respuestas, no un número absoluto de respuestas/minuto.
const VELOCITY_REFERENCE_MINUTES = 60;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export interface CommunityScoreInput {
  totalResponses: number;
  totalAudience: number;
  positiveRespondents: number | null; // null si el tipo de pregunta no tiene noción de "positivo" (ver communityIntentService)
  strongIntentRespondents: number | null; // p.ej. "definitely"/"me_apunto" — null si no aplica
  /** Minutos transcurridos entre el primer y el último tercio de respuestas recibidas hasta ahora (o hasta el cierre) — proxy simple de "rapidez con la que se sumó la gente". */
  medianResponseMinutesSincePublish: number | null;
}

export function computeCommunityScore(input: CommunityScoreInput): CommunityScoreResult {
  if (input.totalResponses < MIN_RESPONSES_FOR_SCORE) {
    return {
      score: 0,
      insufficientData: true,
      dimensions: [],
    };
  }

  const participationRaw = input.totalAudience > 0 ? (input.totalResponses / input.totalAudience) * 100 : 0;
  const participation: CommunityScoreDimension = {
    key: "participation", label: "Participación", weight: WEIGHTS.participation,
    rawValue: Math.round(participationRaw), normalizedScore: clamp(Math.round(participationRaw), 0, 100),
  };

  const dimensions: CommunityScoreDimension[] = [participation];

  if (input.positiveRespondents !== null) {
    const raw = input.totalResponses > 0 ? (input.positiveRespondents / input.totalResponses) * 100 : 0;
    dimensions.push({ key: "positiveIntent", label: "Intención positiva", weight: WEIGHTS.positiveIntent, rawValue: Math.round(raw), normalizedScore: clamp(Math.round(raw), 0, 100) });
  }

  if (input.strongIntentRespondents !== null) {
    const raw = input.totalResponses > 0 ? (input.strongIntentRespondents / input.totalResponses) * 100 : 0;
    dimensions.push({ key: "strongIntent", label: "Intención fuerte", weight: WEIGHTS.strongIntent, rawValue: Math.round(raw), normalizedScore: clamp(Math.round(raw), 0, 100) });
  }

  if (input.medianResponseMinutesSincePublish !== null) {
    const raw = input.medianResponseMinutesSincePublish;
    const normalized = clamp(Math.round(100 - (raw / VELOCITY_REFERENCE_MINUTES) * 100), 0, 100);
    dimensions.push({ key: "velocity", label: "Velocidad de respuesta", weight: WEIGHTS.velocity, rawValue: raw, normalizedScore: normalized });
  }

  const sampleQualityRaw = input.totalResponses;
  dimensions.push({
    key: "sampleQuality", label: "Calidad de muestra", weight: WEIGHTS.sampleQuality,
    rawValue: sampleQualityRaw, normalizedScore: clamp(Math.round((sampleQualityRaw / SAMPLE_QUALITY_SATURATION) * 100), 0, 100),
  });

  const weightSum = dimensions.reduce((sum, d) => sum + d.weight, 0);
  const weighted = dimensions.reduce((sum, d) => sum + d.normalizedScore * d.weight, 0);
  const score = weightSum > 0 ? Math.round(weighted / weightSum) : 0;

  return { score, insufficientData: false, dimensions };
}
