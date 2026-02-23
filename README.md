# SplitEasier

SplitEasier is a full-stack app for itemized bill splitting across households, with optional Splitwise integration.

It supports:
- email/password auth
- Splitwise OAuth login
- household/group management
- item-level bill splitting
- push sync to Splitwise when creating/updating/deleting bills
- pull sync from Splitwise expenses into local bills (with basic conflict detection)

## Contents
- Overview
- Tech Stack
- Architecture
- Core Flows
- Data Model
- API Overview
- Local Development
- Environment Variables
- Splitwise OAuth Setup
- Running the App
- Deployment on Vercel
- Troubleshooting
- Security Notes
- Scripts

## Overview

SplitEasier is designed for groups (roommates, trips, shared households) that need precise cost splits.  
Instead of splitting totals evenly, each bill has line items and each item can be assigned to specific people.

When a household is linked to a Splitwise group:
- local changes can be pushed to Splitwise
- Splitwise changes can be pulled back into local bills

## Tech Stack

Frontend:
- React 18
- React Router
- Vite
- Vite PWA plugin
- Motion + Lucide icons

Backend:
- Node.js + Express
- MongoDB + Mongoose
- JWT auth
- Splitwise OAuth + REST API integration

Deployment:
- Vercel static build for frontend (`dist/`)
- Vercel serverless function for API (`/api/index.js`)

## Architecture

Frontend app:
- Entry: `src/main.jsx`
- Routes: `src/App.jsx`
- API client: `src/api/client.js`
- Auth context: `src/context/AuthContext.jsx`
- Pages:
  - Landing: `src/pages/LandingPage.jsx`
  - Login: `src/pages/Login.jsx`
  - Signup: `src/pages/Signup.jsx`
  - Dashboard: `src/pages/Dashboard.jsx`
  - Household: `src/pages/HouseholdPage.jsx`
  - Splitwise callback: `src/pages/SplitwiseCallback.jsx`

Backend app:
- Express app: `server/app.js`
- Server startup: `server/index.js`
- DB connector: `server/db.js`
- Auth middleware: `server/middleware/auth.js`
- Splitwise helper: `server/lib/splitwise.js`
- Routes:
  - `server/routes/auth.js`
  - `server/routes/users.js`
  - `server/routes/households.js`
  - `server/routes/bills.js`
  - `server/routes/splitwise.js`

Vercel serverless API bridge:
- `api/index.js` exports `server/app.js`

## Core Flows

### 1. Auth
- Register/login via email and password.
- Splitwise OAuth login can create/link local users.
- JWT token is stored in localStorage and sent as `Authorization: Bearer <token>`.

### 2. Households
- Create local households manually.
- Or import Splitwise groups via `POST /api/households/import-splitwise`.
- Imported groups are linked using `splitwiseGroupId`.

### 3. Bills
- Create/update/delete bills within a household.
- Each bill includes:
  - bill name
  - items
  - per-member totals
- Only bill creator can edit/delete that bill.

### 4. Splitwise sync

Push sync (local -> Splitwise):
- On bill create: create Splitwise expense.
- On bill edit: update existing Splitwise expense (or create if missing).
- On bill delete: delete Splitwise expense if mapped.

Pull sync (Splitwise -> local):
- Triggered from household page via **Sync Splitwise** button.
- Calls `POST /api/households/:id/sync-splitwise`.
- Imports/updates/deletes local bills based on Splitwise expenses.
- Uses metadata for conflict detection.

Conflict rule (current):
- If local changed since last sync AND remote changed since last known remote update, mark conflict and do not auto-overwrite.

## Data Model

### User (`server/models/User.js`)
- `email`
- `passwordHash`
- `name`
- `splitwise`:
  - `id`
  - `accessToken`
  - `refreshToken`
  - `tokenType`
  - `expiresAt`

### Household (`server/models/Household.js`)
- `name`
- `ownerId`
- `memberIds`
- `splitwiseGroupId`
- `splitwiseGroupName`
- `splitwiseLastPulledAt`
- `splitwiseLastCursor`

### Bill (`server/models/Bill.js`)
- `householdId`
- `billName`
- `items[]`
- `totals`
- `totalAmount`
- `createdBy`
- `splitwiseSync`:
  - `status` (`pending|synced|failed|skipped`)
  - `expenseId`
  - `syncedAt`
  - `lastAttemptAt`
  - `error`
  - `expenseUpdatedAt`
  - `lastLocalEditAt`
  - `lastSyncDirection` (`push|pull`)
  - `conflict`

## API Overview

Base path: `/api`

