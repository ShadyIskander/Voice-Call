"use client";
import { useRef, useState } from "react";

// Google Calendar event colors. "" = default (the calendar's own color).
const COLORS = [
  { id: "", name: "Default (calendar color)" },
  { id: "1", name: "Lavender" },
  { id: "2", name: "Sage" },
  { id: "3", name: "Grape" },
  { id: "4", name: "Flamingo" },
  { id: "5", name: "Banana" },
  { id: "6", name: "Tangerine" },
  { id: "7", name: "Peacock" },
  { id: "8", name: "Graphite" },
  { id: "9", name: "Blueberry" },
  { id: "10", name: "Basil" },
  { id: "11", name: "Tomato" },
];

export default function Recorder() {
  const [text, setText] = useState("");
  const [colorId, setColorId] = useState("");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const rec = useRef(null);

  function toggleMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setError("Voice isn't supported here. Tap the mic on your keyboard instead.");
      return;
    }
    if (listening) { rec.current?.stop(); return; }
    const r = new SR();
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    r.onresult = (e) => setText(Array.from(e.results).map((x) => x[0].transcript).join(" "));
    r.onend = () => setListening(false);
    r.onerror = () => { setListening(false); setError("Mic didn't work. Use your keyboard's mic instead."); };
    rec.current = r;
    setError(""); setResult(null);
    r.start();
    setListening(true);
  }

  async function add() {
    setBusy(true); setError(""); setResult(null);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const now = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())} (${d.toLocaleDateString("en-US", { weekday: "long" })})`;
    try {
      const res = await fetch("/api/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, tz, now, colorId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      setResult(data);
      setText("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const fmt = (s) => new Date(s).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <section>
      <button className={"mic" + (listening ? " on" : "")} onClick={toggleMic} aria-label={listening ? "Stop recording" : "Start recording"}>
        {listening ? "Stop" : "Speak"}
      </button>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. Dentist appointment next Tuesday at 3pm"
        rows={3}
        maxLength={500}
      />
      <select value={colorId} onChange={(e) => setColorId(e.target.value)} aria-label="Event color">
        {COLORS.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <button className="primary" onClick={add} disabled={busy || !text.trim()}>
        {busy ? "Adding…" : "Add to calendar"}
      </button>
      {error && <p className="err">{error}</p>}
      {result && (
        <p className="ok">
          Added: <strong>{result.title}</strong>, {fmt(result.start)}.{" "}
          <a href={result.link} target="_blank" rel="noreferrer">Open in Google Calendar</a>
        </p>
      )}
    </section>
  );
}
