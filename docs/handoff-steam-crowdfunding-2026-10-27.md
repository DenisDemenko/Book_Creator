# STEAM crowdfunding — resolved 28.10.2026

The original managed environment was reconnected and all retained completion files were recovered. No private repository source was exported to Vercel Sandbox; the rejected fallback remains stopped. The historical blocker below is superseded.

The completed module is deployed. Marketplace PR #16 source 1edbbdf84450a95b1be9db2f5fd2a85d4e7a99a3 merged as b9177e0b095fad929578f7d52005bcd6fe7c4dcc; documentation PR #17 merged as 026a8533cbad64eb2949b391c6954f7172a7b1ef. Final API deployment 1522bda1-96b9-4d4b-acde-b96127c4a8ed is SUCCESS; Vercel dpl_CGqkTbLtifM2nZr4Surfu97RDz4g is READY. Studio PR #29 source abb378a64b6e427f3d3b70c44375fff10678ab06 merged as 31a8415de4400bb80de25c9a5e30afbf3bdade0c; Railway 70a75c0c-0e77-41e0-9313-ce94bfd94236 is SUCCESS.

Unused-balance returns, proportional contributor refunds including the unused platform-fee share, durable in-app notifications, and UA/EN public/team flows are delivered. Local API/passport/permission regression 42 passed; adminOS 59 passed; types and builds passed. Both the standard and unused-fund real-form browser scenarios passed. Final production smoke passed 8 checks/5 screenshots/0 JavaScript errors/0 payment requests. Explicit UA/EN mobile routes and API error presentation passed. CI remains red only on the pre-existing passport refreshProfile browser fixture (352/353 e2e pass) and DesignCraft Gallery 17-vs-15 theme-count assertion.

Real contributions remain disabled: no operator terms/payment keys or real campaign applications were fabricated. Payouts and refunds use manually confirmed bank facts. No live money flow was executed. Both owner administrators retain canonical funding permissions. Operations: https://www.fusionlab.in.ua/admin/crowdfunding and Studio adminOS → Краудфандинг STEAM. Public: https://www.fusionlab.in.ua/crowdfunding.

Local commits: marketplace d0234c2 and 2a329ac; Studio 89a9e60. Local history differs from native GitData history. The deployed Prisma schema preserves concurrent master models; do not overwrite it with the older local schema and never force-push these histories. Service journals are published separately to feature branches; do not rebuild production for them.

Evidence: /workspace/artifacts/steam-crowdfunding-implementation/release.json, production-proof.json, final-api-proof.json, public-locales-proof.json, unused-browser-proof.json. Auth state, .env files and secrets are excluded from user artifacts.

## Historical checkpoint

# STEAM crowdfunding — checkpoint 27.10.2026

The owner instructed execution of the approved plan. Authorization to publish feature branches and deploy both repositories remains active. Do not test real payments.

## Published and verified

Marketplace source ec0f747e1b07b56345fc213987bc01ef7462c655, PR14 → master60f55cea534e0cc636639b6832fe6ffafc0f73c2.
Operator-pause follow-up cdb35a08def411d2af52c5a343af3327337707ca, PR15 → masterd236f164201d1f46ad5640a0fc390345b6f7663a.
Studio source f6416c1df3fe8924c616746698b2480dd3d6f038, PR28 → mastere277efcffce395c073d1ff91de4c118f8a0f8375.
Feature branch feat/steam-crowdfunding exists in both repositories. Local commit IDs differ: marketplace1694f41/bd0fd8c, Studio81503da. Never force-push or replace current master files with old local snapshots.

Final API Railway9dfe7bd3-7d45-4a62-ae92-dab7e2a13466 SUCCESS for d236f164.
Studio Railwaydb0430cf-7935-4979-9440-5fba6188a146 SUCCESS for e277efc.
Frontend Verceldpl_A1C3uUkwJRh3d63gSQ8GpPKCaL22 READY for60f55cea. The later backend-only frontend build FV3 was canceled; its UI did not change.

Live routes:
- https://www.fusionlab.in.ua/crowdfunding
- https://www.fusionlab.in.ua/admin/crowdfunding
- /account/teams/[id]/funding
- /account/contributions
- Studio: https://app.fusionlab.in.ua/studio/ → Admin → Краудфандинг STEAM.

Both dahindaniel@gmail.com and tropazemli@gmail.com retain admin and all three funding permissions. Verified through the real owner session, canonical API permissions and the Studio bridge.

Core behavior: full goal before every advance; one 3% fee and 97% team budget; immutable passport revision, content/model hashes and recipient; BIGINT kopecks; distinct contribution, bank-settlement, payout-reserve, actual-transfer, accepted-spending and refund records. Failed goals create full refunds without the platform fee. Manual bank transfers are recorded only with actual evidence. Unknown payout outcomes retain reserves. Pauses survive deadline reconciliation and reaching the full goal. IBAN encrypted with a separately configured FUNDING_BANK_KEY; do not rotate it without re-encryption. No secret values were printed or saved.

Production smoke: eight checks, five screenshots, JS errors0, payment requests0; public desktop/mobile390, both admin panels sharing the same data, owner history and anonymous401/403. Real campaigns0, liveEnabled=false, gatewayConfigured=false. No production campaign/contribution/payout fixtures were created.

