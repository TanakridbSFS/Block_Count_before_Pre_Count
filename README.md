# Block Count Record (PDA)

Blind cycle-count web app for Android handheld PDA devices. No master
expected-quantity reference — scan a Bin, key in whatever's physically
there, save. Data lives in one Google Sheet. Several PDAs can count
different (or the same) Bins at once; the app is built around that.

This project is a trimmed-down relative of `stock-count-app` — same
scan-and-key PDA workflow and Google Sheets plumbing, but with the Master
Ref sheet removed entirely and the save behavior changed from
append-only to a per-Bin overwrite. See "Differences from stock-count-app"
at the bottom if you know that project.

## 1. Google Sheet setup

You need **one** sheet this time (no Master Ref):

- **Record File** (`RECORD_SHEET_ID`) — tab `CountRecord`. This is the
  only data store the app touches.

### 1.1 `CountRecord` tab

Rename the tab to `CountRecord` (or set `RECORD_TAB` in your `.env` to
match). Header row, columns A–I:

```
Timestamp | Bin_Location | Material_Code | Material_Name | Category_Code | Category_Name | Batch | UOM | CountedQty
```

Leave the rest empty. Unlike the original stock-count app, this sheet is
**not** append-only: saving a Bin deletes every existing row for that Bin
and writes the new lines in its place (see §4 "How saving works"). There
is no history of earlier counts for a Bin once it's been re-counted —
whatever's in the sheet is always just the latest count.

### 1.2 Google Cloud service account

Same as any Sheets API integration:

