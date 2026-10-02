// Batch numbers are always a 10-digit text code (e.g. "0000000009"). Google
// Sheets' numeric read (or a plain paste) can turn a cell like that into the
// JS number 9, silently dropping the leading zeros — this pads it back out
// so every Batch the app touches is a consistent 10-digit string, however
// it was actually typed or stored. Same helper as the original stock-count
// app's lib/binMasterConvert.js, carried over verbatim since the WMS batch
// format hasn't changed.
export function padBatch(value) {
  if (value === null || value === undefined || value === "") return "";
  const s = String(value).trim();
  return /^\d+$/.test(s) ? s.padStart(10, "0") : s;
}
