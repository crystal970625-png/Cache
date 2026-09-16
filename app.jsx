import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  Home, CircleDollarSign, CalendarDays, Droplet, User, Plus, X, Pencil,
  Trash2, Settings, ChevronLeft, ChevronRight, ChevronDown, Upload, Check, GraduationCap,
  MapPin, Newspaper, Utensils, Grid3x3, FileText, Image as ImageIcon, NotebookPen, HelpCircle,
  AlertTriangle, ExternalLink, Clock, ListChecks
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from "recharts";

/* ============================== local storage (IndexedDB) ============================== */
// This build runs standalone (e.g. hosted on GitHub Pages) - no Claude account, no server, so
// everything is saved directly in the browser's own IndexedDB. Unlike Claude's artifact storage
// there's no meaningful per-item size limit here, so a background photo (even several MB of
// base64 text) is written as a single record - no chunking, no rate-limit dance needed.

const DB_NAME = "lifeapp-db";
const STORE_NAME = "kv";
let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error("這個瀏覽器不支援 IndexedDB，資料無法儲存")); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result === undefined ? null : req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbDelete(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Soft sanity cap on the calendar background photo. IndexedDB itself can hold far more than this,
// but a huge base64 string can still be slow to encode and heavy on memory in the browser tab.
const MAX_BG_FILE_BYTES = 25 * 1024 * 1024; // 25MB raw file

/* ============================== helpers ============================== */

const pad2 = (n) => String(n).padStart(2, "0");
const toKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const toMonthKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const WEEKDAY_CN = ["一", "二", "三", "四", "五", "六", "日"];
const WEEKDAY_FULL = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];

function getAcademicYear(date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  if (m >= 8) return { roc: y - 1911, sem: 1 };
  if (m === 1) return { roc: y - 1912, sem: 1 };
  return { roc: y - 1912, sem: 2 };
}
function findSemesterForDate(semesters, date) {
  const key = toKey(date);
  return (semesters || []).find((s) => s.schoolYearStart && s.termEndDate && s.schoolYearStart <= key && key <= s.termEndDate);
}
function semNumOf(sem) { return sem.term === "下學期" ? 2 : 1; }
function chronoSemesters(semesters) {
  return (semesters || [])
    .filter((s) => s.rocYear != null && (s.term === "上學期" || s.term === "下學期"))
    .slice()
    .sort((a, b) => (a.rocYear * 10 + semNumOf(a)) - (b.rocYear * 10 + semNumOf(b)));
}
// calendar-page style: "115學年度第一學期" - pure roc-year arithmetic, unbounded in either direction
function rocTitle(sem) {
  if (!sem || sem.rocYear == null) return "";
  if (sem.term === "暑修" || sem.term === "寒修") return `${sem.rocYear}學年度${sem.term}`;
  return `${sem.rocYear}學年度第${semNumOf(sem) === 1 ? "一" : "二"}學期`;
}
// credit-settings style: "大一上學期" - derived from baseRocYear (which roc year is 大一上);
// falls back to the roc-year format for terms outside the 大一~大六 window
function yearTitle(sem, baseRocYear) {
  if (!sem) return "";
  if (baseRocYear != null && sem.rocYear != null) {
    const idx = sem.rocYear - baseRocYear;
    if (idx >= 0 && idx < YEAR_LABELS.length) return `${YEAR_LABELS[idx]}${sem.term || ""}`;
  }
  if (sem.yearLevel) return `${sem.yearLevel}${sem.term || ""}`;
  return rocTitle(sem);
}
function daysInMonth(y, mIdx0) { return new Date(y, mIdx0 + 1, 0).getDate(); }
function startOfWeekMonday(d) {
  const nd = new Date(d);
  const day = (nd.getDay() + 6) % 7; // Mon=0
  nd.setDate(nd.getDate() - day);
  nd.setHours(0, 0, 0, 0);
  return nd;
}
function addDays(d, n) { const nd = new Date(d); nd.setDate(nd.getDate() + n); return nd; }
function fmtMoney(n) { return "$" + Number(n || 0).toLocaleString(); }
function timeToMinutes(t) { if (!t) return 0; const [h, m] = t.split(":").map(Number); return h * 60 + m; }
function minutesToTime(m) { m = Math.max(0, Math.min(23 * 60 + 59, m)); const h = Math.floor(m / 60); const mm = m % 60; return `${pad2(h)}:${pad2(mm)}`; }
function dateOnlyLess(a, b) { return a < b; }
// shared by HomePage (today's timeline list) and the notification/reminder logic below, so both
// always agree on what "today's schedule" actually contains instead of two separate copies drifting.
function buildTodayTimeline(cal, dateObj) {
  const todayKey = toKey(dateObj);
  const todayWeekday = (dateObj.getDay() + 6) % 7; // 0=Mon
  const todaysSemester = findSemesterForDate(cal.semesters, dateObj);
  const todaysCourses = (todaysSemester && todaysSemester.courses ? todaysSemester.courses : [])
    .filter((c) => c.day === todayWeekday + 1)
    .map((c) => ({ kind: "course", time: c.start, endTime: c.end, title: c.name, sub: `${c.room || ""} ${c.professor || ""}`.trim(), color: c.color }));
  const todaysEvents = (cal.events || [])
    .filter((e) => e.date === todayKey)
    .map((e) => ({ kind: "event", time: e.start || "00:00", endTime: e.end, title: e.title, sub: e.note, color: "#a68bbf" }));
  return [...todaysCourses, ...todaysEvents].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
}
// "站內提醒": 作業截止 / 考試日期落在未來 `days` 天內的項目 - this only ever runs while the app is
// open (no background/push capability here), so it's re-evaluated on a timer against the current
// clock rather than computed once. Deliberately does NOT include calendar events/courses per the
// user's request - only assignments and exams count as "notifications".
function getUpcomingDeadlines(assignments, exams, todos, now, days = 7) {
  const nowMs = now.getTime();
  const endMs = nowMs + days * 24 * 60 * 60 * 1000;
  const items = [];
  (assignments || []).forEach((a) => {
    if (!a.dueDate) return;
    const dueMs = new Date(`${a.dueDate}T${a.dueTime || "23:59"}:00`).getTime();
    if (!isNaN(dueMs) && dueMs >= nowMs && dueMs <= endMs) {
      items.push({ kind: "assignment", id: a.id, title: a.name, course: a.course, date: a.dueDate, time: a.dueTime, sortMs: dueMs });
    }
  });
  (exams || []).forEach((e) => {
    if (!e.date) return;
    const dueMs = new Date(`${e.date}T${e.start || "23:59"}:00`).getTime();
    if (!isNaN(dueMs) && dueMs >= nowMs && dueMs <= endMs) {
      items.push({ kind: "exam", id: e.id, title: e.name, course: e.course, date: e.date, time: e.start, sortMs: dueMs });
    }
  });
  (todos || []).forEach((t) => {
    if (!t.dueDate || t.done) return;
    const dueMs = new Date(`${t.dueDate}T${t.dueTime || "23:59"}:00`).getTime();
    if (!isNaN(dueMs) && dueMs >= nowMs && dueMs <= endMs) {
      items.push({ kind: "todo", id: t.id, title: t.title, course: "", date: t.dueDate, time: t.dueTime, sortMs: dueMs });
    }
  });
  items.sort((a, b) => a.sortMs - b.sortMs);
  return items;
}

const CHART_COLORS = ["#b98787", "#c9a15a", "#8a9a6f", "#7d97ab", "#a68bbf", "#c9896a", "#7fae9b"];
const CAMPUS_CALENDAR_LINK = "http://www.secretariat.fju.edu.tw/uploadFile/uploadFile311.pdf";

function hexToRgba(hex, alpha) {
  if (!hex) return `rgba(169,124,124,${alpha})`;
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
// desaturates a hex color toward gray by `amount` (0-1) - used for the calendar block's own fill,
// so it reads as a pale, low-saturation tint (letting the background show through) while the left
// accent bar stays fully saturated - that gap between the two is what makes the bar pop.
function desaturateHex(hex, amount) {
  if (!hex) return hex;
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  const nr = Math.round(r + (gray - r) * amount);
  const ng = Math.round(g + (gray - g) * amount);
  const nb = Math.round(b + (gray - b) * amount);
  const toHex = (n) => n.toString(16).padStart(2, "0");
  return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`;
}
// lightens a hex color toward white by `amount` (0-1) - used for the calendar block's fill so it
// reads as a bright, pale tint that stands out against a now-darkened background photo, instead of
// just being a diluted (but still mid-tone) version of the course/event color.
function lightenHex(hex, amount) {
  if (!hex) return hex;
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const nr = Math.round(r + (255 - r) * amount);
  const ng = Math.round(g + (255 - g) * amount);
  const nb = Math.round(b + (255 - b) * amount);
  const toHex = (n) => n.toString(16).padStart(2, "0");
  return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`;
}
function blockFont(height) {
  if (height < 16) return { title: 6, sub: 0, lh: 1.05 };
  if (height < 22) return { title: 6.5, sub: 0, lh: 1.05 };
  if (height < 30) return { title: 7, sub: 6, lh: 1.1 };
  if (height < 42) return { title: 7.5, sub: 6.5, lh: 1.15 };
  return { title: 8.5, sub: 7, lh: 1.2 };
}

/* ============================== storage hook ============================== */

const DEFAULT_STATE = {
  profile: {
    nickname: "同學", email: "", enrollYear: "", password: "",
    darkMode: false, notifications: true, fontSize: "medium", fontFamily: "rounded",
  },
  campusFiles: { calendarLink: CAMPUS_CALENDAR_LINK, mapFiles: [] },
  restaurants: [],
  habits: {},
  assignments: [], // 作業: { id, name, course, dueDate, dueTime, note, fileLink }
  exams: [], // 考試: { id, name, course, date, start, end, note }
  todos: [], // 待辦事項: { id, title, subitems: [{id,text,done}], note, done, scheduled, date, start, end, color }
  finance: { holdingAmount: 0, months: {} },
  cal: (() => {
    const ay0 = getAcademicYear(new Date());
    return {
      creditTypes: [], totalCreditsRequired: "",
      attendance: {}, events: [], bgImage: null, bgPosition: { x: 50, y: 50 }, bgScale: 1,
      baseRocYear: ay0.roc, // the ROC academic year of 大一上學期 - used only to derive "大一上" style labels
      semesters: [{
        id: "default-sem", rocYear: ay0.roc, term: ay0.sem === 1 ? "上學期" : "下學期",
        schoolYearStart: "", termEndDate: "", totalWeeks: "", courses: [],
      }],
      activeSemesterId: "default-sem",
    };
  })(),
  period: { ranges: [] },
};

function useAppState() {
  const [state, setState] = useState(DEFAULT_STATE);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [imgSaveError, setImgSaveError] = useState(false);
  const [imgErrorDetail, setImgErrorDetail] = useState("");
  const [storageOk, setStorageOk] = useState(true);
  // remembers exactly what has already been written to storage for the chunked slots, so the
  // app never re-uploads a photo (or map-file set) that hasn't actually changed - set on load,
  // and updated again after every successful save
  const lastPersistedImageRef = useRef(null);
  const lastPersistedMapFilesRef = useRef("[]");
  useEffect(() => {
    if (!window.indexedDB) {
      console.error("IndexedDB is not available in this environment");
      setStorageOk(false);
      setLoaded(true);
      return;
    }
    // fire all three loads (main data, background photo, map files) at the exact same time
    // instead of starting them one after another - they don't depend on each other.
    const mainDataPromise = idbGet("lifeapp-data");
    const bgImagePromise = idbGet("lifeapp-bg-image");
    const mapFilesPromise = idbGet("lifeapp-file-mapFiles");

    (async () => {
      try {
        const res = await mainDataPromise;
        if (res) {
          const parsed = JSON.parse(res);
          setState((s) => {
            const mergedCal = { ...s.cal, ...(parsed.cal || {}) };
            const oldCourses = parsed.cal && Array.isArray(parsed.cal.courses) ? parsed.cal.courses : null;
            const ay0 = getAcademicYear(new Date());
            const rawSemesters = Array.isArray(mergedCal.semesters) && mergedCal.semesters.length ? mergedCal.semesters : [{}];
            if (mergedCal.baseRocYear == null) {
              const first = rawSemesters[0];
              if (first && first.rocYear != null) {
                const idx = Math.max(0, YEAR_LABELS.indexOf(first.yearLevel || first.year || "大一"));
                mergedCal.baseRocYear = first.rocYear - idx;
              } else {
                mergedCal.baseRocYear = ay0.roc;
              }
            }
            // normalize every semester to the current shape (rocYear stored directly), regardless of which
            // older version it was saved under - this guarantees required fields always exist and navigation
            // always works, and yearLevel-only entries get converted to a rocYear using baseRocYear
            mergedCal.semesters = rawSemesters.map((sem, i) => {
              let rocYear = sem.rocYear;
              if (rocYear == null) {
                const yl = sem.yearLevel || sem.year;
                const idx = yl ? YEAR_LABELS.indexOf(yl) : -1;
                rocYear = idx >= 0 ? mergedCal.baseRocYear + idx : (i === 0 ? ay0.roc : mergedCal.baseRocYear);
              }
              return {
                id: sem.id || uid(),
                rocYear,
                yearLevel: sem.yearLevel || sem.year || undefined, // keep the original "大一"-style level so labels don't fall back to the roc-year format after a reload
                term: sem.term || "上學期",
                schoolYearStart: sem.schoolYearStart || (i === 0 && parsed.cal ? parsed.cal.schoolYearStart || "" : ""),
                termEndDate: sem.termEndDate || "",
                totalWeeks: sem.totalWeeks || (i === 0 && parsed.cal ? parsed.cal.totalWeeks || "" : ""),
                courses: Array.isArray(sem.courses) ? sem.courses : (i === 0 && oldCourses ? oldCourses : []),
              };
            });
            if (!mergedCal.activeSemesterId || !mergedCal.semesters.some((s2) => s2.id === mergedCal.activeSemesterId)) {
              mergedCal.activeSemesterId = mergedCal.semesters[0].id;
            }
            delete mergedCal.courses; delete mergedCal.schoolYearStart; delete mergedCal.totalWeeks;
            return {
              ...s,
              ...parsed,
              profile: { ...s.profile, ...(parsed.profile || {}) },
              campusFiles: { ...s.campusFiles, ...(parsed.campusFiles || {}) },
              finance: { ...s.finance, ...(parsed.finance || {}) },
              cal: mergedCal,
              period: { ...s.period, ...(parsed.period || {}) },
            };
          });
        }
      } catch (e) { console.log("no saved data yet (first run) or load failed:", e); }
      // the app can render now - the background photo / map files (kicked off above, already
      // in flight) can take a bit longer since they're chunked, and there's no reason the whole
      // app should sit on a loading screen waiting for them. They pop into place via setState
      // once ready, without gating `loaded`.
      setLoaded(true);
    })();

    (async () => {
      try {
        const img = await bgImagePromise;
        if (img) { setState((s) => ({ ...s, cal: { ...s.cal, bgImage: img } })); lastPersistedImageRef.current = img; }
      } catch (e) { console.log("no saved background image yet:", e); }
    })();

    (async () => {
      try {
        const mapData = await mapFilesPromise;
        if (mapData) {
          const arr = JSON.parse(mapData);
          setState((s) => ({ ...s, campusFiles: { ...s.campusFiles, mapFiles: arr } }));
          lastPersistedMapFilesRef.current = mapData;
        }
      } catch (e) { console.log("no saved map files yet:", e); }
    })();
  }, []);
  // main app data (background image excluded so a large GIF can never block everything else from saving)
  const [saveErrorDetail, setSaveErrorDetail] = useState("");
  const saveMainDataNow = useCallback(async (s) => {
    try {
      const toSave = {
        ...s,
        cal: { ...s.cal, bgImage: null },
        campusFiles: { ...s.campusFiles, mapFiles: [] },
      };
      const json = JSON.stringify(toSave);
      await idbSet("lifeapp-data", json);
      setSaveError(false);
      setSaveErrorDetail("");
    } catch (e) {
      console.error("save failed", e);
      setSaveError(true);
      setSaveErrorDetail((e && e.message) || String(e));
    }
  }, []);
  useEffect(() => {
    if (!loaded || !storageOk) return;
    const t = setTimeout(() => { saveMainDataNow(state); }, 400);
    return () => clearTimeout(t);
  }, [state, loaded, storageOk, saveMainDataNow]);
  // background image, saved separately in its own storage slot
  const [imgSaving, setImgSaving] = useState(false);
  const [imgSaved, setImgSaved] = useState(false);
  const [imgProgress, setImgProgress] = useState(null);
  // generation token so an older, still-in-flight save (e.g. from a photo the user has already
  // replaced or a reset that fired mid-upload) can never overwrite the status of a newer one
  const imgSaveGenRef = useRef(0);
  const saveImageNow = useCallback(async (dataUrl) => {
    const myGen = ++imgSaveGenRef.current;
    setImgSaving(true);
    setImgSaved(false);
    setImgProgress(null);
    try {
      if (dataUrl) {
        await idbSet("lifeapp-bg-image", dataUrl);
      } else {
        await idbDelete("lifeapp-bg-image");
      }
      if (imgSaveGenRef.current !== myGen) return;
      lastPersistedImageRef.current = dataUrl;
      setImgSaveError(false);
      setImgSaved(true);
    } catch (e) {
      console.error("background image save failed", e);
      if (imgSaveGenRef.current !== myGen) return;
      setImgSaveError(true);
      setImgErrorDetail((e && e.message) || String(e));
    } finally {
      if (imgSaveGenRef.current === myGen) setImgSaving(false);
    }
  }, []);
  const retryImageSave = useCallback(async () => {
    await saveImageNow(stateRef.current.cal.bgImage);
  }, [saveImageNow]);
  useEffect(() => {
    if (!loaded || !storageOk) return;
    if (state.cal.bgImage === lastPersistedImageRef.current) return; // unchanged since last save/load - nothing to do
    const t = setTimeout(() => { saveImageNow(state.cal.bgImage); }, 150);
    return () => clearTimeout(t);
  }, [state.cal.bgImage, loaded, storageOk, saveImageNow]);
  // campus map photos (multiple) - saved together as one chunked slot to keep request count low
  useEffect(() => {
    if (!loaded || !storageOk) return;
    const files = state.campusFiles.mapFiles;
    const json = files && files.length ? JSON.stringify(files) : "[]";
    if (json === lastPersistedMapFilesRef.current) return; // unchanged since last save/load - nothing to do
    const t = setTimeout(async () => {
      try {
        if (files && files.length) await idbSet("lifeapp-file-mapFiles", json);
        else await idbDelete("lifeapp-file-mapFiles");
        lastPersistedMapFilesRef.current = json;
      } catch (e) { console.error("mapFiles save failed", e); }
    }, 150);
    return () => clearTimeout(t);
  }, [state.campusFiles.mapFiles, loaded, storageOk]);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => {
    if (!loaded || !storageOk) return;
    function flush() {
      try {
        const s = stateRef.current;
        idbSet("lifeapp-data", JSON.stringify({
          ...s,
          cal: { ...s.cal, bgImage: null },
          campusFiles: { ...s.campusFiles, mapFiles: [] },
        }));
      } catch (e) { /* best effort */ }
    }
    function onVisibility() { if (document.visibilityState === "hidden") flush(); }
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loaded, storageOk]);
  const retryMainSave = useCallback(async () => { await saveMainDataNow(stateRef.current); }, [saveMainDataNow]);
  return [state, setState, loaded, saveError, storageOk, imgSaveError, imgSaving, imgSaved, imgErrorDetail, imgProgress, retryImageSave, saveErrorDetail, retryMainSave];
}

/* ============================== shared UI bits ============================== */

function PinkPanel({ children, style }) {
  return <div className="panel-pink" style={style}>{children}</div>;
}

