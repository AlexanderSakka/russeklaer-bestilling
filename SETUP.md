# Setup Guide: Russeklaer Bestilling

## Step 1: Create Google Sheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new spreadsheet
2. Name it "Russeklaer Bestillinger"
3. In row 1, add these headers:

| A | B | C | D | E | F |
|---|---|---|---|---|---|
| Timestamp | Fullt navn | Produkt | Farge | Storrelse | Etternavn |

## Step 2: Add the Apps Script

1. In your Google Sheet, go to **Extensions > Apps Script**
2. Delete any existing code in `Code.gs`
3. Copy-paste the entire contents of `google-apps-script.gs` into the editor
4. Click **Save** (Ctrl+S)

## Step 3: Deploy as Web App

1. In Apps Script, click **Deploy > New deployment**
2. Click the gear icon next to "Select type" and choose **Web app**
3. Set these options:
   - Description: "Russeklaer bestilling"
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy**
5. **Authorize** the app when prompted (click through the "unsafe" warning — it's your own script)
6. Copy the **Web app URL** (looks like `https://script.google.com/macros/s/ABC.../exec`)

## Step 4: Connect the form

1. Open `index.html`
2. Find this line near the top of the `<script>` section:
   ```js
   const SCRIPT_URL = "PASTE_YOUR_APPS_SCRIPT_URL_HERE";
   ```
3. Replace `PASTE_YOUR_APPS_SCRIPT_URL_HERE` with the URL you copied in Step 3

## Step 5: Host the form

### Option A: Just open it locally
Double-click `index.html` to open in your browser. Works for testing.

### Option B: Free hosting (recommended)
- **Netlify**: Drag the folder into [app.netlify.com/drop](https://app.netlify.com/drop)
- **GitHub Pages**: Push to a repo, enable Pages in Settings
- **Vercel**: Connect your repo at [vercel.com](https://vercel.com)

## Done!

Each form submission adds rows to your Google Sheet. One row per product ordered.

## Updating products

Edit the `PRODUCTS` object in `index.html` to add/remove products, colors, or sizes:

```js
const PRODUCTS = {
  "Zip Hoodie": { colors: ["Gra", "Navy"], sizes: ["S", "M", "L", "XL"], etternavn: true },
  // ...
};
```

- `etternavn: true` shows the etternavn field for that product
- Adding a new product is just a new line in this object
