import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";

// Entry point. No counter name / login step — every device lands straight
// on the Bin scan field (multiple PDAs, no CounterName, per spec).
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
      <div className="scan-hero">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7V5a2 2 0 0 1 2-2h2" />
          <path d="M17 3h2a2 2 0 0 1 2 2v2" />
          <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
          <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
          <path d="M7 8h1v8H7z" />
          <path d="M10 8h.5v8H10z" />
          <path d="M12 8h1.5v8H12z" />
          <path d="M15 8h.5v8H15z" />
          <path d="M17 8h.5v8H17z" />
        </svg>
      </div>
      <div className="title" style={{ textAlign: "center" }}>
        Block Count
      </div>
      <div className="subtitle">Scan a Bin to start counting</div>

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
