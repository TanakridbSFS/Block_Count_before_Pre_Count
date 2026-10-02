import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";

// Entry point. No counter name / login step this time — every device lands
// straight on the Bin scan field (per spec: multiple PDAs, no CounterName).
export default function ScanPage() {
  const router = useRouter();
  const [binInput, setBinInput] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    // Keep focus on the scan field so the PDA's built-in scanner
    // (keyboard-wedge mode) can type into it.
    inputRef.current?.focus();
  });

  function handleKeyDown(e) {
    if (e.key === "Enter") {
      submitBin();
    }
  }

  function submitBin() {
    const bin = binInput.trim();
    if (!bin) return;
    router.push(`/count/${encodeURIComponent(bin)}`);
  }

  return (
    <div className="page">
      <div className="title">Block Count — Scan Bin</div>

      <div className="field">
        <label>Bin Location</label>
        <input
          ref={inputRef}
          value={binInput}
          onChange={(e) => setBinInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => inputRef.current?.focus()}
          placeholder="Scan or type Bin code, then Enter"
          autoFocus
        />
      </div>

      <button className="btn btn-primary" onClick={submitBin}>
        Go
      </button>
    </div>
  );
}
