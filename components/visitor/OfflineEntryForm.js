"use client";
// components/visitor/OfflineEntryForm.js
// "Offline person entry": the guard logs someone who is ALREADY being let in.
// Works with zero network — photo is captured + compressed locally, the entry is
// queued on the device, and it auto-sends when connectivity returns.
import { useEffect, useRef, useState } from "react";
import {
  queueEntry,
  syncOutbox,
  searchCachedFlats,
  cacheFlats,
  fileToCompressedDataUrl,
  isOnline,
} from "@/lib/visitor-outbox";
const PURPOSES = ["Guest", "Delivery", "Domestic Help", "Vendor", "Cab", "Other"];
const S = {
  field: { marginBottom: 12 },
  label: { display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--fg-3)", marginBottom: 5 },
  input: { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border-strong)", fontSize: 14, boxSizing: "border-box" },
  area: { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border-strong)", fontSize: 14, boxSizing: "border-box", minHeight: 64, resize: "vertical" },
  row: { display: "flex", gap: 10 },
  half: { flex: 1 },
  results: { border: "1px solid var(--border)", borderRadius: 8, marginTop: 6, maxHeight: 170, overflowY: "auto" },
  resultRow: { padding: "9px 12px", cursor: "pointer", fontSize: 13.5, borderBottom: "1px solid var(--bg-muted)" },
  picked: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "var(--success-bg)", border: "1px solid var(--success)", borderRadius: 8, fontSize: 13.5 },
  link: { color: "var(--primary-hover)", cursor: "pointer", fontSize: 12.5, fontWeight: 600 },
  photoRow: { display: "flex", alignItems: "center", gap: 12 },
  photoBtn: { padding: "10px 14px", borderRadius: 8, border: "1px dashed var(--fg-5)", background: "var(--bg-sunken)", cursor: "pointer", fontSize: 13, fontWeight: 600 },
  preview: { width: 64, height: 64, borderRadius: 8, objectFit: "cover", border: "1px solid var(--border)" },
  hidden: { display: "none" },
  err: { color: "var(--danger-fg)", fontSize: 12.5, marginTop: 8 },
  actions: { display: "flex", gap: 10, marginTop: 16 },
  submit: { flex: 1, padding: "12px", borderRadius: 10, border: "none", background: "var(--danger)", color: "var(--on-solid)", fontSize: 15, fontWeight: 700, cursor: "pointer" },
  cancel: { padding: "12px 16px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--bg-surface)", color: "var(--fg-3)", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  hint: { fontSize: 12, color: "var(--fg-4)", marginTop: 6, lineHeight: 1.4 },
};
function flatName(f) {
  const fl = (f.wing ? f.wing + "-" : "") + (f.flatNo || "");
  return f.ownerName ? fl + " · " + f.ownerName : fl;
}
export default function OfflineEntryForm({ onDone }) {
  const [flatQuery, setFlatQuery] = useState("");
  const [flatResults, setFlatResults] = useState([]);
  const [flat, setFlat] = useState(null);
  const [manual, setManual] = useState(false);
  const [wing, setWing] = useState("");
  const [flatNo, setFlatNo] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [purpose, setPurpose] = useState("Guest");
  const [note, setNote] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const fileRef = useRef(null);
  useEffect(() => {
    setOnline(isOnline());
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  // Flat search: cache-first so it works offline, refreshed from the API online.
  useEffect(() => {
    let active = true;
    const run = async () => {
      const q = flatQuery.trim();
      if (!q) {
        setFlatResults([]);
        return;
      }
      let results = searchCachedFlats(q);
      if (isOnline()) {
        try {
          const res = await fetch(
            "/api/security/flats/search?q=" + encodeURIComponent(q),
            { credentials: "include" },
          );
          const data = await res.json();
          if (data && data.flats) {
            cacheFlats(data.flats);
            results = data.flats;
          }
        } catch (e) {}
      }
      if (active) setFlatResults(results);
    };
    const t = setTimeout(run, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [flatQuery]);
  const pick = (f) => {
    setFlat(f);
    setFlatQuery("");
    setFlatResults([]);
  };
  const pickPhoto = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      setPhotoDataUrl(await fileToCompressedDataUrl(file));
    } catch (err) {
      setMsg(err.message || "Could not read photo");
    }
  };
  const submit = async () => {
    setMsg("");
    const hasFlat = flat || (manual && flatNo.trim());
    if (!name.trim() || !hasFlat) {
      setMsg("Please enter the visitor name and choose the flat.");
      return;
    }
    setBusy(true);
    try {
      queueEntry({
        name: name.trim(),
        phone: phone.trim(),
        purpose,
        note: note.trim(),
        memberId: flat ? flat._id || flat.id : "",
        flatNo: flat ? flat.flatNo : flatNo.trim(),
        wing: flat ? flat.wing || "" : wing.trim(),
        photoDataUrl,
      });
      let outcome = "queued";
      if (isOnline()) {
        const r = await syncOutbox();
        if (r.synced > 0) outcome = "sent";
      }
      if (onDone) onDone(outcome);
    } catch (e) {
      setMsg(e.message || "Could not save the entry");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div style={S.field}>
        <label style={S.label}>Flat / resident *</label>
        {flat ? (
          <div style={S.picked}>
            <span>{flatName(flat)}</span>
            <span style={S.link} onClick={() => setFlat(null)}>
              Change
            </span>
          </div>
        ) : manual ? (
          <div>
            <div style={S.row}>
              <input
                style={Object.assign({}, S.input, S.half)}
                placeholder="Wing (e.g. A)"
                value={wing}
                onChange={(e) => setWing(e.target.value)}
              />
              <input
                style={Object.assign({}, S.input, S.half)}
                placeholder="Flat No (e.g. 101)"
                value={flatNo}
                onChange={(e) => setFlatNo(e.target.value)}
              />
            </div>
            <div style={S.hint}>
              Offline mode: just type the flat — we’ll match it automatically once
              you’re back online.{" "}
              <span style={S.link} onClick={() => setManual(false)}>
                Search instead
              </span>
            </div>
          </div>
        ) : (
          <div>
            <input
              style={S.input}
              placeholder="Search flat, wing or resident name"
              value={flatQuery}
              onChange={(e) => setFlatQuery(e.target.value)}
            />
            {flatResults.length > 0 ? (
              <div style={S.results}>
                {flatResults.map((f) => (
                  <div
                    key={f._id || f.id}
                    style={S.resultRow}
                    onClick={() => pick(f)}
                  >
                    {flatName(f)}
                  </div>
                ))}
              </div>
            ) : null}
            <div style={S.hint}>
              Can’t find it / offline?{" "}
              <span style={S.link} onClick={() => setManual(true)}>
                Type the flat manually
              </span>
            </div>
          </div>
        )}
      </div>
      <div style={S.field}>
        <label style={S.label}>Visitor name *</label>
        <input
          style={S.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Who is entering?"
        />
      </div>
      <div style={S.row}>
        <div style={Object.assign({}, S.field, S.half)}>
          <label style={S.label}>Phone</label>
          <input
            style={S.input}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div style={Object.assign({}, S.field, S.half)}>
          <label style={S.label}>Purpose *</label>
          <select
            style={S.input}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          >
            {PURPOSES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div style={S.field}>
        <label style={S.label}>Note (what did they say / who are they here for?)</label>
        <textarea
          style={S.area}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Says he is here to meet Mr. Sharma — delivery"
        />
      </div>
      <div style={S.field}>
        <label style={S.label}>Photo</label>
        <div style={S.photoRow}>
          {photoDataUrl ? <img src={photoDataUrl} alt="" style={S.preview} /> : null}
          <button
            type="button"
            style={S.photoBtn}
            onClick={() => fileRef.current && fileRef.current.click()}
          >
            {photoDataUrl ? "Retake photo" : "\uD83D\uDCF7 Capture photo"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={S.hidden}
            onChange={pickPhoto}
          />
        </div>
      </div>
      {msg ? <div style={S.err}>{msg}</div> : null}
      <div style={S.actions}>
        <button style={S.submit} onClick={submit} disabled={busy}>
          {busy
            ? "Saving\u2026"
            : online
              ? "Log entry & notify resident"
              : "\uD83D\uDCBE Save offline — will notify when online"}
        </button>
        {onDone ? (
          <button style={S.cancel} onClick={() => onDone(null)} disabled={busy}>
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}
