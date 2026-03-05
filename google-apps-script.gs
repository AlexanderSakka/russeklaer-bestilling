// =============================================================
// Google Apps Script — paste this into Extensions > Apps Script
// =============================================================
// Each group gets its own tab/sheet. The form sends ?gruppe=X
// and the script writes to that tab (creates it if missing).
// =============================================================

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var data = JSON.parse(e.postData.contents);
    var gruppe = data.gruppe || "Ukjent";
    var name = data.fullName;
    var timestamp = new Date();

    // Get or create the sheet/tab for this group
    var sheet = ss.getSheetByName(gruppe);
    if (!sheet) {
      sheet = ss.insertSheet(gruppe);
      sheet.appendRow(["Timestamp", "Fullt navn", "Produkt", "Farge", "Størrelse", "Etternavn"]);
    }

    data.orders.forEach(function (order) {
      sheet.appendRow([
        timestamp,
        name,
        order.product,
        order.color,
        order.size,
        order.etternavn || ""
      ]);
    });

    return ContentService
      .createTextOutput(JSON.stringify({ result: "success" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ result: "error", message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return ContentService
    .createTextOutput("Bestillingsskjema backend is running.")
    .setMimeType(ContentService.MimeType.TEXT);
}
