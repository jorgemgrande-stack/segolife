// Medición de performance real del SEGOLIFE ADMIN COMMAND CENTER (spec §43).
// Solo LECTURA. Ejecuta las queries agregadas más pesadas (mismo SQL que
// usan commandCenterOverview/Activity/Events/Venues/Students) contra
// producción, con EXPLAIN para confirmar uso de índice + timing real.
//
// Run: railway ssh --service segolife -- node < scripts/command-center-performance.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const now = new Date();
const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

const QUERIES = [
  {
    name: "Overview — tickets GROUP BY status (30d)",
    sql: `SELECT status, COUNT(*) AS n, SUM(total_cents) AS revenue FROM ticket_orders WHERE purchased_at >= ? AND purchased_at < ? GROUP BY status`,
    params: [from, now],
  },
  {
    name: "Overview — eligible tickets (event_tickets JOIN ticket_orders, 30d)",
    sql: `SELECT COUNT(*) AS n FROM event_tickets et JOIN ticket_orders o ON o.id = et.order_id WHERE et.status IN ('issued','used') AND o.purchased_at >= ? AND o.purchased_at < ?`,
    params: [from, now],
  },
  {
    name: "Activity feed — UNION de 10 fuentes + JOIN users (LIMIT 30)",
    sql: `
      SELECT f.occurred_at, f.type, f.user_id, u.name AS student_name, f.venue_id, f.event_id
      FROM (
        SELECT purchased_at AS occurred_at, 'ticket_purchase' AS type, user_id, NULL AS venue_id, event_id FROM ticket_orders WHERE status='paid' AND user_id IS NOT NULL
        UNION ALL
        SELECT occurred_at, 'attendance', user_id, venue_id, event_id FROM event_attendance
        UNION ALL
        SELECT created_at, 'token_earn', user_id, venue_id, event_id FROM token_ledger
      ) f
      LEFT JOIN users u ON u.id = f.user_id
      ORDER BY f.occurred_at DESC LIMIT 30`,
    params: [],
  },
  {
    name: "Event Performance — ranking por revenue (30d)",
    sql: `SELECT o.event_id, e.name, COUNT(DISTINCT o.id) AS orders, SUM(o.total_cents) AS revenue FROM ticket_orders o JOIN events e ON e.id = o.event_id WHERE o.status='paid' AND o.purchased_at >= ? AND o.purchased_at < ? GROUP BY o.event_id, e.name ORDER BY revenue DESC LIMIT 50`,
    params: [from, now],
  },
  {
    name: "Venue Performance — tickets por venue (30d)",
    sql: `SELECT e.venue_id, SUM(o.total_cents) AS revenue FROM ticket_orders o JOIN events e ON e.id = o.event_id WHERE o.status='paid' AND o.purchased_at >= ? AND o.purchased_at < ? GROUP BY e.venue_id`,
    params: [from, now],
  },
  {
    name: "Historical stats — unresolved_operations full scan (provider+venue)",
    sql: `SELECT * FROM unresolved_operations WHERE provider = 'fourvenues_integrations' AND venue_id IN (1,4,7)`,
    params: [],
  },
];

async function main() {
  const conn = await mysql.createConnection(DB_URL);
  console.log(`Medición de performance — ${now.toISOString()}\n`);
  console.log("Query".padEnd(58), "| ms".padEnd(8), "| rows".padEnd(8), "| EXPLAIN type / key");
  console.log("-".repeat(110));

  for (const q of QUERIES) {
    const t0 = Date.now();
    const [rows] = await conn.query(q.sql, q.params);
    const ms = Date.now() - t0;

    const [explainRows] = await conn.query(`EXPLAIN ${q.sql}`, q.params);
    const summary = explainRows.map(r => `${r.table}:${r.type}${r.key ? `(${r.key})` : ""}`).join(", ");

    console.log(q.name.padEnd(58), "|", String(ms).padEnd(6), "|", String(rows.length).padEnd(6), "|", summary);
  }

  await conn.end();
}

main().catch(err => { console.error("ERROR:", err); process.exit(1); });
