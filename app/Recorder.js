"use client";
import { useEffect, useRef, useState } from "react";

// Google Calendar event colors. id "" = default (the calendar's own color).
const COLORS = [
  { id: "", name: "Default (calendar color)", hex: null },
  { id: "1", name: "Lavender", hex: "#a4bdfc" },
  { id: "2", name: "Sage", hex: "#7ae7bf" },
  { id: "3", name: "Grape", hex: "#dbadff" },
  { id: "4", name: "Flamingo", hex: "#ff887c" },
  { id: "5", name: "Banana", hex: "#fbd75b" },
  { id: "6", name: "Tangerine", hex: "#ffb878" },
  { id: "7", name: "Peacock", hex: "#46d6db" },
  { id: "8", name: "Graphite", hex: "#e1e1e1" },
  { id: "9", name: "Blueberry", hex: "#5484ed" },
  { id: "10", name: "Basil", hex: "#51b749" },
  { id: "11", name: "Tomato", hex: "#dc2127" },
];

function Dot({ hex }) {
  return (
    <span
      className={"dot" + (hex ? "" : " dot-default")}
      style={hex ? { background: hex } : undefined}
      aria-hidden="true"
    />
  );
}

function ColorPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef(null);
  const selected = COLORS.find((c) => c.id === value) || COLORS[0];

  // Close when clicking or tapping outside
  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (!wrap.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  function openMenu() {
    setActive(Math.max(0, COLORS.findIndex((c) => c.id === value)));
    setOpen(true);
  }

  function choose(id) {
    onChange(id);
    setOpen(false);
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return openMenu();
      const step = e.key === "ArrowDown" ? 1 : COLORS.length - 1;
      setActive((i) => (i + step) % COLORS.length);
    } else if ((e.key === "Enter" || e.key === " ") && open) {
      e.preventDefault();
      choose(COLORS[active].id);
    }
  }

  return (
    <div className="picker" ref={wrap}>
      <button
        type="button"
        className="picker-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={"Event color: " + selected.name}
        aria-activedescendant={open ? "color-opt-" + (COLORS[active].id || "default") : undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <Dot hex={selected.hex} />
        <span className="picker-label">{selected.name}</span>
        <span className="picker-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul className="picker-menu" role="listbox" aria-label="Event color">
          {COLORS.map((c, i) => (
            <li
              key={c.id || "default"}
              id={"color-opt-" + (c.id || "default")}
              role="option"
              aria-selected={c.id === value}
              className={"picker-opt" + (i === active ? " active" : "") + (c.id === value ? " selected" : "")}
              onClick={() => choose(c.id)}
              onMouseEnter={() => setActive(i)}
            >
              <Dot hex={c.hex} />
              <span>{c.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
      <ColorPicker value={colorId} onChange={setColorId} />
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