Auth:
- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/splitwise/start`
- `GET /auth/splitwise/callback`

Users:
- `GET /users/me`
- `GET /users/search?q=...`

Households:
- `GET /households`
- `POST /households`
- `GET /households/:id`
- `PATCH /households/:id`
- `POST /households/:id/members`
- `DELETE /households/:id/members/:userId`
- `POST /households/import-splitwise`
- `POST /households/:id/sync-splitwise`

Bills:
- `GET /households/:householdId/bills`
- `POST /households/:householdId/bills`
- `GET /households/:householdId/bills/:billId`
- `PATCH /households/:householdId/bills/:billId`
- `DELETE /households/:householdId/bills/:billId`

Splitwise passthrough routes:
- `GET /splitwise/connection`
- `GET /splitwise/current-user`
- `GET /splitwise/groups`
- `GET /splitwise/expenses`
- `POST /splitwise/expenses`

## Local Development

### Prerequisites
- Node.js 18+ (recommended)
- npm
- MongoDB (Atlas or local instance)
- Splitwise developer app (for OAuth)

### Install

```bash
npm install
```

### Environment

Copy `.env.example` to `.env` and fill values:

```bash
cp .env.example .env
```

## Environment Variables

Required for backend:

| Variable | Purpose |
|---|---|
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | JWT signing secret |
| `FRONTEND_URL` | Frontend origin used in OAuth/callback behavior |
| `SPLITWISE_CLIENT_ID` | Splitwise OAuth client id |
| `SPLITWISE_CLIENT_SECRET` | Splitwise OAuth client secret |
| `SPLITWISE_REDIRECT_URI` | OAuth redirect URI (must match Splitwise app settings) |

Optional:

| Variable | Default |
|---|---|
| `JWT_EXPIRES_IN` | `7d` |
| `PORT` / `SERVER_PORT` | `3001` |
| `SPLITWISE_BASE_URL` | `https://secure.splitwise.com` |
| `SPLITWISE_API_BASE` | `https://secure.splitwise.com/api/v3.0` |
| `SPLITWISE_STATE_SECRET` | falls back to `JWT_SECRET` |

## Splitwise OAuth Setup

In Splitwise developer settings, configure redirect URI to exactly match your env:

Local:
- `http://localhost:5173/api/auth/splitwise/callback`

Vercel example:
- `https://your-domain.vercel.app/api/auth/splitwise/callback`

Important:
- `SPLITWISE_REDIRECT_URI` and Splitwise app redirect must match exactly.
- If this is wrong, OAuth may appear to work partially but imports/sync will fail.

## Running the App

Run backend:

```bash
npm run server
```

Run frontend (separate terminal):

```bash
npm run dev
```

Open:
- `http://localhost:5173`

Vite proxies `/api/*` to `http://localhost:3001` in local dev (`vite.config.js`).

## Deployment on Vercel

This repo uses:
- frontend static output: `dist`
- API function: `api/index.js` -> Express app
- rewrites in `vercel.json`

`vercel.json` rewrites:
- `/api/:path*` -> `/api`
- non-API routes -> `/index.html`

Recommended Vercel environment variables:
- all backend env vars listed above
- `FRONTEND_URL` set to your deployed origin
- `SPLITWISE_REDIRECT_URI` set to deployed callback URL

After deploy:
1. Login
2. Import Splitwise groups from dashboard
3. Open a linked household (must show linked group)
4. Use **Sync Splitwise** in Bills section

## Troubleshooting

### Sync button not visible
The button is shown only when household has `splitwiseGroupId`.

Checklist:
- Imported Splitwise groups successfully
- Household displays "Linked Splitwise group: ..."
- You are on latest deployment/commit
- Clear PWA cache/service worker if stale UI appears

### OAuth callback issues
- Verify `SPLITWISE_REDIRECT_URI` exactly matches Splitwise app config.
- Verify `FRONTEND_URL` matches deploy origin.

### Splitwise connected but import/sync fails
- Check `/api/splitwise/connection` response while authenticated.
- Confirm member mappings include Splitwise user IDs.

### Bill delete behavior
- If bill has `splitwiseSync.expenseId`, deletion attempts remote delete first.
- If remote delete fails, local delete is blocked.

### Conflicts during pull sync
- Conflict means both local and remote changed since last sync.
- Current behavior marks conflict and skips overwrite.

## Security Notes
- Never commit `.env`.
- Use strong random values for `JWT_SECRET` and `SPLITWISE_STATE_SECRET`.
- Use HTTPS in production.
- Rotate leaked secrets immediately.

## Scripts

Root `package.json`:
- `npm run dev` -> run Vite dev server
- `npm run build` -> production frontend build
- `npm run preview` -> preview built frontend
- `npm run server` -> run Node backend
- `npm run server:watch` -> run backend with watch mode

Server `server/package.json` (optional direct run):
- `npm --prefix server run start`
- `npm --prefix server run dev`
