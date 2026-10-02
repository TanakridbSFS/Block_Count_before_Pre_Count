import materialMaster from "./materialMaster.json";

// materialMaster.json: { "<8-digit material code>": { name, categoryCode, categoryName, uom } }
// Generated once from the Material Management export (see tools/convert_material_master.py).
// Static, bundled file — not read from any Google Sheet, so looking a code
// up here costs nothing extra at request time.
export function lookupMaterial(code) {
  if (!code) return null;
  const key = String(code).trim();
  const hit = materialMaster[key];
  if (!hit) return null;
  return { code: key, ...hit };
}

export function materialExists(code) {
  if (!code) return false;
  return Object.prototype.hasOwnProperty.call(materialMaster, String(code).trim());
}
