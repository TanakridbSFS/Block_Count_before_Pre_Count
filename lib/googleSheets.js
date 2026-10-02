import { google } from "googleapis";

// Single Google Sheet, single tab (RECORD_TAB, default "CountRecord").
// There is no Master Ref sheet in this app — every line is user-keyed, and
// Material/Category/UOM come from the bundled materialMaster.json instead
// (see lib/materialLookup.js).
//
// Header row, columns A-I:
// Timestamp | Bin_Location | Material_Code | Material_Name | Category_Code
// | Category_Name | Batch | UOM | CountedQty
export const HEADER = [
  "Timestamp",
  "Bin_Location",
  "Material_Code",
  "Material_Name",
  "Category_Code",
  "Category_Name",
  "Batch",
  "UOM",
  "CountedQty",
];

const RECORD_SHEET_ID = process.env.RECORD_SHEET_ID;
const RECORD_TAB = process.env.RECORD_TAB || "CountRecord";

let sheetsClientPromise = null;
function getSheetsClient() {
  if (!sheetsClientPromise) {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        // Stored in env with literal \n sequences — convert back to real
        // newlines at runtime (see .env.example).
        private_key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    sheetsClientPromise = auth.getClient().then((authClient) => google.sheets({ version: "v4", auth: authClient }));
  }
  return sheetsClientPromise;
}

let cachedSheetId = null;
async function getTabSheetId() {
  if (cachedSheetId !== null) return cachedSheetId;
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: RECORD_SHEET_ID });
  const tab = meta.data.sheets.find((s) => s.properties.title === RECORD_TAB);
  if (!tab) {
    throw new Error(`Tab "${RECORD_TAB}" not found in the spreadsheet — check RECORD_TAB in your env.`);
  }
  cachedSheetId = tab.properties.sheetId;
  return cachedSheetId;
}

function rowToRecord(row) {
  return {
    Timestamp: row[0] || "",
    Bin_Location: row[1] || "",
    Material_Code: row[2] || "",
    Material_Name: row[3] || "",
    Category_Code: row[4] || "",
    Category_Name: row[5] || "",
    Batch: row[6] || "",
    UOM: row[7] || "",
    CountedQty: row[8] ?? "",
  };
}

function recordToRow(rec) {
  return [
    rec.Timestamp,
    rec.Bin_Location,
    rec.Material_Code,
    rec.Material_Name,
    rec.Category_Code,
    rec.Category_Name,
    rec.Batch,
    rec.UOM,
    rec.CountedQty,
  ];
}

// Always a fresh read — never cached — since this underlies both the
// polling endpoint and the save-time conflict check, and both need the
// true current state of the sheet.
async function readAllRows() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: RECORD_SHEET_ID,
    range: `${RECORD_TAB}!A2:I`,
  });
  const values = res.data.values || [];
  // sheetRowNumber is 1-indexed as Sheets sees it (row 1 is the header).
  return values.map((row, i) => ({ sheetRowNumber: i + 2, record: rowToRecord(row) }));
}

// Returns the records currently saved for one Bin, plus a snapshot string
// a client can hold onto and send back later to prove "nothing changed
// since I loaded this" (see replaceBinRecords).
export async function getBinRecords(bin) {
  const all = await readAllRows();
  const matches = all.filter((r) => r.record.Bin_Location === bin);
  const records = matches.map((r) => r.record);
  return { records, snapshot: JSON.stringify(records) };
}

// Deletes every existing row for `bin` and appends `newRecords` in its
// place — a real overwrite, not a soft/append-only log, per spec.
//
// Concurrency: `expectedSnapshot` must be the snapshot string the caller
// got from getBinRecords() when it first opened this bin. Right before
// touching the sheet, this re-reads the bin's current rows fresh and
// compares — if another device already saved this bin in the meantime,
// the snapshots won't match and this returns {conflict:true} without
// writing anything, handing back the newer data so the caller can show it.
// First save to reach this check wins; everyone else must reload and redo.
//
// This re-read-then-write is as tight as the Sheets API reasonably allows,
// but it is not a true database transaction — two saves landing within the
// same instant (not just "a few seconds apart") could still race. See the
// README's "Known limitations" section.
export async function replaceBinRecords(bin, newRecords, expectedSnapshot) {
  const all = await readAllRows();
  const currentForBin = all.filter((r) => r.record.Bin_Location === bin);
  const currentSnapshot = JSON.stringify(currentForBin.map((r) => r.record));

  if (expectedSnapshot !== undefined && expectedSnapshot !== currentSnapshot) {
    return { conflict: true, currentRecords: currentForBin.map((r) => r.record) };
  }

  const sheets = await getSheetsClient();

  if (currentForBin.length > 0) {
    const sheetId = await getTabSheetId();
    // Highest row number first — deleting a lower row later doesn't shift
    // the indices of rows above it that we've already deleted.
    const rowNumbersDesc = currentForBin.map((r) => r.sheetRowNumber).sort((a, b) => b - a);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: RECORD_SHEET_ID,
      requestBody: {
        requests: rowNumbersDesc.map((rowNumber) => ({
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: rowNumber - 1, // 0-indexed
              endIndex: rowNumber,
            },
          },
        })),
      },
    });
  }

  if (newRecords.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: RECORD_SHEET_ID,
      range: `${RECORD_TAB}!A:I`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: newRecords.map(recordToRow) },
    });
  }

  return { conflict: false, records: newRecords };
}
