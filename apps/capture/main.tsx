import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import SurveyMap, { type MapHandle } from "../../packages/ui/SurveyMap";
import { PointEditor } from "../../packages/ui/PointEditor";
import { useLocalState } from "../../packages/ui/local-state";
import {
  download,
  exportCSV,
  uid,
  validDepth,
  type NamedSession,
} from "../../packages/core/files";
import { distanceMeters } from "../../packages/core/recording";
import type { Measurement } from "../../packages/core/survey";
import "../../packages/ui/style.css";
type CaptureState = {
  sessions: NamedSession[];
  measurements: Measurement[];
  current: string;
};
const initial: CaptureState = { sessions: [], measurements: [], current: "" };
function Capture() {
  const { state, ready, error, saving, commit } = useLocalState(
    "capture",
    initial,
  );
  const [active, setActive] = useState(false),
    [naming, setNaming] = useState(false),
    [sessionName, setSessionName] = useState(""),
    [tab, setTab] = useState("map"),
    [page, setPage] = useState(0),
    [position, setPosition] = useState<GeolocationPosition | null>(null),
    [gpsError, setGpsError] = useState(""),
    [depth, setDepth] = useState(""),
    [selected, setSelected] = useState<Measurement | null>(null),
    [now, setNow] = useState(Date.now()),
    [notice, setNotice] = useState(""),
    [camera, setCamera] = useState<MapHandle>({
      center: [24.1235, 61.1235],
      zoom: 15,
    });
  const watch = useRef<number | null>(null),
    centered = useRef(false),
    input = useRef<HTMLInputElement>(null),
    locked = useRef(false);
  const points = state.measurements.filter(
      (p) => p.sessionId === state.current,
    ),
    session = state.sessions.find((s) => s.id === state.current);
  useEffect(() => {
    locate();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      if (watch.current !== null)
        navigator.geolocation.clearWatch(watch.current);
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    let wake: WakeLockSentinel | undefined;
    let disposed = false;
    async function request() {
      try {
        const lock = await navigator.wakeLock?.request("screen");
        if (disposed) await lock?.release();
        else wake = lock;
      } catch {}
    }
    void request();
    const visible = () => {
      if (document.visibilityState === "visible") void request();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true;
      void wake?.release();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [active]);
  function locate() {
    if (!navigator.geolocation) {
      setGpsError(
        "GPS is unavailable. Use HTTPS or localhost in a supported browser.",
      );
      return;
    }
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    centered.current = false;
    setGpsError("Waiting for GPS…");
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        if (
          !Number.isFinite(p.coords.latitude) ||
          Math.abs(p.coords.latitude) > 85 ||
          !Number.isFinite(p.coords.longitude) ||
          Math.abs(p.coords.longitude) > 180 ||
          !Number.isFinite(p.coords.accuracy) ||
          p.coords.accuracy < 0
        ) {
          setPosition(null);
          setGpsError(
            "GPS returned an invalid fix or a location outside the supported latitude range (±85°).",
          );
          return;
        }
        setPosition(p);
        setGpsError("");
        if (!centered.current) {
          setCamera({
            center: [p.coords.longitude, p.coords.latitude],
            zoom: 17,
          });
          centered.current = true;
        }
      },
      (e) => {
        setPosition(null);
        setGpsError(
          e.code === 1
            ? "Location permission denied. Allow location in browser settings, then tap Enable GPS."
            : "GPS unavailable. Move to open sky and retry.",
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  }
  async function start() {
    if (locked.current || !fresh || !sessionName.trim()) return;
    locked.current = true;
    try {
      const id = uid(),
        time = new Date().toISOString();
      await commit((s) => ({
        ...s,
        current: id,
        sessions: [
          ...s.sessions,
          {
            id,
            lakeId: "capture",
            name: sessionName.trim(),
            startedAt: time,
            endedAt: null,
          },
        ],
      }));
      setActive(true);
      setNaming(false);
      setTab("map");
      setPage(0);
      setNotice("Session started.");
    } finally {
      locked.current = false;
    }
  }
  function exportSession() {
    download(
      `${session?.name ?? "session"}.csv`,
      exportCSV(points),
      "text/csv;charset=utf-8",
    );
  }
  async function end() {
    if (locked.current || !active) return;
    locked.current = true;
    try {
      const endedAt = new Date().toISOString();
      await commit((s) => ({
        ...s,
        current: points.length ? s.current : "",
        sessions: points.length
          ? s.sessions.map((v) => (v.id === s.current ? { ...v, endedAt } : v))
          : s.sessions.filter((v) => v.id !== s.current),
      }));
      setActive(false);
      if (points.length) {
        exportSession();
        setNotice(
          "Session saved. CSV download started. You can download it again below.",
        );
      } else setNotice("Empty session discarded.");
    } finally {
      locked.current = false;
    }
  }
  const fresh =
    !!position &&
    now - position.timestamp < 15000 &&
    position.coords.accuracy >= 0 &&
    Number.isFinite(position.coords.accuracy);
  async function add() {
    if (
      locked.current ||
      !active ||
      !position ||
      Date.now() - position.timestamp >= 15000 ||
      !validDepth(depth)
    )
      return;
    locked.current = true;
    const point: Measurement = {
      id: uid(),
      lakeId: "capture",
      sessionId: state.current,
      timestamp: new Date(position.timestamp).toISOString(),
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      depth: Number(depth.replace(",", ".")),
    };
    try {
      await commit((s) => ({ ...s, measurements: [...s.measurements, point] }));
      setNotice(`${point.depth.toFixed(1)} m saved on this device`);
      navigator.vibrate?.(30);
      input.current?.focus();
      input.current?.select();
    } finally {
      locked.current = false;
    }
  }
  const attempt = (fn: () => Promise<unknown>) => {
    void fn().catch((e) => setNotice(`Could not save: ${e.message}`));
  };
  const previous = points.at(-1);
  const previousDistance =
    fresh && previous
      ? distanceMeters(
          [position!.coords.longitude, position!.coords.latitude],
          [previous.longitude, previous.latitude],
        )
      : null;
  const elapsed = session
    ? Math.max(
        0,
        Math.floor(
          ((active
            ? now
            : Date.parse(
                session.endedAt ??
                  points.at(-1)?.timestamp ??
                  session.startedAt,
              )) -
            Date.parse(session.startedAt)) /
            1000,
        ),
      )
    : 0;
  const duration = `${String(Math.floor(elapsed / 3600)).padStart(2, "0")}:${String(Math.floor(elapsed / 60) % 60).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const pages = Math.max(1, Math.ceil(points.length / 15)),
    safePage = Math.min(page, pages - 1);
  return (
    <main className={`capture marine${active ? " recording" : ""}`}>
      <header>
        <a className="home-link" href="../../">← Home page</a>
        <a className="brand" href="./">
          ◉ DepthCalc <span>Capture</span>
        </a>
        <span className="tag">{active ? "RECORDING" : "READY"}</span>
      </header>
      <h1>{session?.name ?? "Ready for the water"}</h1>
      <div className={`metrics${session ? " session-metrics" : ""}`}>
        <div
          className={!fresh || position!.coords.accuracy > 5 ? "gps-weak" : ""}
        >
          <small>GPS ACCURACY</small>
          <strong>
            {fresh
              ? `± ${position!.coords.accuracy.toFixed(1)} m`
              : "No fresh fix"}
          </strong>
        </div>
        {session && (
          <>
            <div>
              <small>SESSION TIME</small>
              <strong>{duration}</strong>
            </div>
            <div>
              <small>MEASUREMENTS</small>
              <strong>{points.length}</strong>
            </div>
            <div>
              <small>DISTANCE FROM PREVIOUS</small>
              <strong
                data-previous-distance
                title={
                  !previous
                    ? "Add the first measurement"
                    : !fresh
                      ? "Waiting for a fresh GPS fix"
                      : "Distance to the last measurement in this session"
                }
              >
                {previousDistance === null
                  ? "—"
                  : `${previousDistance.toFixed(1)} m`}
              </strong>
            </div>
          </>
        )}
      </div>
      {(error || gpsError) && (
        <p className="alert" role="alert">
          {error || gpsError}
        </p>
      )}
      {!fresh && (
        <button className="wide" onClick={locate}>
          Enable GPS / retry
        </button>
      )}
      {session && (
        <nav className="capture-tabs" aria-label="Session view">
          <button aria-pressed={tab === "map"} onClick={() => setTab("map")}>
            Map
          </button>
          <button
            aria-pressed={tab === "table"}
            onClick={() => setTab("table")}
          >
            Measurements ({points.length})
          </button>
        </nav>
      )}
      {tab === "map" || !session ? (
        <div className="capture-map">
          <SurveyMap
            boundary={[]}
            points={points}
            position={position}
            layer="survey"
            camera={camera}
            onCamera={setCamera}
            onLocate={locate}
            onSelect={setSelected}
            currentSession={state.current}
          />
        </div>
      ) : (
        <section className="capture-table">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Depth</th>
                <th>GPS</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...points]
                .reverse()
                .slice(safePage * 15, safePage * 15 + 15)
                .map((p) => (
                  <tr key={p.id}>
                    <td>{new Date(p.timestamp).toLocaleTimeString()}</td>
                    <td>{p.depth.toFixed(1)} m</td>
                    <td>±{p.accuracy.toFixed(1)} m</td>
                    <td>
                      <button onClick={() => setSelected(p)}>Edit</button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!points.length && <p>No measurements yet.</p>}
          <div className="pagination">
            <button
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              Previous page
            </button>
            <span>
              {safePage + 1} / {pages}
            </span>
            <button
              disabled={safePage === pages - 1}
              onClick={() => setPage(safePage + 1)}
            >
              Next page
            </button>
          </div>
        </section>
      )}
      <section className="capture-controls">
        {active ? (
          <>
            <form
              className="capture-entry"
              onSubmit={(e) => {
                e.preventDefault();
                attempt(add);
              }}
            >
              <label htmlFor="depth">
                Depth (m)
                <input
                  id="depth"
                  aria-label="Fish finder depth"
                  ref={input}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.0"
                  value={depth}
                  onChange={(e) => setDepth(e.target.value)}
                />
              </label>
              <button
                className="primary add"
                disabled={!fresh || !validDepth(depth) || saving}
              >
                Add measurement
              </button>
            </form>
            <button
              className="end-session wide"
              disabled={saving}
              onClick={() => attempt(end)}
            >
              End and export session CSV
            </button>
          </>
        ) : (
          <>
            <button
              className="primary wide"
              disabled={!ready || saving || !fresh}
              onClick={() => {
                setSessionName(`Session ${new Date().toLocaleDateString()}`);
                setNaming(true);
              }}
            >
              Start session
            </button>
            {session && points.length > 0 && (
              <button className="wide download-session" onClick={exportSession}>
                Download session CSV
              </button>
            )}
          </>
        )}
        <p className="status" role="status">
          {saving ? "Saving…" : notice}
        </p>
      </section>
      {!active && state.sessions.length > 0 && (
        <details className="saved-capture">
          <summary>Saved sessions · {state.sessions.length}</summary>
          <label>
            Saved sessions
            <select
              aria-label="Saved sessions"
              value={state.current}
              disabled={saving}
              onChange={(e) => {
                const current = e.target.value;
                setPage(0);
                attempt(() => commit((s) => ({ ...s, current })));
              }}
            >
              <option value="">Choose session</option>
              {state.sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {new Date(s.startedAt).toLocaleDateString()}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            Saved on this device. Download CSV to import into Studio.
          </p>
        </details>
      )}
      {naming && (
        <div className="modal">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="session-title"
          >
            <h2 id="session-title">Name this session</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                attempt(start);
              }}
            >
              <label>
                Session name
                <input
                  autoFocus
                  required
                  maxLength={100}
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                />
              </label>
              <div className="actions">
                <button type="button" onClick={() => setNaming(false)}>
                  Cancel
                </button>
                <button
                  className="primary"
                  disabled={saving || !fresh || !sessionName.trim()}
                >
                  Begin session
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {selected && (
        <PointEditor
          key={selected.id}
          point={selected}
          onClose={() => setSelected(null)}
          onSave={(d) =>
            commit((s) => ({
              ...s,
              measurements: s.measurements.map((p) =>
                p.id === selected.id ? { ...p, depth: d } : p,
              ),
            }))
          }
          onDelete={() =>
            commit((s) => ({
              ...s,
              measurements: s.measurements.filter((p) => p.id !== selected.id),
            }))
          }
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Capture />);
