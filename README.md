# SLSEA Solar Generation API

Node.js, Express and MongoDB API for current and historical rooftop solar generation. SLSEA staff read within their jurisdiction; devices append measurements only for their assigned installation. Swagger provides the interactive API interface.

## Run locally

1. Use Node.js 22 or later and run `npm ci`.
2. Copy `.env.example` to `.env` if `.env` does not already exist.
3. Set `MONGODB_URI` to the private persistent database URI and `JWT_SECRET` to a random secret of at least 32 characters. Set a private `SEED_PASSWORD` of at least 16 characters if creating seed data.
4. Allow the application machine's outbound IP in Atlas and give the database user access to the intended database.
5. For an empty dedicated database, run `npm run seed`. For an existing seeded database, run `npm run verify:database`.
6. Run `npm start`, or `npm run dev` for Node watch mode.
7. Open `http://localhost:3000/api/docs/`. The specification is `/api/openapi.json`; readiness is `/health`.

Startup validates configuration, connects to MongoDB, then listens on `PORT` (default 3000). Production and seeding require a persistent URI. The optional temporary local database is for experiments and loses data when stopped.

Seeding refuses occupied project collections. `npm run seed -- --reset` explicitly replaces all six collections and is destructive; it is not a verification command. Seeding is never part of application startup or deployment.

## Synthetic data and authentication

The seed produces 9 provinces, 25 districts, 25 grid substations, 200 installations, 134,600 readings and 203 accounts. Each installation has 673 quarter-hour readings spanning exactly 168 hours. Generation follows synthetic Colombo daylight; new measurements do not arrive automatically after seeding.

| Email | Access |
| --- | --- |
| `admin@slsea.lk` | National reader |
| `western@slsea.lk` | Western Province reader |
| `colombo@slsea.lk` | Colombo District reader |
| `device1@slsea.lk` through `device200@slsea.lk` | Assigned-installation writes only |

Demo accounts share the private password supplied during seeding. There is no default password. Updating `SEED_PASSWORD` alone does not change existing password hashes. Give marking credentials privately; never commit passwords, tokens or the Atlas URI.

In Swagger, POST `/auth/login`, copy the returned token, click **Authorize**, and paste the token only. Leave conditional headers empty for a first GET. Reader tokens cannot create readings, and device tokens cannot use protected reads.

## Get your permitted data without entering IDs

After login and Swagger **Authorize**, execute `GET /api/me`. The server identifies your current account from the JWT subject and returns your role plus your assigned province, district or substation, including its ancestor context. National readers receive `NATIONAL` with no single assigned geographic resource.

You can execute these collection endpoints without any path ID or geographic filter:

| Endpoint | Automatically returned data |
| --- | --- |
| `/api/provinces` | Permitted provinces or ancestor province context |
| `/api/districts` | Permitted districts |
| `/api/substations` | Permitted substations |
| `/api/installations` | Installations within permitted substations |
| `/api/readings` | Paginated history within permitted scope |

For `colombo@slsea.lk`, `/api/me` identifies Colombo and Western Province; `/api/districts` returns only Colombo. A national reader sees all permitted districts; a province reader sees districts in that province. Devices remain write-only and are denied these reader endpoints. `/me` and the three new top-level collections reject query parameters; `/readings` keeps its existing narrowing filters.

The server uses the current database account’s role and assignment on every request. JWT role/jurisdiction claims do not grant broader permissions. Existing ID-based atomic, nested-collection and district-summary endpoints remain available when selecting a particular resource.

Route IDs are MongoDB `_id` values, not installation display codes such as `SLSEA-0001`. Discover an installation through provinces -> province districts -> district substations -> substation installations. An assigned device can POST a sample; an authorized reader can retrieve its returned Location.

## API surface

