/**
 * integrationProvidersSeed.ts — seed del CATÁLOGO de providers (fourvenues,
 * weezevent, segolife_native) — config técnica mínima, NUNCA datos de
 * negocio (spec Fase 5, punto 69: nunca sembrar Casanova/Tía Felisa/
 * Limoncello/Tankers/Mambo/credenciales/tarifas/eventos/pedidos). Sin este
 * catálogo, el admin no tiene qué elegir al crear una integración —
 * equivalente a por qué se siembran `communities` (IE/UVA) y no un venue de
 * negocio. Idempotente (INSERT IGNORE).
 */
import mysql from "mysql2/promise";
import {
  FOURVENUES_CHANNEL_MANAGER_CAPABILITIES,
  FOURVENUES_INTEGRATIONS_API_CAPABILITIES,
  WEEZEVENT_CAPABILITIES,
  SEGOLIFE_NATIVE_CAPABILITIES,
  type ProviderCapabilities,
} from "./capabilities";

const PROVIDERS: Array<{ key: string; name: string; capabilities: ProviderCapabilities }> = [
  { key: "fourvenues", name: "Fourvenues (Channel Manager)", capabilities: FOURVENUES_CHANNEL_MANAGER_CAPABILITIES },
  // Modelo real confirmado 2026-08-12 para Casanova/Tía Felisa/Limoncello —
  // ver docs/integrations/fourvenues.md, sección "resuelto".
  { key: "fourvenues_integrations", name: "Fourvenues (Integrations API)", capabilities: FOURVENUES_INTEGRATIONS_API_CAPABILITIES },
  { key: "weezevent", name: "Weezevent", capabilities: WEEZEVENT_CAPABILITIES },
  { key: "segolife_native", name: "Segolife Native", capabilities: SEGOLIFE_NATIVE_CAPABILITIES },
];

export async function seedIntegrationProvidersIfNeeded(): Promise<{ providersAdded: string[] }> {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const providersAdded: string[] = [];
  try {
    for (const provider of PROVIDERS) {
      const [result] = await conn.execute(
        `INSERT IGNORE INTO integration_providers (\`key\`, name, capabilities, active) VALUES (?, ?, ?, 1)`,
        [provider.key, provider.name, JSON.stringify(provider.capabilities)]
      ) as unknown as [{ affectedRows: number }];
      if (result.affectedRows > 0) providersAdded.push(provider.key);
    }
    console.log(`[IntegrationProvidersSeed] Providers nuevos: ${providersAdded.join(", ") || "ninguno"}`);
    return { providersAdded };
  } finally {
    await conn.end();
  }
}