1. [console.cloud.google.com](https://console.cloud.google.com/) → create/reuse a project.
2. Enable the **Google Sheets API**.
3. APIs & Services → Credentials → Create Credentials → **Service Account**.
4. Open it → Keys → Add Key → Create new key → JSON. Keep the file private.
5. From that JSON, you need `client_email` and `private_key`.
6. In the Record File sheet, click Share → add that `client_email` as **Editor**.

## 2. Local setup

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local`:
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY` — from the service account JSON
- `RECORD_SHEET_ID` — the Record File's spreadsheet ID (from its URL)
- `RECORD_TAB` — only if your tab isn't named `CountRecord`

```bash
npm run dev
```

Open `http://localhost:3000` on a computer to sanity-check the flow, then
test on an actual PDA before relying on it — the scanner behavior only
shows up there.

## 3. Deploy to Vercel

1. Push to a GitHub repo, import it in Vercel.
2. Settings → Environment Variables — copy in the same variables from
   `.env.local` (paste `GOOGLE_PRIVATE_KEY` exactly as one value, quotes and all).
3. Deploy, open the `*.vercel.app` URL on the PDA, "Add to Home screen".

## 4. How it works

- **Start (`/`)** — no counter name, no login. Every device lands directly
  on the Bin scan field (per your call — no CounterName tracked anywhere
  in this app, see §6).
- **Scan Bin** — same keyboard-wedge field as before: the PDA's scanner
  types the Bin code and sends Enter automatically.
- **Count screen (`/count/[bin]`)** — there is no expected-items list to
  confirm against (no Master Ref anymore). You only ever add lines via
  **+ New Line**:
  - **Material Code** — scan or type. Looked up against
    `lib/materialMaster.json` (bundled in the app, generated from your
    Material Management export — see §4.2) to auto-fill Material Name,
    Category, and UOM, shown read-only with an **Override** button for
    UOM in case it's wrong. A code that isn't in the master file falls
    back to manual entry (Material Name as free text, UOM from a dropdown).
  - **Batch** — scan or type, same as before.
  - A combined barcode `SKU|Batch` or `SKU|Batch|Qty` scanned into either
    the Material Code or Batch field splits and fills every part it
    contains — if it includes a quantity this time, that line is added
    immediately and focus jumps straight back to Material Code for the
    next item, no extra typing needed. A plain scan with no `|` just fills
    whichever field it landed in, same as always. Wherever UOM shows
    `KG` it's highlighted yellow — easiest unit to misread off a scale.
  - **Counted Qty** — typed by hand (unless it came along in a combined
    barcode above). Material Code, Batch, and Counted Qty all bring up a
    numeric-only keypad on the PDA.
  - If the Bin already has a saved count (from this device or another),
    it's loaded onto the screen as editable lines with a banner saying so
    — edit, delete, or add to them freely. Whatever's on screen when you
    hit **Confirm & Save** becomes the Bin's entire count; nothing from
    before is kept alongside it.

### 4.1 Saving, overwriting, and two PDAs hitting the same Bin

Hitting **Confirm & Save**:
1. Deletes every existing `CountRecord` row for that Bin.
2. Writes the lines currently on screen in their place.

If two devices open the *same* Bin and both try to save: whichever save
reaches the server first wins and writes normally. The second save is
**rejected** — the server detects that the Bin changed since this device
loaded it, writes nothing, and shows the newer data with a prompt to
reload and redo the count. No count is ever silently lost by being
overwritten after the fact — the loser has to explicitly reload and
re-save.

While a count screen is open, it also quietly checks (every few seconds)
whether another device has already saved that Bin. If you haven't started
entering anything yet, it just refreshes in place; if you're mid-entry, it
only shows a small banner and leaves your in-progress lines alone — the
save-time check above is what actually protects the data either way.

**Known limitation:** this re-check-then-write happens as two quick steps,
not as one database transaction — if two saves for the *same* Bin land
within the same instant (not just a few seconds apart), there's a narrow
window where both could still pass the check. For how this app is used
(a person tapping Confirm & Save, not an automated burst of requests),
that window is small enough to not worry about in practice, but it's not
a hard guarantee the way a real database transaction would be.

### 4.2 Updating the Material Master list

`lib/materialMaster.json` is a static file in the repo (not read from any
Google Sheet), generated from a Material Management export with 5
columns: `Material code | Material name | Category Code | Category Type |
base unit`. To refresh it:

```bash
python3 tools/convert_material_master.py Material_Management_latest.xlsx
```

Then commit `lib/materialMaster.json` and redeploy. A code missing from
the file just falls back to manual entry in the app, so it's safe if the
list is briefly out of date.

## 5. Report columns

The `CountRecord` sheet *is* the report — export/filter it directly in
Google Sheets (or Google Sheets' own CSV download) whenever you need it:

```
Timestamp | Bin_Location | Material_Code | Material_Name | Category_Code | Category_Name | Batch | UOM | CountedQty
```

## 6. Known simplifications

- No CounterName or DeviceID anywhere — by request, to keep every device's
  entry point identical (straight to Bin scan). This means there's no way
  to tell afterwards which person or PDA counted a given line. If that
  ever matters, it's a small addition (one more column, one more field).
- No admin console / CSV export button in the app itself — the sheet
  itself is the report; this can be added later if useful (e.g. refresh
  status, filtered export) the way the original stock-count-app had one.
- No variance/reconciliation reporting — there's no Master Ref to compare
  against anymore, so this app only ever records what was physically
  found, never "expected vs. counted".
- See §4.1 for the one concurrency edge case that isn't fully closed.

## Differences from `stock-count-app`

- No Master Ref sheet / BinMaster tab at all — no expected-items list, no
  "✓ Correct / ✕ Wrong" buttons, no pagination. Only **+ New Line**.
- Material Name / Category Code / Category Name are new columns, sourced
  from a Material Master JSON file (richer than the old UOM-only lookup).
- Saving **overwrites** a Bin's rows outright instead of only appending —
  rescan the same Bin any time (not just "later today") and the old count
  for it is gone, replaced by what's on screen now.
- No CounterName step or column.
- Combined barcodes can now carry Qty as a third part and skip manual
  entry entirely.
- Manual key-in fields use a numeric keypad (`inputMode="numeric"`).
- Added lightweight cross-device awareness (polling + a save-time
  conflict check) since multiple PDAs are expected to run at once.
