# Limitless Backend (Node.js + Express + MongoDB)

Complete backend for the Limitless cognitive wellness platform. It owns the **entire**
backend surface: the AI/assessment engine the frontend already calls, plus a full REST
API (auth, users, assessments, admin, plans) backed by **MongoDB** — replacing all
direct Supabase calls, per the backend migration document.

## Architecture at a glance

- **MongoDB (Mongoose)** — collections `users`, `assessments`, `plans`, plus a
  GridFS bucket `pdf-reports` for PDF storage with public URLs.
- **JWT auth** — user tokens from register/login; admin tokens from `/api/admin/login`
  (credentials in env vars).
- **Deterministic scoring engine** — question IDs encode domain + polarity
  (`q_memory_1_n`), so `/analyze` is stateless and survives restarts.
- **Optional AI (Claude)** — personalizes question phrasing and recommendations;
  falls back to the built-in bank/library on any failure. Never breaks the API.
- **PDF reports** — drawn with pdfkit (no headless browser).
- **Optional SMTP email (Nodemailer)** — credentials/report/admin-notification emails
  from the backend (replaces EmailJS + formsubmit.co when configured).
- **Optional Stripe webhook** — HMAC-verified; marks users paid server-side.

## API Endpoints

### AI / Assessment engine (same contract the frontend already uses)

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Health/wake-up. Also `/` and `/api/v1/health` |
| POST | `/api/v1/generate-questions` | `{age, gender, locale}` → `{assessmentId, sections}` |
| POST | `/api/v1/analyze` | `{assessmentId, age, gender, responses[, userId]}` → report JSON. With `userId`, the report is auto-saved as an assessment |
| POST | `/api/v1/generate-pdf` | `{analysis, brand?}` → PDF binary |
| POST | `/api/v1/generate-teaser-pdf` | Free preview PDF with locked sections |

Validation errors return HTTP 422 as `{ detail: [{ loc, msg, type }] }` — the shape the
frontend's `apiUtils.js` already parses.

### Auth

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/register` | `{name, email, age?, gender?}` → `{user, tempPassword, token}` (201). 409 on duplicate email. Sends credential + admin emails when SMTP configured |
| POST | `/api/auth/login` | `{email, password}` (temp or set password) → `{token, user, latestAssessment}` |
| POST | `/api/auth/change-password` | `{email, currentPassword, newPassword}` — clears temp password + reset flag |

### Users & assessments (Bearer token: the user themself or an admin)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/users/:id` | User + assessment history (newest first) |
| PATCH | `/api/users/:id` | `name, age, gender, payment_status`. Compat: `report_json`/`pdf_url` are stored on the latest assessment |
| POST | `/api/assessments` | `{user_id, report_json?, pdf_url?}` → 201 |
| PATCH | `/api/assessments/:id` | Update `report_json` / `pdf_url` |

### PDF storage (GridFS — replaces the Supabase bucket)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/reports/:userId/pdf` | `{analysis, brand?, teaser?, sendEmail?}` → generates + stores PDF, saves URL on latest assessment, returns `{pdfUrl}` |
| POST | `/api/files/pdf-reports/:userId?fileName=x.pdf` | Raw `application/pdf` body upload (auth) → `{publicUrl}` |
| GET | `/files/pdf-reports/:userId/:fileName` | **Public** — streams the stored PDF |

### Admin (Bearer admin token)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/admin/login` | `{username, password}` from `ADMIN_USERNAME`/`ADMIN_EMAIL` + `ADMIN_PASSWORD` env → `{token}` |
| GET | `/api/admin/users` | All users, newest first, each with `assessments[]` and latest `report_json`/`pdf_url` mirrored |
| GET | `/api/admin/users/:id` | Single user detail |
| DELETE | `/api/admin/users/:id` | Deletes user + cascades assessments + stored PDFs |
| GET | `/api/admin/stats` | `{total_users, paid_users, demo_users, completed_assessments, new_users_24h, mrr, conversion_rate, ...}` |

### Other

