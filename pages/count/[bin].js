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
      if (!res.ok) throw new Error(json.error || "โหลดข้อมูลไม่สำเร็จ");
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

  async function handleConfirmSave() {
    if (lines.length === 0) {
      setSaveError("ยังไม่มีรายการนับให้บันทึก");
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
      if (!res.ok) throw new Error(json.error || "บันทึกไม่สำเร็จ");
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
      <div className="title">Bin: {bin}</div>
      <div className="banner banner-info">
        <Link href="/">← Scan อีกครั้ง / เปลี่ยน Bin</Link>
      </div>

      {loading && <div className="card">กำลังโหลดข้อมูล…</div>}
      {loadError && <div className="banner banner-error">{loadError}</div>}

      {!loading && !loadError && (
        <>
          {hadExisting && (
            <div className="banner banner-warn">
              Bin นี้มีการนับไว้ก่อนแล้ว — แก้ไข/ลบ/เพิ่มรายการได้ตามต้องการ แล้วกด &quot;Confirm &amp; Save&quot;
              การนับเดิมของ Bin นี้ทั้งหมดจะถูกเขียนทับด้วยรายการด้านล่าง
            </div>
          )}

          {remoteUpdateBanner && (
            <div className="banner banner-warn">
              มีการบันทึก Bin นี้จากอีกเครื่องเข้ามาใหม่ ข้อมูลที่เห็นอยู่อาจไม่ใช่ล่าสุด{" "}
              <button className="btn btn-secondary btn-sm" onClick={reloadAfterConflict} style={{ marginTop: 6 }}>
                โหลดข้อมูลล่าสุด
              </button>
            </div>
          )}

          {conflict && (
            <div className="banner banner-error">
              <div style={{ marginBottom: 8 }}>{conflict.message}</div>
              <div style={{ marginBottom: 8 }}>ยังไม่ได้บันทึกอะไรทับ — กดโหลดข้อมูลล่าสุดแล้วนับ/แก้ไขใหม่อีกครั้ง</div>
              <button className="btn btn-primary btn-sm" onClick={reloadAfterConflict}>
                โหลดข้อมูลล่าสุด
              </button>
            </div>
          )}

          {savedBanner && <div className="banner banner-info">บันทึกสำเร็จ — กำลังกลับไปหน้า Scan…</div>}

          {lines.map((line) => (
            <div className="line-row" key={line.id}>
              <div className="line-top">
                <span className="line-mat">
                  {line.mat}
                  {line.batch ? ` / Batch ${line.batch}` : ""}
                </span>
                <button className="btn btn-danger btn-sm" onClick={() => removeLine(line.id)}>
                  ลบ
                </button>
              </div>
              <div className="line-name">{line.materialName || "(ไม่พบชื่อ Material)"}</div>
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
            <div style={{ fontWeight: 700, marginBottom: 10 }}>+ New Line</div>

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
                placeholder="สแกน หรือคีย์ Material Code"
              />
              {matKnown === false && matInput.trim() && (
                <div style={{ fontSize: 12, color: "#8a5300", marginTop: 4 }}>
                  ไม่พบ Material นี้ใน Master — กรอกชื่อ/UOM เองได้
                </div>
              )}
            </div>

            {matKnown === false && (
              <div className="field">
                <label>Material Name (ไม่พบใน Master — กรอกเอง)</label>
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
                placeholder="สแกน หรือคีย์ Batch (ถ้ามี)"
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
                  <option value="">— เลือก UOM —</option>
                  {UOM_OPTIONS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              ) : (
                <input className={uomInput === "KG" ? "uom-kg" : ""} value={uomInput} readOnly placeholder="จะเติมอัตโนมัติจาก Material Code" />
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
                placeholder="พิมพ์จำนวนที่นับได้ แล้ว Enter"
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

          <button className="btn btn-primary" disabled={saving || !!conflict} onClick={handleConfirmSave}>
            {saving ? "กำลังบันทึก…" : "Confirm & Save"}
          </button>
        </>
      )}
    </div>
  );
}