All paths below are under `/api`. The root and login are public; resource operations require a bearer token.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Public API entry point |
| POST | `/auth/login` | Reader/device authentication |
| GET | `/me` | Current reader and assigned jurisdiction |
| GET | `/provinces` | Visible provinces |
| GET | `/districts` | Automatically scoped district collection |
| GET | `/substations` | Automatically scoped substation collection |
| GET | `/installations` | Automatically scoped installation collection |
| GET | `/provinces/:provinceId` | Province |
| GET | `/provinces/:provinceId/districts` | Permitted districts in province |
| GET | `/districts/:districtId` | District |
| GET | `/districts/:districtId/substations` | Permitted substations |
| GET | `/districts/:districtId/generation-summary` | Scoped current power and estimated daily energy |
| GET | `/substations/:substationId` | Substation |
| GET | `/substations/:substationId/installations` | Installations |
| GET | `/installations/:installationId` | Installation, hierarchy and latest reading |
| GET | `/installations/:installationId/last-reading` | Most recent reading and derived generation status |
| GET | `/installations/:installationId/readings` | Installation history |
| GET | `/installations/:installationId/readings/:readingId` | Individual reading |
| GET | `/readings` | History across permitted installations |
| POST | `/installations/:installationId/readings` | Assigned device appends a reading |

History parameters: `page`, `pageSize` (capped at 100), `from`, `to`, `order=asc|desc`. Regional `/readings` additionally accepts `provinceId`, `districtId` and `substationId`; combined filters are intersected. Unauthorized geographic filters return 403. Dates must be real ISO 8601 timestamps with timezone, for example `2026-10-01T00:00:00Z`. Encode `+` as `%2B` in query-string offsets.

History returns `data`, pagination totals and relative `self`/`next`/`previous` links. Sorting uses timestamp plus ID for deterministic ties. Pagination is not a database snapshot; concurrent inserts can shift pages.

Domain GET representations handled by the HTTP helper use private ETags. Send `If-None-Match` to receive an empty 304 when unchanged. Database-backed representations also expose Last-Modified when a modification time is available. ETag takes precedence and is preferred because HTTP dates have second precision. The latest-reading body exposes its timestamp rather than a constantly changing age value. Clients calculate age themselves. Composite validators include populated hierarchy and latest-reading data. The summary uses only ETag because freshness and day boundaries change with time.

Ingestion returns 201 and a retrievable Location. Duplicate installation/timestamp pairs return 409 Conflict. Failed If-Match or If-Unmodified-Since retrieval preconditions return 412 Precondition Failed. Readings are append-only through the API; known resources reject unsupported PUT/PATCH/DELETE methods with 405 and Allow once earlier body/media checks pass. Reader accounts have no data-management writes. The separately provisioned SYSTEM_ADMIN extension below supplies management CRUD while preserving append-only readings.

Client errors consistently contain string `code`, `message`, and `detail`. Invalid JSON/input is 400, unsupported Accept is 406, unsupported request media type is 415 and oversized bodies are 413. Request bodies are limited to 100 KB.

The district summary excludes readings older than 30 minutes from current power. The last-reading endpoint still returns its latest known sample, even when stale; it does not establish live connectivity. `todayEstimatedEnergyKwh` integrates power over actual sample intervals, holding each sample until the next sample or now, capped at 30 minutes and clipped to the Asia/Colombo day. Gaps beyond 30 minutes contribute zero. This is an estimate, not billing-grade energy or a cumulative-counter difference. Generation status describes the latest sample rather than live connectivity.

## Tests and verification

```sh
npm test
npm run test:unit
npm run test:integration
npm run verify:database
npm run verify:seed
```

Tests use `node:test`, real local HTTP and disposable MongoDB fixtures. Seed unit tests use mocked persistence. The complete suite includes API permissions, history navigation/filter/order, validators, summary calculation, login throttling, smoke configuration and OpenAPI response contracts. The first integration run may download the MongoDB binary and needs local port access.

`verify:database` inspects the configured persistent database without changing it. `verify:seed` creates and verifies a full-size seed in a new disposable database, never Atlas. The last recorded full-suite result was **53 passed, 0 failed, 0 skipped on 8 October 2026**. Personal verification outputs are stored separately from the repository; run the commands above to obtain fresh evidence.

## Deployment

[render.yaml](render.yaml) prepares a native Node 22 service. Connect the repository in Render and create a Blueprint, or use the same settings on a compatible Node host.

