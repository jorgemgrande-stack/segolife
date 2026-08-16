# PRE-16 Overnight Operational QA & Hardening — Worklog

Internal engineering worklog for the autonomous overnight run starting at PRE-16.3
(PRE-16.1 and PRE-16.2 are already complete/deployed — see prior conversation,
main commit 84862e6, Railway deployment 21bd20dd-f013-4843-a119-067b209591f6).

Format per entry: timestamp, block, audit result, findings, severity, code
changed, commit, tests, deployment, production verification, blockers, manual
QA, business decisions.

Baseline at start of this run: **2846/2864 PASS**, 18 inherited failures in
`nayade.test.ts`, `regression.recalculate.test.ts`, `reservationEmails.test.ts`,
`transferConfirmationEmail.test.ts`. This is the regression yardstick — same
failing tests/files, no new failures.

---

## 2026-08-17 00:25 — RUN START

Kicking off parallel read-only audit wave across independent blocks:
PRE-16.3 (SegoTokens E2E), PRE-16.4 (Door/Ticketing/Check-in), PRE-16.5 (Venue
Bar POS), PRE-16.6 (Benefits), PRE-16.7 (Student App), PRE-16.8 (Venue
App/RBAC/IDOR), PRE-16.9 (Multicommunity), PRE-16.10 (Fourvenues), PRE-16.11
(Cash/Stock/Fiscal/Settlements), PRE-16.12 (Communication Center), PRE-16.13
(Command Center/BI), plus cross-cutting passes (webhooks, performance/DB
integrity/schedulers, storage/legacy/branding/navigation/terminology).

Each audit agent instructed: read-only, no production mutation, no fake data,
classify findings (PASS/PARTIAL/BLOCKED/FAIL), cite exact files/lines, and
distinguish "code exists" from "actually wired/configured/working".

Findings will be triaged as they land: CRITICAL/HIGH fixed with regression
tests, committed, deployed, and verified in production before moving on;
MEDIUM fixed only when isolated/low-risk; LOW/COSMETIC only if trivial.

**Audit wave 1 launched** (14 parallel read-only background audits, each
scoped to one block with the exact requirements from the run spec):

1. PRE-16.3 — SegoTokens E2E integrity (earn/wallet/reserve/capture/spend/
   release/reverse/refund/activity/Command Center, historical protection,
   idempotency, preview-vs-actual drift)
2. PRE-16.4 — Door/Ticketing/Check-in (native + door + Fourvenues honesty,
   scan-never-spends invariant, IDOR on scan)
3. PRE-16.5 — Venue Bar POS end-to-end (catalogue truth, price authority,
   stock concurrency, ST-vs-money separation)
4. PRE-16.6 — Benefits end-to-end (double-redemption, cross-venue validity,
   Benefit != SegoTokens invariant, free-product stock)
5. PRE-16.7 — Student App operational (code-level only, no browser — visual
   items explicitly deferred to Manual QA register)
6. PRE-16.8 — Venue App / RBAC / IDOR (security-critical: venueId/studentId/
   orderId/requestId tampering, userId mass-assignment, price/ST tampering)
7. PRE-16.9 — Multicommunity operational integrity (community resolution,
   shared-event canonicality, one-wallet/one-identity invariants)
8. PRE-16.10 — Fourvenues coexistence (scheduler idempotency, mapping
   uniqueness, paymentless-never-counts-as-revenue invariant)
9. PRE-16.11 — Cash/Stock/Fiscal/Invoicing/Settlements (gross vs money vs ST
   separation, VeriFactu/tax-config honest classification)
10. PRE-16.12 — Communication Center (provider honesty per channel, canonical
    trigger events, Brevo webhook safety)
11. PRE-16.13 — Command Center/BI data truth (canonical sources, zero
    handling, AI-vs-deterministic honesty)