function IconTile({ icon, label, onClick, href }) {
  if (href) {
    return (
      <a className="tile" href={href} target="_blank" rel="noopener noreferrer">
        <div className="tile-icon">{icon}</div>
        <div className="tile-label">{label}</div>
      </a>
    );
  }
  return (
    <button className="tile" onClick={onClick}>
      <div className="tile-icon">{icon}</div>
      <div className="tile-label">{label}</div>
    </button>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={"modal-box" + (wide ? " wide" : "")}>
        <div className="modal-head">
          <span>{title}</span>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

// A "time" input that can genuinely be left empty. Native <input type="time"> is fine once it
// already has a value, but on most mobile browsers, tapping an EMPTY time input opens a wheel
// picker that always has some value already dialed in - so any tap-and-confirm ends up filling
// it in, making "clear it" not really stick. Instead: when there's no value, show a plain button;
// only swap in the real time input once the person has actually chosen to set one.
function OptionalTimeField({ value, onChange }) {
  return (
    <div className="two-col" style={{ gridTemplateColumns: "1fr auto" }}>
      <input type="time" value={value || ""} onChange={(e) => onChange(e.target.value)} />
      {value && <button type="button" className="icon-btn" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange(""); }} title="清除時間"><X size={14} /></button>}
    </div>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button className={"toggle" + (checked ? " on" : "")} onClick={() => onChange(!checked)}>
      <span className="toggle-knob" />
    </button>
  );
}

/* ============================== Header ============================== */

function TopHeader({ title, dateObj, sub, right }) {
  return (
    <div className="top-header">
      <div className="top-header-left">
        <div className="title-script">{title}</div>
        {sub}
      </div>
      <div className="top-header-right">
        {right}
        <div className="date-block">
          <div className="date-year">{dateObj.getFullYear()}</div>
          <div className="date-day">{dateObj.getDate()}</div>
          <div className="date-month">{dateObj.toLocaleString("en-US", { month: "long" })}</div>
        </div>
      </div>
    </div>
  );
}

/* ============================== HOME PAGE ============================== */