| Setting | Value |
| --- | --- |
| Node version | 22 |
| Build command | `npm ci --omit=dev` |
| Start command | `npm start` |
| Health path | `/health` |
| Production mode | `NODE_ENV=production` |
| Application port | Host-supplied `PORT`, otherwise 3000 |
| Database | Private persistent `MONGODB_URI` |
| Signing secret | Private random `JWT_SECRET`, at least 32 characters |
| Token lifetime | `JWT_EXPIRES_IN=8h` unless deliberately configured otherwise |

The Blueprint generates a JWT secret and requests the MongoDB URI privately. It sets `TRUST_PROXY_HOPS=1`; confirm that value matches the actual proxy topology. The hosting edge supplies HTTPS. Allow the host's outbound IP addresses in Atlas and use a database user with access to the intended database. Enter secrets in host settings; give demo credentials to the marker privately.

Use `npm run verify:database` for an existing seeded database. Seed a new empty dedicated database explicitly with a private `SEED_PASSWORD`; never add seeding or `--reset` to the build or startup command. An interrupted seed can leave partial data because insertion is not transactional.

To verify a public deployment:

1. Run `npm test` locally and `npm run verify:database` against the intended persistent database.
2. Privately set `API_BASE_URL` to the public HTTPS origin without `/api`, and set `SMOKE_EMAIL`/`SMOKE_PASSWORD` to an authorized reader.
3. Run `npm run verify:deployment`. It checks health, Swagger/specification, authentication, current reader context and automatic district scope, populated history and empty conditional 304 without inserting data.
4. Verify reader scope boundaries, device read denial, own-device 201/Location, authorized reader retrieval, duplicate 409, history navigation/filter/order and failed precondition 412. Capture dated results with secrets redacted.

The smoke verifier rejects redirects and public HTTP. `SMOKE_ALLOW_LOCAL_HTTP=true` only allows loopback HTTP for local checks. `/health` reports connection state rather than a fresh database ping or full integrity check.

The [GitHub Actions workflow](.github/workflows/test.yml) runs Node 22 tests on push/pull request. Prepared configuration and localhost checks are not evidence of public deployment or a completed remote CI run. Record actual public API/Swagger URLs and verification results after deployment, and keep the service populated and available at marking time.

## Security and limitations

JWT verification explicitly permits HS256 and reloads the active account for every protected request. Role and geographic/installation relationships enforce permissions. Helmet, a 100 KB JSON limit and sanitized errors provide additional controls. Login allows 30 requests per IP/subnet per 15 minutes; its limiter is per-process. Configure `TRUST_PROXY_HOPS` for the actual hosting topology.

MongoDB references are not enforced foreign keys. Seed insertion is not transactional. Offset pages can shift during concurrent writes. Daily energy is an estimate with a 30-minute sample hold cap. Shared demo passwords, lack of per-token revocation and absence of load benchmarks remain limitations.

## Coursework submission

Keep actual AI prompts, assistance records and verification evidence separately for the report appendices. The brief requires disclosure in Appendix A; it does not prescribe standalone Markdown audit or development-log files in the repository. The module design white paper remains unavailable. Readings remain append-only; management CRUD is an explicit extension, and acceptance against the rubric wording remains unconfirmed.

Submission also needs a public seeded HTTPS API and Swagger, module-leader collaborator access and genuine commit history, the student's own 2250–2750-word report in the official template, a signed declaration, actual AI disclosure and viva.

## Explicit extension: management CRUD

The original model remains national/regional readers plus append-only device ingestion. A separately provisioned `SYSTEM_ADMIN` extends it with management CRUD; `ADMIN` still means national reader. This implementation does not imply lecturer approval or guaranteed rubric compliance.

| Account role | GET resources | POST readings | Management POST/PUT/PATCH/DELETE |
| --- | --- | --- | --- |
| ADMIN | National | Denied | Denied |
| PROVINCE_OFFICER / DISTRICT_OFFICER / SUBSTATION_OFFICER | Assigned hierarchy | Denied | Denied |
| DEVICE | Denied | Assigned active installation only | Denied |
| SYSTEM_ADMIN | National | Denied | Allowed |