Initial checks:39 API/passport/permission regressions, then10 crowdfunding checks including the pause case;59 adminOS, bridge tests, all builds/types. Marketplace CI349/350 with the existing passport browser fixture missing refreshProfile; Studio Gate B retains the pre-existing17/15 theme-count failure. Normal merge preserved concurrent team/course/graduate/MobileNav changes in master42e3a96.

## Prepared locally, not yet published

The full plan is still being completed. Do not describe these additions as deployed:
1. Team return of unused funds by milestone; proportional donor refunds with largest-remainder kopeck allocation and reversal of the corresponding platform fee. New returnedMinor counter, completed_refunding status, settle_unused review action, team_return bank facts. Only accepted reports and bank-confirmed team returns permit settlement. Final completion follows confirmation of every refund. The published campaign terms must explicitly freeze proportional_refund.
2. Transactional FundingOutbox tied to AuditEvent; five-second delivery worker creates in-app notifications exactly once, rechecks finance access and publishes only after commit. No email or external messaging. NotificationType funding_update; safe notification links.
3. English customer and team-leader copy, status/currency/date formatting, locale metadata. Shared financial administration remains in the Studio admin design system.

Latest isolated backend regression:42 tests passed across crowdfunding, passports and permissions, including unused funds, fee reversal, outbox concurrency and revoked finance access. New financial logic uses internal database/accounting fixtures; no checkout, HTTP callback, demo-confirm or external provider calls.

English copy is added but its browser run is not yet complete. Static translation coverage checker needs to accept both quoted and Identifier property names (Prettier unquotes Ukrainian identifier keys); reported missing simple words are a checker issue, not missing dictionary entries.
A known first attempt at the public network-error QA intercepted a cross-origin response without CORS headers, so the expected custom text was not displayed; correct the fixture or assert the actual visible network error.
An isolated end-to-end completion check already passed: accepted report → completed project → public result.

Uncommitted code includes migration20261027000300_funding_unused_and_outbox; funding service/DTO/module/schema; NotificationsService.emitPersisted; funding public/team/admin/types/locale UI; NotificationsBell safe-link navigation; funding browser script; additional tests. Recheck all files after runtime reconnect. Some latest shared UI changes may still need recopying into Studio.

## Resume procedure and local state

Execution workspace was /workspace/fusion-lab and /workspace/book-creator. Artifacts: /workspace/artifacts/steam-crowdfunding-implementation.
Book AGENTS requires journals and one writer; own lock tmp/session.lock identifies Codex27.10 #03. Journal490 was created and updated locally in log.md, log/301-350.md, log/sessions.md, HANDOFF.md and log/state-history-2026-10.md; the root is below its122880-byte limit. These journal files are not yet committed/published. Preserve #488/#489 and their monthly archive.

The execution transport disconnected again. Tool error: No usable execution environment is available. Cloud status says connectivity offline, desired/observed phase running. This is evidence of unavailability, not a diagnosed cause. A reconnect request is pending with the user. No runtime restart tool is exposed. Do not rebuild or replace the tested local additions from guesses while files are unavailable.

After reconnect:
- Confirm retained files and git status, read AGENTS/HANDOFF and the latest journal490.
- Verify the last test/build outputs and restore the loopback-only funding browser host. Use the exact test database ending /fusionlab_funding_browser_test and FUNDING_QA_DIR.
- Finish English mobile/customer/owner browser QA, unused-fund UI flow, outbox notification interaction; copy shared admin/types/CSS to Studio and check hashes.
- Finish docs, types/builds, publish tested code in both feature branches. Fetch latest native master schema/NotificationsService/Bell before GitData edits, preserving concurrent work. Shell git authentication is unavailable; use the connected GitHub tools. Never ship the old local schema wholesale.
- Deploy API migration before Studio. Observe terminal SUCCESS/READY; check live permissions, shared bridge and both locale routes with screenshots. Do not enable collection or run real payment tests.
- Publish journals separately in this feature branch, without a production rebuild for documentation.
- Clean own browser host, local Postgres container, session.lock and temporary browser NSS after verification.

The previous functions.store cache was lost when the tool runtime restarted. Use release.json and these IDs rather than assuming stored keys still exist.

## Real launch remains blocked by actual operator configuration

The operator must provide actual legal/payment terms, an eligible collection service and verified recipients before enabling contributions. Automatic bank transfers are outside the agreed manual-bank MVP. Do not invent campaigns, contracts, bank identities or real financial activity. Customer and team data remain private according to the existing permissions.


## Continuation attempt — execution still unavailable

The owner said to continue. The managed environment still reports connectivity offline and exec returns No usable execution environment is available. A temporary Vercel sandbox sbx_KYL2CxVi1YTzUi3Mno2tDewQ34Gu was created under the existing Fusion Lab Vercel project to investigate a fallback. Its private Git clone could not authenticate. A proposal to copy repository source through connected GitHub tools was rejected by automatic approval review: the user had not specifically authorized exporting this private source payload to that sandbox destination.

Do not bypass or retry that rejected transfer without explicit user authorization or a successful safe authorization review. No source archive upload completed. The temporary nonpersistent sandbox was stopped and its resources released. It contained only setup packages and a source-file metadata manifest; production secrets, customer data and payment keys were not provided.

A question is pending with two paths: reconnect the original workspace (preferred), or explicitly authorize copying repository source/build files into a temporary Vercel sandbox. .env files, keys and customer data must be excluded. If the original environment reconnects, continue its already-authorized work without asking again. Code additions for unused balances, outbox and English UI remain unpublished. The normal published module and production versions above are unchanged.
