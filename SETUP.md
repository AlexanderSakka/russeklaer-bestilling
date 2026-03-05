# Setup: Russeklaer Bestilling

Node.js server on Railway that serves an order form. Orders are saved to Google Sheets via a service account. Groups are managed through an admin panel.

## Architecture

- `server.js` — Express-like HTTP server (Node.js, no framework)
- `index.html` — Order form (served at `/` and `/bestilling?gruppe=Gruppenavn`)
- `admin.html` — Admin panel (served at `/admin`)
- Groups stored in a config Google Sheet (falls back to `GROUPS` env var)

## Setup

### 1. Service account

The project uses a Google service account for Sheets API access.

**Service account email:** `sheets-reader@gen-lang-client-0299601297.iam.gserviceaccount.com`

For local dev, place the key file at `.secrets/service-account.json`.
On Railway, set the `GOOGLE_SERVICE_ACCOUNT_KEY` env var with the JSON contents.

### 2. Config sheet (recommended)

1. Create a new Google Sheet
2. Share it with the service account email above (as Editor)
3. Set the `CONFIG_SHEET_ID` env var to the spreadsheet ID
4. On first startup, the server creates a "Config" tab and seeds it with any groups from the `GROUPS` env var

### 3. Environment variables

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Yes (prod) | Service account JSON key |
| `CONFIG_SHEET_ID` | Recommended | Spreadsheet ID for group config |
| `ADMIN_PASSWORD` | Recommended | Password for the admin panel |
| `GROUPS` | Fallback | JSON object `{"name": "spreadsheet_id"}` — used if no config sheet |
| `PORT` | No | Server port (default: 3001) |

### 4. Deploy

```bash
# Local
ADMIN_PASSWORD=test123 CONFIG_SHEET_ID=<id> node server.js

# Railway
# Set env vars in Railway dashboard, auto-deploys from GitHub
```

### 5. Admin panel

1. Go to `https://your-domain.com/admin`
2. Log in with the `ADMIN_PASSWORD`
3. Add groups: enter a name + spreadsheet URL/ID, test access, save
4. Each group gets a unique form URL: `/bestilling?gruppe=Gruppenavn`

### 6. Per-group spreadsheet setup

Each group's spreadsheet needs to be shared with the service account email. The server auto-creates a "Bestillinger" tab with headers on first order.

## Products

Edit the `PRODUCTS` object in `index.html` to change available products, colors, or sizes.
