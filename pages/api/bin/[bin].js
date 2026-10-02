import { getBinRecords } from "../../../lib/googleSheets";

// GET /api/bin/:bin
// Returns the records currently saved for this Bin, plus a `snapshot`
// string. Hold onto `snapshot` and send it back unchanged with the save
// request (POST /api/count) — it's how the server detects that another
// device already saved this Bin while you were counting it.
//
// Also used for the open-screen polling that shows another device's save
// without reloading the page (see pages/count/[bin].js).
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { bin } = req.query;
  if (!bin) {
    return res.status(400).json({ error: "Missing bin" });
  }

  try {
    const { records, snapshot } = await getBinRecords(bin);
    res.status(200).json({ bin, records, snapshot });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}
