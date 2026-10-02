import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { lookupMaterial } from "../../lib/materialLookup";
import { UOM_OPTIONS } from "../../lib/uomOptions";

// How often this screen checks whether another device has already saved
// this Bin — kept out of the hot typing path on purpose (see the polling
// effect below): it only ever updates the screen quietly, never interrupts
// a line being entered.
const POLL_INTERVAL_MS = 6000;

let lineIdCounter = 0;
function nextLineId() {
  lineIdCounter += 1;
  return `l${Date.now()}_${lineIdCounter}`;
}

function recordsToDraftLines(records) {
  return records.map((r) => ({
    id: nextLineId(),
    mat: r.Material_Code,
    materialName: r.Material_Name,
    categoryCode: r.Category_Code,
    categoryName: r.Category_Name,
    batch: r.Batch,
    uom: r.UOM,
    qty: r.CountedQty,
  }));
}

// Pure lookup — no state writes — so it's safe to call from inside a
// barcode-scan handler and use the result immediately in the same tick
// (relying on React state instead would be stale: setState doesn't apply
// until the next render, but a combined SKU|Batch|Qty scan needs to add
// the line to the list right away, in the same keystroke handler).
function resolveMaterial(code) {
  const hit = lookupMaterial(code);
  if (hit) {
    return { matKnown: true, materialName: hit.name, categoryCode: hit.categoryCode, categoryName: hit.categoryName, uom: hit.uom };
  }
  return { matKnown: false, materialName: "", categoryCode: "", categoryName: "", uom: "" };
}