function HomePage({ state, setState, today, reminders }) {
  const ay = getAcademicYear(today);
  const todayWeekday = (today.getDay() + 6) % 7; // 0=Mon

  const [modal, setModal] = useState(null);
  const [wheelSpin, setWheelSpin] = useState(0);
  const [wheelResult, setWheelResult] = useState(null);
  const spinning = useRef(false);
  const [remindersDismissed, setRemindersDismissed] = useState(false);
  const [editAssignment, setEditAssignment] = useState(null);
  const [editExam, setEditExam] = useState(null);
  const [editTodo, setEditTodo] = useState(null);

  const todos = state.todos || [];
  const sortedTodos = todos.slice().sort((a, b) => {
    if (!!a.done !== !!b.done) return a.done ? 1 : -1; // unfinished first
    const ak = a.dueDate ? `${a.dueDate}${a.dueTime || "23:59"}` : a.scheduled && a.date ? `${a.date}${a.start || ""}` : "9999";
    const bk = b.dueDate ? `${b.dueDate}${b.dueTime || "23:59"}` : b.scheduled && b.date ? `${b.date}${b.start || ""}` : "9999";
    return ak.localeCompare(bk);
  });

  function todoEventId(id) { return id + "__todo"; }
  function saveTodo(t) {
    setState((s) => {
      const list = s.todos || [];
      const exists = list.some((x) => x.id === t.id);
      const nextTodos = exists ? list.map((x) => x.id === t.id ? t : x) : [...list, t];
      const evId = todoEventId(t.id);
      let events = s.cal.events.filter((x) => x.id !== evId);
      if (t.scheduled && t.date) {
        events = [...events, { id: evId, title: t.title, date: t.date, start: t.start || "09:00", end: t.end || "10:00", note: t.note || "", color: t.color || "#7d97ab" }];
      }
      return { ...s, todos: nextTodos, cal: { ...s.cal, events } };
    });
    setModal("todos");
  }
  function deleteTodo(id) {
    setState((s) => ({
      ...s,
      todos: (s.todos || []).filter((x) => x.id !== id),
      cal: { ...s.cal, events: s.cal.events.filter((x) => x.id !== todoEventId(id)) },
    }));
    setModal("todos");
  }
  function toggleTodoDone(id) {
    setState((s) => ({ ...s, todos: (s.todos || []).map((x) => x.id === id ? { ...x, done: !x.done } : x) }));
  }

  const timeline = buildTodayTimeline(state.cal, today);
  const assignments = state.assignments || [];
  const exams = state.exams || [];
  const courseOptions = Array.from(new Set(
    (state.cal.semesters || []).flatMap((s) => (s.courses || []).map((c) => c.name)).filter(Boolean)
  ));
  const sortedAssignments = assignments.slice().sort((a, b) => `${a.dueDate}${a.dueTime || ""}`.localeCompare(`${b.dueDate}${b.dueTime || ""}`));
  const sortedExams = exams.slice().sort((a, b) => `${a.date}${a.time || ""}`.localeCompare(`${b.date}${b.time || ""}`));
  const todayKeyForDeadline = toKey(today);

  function assignmentEventId(id) { return id + "__assignment"; }
  function saveAssignment(a) {
    setState((s) => {
      const list = s.assignments || [];
      const exists = list.some((x) => x.id === a.id);
      const nextList = exists ? list.map((x) => x.id === a.id ? a : x) : [...list, a];
      const evId = assignmentEventId(a.id);
      let events = s.cal.events.filter((x) => x.id !== evId);
      if (a.addToCalendar && a.calDate) {
        events = [...events, { id: evId, title: `📝 ${a.name}`, date: a.calDate, start: a.calStart || "09:00", end: a.calEnd || "10:00", note: a.note || "", color: a.color || "#7d97ab" }];
      }
      return { ...s, assignments: nextList, cal: { ...s.cal, events } };
    });
    setModal("assignments");
  }
  function deleteAssignment(id) {
    setState((s) => ({
      ...s,
      assignments: (s.assignments || []).filter((x) => x.id !== id),
      cal: { ...s.cal, events: s.cal.events.filter((x) => x.id !== assignmentEventId(id)) },
    }));
    setModal("assignments");
  }
  function examEventId(id) { return id + "__exam"; }
  function saveExam(e) {
    setState((s) => {
      const list = s.exams || [];
      const exists = list.some((x) => x.id === e.id);
      const nextList = exists ? list.map((x) => x.id === e.id ? e : x) : [...list, e];
      const evId = examEventId(e.id);
      let events = s.cal.events.filter((x) => x.id !== evId);
      if (e.addToCalendar && e.date) {
        events = [...events, { id: evId, title: `📖 ${e.name}`, date: e.date, start: e.start || "09:00", end: e.end || "10:00", note: e.note || "", color: e.color || "#c9896a" }];
      }
      return { ...s, exams: nextList, cal: { ...s.cal, events } };
    });
    setModal("exams");
  }
  function deleteExam(id) {
    setState((s) => ({
      ...s,
      exams: (s.exams || []).filter((x) => x.id !== id),
      cal: { ...s.cal, events: s.cal.events.filter((x) => x.id !== examEventId(id)) },
    }));
    setModal("exams");
  }

  function addMapFiles(fileList) {
    const files = Array.from(fileList || []);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setState((s) => ({
          ...s,
          campusFiles: { ...s.campusFiles, mapFiles: [...s.campusFiles.mapFiles, { id: uid(), name: file.name, dataUrl: reader.result }] },
        }));
      };
      reader.readAsDataURL(file);
    });
  }
  function removeMapFile(id) {
    setState((s) => ({ ...s, campusFiles: { ...s.campusFiles, mapFiles: s.campusFiles.mapFiles.filter((f) => f.id !== id) } }));
  }

  const activeRestaurants = state.restaurants.filter((r) => r.active);

  function spinWheel() {
    if (spinning.current || activeRestaurants.length === 0) return;
    spinning.current = true;
    const seg = 360 / activeRestaurants.length;
    const idx = Math.floor(Math.random() * activeRestaurants.length);
    const targetCenter = idx * seg + seg / 2;
    const rounds = 5 * 360;
    const finalRotation = wheelSpin - (wheelSpin % 360) + rounds + (360 - targetCenter);
    setWheelSpin(finalRotation);
    setWheelResult(null);
    setTimeout(() => {
      setWheelResult(activeRestaurants[idx].name);
      spinning.current = false;
    }, 3200);
  }

  const [habitViewDate, setHabitViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const monthIdx = habitViewDate.getMonth();
  const dim = daysInMonth(habitViewDate.getFullYear(), monthIdx);
  const monthKey = toMonthKey(habitViewDate);

  function toggleHabit(habitId, day) {
    const key = pad2(day);
    setState((s) => {
      const list = s.habits[monthKey] || [];
      return {
        ...s,
        habits: {
          ...s.habits,
          [monthKey]: list.map((h) => h.id !== habitId ? h : { ...h, checked: { ...h.checked, [key]: !h.checked[key] } }),
        },
      };
    });
  }

  return (
    <div className="page">
      <TopHeader title={`${ay.roc}年度第${ay.sem === 1 ? "一" : "二"}學期`} dateObj={today} />
      <div className="page-body">
        {reminders && reminders.length > 0 && !remindersDismissed && (
          <div className="reminder-banner">
            <div className="reminder-banner-head">
              <span>🔔 提醒</span>
              <button className="reminder-dismiss" onClick={() => setRemindersDismissed(true)}><X size={14} /></button>
            </div>
            {reminders.map((r) => (
              <div className="reminder-item" key={`${r.kind}-${r.id}`}>
                <span className="reminder-dot" style={{ background: r.kind === "exam" ? "#c9896a" : r.kind === "todo" ? "#8a9a6f" : "#7d97ab" }} />
                <span className="reminder-time">{r.date.slice(5)}{r.time ? ` ${r.time}` : ""}</span>
                <span className="reminder-title">{r.kind === "exam" ? "📖" : r.kind === "todo" ? "✅" : "📝"} {r.title}{r.course ? `（${r.course}）` : ""}</span>
              </div>
            ))}
          </div>
        )}
        <PinkPanel>
          <div className="panel-tag-row">
            <span className="chip-tag">{pad2(today.getMonth() + 1)}.{pad2(today.getDate())}週{WEEKDAY_CN[todayWeekday]}</span>
            <span className="panel-title-inline">今日行程</span>
          </div>
          <div className="timeline">
            {timeline.length === 0 && <div className="empty-hint">今天沒有安排的行程</div>}
            {timeline.map((item, i) => (
              <div className="timeline-row" key={i}>
                <div className="timeline-time">{item.time}{item.endTime ? `–${item.endTime}` : ""}</div>
                <div className="timeline-dot" style={{ background: item.color || "#8a7266" }} />
                <div className="timeline-content">
                  <div className="timeline-title">{item.title}</div>
                  {item.sub && <div className="timeline-sub">{item.sub}</div>}
                </div>
              </div>
            ))}
          </div>
        </PinkPanel>

        <div className="tile-grid">
          <IconTile icon={<CalendarDays size={22} />} label="校園行事曆" href={state.campusFiles.calendarLink || CAMPUS_CALENDAR_LINK} />
          <IconTile icon={<GraduationCap size={22} />} label="學生入口網" href="https://portal.fju.edu.tw/student/" />
          <IconTile icon={<Newspaper size={22} />} label="校園公告" href="https://www.fju.edu.tw/news.jsp" />
          <IconTile icon={<MapPin size={22} />} label="校園地圖" onClick={() => setModal("map")} />
          <IconTile icon={<Utensils size={22} />} label="美食轉盤" onClick={() => setModal("wheel")} />
          <IconTile icon={<Grid3x3 size={22} />} label="打卡牆" onClick={() => setModal("habits")} />
          <IconTile icon={<NotebookPen size={22} />} label="作業" onClick={() => setModal("assignments")} />
          <IconTile icon={<HelpCircle size={22} />} label="考試" onClick={() => setModal("exams")} />
          <IconTile icon={<ListChecks size={22} />} label="待辦事項" onClick={() => setModal("todos")} />
        </div>
      </div>

      {modal === "map" && (
        <Modal title="校園地圖" onClose={() => setModal(null)} wide>
          <MultiFileGallery files={state.campusFiles.mapFiles} onAdd={addMapFiles} onRemove={removeMapFile} />
        </Modal>
      )}
      {modal === "wheel" && (
        <Modal title="美食轉盤" onClose={() => setModal(null)} wide>
          <div className="wheel-wrap">
            <div className="wheel-area">
              {activeRestaurants.length > 0 ? (
                <>
                  <div className="wheel-pointer">▼</div>
                  <div
                    className="wheel"
                    style={{
                      transform: `rotate(${wheelSpin}deg)`,
                      background: `conic-gradient(${activeRestaurants.map((r, i) => `${CHART_COLORS[i % CHART_COLORS.length]} ${(i * 360) / activeRestaurants.length}deg ${((i + 1) * 360) / activeRestaurants.length}deg`).join(",")})`,
                    }}
                  >
                    {activeRestaurants.map((r, i) => {
                      const seg = 360 / activeRestaurants.length;
                      const ang = i * seg + seg / 2;
                      return (
                        <div key={r.id} className="wheel-label" style={{ transform: `rotate(${ang}deg)` }}>
                          <span style={{ transform: `rotate(90deg)` }}>{r.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : <div className="empty-hint">請先勾選至少一間餐廳</div>}
            </div>
            <button className="btn-outline" onClick={spinWheel} disabled={activeRestaurants.length === 0}>開始轉動</button>
            {wheelResult && <div className="wheel-result">今天就吃：{wheelResult}！</div>}
            <RestaurantManager state={state} setState={setState} />
          </div>
        </Modal>
      )}
      {modal === "habits" && (
        <Modal title="打卡牆" onClose={() => setModal(null)} wide>
          <HabitWall state={state} setState={setState} monthKey={monthKey} dim={dim}
            viewDate={habitViewDate}
            onPrev={() => setHabitViewDate(new Date(habitViewDate.getFullYear(), habitViewDate.getMonth() - 1, 1))}
            onNext={() => setHabitViewDate(new Date(habitViewDate.getFullYear(), habitViewDate.getMonth() + 1, 1))}
            toggleHabit={toggleHabit} />
        </Modal>
      )}
      {modal === "assignments" && (
        <Modal title="作業" onClose={() => setModal(null)} wide>
          <button className="btn-outline" onClick={() => { setEditAssignment(null); setModal("assignmentForm"); }}><Plus size={16} /> 新增作業</button>
          <div className="course-list">
            {sortedAssignments.map((a) => (
              <div className="course-row" key={a.id}>
                <span className="ellipsis" style={{ color: a.dueDate < todayKeyForDeadline ? "#b95c5c" : undefined }}>
                  <strong>{a.name}</strong>{a.course ? ` · ${a.course}` : ""} · {a.dueDate}{a.dueTime ? ` ${a.dueTime}` : ""}
                </span>
                <span className="row-actions">
                  {a.fileLink && <button className="icon-btn" onClick={() => window.open(a.fileLink, "_blank", "noopener,noreferrer")} title="開啟檔案連結"><ExternalLink size={14} /></button>}
                  <button className="icon-btn" onClick={() => { setEditAssignment(a); setModal("assignmentForm"); }}><Pencil size={14} /></button>
                  <button className="icon-btn" onClick={() => deleteAssignment(a.id)}><Trash2 size={14} /></button>
                </span>
              </div>
            ))}
            {sortedAssignments.length === 0 && <div className="empty-hint">還沒有新增任何作業</div>}
          </div>
        </Modal>
      )}
      {modal === "assignmentForm" && (
        <Modal title={editAssignment ? "編輯作業" : "新增作業"} onClose={() => setModal("assignments")}>
          <AssignmentForm item={editAssignment} courseOptions={courseOptions} onSave={saveAssignment}
            onDelete={editAssignment ? () => deleteAssignment(editAssignment.id) : null} />
        </Modal>
      )}
      {modal === "exams" && (
        <Modal title="考試" onClose={() => setModal(null)} wide>
          <button className="btn-outline" onClick={() => { setEditExam(null); setModal("examForm"); }}><Plus size={16} /> 新增考試</button>
          <div className="course-list">
            {sortedExams.map((e) => (
              <div className="course-row" key={e.id}>
                <span className="ellipsis" style={{ color: e.date < todayKeyForDeadline ? "#b95c5c" : undefined }}>
                  <strong>{e.name}</strong>{e.course ? ` · ${e.course}` : ""} · {e.date}{e.start ? ` ${e.start}${e.end ? `–${e.end}` : ""}` : ""}
                </span>
                <span className="row-actions">
                  <button className="icon-btn" onClick={() => { setEditExam(e); setModal("examForm"); }}><Pencil size={14} /></button>
                  <button className="icon-btn" onClick={() => deleteExam(e.id)}><Trash2 size={14} /></button>
                </span>
              </div>
            ))}
            {sortedExams.length === 0 && <div className="empty-hint">還沒有新增任何考試</div>}
          </div>
        </Modal>
      )}
      {modal === "examForm" && (
        <Modal title={editExam ? "編輯考試" : "新增考試"} onClose={() => setModal("exams")}>
          <ExamForm item={editExam} courseOptions={courseOptions} onSave={saveExam}
            onDelete={editExam ? () => deleteExam(editExam.id) : null} />
        </Modal>
      )}
      {modal === "todos" && (
        <Modal title="待辦事項" onClose={() => setModal(null)} wide>
          <button className="btn-outline" onClick={() => { setEditTodo(null); setModal("todoForm"); }}><Plus size={16} /> 新增待辦事項</button>
          <div className="course-list">
            {sortedTodos.map((t) => {
              const doneCount = (t.subitems || []).filter((si) => si.done).length;
              return (
                <div className="course-row" key={t.id}>
                  <input type="checkbox" checked={!!t.done} onChange={() => toggleTodoDone(t.id)} />
                  <span className="ellipsis" style={{ textDecoration: t.done ? "line-through" : "none", opacity: t.done ? 0.6 : 1, cursor: "pointer" }}
                    onClick={() => { setEditTodo(t); setModal("todoForm"); }}>
                    <strong style={t.dueDate && !t.done && t.dueDate < todayKeyForDeadline ? { color: "#b95c5c" } : undefined}>{t.title}</strong>
                    {t.subitems && t.subitems.length > 0 ? ` · ${doneCount}/${t.subitems.length} 項細項` : ""}
                    {t.dueDate ? ` · 截止 ${t.dueDate}${t.dueTime ? ` ${t.dueTime}` : ""}` : ""}
                    {t.scheduled && t.date ? ` · 行事曆 ${t.date}${t.start ? ` ${t.start}` : ""}` : ""}
                  </span>
                  <span className="row-actions">
                    <button className="icon-btn" onClick={() => { setEditTodo(t); setModal("todoForm"); }}><Pencil size={14} /></button>
                    <button className="icon-btn" onClick={() => deleteTodo(t.id)}><Trash2 size={14} /></button>
                  </span>
                </div>
              );
            })}
            {sortedTodos.length === 0 && <div className="empty-hint">還沒有新增任何待辦事項</div>}
          </div>
        </Modal>
      )}
      {modal === "todoForm" && (
        <Modal title={editTodo ? "編輯待辦事項" : "新增待辦事項"} onClose={() => setModal("todos")}>
          <TodoForm item={editTodo} onSave={saveTodo} onDelete={editTodo ? () => deleteTodo(editTodo.id) : null} />
        </Modal>
      )}
    </div>
  );
}

function MultiFileGallery({ files, onAdd, onRemove }) {
  const inputRef = useRef(null);
  return (
    <div>
      <div className="upload-box" onClick={() => inputRef.current?.click()}>
        <Upload size={26} />
        <div>上傳照片或 PDF（可一次選擇多張）</div>
        <input ref={inputRef} type="file" accept="image/*,application/pdf" multiple hidden
          onChange={(e) => { if (e.target.files.length) onAdd(e.target.files); e.target.value = ""; }} />
      </div>
      <div className="map-gallery">
        {files.map((file) => (
          <div className="file-preview" key={file.id}>
            <div className="file-preview-name">
              <FileText size={16} />
              <span className="ellipsis">{file.name}</span>
              <button className="icon-btn" onClick={() => onRemove(file.id)} title="刪除"><Trash2 size={16} /></button>
            </div>
            {file.dataUrl.startsWith("data:image") ? (
              <img src={file.dataUrl} alt={file.name} />
            ) : (
              <>
                <iframe src={file.dataUrl} title={file.name} className="pdf-frame" />
                <button className="btn-outline" style={{ marginTop: 8 }} onClick={() => window.open(file.dataUrl, "_blank")}>在新分頁開啟</button>
              </>
            )}
          </div>
        ))}
        {files.length === 0 && <div className="empty-hint">尚未上傳任何檔案</div>}
      </div>
    </div>
  );
}

function RestaurantManager({ state, setState }) {
  const [name, setName] = useState("");
  function add() {
    if (!name.trim()) return;
    setState((s) => ({ ...s, restaurants: [...s.restaurants, { id: uid(), name: name.trim(), active: true }] }));
    setName("");
  }
  function toggle(id) {
    setState((s) => ({ ...s, restaurants: s.restaurants.map((r) => r.id === id ? { ...r, active: !r.active } : r) }));
  }
  function remove(id) {
    setState((s) => ({ ...s, restaurants: s.restaurants.filter((r) => r.id !== id) }));
  }
  return (
    <div className="restaurant-manager">
      <div className="inline-add">
        <input placeholder="新增喜歡的餐廳" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn-outline small" onClick={add}><Plus size={16} /></button>
      </div>
      <div className="restaurant-list">
        {state.restaurants.map((r) => (
          <div className="restaurant-row" key={r.id}>
            <label className="checkbox-row">
              <input type="checkbox" checked={r.active} onChange={() => toggle(r.id)} />
              <span>{r.name}</span>
            </label>
            <button className="icon-btn" onClick={() => remove(r.id)}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function HabitWall({ state, setState, monthKey, dim, viewDate, onPrev, onNext, toggleHabit }) {
  const [name, setName] = useState("");
  const monthHabits = state.habits[monthKey] || [];
  function add() {
    if (!name.trim()) return;
    setState((s) => ({
      ...s,
      habits: { ...s.habits, [monthKey]: [...(s.habits[monthKey] || []), { id: uid(), name: name.trim(), checked: {} }] },
    }));
    setName("");
  }
  function remove(id) {
    setState((s) => ({
      ...s,
      habits: { ...s.habits, [monthKey]: (s.habits[monthKey] || []).filter((h) => h.id !== id) },
    }));
  }
  return (
    <div>
      <div className="week-nav" style={{ marginBottom: 10 }}>
        <button className="icon-btn" onClick={onPrev}><ChevronLeft size={16} /></button>
        <span>{viewDate.getFullYear()}年{viewDate.getMonth() + 1}月</span>
        <button className="icon-btn" onClick={onNext}><ChevronRight size={16} /></button>
      </div>
      <div className="inline-add">
        <input placeholder="新增這個月的目標，例如：喝水 2000ml" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn-outline small" onClick={add}><Plus size={16} /></button>
      </div>
      <div className="habit-list">
        {monthHabits.map((h) => (
          <div key={h.id} className="habit-block">
            <div className="habit-head">
              <span>{h.name}</span>
              <button className="icon-btn" onClick={() => remove(h.id)}><Trash2 size={14} /></button>
            </div>
            <div className="habit-grid">
              {Array.from({ length: dim }, (_, i) => i + 1).map((day) => {
                const key = pad2(day);
                const on = !!h.checked[key];
                return (
                  <button key={day} className={"habit-cell" + (on ? " on" : "")} onClick={() => toggleHabit(h.id, day)}>{day}</button>
                );
              })}
            </div>
          </div>
        ))}
        {monthHabits.length === 0 && <div className="empty-hint">這個月尚未設定目標</div>}
      </div>
    </div>
  );
}

/* ============================== FINANCE PAGE ============================== */

function FinancePage({ state, setState, today }) {
  const [monthDate, setMonthDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const monthKey = toMonthKey(monthDate);
  const md = state.finance.months[monthKey] || { income: 0, budget: 0, categories: ["餐飲", "交通", "娛樂", "其他"], entries: [] };

  const [modal, setModal] = useState(null);
  const [editEntry, setEditEntry] = useState(null);

  function updateMonth(patch) {
    setState((s) => ({
      ...s,
      finance: { ...s.finance, months: { ...s.finance.months, [monthKey]: { ...md, ...patch } } },
    }));
  }
  function ensureMonth() {
    if (!state.finance.months[monthKey]) updateMonth({});
  }
  useEffect(ensureMonth, [monthKey]);

  const totalExpense = md.entries.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const budgetUsedPct = Number(md.budget) > 0 ? Math.round((totalExpense / Number(md.budget)) * 100) : null;
  const overBudget = Number(md.budget) > 0 && totalExpense > Number(md.budget);

  // running balance: holding amount + all recorded income - all recorded expenses, across every month
  const globalRemaining = useMemo(() => {
    let incomeSum = 0, expenseSum = 0;
    Object.values(state.finance.months).forEach((m) => {
      incomeSum += Number(m.income || 0);
      expenseSum += (m.entries || []).reduce((s2, e) => s2 + Number(e.amount || 0), 0);
    });
    return Number(state.finance.holdingAmount || 0) + incomeSum - expenseSum;
  }, [state.finance.holdingAmount, state.finance.months]);

  function saveEntry(entry) {
    const list = md.entries.some((e) => e.id === entry.id)
      ? md.entries.map((e) => e.id === entry.id ? entry : e)
      : [...md.entries, entry];
    updateMonth({ entries: list });
  }
  function deleteEntry(id) { updateMonth({ entries: md.entries.filter((e) => e.id !== id) }); }

  // yearly trend data (12 months ending at current selected month)
  const trendData = useMemo(() => {
    const arr = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(monthDate.getFullYear(), monthDate.getMonth() - i, 1);
      const k = toMonthKey(d);
      const m = state.finance.months[k];
      const total = m ? m.entries.reduce((s2, e) => s2 + Number(e.amount || 0), 0) : 0;
      arr.push({ month: `${d.getMonth() + 1}月`, 支出: total });
    }
    return arr;
  }, [state.finance.months, monthKey]);

  const pieData = useMemo(() => {
    const map = {};
    md.entries.forEach((e) => { map[e.category] = (map[e.category] || 0) + Number(e.amount || 0); });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [md.entries]);

  return (
    <div className="page">
      <TopHeader
        title={<span className="month-switch">
          <span>{monthDate.getFullYear()}年{monthDate.getMonth() + 1}月</span>
          <button className="icon-btn" onClick={() => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1))}><ChevronLeft size={18} /></button>
          <button className="icon-btn" onClick={() => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1))}><ChevronRight size={18} /></button>
        </span>}
        dateObj={today}
      />
      <div className="page-body">
        <PinkPanel>
          <div className="finance-panel">
            <div className="finance-left">
              <div className="finance-row"><span>本月預算</span><span className="finance-pill">{fmtMoney(md.budget)}</span></div>
              <div className="finance-row"><span>本月支出</span><span className="finance-pill">{fmtMoney(totalExpense)}</span></div>
              <div className="finance-row"><span>本月收入</span><span className="finance-pill">{fmtMoney(md.income)}</span></div>
              <div className="finance-row"><span>目前剩餘</span><span className="finance-pill">{fmtMoney(globalRemaining)}</span></div>
            </div>
            <div className="finance-right">
              <button className="btn-outline" onClick={() => setModal("holding")}>持有金額</button>
              <button className="btn-outline" onClick={() => setModal("income")}>收入</button>
              <button className="btn-outline" onClick={() => setModal("budget")}>預算</button>
              <button className="btn-outline" onClick={() => setModal("category")}>分類</button>
              <button className="btn-outline" onClick={() => setModal("chart")}>圖表</button>
            </div>
          </div>
        </PinkPanel>

        <div className="table-card">
          <div className="table-head-row">
            <span>日期</span><span>分類</span><span>金額</span><span>備註</span><span></span>
          </div>
          <div className="table-body">
            {md.entries.length === 0 && <div className="empty-hint">尚無消費紀錄</div>}
            {[...md.entries].sort((a, b) => a.date < b.date ? 1 : -1).map((e) => (
              <div className="table-row" key={e.id}>
                <span>{e.date.slice(5)}</span>
                <span>{e.category}</span>
                <span>{fmtMoney(e.amount)}</span>
                <span className="ellipsis">{e.note}</span>
                <span className="row-actions">
                  <button className="icon-btn" onClick={() => { setEditEntry(e); setModal("entry"); }}><Pencil size={14} /></button>
                  <button className="icon-btn" onClick={() => deleteEntry(e.id)}><Trash2 size={14} /></button>
                </span>
              </div>
            ))}
          </div>
        </div>
        <button className="fab" onClick={() => { setEditEntry(null); setModal("entry"); }}><Plus size={26} /></button>
      </div>

      {modal === "holding" && (
        <Modal title="持有金額" onClose={() => setModal(null)}>
          <div className="bg-adjust-hint" style={{ marginBottom: 6 }}>填寫一開始擁有的錢，之後的「目前剩餘」會用這個金額扣掉花費、加上收入來計算</div>
          <NumberEditor value={state.finance.holdingAmount} onSave={(v) => { setState((s) => ({ ...s, finance: { ...s.finance, holdingAmount: v } })); setModal(null); }} />
        </Modal>
      )}
      {modal === "income" && (
        <Modal title="本月收入" onClose={() => setModal(null)}>
          <NumberEditor value={md.income} onSave={(v) => { updateMonth({ income: v }); setModal(null); }} />
        </Modal>
      )}
      {modal === "budget" && (
        <Modal title="本月預算" onClose={() => setModal(null)}>
          <NumberEditor value={md.budget} onSave={(v) => { updateMonth({ budget: v }); setModal(null); }} />
        </Modal>
      )}
      {modal === "category" && (
        <Modal title="消費分類" onClose={() => setModal(null)}>
          <CategoryEditor categories={md.categories} onChange={(cats) => updateMonth({ categories: cats })} />
        </Modal>
      )}
      {modal === "chart" && (
        <Modal title="消費圖表" onClose={() => setModal(null)} wide>
          <div className="chart-block">
            <div className="chart-title">本月預算使用狀況</div>
            {Number(md.budget) > 0 ? (
              <div className="budget-usage">
                <div className="budget-bar-track">
                  <div className={"budget-bar-fill" + (overBudget ? " over" : "")} style={{ width: `${Math.min(budgetUsedPct, 100)}%` }} />
                </div>
                <div className="budget-usage-text">
                  已使用 {fmtMoney(totalExpense)} / {fmtMoney(md.budget)}（{budgetUsedPct}%）
                  {overBudget && <span className="budget-over-tag">已超支 {fmtMoney(totalExpense - md.budget)}</span>}
                </div>
              </div>
            ) : <div className="empty-hint">尚未設定本月預算</div>}
          </div>
          <div className="chart-block">
            <div className="chart-title">近一年消費支出</div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#d8cdc0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#6b5648" />
                <YAxis tick={{ fontSize: 12 }} stroke="#6b5648" />
                <Tooltip />
                <Line type="monotone" dataKey="支出" stroke="#a97c7c" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-block">
            <div className="chart-title">本月消費分類比例</div>
            {pieData.length === 0 ? <div className="empty-hint">尚無資料</div> : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                    {pieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Legend />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </Modal>
      )}
      {modal === "entry" && (
        <Modal title={editEntry ? "編輯消費紀錄" : "新增消費紀錄"} onClose={() => setModal(null)}>
          <EntryForm entry={editEntry} categories={md.categories} monthKey={monthKey} today={today}
            onSave={(e) => { saveEntry(e); setModal(null); }} />
        </Modal>
      )}
    </div>
  );
}

function NumberEditor({ value, onSave }) {
  const [v, setV] = useState(value ?? 0);
  return (
    <div className="form-col">
      <Field label="金額">
        <input type="number" value={v} onChange={(e) => setV(e.target.value)} />
      </Field>
      <button className="btn-solid" onClick={() => onSave(Number(v) || 0)}>儲存</button>
    </div>
  );
}

function CategoryEditor({ categories, onChange }) {
  const [list, setList] = useState(categories);
  const [name, setName] = useState("");
  function add() { if (!name.trim()) return; setList([...list, name.trim()]); setName(""); }
  function remove(i) { setList(list.filter((_, idx) => idx !== i)); }
  return (
    <div className="form-col">
      <div className="inline-add">
        <input placeholder="新增分類" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn-outline small" onClick={add}><Plus size={16} /></button>
      </div>
      <div className="chip-list">
        {list.map((c, i) => (
          <span key={i} className="chip-removable">{c}<button onClick={() => remove(i)}><X size={12} /></button></span>
        ))}
      </div>
      <button className="btn-solid" onClick={() => onChange(list)}>儲存分類</button>
    </div>
  );
}

function EntryForm({ entry, categories, monthKey, today, onSave }) {
  const defaultDate = monthKey === toMonthKey(today) ? toKey(today) : `${monthKey}-01`;
  const [date, setDate] = useState(entry?.date || defaultDate);
  const [category, setCategory] = useState(entry?.category || categories[0] || "");
  const [amount, setAmount] = useState(entry?.amount ?? "");
  const [note, setNote] = useState(entry?.note || "");
  return (
    <div className="form-col">
      <Field label="日期"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="分類">
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="金額"><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label="備註"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <button className="btn-solid" onClick={() => onSave({ id: entry?.id || uid(), date, category, amount: Number(amount) || 0, note })}>
        {entry ? "儲存修改" : "新增紀錄"}
      </button>
    </div>
  );
}

/* ============================== CALENDAR PAGE ============================== */

const HOUR_START = 6;
const HOUR_END = 24;
const HOUR_PX = 34;

function CalendarPage({ state, setState, today, imgSaving, imgSaved, imgProgress, imgSaveError, imgErrorDetail, retryImageSave }) {
  const [weekAnchor, setWeekAnchor] = useState(startOfWeekMonday(today));
  const [modal, setModal] = useState(null);
  const [editCourse, setEditCourse] = useState(null);
  const [editEvent, setEditEvent] = useState(null);
  const [attendCourse, setAttendCourse] = useState(null);
  const [editingChip, setEditingChip] = useState(null);
  const [drag, setDrag] = useState(null); // {id, startY, origStart, origEnd}
  const [bgSizeError, setBgSizeError] = useState("");

  const rawSemesters = state.cal.semesters && state.cal.semesters.length ? state.cal.semesters : [{
    id: "default-sem", rocYear: getAcademicYear(today).roc,
    term: getAcademicYear(today).sem === 1 ? "上學期" : "下學期", schoolYearStart: "", termEndDate: "", totalWeeks: "", courses: [],
  }];
  // defensive normalization: guarantee .courses always exists so this page can never crash on odd/legacy data
  const semesters = rawSemesters.map((s) => (Array.isArray(s.courses) ? s : { ...s, courses: [] }));
  const activeSemester = semesters.find((s) => s.id === state.cal.activeSemesterId) || semesters[0];
  // the grid shows courses for whichever semester's date range actually contains the viewed week,
  // falling back to the semester selected via the picker/arrows when no dated semester matches
  const weekSemester = findSemesterForDate(semesters, weekAnchor) || null;
  const displaySemester = weekSemester || activeSemester;

  // keep the header/selection in sync as the user scrolls weeks across a semester boundary
  useEffect(() => {
    if (weekSemester && weekSemester.id !== state.cal.activeSemesterId) {
      setState((s) => ({ ...s, cal: { ...s.cal, activeSemesterId: weekSemester.id } }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekAnchor]);

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekAnchor, i));
  const totalCredits = activeSemester.courses.reduce((s, c) => s + Number(c.credits || 0), 0);

  function updateSemester(id, patch) {
    setState((s) => ({ ...s, cal: { ...s.cal, semesters: s.cal.semesters.map((sem) => sem.id === id ? { ...sem, ...patch } : sem) } }));
  }
  function saveCourse(c) {
    const exists = activeSemester.courses.some((x) => x.id === c.id);
    const nextCourses = exists ? activeSemester.courses.map((x) => x.id === c.id ? c : x) : [...activeSemester.courses, c];
    updateSemester(activeSemester.id, { courses: nextCourses });
  }
  function deleteCourse(id) {
    updateSemester(activeSemester.id, { courses: activeSemester.courses.filter((x) => x.id !== id) });
  }
  function saveEvent(ev) {
    const exists = state.cal.events.some((x) => x.id === ev.id);
    setState((s) => ({ ...s, cal: { ...s.cal, events: exists ? s.cal.events.map((x) => x.id === ev.id ? ev : x) : [...s.cal.events, ev] } }));
  }
  function deleteEvent(id) {
    setState((s) => ({ ...s, cal: { ...s.cal, events: s.cal.events.filter((x) => x.id !== id) } }));
  }
  function toggleTutorialCancelled(courseId, dateKey) {
    setState((s) => ({
      ...s, cal: {
        ...s.cal, semesters: s.cal.semesters.map((sem) => ({
          ...sem, courses: sem.courses.map((c) => {
            if (c.id !== courseId || !c.tutorial) return c;
            const cancelled = c.tutorial.cancelled || [];
            const nextCancelled = cancelled.includes(dateKey) ? cancelled.filter((k) => k !== dateKey) : [...cancelled, dateKey];
            return { ...c, tutorial: { ...c.tutorial, cancelled: nextCancelled } };
          }),
        })),
      },
    }));
  }
  function updateAttendance(courseId, patch) {
    setState((s) => ({
      ...s, cal: {
        ...s.cal, attendance: {
          ...s.cal.attendance,
          [courseId]: { records: {}, notes: [], ...(s.cal.attendance[courseId] || {}), ...patch },
        },
      },
    }));
  }
  function getSessionDatesForDay(course, day) {
    const owner = semesters.find((sem) => sem.courses.some((c) => c.id === course.id)) || displaySemester;
    if (!owner || !owner.schoolYearStart || !owner.totalWeeks) return [];
    const start = new Date(owner.schoolYearStart + "T00:00:00");
    const startWeekday = (start.getDay() + 6) % 7 + 1; // 1=Mon..7=Sun
    let diff = day - startWeekday;
    if (diff < 0) diff += 7;
    const first = addDays(start, diff);
    const weeks = Number(owner.totalWeeks) || 0;
    return Array.from({ length: weeks }, (_, w) => addDays(first, w * 7));
  }
  function getCourseSessionDates(course) {
    return getSessionDatesForDay(course, course.day);
  }
  function getTutorialSessionDates(course) {
    if (!course.tutorial) return [];
    return getSessionDatesForDay(course, course.tutorial.day);
  }
  // presents a course's tutorial session as its own course-shaped object so it can reuse the
  // exact same calendar block / attendance panel rendering as a regular course
  function tutorialAsCourse(c) {
    return {
      id: c.id + "__tutorial",
      name: c.name + "（輔導）",
      professor: c.professor, credits: null, code: c.code, room: c.room,
      day: c.tutorial.day, start: c.tutorial.start, end: c.tutorial.end,
      color: c.tutorial.color || c.color,
      __parentCourseId: c.id,
    };
  }
  function shiftSemester(dir) {
    const chrono = chronoSemesters(semesters);
    const idx = chrono.findIndex((s) => s.id === activeSemester.id);
    if (idx === -1) return;
    const target = chrono[idx + dir];
    if (!target) return; // only navigate among semesters that already exist (added via 學分設定 的 + 按鈕)
    setState((s) => ({ ...s, cal: { ...s.cal, activeSemesterId: target.id } }));
    if (target.schoolYearStart) setWeekAnchor(startOfWeekMonday(new Date(target.schoolYearStart + "T00:00:00")));
  }
  function uploadBg(file) {
    if (!file) return;
    if (file.size > MAX_BG_FILE_BYTES) {
      setBgSizeError(
        `檔案太大了（${(file.size / 1024 / 1024).toFixed(1)}MB），GIF 動圖背景請壓到 ${MAX_BG_FILE_BYTES / 1024 / 1024}MB 以內，不然瀏覽器處理起來可能會很慢、很卡。可以用 ezgif.com 之類的線上工具縮小尺寸、減少張數或降低畫質後再試一次。`
      );
      return;
    }
    setBgSizeError("");
    const reader = new FileReader();
    reader.onload = () => {
      setState((s) => ({ ...s, cal: { ...s.cal, bgImage: reader.result, bgPosition: { x: 50, y: 50 }, bgScale: 1 } }));
      setModal("bgAdjust");
    };
    reader.onerror = () => setBgSizeError("讀取檔案失敗，請確認檔案沒有損壞後再試一次。");
    reader.readAsDataURL(file);
  }
  function clearBg() { setState((s) => ({ ...s, cal: { ...s.cal, bgImage: null } })); }
  const wrapRef = useRef(null);
  const gridRef = useRef(null);
  const bgInputRef = useRef(null);
  const HOUR_COL = 26;
  const [dayW, setDayW] = useState(60);
  const [gridAspect, setGridAspect] = useState(0.5);
  useEffect(() => {
    function calc() {
      if (wrapRef.current) {
        const w = wrapRef.current.clientWidth;
        setDayW(Math.max(30, (w - HOUR_COL) / 7));
      }
    }
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);
  useEffect(() => {
    function measure() {
      if (gridRef.current) {
        const w = gridRef.current.scrollWidth;
        const h = gridRef.current.scrollHeight;
        if (w && h) setGridAspect(w / h);
      }
    }
    const t = setTimeout(measure, 50);
    window.addEventListener("resize", measure);
    return () => { clearTimeout(t); window.removeEventListener("resize", measure); };
  }, [dayW, weekAnchor]);

  // drag to move event blocks
  function onDragStart(e, ev) {
    e.stopPropagation();
    setDrag({ id: ev.id, startY: e.clientY, origStart: timeToMinutes(ev.start), origEnd: timeToMinutes(ev.end) });
  }
  useEffect(() => {
    if (!drag) return;
    function move(e) {
      const deltaMin = Math.round(((e.clientY - drag.startY) / HOUR_PX) * 60 / 15) * 15;
      const dur = drag.origEnd - drag.origStart;
      let ns = drag.origStart + deltaMin;
      ns = Math.max(HOUR_START * 60, Math.min(HOUR_END * 60 - dur, ns));
      const ne = ns + dur;
      const ev = state.cal.events.find((x) => x.id === drag.id);
      if (ev) saveEvent({ ...ev, start: minutesToTime(ns), end: minutesToTime(ne) });
    }
    function up() { setDrag(null); }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [drag, state.cal.events]);

  const hourRows = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);

  return (
    <div className="page">
      <TopHeader
        title={<span className="month-switch">
          <span>{yearTitle(activeSemester, state.cal.baseRocYear)}</span>
          <button className="icon-btn" onClick={() => shiftSemester(-1)}><ChevronLeft size={18} /></button>
          <button className="icon-btn" onClick={() => shiftSemester(1)}><ChevronRight size={18} /></button>
          <button className="icon-btn" onClick={() => setModal("courses")}><CalendarDays size={18} /></button>
          <button className="icon-btn" onClick={() => setModal("credits")}><NotebookPen size={18} /></button>
        </span>}
        dateObj={today}
        sub={
          <div className="chip-row">
            <button className="chip-gray clickable" onClick={() => setEditingChip("start")}>開學日 {activeSemester.schoolYearStart || ""}</button>
            <button className="chip-gray clickable" onClick={() => setEditingChip("end")}>結業式 {activeSemester.termEndDate || ""}</button>
            <button className="chip-gray clickable" onClick={() => setEditingChip("weeks")}>總週數 {activeSemester.totalWeeks || ""}</button>
            <span className="chip-gray">學分 {totalCredits}</span>
          </div>
        }
      />
      <div className="page-body">
        <div className="week-nav">
          <button className="icon-btn" onClick={() => setWeekAnchor(addDays(weekAnchor, -7))}><ChevronLeft size={16} /></button>
          <span>{weekDays[0].getMonth() + 1}/{weekDays[0].getDate()} – {weekDays[6].getMonth() + 1}/{weekDays[6].getDate()}</span>
          <button className="icon-btn" onClick={() => setWeekAnchor(addDays(weekAnchor, 7))}><ChevronRight size={16} /></button>
          <button className="icon-btn" onClick={() => bgInputRef.current?.click()} title="上傳背景"><ImageIcon size={16} /></button>
          {state.cal.bgImage && <button className="icon-btn" onClick={() => setModal("bgAdjust")} title="調整背景位置"><Settings size={14} /></button>}
          {state.cal.bgImage && <button className="icon-btn" onClick={clearBg} title="移除背景"><X size={16} /></button>}
          {state.cal.bgImage && imgSaving && (
            <span className="chip-gray" style={{ flex: "0 0 auto", padding: "4px 8px" }}>照片儲存中…</span>
          )}
          {state.cal.bgImage && imgSaveError && !imgSaving && (
            <button className="icon-btn" style={{ color: "#b95c5c" }} onClick={retryImageSave} title="背景照片尚未儲存成功，點此重試">
              <AlertTriangle size={16} />
            </button>
          )}
          <input ref={bgInputRef} type="file" accept="image/*" hidden onChange={(e) => { if (e.target.files[0]) uploadBg(e.target.files[0]); e.target.value = ""; }} />
        </div>
        {bgSizeError && (
          <div className="bg-adjust-hint" style={{ color: "#b95c5c", fontWeight: 700, marginBottom: 10, wordBreak: "break-word" }}>
            {bgSizeError}
          </div>
        )}
        <div className="cal-grid-wrap" ref={wrapRef}>
          <div className={`cal-grid${state.cal.bgImage ? " cal-grid-has-bg" : ""}`} ref={gridRef} style={{ gridTemplateColumns: `${HOUR_COL}px repeat(7, ${dayW}px)` }}>
            {state.cal.bgImage && (
              <div className="cal-bg-clip">
                <img className="cal-bg-layer" src={state.cal.bgImage} alt="" style={{
                  width: `${(state.cal.bgScale ?? 1) * 100}%`,
                  height: `${(state.cal.bgScale ?? 1) * 100}%`,
                  left: `${(100 - (state.cal.bgScale ?? 1) * 100) / 2}%`,
                  top: `${(100 - (state.cal.bgScale ?? 1) * 100) / 2}%`,
                  objectPosition: `${state.cal.bgPosition?.x ?? 50}% ${state.cal.bgPosition?.y ?? 50}%`,
                }} />
                <div className="cal-bg-overlay" />
              </div>
            )}
            <div className="cal-corner" />
            {weekDays.map((d, i) => (
              <div className="cal-day-head" key={i}>{WEEKDAY_CN[i]}<div className="cal-day-date">{d.getMonth() + 1}/{d.getDate()}</div></div>
            ))}
            <div className="cal-hours">
              {hourRows.map((h) => <div className="cal-hour-cell" key={h} style={{ height: HOUR_PX }}>{h}</div>)}
            </div>
            {weekDays.map((d, colIdx) => {
              const dayNum = colIdx + 1;
              const dayKey = toKey(d);
              // courses only render when this specific date falls within a semester's term range
              const daySemester = findSemesterForDate(semesters, d);
              const courses = daySemester ? daySemester.courses.filter((c) => c.day === dayNum) : [];
              const tutorials = daySemester
                ? daySemester.courses.filter((c) => c.tutorial && c.tutorial.day === dayNum && !(c.tutorial.cancelled || []).includes(dayKey))
                : [];
              const events = state.cal.events.filter((e) => e.date === dayKey);
              return (
                <div className="cal-col" key={colIdx} style={{ height: (HOUR_END - HOUR_START) * HOUR_PX }}>
                  {hourRows.map((h) => <div className="cal-col-line" key={h} style={{ height: HOUR_PX }} />)}
                  {courses.map((c) => {
                    const top = (timeToMinutes(c.start) - HOUR_START * 60) / 60 * HOUR_PX;
                    const height = Math.max(20, (timeToMinutes(c.end) - timeToMinutes(c.start)) / 60 * HOUR_PX);
                    const col = c.color || "#a97c7c";
                    return (
                      <div key={c.id} className="cal-block" style={{ top, height, background: hexToRgba(lightenHex(col, 0.45), 0.5) }} onClick={() => setAttendCourse(c)}>
                        <span className="cal-block-bar" style={{ background: col }} />
                        <span className="cal-block-content">
                          <span className="cal-block-title" style={{ fontSize: blockFont(height).title, lineHeight: blockFont(height).lh }}>{c.name}</span>
                          {blockFont(height).sub > 0 && <span className="cal-block-sub" style={{ fontSize: blockFont(height).sub }}>{c.start}–{c.end}{c.room ? ` · ${c.room}` : ""}</span>}
                        </span>
                      </div>
                    );
                  })}
                  {tutorials.map((c) => {
                    const t = c.tutorial;
                    const top = (timeToMinutes(t.start) - HOUR_START * 60) / 60 * HOUR_PX;
                    const height = Math.max(20, (timeToMinutes(t.end) - timeToMinutes(t.start)) / 60 * HOUR_PX);
                    const col = t.color || c.color || "#a97c7c";
                    return (
                      <div key={c.id + "__tutorial"} className="cal-block" style={{ top, height, background: hexToRgba(lightenHex(col, 0.45), 0.5) }} onClick={() => setAttendCourse(tutorialAsCourse(c))}>
                        <span className="cal-block-bar" style={{ background: col }} />
                        <span className="cal-block-content">
                          <span className="cal-block-title" style={{ fontSize: blockFont(height).title, lineHeight: blockFont(height).lh }}>{c.name}（輔導）</span>
                          {blockFont(height).sub > 0 && <span className="cal-block-sub" style={{ fontSize: blockFont(height).sub }}>{t.start}–{t.end}{(t.room || c.room) ? ` · ${t.room || c.room}` : ""}</span>}
                        </span>
                      </div>
                    );
                  })}
                  {events.map((e) => {
                    const top = (timeToMinutes(e.start) - HOUR_START * 60) / 60 * HOUR_PX;
                    const height = Math.max(20, (timeToMinutes(e.end || minutesToTime(timeToMinutes(e.start) + 30)) - timeToMinutes(e.start)) / 60 * HOUR_PX);
                    const col = e.color || "#a68bbf";
                    return (
                      <div key={e.id} className="cal-block event" style={{ top, height, background: hexToRgba(lightenHex(col, 0.45), 0.5) }}
                        onMouseDown={(ev) => onDragStart(ev, e)}
                        onClick={() => { setEditEvent(e); setModal("event"); }}>
                        <span className="cal-block-bar" style={{ background: col }} />
                        <span className="cal-block-content">
                          <span className="cal-block-title" style={{ fontSize: blockFont(height).title, lineHeight: blockFont(height).lh }}>{e.title}</span>
                          {blockFont(height).sub > 0 && <span className="cal-block-sub" style={{ fontSize: blockFont(height).sub }}>{e.start}–{e.end}</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
        <button className="fab" onClick={() => { setEditEvent(null); setModal("event"); }}><Plus size={26} /></button>
      </div>

      {editingChip === "start" && (
        <Modal title="開學日" onClose={() => setEditingChip(null)}>
          <div className="form-col">
            <Field label="開學日期"><input type="date" defaultValue={activeSemester.schoolYearStart}
              onChange={(e) => updateSemester(activeSemester.id, { schoolYearStart: e.target.value })} /></Field>
            <button className="btn-solid" onClick={() => setEditingChip(null)}>完成</button>
          </div>
        </Modal>
      )}
      {editingChip === "end" && (
        <Modal title="結業式日期" onClose={() => setEditingChip(null)}>
          <div className="form-col">
            <div className="bg-adjust-hint">這學期的課程只會在開學日到結業式之間顯示在行事曆表格上</div>
            <Field label="結業式日期"><input type="date" defaultValue={activeSemester.termEndDate}
              onChange={(e) => updateSemester(activeSemester.id, { termEndDate: e.target.value })} /></Field>
            <button className="btn-solid" onClick={() => setEditingChip(null)}>完成</button>
          </div>
        </Modal>
      )}
      {editingChip === "weeks" && (
        <Modal title="總週數" onClose={() => setEditingChip(null)}>
          <div className="form-col">
            <Field label="本學期總週數"><input type="number" defaultValue={activeSemester.totalWeeks}
              onChange={(e) => updateSemester(activeSemester.id, { totalWeeks: e.target.value })} /></Field>
            <button className="btn-solid" onClick={() => setEditingChip(null)}>完成</button>
          </div>
        </Modal>
      )}
      {modal === "bgAdjust" && state.cal.bgImage && (
        <Modal title="調整背景顯示範圍" onClose={() => setModal(null)}>
          <BgPositionAdjuster
            image={state.cal.bgImage}
            position={state.cal.bgPosition || { x: 50, y: 50 }}
            scale={state.cal.bgScale ?? 1}
            aspect={gridAspect}
            imgSaving={imgSaving}
            imgSaved={imgSaved}
            imgProgress={imgProgress}
            imgSaveError={imgSaveError}
            imgErrorDetail={imgErrorDetail}
            retryImageSave={retryImageSave}
            onChange={(pos) => setState((s) => ({ ...s, cal: { ...s.cal, bgPosition: pos } }))}
            onScaleChange={(sc) => setState((s) => ({ ...s, cal: { ...s.cal, bgScale: sc } }))}
            onDone={() => setModal(null)}
          />
        </Modal>
      )}
      {modal === "courses" && (
        <Modal title={`課表管理｜${yearTitle(activeSemester, state.cal.baseRocYear)}`} onClose={() => setModal(null)} wide>
          <button className="btn-outline" onClick={() => { setEditCourse(null); setModal("courseForm"); }}><Plus size={16} /> 新增課程</button>
          <div className="course-list">
            {activeSemester.courses.map((c) => (
              <div className="course-row" key={c.id}>
                <span className="color-dot" style={{ background: c.color }} />
                <span className="ellipsis">{c.name}（{WEEKDAY_FULL[c.day - 1]} {c.start}-{c.end}）{c.tutorial && <span className="chip-gray" style={{ marginLeft: 4, fontSize: 10, padding: "1px 6px" }}>輔導</span>}</span>
                <span className="row-actions">
                  <button className="icon-btn" onClick={() => { setEditCourse(c); setModal("courseForm"); }}><Pencil size={14} /></button>
                  <button className="icon-btn" onClick={() => deleteCourse(c.id)}><Trash2 size={14} /></button>
                </span>
              </div>
            ))}
            {activeSemester.courses.length === 0 && <div className="empty-hint">這個學期還沒有課程</div>}
          </div>
        </Modal>
      )}
      {modal === "courseForm" && (
        <Modal title={editCourse ? "編輯課程" : "新增課程"} onClose={() => setModal(null)}>
          <CourseForm course={editCourse} creditTypes={state.cal.creditTypes}
            onSave={(c) => { saveCourse(c); setModal("courses"); }} />
        </Modal>
      )}
      {modal === "credits" && (
        <Modal title="學分設定" onClose={() => setModal(null)} wide>
          <CreditSettings state={state} setState={setState} totalCredits={totalCredits} />
        </Modal>
      )}
      {modal === "event" && (
        <Modal title={editEvent ? "編輯行程" : "新增行程"} onClose={() => setModal(null)}>
          <EventForm event={editEvent} defaultDate={toKey(today)}
            onSave={(e) => { saveEvent(e); setModal(null); }}
            onDelete={editEvent ? () => { deleteEvent(editEvent.id); setModal(null); } : null} />
        </Modal>
      )}
      {attendCourse && (() => {
        const parentCourse = attendCourse.__parentCourseId
          ? semesters.flatMap((s) => s.courses).find((c) => c.id === attendCourse.__parentCourseId)
          : null;
        const sessionDates = parentCourse ? getTutorialSessionDates(parentCourse) : getCourseSessionDates(attendCourse);
        const cancelledDates = parentCourse ? (parentCourse.tutorial && parentCourse.tutorial.cancelled) || [] : null;
        return (
          <Modal title={attendCourse.name} onClose={() => setAttendCourse(null)} wide>
            <AttendancePanel course={attendCourse} data={state.cal.attendance[attendCourse.id]}
              sessionDates={sessionDates}
              cancelledDates={cancelledDates}
              onToggleCancel={parentCourse ? (dateKey) => toggleTutorialCancelled(parentCourse.id, dateKey) : null}
              onUpdate={(patch) => updateAttendance(attendCourse.id, patch)} />
          </Modal>
        );
      })()}
    </div>
  );
}

function CourseForm({ course, creditTypes, onSave }) {
  const [f, setF] = useState(course || { id: uid(), name: "", professor: "", code: "", room: "", credits: "", day: 1, start: "09:00", end: "10:00", color: "#a97c7c", creditType: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const hasTutorial = !!f.tutorial;
  function toggleTutorial(on) {
    if (on) {
      setF({ ...f, tutorial: { day: f.day, start: f.end, end: minutesToTime(timeToMinutes(f.end) + 60), color: f.color, cancelled: [] } });
    } else {
      setF({ ...f, tutorial: null });
    }
  }
  const setTutorial = (k) => (e) => setF({ ...f, tutorial: { ...f.tutorial, [k]: e.target.value } });
  return (
    <div className="form-col">
      <Field label="課程名稱"><input value={f.name} onChange={set("name")} /></Field>
      <Field label="教授"><input value={f.professor} onChange={set("professor")} /></Field>
      <Field label="課程代碼"><input value={f.code} onChange={set("code")} /></Field>
      <Field label="教室"><input value={f.room} onChange={set("room")} /></Field>
      <Field label="學分"><input type="number" value={f.credits} onChange={set("credits")} /></Field>
      {creditTypes.length > 0 && (
        <Field label="學分類別">
          <select value={f.creditType} onChange={set("creditType")}>
            <option value="">未分類</option>
            {creditTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="星期">
        <select value={f.day} onChange={(e) => setF({ ...f, day: Number(e.target.value) })}>
          {WEEKDAY_FULL.map((w, i) => <option key={i} value={i + 1}>{w}</option>)}
        </select>
      </Field>
      <div className="two-col">
        <Field label="開始時間"><input type="time" value={f.start} onChange={set("start")} /></Field>
        <Field label="結束時間"><input type="time" value={f.end} onChange={set("end")} /></Field>
      </div>
      <Field label="圖塊顏色"><input type="color" value={f.color} onChange={set("color")} /></Field>

      <div className="settings-row">
        <span className="settings-icon"><Clock size={16} /></span>
        <span>加開固定輔導課</span>
        <Toggle checked={hasTutorial} onChange={toggleTutorial} />
      </div>
      {hasTutorial && (
        <div className="form-col" style={{ paddingLeft: 12, borderLeft: "2px solid var(--pink-border)" }}>
          <div className="bg-adjust-hint">輔導課會固定在每週這個時段顯示在行事曆上，設定完後也可以在輔導課的出席紀錄裡，單獨取消其中某一週。</div>
          <Field label="星期">
            <select value={f.tutorial.day} onChange={(e) => setTutorial("day")({ target: { value: Number(e.target.value) } })}>
              {WEEKDAY_FULL.map((w, i) => <option key={i} value={i + 1}>{w}</option>)}
            </select>
          </Field>
          <div className="two-col">
            <Field label="開始時間"><input type="time" value={f.tutorial.start} onChange={setTutorial("start")} /></Field>
            <Field label="結束時間"><input type="time" value={f.tutorial.end} onChange={setTutorial("end")} /></Field>
          </div>
          <Field label="輔導課顏色"><input type="color" value={f.tutorial.color} onChange={setTutorial("color")} /></Field>
        </div>
      )}

      <button className="btn-solid" onClick={() => onSave(f)}>儲存課程</button>
    </div>
  );
}

const YEAR_LABELS = ["大一", "大二", "大三", "大四", "大五", "大六"];
// user-selectable app-wide font families (settings > 字體). "family" is a full CSS font-family
// value (with fallback) so it can be dropped straight into the --font-family CSS variable.
const FONT_FAMILY_OPTIONS = [
  { key: "rounded", label: "圓體", family: "'Zen Maru Gothic', sans-serif" },
  { key: "sans", label: "黑體", family: "'Noto Sans TC', sans-serif" },
  { key: "serif", label: "明體", family: "'Noto Serif TC', serif" },
  { key: "hand", label: "手寫體", family: "'Iansui', cursive" },
];
// converts a raw 0-100 score into grade points, matching the 計算方式 table exactly
function scoreToGpa(score) {
  const s = Number(score);
  if (isNaN(s)) return null;
  if (s >= 80) return 4.0;
  if (s >= 70) return 3.0;
  if (s >= 60) return 2.0;
  if (s >= 50) return 1.0;
  return 0.0;
}
const TERM_LABELS = ["上學期", "下學期", "暑修", "寒修"];
const TERM_SHORT = { "上學期": "上", "下學期": "下", "暑修": "暑", "寒修": "寒" };

function CreditSettings({ state, setState, totalCredits }) {
  const cal = state.cal;
  const [addingType, setAddingType] = useState(false);
  const [typeName, setTypeName] = useState("");
  const [typeReq, setTypeReq] = useState("");
  const [goalEdit, setGoalEdit] = useState(null); // creditType id currently being edited
  const [subModal, setSubModal] = useState(null); // 'picker' | 'add' | 'calc' | 'manage'
  const [newYear, setNewYear] = useState("大一");
  const [newTerm, setNewTerm] = useState("上學期");
  const [editingGoalTotal, setEditingGoalTotal] = useState(false);
  const [addingCourseFor, setAddingCourseFor] = useState(null);
  const [editingBaseYear, setEditingBaseYear] = useState(false);

  const rawSemesters = cal.semesters && cal.semesters.length ? cal.semesters : [{
    id: "default-sem", rocYear: getAcademicYear(new Date()).roc, sem: 1, yearLevel: "大一", term: "上學期",
    schoolYearStart: "", termEndDate: "", totalWeeks: "", courses: [],
  }];
  const semesters = rawSemesters.map((s) => (Array.isArray(s.courses) ? s : { ...s, courses: [] }));
  const activeSemester = semesters.find((s) => s.id === cal.activeSemesterId) || semesters[0];
  const activeSemesterLabel = yearTitle(activeSemester, cal.baseRocYear);
  const allCourses = semesters.flatMap((s) => s.courses || []);
  const PASS_SCORE = 60; // raw score at/above this counts as passing

  const earnedByType = {};
  allCourses.forEach((c) => {
    if (c.creditType && c.grade !== undefined && c.grade !== null && c.grade !== "" && Number(c.grade) >= PASS_SCORE) {
      earnedByType[c.creditType] = (earnedByType[c.creditType] || 0) + Number(c.credits || 0);
    }
  });

  const totalRequired = Number(cal.totalCreditsRequired || 0);
  // courses that already have a raw score entered - used for the GPA average (failing grades still pull it down)
  const gradedCourses = allCourses.filter((c) => c.grade !== undefined && c.grade !== null && c.grade !== "");
  const gradedCredits = gradedCourses.reduce((sum, c) => sum + Number(c.credits || 0), 0);
  const gpaWeightedSum = gradedCourses.reduce((sum, c) => sum + scoreToGpa(c.grade) * Number(c.credits || 0), 0);
  const overallGpa = gradedCredits > 0 ? (gpaWeightedSum / gradedCredits) : null;
  // "earned" credits (畢業進度/取得) only count courses that actually passed - failing grades don't count as obtained
  const passedCourses = gradedCourses.filter((c) => Number(c.grade) >= PASS_SCORE);
  const earnedCredits = passedCourses.reduce((sum, c) => sum + Number(c.credits || 0), 0);
  const progressPct = totalRequired > 0 ? Math.min(100, Math.round((earnedCredits / totalRequired) * 100)) : 0;
  const remaining = Math.max(totalRequired - earnedCredits, 0);

  // major GPA: only counts courses whose credit type is checked as "major" in 成績管理 (failing majors still count toward the average)
  const majorTypeIds = new Set(cal.creditTypes.filter((t) => t.isMajor !== false).map((t) => t.id));
  const majorGraded = gradedCourses.filter((c) => c.creditType && majorTypeIds.has(c.creditType));
  const majorCredits = majorGraded.reduce((sum, c) => sum + Number(c.credits || 0), 0);
  const majorGpaSum = majorGraded.reduce((sum, c) => sum + scoreToGpa(c.grade) * Number(c.credits || 0), 0);
  const majorGpa = majorCredits > 0 ? (majorGpaSum / majorCredits) : null;

  function addType() {
    if (!typeName.trim()) return;
    setState((s) => ({ ...s, cal: { ...s.cal, creditTypes: [...s.cal.creditTypes, { id: uid(), name: typeName.trim(), required: Number(typeReq) || 0, isMajor: true }] } }));
    setTypeName(""); setTypeReq(""); setAddingType(false);
  }
  function removeType(id) {
    setState((s) => ({ ...s, cal: { ...s.cal, creditTypes: s.cal.creditTypes.filter((t) => t.id !== id) } }));
  }
  function saveGoal(id, val) {
    setState((s) => ({ ...s, cal: { ...s.cal, creditTypes: s.cal.creditTypes.map((t) => t.id === id ? { ...t, required: Number(val) || 0 } : t) } }));
    setGoalEdit(null);
  }
  function toggleMajor(id) {
    setState((s) => ({ ...s, cal: { ...s.cal, creditTypes: s.cal.creditTypes.map((t) => t.id === id ? { ...t, isMajor: !(t.isMajor !== false) } : t) } }));
  }
  function updateCourseGrade(courseId, val) {
    setState((s) => ({
      ...s, cal: {
        ...s.cal,
        semesters: s.cal.semesters.map((sem) => ({
          ...sem,
          courses: sem.courses.some((c) => c.id === courseId) ? sem.courses.map((c) => c.id === courseId ? { ...c, grade: val } : c) : sem.courses,
        })),
      },
    }));
  }
  function addCourseToSemester(semesterId, course) {
    setState((s) => ({
      ...s, cal: {
        ...s.cal,
        semesters: s.cal.semesters.map((sem) => sem.id === semesterId ? { ...sem, courses: [...sem.courses, { id: uid(), ...course }] } : sem),
      },
    }));
  }
  function addSemester() {
    const existing = semesters.find((s) => s.yearLevel === newYear && s.term === newTerm);
    if (existing) {
      setState((s) => ({ ...s, cal: { ...s.cal, activeSemesterId: existing.id } }));
    } else {
      const id = uid();
      setState((s) => ({
        ...s,
        cal: {
          ...s.cal,
          semesters: [...(s.cal.semesters || semesters), {
            id, yearLevel: newYear, term: newTerm,
            schoolYearStart: "", termEndDate: "", totalWeeks: "", courses: [],
          }],
          activeSemesterId: id,
        },
      }));
    }
    setSubModal(null);
  }
  function reorderSemesters(next) {
    setState((s) => ({ ...s, cal: { ...s.cal, semesters: next } }));
  }
  function deleteSemester(id) {
    if (semesters.length <= 1) return; // always keep at least one semester
    const next = semesters.filter((s) => s.id !== id);
    setState((s) => ({
      ...s,
      cal: { ...s.cal, semesters: next, activeSemesterId: s.cal.activeSemesterId === id ? next[0].id : s.cal.activeSemesterId },
    }));
  }

  // circular ring geometry
  const R = 52, C = 2 * Math.PI * R;
  const dash = totalRequired > 0 ? (progressPct / 100) * C : 0;

  return (
    <div className="credit-settings-scroll">
      <div className="credit-top-bar">
        <button className="semester-chip" onClick={() => setSubModal("picker")}>
          {activeSemesterLabel} <ChevronDown size={14} />
        </button>
        <div className="credit-top-actions">
          <button className="icon-btn" onClick={() => setSubModal("add")} title="新增學期"><Plus size={18} /></button>
          <button className="icon-btn" onClick={() => setSubModal("calc")} title="計算方式"><HelpCircle size={18} /></button>
          <button className="icon-btn" onClick={() => setSubModal("manage")} title="成績管理"><Settings size={18} /></button>
        </div>
      </div>

      <div className="credit-top">
        <div className="credit-ring-wrap">
          <svg viewBox="0 0 120 120" className="credit-ring">
            <circle cx="60" cy="60" r={R} fill="none" stroke="var(--pink-border)" strokeWidth="10" />
            <circle cx="60" cy="60" r={R} fill="none" stroke="var(--accent)" strokeWidth="10"
              strokeDasharray={`${dash} ${C}`} strokeLinecap="round" transform="rotate(-90 60 60)" />
          </svg>
          <div className="credit-ring-center">
            <div className="credit-ring-num">{earnedCredits}</div>
            <div className="credit-ring-den">/{totalRequired || "—"}</div>
          </div>
        </div>
        <div className="credit-top-right">
          <div className="credit-progress-line">畢業進度 <b>{progressPct}%</b> · 還差 {remaining} 學分</div>
          <div className="credit-gpa-row">
            <div>
              <div className="credit-gpa-label">整體績點</div>
              <div className="credit-gpa-num">{overallGpa !== null ? overallGpa.toFixed(2) : "—"} <span className="credit-gpa-scale">/4.0</span></div>
            </div>
            <div>
              <div className="credit-gpa-label">主修績點</div>
              <div className="credit-gpa-num">{majorGpa !== null ? majorGpa.toFixed(2) : "—"}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="credit-section-head">
        <span>各領域學分</span>
        <button className="icon-btn" onClick={() => setAddingType(true)}><Plus size={16} /></button>
      </div>
      {addingType && (
        <div className="inline-add" style={{ marginBottom: 10 }}>
          <input placeholder="類型名稱，例如：系必修" value={typeName} onChange={(e) => setTypeName(e.target.value)} />
          <input placeholder="所需學分" type="number" style={{ width: 80, flex: "0 0 80px" }} value={typeReq} onChange={(e) => setTypeReq(e.target.value)} />
          <button className="btn-outline small" onClick={addType}><Check size={16} /></button>
        </div>
      )}
      <div className="credit-type-list">
        {cal.creditTypes.map((t) => {
          const earned = earnedByType[t.id] || 0;
          const pct = t.required > 0 ? Math.min(100, Math.round((earned / t.required) * 100)) : 0;
          return (
            <div className="credit-type-row" key={t.id}>
              <div className="credit-type-top">
                <span className="credit-type-name">{t.name}</span>
                {goalEdit === t.id ? (
                  <input type="number" autoFocus className="credit-goal-input" defaultValue={t.required}
                    onBlur={(e) => saveGoal(t.id, e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveGoal(t.id, e.target.value)} />
                ) : (
                  <button className="credit-goal-link" onClick={() => setGoalEdit(t.id)}>{earned} / {t.required} 設定目標</button>
                )}
                <button className="icon-btn" onClick={() => removeType(t.id)}><Trash2 size={13} /></button>
              </div>
              <div className="credit-type-bar-track">
                <div className="credit-type-bar-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
        {cal.creditTypes.length === 0 && <div className="empty-hint">尚未設定學分類型，點右上角 + 新增</div>}
      </div>

      <div className="semester-course-group">
        <div className="credit-section-head" style={{ marginTop: 18 }}>
          <span>{yearTitle(activeSemester, cal.baseRocYear)}（{activeSemester.courses.length} 門課程）</span>
          <button className="credit-goal-link" onClick={() => setAddingCourseFor(addingCourseFor === activeSemester.id ? null : activeSemester.id)}>
            <Plus size={13} /> 新增科目
          </button>
        </div>
        {addingCourseFor === activeSemester.id && (
          <QuickAddCourse
            creditTypes={cal.creditTypes}
            onAdd={(course) => { addCourseToSemester(activeSemester.id, course); setAddingCourseFor(null); }}
            onCancel={() => setAddingCourseFor(null)}
          />
        )}
        <div className="grade-table">
          <div className="grade-table-head">
            <span>科目名稱</span><span>學分</span><span>成績</span><span>類別</span>
          </div>
          {activeSemester.courses.map((c) => (
            <div className="grade-table-row" key={c.id}>
              <span className="ellipsis">{c.name}</span>
              <span>{c.credits || "—"}</span>
              <input className="grade-input" type="number" step="1" min="0" max="100"
                placeholder="—" value={c.grade ?? ""} onChange={(e) => updateCourseGrade(c.id, e.target.value)} />
              <span className="ellipsis">{(cal.creditTypes.find((t) => t.id === c.creditType) || {}).name || "未分類"}</span>
            </div>
          ))}
          {activeSemester.courses.length === 0 && <div className="empty-hint">這個學期還沒有課程</div>}
        </div>
      </div>

      {subModal === "picker" && (
        <Modal title="切換學期" onClose={() => setSubModal(null)}>
          <div className="bg-adjust-hint" style={{ marginBottom: 8 }}>長按項目可拖曳調整順序</div>
          <SemesterPickerList
            semesters={semesters}
            activeId={activeSemester.id}
            baseRocYear={cal.baseRocYear}
            onSelect={(id) => { setState((st) => ({ ...st, cal: { ...st.cal, activeSemesterId: id } })); setSubModal(null); }}
            onReorder={reorderSemesters}
            onDelete={deleteSemester}
          />
        </Modal>
      )}

      {subModal === "add" && (
        <Modal title="新增學期" onClose={() => setSubModal(null)}>
          <div className="bg-adjust-hint" style={{ marginBottom: 10 }}>記錄暑修、寒修或大五以上的學期</div>
          <div className="field-label">學年</div>
          <div className="pill-choice-row">
            {YEAR_LABELS.map((y) => (
              <button key={y} className={"pill-choice" + (newYear === y ? " on" : "")} onClick={() => setNewYear(y)}>{y}</button>
            ))}
          </div>
          <div className="field-label" style={{ marginTop: 12 }}>學期</div>
          <div className="pill-choice-row">
            {TERM_LABELS.map((t) => (
              <button key={t} className={"pill-choice" + (newTerm === t ? " on" : "")} onClick={() => setNewTerm(t)}>{t}</button>
            ))}
          </div>
          <button className="btn-solid" style={{ marginTop: 16, width: "100%" }} onClick={addSemester}>
            新增 {newYear}{TERM_SHORT[newTerm]}
          </button>
        </Modal>
      )}

      {subModal === "calc" && (
        <Modal title="計算方式" onClose={() => setSubModal(null)} wide>
          <div className="bg-adjust-hint" style={{ marginBottom: 10 }}>本系統採用的分數對照表</div>
          <div className="calc-table">
            <div className="calc-table-head"><span>分數</span><span>等第</span><span>績點</span></div>
            {[["80–100", "A", "4.0"], ["70–79", "B", "3.0"], ["60–69", "C", "2.0"], ["50–59", "D", "1.0", true], ["0–49", "E", "0.0", true]].map(([range, letter, gpa, warn], i) => (
              <div className="calc-table-row" key={i}>
                <span>{range}</span><span className={warn ? "calc-warn" : ""}>{letter}</span><span className={warn ? "calc-warn" : ""}>{gpa}</span>
              </div>
            ))}
          </div>
          <div className="calc-formula-box">
            <div className="bg-adjust-hint">學期績點計算</div>
            <div className="calc-formula">Σ(績點 × 學分) ÷ Σ學分</div>
          </div>
          <ul className="calc-notes">
            <li>及格為 60 分，取得學分＝及格科目學分合計</li>
            <li>不及格科目仍會計入績點平均</li>
            <li>主修績點僅計入「成績管理」中勾選為主修的領域</li>
          </ul>
          <div className="bg-adjust-hint">本計算僅供參考，實際成績以學校公告為準。</div>
        </Modal>
      )}

      {subModal === "manage" && (
        <Modal title="成績管理" onClose={() => setSubModal(null)} wide>
          <div className="manage-goal-row">
            <span>大一上學年度綁定</span>
            {editingBaseYear ? (
              <input type="number" autoFocus className="credit-goal-input" defaultValue={cal.baseRocYear}
                onBlur={(e) => { setState((s) => ({ ...s, cal: { ...s.cal, baseRocYear: Number(e.target.value) || null } })); setEditingBaseYear(false); }}
                onKeyDown={(e) => e.key === "Enter" && e.target.blur()} />
            ) : (
              <button className="manage-goal-value" onClick={() => setEditingBaseYear(true)}>
                {cal.baseRocYear != null ? `${cal.baseRocYear} 學年度` : "尚未設定"} <Pencil size={13} />
              </button>
            )}
          </div>
          <div className="bg-adjust-hint" style={{ marginBottom: 12 }}>設定大一上學期是民國幾學年度，其他學期（大一下、大二上…）會自動依此推算</div>
          <div className="manage-goal-row">
            <span>畢業學分目標</span>
            {editingGoalTotal ? (
              <input type="number" autoFocus className="credit-goal-input" defaultValue={cal.totalCreditsRequired}
                onBlur={(e) => { setState((s) => ({ ...s, cal: { ...s.cal, totalCreditsRequired: e.target.value } })); setEditingGoalTotal(false); }}
                onKeyDown={(e) => e.key === "Enter" && e.target.blur()} />
            ) : (
              <button className="manage-goal-value" onClick={() => setEditingGoalTotal(true)}>
                {earnedCredits} / {totalRequired || "—"} <Pencil size={13} />
              </button>
            )}
          </div>
          <div className="credit-section-head" style={{ marginTop: 16 }}>
            <span>各領域目標</span>
            <button className="credit-goal-link" onClick={() => setAddingType(true)}>+ 新增領域</button>
          </div>
          <div className="bg-adjust-hint" style={{ marginBottom: 8 }}>勾選的領域將計入主修績點</div>
          <div className="manage-type-list">
            {cal.creditTypes.map((t) => (
              <div className="manage-type-row" key={t.id}>
                <button className={"manage-checkbox" + (t.isMajor !== false ? " on" : "")} onClick={() => toggleMajor(t.id)}>
                  {t.isMajor !== false && <Check size={13} />}
                </button>
                <span className="ellipsis manage-type-name">{t.name}</span>
                <span className="manage-type-num">{t.required}</span>
                {goalEdit === `m-${t.id}` ? (
                  <input type="number" autoFocus className="credit-goal-input" defaultValue={t.required}
                    onBlur={(e) => saveGoal(t.id, e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveGoal(t.id, e.target.value)} />
                ) : (
                  <button className="icon-btn" onClick={() => setGoalEdit(`m-${t.id}`)}><Pencil size={14} /></button>
                )}
                <button className="icon-btn" onClick={() => removeType(t.id)}><Trash2 size={14} /></button>
              </div>
            ))}
            {cal.creditTypes.length === 0 && <div className="empty-hint">尚未設定領域</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}

function QuickAddCourse({ creditTypes, onAdd, onCancel }) {
  const [name, setName] = useState("");
  const [credits, setCredits] = useState("");
  const [creditType, setCreditType] = useState("");
  const [day, setDay] = useState(1);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [color, setColor] = useState("#a97c7c");
  function submit() {
    if (!name.trim()) return;
    onAdd({ name: name.trim(), credits: Number(credits) || 0, creditType: creditType || null, day, start, end, color });
    setName(""); setCredits(""); setCreditType("");
  }
  return (
    <div className="quick-add-course">
      <div className="quick-add-row">
        <input placeholder="科目名稱" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="學分" type="number" style={{ width: 56, flex: "0 0 56px" }} value={credits} onChange={(e) => setCredits(e.target.value)} />
      </div>
      <div className="quick-add-row">
        <select value={creditType} onChange={(e) => setCreditType(e.target.value)} style={{ flex: "1 1 90px" }}>
          <option value="">未分類</option>
          {creditTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={day} onChange={(e) => setDay(Number(e.target.value))} style={{ flex: "1 1 70px" }}>
          {WEEKDAY_FULL.map((w, i) => <option key={i} value={i + 1}>{w}</option>)}
        </select>
      </div>
      <div className="quick-add-row">
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 40, flex: "0 0 40px" }} />
      </div>
      <div className="bg-adjust-hint">設定星期與時間後，這堂課會顯示在行事曆表格上</div>
      <div className="two-col">
        <button className="btn-outline" onClick={onCancel}>取消</button>
        <button className="btn-solid" onClick={submit}>新增</button>
      </div>
    </div>
  );
}

function SemesterPickerList({ semesters, activeId, baseRocYear, onSelect, onReorder, onDelete }) {
  const [order, setOrder] = useState(semesters);
  useEffect(() => { setOrder(semesters); }, [semesters]);
  const orderRef = useRef(order);
  useEffect(() => { orderRef.current = order; }, [order]);
  const onReorderRef = useRef(onReorder);
  useEffect(() => { onReorderRef.current = onReorder; }, [onReorder]);
  const rowRefs = useRef([]);
  const dragState = useRef(null); // {index, startY, longPressTimer, active}
  const [draggingId, setDraggingId] = useState(null);

  function getRowCenters() {
    return rowRefs.current.map((el) => {
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    });
  }

  function onPointerDown(e, index) {
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const startX = e.touches ? e.touches[0].clientX : e.clientX;
    const st = { index, startY: clientY, startX, moved: false, active: false };
    dragState.current = st;
    st.longPressTimer = setTimeout(() => {
      if (!dragState.current) return;
      dragState.current.active = true;
      setDraggingId(orderRef.current[index].id);
    }, 380);
  }
  // listeners are attached once and always read/write via refs, so mid-drag reorders
  // never tear down and re-subscribe the touchmove listener (which was silently breaking the drag)
  useEffect(() => {
    function handleMove(e) {
      const st = dragState.current;
      if (!st) return;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      if (!st.active) {
        if (Math.abs(clientY - st.startY) > 8 || Math.abs(clientX - st.startX) > 8) {
          clearTimeout(st.longPressTimer);
          dragState.current = null;
        }
        return;
      }
      e.preventDefault && e.preventDefault();
      const centers = getRowCenters();
      let targetIdx = st.index;
      let best = Infinity;
      centers.forEach((c, i) => { const d = Math.abs(c - clientY); if (d < best) { best = d; targetIdx = i; } });
      if (targetIdx !== st.index) {
        const prev = orderRef.current;
        const next = [...prev];
        const [item] = next.splice(st.index, 1);
        next.splice(targetIdx, 0, item);
        orderRef.current = next;
        setOrder(next);
        st.index = targetIdx;
      }
    }
    function handleUp() {
      const st = dragState.current;
      if (st) {
        clearTimeout(st.longPressTimer);
        if (st.active) onReorderRef.current(orderRef.current);
      }
      dragState.current = null;
      setDraggingId(null);
    }
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("touchmove", handleMove, { passive: false });
    window.addEventListener("touchend", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("touchmove", handleMove);
      window.removeEventListener("touchend", handleUp);
    };
  }, []);

  return (
    <div className="semester-pick-list">
      {order.map((s, i) => (
        <div key={s.id} ref={(el) => (rowRefs.current[i] = el)}
          className={"semester-pick-row" + (s.id === activeId ? " active" : "") + (draggingId === s.id ? " dragging" : "")}
          onMouseDown={(e) => onPointerDown(e, i)}
          onTouchStart={(e) => onPointerDown(e, i)}>
          <button className="semester-pick-label" onClick={() => { if (!draggingId) onSelect(s.id); }}>
            {yearTitle(s, baseRocYear)}
          </button>
          <button className="icon-btn" disabled={order.length <= 1} onClick={() => onDelete(s.id)} title="刪除"><Trash2 size={15} /></button>
        </div>
      ))}
    </div>
  );
}

function EventForm({ event, defaultDate, onSave, onDelete }) {
  const [f, setF] = useState(event || { id: uid(), title: "", date: defaultDate, start: "09:00", end: "10:00", note: "", color: "#a68bbf" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="form-col">
      <Field label="標題"><input value={f.title} onChange={set("title")} /></Field>
      <Field label="日期"><input type="date" value={f.date} onChange={set("date")} /></Field>
      <div className="two-col">
        <Field label="開始時間"><input type="time" value={f.start} onChange={set("start")} /></Field>
        <Field label="結束時間"><input type="time" value={f.end} onChange={set("end")} /></Field>
      </div>
      <Field label="備註"><input value={f.note} onChange={set("note")} /></Field>
      <Field label="圖塊顏色"><input type="color" value={f.color} onChange={set("color")} /></Field>
      <div className="two-col">
        <button className="btn-solid" onClick={() => onSave(f)}>儲存</button>
        {onDelete && <button className="btn-outline" onClick={onDelete}>刪除</button>}
      </div>
    </div>
  );
}

function AssignmentForm({ item, courseOptions, onSave, onDelete }) {
  const [f, setF] = useState(item || {
    id: uid(), name: "", course: "", dueDate: "", dueTime: "", note: "", fileLink: "",
    addToCalendar: false, calDate: toKey(new Date()), calStart: "09:00", calEnd: "10:00", color: "#7d97ab",
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  // if the saved course isn't in the current course list (e.g. it was renamed/removed since), keep
  // showing it as an option so the select doesn't silently blank out an existing selection
  const options = f.course && !courseOptions.includes(f.course) ? [f.course, ...courseOptions] : courseOptions;
  return (
    <div className="form-col">
      <Field label="作業名稱"><input value={f.name} onChange={set("name")} /></Field>
      <Field label="課程">
        <select value={f.course} onChange={set("course")}>
          <option value="">（不指定課程）</option>
          {options.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </Field>
      <div className="two-col">
        <Field label="截止日期"><input type="date" value={f.dueDate} onChange={set("dueDate")} /></Field>
        <Field label="截止時間（選填）">
          <OptionalTimeField value={f.dueTime} onChange={(v) => setF({ ...f, dueTime: v })} />
        </Field>
      </div>
      <Field label="備註"><input value={f.note} onChange={set("note")} /></Field>
      <Field label="檔案連結"><input type="url" value={f.fileLink} onChange={set("fileLink")} placeholder="https://..." /></Field>
      <div className="settings-row">
        <span className="settings-icon"><CalendarDays size={16} /></span>
        <span>加入行事曆</span>
        <Toggle checked={!!f.addToCalendar} onChange={(v) => setF({ ...f, addToCalendar: v })} />
      </div>
      {f.addToCalendar && (
        <div className="form-col" style={{ paddingLeft: 12, borderLeft: "2px solid var(--pink-border)" }}>
          <div className="bg-adjust-hint">這裡的時間是行事曆上顯示的時段，跟上面的截止日期/時間是分開的，可以自由填寫，例如打算什麼時候動手寫這份作業。</div>
          <Field label="日期"><input type="date" value={f.calDate} onChange={set("calDate")} /></Field>
          <div className="two-col">
            <Field label="開始時間"><input type="time" value={f.calStart} onChange={set("calStart")} /></Field>
            <Field label="結束時間"><input type="time" value={f.calEnd} onChange={set("calEnd")} /></Field>
          </div>
          <Field label="圖塊顏色"><input type="color" value={f.color} onChange={set("color")} /></Field>
        </div>
      )}
      <div className="two-col">
        <button className="btn-solid" onClick={() => onSave(f)}>儲存</button>
        {onDelete && <button className="btn-outline" onClick={onDelete}>刪除</button>}
      </div>
    </div>
  );
}

function ExamForm({ item, courseOptions, onSave, onDelete }) {
  const [f, setF] = useState(item || { id: uid(), name: "", course: "", date: "", start: "", end: "", note: "", addToCalendar: false, color: "#c9896a" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const options = f.course && !courseOptions.includes(f.course) ? [f.course, ...courseOptions] : courseOptions;
  return (
    <div className="form-col">
      <Field label="考試名稱"><input value={f.name} onChange={set("name")} /></Field>
      <Field label="課程">
        <select value={f.course} onChange={set("course")}>
          <option value="">（不指定課程）</option>
          {options.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </Field>
      <Field label="日期"><input type="date" value={f.date} onChange={set("date")} /></Field>
      <div className="two-col">
        <Field label="開始時間（選填）">
          <OptionalTimeField value={f.start} onChange={(v) => setF({ ...f, start: v })} />
        </Field>
        <Field label="結束時間（選填）">
          <OptionalTimeField value={f.end} onChange={(v) => setF({ ...f, end: v })} />
        </Field>
      </div>
      <Field label="備註"><input value={f.note} onChange={set("note")} /></Field>
      <div className="settings-row">
        <span className="settings-icon"><CalendarDays size={16} /></span>
        <span>加入行事曆</span>
        <Toggle checked={!!f.addToCalendar} onChange={(v) => setF({ ...f, addToCalendar: v })} />
      </div>
      {f.addToCalendar && (
        <Field label="圖塊顏色"><input type="color" value={f.color} onChange={set("color")} /></Field>
      )}
      <div className="two-col">
        <button className="btn-solid" onClick={() => onSave(f)}>儲存</button>
        {onDelete && <button className="btn-outline" onClick={onDelete}>刪除</button>}
      </div>
    </div>
  );
}

function TodoForm({ item, onSave, onDelete }) {
  const [f, setF] = useState(item || {
    id: uid(), title: "", subitems: [], note: "", done: false,
    dueDate: "", dueTime: "",
    scheduled: false, date: toKey(new Date()), start: "09:00", end: "10:00", color: "#7d97ab",
  });
  const [newSub, setNewSub] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function addSubitem() {
    if (!newSub.trim()) return;
    setF({ ...f, subitems: [...(f.subitems || []), { id: uid(), text: newSub.trim(), done: false }] });
    setNewSub("");
  }
  function toggleSubitem(id) {
    setF({ ...f, subitems: f.subitems.map((si) => si.id === id ? { ...si, done: !si.done } : si) });
  }
  function removeSubitem(id) {
    setF({ ...f, subitems: f.subitems.filter((si) => si.id !== id) });
  }
  function toggleScheduled(on) {
    setF({ ...f, scheduled: on });
  }

  return (
    <div className="form-col">
      <Field label="事項名稱"><input value={f.title} onChange={set("title")} /></Field>

      <Field label="細項">
        <div className="form-col" style={{ gap: 6 }}>
          {(f.subitems || []).map((si) => (
            <div className="two-col" key={si.id} style={{ gridTemplateColumns: "auto 1fr auto", alignItems: "center" }}>
              <input type="checkbox" checked={!!si.done} onChange={() => toggleSubitem(si.id)} />
              <span style={{ textDecoration: si.done ? "line-through" : "none", opacity: si.done ? 0.6 : 1 }}>{si.text}</span>
              <button className="icon-btn" onClick={() => removeSubitem(si.id)}><X size={14} /></button>
            </div>
          ))}
          <div className="inline-add">
            <input placeholder="輸入細項後按新增" value={newSub} onChange={(e) => setNewSub(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSubitem()} />
            <button className="btn-outline" onClick={addSubitem}><Plus size={14} /></button>
          </div>
        </div>
      </Field>

      <Field label="備註"><input value={f.note} onChange={set("note")} /></Field>

      <div className="two-col">
        <Field label="截止日期（選填）"><input type="date" value={f.dueDate} onChange={set("dueDate")} /></Field>
        <Field label="截止時間（選填）">
          <OptionalTimeField value={f.dueTime} onChange={(v) => setF({ ...f, dueTime: v })} />
        </Field>
      </div>
      {f.dueDate && (
        <button className="btn-outline" onClick={() => setF({ ...f, dueDate: "", dueTime: "" })}>清除截止日期</button>
      )}

      <div className="settings-row">
        <span className="settings-icon"><CalendarDays size={16} /></span>
        <span>安排進行事曆</span>
        <Toggle checked={f.scheduled} onChange={toggleScheduled} />
      </div>
      {f.scheduled && (
        <div className="form-col" style={{ paddingLeft: 12, borderLeft: "2px solid var(--pink-border)" }}>
          <Field label="日期"><input type="date" value={f.date} onChange={set("date")} /></Field>
          <div className="two-col">
            <Field label="開始時間"><input type="time" value={f.start} onChange={set("start")} /></Field>
            <Field label="結束時間"><input type="time" value={f.end} onChange={set("end")} /></Field>
          </div>
          <Field label="圖塊顏色"><input type="color" value={f.color} onChange={set("color")} /></Field>
        </div>
      )}

      <div className="two-col">
        <button className="btn-solid" onClick={() => onSave(f)}>儲存</button>
        {onDelete && <button className="btn-outline" onClick={onDelete}>刪除</button>}
      </div>
    </div>
  );
}

function AttendancePanel({ course, data, sessionDates, cancelledDates, onToggleCancel, onUpdate }) {
  const d = data || { records: {}, notes: [] };
  const records = d.records || {};
  const notes = d.notes || [];
  const [tab, setTab] = useState("record");
  const [note, setNote] = useState("");
  const STATUS = [["present", "出席"], ["late", "遲到"], ["absent", "曠課"], ["leave", "請假"], ["cancelled", "停課"]];

  const counts = { present: 0, late: 0, absent: 0, leave: 0 };
  Object.entries(records).forEach(([dateKey, st]) => {
    if (cancelledDates && cancelledDates.includes(dateKey)) return; // a cancelled week never counts toward attendance
    if (counts[st] !== undefined) counts[st]++;
  });

  function setStatus(dateKey, status) {
    const next = { ...records };
    if (next[dateKey] === status) delete next[dateKey]; else next[dateKey] = status;
    onUpdate({ records: next });
  }
  function addNote() {
    if (!note.trim()) return;
    onUpdate({ notes: [...notes, { id: uid(), date: toKey(new Date()), text: note.trim() }] });
    setNote("");
  }

  const metaLine1 = [course.professor, course.credits ? `${course.credits} 學分` : "", course.code].filter(Boolean).join(" · ");

  return (
    <div>
      <div className="course-meta">
        {metaLine1 && <div className="course-meta-line">{metaLine1}</div>}
        <div className="course-meta-line">
          <span className="course-meta-day">{WEEKDAY_CN[course.day - 1]}</span>
          {course.start}–{course.end}{course.room ? ` · ${course.room}` : ""}
        </div>
      </div>
      <div className="attend-tabs">
        <button className={"attend-tab" + (tab === "record" ? " active" : "")} onClick={() => setTab("record")}>出缺</button>
        <button className={"attend-tab" + (tab === "notes" ? " active" : "")} onClick={() => setTab("notes")}>筆記</button>
      </div>

      {tab === "record" ? (
        <>
          <div className="attend-summary">
            {[["出席", counts.present], ["遲到", counts.late], ["曠課", counts.absent], ["請假", counts.leave]].map(([label, count]) => (
              <div className="attend-summary-cell" key={label}>
                <div className="attend-summary-num">{count}</div>
                <div className="attend-summary-label">{label}</div>
              </div>
            ))}
          </div>
          <div className="session-list-head">
            <span>各堂紀錄</span><span className="session-hint">點按修改</span>
          </div>
          <div className="session-list">
            {sessionDates.length === 0 && (
              <div className="empty-hint">請先在課表頁上方設定「開學日」與「總週數」，系統才能自動列出這堂課每一次上課的日期</div>
            )}
            {sessionDates.map((sd, i) => {
              const key = toKey(sd);
              const status = records[key];
              const isCancelled = cancelledDates && cancelledDates.includes(key);
              return (
                <div className={"session-row" + (isCancelled ? " session-row-cancelled" : "")} key={key}>
                  <div className="session-date-row">
                    <span className="session-date">{sd.getMonth() + 1}月{sd.getDate()}日（{WEEKDAY_CN[course.day - 1]}）</span>
                    <span className="session-week">第 {i + 1} 週</span>
                    {onToggleCancel && (
                      <button className={"session-cancel-btn" + (isCancelled ? " on" : "")} onClick={() => onToggleCancel(key)}>
                        {isCancelled ? "已取消，點擊恢復" : "取消本週"}
                      </button>
                    )}
                  </div>
                  {isCancelled ? (
                    <div className="session-cancelled-hint">本週輔導課已取消</div>
                  ) : (
                    <div className="session-buttons">
                      {STATUS.map(([k, label]) => (
                        <button key={k} className={"session-btn" + (status === k ? " on" : "")} onClick={() => setStatus(key, k)}>{label}</button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="inline-add">
            <input placeholder="輸入今天的筆記" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addNote()} />
            <button className="btn-outline small" onClick={addNote}><Plus size={16} /></button>
          </div>
          <div className="notes-list">
            {[...notes].reverse().map((n) => (
              <div key={n.id} className="note-row"><span className="note-date">{n.date}</span>{n.text}</div>
            ))}
            {notes.length === 0 && <div className="empty-hint">尚無筆記</div>}
          </div>
        </>
      )}
    </div>
  );
}

function BgPositionAdjuster({ image, position, scale, aspect, imgSaving, imgSaved, imgProgress, imgSaveError, imgErrorDetail, retryImageSave, onChange, onScaleChange, onDone }) {
  const areaRef = useRef(null);
  const dragRef = useRef(null);
  const pinchRef = useRef(null);
  const [justReset, setJustReset] = useState(false);
  function handleReset() {
    // clear any in-progress drag/pinch tracking first, in case this is pressed right after
    // dragging the photo, so a stray touchmove can't immediately re-apply the old position
    dragRef.current = null;
    pinchRef.current = null;
    onChange({ x: 50, y: 50 });
    onScaleChange(1);
    setJustReset(true);
    setTimeout(() => setJustReset(false), 1200);
  }
  function dist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function startDrag(clientX, clientY) {
    dragRef.current = { startX: clientX, startY: clientY, origX: position.x, origY: position.y };
  }
  useEffect(() => {
    function move(clientX, clientY) {
      if (!dragRef.current || !areaRef.current) return;
      const rect = areaRef.current.getBoundingClientRect();
      const dx = clientX - dragRef.current.startX;
      const dy = clientY - dragRef.current.startY;
      let nx = dragRef.current.origX - (dx / rect.width) * 100;
      let ny = dragRef.current.origY - (dy / rect.height) * 100;
      nx = Math.max(0, Math.min(100, nx));
      ny = Math.max(0, Math.min(100, ny));
      onChange({ x: nx, y: ny });
    }
    function mouseMove(e) { move(e.clientX, e.clientY); }
    function touchMove(e) {
      if (pinchRef.current && e.touches.length === 2) {
        e.preventDefault();
        const newDist = dist(e.touches);
        let ns = pinchRef.current.origScale * (newDist / pinchRef.current.startDist);
        ns = Math.max(1, Math.min(4, ns));
        onScaleChange(ns);
      } else if (dragRef.current && e.touches.length === 1) {
        e.preventDefault();
        move(e.touches[0].clientX, e.touches[0].clientY);
      }
    }
    function up(e) {
      if (e.touches && e.touches.length > 0) {
        if (e.touches.length === 1) { pinchRef.current = null; startDrag(e.touches[0].clientX, e.touches[0].clientY); }
      } else {
        dragRef.current = null; pinchRef.current = null;
      }
    }
    window.addEventListener("mousemove", mouseMove);
    window.addEventListener("mouseup", up);
    window.addEventListener("touchmove", touchMove, { passive: false });
    window.addEventListener("touchend", up);
    window.addEventListener("touchcancel", up);
    return () => {
      window.removeEventListener("mousemove", mouseMove);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchmove", touchMove);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
    };
  }, [position, scale, onChange, onScaleChange]);

  function handleTouchStart(e) {
    if (e.touches.length === 2) {
      dragRef.current = null;
      pinchRef.current = { startDist: dist(e.touches), origScale: scale };
    } else if (e.touches.length === 1) {
      pinchRef.current = null;
      startDrag(e.touches[0].clientX, e.touches[0].clientY);
    }
  }

  return (
    <div className="form-col">
      <div className="bg-adjust-hint">單指拖曳可移動照片位置，雙指開合可縮放；預覽比例與行事曆表格一致</div>
      <div className="bg-adjust-area" ref={areaRef} style={{ aspectRatio: aspect || 0.5, height: "min(55vh, 380px)", width: "auto" }}
        onMouseDown={(e) => startDrag(e.clientX, e.clientY)}
        onTouchStart={handleTouchStart}>
        <img className="cal-bg-layer" src={image} alt="" style={{
          width: `${scale * 100}%`,
          height: `${scale * 100}%`,
          left: `${(100 - scale * 100) / 2}%`,
          top: `${(100 - scale * 100) / 2}%`,
          objectPosition: `${position.x}% ${position.y}%`,
        }} />
      </div>
      <div className="bg-adjust-hint" style={{ textAlign: "center" }}>目前縮放：{scale.toFixed(1)}x</div>
      <div className="bg-adjust-hint" style={{ textAlign: "center", fontWeight: 700 }}>
        {imgSaving
          ? "儲存中… 請稍候再關閉"
          : imgSaveError ? "✗ 儲存失敗" : imgSaved ? "✓ 已儲存，可以放心關閉" : "尚未儲存"}
      </div>
      {imgSaveError && !imgSaving && imgErrorDetail && (
        <div className="bg-adjust-hint" style={{ textAlign: "center", color: "#b95c5c", userSelect: "text", wordBreak: "break-word" }}>
          {imgErrorDetail}
        </div>
      )}
      {imgSaveError && !imgSaving && (
        <button className="btn-outline" onClick={retryImageSave}>清除暫存並重試</button>
      )}
      {justReset && <div className="bg-adjust-hint" style={{ textAlign: "center", color: "var(--accent)" }}>✓ 已重設位置與縮放</div>}
      <div className="two-col">
        <button className="btn-outline" onClick={handleReset}>重設</button>
        <button className="btn-solid" onClick={onDone}>完成</button>
      </div>
    </div>
  );
}

/* ============================== PERIOD PAGE ============================== */

function PeriodPage({ state, setState, today }) {
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [pendingStart, setPendingStart] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null); // {type: 'start'|'end'|'delete', dateKey, range}
  const ranges = state.period.ranges;

  function isInRange(dateKey) {
    return ranges.some((r) => r.start <= dateKey && dateKey <= r.end);
  }
  function rangeOwning(dateKey) {
    return ranges.find((r) => r.start <= dateKey && dateKey <= r.end);
  }
  function fmtShort(dateKey) { return dateKey.slice(5).replace("-", "/"); }

  function handleClickDay(dateKey) {
    const owning = rangeOwning(dateKey);
    if (owning) {
      setConfirmAction({ type: "delete", dateKey, range: owning });
      return;
    }
    if (pendingStart === null) {
      setConfirmAction({ type: "start", dateKey });
    } else {
      setConfirmAction({ type: "end", dateKey });
    }
  }

  function confirmYes() {
    if (!confirmAction) return;
    if (confirmAction.type === "delete") {
      setState((s) => ({ ...s, period: { ...s.period, ranges: s.period.ranges.filter((r) => r !== confirmAction.range) } }));
      setPendingStart(null);
    } else if (confirmAction.type === "start") {
      setPendingStart(confirmAction.dateKey);
    } else if (confirmAction.type === "end") {
      let start = pendingStart, end = confirmAction.dateKey;
      if (end < start) { [start, end] = [end, start]; }
      setState((s) => ({ ...s, period: { ...s.period, ranges: [...s.period.ranges, { start, end }] } }));
      setPendingStart(null);
    }
    setConfirmAction(null);
  }
  function confirmNo() { setConfirmAction(null); }

  const sortedRanges = [...ranges].sort((a, b) => a.start < b.start ? -1 : 1);
  let avgCycle = 0, avgLength = 0, nextStart = "";
  if (sortedRanges.length > 0) {
    const lengths = sortedRanges.map((r) => (new Date(r.end) - new Date(r.start)) / 86400000 + 1);
    avgLength = Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);
    if (sortedRanges.length > 1) {
      const gaps = [];
      for (let i = 1; i < sortedRanges.length; i++) {
        gaps.push((new Date(sortedRanges[i].start) - new Date(sortedRanges[i - 1].start)) / 86400000);
      }
      avgCycle = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
    }
    const last = sortedRanges[sortedRanges.length - 1];
    if (avgCycle > 0) {
      const nd = addDays(new Date(last.start), avgCycle);
      nextStart = toKey(nd);
    }
  }

  const y = viewDate.getFullYear(), m = viewDate.getMonth();
  const dim = daysInMonth(y, m);
  const firstWeekday = (new Date(y, m, 1).getDay() + 6) % 7;
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: dim }, (_, i) => i + 1)];

  return (
    <div className="page">
      <TopHeader title={<span className="month-switch">
        <span>{y}年{m + 1}月</span>
        <button className="icon-btn" onClick={() => setViewDate(new Date(y, m - 1, 1))}><ChevronLeft size={18} /></button>
        <button className="icon-btn" onClick={() => setViewDate(new Date(y, m + 1, 1))}><ChevronRight size={18} /></button>
      </span>} dateObj={today} />
      <div className="page-body">
        <PinkPanel>
          <div className="finance-left" style={{ width: "100%" }}>
            <div className="finance-row"><span>預計下次開始日</span><span className="finance-pill">{nextStart || "尚無足夠資料"}</span></div>
            <div className="finance-row"><span>平均週期</span><span className="finance-pill">{avgCycle ? `${avgCycle} 天` : "—"}</span></div>
            <div className="finance-row"><span>平均經期長度</span><span className="finance-pill">{avgLength ? `${avgLength} 天` : "—"}</span></div>
          </div>
        </PinkPanel>
        <div className="period-cal">
          <div className="period-cal-head">
            {WEEKDAY_FULL.map((w) => <div key={w}>{w.replace("星期", "")}</div>)}
          </div>
          <div className="period-cal-grid">
            {cells.map((day, i) => {
              if (day === null) return <div key={i} className="period-day empty" />;
              const dateKey = `${y}-${pad2(m + 1)}-${pad2(day)}`;
              const marked = isInRange(dateKey);
              const isPending = pendingStart === dateKey;
              return (
                <button key={i} className={"period-day" + (marked ? " marked" : "") + (isPending ? " pending" : "")}
                  onClick={() => handleClickDay(dateKey)}>
                  {day}
                  {marked && <span className="period-underline" />}
                </button>
              );
            })}
          </div>
          {pendingStart && (
            <div className="empty-hint">
              已選擇開始日 {fmtShort(pendingStart)}，請點選結束日
              <button className="icon-btn" style={{ marginLeft: 6 }} onClick={() => setPendingStart(null)}>取消</button>
            </div>
          )}
        </div>
      </div>
      {confirmAction && (
        <Modal title="確認" onClose={confirmNo}>
          <div className="form-col">
            <div>
              {confirmAction.type === "delete"
                ? `要移除 ${fmtShort(confirmAction.range.start)} ～ ${fmtShort(confirmAction.range.end)} 這筆生理期記錄嗎？`
                : confirmAction.type === "start"
                ? `將 ${fmtShort(confirmAction.dateKey)} 設為生理期開始日？`
                : `將 ${fmtShort(confirmAction.dateKey)} 設為結束日？（開始日：${fmtShort(pendingStart)}）`}
            </div>
            <div className="two-col">
              <button className="btn-outline" onClick={confirmNo}>取消</button>
              <button className="btn-solid" onClick={confirmYes}>確定</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ============================== SETTINGS PAGE ============================== */

function SettingsPage({ state, setState, today }) {
  const [modal, setModal] = useState(null);
  const p = state.profile;
  function set(patch) { setState((s) => ({ ...s, profile: { ...s.profile, ...patch } })); }
  return (
    <div className="page">
      <TopHeader title="設定" dateObj={today} />
      <div className="page-body">
        <PinkPanel>
          <div className="profile-panel">
            <div className="avatar-box"><User size={40} /></div>
            <div className="profile-fields">
              <div className="finance-row"><span>暱稱</span><span className="finance-pill">{p.nickname}</span></div>
              <div className="finance-row"><span>電子郵件</span><span className="finance-pill">{p.email || "尚未綁定"}</span></div>
              <div className="finance-row"><span>入學年度</span><span className="finance-pill">{p.enrollYear || "未設定"}</span></div>
            </div>
          </div>
        </PinkPanel>
        <div className="settings-list">
          <div className="settings-row clickable" onClick={() => setModal("profile")}>
            <span className="settings-icon"><User size={18} /></span>
            <span>編輯個人資料</span>
          </div>
          <div className="settings-row">
            <span className="settings-icon">🌙</span>
            <span>深色模式</span>
            <Toggle checked={p.darkMode} onChange={(v) => set({ darkMode: v })} />
          </div>
          <div className="settings-row">
            <span className="settings-icon">✉️</span>
            <span>通知（首頁截止日提醒橫幅）</span>
            <Toggle checked={p.notifications} onChange={(v) => set({ notifications: v })} />
          </div>
          <div className="settings-row clickable" onClick={() => setModal("fontFamily")}>
            <span className="settings-icon">Aa</span>
            <span>字體（{(FONT_FAMILY_OPTIONS.find((f) => f.key === p.fontFamily) || FONT_FAMILY_OPTIONS[0]).label}）</span>
          </div>
          <div className="settings-row clickable" onClick={() => setModal("font")}>
            <span className="settings-icon">Tt</span>
            <span>字體大小（{p.fontSize === "small" ? "小" : p.fontSize === "large" ? "大" : "中"}）</span>
          </div>
        </div>
      </div>
      {modal === "profile" && (
        <Modal title="編輯個人資料" onClose={() => setModal(null)}>
          <ProfileForm profile={p} onSave={(patch) => { set(patch); setModal(null); }} />
        </Modal>
      )}
      {modal === "fontFamily" && (
        <Modal title="字體" onClose={() => setModal(null)}>
          <div className="two-col">
            {FONT_FAMILY_OPTIONS.map((f) => (
              <button key={f.key} className={"btn-outline" + (p.fontFamily === f.key ? " active" : "")} style={{ fontFamily: f.family }} onClick={() => { set({ fontFamily: f.key }); setModal(null); }}>
                {f.label}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {modal === "font" && (
        <Modal title="字體大小" onClose={() => setModal(null)}>
          <div className="two-col">
            {["small", "medium", "large"].map((sz) => (
              <button key={sz} className={"btn-outline" + (p.fontSize === sz ? " active" : "")} onClick={() => { set({ fontSize: sz }); setModal(null); }}>
                {sz === "small" ? "小" : sz === "large" ? "大" : "中"}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function ProfileForm({ profile, onSave }) {
  const [f, setF] = useState({ nickname: profile.nickname, email: profile.email, enrollYear: profile.enrollYear, password: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="form-col">
      <Field label="暱稱"><input value={f.nickname} onChange={set("nickname")} /></Field>
      <Field label="電子郵件"><input type="email" value={f.email} onChange={set("email")} /></Field>
      <Field label="入學年度"><input value={f.enrollYear} onChange={set("enrollYear")} /></Field>
      <Field label="設定密碼"><input type="password" value={f.password} onChange={set("password")} placeholder="輸入新密碼" /></Field>
      <button className="btn-solid" onClick={() => onSave(f)}>儲存</button>
    </div>
  );
}

/* ============================== APP SHELL ============================== */

const NAV = [
  { key: "home", icon: Home },
  { key: "finance", icon: CircleDollarSign },
  { key: "calendar", icon: CalendarDays },
  { key: "period", icon: Droplet },
  { key: "settings", icon: User },
];

export default function App() {
  const [state, setState, loaded, saveError, storageOk, imgSaveError, imgSaving, imgSaved, imgErrorDetail, imgProgress, retryImageSave, saveErrorDetail, retryMainSave] = useAppState();
  const [tab, setTab] = useState("home");
  const today = new Date();
  const theme = state.profile.darkMode ? "dark" : "light";
  const fontScale = state.profile.fontSize === "small" ? "0.9" : state.profile.fontSize === "large" ? "1.15" : "1";
  const fontFamily = (FONT_FAMILY_OPTIONS.find((f) => f.key === state.profile.fontFamily) || FONT_FAMILY_OPTIONS[0]).family;

  // "通知" toggle drives an in-app reminder list/badge rather than a real device push - this
  // environment can't register a background service worker or request Notification permission,
  // so anything beyond "while the app is open" isn't achievable here. Only assignments/exams due
  // within 7 days count (calendar events and courses are deliberately excluded). The clock only
  // ticks (and re-renders) while the toggle is on, so it costs nothing when the feature is off.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!state.profile.notifications) return undefined;
    const id = setInterval(() => setNow(new Date()), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [state.profile.notifications]);
  const reminders = state.profile.notifications ? getUpcomingDeadlines(state.assignments, state.exams, state.todos, now) : [];

  if (!loaded) return <div className="app-loading">載入中...</div>;

  return (
    <div className="app-shell" data-theme={theme} style={{ ["--font-scale"]: fontScale, ["--font-family"]: fontFamily }}>
      <style>{CSS}</style>
      {saveError && (
        <div className="save-error-banner">
          資料儲存失敗，變更可能沒有存下來{saveErrorDetail ? `（${saveErrorDetail}）` : ""}
          <button className="retry-btn" onClick={retryMainSave}>重試</button>
        </div>
      )}
      <div className="app-content">
        {tab === "home" && <HomePage state={state} setState={setState} today={today} reminders={reminders} />}
        {tab === "finance" && <FinancePage state={state} setState={setState} today={today} />}
        {tab === "calendar" && <CalendarPage state={state} setState={setState} today={today} imgSaving={imgSaving} imgSaved={imgSaved} imgProgress={imgProgress} imgSaveError={imgSaveError} imgErrorDetail={imgErrorDetail} retryImageSave={retryImageSave} />}
        {tab === "period" && <PeriodPage state={state} setState={setState} today={today} />}
        {tab === "settings" && <SettingsPage state={state} setState={setState} today={today} />}
      </div>
      <div className="bottom-nav">
        {NAV.map(({ key, icon: Icon }) => (
          <button key={key} className={"nav-btn" + (tab === key ? " active" : "")} onClick={() => setTab(key)}>
            <Icon size={24} />
            {key === "home" && reminders.length > 0 && <span className="nav-badge-dot" />}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============================== CSS ============================== */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@400;500;700;900&family=Noto+Sans+TC:wght@400;500;700;900&family=Noto+Serif+TC:wght@400;500;700;900&family=Iansui&display=swap');

.app-shell[data-theme="light"] {
  --bg: #F7F4EF; --bg-header: rgba(224,219,210,0.72); --pink: rgba(234,223,222,0.72); --pink-border: rgba(110,79,88,0.18);
  --card: rgba(235,232,224,0.55); --text: #6E4F58; --text-strong: #6E4F58; --border: rgba(110,79,88,0.4);
  --white: rgba(247,244,239,0.65); --accent: #6E4F58; --chipgray: rgba(217,217,217,0.75); --shadow: rgba(110,79,88,0.10);
  --glass-blur: blur(14px);
}
.app-shell[data-theme="dark"] {
  --bg: #211d1a; --bg-header: rgba(54,48,42,0.78); --pink: rgba(64,50,50,0.78); --pink-border: rgba(214,197,182,0.55);
  --card: rgba(60,53,47,0.78); --text: #e5ddd2; --text-strong: #f5efe5; --border: rgba(214,197,182,0.55);
  --white: rgba(72,64,56,0.82); --accent: #c99a9a; --chipgray: rgba(84,84,84,0.78); --shadow: rgba(0,0,0,0.35);
  --glass-blur: blur(14px);
}
.app-shell[data-theme="dark"] { --glass-blur: blur(18px) saturate(1.35); }
.app-shell[data-theme="dark"]::before {
  content: ""; position: absolute; inset: 0; z-index: 40; pointer-events: none; border-radius: inherit;
  background: linear-gradient(135deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 28%, rgba(255,255,255,0) 72%, rgba(255,255,255,0.06) 100%);
  mix-blend-mode: overlay;
}
.app-shell {
  font-family: var(--font-family, 'Zen Maru Gothic', sans-serif); font-weight: 700;
  background: linear-gradient(165deg, #F7F4EF 0%, #EFEAE1 100%); color: var(--text);
  width: 100%; max-width: 480px; margin: 0 auto; height: 100vh; max-height: 900px;
  display: flex; flex-direction: column; overflow: hidden; position: relative;
  border-radius: 20px; box-shadow: 0 8px 40px var(--shadow); font-size: calc(15px * var(--font-scale));
}
.app-shell[data-theme="dark"] { background: linear-gradient(165deg, #211d1a 0%, #1a1715 100%); }
.app-loading { padding: 40px; text-align: center; color: #5b4a3f; }
.save-error-banner { position: absolute; top: 8px; left: 8px; right: 8px; z-index: 100; background: #b95c5c; color: white; font-size: 12px; padding: 8px 12px; border-radius: 10px; text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
.retry-btn { display: block; margin: 6px auto 0; background: white; color: #b95c5c; border: none; border-radius: 8px; padding: 4px 10px; font-size: 11px; font-weight: 700; cursor: pointer; }
.save-progress-banner { position: absolute; top: 8px; left: 8px; right: 8px; z-index: 100; background: #6E4F58; color: white; font-size: 12px; padding: 8px 12px; border-radius: 10px; text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
.app-content { flex: 1; overflow-y: auto; background: transparent; }
* { box-sizing: border-box; }
.page { display: flex; flex-direction: column; min-height: 100%; }
.top-header { background: var(--bg-header); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); padding: 22px 20px 16px; display: flex; justify-content: space-between; align-items: flex-start; }
.top-header-left { display: flex; flex-direction: column; gap: 8px; }
.title-script { font-family: var(--font-family, 'Zen Maru Gothic', sans-serif); font-weight: 900; font-size: 21px; color: var(--text-strong); display: flex; align-items: center; gap: 4px; white-space: nowrap; }
.top-header-right { display: flex; align-items: center; gap: 6px; }
.date-block { border-left: 1.5px solid var(--border); padding-left: 12px; text-align: center; color: var(--text-strong); line-height: 1.1; }
.date-year { font-size: 13px; font-weight: 700; }
.date-day { font-size: 26px; font-weight: 800; font-family: 'Noto Sans TC', serif; }
.date-month { font-size: 11px; font-weight: 700; font-style: italic; }
.month-switch { display: flex; align-items: center; gap: 4px; font-family: var(--font-family, 'Zen Maru Gothic', sans-serif); font-weight: 900; font-size: 21px; color: var(--text-strong); white-space: nowrap; }
.chip-row { display: flex; gap: 5px; flex-wrap: nowrap; width: 100%; }
.chip-tag { background: var(--white); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); border: 1px solid var(--pink-border); border-radius: 14px; padding: 4px 12px; font-size: 12px; color: var(--text); }
.chip-tag.clickable { cursor: pointer; }
.chip-gray { background: var(--chipgray); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); border: none; border-radius: 14px; padding: 4px 8px; font-size: clamp(8.5px, 2.6vw, 11px); color: var(--text-strong); font-weight: 700; white-space: nowrap; flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; text-align: center; }
.chip-gray.clickable { cursor: pointer; }
.page-body { padding: 18px; display: flex; flex-direction: column; gap: 16px; position: relative; flex: 1; }
.panel-pink { background: var(--pink); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); border: 1px solid var(--pink-border); border-radius: 18px; padding: 18px; position: relative; box-shadow: 0 4px 18px var(--shadow); }
.panel-pink::before { content: ''; position: absolute; top: -6px; left: 14px; width: 26px; height: 26px;
  background: transparent; }
.panel-tag-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.panel-title-inline { font-weight: 700; color: var(--text-strong); }
.timeline { display: flex; flex-direction: column; gap: 14px; padding-left: 4px; border-left: 2px dashed var(--border); margin-left: 6px; }
.timeline-row { display: flex; align-items: flex-start; gap: 10px; margin-left: -8px; }
.timeline-time { font-size: 11px; color: var(--text); width: 78px; flex-shrink: 0; padding-top: 2px; }
.timeline-dot { width: 10px; height: 10px; border-radius: 50%; margin-top: 3px; flex-shrink: 0; }
.timeline-content { flex: 1; }
.timeline-title { font-weight: 700; color: var(--text-strong); font-size: 14px; }
.timeline-sub { font-size: 12px; color: var(--text); opacity: 0.8; }
.empty-hint { color: var(--text); opacity: 0.55; font-size: 13px; padding: 10px 0; text-align: center; }
.tile-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.tile { background: var(--card); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); border: 1px solid var(--pink-border); border-radius: 16px; padding: 22px 10px;
  text-decoration: none; box-sizing: border-box;
  display: flex; flex-direction: column; align-items: center; gap: 10px; cursor: pointer; color: var(--text-strong); transition: background 0.2s; }
.tile:hover { background: var(--pink); }
.tile-label { font-size: 14px; font-weight: 700; }
.icon-btn { background: none; border: none; color: var(--text-strong); cursor: pointer; padding: 4px; display: flex; align-items: center; }
.btn-outline { background: var(--white); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); border: 1px solid var(--border); color: var(--text-strong); border-radius: 12px; padding: 9px 16px; cursor: pointer; font-size: 13px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; justify-content: center; }
.btn-outline.small { padding: 6px 10px; }
.btn-outline.active { background: var(--accent); color: white; }
.btn-outline:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-solid { background: var(--accent); opacity: 0.92; color: white; border: none; border-radius: 12px; padding: 11px 16px; cursor: pointer; font-size: 14px; font-weight: 700; margin-top: 6px; }
.fab { position: absolute; bottom: 14px; right: 14px; width: 52px; height: 52px; border-radius: 50%; background: var(--card); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); border: 1px solid var(--border); color: var(--text-strong); cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 16px var(--shadow); }
.bottom-nav { display: flex; justify-content: space-around; align-items: center; padding: 12px 0; background: var(--bg-header); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); border-top: 1px solid var(--pink-border); }
.nav-btn { position: relative; background: none; border: none; color: var(--text); opacity: 0.55; cursor: pointer; padding: 6px 14px; border-radius: 10px; }
.nav-btn.active { color: var(--accent); opacity: 1; }
.nav-badge-dot { position: absolute; top: 4px; right: 10px; width: 8px; height: 8px; border-radius: 50%; background: #b95c5c; box-shadow: 0 0 0 2px var(--bg); }
.reminder-banner { background: var(--white); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); border: 1px solid var(--pink-border); border-radius: 14px; padding: 10px 12px; margin-bottom: 12px; }
.reminder-banner-head { display: flex; align-items: center; justify-content: space-between; font-weight: 800; color: var(--text-strong); font-size: 13px; margin-bottom: 6px; }
.reminder-dismiss { background: none; border: none; color: var(--text); opacity: 0.6; cursor: pointer; padding: 2px; display: flex; }
.reminder-item { display: flex; align-items: center; gap: 6px; padding: 4px 0; font-size: 12.5px; color: var(--text-strong); }
.reminder-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.reminder-time { opacity: 0.75; flex-shrink: 0; }
.reminder-title { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.modal-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 16px; }
.modal-box { background: var(--bg); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); border: 1px solid var(--pink-border); border-radius: 18px; width: 100%; max-width: 380px; max-height: 85%; overflow-y: auto; box-shadow: 0 12px 40px rgba(0,0,0,0.25); }
.modal-box.wide { max-width: 420px; }
.modal-head { display: flex; justify-content: space-between; align-items: center; padding: 16px 18px; border-bottom: 1px solid var(--pink-border); font-weight: 700; color: var(--text-strong); position: sticky; top: 0; background: var(--bg); }
.modal-body { padding: 18px; }
.form-col { display: flex; flex-direction: column; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 5px; font-size: 13px; }
.field-label { font-size: 12px; color: var(--text); font-weight: 600; }
input, select { background: var(--white); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); border: 1px solid var(--pink-border); border-radius: 10px; padding: 9px 11px; color: var(--text-strong); font-size: 14px; font-family: inherit; font-weight: 700; }
input[type=color] { padding: 3px; height: 38px; }
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.toggle { width: 40px; height: 22px; border-radius: 12px; background: #cabbb0; border: none; cursor: pointer; position: relative; padding: 2px; }
.toggle.on { background: var(--accent); }
.toggle-knob { display: block; width: 18px; height: 18px; border-radius: 50%; background: white; transition: transform 0.2s; }
.toggle.on .toggle-knob { transform: translateX(18px); }
.inline-add { display: flex; gap: 8px; flex-wrap: wrap; }
.inline-add input { flex: 1; min-width: 0; }
.chip-list { display: flex; flex-wrap: wrap; gap: 6px; }
.chip-removable { background: var(--white); border: 1px solid var(--pink-border); border-radius: 12px; padding: 4px 8px; font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
.chip-removable button { background: none; border: none; cursor: pointer; color: var(--text); display: flex; }
.restaurant-list, .habit-list, .course-list, .notes-list { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.restaurant-row, .course-row { display: flex; align-items: center; justify-content: space-between; background: var(--white); border-radius: 10px; padding: 8px 10px; font-size: 13px; gap: 6px; }
.checkbox-row { display: flex; align-items: center; gap: 8px; }
.row-actions { display: flex; gap: 4px; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.wheel-wrap { display: flex; flex-direction: column; align-items: center; gap: 14px; }
.wheel-area { position: relative; width: 220px; height: 220px; display: flex; align-items: center; justify-content: center; }
.wheel-pointer { position: absolute; top: -6px; font-size: 22px; color: var(--accent); z-index: 2; }
.wheel { width: 100%; height: 100%; border-radius: 50%; border: 3px solid var(--border); transition: transform 3.2s cubic-bezier(.2,.8,.2,1); position: relative; }
.wheel-label { position: absolute; top: 50%; left: 50%; width: 100px; height: 0; transform-origin: left center; display: flex; align-items: center; }
.wheel-label span { display: inline-block; font-size: 10px; color: white; font-weight: 700; margin-left: 14px; }
.wheel-result { font-weight: 700; color: var(--text-strong); }
.habit-block { background: var(--white); border-radius: 12px; padding: 10px; }
.habit-head { display: flex; justify-content: space-between; margin-bottom: 8px; font-weight: 600; }
.habit-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; }
.habit-cell { background: var(--bg); border: 1px solid var(--pink-border); border-radius: 6px; font-size: 11px; padding: 6px 0; cursor: pointer; color: var(--text); }
.habit-cell.on { background: var(--accent); color: white; }
.upload-box { border: 2px dashed var(--pink-border); border-radius: 14px; padding: 30px 16px; text-align: center; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 8px; color: var(--text); }
.bg-adjust-hint { font-size: 12px; color: var(--text); opacity: 0.75; }
.bg-adjust-area { border-radius: 10px; border: 1px solid var(--pink-border); cursor: grab; touch-action: none; position: relative; overflow: hidden; background-color: var(--white); margin: 0 auto; max-width: 100%; }
.bg-adjust-area:active { cursor: grabbing; }
.file-preview { margin-top: 12px; }
.file-preview img { width: 100%; border-radius: 10px; }
.file-preview-name { display: flex; gap: 6px; align-items: center; font-size: 13px; margin-bottom: 6px; }
.file-preview-name .icon-btn { margin-left: auto; }
.pdf-frame { width: 100%; height: 420px; border: 1px solid var(--pink-border); border-radius: 10px; background: white; }
.map-gallery { display: flex; flex-direction: column; gap: 14px; margin-top: 12px; }
.finance-panel { display: flex; justify-content: space-between; gap: 22px; }
.finance-left { display: flex; flex-direction: column; gap: 10px; flex: 1; }
.finance-row { display: flex; justify-content: flex-start; align-items: center; gap: 10px; font-size: 13px; color: var(--text-strong); font-weight: 600; }
.finance-row > span:first-child { white-space: nowrap; flex-shrink: 0; font-size: clamp(11px, 3vw, 13px); }
.finance-pill { background: var(--white); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); border-radius: 12px; padding: 6px 12px; min-width: 76px; text-align: center; font-weight: 700; font-size: clamp(11px, 3vw, 13px); }
.finance-right { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; align-content: start; }
.finance-right .btn-outline { height: 42px; white-space: nowrap; overflow: hidden; font-size: clamp(11px, 3vw, 13px); padding: 0 6px; }
.table-card { background: var(--card); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); border: 1px solid var(--pink-border); border-radius: 16px; padding: 14px; }
.table-head-row, .table-row { display: grid; grid-template-columns: 55px 60px 65px 1fr 50px; gap: 6px; font-size: 12px; align-items: center; padding: 6px 0; }
.table-head-row { font-weight: 700; color: var(--text-strong); border-bottom: 1px solid var(--pink-border); }
.table-row { border-bottom: 1px solid var(--pink-border); }
.chart-block { margin-bottom: 20px; }
.chart-title { font-weight: 700; color: var(--text-strong); margin-bottom: 8px; font-size: 14px; }
.budget-usage { display: flex; flex-direction: column; gap: 8px; }
.budget-bar-track { width: 100%; height: 14px; background: var(--white); border-radius: 8px; overflow: hidden; border: 1px solid var(--pink-border); }
.budget-bar-fill { height: 100%; background: var(--accent); border-radius: 8px; transition: width 0.3s; }
.budget-bar-fill.over { background: #b95c5c; }
.budget-usage-text { font-size: 13px; color: var(--text-strong); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.budget-over-tag { background: #b95c5c; color: white; font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 700; }
.week-nav { display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 13px; color: var(--text-strong); font-weight: 600; }
.cal-grid-wrap { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; border-radius: 10px; }
.cal-grid { display: grid; position: relative; width: max-content; }
.cal-bg-clip { position: absolute; inset: 0; overflow: hidden; z-index: 0; pointer-events: none; }
.cal-bg-layer { position: absolute; object-fit: cover; filter: brightness(0.88); }
.cal-bg-overlay { position: absolute; inset: 0; background: var(--bg); opacity: 0.32; }
.cal-corner { background: transparent; position: relative; z-index: 1; }
.cal-day-head { text-align: center; font-size: 10.5px; font-weight: 700; color: var(--text-strong); padding-bottom: 6px; position: relative; z-index: 1; }
.cal-day-date { font-size: 8.5px; font-weight: 400; opacity: 0.7; }
.cal-hours { grid-column: 1; position: relative; z-index: 1; }
.cal-hour-cell { font-size: 8px; color: var(--text); text-align: center; border-top: 1px solid var(--pink-border); padding-top: 1px; }
.cal-col { position: relative; z-index: 1; border-left: 1px solid var(--pink-border); min-width: 0; }
.cal-col-line { border-top: 1px solid var(--pink-border); }
.cal-grid-has-bg .cal-day-head { color: rgba(255,255,255,0.95); }
.cal-grid-has-bg .cal-day-date { color: rgba(255,255,255,0.95); }
.cal-grid-has-bg .cal-hour-cell { color: rgba(255,255,255,0.85); border-top-color: rgba(255,255,255,0.35); }
.cal-grid-has-bg .cal-col { border-left-color: rgba(255,255,255,0.35); }
.cal-grid-has-bg .cal-col-line { border-top-color: rgba(255,255,255,0.35); }
.cal-grid-has-bg .cal-block-title { color: rgba(255,255,255,0.95); }
.cal-grid-has-bg .cal-block-sub { color: rgba(255,255,255,0.85); }
.cal-block { position: absolute; left: 0; right: 0; display: flex; align-items: center; box-sizing: border-box;
  border-radius: 2px; padding: 2px 5px 2px 0; overflow: hidden; cursor: pointer; z-index: 2;
  box-shadow: 0 1px 2px rgba(0,0,0,0.14); }
.cal-block.event { cursor: grab; }
.cal-block-bar { align-self: stretch; width: 4px; flex-shrink: 0; }
.cal-block-content { display: flex; flex-direction: column; justify-content: center; overflow: hidden; min-width: 0; padding-left: 4px; }
.cal-block-title { font-weight: 700; color: var(--text-strong); white-space: normal; word-break: break-word; overflow: hidden; }
.cal-block-sub { color: var(--text); opacity: 0.7; white-space: nowrap; overflow: hidden; }
.course-meta { margin-bottom: 12px; }
.course-meta-line { font-size: 13px; color: var(--text); opacity: 0.85; margin-bottom: 3px; }
.course-meta-day { font-weight: 700; color: var(--text-strong); margin-right: 8px; }
.attend-tabs { display: flex; gap: 22px; border-bottom: 1px solid var(--pink-border); margin-bottom: 14px; }
.attend-tab { background: none; border: none; padding: 6px 2px 10px; font-size: 15px; font-weight: 700; color: var(--text); opacity: 0.5; cursor: pointer; position: relative; }
.attend-tab.active { color: var(--accent); opacity: 1; }
.attend-tab.active::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 2.5px; background: var(--accent); border-radius: 2px; }
.attend-summary { display: grid; grid-template-columns: repeat(4, 1fr); background: var(--white); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); border: 1px solid var(--pink-border); border-radius: 14px; padding: 14px 4px; margin-bottom: 14px; }
.attend-summary-cell { text-align: center; display: flex; flex-direction: column; gap: 4px; }

.credit-settings-scroll { display: flex; flex-direction: column; overflow-x: hidden; }
.credit-top { display: flex; gap: 18px; align-items: center; margin-bottom: 18px; }
.credit-ring-wrap { position: relative; width: 100px; height: 100px; flex-shrink: 0; }
.credit-ring { width: 100%; height: 100%; }
.credit-ring-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.credit-ring-num { font-size: 22px; font-weight: 800; color: var(--text-strong); line-height: 1; }
.credit-ring-den { font-size: 11px; color: var(--text); opacity: 0.7; }
.credit-top-right { flex: 1; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.credit-progress-line { font-size: 12.5px; color: var(--text-strong); }
.credit-progress-line b { color: var(--accent); }
.credit-gpa-row { display: flex; gap: 18px; }
.credit-gpa-label { font-size: 11px; color: var(--text); opacity: 0.75; }
.credit-gpa-num { font-size: 17px; font-weight: 800; color: var(--text-strong); }
.credit-gpa-scale { font-size: 11px; font-weight: 400; opacity: 0.6; }
.credit-section-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; font-weight: 700; color: var(--text-strong); margin-bottom: 8px; }
.credit-type-list { display: flex; flex-direction: column; gap: 12px; }
.credit-type-row { display: flex; flex-direction: column; gap: 5px; }
.credit-type-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.credit-type-name { font-size: 13px; font-weight: 700; color: var(--text-strong); flex-shrink: 1; min-width: 0; max-width: 38%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.credit-goal-link { margin-left: auto; background: none; border: none; color: var(--accent); font-size: 11.5px; font-weight: 700; cursor: pointer; white-space: nowrap; flex-shrink: 0; }
.credit-goal-input { width: 60px; max-width: 30vw; margin-left: auto; padding: 3px 6px; font-size: 12px; flex-shrink: 0; }
.credit-type-bar-track { width: 100%; height: 8px; background: var(--white); border-radius: 6px; overflow: hidden; }
.credit-type-bar-fill { height: 100%; background: var(--accent); border-radius: 6px; transition: width 0.3s; }
.credit-top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.semester-chip { display: flex; align-items: center; gap: 4px; background: var(--white); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); border: 1px solid var(--pink-border); border-radius: 12px; padding: 6px 12px; font-size: 15px; font-weight: 800; color: var(--text-strong); font-family: inherit; cursor: pointer; }
.credit-top-actions { display: flex; gap: 4px; }
.semester-pick-list { display: flex; flex-direction: column; gap: 8px; }
.semester-pick-row { display: flex; align-items: center; justify-content: space-between; background: var(--white); border: 1px solid var(--pink-border); border-radius: 10px; padding: 4px 6px 4px 14px; touch-action: none; user-select: none; -webkit-user-select: none; transition: transform 0.15s, box-shadow 0.15s; }
.semester-pick-row.active { background: var(--accent); }
.semester-pick-row.active .semester-pick-label { color: white; }
.semester-pick-row.active .icon-btn { color: white; }
.semester-pick-row.dragging { transform: scale(1.03); box-shadow: 0 6px 16px rgba(0,0,0,0.18); z-index: 5; position: relative; opacity: 0.95; }
.semester-pick-label { background: none; border: none; text-align: left; font-size: 14px; font-weight: 700; color: var(--text-strong); cursor: pointer; padding: 8px 0; flex: 1; font-family: inherit; }
.semester-pick-actions { display: flex; gap: 2px; flex-shrink: 0; }
.semester-pick-actions .icon-btn:disabled { opacity: 0.3; cursor: default; }
.pill-choice-row { display: flex; flex-wrap: wrap; gap: 6px; }
.pill-choice { background: var(--white); border: 1px solid var(--pink-border); border-radius: 10px; padding: 7px 12px; font-size: 13px; font-weight: 700; color: var(--text); cursor: pointer; }
.pill-choice.on { background: var(--accent); color: white; border-color: var(--accent); }
.calc-table { border: 1px solid var(--pink-border); border-radius: 12px; overflow: hidden; margin-bottom: 14px; }
.calc-table-head, .calc-table-row { display: grid; grid-template-columns: 1.3fr 0.7fr 0.7fr; padding: 9px 12px; font-size: 13px; }
.calc-table-head { font-weight: 700; color: var(--text-strong); background: var(--white); }
.calc-table-row { border-top: 1px solid var(--pink-border); color: var(--text-strong); }
.calc-warn { color: #b95c5c; font-weight: 700; }
.calc-formula-box { background: var(--white); border-radius: 12px; padding: 10px 12px; margin-bottom: 14px; }
.calc-formula { font-weight: 800; color: var(--text-strong); font-size: 14px; margin-top: 2px; }
.calc-notes { margin: 0 0 14px; padding-left: 18px; font-size: 12.5px; color: var(--text); display: flex; flex-direction: column; gap: 5px; }
.manage-goal-row { display: flex; justify-content: space-between; align-items: center; background: var(--white); border-radius: 12px; padding: 12px 14px; font-size: 13px; font-weight: 700; color: var(--text-strong); }
.manage-goal-value { display: flex; align-items: center; gap: 6px; background: none; border: none; font-size: 15px; font-weight: 800; color: var(--accent); cursor: pointer; font-family: inherit; }
.manage-type-list { display: flex; flex-direction: column; gap: 8px; }
.manage-type-row { display: flex; align-items: center; gap: 8px; background: var(--white); border-radius: 10px; padding: 9px 10px; }
.manage-checkbox { width: 20px; height: 20px; border-radius: 6px; border: 1.5px solid var(--pink-border); background: var(--card); display: flex; align-items: center; justify-content: center; color: white; cursor: pointer; flex-shrink: 0; }
.manage-checkbox.on { background: var(--accent); border-color: var(--accent); }
.manage-type-name { font-size: 13px; font-weight: 700; color: var(--text-strong); flex: 1; min-width: 0; }
.manage-type-num { font-size: 13px; color: var(--text); opacity: 0.7; flex-shrink: 0; }
.semester-course-group { margin-bottom: 4px; }
.quick-add-course { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; background: var(--white); border-radius: 12px; padding: 10px; }
.quick-add-row { display: flex; flex-wrap: wrap; gap: 6px; }
.quick-add-row input, .quick-add-row select { flex: 1 1 90px; min-width: 0; }
.grade-table { display: flex; flex-direction: column; }
.grade-table-head, .grade-table-row { display: grid; grid-template-columns: 2fr 0.8fr 1fr 1.2fr; gap: 6px; align-items: center; padding: 8px 0; font-size: 12px; }
.grade-table-head { font-weight: 700; color: var(--text-strong); border-bottom: 1px solid var(--pink-border); }
.grade-table-row { border-bottom: 1px solid var(--pink-border); color: var(--text); }
.grade-input { width: 100%; padding: 4px 6px; font-size: 12px; text-align: center; }
.attend-summary-num { font-size: 22px; font-weight: 800; color: var(--text-strong); }
.attend-summary-label { font-size: 11px; color: var(--text); opacity: 0.8; }
.session-list-head { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--text); opacity: 0.75; margin-bottom: 8px; }
.session-hint { opacity: 0.6; }
.session-list { display: flex; flex-direction: column; gap: 10px; max-height: 50vh; overflow-y: auto; }
.session-row { background: var(--white); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); border: 1px solid var(--pink-border); border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.session-date-row { display: flex; justify-content: space-between; align-items: baseline; }
.session-date { font-size: 13.5px; font-weight: 700; color: var(--text-strong); }
.session-week { font-size: 11px; color: var(--text); opacity: 0.7; }
.session-buttons { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; }
.session-btn { font-size: 10.5px; padding: 7px 2px; border-radius: 8px; border: 1px solid var(--pink-border); background: var(--card); color: var(--text); font-weight: 700; cursor: pointer; }
.session-btn.on { background: var(--accent); color: white; border-color: var(--accent); }
.session-cancel-btn { font-size: 10px; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--pink-border); background: var(--card); color: var(--text); cursor: pointer; white-space: nowrap; }
.session-cancel-btn.on { background: #b95c5c; color: white; border-color: #b95c5c; }
.session-row-cancelled { opacity: 0.7; }
.session-cancelled-hint { font-size: 11.5px; color: var(--text); opacity: 0.7; text-align: center; padding: 4px 0; }
.note-row { background: var(--white); border-radius: 8px; padding: 8px 10px; font-size: 12px; display: flex; gap: 8px; }
.note-date { color: var(--accent); font-weight: 700; flex-shrink: 0; }
.period-cal { background: var(--card); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); border: 1px solid var(--pink-border); border-radius: 16px; padding: 14px; }
.period-cal-head { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; font-size: 11px; font-weight: 700; color: var(--text-strong); margin-bottom: 8px; }
.period-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
.period-day { position: relative; aspect-ratio: 1; background: var(--white); border: 1px solid var(--pink-border); border-radius: 8px; cursor: pointer; font-size: 12px; color: var(--text); display: flex; align-items: center; justify-content: center; }
.period-day.empty { background: transparent; border: none; cursor: default; }
.period-day.marked { background: var(--pink); font-weight: 700; }
.period-day.pending { outline: 2px solid var(--accent); }
.period-underline { position: absolute; bottom: 4px; width: 55%; height: 2.5px; background: var(--accent); border-radius: 2px; }
.profile-panel { display: flex; gap: 16px; align-items: center; }
.avatar-box { width: 76px; height: 76px; border-radius: 14px; background: var(--white); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); border: 1px solid var(--pink-border); display: flex; align-items: center; justify-content: center; color: var(--text-strong); flex-shrink: 0; }
.profile-fields { flex: 1; display: flex; flex-direction: column; gap: 8px; }
.settings-list { background: var(--card); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); border: 1px solid var(--pink-border); border-radius: 16px; overflow: hidden; }
.settings-row { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--pink-border); font-size: 14px; color: var(--text-strong); }
.settings-row:last-child { border-bottom: none; }
.settings-row.clickable { cursor: pointer; }
.settings-row.clickable:hover { background: var(--pink); }
.settings-icon { width: 20px; text-align: center; }
.settings-row .toggle { margin-left: auto; }
`;

/* ============================== mount ============================== */
// This build runs standalone (no bundler) - Babel transforms this file in the browser and the
// import map in index.html resolves react/react-dom/lucide-react/recharts to CDN builds.
const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<App />);
}
