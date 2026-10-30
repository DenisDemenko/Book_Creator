# Fusion GeoHome — private cloud versions and KumCAD handoff

This module uses the existing Studio account, Firebase-to-session exchange and paid subscription record. It does not create a second subscription system.

Only subscriptions whose plan is exactly `pro` or `ultra`, status is `active`, and `currentPeriodEnd` is in the future can list, read, save or export cloud projects. Free, Start, Team, expired and cancelled subscriptions are denied. Admin role alone does not bypass the product rule. Owners may delete their own cloud data after downgrade; existing versions are otherwise retained.

The Marketplace authenticates via the existing `/api/auth/firebase-session` endpoint. The iframe never receives the Firebase token. GeoHome requests carry `X-GeoHome-Client: marketplace-v1` and `X-GeoHome-Uid`; the latter must match the authenticated Studio user's Firebase UID. The custom header prevents a cross-site HTML form from issuing authenticated mutations; these routes do not grant cross-origin CORS access.

## Storage and API

The existing persistent SQLite database stores `geohome_projects` and `geohome_versions`; tables and the owner index are created during route registration after `initStore`. A configured durable Studio volume and Node's SQLite support are required. There is no JSON/in-memory fallback for cloud projects: unavailable persistent storage returns 503.

- `GET /api/geohome/access`: current plan, expiry and entitlement.
- `GET /api/geohome/projects`: this user's projects only.
- `POST /api/geohome/projects`: `{id, name, baseVersion, requestId, package}`. Client UUIDs make the first save retry-safe. Matching request IDs and payloads return the same revision; changed payloads or stale `baseVersion` return 409. The transaction atomically writes the project head and immutable version.
- `GET /api/geohome/projects/:id?version=N`: latest or a historical snapshot with `headVersion`, SHA-256 and version history. SHA-256 is verified before use.
- `DELETE /api/geohome/projects/:id`: owner-only deletion with cascading versions.
- `POST /api/geohome/projects/:id/cad` with `{version:N}`: paid, owner-only ZIP download for that saved revision. Entitlement is checked again at export time, including after a downgrade.

Packages have schema `fusion.geohome.project`, version 1 and millimetre units. They include geometry, beam/connector/material/opening/solar parameters, display layers, and panel settings for costs, foundations, loads, packaging, insulation and nesting. Maximum compact JSON size is 8 MiB. CAD vertices/struts/panels are checked against the model; this is data-integrity validation, not professional structural approval.

Canonical opening inputs live in `settings.params.openings`. The retired `doorParams` object and `doorFaceIds` array are optional, including their historical nested `params` variants. When supplied, their types are still validated. The server stores both modern and historical packages unchanged; it does not run either door geometry engine or rewrite archived snapshots.

Restoring a historical snapshot returns the current project head separately so an edited/restored design can become a new version while keeping intervening history. Concurrent writes still require the latest head. The UI also offers Save a copy.

## KumCAD

The supplied target is https://github.com/todorw/KumCAD. This is a native C++/Qt/OpenCASCADE application with STEP import, rather than an HTTP receiver.

The ZIP contains `dome.step`, `cad.json`, `project.json`, `manifest.json` and `README.txt`. In KumCAD's 3D window use File → Import STEP... . STEP carries panel surfaces and beam centre lines; exact profiles, cuts, connectors and original inputs remain in the JSON files. It does not claim manufacturing-ready solid end cuts. No private project data is put in a public link or query string.

The STEP writer was read with OpenCASCADE on a real GeoHome 3V model: 75 faces imported and X/Y/Z bounds matched source millimetres. Native KumCAD GUI operation was not exercised in this environment.

## Verification and rollout

`npm run test:geohome` exercises real HTTP handlers, existing session middleware, SQLite, Pro/Ultra gates, expiry/downgrade, CSRF/UID binding, ownership, retries/conflicts, corruption checks and KumCAD ZIP contents. Marketplace `test:geohome:cloud:browser` additionally uses these real routes/storage with an offline Firebase identity seam and the real GeoHome React/Three.js application. Live Firebase credentials and production were not used.

Deploy the reviewed Studio module before enabling cloud use on the Marketplace deployment. Keep the existing persistent volume; do not reset the database. Marketplace must retain its configured `/studio` proxy (`NOVA_ORIGIN`). No new payment credentials are required. A rollback to an older Studio build leaves these additive tables intact; do not delete projects to roll back code.