export default function CountBinPage() {
  const router = useRouter();
  const { bin } = router.query;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [baselineSnapshot, setBaselineSnapshot] = useState(undefined);
  const [hadExisting, setHadExisting] = useState(false);
  const [lines, setLines] = useState([]);
  const [dirty, setDirty] = useState(false);

  const [matInput, setMatInput] = useState("");
  const [batchInput, setBatchInput] = useState("");
  const [qtyInput, setQtyInput] = useState("");
  const [uomInput, setUomInput] = useState("");
  const [uomOverride, setUomOverride] = useState(false);
  const [materialNameInput, setMaterialNameInput] = useState("");
  const [categoryCodeInput, setCategoryCodeInput] = useState("");
  const [categoryNameInput, setCategoryNameInput] = useState("");
  const [matKnown, setMatKnown] = useState(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [conflict, setConflict] = useState(null);
  const [remoteUpdateBanner, setRemoteUpdateBanner] = useState(false);
  const [savedBanner, setSavedBanner] = useState(false);

  const matRef = useRef(null);
  const batchRef = useRef(null);
  const qtyRef = useRef(null);

  const loadBin = useCallback(async () => {
    if (!bin) return;
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(`/api/bin/${encodeURIComponent(bin)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load data");
      setBaselineSnapshot(json.snapshot);
      setHadExisting(json.records.length > 0);
      setLines(recordsToDraftLines(json.records));
      setDirty(false);
      setRemoteUpdateBanner(false);
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }, [bin]);

  useEffect(() => {
    loadBin();
  }, [loadBin]);

  // Live cross-device visibility: while this screen is open, quietly check
  // whether someone else already saved this Bin. If this device hasn't
  // started editing yet, just refresh in place. If it has, don't touch the
  // draft — show a banner instead, and let Confirm & Save's own conflict
  // check be the thing that actually blocks an overwrite.
  useEffect(() => {
    if (!bin || loading) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/bin/${encodeURIComponent(bin)}`);
        if (!res.ok) return;
        const json = await res.json();
        if (json.snapshot === baselineSnapshot) return;
        if (!dirty) {
          setBaselineSnapshot(json.snapshot);
          setHadExisting(json.records.length > 0);
          setLines(recordsToDraftLines(json.records));
        } else {
          setRemoteUpdateBanner(true);
        }
      } catch {
        // best-effort — ignore transient network errors
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [bin, baselineSnapshot, dirty, loading]);

  useEffect(() => {
    if (!loading) matRef.current?.focus();
  }, [loading]);

  function markDirty() {
    if (!dirty) setDirty(true);
  }

  function resetNewLineForm() {
    setMatInput("");
    setBatchInput("");
    setQtyInput("");
    setUomInput("");
    setUomOverride(false);
    setMaterialNameInput("");
    setCategoryCodeInput("");
    setCategoryNameInput("");
    setMatKnown(null);
  }

  function applyMatLookup(code) {
    const resolved = resolveMaterial(code);
    setMatKnown(resolved.matKnown);
    setMaterialNameInput(resolved.materialName);
    setCategoryCodeInput(resolved.categoryCode);
    setCategoryNameInput(resolved.categoryName);
    if (!uomOverride) setUomInput(resolved.uom);
    return resolved;
  }

  // Adds a line. Pass explicit fields when they were just resolved inside
  // this same tick (barcode path); omit them to fall back to whatever is
  // currently in the form state (manual-entry path, where state is already
  // settled from a previous render).
  function addLineFromForm(fields) {
    const mat = (fields?.mat ?? matInput).trim();
    const batch = (fields?.batch ?? batchInput).trim();
    const qty = String(fields?.qty ?? qtyInput).trim();
    if (!mat || qty === "") return false;
    const uom = fields?.uom ?? uomInput;
    const materialName = fields?.materialName ?? materialNameInput;
    const categoryCode = fields?.categoryCode ?? categoryCodeInput;
    const categoryName = fields?.categoryName ?? categoryNameInput;
    setLines((prev) => [...prev, { id: nextLineId(), mat, batch, qty, uom, materialName, categoryCode, categoryName }]);
    markDirty();
    resetNewLineForm();
    return true;
  }

  // "SKU|Batch" or "SKU|Batch|Qty" from one scan. A plain scan with no "|"
  // just fills whichever field it landed in — not a combined barcode.
  function handleDelimitedScan(raw) {
    const parts = raw.split("|");
    if (parts.length === 1) return false;
    const [matPart, batchPart, qtyPart] = parts;
    const mat = (matPart || "").trim();
    const batch = (batchPart || "").trim();
    const qty = (qtyPart || "").trim();

    const resolved = applyMatLookup(mat);
    setMatInput(mat);
    setBatchInput(batch);
    markDirty();

    if (qty !== "") {
      addLineFromForm({ mat, batch, qty, uom: resolved.uom, materialName: resolved.materialName, categoryCode: resolved.categoryCode, categoryName: resolved.categoryName });
      matRef.current?.focus();
    } else {
      setQtyInput("");
      qtyRef.current?.focus();
    }
    return true;
  }

  function handleMatKeyDown(e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const raw = matInput.trim();
    if (!raw) return;
    if (handleDelimitedScan(raw)) return;
    applyMatLookup(raw);
    markDirty();
    batchRef.current?.focus();
  }

  function handleBatchKeyDown(e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const raw = batchInput.trim();
    if (raw && handleDelimitedScan(raw)) return;
    markDirty();
    qtyRef.current?.focus();
  }

  function handleQtyKeyDown(e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (addLineFromForm()) matRef.current?.focus();
  }

  function removeLine(id) {
    setLines((prev) => prev.filter((l) => l.id !== id));
    markDirty();
  }

  // Pulls a saved line back out of the list and into the New Line form so
  // it can be changed, then re-added — editing is just "take it out, let
  // the normal add-a-line flow put it back in."
  function startEditLine(line) {
    const resolved = resolveMaterial(line.mat);
    setMatInput(line.mat);
    setBatchInput(line.batch || "");
    setQtyInput(String(line.qty ?? ""));
    setMaterialNameInput(line.materialName || "");
    setCategoryCodeInput(line.categoryCode || "");
    setCategoryNameInput(line.categoryName || "");
    setUomInput(line.uom || "");
    if (resolved.matKnown) {
      setMatKnown(true);
      // If the saved UOM doesn't match what the master would auto-fill,
      // it must have been manually overridden before — keep it editable
      // as an override rather than silently snapping back to the master.
      setUomOverride(line.uom !== resolved.uom);
    } else {
      setMatKnown(false);
      setUomOverride(true);
    }
    setLines((prev) => prev.filter((l) => l.id !== line.id));
    markDirty();
    matRef.current?.focus();
  }

  async function handleConfirmSave() {
    if (lines.length === 0) {
      setSaveError("No lines to save yet");
      return;
    }
    setSaving(true);
    setSaveError("");
    setConflict(null);
    try {
      const res = await fetch("/api/count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bin,
          expectedSnapshot: baselineSnapshot,
          lines: lines.map((l) => ({
            mat: l.mat,
            batch: l.batch,
            uom: l.uom,
            materialName: l.materialName,
            categoryCode: l.categoryCode,
            categoryName: l.categoryName,
            countedQty: l.qty,
          })),
        }),
      });
      const json = await res.json();
      if (res.status === 409) {
        setConflict(json);
        return;
      }
      if (!res.ok) throw new Error(json.error || "Save failed");
      setSavedBanner(true);
      setTimeout(() => router.push("/"), 900);
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function reloadAfterConflict() {
    setConflict(null);
    setRemoteUpdateBanner(false);
    setDirty(false);
    loadBin();
  }

  if (!bin) return null;

  return (
    <div className="page">
      <Link href="/" className="back-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back to Scan
      </Link>

      <div className="title">Bin: {bin}</div>

      {loading && <div className="card">Loading…</div>}
      {loadError && <div className="banner banner-error">{loadError}</div>}

      {!loading && !loadError && (
        <>
          {hadExisting && (
            <div className="banner banner-warn">
              <IconInfo />
              <div className="banner-content">
                This Bin already has a saved count — edit, remove, or add lines as needed. <b>Confirm &amp; Save</b>{" "}
                will overwrite the entire previous count for this Bin with what&apos;s below.
              </div>
            </div>
          )}

          {remoteUpdateBanner && (
            <div className="banner banner-warn">
              <IconInfo />
              <div className="banner-content">
                Another device just saved this Bin. What you&apos;re seeing may be out of date.
                <div>
                  <button className="btn btn-secondary btn-sm" onClick={reloadAfterConflict} style={{ marginTop: 8 }}>
                    Reload Latest
                  </button>
                </div>
              </div>
            </div>
          )}

          {conflict && (
            <div className="banner banner-error">
              <IconWarn />
              <div className="banner-content">
                <div style={{ marginBottom: 6 }}>{conflict.message}</div>
                <div style={{ marginBottom: 8 }}>Nothing was overwritten — reload the latest data, then count or edit again.</div>
                <button className="btn btn-primary btn-sm" onClick={reloadAfterConflict}>
                  Reload Latest
                </button>
              </div>
            </div>
          )}

          {savedBanner && (
            <div className="banner banner-info">
              <IconCheck />
              <div className="banner-content">Saved — returning to Scan…</div>
            </div>
          )}

          {lines.map((line) => (
            <div className="line-row" key={line.id}>
              <div className="line-top">
                <span className="line-mat">
                  {line.mat}
                  {line.batch ? ` / Batch ${line.batch}` : ""}
                </span>
                <span style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => startEditLine(line)}>
                    Edit
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => removeLine(line.id)}>
                    Remove
                  </button>
                </span>
              </div>
              <div className="line-name">{line.materialName || "(Material name not found)"}</div>
              <div className="card-row">
                <span>Category</span>
                <b>
                  {line.categoryCode} {line.categoryName}
                </b>
              </div>
              <div className="card-row">
                <span>UOM</span>
                <b className={line.uom === "KG" ? "uom-kg" : ""}>{line.uom || "-"}</b>
              </div>
              <div className="card-row">
                <span>Counted Qty</span>
                <b>{line.qty}</b>
              </div>
            </div>
          ))}

          <div className="card">
            <div className="card-heading">+ New Line</div>

            <div className="field">
              <label>Material Code</label>
              <input
                ref={matRef}
                value={matInput}
                onChange={(e) => setMatInput(e.target.value)}
                onKeyDown={handleMatKeyDown}
                onBlur={() => {
                  const raw = matInput.trim();
                  if (raw && !handleDelimitedScan(raw)) applyMatLookup(raw);
                }}
                inputMode="numeric"
                placeholder="Scan or key in Material Code"
              />
              {matKnown === false && matInput.trim() && (
                <div className="hint">Material not found in Master — you can enter name/UOM manually</div>
              )}
            </div>

            {matKnown === false && (
              <div className="field">
                <label>Material Name (not in Master — enter manually)</label>
                <input value={materialNameInput} onChange={(e) => setMaterialNameInput(e.target.value)} />
              </div>
            )}

            <div className="field">
              <label>Batch</label>
              <input
                ref={batchRef}
                value={batchInput}
                onChange={(e) => setBatchInput(e.target.value)}
                onKeyDown={handleBatchKeyDown}
                inputMode="numeric"
                placeholder="Scan or key in Batch (if any)"
              />
            </div>

            <div className="field">
              <label>
                UOM{" "}
                {!uomOverride && matKnown && (
                  <button type="button" className="btn btn-secondary btn-sm" style={{ marginLeft: 6 }} onClick={() => setUomOverride(true)}>
                    Override
                  </button>
                )}
              </label>
              {uomOverride || matKnown === false ? (
                <select value={uomInput} onChange={(e) => setUomInput(e.target.value)}>
                  <option value="">— Select UOM —</option>
                  {UOM_OPTIONS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              ) : (
                <input className={uomInput === "KG" ? "uom-kg" : ""} value={uomInput} readOnly placeholder="Auto-filled from Material Code" />
              )}
            </div>

            <div className="field">
              <label>Counted Qty</label>
              <input
                ref={qtyRef}
                value={qtyInput}
                onChange={(e) => setQtyInput(e.target.value)}
                onKeyDown={handleQtyKeyDown}
                inputMode="numeric"
                placeholder="Type counted quantity, then Enter"
              />
            </div>

            <button
              className="btn btn-secondary"
              onClick={() => {
                if (addLineFromForm()) matRef.current?.focus();
              }}
            >
              + Add Line
            </button>
          </div>

          {saveError && <div className="banner banner-error">{saveError}</div>}
        </>
      )}

      {!loading && !loadError && (
        <div className="action-bar">
          <div className="action-bar-inner">
            <button className="btn btn-primary" disabled={saving || !!conflict} onClick={handleConfirmSave}>
              {saving ? "Saving…" : "Confirm & Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function IconInfo() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01M11 12h1v5h1" />
    </svg>
  );
}

function IconWarn() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 9v4m0 4h.01M10.3 3.9 2.5 18a1 1 0 0 0 .9 1.5h17.2a1 1 0 0 0 .9-1.5L13.7 3.9a1 1 0 0 0-1.7 0Z" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 2.5 2.5L16 9.5" />
    </svg>
  );
}
