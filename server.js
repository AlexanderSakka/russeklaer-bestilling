const http = require("http");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const PORT = process.env.PORT || 3001;

// Group -> Spreadsheet ID mapping via GROUPS env var
// Format: { "Gruppe 1": "spreadsheet_id_1", "Gruppe 2": "spreadsheet_id_2" }
const GROUPS = process.env.GROUPS
  ? JSON.parse(process.env.GROUPS)
  : { "Gruppe 1": "1Q9Lf0E6mYRu6B710aRgIjJW0tlS87R2RUK4lJ3ULCwk" };

// Auth
let authOptions;
if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  authOptions = { credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets"] };
} else {
  authOptions = { keyFile: ".secrets/service-account.json", scopes: ["https://www.googleapis.com/auth/spreadsheets"] };
}
const auth = new google.auth.GoogleAuth(authOptions);

// Cache the HTML file
const HTML_FILE = fs.readFileSync(path.join(__dirname, "index.html"), "utf-8");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Serve the form
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/bestilling")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML_FILE);
    return;
  }

  // List groups
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
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const data = JSON.parse(body);
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

        const client = await auth.getClient();
        const sheets = google.sheets({ version: "v4", auth: client });

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
            range: "Bestillinger!A1:F1",
            valueInputOption: "RAW",
            requestBody: {
              values: [["Timestamp", "Fullt navn", "Produkt", "Farge", "Størrelse", "Etternavn"]],
            },
          });
        }

        const rows = orders.map((o) => [
          timestamp,
          fullName,
          o.product,
          o.color,
          o.size,
          o.etternavn || "",
        ]);

        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: "Bestillinger!A:F",
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
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log("Server running on http://localhost:" + PORT);
  console.log("Groups:", Object.keys(GROUPS).join(", "));
});
