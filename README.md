# SLSEA Solar Generation API

REST API for current and historical rooftop solar generation data, built with Node.js, Express and MongoDB.

The API provides jurisdiction-scoped reads, append-only device readings, management CRUD, pagination, filtering, sorting, conditional requests and Swagger documentation.

## Run Locally

Requires Node.js 22 or later.

1. Run `npm ci`.
2. Copy `.env.example` to `.env` if it does not already exist.
3. Configure `MONGODB_URI` and a random `JWT_SECRET` of at least 32 characters.
4. Allow the application's IP address in MongoDB Atlas.
5. Run `npm start`, or `npm run dev` during development.

Swagger: http://localhost:3000/api/docs/  
OpenAPI: http://localhost:3000/api/openapi.json  
Health: http://localhost:3000/health

For an existing seeded database, run `npm run verify:database`. Use `npm run seed` only for an empty dedicated database, with a private `SEED_PASSWORD` of at least 16 characters. Seeding is not part of startup or deployment.

## Authentication and Permissions

Log in through `POST /api/auth/login`, then paste the returned token into Swagger's **Authorize** field.

| Role | Permissions |
|---|---|
| ADMIN | National read access |
| PROVINCE_OFFICER / DISTRICT_OFFICER / SUBSTATION_OFFICER | Read access within the assigned jurisdiction |
| DEVICE | Submit readings for its assigned active installation only |
| SYSTEM_ADMIN | National read access and management CRUD |

Readers cannot submit readings. Devices cannot use protected read endpoints. Generation readings cannot be updated or deleted by any role.

Use `GET /api/me` to view the current reader's assigned jurisdiction. The province, district, substation, installation and reading collections automatically enforce permitted scope.

## Management Operations

SYSTEM_ADMIN can create, replace, partially update and delete provinces, districts, substations and installations.

- POST returns `201 Created` with a `Location` header.
- PUT replaces the complete editable representation.
- PATCH updates selected fields using an `application/json` object.
- DELETE returns `204 No Content`; repeating deletion returns `404`.
- Dependencies and uniqueness conflicts return `409`.
- Failed mutation preconditions return `412`.

Deletion is blocked when dependent records or scoped accounts exist. Installation identity and parent changes are restricted when readings or device accounts exist. Deactivate an installation with `{"active":false}` to preserve its history. No cascading deletion occurs.

Full endpoints, request schemas and response details are documented in Swagger.

## Create a Management Account

Stop the API and run this interactively using the existing database configuration:

`node scripts/provision-system-admin.js`

Enter a name, a new email and a unique password of at least 16 characters. The script creates a SYSTEM_ADMIN without resetting data or changing existing accounts.

## Data and Verification

The synthetic seed contains 9 provinces, 25 districts, 25 substations, 200 installations, 134,600 readings and 203 accounts. It provides one week of reading history per installation.

Useful commands:

- `npm test` — run the test suite.
- `npm run verify:database` — inspect the configured database without changing it.
- `npm run verify:seed` — verify seeding in a disposable database.
- `npm run verify:deployment` — run deployment smoke checks using privately configured credentials.

## Deployment and Security

Render configuration is provided in `render.yaml`. Configure the persistent database and secrets through the hosting provider, and verify the deployed API over HTTPS.

Never commit `.env`, passwords, tokens or private database connection strings. Never include seed/reset commands in deployment startup.

Management writes and ingestion use process-local coordination. Run one API writer process; multi-process or direct database writes can bypass these coordination guarantees. Perform offline account provisioning while the API is stopped.

Daily district energy is an estimate, MongoDB references are not enforced foreign keys, and offset pagination can shift during concurrent inserts.
