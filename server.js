const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { google } = require("googleapis");

const PORT = process.env.PORT || 3001;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const CONFIG_SHEET_ID = process.env.CONFIG_SHEET_ID || "";

// Mutable — loaded from config sheet or env var
let GROUPS = {};

// Auth
let authOptions;
if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  authOptions = { credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets"] };
} else {
  authOptions = { keyFile: ".secrets/service-account.json", scopes: ["https://www.googleapis.com/auth/spreadsheets"] };
}
const auth = new google.auth.GoogleAuth(authOptions);

// Cache HTML files
const HTML_FILE = fs.readFileSync(path.join(__dirname, "index.html"), "utf-8");
const ADMIN_HTML = fs.readFileSync(path.join(__dirname, "admin.html"), "utf-8");

// --- Config sheet helpers ---

async function getSheetsClient() {
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

async function ensureConfigTab(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: CONFIG_SHEET_ID });
  const tabNames = meta.data.sheets.map((s) => s.properties.title);
  if (!tabNames.includes("Config")) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: CONFIG_SHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: "Config" } } }],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: CONFIG_SHEET_ID,
      range: "Config!A1:B1",
      valueInputOption: "RAW",
      requestBody: { values: [["Gruppenavn", "SpreadsheetID"]] },
    });
    return true; // newly created
  }
  return false;
}

async function loadGroupsFromConfigSheet() {
  const sheets = await getSheetsClient();
  const isNew = await ensureConfigTab(sheets);

  // If tab was just created, seed with env var groups
  if (isNew) {
    const envGroups = process.env.GROUPS ? JSON.parse(process.env.GROUPS) : {};
    const rows = Object.entries(envGroups).map(([name, id]) => [name, id]);
    if (rows.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: CONFIG_SHEET_ID,
        range: "Config!A:B",
        valueInputOption: "RAW",
        requestBody: { values: rows },
      });
    }
    return envGroups;
  }

  // Read existing rows
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: CONFIG_SHEET_ID,
    range: "Config!A2:B",
  });
  const rows = result.data.values || [];
  const groups = {};
  for (const [name, id] of rows) {
    if (name && id) groups[name] = id;
  }
  return groups;
}

async function saveGroupToConfigSheet(name, spreadsheetId) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: CONFIG_SHEET_ID,
    range: "Config!A:B",
    valueInputOption: "RAW",
    requestBody: { values: [[name, spreadsheetId]] },
  });
}

async function removeGroupFromConfigSheet(name) {
  const sheets = await getSheetsClient();
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: CONFIG_SHEET_ID,
    range: "Config!A2:B",
  });
  const rows = result.data.values || [];
  const filtered = rows.filter(([n]) => n !== name);

  // Clear and rewrite
  await sheets.spreadsheets.values.clear({
    spreadsheetId: CONFIG_SHEET_ID,
    range: "Config!A2:B",
  });
  if (filtered.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: CONFIG_SHEET_ID,
      range: "Config!A2:B",
      valueInputOption: "RAW",
      requestBody: { values: filtered },
    });
  }
}

// --- Auth helper ---

function verifyAdmin(req) {
  if (!ADMIN_PASSWORD) return false;
  const header = req.headers["authorization"] || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (provided.length === 0) return false;
  // Constant-time comparison
  const a = Buffer.from(provided);
  const b = Buffer.from(ADMIN_PASSWORD);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// --- Request body parser ---

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
    req.on("error", reject);
  });
}

