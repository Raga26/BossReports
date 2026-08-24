# BossReports

Weekly reports app for BOSS chapters. Super Admin (Bhushan) creates chapters and assigns each chapter president. The president maintains teams and captains. Team captains add members and enter scores — members do not sign in.

## Run locally

1. Copy `server/.env.example` to `server/.env` and fill in MongoDB and secrets.
2. From `server/`: `npm install` then `npm start`.
3. Open http://localhost:3000

## Deploy on Render

See the step-by-step in the repo description after push, or follow **Deploy on Render** in the GitHub repo README below.

### Render settings

| Setting | Value |
|---|---|
| Runtime | Node |
| Build command | `npm install --prefix server` |
| Start command | `npm start` |
| Health check | `/api/health` |

### Environment variables

| Name | Required | Notes |
|---|---|---|
| `MONGODB_URI` | Yes | Atlas connection string. In Atlas → Network Access, allow `0.0.0.0/0` so Render can connect. |
| `JWT_SECRET` | Yes | Long random string. Render can generate this. |
| `PLATFORM_NAME` | Yes | `Bhushan` |
| `PLATFORM_PASSWORD` | Yes | Super Admin password. Only used when the first super-admin user is created. |
| `NODE_ENV` | Optional | `production` |
| `PORT` | No | Render sets this automatically. |

Do not upload `.env`. Set these only in the Render dashboard.
