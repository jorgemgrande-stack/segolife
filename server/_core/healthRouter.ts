/**
 * healthRouter.ts — endpoints técnicos de salud para Railway (y cualquier
 * monitor externo). Públicos, sin autenticación, sin efectos secundarios.
 *
 * GET /api/health — LIVENESS. Solo confirma que el proceso Express está
 * vivo y respondiendo. No toca la BD. Es el que usa railway.toml como
 * healthcheckPath: una caída temporal de MySQL no debe hacer que Railway
 * mate/reinicie el proceso — para eso está /api/ready, separado.
 *
 * GET /api/ready — READINESS. Comprueba conectividad real a la BD
 * (SELECT 1) con una conexión corta y propia (no reutiliza pools de otros
 * módulos). Devuelve 503 si la BD no responde. No lo usa Railway como
 * healthcheck principal — pensado para diagnóstico manual o un monitor
 * externo que sí quiera saber si la app puede servir tráfico real.
 *
 * Ninguno de los dos ejecuta seeds, migraciones, ni modifica datos.
 */
import express from "express";

export const healthRouter = express.Router();

healthRouter.get("/api/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "segolife",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV ?? "unknown",
  });
});

healthRouter.get("/api/ready", async (_req, res) => {
  try {
    const mysql = await import("mysql2/promise");
    const conn = await mysql.default.createConnection(process.env.DATABASE_URL!);
    await conn.query("SELECT 1");
    await conn.end();
    res.status(200).json({ status: "ok", service: "segolife" });
  } catch (err: any) {
    res.status(503).json({ status: "error", service: "segolife", message: "database unavailable" });
  }
});
