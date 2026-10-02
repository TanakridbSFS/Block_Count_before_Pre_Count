import { replaceBinRecords } from "../../lib/googleSheets";
import { padBatch } from "../../lib/batch";
import { nowThailandISOString } from "../../lib/time";

// POST /api/count
// body: {
//   bin: "A01-01-01",
//   expectedSnapshot: "...",        // from the last GET /api/bin/:bin this device saw
//   lines: [{ mat, batch, uom, materialName, categoryCode, categoryName, countedQty }]
// }
//
// Deletes every existing CountRecord row for `bin` and writes `lines` in
// its place — this Bin's count is always the full, current list, never an
// append-only log. If another device already saved this Bin since
// `expectedSnapshot` was fetched, nothing is written: the response comes
// back with conflict:true and the newer data instead, so the client can
// show it and make the user reload before retrying.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { bin, lines, expectedSnapshot } = req.body || {};

  if (!bin || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: "Missing bin or lines" });
  }

  for (const line of lines) {
    if (!line.mat || line.countedQty === undefined || line.countedQty === null || line.countedQty === "") {
      return res.status(400).json({ error: "Every line needs at least mat and countedQty" });
    }
  }

  const timestamp = nowThailandISOString();
  const records = lines.map((line) => ({
    Timestamp: timestamp,
    Bin_Location: bin,
    Material_Code: line.mat,
    Material_Name: line.materialName || "",
    Category_Code: line.categoryCode || "",
    Category_Name: line.categoryName || "",
    Batch: padBatch(line.batch),
    UOM: line.uom || "",
    CountedQty: line.countedQty,
  }));

  try {
    const result = await replaceBinRecords(bin, records, expectedSnapshot);
    if (result.conflict) {
      return res.status(409).json({
        conflict: true,
        message: "This Bin was already saved by another device after you last opened it.",
        currentRecords: result.currentRecords,
      });
    }
    res.status(200).json({ ok: true, written: records.length, records: result.records });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}
