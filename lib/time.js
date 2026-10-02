// Every timestamp this app writes is Thai local time (UTC+7), not server
// UTC — matches the original stock-count app's lib/time.js so records from
// both tools stay comparable if anyone ever lines them up side by side.
export function nowThailandISOString() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const thaiMs = utcMs + 7 * 60 * 60000;
  const thai = new Date(thaiMs);

  const pad = (n) => String(n).padStart(2, "0");
  const y = thai.getFullYear();
  const m = pad(thai.getMonth() + 1);
  const d = pad(thai.getDate());
  const hh = pad(thai.getHours());
  const mm = pad(thai.getMinutes());
  const ss = pad(thai.getSeconds());

  return `${y}-${m}-${d}T${hh}:${mm}:${ss}+07:00`;
}
