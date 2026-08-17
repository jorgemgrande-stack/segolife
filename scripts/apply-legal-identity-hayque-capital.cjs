// PRE-16.15 — corrección de identidad legal de la compañía.
//
// El titular del negocio facilitó de forma explícita y autoritativa los
// datos reales de SEGOLIFE (ver spec PRE-16.15, secciones 28-38):
//   Razón social: HAYQUE CAPITAL, S.L.
//   CIF:          B13989264
//   Domicilio:    Finca Lindaraja, s/n · 40420 Segovia, España
//
// Existían DOS almacenes de identidad legal desconectados entre sí, ambos
// vacíos en producción, cada uno cayendo a un fallback heredado incorrecto
// (Iron Elephant Consulting / Náyade Experiences / NEXTAIR según el
// consumidor):
//   1. `site_settings.legalCompany*`   — leído por invoiceHtml.ts (factura
//      real), partners.ts y suppliers.ts (PDF de liquidación).
//   2. `system_settings` (site_legal_name, brand_nif, brand_address,
//      site_legal_zip/city/province) — leído/escrito por el panel admin
//      (Settings.tsx "Empresa legal", ConfigPanel.tsx, OnboardingWizard.tsx)
//      vía el mapeo de claves de server/routers.ts.
//
// Se pueblan AMBOS con los mismos datos reales para que today ningún
// consumidor conocido siga mostrando la identidad heredada equivocada.
// No se inventa email/teléfono/IBAN fiscal (no facilitados por el
// negocio) — quedan sin definir a propósito.
//
// También corrige `system_settings.brand_short_name` ("Náyade", is_public=1,
// expuesto hoy vía trpc.config.getPublicSettings) a "Segolife".
//
// Idempotente — solo escribe si el valor real difiere del ya almacenado.
//
// Run: railway ssh -- node scripts/apply-legal-identity-hayque-capital.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const LEGAL = {
  name:     "HAYQUE CAPITAL, S.L.",
  cif:      "B13989264",
  address:  "Finca Lindaraja, s/n",
  city:     "Segovia",
  zip:      "40420",
  province: "Segovia",
};

async function upsertSiteSetting(c, key, value) {
  await c.execute(
    `INSERT INTO site_settings (\`key\`, value, type) VALUES (?, ?, 'text')
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [key, value]
  );
  console.log(`  ✓ site_settings.${key} = ${value}`);
}

async function upsertSystemSetting(c, key, value, label, category) {
  const [existing] = await c.query(`SELECT id, value FROM system_settings WHERE \`key\` = ?`, [key]);
  if (existing.length === 0) {
    await c.execute(
      `INSERT INTO system_settings (\`key\`, value, value_type, category, label, is_sensitive, is_public)
       VALUES (?, ?, 'string', ?, ?, 0, 0)`,
      [key, value, category, label]
    );
    console.log(`  ✓ INSERT system_settings.${key} = ${value}`);
  } else if (existing[0].value !== value) {
    await c.execute(`UPDATE system_settings SET value = ? WHERE \`key\` = ?`, [value, key]);
    console.log(`  ✓ UPDATE system_settings.${key}: "${existing[0].value ?? ""}" → "${value}"`);
  } else {
    console.log(`  · skip system_settings.${key} (ya correcto)`);
  }
}

(async () => {
  console.log("=".repeat(70));
  console.log("PRE-16.15 — identidad legal HAYQUE CAPITAL, S.L.");
  console.log("=".repeat(70));

  const c = await mysql.createConnection({ uri: DB_URL });

  console.log("\n[1/2] site_settings.legalCompany* (invoiceHtml.ts / partners.ts / suppliers.ts)");
  await upsertSiteSetting(c, "legalCompanyName",     LEGAL.name);
  await upsertSiteSetting(c, "legalCompanyCif",      LEGAL.cif);
  await upsertSiteSetting(c, "legalCompanyAddress",  LEGAL.address);
  await upsertSiteSetting(c, "legalCompanyCity",     LEGAL.city);
  await upsertSiteSetting(c, "legalCompanyZip",      LEGAL.zip);
  await upsertSiteSetting(c, "legalCompanyProvince", LEGAL.province);

  console.log("\n[2/2] system_settings (panel admin — Settings.tsx / ConfigPanel.tsx / OnboardingWizard.tsx)");
  await upsertSystemSetting(c, "site_legal_name",     LEGAL.name,     "Razón social",         "fiscal");
  await upsertSystemSetting(c, "brand_nif",           LEGAL.cif,      "NIF / CIF",            "fiscal");
  await upsertSystemSetting(c, "brand_address",       LEGAL.address,  "Domicilio fiscal completo", "fiscal");
  await upsertSystemSetting(c, "site_legal_zip",      LEGAL.zip,      "Código postal",        "fiscal");
  await upsertSystemSetting(c, "site_legal_city",     LEGAL.city,     "Municipio",            "fiscal");
  await upsertSystemSetting(c, "site_legal_province", LEGAL.province, "Provincia",            "fiscal");
  await upsertSystemSetting(c, "brand_short_name",    "Segolife",     "Nombre corto",         "marca");

  await c.end();
  console.log("\n" + "=".repeat(70));
  console.log("FIN — identidad legal corregida");
  console.log("Sin definir a propósito (no facilitados por el negocio): legalCompanyEmail/Phone/Iban, site_legal_email/phone/iban.");
  console.log("=".repeat(70));
})().catch((e) => { console.error("ERR", e); process.exit(1); });