12. Webhook security pass (all externally-reachable webhook routes)
13. Performance / DB integrity / Scheduler inventory pass
14. Storage persistence (product image /tmp durability — flagged as
    highest-priority item) / Legacy branding / Navigation-operability /
    Technical terminology pass

Waiting on results — will triage each as it lands (fix CRITICAL/HIGH with
regression tests, commit, deploy, verify; MEDIUM only if isolated/low-risk;
LOW/COSMETIC only if trivial), update this worklog per block, and continue
through PRE-16.14 consolidation once all blocks report.

(Entries continue below as each block's audit lands and is processed.)

---

## 2026-08-17 01:07 — TWO MORE FIXES DEPLOYED (commits a470852, 6ff91f4) — RUN CLOSING

5. **fix(ticketing)** Checkout community-scoping trusted an unvalidated
   client-supplied `communityId` — PRE-16.4 HIGH finding, now derives real
   membership server-side.
6. **fix(engagement)** EngagementScheduler had no atomic claim — real
   duplicate-send risk (ENGAGEMENT_DELIVERY_ENABLED=true, live) — reused
   `attempt_count` as an atomic claim token, no new column/state.

Full suite 2853/2871 (same 18 baseline, +5 new passing tests this batch).
Typecheck 118, unchanged. Deployed (`e4052dd3-4d76-4760-b0f4-60bd1c356011`),
health/ready 200, both schedulers active, zero errors in logs.

**Final verification**: `main`/`origin/main` in sync, no divergence. 9
fixes total this run (2 CRITICAL, 7 HIGH — see Morning Report for the full
bug table). All 14 audit blocks (PRE-16.3 through PRE-16.13 plus 3
cross-cutting passes) completed and reported. Proceeding to consolidation
and the Morning Report. Remaining findings (multiple MEDIUM/LOW across
Benefits, Multicommunity public-scoping, Student App, RBAC-adjacent,
storage/branding, fiscal/settlements) documented but NOT fixed tonight —
see report for full classification and reasoning per item.

---

## 2026-08-17 00:58 — FOUR MORE FIXES DEPLOYED (commits 2b1aa5a, 87aacfb, 8843ea2, 9b2d913)

1. **fix(command-center)** Fourvenues revenue breakdown always 0 (wrong
   provider string `"fourvenues"` vs real `"fourvenues_integrations"`) —
   PRE-16.10 finding.
2. **fix(pos)** Door-sale refunds recorded `venueId: null`, invisible to
   cash-session reconciliation (phantom shortfall equal to every door
   refund) — PRE-16.11 Finding A.
3. **fix(pos)** POS sale idempotency key regenerated per submit attempt in
   `VenueAppPos.tsx`/`StaffPos.tsx` — real double-charge risk on network
   retry — PRE-16.5 HIGH finding.
4. **fix(pos)** `ingestCommerceTransaction` crashed on a genuine
   idempotency-key collision (insertId=0 → SELECT WHERE id=0 → TypeError →
   spurious reversal of the WINNING concurrent sale's already-captured
   tokens/stock) — reused the proven `stockService.ts` catch-ER_DUP_ENTRY
   pattern — PRE-16.5 MEDIUM finding, fixed as isolated/low-risk.

Full suite 2848/2866 (same 18 baseline, +1 new passing test). Typecheck
118, unchanged. Deployed (`b542904a-7299-48fb-8e37-549ded8319f5`). Railway
briefly showed "Crashed" during the deploy handoff window — investigated:
logs show a completely clean startup (DB connectivity verified, both
schedulers initialized, zero errors), health/ready both 200 immediately
after. Concluded this was a transient status artifact of the
old-container/new-container swap, not a real failure — confirmed no actual
crashed deployment exists (current deployment ID is healthy and serving).

---

## 2026-08-17 00:50 — THREE FIXES DEPLOYED (commits 20e8846, babb4bd, 550df51)

1. **fix(commerce)** POS refund idempotency (BUG-01, HIGH) — see PRE-16.3
   entry above. Regression tests added (11 in `refundOrchestrator.test.ts`
   given stable keys, 1 new duplicate-retry test, router test updated).
2. **fix(security)** GHL WhatsApp Inbox auth bypass (CRITICAL) — webhook now
   mandatory-secret (503/401, matching the established
   `ghlWebhookRouter.ts`/`vapiWebhookRouter.ts` pattern); `/stream`, `/reply`,
   `/new`, `/sync`, `/templates` now require a real admin session
   (`requireAdminSession`, same dual LOCAL_AUTH/sdk pattern as
   `uploadRoutes.ts::requireAdmin`) instead of no check at all or a
   hardcoded fallback token (`"nayade-ghl-stream"`, literally committed in
   both server and client source). No existing test harness for Express
   (non-tRPC) routes in this area of the codebase — relied on mirroring
   already-proven patterns + post-deploy smoke verification instead of new
   test infrastructure.
3. **fix(rbac)** Cross-venue IDOR via over-granted permissions (CRITICAL) —
   `rbacSeed.ts` now imports `VENUE_ADMIN_PERMISSION_BUNDLE` directly
   instead of a hand-duplicated (and drifted) list, and retracts
   `benefits.view`/`attendance.view` from `staff`/`venue_admin` on every
   run. Regression test added to `venueAdminPolicy.test.ts` (structural
   check that `rbacSeed.ts` imports/reuses the canonical bundle).

All three: typecheck clean (118 baseline, unchanged), full suite 2847/2865
(same 18 inherited failures, +1 new passing test), deployed
(`d1e76403-c70d-46c6-ba5c-d944b322f22d`), health/ready 200.

**Production RBAC seed executed** (`railway ssh -- pnpm db:seed`) to apply
fix #3 to the live database (seeding is a manual script, never auto-run —
the code fix alone doesn't retract already-applied grants). Result:
`Roles nuevos: 1 | Grants nuevos: staff -> [all 8 canonical permissions] |
rbac_user_roles sincronizadas: 3`. **Important, precise finding**: zero
"RETRACTED" log lines appeared — meaning `benefits.view`/`attendance.view`
had NEVER actually been granted to `staff`/`venue_admin` in the production
database. The vulnerability was real in the seed script's SOURCE CODE (the
next time someone ran it to provision a new venue_admin/staff account, per
the script's own documented purpose, it would have granted the excess
permissions) but had not yet been executed against production — so no
actual cross-venue data exposure occurred. Separately, and unrelated to the
security fix itself: this was apparently the FIRST time this seed ran for
the `staff` role at all — 3 real staff/venue_admin user accounts had ZERO
functioning RBAC permissions (TPV/Entradas/Escanear/Caja would all have
returned FORBIDDEN) until this run. This is a legitimate, intended
operational fix (exactly the seed script's documented job), not a new bug
introduced tonight — flagging for transparency per "explain legitimate
background changes."

---

## Webhook security pass — AUDIT LANDED — CRITICAL FOUND, fixing now

`server/routes/ghlInboxRouter.ts` (`POST /api/ghl/inbox/webhook`): the
`x-ghl-secret` check is wrapped in `if (secret) { ... }` — when
`GHL_WEBHOOK_SECRET`/DB secret is unset (the documented real state — GHL not
active in this environment), the whole check is skipped and ANY
unauthenticated POST is processed as a real GHL event, writing fabricated
conversations/messages into the staff-facing WhatsApp Inbox and triggering
real GHL API calls. Worse: `POST /api/ghl/conversations/:id/reply` and
`POST /api/ghl/conversations/new` have NO auth check at all, regardless of
secret configuration — an open, unauthenticated relay that can send real
outbound WhatsApp messages via the business's GHL account to an
attacker-chosen phone number. This is the exact bug class already fixed in
`ghlWebhookRouter.ts`/`vapiWebhookRouter.ts` (mandatory 503/401), just
missed in this sibling file. **Fixing immediately per CRITICAL priority.**

Also found: MEDIUM (`vapiWebhookRouter.ts` accepts `GHL_WEBHOOK_SECRET` as a
valid fallback credential — secret reuse across unrelated integrations),
MEDIUM/LOW (email logged unconditionally in `ghlWebhookRouter.ts`), several
LOW (no rate limiting on 3 webhook routes, stale doc comments, non-constant-time
Brevo token compare). `ticket-payments`/`brevo`/`redsys` webhooks all
verified CORRECT (signature-before-trust, idempotent, no PII leak). Full
detail in the bug table at run end.

---

## PRE-16.6 Benefits end-to-end — AUDIT LANDED

Result: **PASS on core invariants (cross-venue, expiry, historical
protection, double-redemption, Benefit≠SegoTokens all CORRECT with
evidence), 4 MEDIUM findings, 1 already-honestly-classified design tradeoff.**
Deferred to consolidation triage (not fixed inline yet): (1) Benefit
grant-cap counting (`maxPerUser`/`maxTotal`) has no row lock — genuinely
concurrent different qualifying facts could both read "0 granted" and both
succeed past a cap; (2) `aggregate_metric` rules aren't forced to
`oncePerRule=true` server-side, so a misconfigured rule could re-grant
indefinitely after crossing threshold; (3) ticket-purchase-origin Benefits
(native checkout + Fourvenues) never call `emitBenefitGranted` — the Benefit
is correctly granted but the Student gets no notification/email, unlike
every other origin; (4) admin-facing grant list doesn't surface which rule
fired (Student-facing view does). Free-product stock redemption is
confirmed BEST-EFFORT by deliberate design (stock engine itself is fully
transactional/row-locked) but the failure catch is completely silent (not
even logged) — worth a one-line logging fix. Communication Center audit
(separate) came back essentially clean (LOW-only: non-constant-time Brevo
token compare).

---

## PRE-16.3 — SegoTokens E2E integrity — AUDIT LANDED

Result: **PASS, 1 HIGH bug found and fixed.**

**BUG-01 (HIGH)** — `server/segolife/commerce/refundOrchestrator.ts:181`
(`refundPosSale`): idempotencyKey was generated server-side as
`pos_refund:${transaction.id}:${Date.now()}` — unique on every call, so the
`.insert(commerceRefunds).ignore()` dedup (and the DB-level unique
constraint on `commerce_refunds.idempotency_key`) could never actually
trigger. A double-click/network-retry on a POS refund would apply the
refund effects twice: `refundedAmountCents` incremented twice, a duplicate
`commerce_refunds` audit row, corrupting cash-session reconciliation
(`cashSessionService.ts`) and venue settlement sums. Money-refund bookkeeping
was exposed; SegoTokens reversal itself was safe regardless (`reverseTokenSpend`/
`reverseTransaction` are independently idempotent).

Also verified NOT a bug (false-positive avoided): `refundTransactionLines`/
`refundTransaction` lack an explicit `assertVenueAuthorized` call, unlike
sibling door/POS procedures — but `commerce.manage` (the permission gating
both) is seeded ONLY to the global `admin` role (`rbacSeed.ts` —
`VENUE_OPERATIONAL_PERMISSIONS` granted to `staff`/`venue_admin` explicitly
excludes `commerce.manage`), so there is no cross-venue IDOR here; a global
admin is authorized for all venues by design. No change made.

**Fix**: client now generates a stable `idempotencyKey` (same
`crypto.randomUUID()` convention as every other POS/door mutation) and the
server checks for an existing `commerce_refunds` row with that key BEFORE
applying any mutation (item quantities, transaction status, token/reward
reversal) — a genuine retry now returns the already-settled result without
re-applying economic effects, not just avoiding a duplicate audit row.

Files: `server/segolife/commerce/refundOrchestrator.ts`,
`server/routers/commerce.ts`, `client/src/pages/admin/venue/VenueAppPosHistory.tsx`.
Tests: in progress (updating `refundOrchestrator.test.ts`/`commerce.test.ts`
call sites for the new required `idempotencyKey`, adding a duplicate-retry
regression test).

Everything else in the SegoTokens lifecycle audit came back PASS with
evidence: single ledger writer, ledger immutability (zero `UPDATE` on
`token_ledger` anywhere), negative-balance guard restricted to
`reverseTransaction`, malformed-movement rejection centralized, preview vs
actual reward computation provably share the same primitives (no drift by
construction), Command Center economy numbers computed live from
`token_ledger`/`token_wallets` (no shadow cache), idempotency keys reviewed
project-wide (only the one exception above). Minor LOW note: no cleanup cron
for expired `token_spend_reservations` rows (by design, same lazy pattern as
PRE-16.1) — doesn't cause double-counting since every read applies the
expiry filter, just a data-hygiene wart, not fixed tonight.

---

## PRE-16.9 — Multicommunity operational integrity — AUDIT LANDED

Result: **PASS on all 4 critical invariants, 1 MEDIUM finding (deferred, not fixed tonight — reasoning below), 2 LOW/COSMETIC.**

Verified CORRECT with evidence: zero hardcoded `"ie"`/`"uva"` literals in
business logic anywhere in `server/` (only in seed/bootstrap scripts, which
is the documented exception); `community_events`/`community_venues` are
pure M2M bridges over a single canonical `events`/`venues` row (schema
enforces this, no duplicate-row pattern possible); `token_wallets` has a
real `unique(user_id)` constraint (one wallet per Student, schema-proven);
`student_identity_tokens` has `unique(user_id)`+`unique(token_hash)` (one
identity/QR, schema-proven); registration re-validates community+university
server-side, never trusts the client blindly; admin-side community scoping
(`server/_core/communityAccess.ts`) consistently enforces real membership
via fetch-then-assert across students/events/venues/benefits/tokens
routers, with `FORBIDDEN` thrown on cross-community admin access attempts.

**FINDING (MEDIUM, deferred)** — public event/venue browsing and
`ticketPurchase.startCheckout` accept `communityId` as an OPTIONAL
parameter; when omitted, zero community filtering happens
(`server/routers/events.ts`, `venues.ts`, `ticketPurchase.ts`). The client
itself races past this (`EventDetail.tsx` fires its query before
`CommunityContext` finishes resolving). This contradicts the code's own
"server-side truth wins" comment. **Currently non-exploitable**: every
production event/venue is deliberately shared between IE and UVA today
(confirmed via `scripts/bootstrap-production-venues.ts`/
`bootstrap-qa-events.ts`, which unconditionally attach `[ie.id, uva.id]` to
everything) — so omitting `communityId` today still resolves to the same
shared content. Becomes real the day an IE-exclusive or UVA-exclusive paid
event/venue is created.

**Decision: NOT fixed tonight.** The correct fix (deriving `communityId`
server-side from request hostname/path via Express middleware, per
`docs/SEGOLIFE_MULTICOMMUNITY_ARCHITECTURE.md` Paso 7, which is designed but
not yet wired into tRPC context) touches request-context creation and
multiple public routers — it is a structural hardening exercise, not an
isolated low-risk change, and today's data state means shipping it carries
real regression risk (touching every public event/venue/checkout path) for
zero current exploitability. Recorded for the Bug Table as MEDIUM/deferred
with the exact fix path documented, to be picked up deliberately (with its
own focused testing) before any community-exclusive paid content goes live
— not mid-audit tonight. Two LOW/COSMETIC companions: `venues.publicGetBySlug`
doesn't even accept a `communityId` param (inconsistent with events); no
Origin/Referer re-validation exists anywhere yet (consistent with Paso 7
not being wired in).