New operations under `/api`: POST on `/provinces`, `/districts`, `/substations`, `/installations`; PUT, PATCH and DELETE on each corresponding `/{MongoDB ObjectId}` resource. Existing GETs and reading ingestion retain their representations, ownership and jurisdiction checks. Reading PUT/PATCH/DELETE return 405 with Allow.

POST returns 201 with Location. PUT requires the entire editable representation and removes omitted optional `inverterId`; PATCH uses an `application/json` object containing only fields to change. This is a field-object format, not RFC JSON Patch or JSON Merge Patch. Null, unknown/protected fields, empty objects and incorrect primitive types return 400. POST defaults installation `active` to true; PUT requires it. PUT of identical values preserves the representation and validators. DELETE returns 204 with no body; subsequent DELETE returns 404, while the deleted state remains unchanged (idempotent effect).

| Resource | Editable fields | Restricted updates and deletion |
| --- | --- | --- |
| Province | name, code | Delete blocked by districts or scoped accounts |
| District | name, province | Parent change/delete blocked by substations or scoped accounts |
| GridSubstation | name, code, district | Parent change/delete blocked by installations or scoped accounts |
| SolarInstallation | installationId, ownerName, meterId, inverterId (optional), capacityKw, substation, active | Identity fields installationId/meterId/inverterId and parent changes blocked by any readings or device accounts; deletion blocked by these dependencies |

References must resolve to an existing parent. Province code, substation code, installationId, meterId and district name within province retain database unique constraints; conflicts return 409. Codes/installationId retain existing uppercase normalization. Timestamps, `_id`, `__v`, derived fields and account fields are protected. All accounts, including inactive ones, count as scope dependencies. No cascading deletion occurs. Use `PATCH /api/installations/{id}` with `{"active":false}` to stop ingestion while retaining history and device identity; activation is also supported. Descriptive and operational changes remain permitted with history.

Mutation If-Match uses the exact GET representation, including populated ancestors and installation lastKnownReading; weak/stale tags return 412 before saving. If-Unmodified-Since is supported with If-Match precedence. Matching If-None-Match also returns 412 for mutations. Strong ETags handle changes within an HTTP-date second. Individual/populated representations derive Last-Modified from their persisted timestamps. A persisted management deletion clock conservatively invalidates collection date validators after writes, including deletion; ETags continue to hash each actual response. The clock may advance for a failed storage write; this causes conservative revalidation, not hidden data changes.

Concurrency boundary: management writes and reading ingestion share a process-local queue. Ingestion refreshes the installation under that queue, and stale conditional mutations cannot both succeed within one process. Relationship checks, writes and cache-clock changes are separate database operations, not a cross-document transaction. **Run one API writer process and coordinate offline account provisioning while it is stopped.** Multiple API processes, direct database writes, or concurrent offline scope provisioning can race with these checks; distributed atomic integrity is not guaranteed. Database unique indexes enforce uniqueness independently. Reads are not snapshot transactions. A future multi-writer deployment needs shared transactional coordination for all dependent writers, including account provisioning.

### Secure management account provisioning

Run `node scripts/provision-system-admin.js` interactively in a trusted terminal with the API stopped, using the existing secured database configuration. The command requires persistent MONGODB_URI and valid JWT_SECRET; it prompts for name, a new email and a hidden unique password of at least 16 characters, hashes with bcrypt cost 12, and creates only one national SYSTEM_ADMIN account. It does not reset/reseed, change existing accounts, or supply default credentials. A duplicate email fails rather than elevating an existing reader. Keep credentials out of shell arguments, version control and reports. Login uses the existing `/api/auth/login`; no registration/account-management HTTP endpoint was added. This script was not run against Atlas during implementation.

Suggested report points: explain the explicit management extension, the role matrix and preserved append-only history; contrast PUT replacement with field-object PATCH; demonstrate 201/Location, empty 204 and repeated-delete 404; show dependency/uniqueness 409 and stale-precondition 412; describe ETag/date validation and disclose the single-writer concurrency boundary. Use isolated-test evidence and discuss rubric interpretation without claiming approval.
