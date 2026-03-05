const http = require("http");
const { google } = require("googleapis");

const SPREADSHEET_ID = "1Q9Lf0E6mYRu6B710aRgIjJW0tlS87R2RUK4lJ3ULCwk";
const PORT = 3001;

const auth = new google.auth.GoogleAuth({
  keyFile: ".secrets/service-account.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/submit") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const data = JSON.parse(body);
        const gruppe = data.gruppe || "Ukjent";
        const fullName = data.fullName;
        const orders = data.orders;
        const timestamp = new Date().toISOString();

        const client = await auth.getClient();
        const sheets = google.sheets({ version: "v4", auth: client });

        // Check if tab exists, create if not
        const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
        const tabNames = meta.data.sheets.map((s) => s.properties.title);
        if (!tabNames.includes(gruppe)) {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: {
              requests: [{ addSheet: { properties: { title: gruppe } } }],
            },
          });
          await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: gruppe + "!A1:F1",
            valueInputOption: "RAW",
            requestBody: {
              values: [["Timestamp", "Fullt navn", "Produkt", "Farge", "Størrelse", "Etternavn"]],
            },
          });
        }

        // Append rows
        const rows = orders.map((o) => [
          timestamp,
          fullName,
          o.product,
          o.color,
          o.size,
          o.etternavn || "",
        ]);

        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: gruppe + "!A:F",
          valueInputOption: "RAW",
          requestBody: { values: rows },
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ result: "success", rows: rows.length }));
      } catch (err) {
        console.error("Error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ result: "error", message: err.message }));
      }
    });
  } else {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Russeklaer bestilling server is running.");
  }
});

server.listen(PORT, () => {
  console.log("Server running on http://localhost:" + PORT);
});
