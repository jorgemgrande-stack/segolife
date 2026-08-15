// Aplica 0150_referral_invite_rewards (REFERRAL & INVITE REWARDS ENGINE).
// Idempotente. Puramente aditiva: 2 tablas nuevas + 1 columna nullable en
// student_profiles. Ninguna tabla existente pierde datos ni cambia
// semántica. Sin backfill, sin campaña activada por defecto.
const mysql = require("mysql2/promise");
const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

async function tableExists(c, t) {
  const [r] = await c.query(`SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [t]);
  return r[0].n > 0;
}
async function columnExists(c, t, col) {
  const [r] = await c.query(`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [t, col]);
  return r[0].n > 0;
}

(async () => {
  console.log("REFERRAL & INVITE REWARDS ENGINE (0150)");
  const c = await mysql.createConnection({ uri: DB_URL });

  if (await columnExists(c, "student_profiles", "referral_code")) {
    console.log("· skip student_profiles.referral_code (ya existe)");
  } else {
    await c.query(`ALTER TABLE \`student_profiles\` ADD COLUMN \`referral_code\` varchar(16) DEFAULT NULL AFTER \`status\``);
    await c.query(`ALTER TABLE \`student_profiles\` ADD UNIQUE KEY \`student_profiles_referral_code_unique\` (\`referral_code\`)`);
    console.log("✓ ADD COLUMN student_profiles.referral_code (+ UNIQUE)");
  }

  if (await tableExists(c, "referral_campaigns")) {
    console.log("· skip referral_campaigns (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE \`referral_campaigns\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`name\` varchar(256) NOT NULL,
        \`status\` enum('draft','active','paused','ended','archived') NOT NULL DEFAULT 'draft',
        \`community_id\` int DEFAULT NULL,
        \`inviter_reward_tokens\` int NOT NULL,
        \`invitee_reward_tokens\` int NOT NULL,
        \`conversion_condition\` enum('account_created','verified_student','profile_completed','first_venue_visit','first_event_attendance') NOT NULL,
        \`attribution_window_days\` int NOT NULL DEFAULT 30,
        \`max_rewards_per_inviter\` int DEFAULT NULL,
        \`max_total_conversions\` int DEFAULT NULL,
        \`budget_tokens\` int DEFAULT NULL,
        \`priority\` int NOT NULL DEFAULT 0,
        \`starts_at\` timestamp NULL DEFAULT NULL,
        \`ends_at\` timestamp NULL DEFAULT NULL,
        \`created_by_user_id\` int DEFAULT NULL,
        \`activated_at\` timestamp NULL DEFAULT NULL,
        \`activated_by_user_id\` int DEFAULT NULL,
        \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`referral_campaigns_status_idx\` (\`status\`),
        KEY \`referral_campaigns_community_id_idx\` (\`community_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("✓ CREATE TABLE referral_campaigns");
  }

  if (await tableExists(c, "referrals")) {
    console.log("· skip referrals (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE \`referrals\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`referrer_user_id\` int NOT NULL,
        \`referred_user_id\` int NOT NULL,
        \`referral_code\` varchar(16) NOT NULL,
        \`campaign_id\` int DEFAULT NULL,
        \`community_id\` int DEFAULT NULL,
        \`status\` enum('registered','converted','rewarded','ineligible','expired','cancelled') NOT NULL DEFAULT 'registered',
        \`required_conversion_condition\` enum('account_created','verified_student','profile_completed','first_venue_visit','first_event_attendance') DEFAULT NULL,
        \`converted_via\` enum('account_created','verified_student','profile_completed','first_venue_visit','first_event_attendance') DEFAULT NULL,
        \`inviter_reward_tokens\` int NOT NULL DEFAULT 0,
        \`invitee_reward_tokens\` int NOT NULL DEFAULT 0,
        \`inviter_ledger_id\` int DEFAULT NULL,
        \`invitee_ledger_id\` int DEFAULT NULL,
        \`ineligible_reason\` varchar(64) DEFAULT NULL,
        \`metadata\` json DEFAULT NULL,
        \`registered_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`converted_at\` timestamp NULL DEFAULT NULL,
        \`rewarded_at\` timestamp NULL DEFAULT NULL,
        \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`referrals_referred_user_id_unique\` (\`referred_user_id\`),
        KEY \`referrals_referrer_user_id_idx\` (\`referrer_user_id\`),
        KEY \`referrals_status_idx\` (\`status\`),
        KEY \`referrals_campaign_id_idx\` (\`campaign_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("✓ CREATE TABLE referrals");
  }

  const tag = "0150_referral_invite_rewards";
  const [[exists]] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [tag]);
  if (exists.n > 0) { console.log(`· skip registro ${tag}`); }
  else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [tag, Date.now()]);
    console.log(`✓ INSERT ${tag}`);
  }

  const [colsSp] = await c.query(`SHOW COLUMNS FROM student_profiles LIKE 'referral_code'`);
  const [colsRc] = await c.query(`SHOW COLUMNS FROM referral_campaigns`);
  const [colsR] = await c.query(`SHOW COLUMNS FROM referrals`);
  console.log(`\n[POST] student_profiles.referral_code: ${colsSp.length === 1 ? "OK" : "FALTA"} · referral_campaigns: ${colsRc.length} cols · referrals: ${colsR.length} cols`);

  const [[campaignCount]] = await c.query(`SELECT COUNT(*) AS n FROM referral_campaigns`);
  const [[activeCampaignCount]] = await c.query(`SELECT COUNT(*) AS n FROM referral_campaigns WHERE status='active'`);
  console.log(`[POST] referral_campaigns total: ${campaignCount.n} (activas: ${activeCampaignCount.n}) — debe ser 0/0 tras un deploy limpio`);

  await c.end();
  console.log("FIN");
})().catch(e => { console.error("ERR", e); process.exit(1); });