| Method | Path | Notes |
|---|---|---|
| GET | `/api/plans` | Active plans by price (a default $19 "Premium Report" plan is seeded) |
| POST | `/api/enquiries` | Public contact/feedback form `{name, email, message}` — also emails the admin inbox (replaces formsubmit.co) |
| GET / DELETE | `/api/admin/enquiries[/:id]` | Admin: list / remove enquiries |
| POST | `/api/v1/webhooks/stripe` | Stripe payment confirmation (optional) |

**Emails:** registration triggers the official welcome email — subject
`Welcome <FirstName> | Limitless World`, brand story, plan, username/password,
first-login reset note, confidentiality warning, and the company footer
(support@limitlessworld.net). Requires SMTP env vars; without them sends are
skipped silently and logged.

## Database schema (MongoDB)

**users** — `name, email (unique, lowercased), temp_password, password_hash,
password_reset_required, payment_status (pending|paid|demo|free|trial), age, gender,
created_at, updated_at`

**assessments** — `user_id (ref users), report_json, pdf_url, created_at, updated_at`
(1-to-many from users; cascade-deleted with the user)

**plans** — `name, price, currency, interval, features[], is_active`

**pdf-reports (GridFS)** — files named `{userId}/{fileName}.pdf`, served publicly at
`/files/pdf-reports/{userId}/{fileName}`.

No migrations needed — Mongoose creates collections and indexes automatically on first use.

## Run locally

```bash
cd backend
npm install
copy .env.example .env     # set MONGODB_URI (Atlas or local) + JWT_SECRET
npm run dev                # http://localhost:5000
```

Without `MONGODB_URI` the AI/PDF endpoints still work; DB routes return 503.

## Tests

```bash
npm test
```

Runs a full integration suite against an **in-memory MongoDB** (registration, login,
password change, analyze auto-save, user/assessment CRUD, PDF storage + public URLs,
admin auth/stats/cascade-delete, permission checks). No external services needed.

## Deploy

**Primary target: the company VPS (160.153.179.249) on port 4000** — full
step-by-step guide in [DEPLOY.md](DEPLOY.md) (PM2 via `ecosystem.config.cjs`,
Nginx reverse proxy, certbot SSL). Ports 3000/3001 are reserved for Vigil.

Alternative: Render (`render.yaml` included). Either way, in MongoDB Atlas →
*Network Access*, allow the server's IP (or `0.0.0.0/0`).

## Point the frontend at this backend

- `seo react app/seo react app/src/lib/apiUtils.js` → change the base URL to your
  deployed backend.
- `public/api-proxy.php` → change `BACKEND_URL` the same way.
- Supabase client calls (`supabase.from(...)`) should be migrated to the REST
  endpoints above (register/login/users/assessments/admin), sending the JWT returned
  by register/login as `Authorization: Bearer <token>`.

## Environment variables

See [.env.example](.env.example). Required in production: `MONGODB_URI`, `JWT_SECRET`,
`ADMIN_PASSWORD`. Everything else is optional and feature-flagged.

## Project layout

```
backend/
├── src/
│   ├── server.js                 # entry point (connects MongoDB, boots app)
│   ├── app.js                    # express app, CORS, rate limits, route mounting
│   ├── config.js                 # env parsing + feature flags
│   ├── db/
│   │   ├── mongo.js              # connection + plan seeding
│   │   └── models/               # User, Assessment, Plan (Mongoose)
│   ├── middleware/               # JWT auth guards, validation (422), errors
│   ├── routes/                   # auth, users, assessments, admin, plans,
│   │                             # reports, files, AI engine, PDFs, webhook
│   └── services/
│       ├── questionBank.js       # built-in questionnaire + item-ID scheme
│       ├── analysisEngine.js     # deterministic scoring → report JSON
│       ├── aiService.js          # optional Claude personalization
│       ├── pdfService.js         # pdfkit report renderer
│       ├── fileStorage.js        # GridFS pdf-reports bucket
│       └── emailService.js       # optional SMTP email
├── test/integration.test.mjs     # full e2e suite (in-memory MongoDB)
├── render.yaml                   # one-click Render deploy
└── .env.example
```