// --- Server ---

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- Public routes ---

  // Serve the order form
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/bestilling")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML_FILE);
    return;
  }

  // Serve admin page
  if (req.method === "GET" && url.pathname === "/admin") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(ADMIN_HTML);
    return;
  }

  // List groups (public)
  if (req.method === "GET" && url.pathname === "/groups") {
    const groupList = Object.entries(GROUPS).map(([name, id]) => ({
      gruppe: name,
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/" + id,
      formUrl: "/bestilling?gruppe=" + encodeURIComponent(name),
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(groupList, null, 2));
    return;
  }

  // Submit order
  if (req.method === "POST" && url.pathname === "/submit") {
    try {
      const data = await parseBody(req);
      const gruppe = data.gruppe || "Ukjent";
      const fullName = data.fullName;
      const orders = data.orders;
      const timestamp = new Date().toISOString();

      const spreadsheetId = GROUPS[gruppe];
      if (!spreadsheetId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ result: "error", message: "Ukjent gruppe: " + gruppe }));
        return;
      }

      const sheets = await getSheetsClient();

      // Ensure "Bestillinger" tab exists with headers
      const meta = await sheets.spreadsheets.get({ spreadsheetId });
      const tabNames = meta.data.sheets.map((s) => s.properties.title);
      if (!tabNames.includes("Bestillinger")) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{ addSheet: { properties: { title: "Bestillinger" } } }],
          },
        });
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: "Bestillinger!A1:G1",
          valueInputOption: "RAW",
          requestBody: {
            values: [["stk", "Type", "SIZE", "COLOR", "Name", "Bestiller", "Tidspunkt"]],
          },
        });
      }

      const rows = orders.map((o) => [
        1,
        o.product,
        o.size,
        o.color,
        o.etternavn || "",
        fullName,
        timestamp,
      ]);

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "Bestillinger!A:G",
        valueInputOption: "RAW",
        requestBody: { values: rows },
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ result: "success", rows: rows.length }));
    } catch (err) {
      console.error("Submit error:", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ result: "error", message: err.message }));
    }
    return;
  }

  // --- Admin routes (all require auth) ---

  // Verify password
  if (req.method === "POST" && url.pathname === "/api/admin/verify") {
    if (!ADMIN_PASSWORD) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: "ADMIN_PASSWORD not configured" }));
      return;
    }
    const ok = verifyAdmin(req);
    res.writeHead(ok ? 200 : 401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok }));
    return;
  }

  // All other admin routes require auth
  if (url.pathname.startsWith("/api/admin/")) {
    if (!verifyAdmin(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: "Unauthorized" }));
      return;
    }

    // List groups
    if (req.method === "GET" && url.pathname === "/api/admin/groups") {
      const groupList = Object.entries(GROUPS).map(([name, id]) => ({
        gruppe: name,
        spreadsheetUrl: "https://docs.google.com/spreadsheets/d/" + id,
        formUrl: "/bestilling?gruppe=" + encodeURIComponent(name),
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(groupList));
      return;
    }

    // Add group
    if (req.method === "POST" && url.pathname === "/api/admin/groups") {
      try {
        const data = await parseBody(req);
        const { name, spreadsheetId } = data;
        if (!name || !spreadsheetId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, message: "Mangler navn eller regneark-ID" }));
          return;
        }
        if (GROUPS[name]) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, message: "Gruppen finnes allerede" }));
          return;
        }
        GROUPS[name] = spreadsheetId;
        if (CONFIG_SHEET_ID) {
          await saveGroupToConfigSheet(name, spreadsheetId);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error("Add group error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: err.message }));
      }
      return;
    }

    // Delete group
    if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/groups/")) {
      try {
        const name = decodeURIComponent(url.pathname.split("/api/admin/groups/")[1]);
        if (!GROUPS[name]) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, message: "Gruppen finnes ikke" }));
          return;
        }
        delete GROUPS[name];
        if (CONFIG_SHEET_ID) {
          await removeGroupFromConfigSheet(name);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error("Delete group error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: err.message }));
      }
      return;
    }

    // Test sheet access
    if (req.method === "POST" && url.pathname === "/api/admin/test-sheet") {
      try {
        const data = await parseBody(req);
        const { spreadsheetId } = data;
        if (!spreadsheetId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, message: "Mangler regneark-ID" }));
          return;
        }
        const sheets = await getSheetsClient();
        const meta = await sheets.spreadsheets.get({ spreadsheetId });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, title: meta.data.properties.title }));
      } catch (err) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: err.message }));
      }
      return;
    }
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

// --- Async startup ---

async function start() {
  // Load groups from config sheet or fall back to env var
  if (CONFIG_SHEET_ID) {
    try {
      GROUPS = await loadGroupsFromConfigSheet();
      console.log("Loaded groups from config sheet:", Object.keys(GROUPS).join(", ") || "(none)");
    } catch (err) {
      console.error("Failed to load config sheet, falling back to GROUPS env var:", err.message);
      GROUPS = process.env.GROUPS ? JSON.parse(process.env.GROUPS) : {};
    }
  } else {
    GROUPS = process.env.GROUPS
      ? JSON.parse(process.env.GROUPS)
      : { "Gruppe 1": "1Q9Lf0E6mYRu6B710aRgIjJW0tlS87R2RUK4lJ3ULCwk" };
    console.log("No CONFIG_SHEET_ID set, using GROUPS env var");
  }

  server.listen(PORT, () => {
    console.log("Server running on http://localhost:" + PORT);
    console.log("Groups:", Object.keys(GROUPS).join(", ") || "(none)");
    if (ADMIN_PASSWORD) console.log("Admin panel: http://localhost:" + PORT + "/admin");
    else console.log("Warning: ADMIN_PASSWORD not set, admin panel disabled");
  });
}

start();
