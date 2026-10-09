import { smoothSurface } from "../../packages/core/surface-smoothing";
import { contourMaximum } from "../../packages/core/filled-contours";
import { exportPDF } from "../../packages/core/export-pdf";
import { exportPNG } from "../../packages/core/export-image";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import SurveyMap, { type MapHandle } from "../../packages/ui/SurveyMap";
import { PointEditor } from "../../packages/ui/PointEditor";
import { useLocalState } from "../../packages/ui/local-state";
import {
  createProject,
  download,
  exportCSV,
  importCSV,
  parseProject,
  uid,
  type Project,
} from "../../packages/core/files";
import {
  analyze,
  inside,
  world,
  type Coord,
  type Measurement,
} from "../../packages/core/survey";
import { bounds, exteriorPoints } from "../../packages/core/geometry";
import { RADII } from "../../packages/core/settings";
import { bandCSS } from "../../packages/core/cartography";
import { resolveLake } from "../../packages/core/lake-provider";
import type { LakeSelection } from "../../packages/core/lake-selection";
import "../../packages/ui/style.css";
type Library = { projects: Project[]; current: string };
function Studio() {
  const { state, ready, error, saving, commit } = useLocalState<Library>(
    "studio",
    { projects: [], current: "" },
  );
  const [creating, setCreating] = useState(false),
    [selection, setSelection] = useState<LakeSelection | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [failure, setFailure] = useState(""),
    [view, setView] = useState("survey"),
    [selected, setSelected] = useState<Measurement | null>(null),
    [highlight, setHighlight] = useState(""),
    [page, setPage] = useState(0),
    [coordinate, setCoordinate] = useState("61.1235, 24.1235"),
    [camera, setCamera] = useState<MapHandle>({
      center: [24.1235, 61.1235],
      zoom: 13,
    });
  const [generated, setGenerated] = useState<{
    project: Project;
    model: ReturnType<typeof analyze>;
  } | null>(null);
  const lookup = useRef<AbortController | null>(null),
    lookupGeneration = useRef(0);
  const project = state.projects.find((p) => p.lake.id === state.current),
    points = project?.measurements ?? [];
  const coverage = useMemo(
    () =>
      project
        ? analyze(
            project.lake.boundary,
            project.measurements,
            false,
            project.settings.radius,
            project.settings,
          )
        : null,
    [project],
  );
  const fresh = !!generated && generated.project === project;
  const model = useMemo(
    () =>
      fresh
        ? smoothSurface(
            generated!.model,
            (project!.settings.smoothColors ?? true)
              ? (project!.settings.smoothing ?? 30)
              : 0,
          )
        : null,
    [fresh, generated, project],
  );
  const excluded = points.length - (coverage?.usable ?? 0),
    outside = project
      ? points.filter(
          (p) => !inside([p.longitude, p.latitude], project.lake.boundary),
        ).length
      : 0;
  async function run(fn: () => Promise<unknown>) {
    setFailure("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const update = (fn: (p: Project) => Project) =>
    commit((s) => ({
      ...s,
      projects: s.projects.map((p) =>
        p.lake.id === project?.lake.id ? fn(p) : p,
      ),
    }));
  function focus(p: Project) {
    const b = bounds(exteriorPoints(p.lake.boundary));
    const ext = exteriorPoints(p.lake.boundary);
    const size = document
      .querySelector(".map-surface")
      ?.getBoundingClientRect();
    let zoom = 18;
    while (zoom > 3) {
      const projected = bounds(ext.map((v) => world(v, zoom)));
      if (
        projected.maxX - projected.minX <
          (size?.width ?? Math.max(300, window.innerWidth - 450)) * 0.8 &&
        projected.maxY - projected.minY < (size?.height ?? 580) * 0.8
      )
        break;
      zoom--;
    }
    setCamera({ center: [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2], zoom });
    setView("survey");
    setPage(0);
    setCreating(false);
    setGenerated(null);
    setHighlight("");
    setSelected(null);
  }
  useEffect(() => {
    if (ready && project) focus(project);
  }, [ready, project?.lake.id]);
  async function addProject(p: Project) {
    await commit((s) => ({
      ...s,
      projects: [...s.projects.filter((v) => v.lake.id !== p.lake.id), p],
      current: p.lake.id,
    }));
    focus(p);
  }
  async function openDemo() {
    stopLookup();
    await run(async () => {
      const existing = state.projects.find(
        (p) => p.lake.id === "demo-kayralampi-v3",
      );
      if (existing) {
        await commit((s) => ({ ...s, current: existing.lake.id }));
        focus(existing);
      } else {
        const response = await fetch(
          new URL(
            "../../example-data/kayralampi.depthcalc.json",
            import.meta.url,
          ),
        );
        if (!response.ok)
          throw new Error("Demo lake unavailable. Please retry.");
        await addProject(parseProject(await response.text()));
      }
      setNotice(
        "Demo lake opened: real Käyrälampi shoreline, synthetic depths. Open Bathymetric chart and generate your map.",
      );
    });
  }
  async function pick(point: Coord) {
    lookup.current?.abort();
    const token = ++lookupGeneration.current,
      controller = new AbortController();
    lookup.current = controller;
    setSelection(null);
    setFailure("");
    setBusy(true);
    try {
      const lake = await resolveLake(point, controller.signal);
      if (token === lookupGeneration.current) {
        setSelection(lake);
        setNotice("Check the highlighted shoreline, then confirm the lake.");
      }
    } catch (e) {
      if (token === lookupGeneration.current && !controller.signal.aborted)
        setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      if (token === lookupGeneration.current) setBusy(false);
    }
  }
  function stopLookup() {
    lookup.current?.abort();
    lookupGeneration.current++;
    setBusy(false);
    setSelection(null);
  }
  async function importSessions(files: File[]) {
    if (!project) return;
    const additions: ReturnType<typeof importCSV>[] = [];
    for (const file of files) {
      if (file.size > 20 * 1024 * 1024)
        throw new Error(`${file.name}: CSV exceeds 20 MB`);
      try {
        additions.push(
          importCSV(await file.text(), project.lake.id, file.name),
        );
      } catch (e) {
        throw new Error(`${file.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    const all = additions.flatMap((a) => a.measurements);
    if (points.length + all.length > 100000)
      throw new Error("A project supports up to 100,000 measurements.");
    const signatures = new Set(
      points.map((p) =>
        [p.timestamp, p.latitude, p.longitude, p.depth, p.accuracy].join("|"),
      ),
    );
    let duplicates = 0;
    const measurements = all.filter((p) => {
      const key = [
        p.timestamp,
        p.latitude,
        p.longitude,
        p.depth,
        p.accuracy,
      ].join("|");
      if (signatures.has(key)) {
        duplicates++;
        return false;
      }
      signatures.add(key);
      return true;
    });
    const ids = new Set(measurements.map((p) => p.sessionId));
    await update((p) => ({
      ...p,
      sessions: [
        ...p.sessions,
        ...additions.flatMap((a) => a.sessions).filter((s) => ids.has(s.id)),
      ],
      measurements: [...p.measurements, ...measurements],
    }));
    setNotice(
      `Imported ${measurements.length} measurements from ${files.length} file(s). ${duplicates} exact duplicates skipped.`,
    );
    setPage(0);
  }
  function jump() {
    const pair = coordinate.split(",").map(Number);
    if (
      pair.length !== 2 ||
      !pair.every(Number.isFinite) ||
      Math.abs(pair[0]) > 85 ||
      Math.abs(pair[1]) > 180
    ) {
      setFailure("Enter latitude, longitude, for example 61.1235, 24.1235");
      return;
    }
    setCamera({ center: [pair[1], pair[0]], zoom: 14 });
  }
  function locate() {
    navigator.geolocation?.getCurrentPosition(
      (p) =>
        setCamera({
          center: [p.coords.longitude, p.coords.latitude],
          zoom: 14,
        }),
      () =>
        setFailure(
          "Location unavailable. Pan the map or enter coordinates instead.",
        ),
    );
  }
  const shown = highlight
    ? points.filter((p) => p.sessionId === highlight)
    : points;
  return (
    <main className="studio">
      <header>
        <a className="home-link" href="../../">
          ← Home page
        </a>
        <a className="brand" href="./">
          ◉ DepthCalc <span>Studio</span>
        </a>
        <span className="tag">LOCAL FIRST · NO ACCOUNT</span>
        <div className="header-actions">
          <button
            disabled={!ready || saving}
            onClick={() => {
              stopLookup();
              setCreating(true);
              setNotice("Click the water of the lake you want to survey.");
            }}
          >
            ＋ New lake project
          </button>
          <label className="button">
            Import project
            <input
              type="file"
              accept=".json"
              hidden
              disabled={!ready || busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f)
                  void run(async () => {
                    if (f.size > 40 * 1024 * 1024)
                      throw new Error("Project exceeds 40 MB");
                    const p = parseProject(await f.text());
                    if (state.projects.some((v) => v.lake.id === p.lake.id)) {
                      // Import as a separate local copy, preserving the original project.
                      const id = uid();
                      p.lake = {
                        ...p.lake,
                        id,
                        name: `${p.lake.name} (imported)`,
                      };
                      p.sessions = p.sessions.map((s) => ({
                        ...s,
                        lakeId: id,
                      }));
                      p.measurements = p.measurements.map((m) => ({
                        ...m,
                        lakeId: id,
                      }));
                    }
                    await addProject(p);
                    setNotice(
                      "Project restored, including sessions, shoreline and settings.",
                    );
                  });
                e.target.value = "";
              }}
            />
          </label>
          <button
            disabled={!ready || busy || saving}
            onClick={() => void openDemo()}
          >
            Open Demo Lake
          </button>
        </div>
      </header>
      <div className="studio-heading">
        <div>
          <p className="eyebrow">FROM SOUNDINGS TO SHORELINE</p>
          <h1>
            {creating
              ? "Find your lake."
              : (project?.lake.name ?? "A lake, one survey at a time.")}
          </h1>
          <p>
            {creating
              ? "Click a lake. Review its complete boundary. Start a project."
              : project
                ? `${points.length} measurements · ${project.sessions.length} sessions · ${((coverage?.area ?? 0) / 10000).toFixed(2)} ha estimated`
                : "Bring your sessions together and reveal the shape beneath the surface."}
          </p>
        </div>
        {state.projects.length > 0 && (
          <label>
            Local projects
            <select
              value={state.current}
              disabled={saving || busy}
              onChange={(e) => {
                const p = state.projects.find(
                  (p) => p.lake.id === e.target.value,
                )!;
                void run(async () => {
                  stopLookup();
                  await commit((s) => ({ ...s, current: p.lake.id }));
                  focus(p);
                });
              }}
            >
              {state.projects.map((p) => (
                <option key={p.lake.id} value={p.lake.id}>
                  {p.lake.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {(failure || error) && (
        <p className="alert" role="alert">
          {failure || error}
        </p>
      )}
      <p className="status" role="status">
        {busy
          ? "Working…"
          : saving
            ? "Saving locally…"
            : notice ||
              "All survey data stays in this browser. Export project files for backup."}
      </p>
      {!project && !creating ? (
        <section className="welcome panel">
          <div className="lake-illustration">≈</div>
          <h2>Make the next measurement count.</h2>
          <p>
            Choose a lake, import Capture CSV sessions, then explore coverage
            and create a bathymetric chart.
          </p>
          <div className="actions">
            <button
              className="primary"
              disabled={!ready}
              onClick={() => setCreating(true)}
            >
              Select a lake on the map
            </button>
            <button disabled={!ready || busy} onClick={() => void openDemo()}>
              Open example survey
            </button>
          </div>
          <p className="muted">
            Real Finnish lake shoreline with synthetic demo depths, for learning
            and testing.
          </p>
        </section>
      ) : (
        <>
          {creating && (
            <div className="search-line">
              <label>
                Go to latitude, longitude
                <input
                  value={coordinate}
                  onChange={(e) => setCoordinate(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") jump();
                  }}
                />
              </label>
              <button onClick={jump}>Go to coordinates</button>
              <p>Drag to pan · + / − to zoom · click water to select</p>
            </div>
          )}
          {!creating && (
            <nav className="tabs" aria-label="Survey views">
              {[
                ["survey", "Measurements"],
                ["coverage", "Coverage"],
                ["depth", "Bathymetric chart"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  aria-pressed={view === id}
                  onClick={() => setView(id)}
                >
                  {label}
                </button>
              ))}
            </nav>
          )}
          <div className="workspace">
            <div className="map-column" aria-busy={creating && busy}>
              {creating && busy && (
                <div className="lake-loading" role="status">
                  <span className="loading-spinner" />
                  Finding lake shoreline…
                  <small>Loading the water area and islands</small>
                </div>
              )}
              <SurveyMap
                boundary={
                  creating
                    ? (selection?.boundary ?? [])
                    : project!.lake.boundary
                }
                points={creating ? [] : points}
                position={null}
                selecting={creating}
                onLakeClick={(p) => void pick(p)}
                onSelect={setSelected}
                layer={creating ? "survey" : view}
                model={creating ? null : view === "depth" ? model : coverage}
                interval={project?.settings.interval ?? 2}
                smoothColors={project?.settings.smoothColors ?? true}
                camera={camera}
                onCamera={setCamera}
                onLocate={locate}
                selectedId={selected?.id}
                highlightedSession={highlight}
                osmBoundary={
                  creating ? !!selection?.source : !!project?.lake.source
                }
              />
              {view === "depth" && !creating && !model && (
                <p className="alert">
                  {generated
                    ? "Measurements or settings changed. Generate the chart again."
                    : "Choose settings and generate a chart. Unsupported areas remain unmapped."}
                </p>
              )}
            </div>
            <aside className="panel">
              {creating ? (
                <>
                  <p className="eyebrow">01 / SELECT</p>
                  <h2>{selection?.name ?? "Click the lake’s water"}</h2>
                  {selection ? (
                    <>
                      <label>
                        Project name
                        <input
                          value={selection.name}
                          maxLength={100}
                          onChange={(e) =>
                            setSelection({ ...selection, name: e.target.value })
                          }
                        />
                      </label>
                      <p>
                        {(selection.area / 10000).toFixed(1)} ha ·{" "}
                        {selection.islands} islands · {selection.parts} water
                        parts
                      </p>
                      <button
                        className="primary wide"
                        disabled={busy || saving || !selection.name.trim()}
                        onClick={() =>
                          void run(() =>
                            addProject(
                              createProject({
                                id: uid(),
                                name: selection.name.trim(),
                                boundary: selection.boundary,
                                source: selection.source,
                                createdAt: new Date().toISOString(),
                              }),
                            ),
                          )
                        }
                      >
                        Confirm lake & create project
                      </button>
                    </>
                  ) : (
                    <p>
                      DepthCalc retrieves the full mapped shoreline and
                      preserves islands. A land click will not select a nearby
                      lake.
                    </p>
                  )}
                  <p className="muted">
                    Lake lookup and background tiles need internet. OSM coverage
                    and public service availability vary.
                  </p>
                  <button
                    onClick={() => {
                      stopLookup();
                      setCreating(false);
                    }}
                  >
                    Cancel selection
                  </button>
                </>
              ) : (
                <>
                  {view === "survey" ? (
                    <>
                      <p className="eyebrow">01 / BRING YOUR DATA</p>
                      <h2>A shared survey</h2>
                      <p>
                        Import one or more CSV sessions. Every session
                        contributes to the same lake model.
                      </p>
                      <label className="button primary wide">
                        Import session CSVs
                        <input
                          type="file"
                          accept=".csv,text/csv"
                          multiple
                          hidden
                          disabled={busy || saving}
                          onChange={(e) => {
                            const files = Array.from(e.target.files ?? []);
                            if (files.length)
                              void run(() => importSessions(files));
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <p className="muted">
                        Required: timestamp, latitude, longitude, depth,
                        gps_accuracy.
                      </p>
                      <button
                        className="wide"
                        disabled={!points.length}
                        onClick={() =>
                          download(
                            `${project!.lake.name}-measurements.csv`,
                            exportCSV(points, true),
                            "text/csv;charset=utf-8",
                          )
                        }
                      >
                        Export combined CSV
                      </button>
                    </>
                  ) : view === "coverage" ? (
                    <>
                      <p className="eyebrow">02 / SEE THE GAPS</p>
                      <div className="big-percent">
                        {coverage!.coverage.toFixed(1)}
                        <span>%</span>
                      </div>
                      <h2>Covered water area</h2>
                      <div className="coverage-row">
                        <i className="good" />
                        Well covered
                        <strong>{coverage!.well.toFixed(1)}%</strong>
                      </div>
                      <div className="coverage-row">
                        <i className="poor" />
                        Poorly covered
                        <strong>
                          {(coverage!.coverage - coverage!.well).toFixed(1)}%
                        </strong>
                      </div>
                      <div className="coverage-row">
                        <i className="unknown" />
                        Unmapped
                        <strong>
                          {(100 - coverage!.coverage).toFixed(1)}%
                        </strong>
                      </div>
                      <p className="muted">
                        Estimated from {coverage!.step} × {coverage!.step} m
                        cells. A point within {project!.settings.coverageRadius}{" "}
                        m covers a cell; {project!.settings.goodCount} nearby
                        measurements make it well covered. Large lakes use a
                        coarser grid.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="eyebrow">03 / REVEAL THE DEPTH</p>
                      <h2>Bathymetric chart</h2>
                      <label>
                        Maximum interpolation radius
                        <select
                          value={project!.settings.radius}
                          disabled={busy || saving}
                          onChange={(e) => {
                            const value = Number(e.currentTarget.value);
                            void run(() =>
                              update((p) => ({
                                ...p,
                                settings: { ...p.settings, radius: value },
                              })),
                            );
                          }}
                        >
                          {RADII.map((n) => (
                            <option key={n} value={n}>
                              {n} m
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Contour interval{" "}
                        <strong>{project!.settings.interval} m</strong>
                        <input
                          aria-label="Contour interval"
                          type="range"
                          min="1"
                          max="6"
                          step="1"
                          value={project!.settings.interval}
                          onChange={(e) => {
                            const interval = Number(e.target.value);
                            void run(() =>
                              update((p) => ({
                                ...p,
                                settings: { ...p.settings, interval },
                              })),
                            );
                          }}
                        />
                        <span className="range-limits">
                          <span>1 m</span>
                          <span>6 m</span>
                        </span>
                      </label>
                      <label className="toggle-setting">
                        Smooth depth colors
                        <input
                          role="switch"
                          aria-label="Smooth depth colors"
                          type="checkbox"
                          checked={project!.settings.smoothColors ?? true}
                          onChange={(e) => {
                            const smoothColors = e.target.checked;
                            void run(() =>
                              update((p) => ({
                                ...p,
                                settings: { ...p.settings, smoothColors },
                              })),
                            );
                          }}
                        />
                        <span>
                          {(project!.settings.smoothColors ?? true)
                            ? "ON"
                            : "OFF"}
                        </span>
                      </label>
                      {(project!.settings.smoothColors ?? true) && (
                        <label>
                          Surface smoothing{" "}
                          <strong>{project!.settings.smoothing ?? 30} %</strong>
                          <input
                            aria-label="Surface smoothing"
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            value={project!.settings.smoothing ?? 30}
                            onChange={(e) => {
                              const smoothing = Number(e.target.value);
                              void run(() =>
                                update((p) => ({
                                  ...p,
                                  settings: { ...p.settings, smoothing },
                                })),
                              );
                            }}
                          />
                          <span className="range-limits">
                            <span>0 %</span>
                            <span>100 %</span>
                          </span>
                          <small>
                            Generalize the calculated surface. Original
                            measurements stay unchanged.
                          </small>
                        </label>
                      )}
                      <button
                        className="primary wide"
                        disabled={busy || saving || coverage!.usable < 3}
                        onClick={() =>
                          void run(async () => {
                            await new Promise((r) => setTimeout(r, 30));
                            const g = analyze(
                              project!.lake.boundary,
                              points,
                              true,
                              project!.settings.radius,
                              project!.settings,
                            );
                            g.coverage = coverage!.coverage;
                            g.well = coverage!.well;
                            setGenerated({ project: project!, model: g });
                            setNotice(
                              g.nodes.some((row) => row.some((v) => v !== null))
                                ? "Chart generated. Export PDF or PNG below."
                                : "No area has three distinct measurements within the selected radius. Add data or choose a larger radius.",
                            );
                          })
                        }
                      >
                        Generate bathymetric map
                      </button>
                      <p className="muted">
                        IDW requires 3 distinct nearby locations. Points beyond
                        the radius never affect the estimate. Hatched water has
                        insufficient data.
                      </p>
                      <div className="actions">
                        <button
                          disabled={!model || busy}
                          onClick={() =>
                            void run(async () => {
                              await exportPDF(
                                project!.lake,
                                points,
                                model!,
                                project!.settings.interval,
                              );
                            })
                          }
                        >
                          Export PDF
                        </button>
                        <button
                          disabled={!model || busy}
                          onClick={() =>
                            void run(async () => {
                              await exportPNG(
                                project!.lake,
                                points,
                                model!,
                                project!.settings.interval,
                              );
                            })
                          }
                        >
                          Export PNG
                        </button>
                      </div>
                      {model && (
                        <div className="band-legend">
                          {Array.from(
                            {
                              length:
                                Math.floor(
                                  contourMaximum(model) /
                                    project!.settings.interval,
                                ) + 1,
                            },
                            (_, i) => (
                              <span key={i}>
                                <i
                                  style={{
                                    background: bandCSS(
                                      i * project!.settings.interval,
                                      Math.max(1, contourMaximum(model)),
                                      project!.settings.interval,
                                    ),
                                  }}
                                />
                                {i * project!.settings.interval}–
                                {(i + 1) * project!.settings.interval} m
                              </span>
                            ),
                          )}
                        </div>
                      )}
                    </>
                  )}
                  <hr />
                  <label>
                    GPS accuracy filter
                    <select
                      value={project!.settings.gpsAccuracy}
                      disabled={saving || busy}
                      onChange={(e) => {
                        const value = Number(e.currentTarget.value);
                        void run(() =>
                          update((p) => ({
                            ...p,
                            settings: { ...p.settings, gpsAccuracy: value },
                          })),
                        );
                      }}
                    >
                      {[
                        ...new Set([
                          5,
                          10,
                          20,
                          35,
                          50,
                          100,
                          project!.settings.gpsAccuracy,
                        ]),
                      ]
                        .sort((a, b) => a - b)
                        .map((n) => (
                          <option key={n} value={n}>
                            ≤ {n} m
                          </option>
                        ))}
                    </select>
                  </label>
                  <p className="muted">
                    {coverage!.usable} usable · {excluded} excluded ({outside}{" "}
                    outside the lake). Raw measurements are retained.
                  </p>
                  <button
                    className="wide"
                    onClick={() =>
                      download(
                        `${project!.lake.name}.depthcalc.json`,
                        JSON.stringify(project, null, 2),
                        "application/json",
                      )
                    }
                  >
                    Export project
                  </button>
                  <p className="muted">
                    A portable backup of shoreline, sessions, measurements and
                    settings.
                  </p>
                </>
              )}
            </aside>
          </div>
          {!creating && (
            <>
              <section className="panel session-panel">
                <div className="section-title">
                  <h2>Imported sessions</h2>
                  <span>{project!.sessions.length} sessions</span>
                </div>
                {!project!.sessions.length && (
                  <p className="muted">Your imported files will appear here.</p>
                )}
                {project!.sessions.map((s) => (
                  <div className="session-row" key={s.id}>
                    <button
                      aria-pressed={highlight === s.id}
                      onClick={() => {
                        setHighlight((v) => (v === s.id ? "" : s.id));
                        setPage(0);
                      }}
                    >
                      <strong>{s.name}</strong>
                      <span>
                        {new Date(s.startedAt).toLocaleDateString()} ·{" "}
                        {points.filter((p) => p.sessionId === s.id).length}{" "}
                        points
                      </span>
                    </button>
                    <button
                      className="danger"
                      disabled={saving || busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Remove ${s.name} and its measurements from this project?`,
                          )
                        )
                          void run(async () => {
                            await update((p) => ({
                              ...p,
                              sessions: p.sessions.filter((v) => v.id !== s.id),
                              measurements: p.measurements.filter(
                                (m) => m.sessionId !== s.id,
                              ),
                            }));
                            setHighlight("");
                            setPage(0);
                          });
                      }}
                    >
                      Remove session
                    </button>
                  </div>
                ))}
              </section>
              <section className="panel">
                <div className="section-title">
                  <h2>
                    Raw measurements {highlight ? "· selected session" : ""}
                  </h2>
                  <span>{shown.length} points</span>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>Depth</th>
                        <th>GPS ±</th>
                        <th>Latitude, longitude</th>
                        <th>Use</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {shown.slice(page * 25, (page + 1) * 25).map((p) => (
                        <tr key={p.id}>
                          <td>{new Date(p.timestamp).toLocaleString()}</td>
                          <td>{p.depth.toFixed(1)} m</td>
                          <td>{p.accuracy.toFixed(1)} m</td>
                          <td>
                            {p.latitude.toFixed(6)}, {p.longitude.toFixed(6)}
                          </td>
                          <td>
                            {!inside(
                              [p.longitude, p.latitude],
                              project!.lake.boundary,
                            )
                              ? "Outside lake"
                              : p.accuracy > project!.settings.gpsAccuracy
                                ? "GPS excluded"
                                : "Included"}
                          </td>
                          <td>
                            <button onClick={() => setSelected(p)}>Edit</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {shown.length > 25 && (
                  <div className="actions">
                    <button
                      disabled={page === 0}
                      onClick={() => setPage((v) => v - 1)}
                    >
                      Previous
                    </button>
                    <span>
                      Page {page + 1} / {Math.ceil(shown.length / 25)}
                    </span>
                    <button
                      disabled={(page + 1) * 25 >= shown.length}
                      onClick={() => setPage((v) => v + 1)}
                    >
                      Next
                    </button>
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
      <footer>
        DepthCalc Studio · Survey estimates, not a navigation chart. Local data
        is specific to this browser and origin.
      </footer>
      {selected && project && (
        <PointEditor
          key={selected.id}
          point={selected}
          onClose={() => setSelected(null)}
          onSave={(depth) =>
            update((p) => ({
              ...p,
              measurements: p.measurements.map((m) =>
                m.id === selected.id ? { ...m, depth } : m,
              ),
            }))
          }
          onDelete={() =>
            update((p) => ({
              ...p,
              measurements: p.measurements.filter((m) => m.id !== selected.id),
            }))
          }
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Studio />);
