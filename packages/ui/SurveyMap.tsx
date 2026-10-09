"use client";
import { useRef, useState, useEffect, useMemo } from "react";
import { Plus, Minus, LocateFixed, Maximize, Navigation } from "lucide-react";
import { DepthReadout } from "./depth-readout";
import { DepthGrid } from "./depth-grid";
import { extendShoreField } from "../core/shore-field";
import { filledContours, contourMaximum } from "../core/filled-contours";
import {
  bandCSS,
  joinContours,
  mapLabels,
  deepSpots,
  coverageColors,
} from "../core/cartography";
import { rings, exteriorPoints, bounds, type Boundary } from "../core/geometry";
import {
  world,
  unworld,
  analyze,
  contours,
  type Coord,
  type Measurement,
} from "../core/survey";
export type MapHandle = { center: Coord; zoom: number };
export default function SurveyMap({
  boundary,
  points,
  position,
  selecting,
  onLakeClick,
  onSelect,
  layer,
  model,
  interval = 2,
  smoothColors = false,
  camera,
  onCamera,
  onLocate,
  selectedId,
  clipBox,
  onClip,
  currentSession,
  highlightedSession,
  osmBoundary,
}: {
  boundary: Boundary;
  points: Measurement[];
  position: GeolocationPosition | null;
  selecting?: boolean;
  onLakeClick?: (p: Coord) => void;
  onSelect?: (p: Measurement) => void;
  layer: string;
  model?: ReturnType<typeof analyze> | null;
  interval?: number;
  smoothColors?: boolean;
  camera: MapHandle;
  onCamera: (v: MapHandle) => void;
  onLocate: () => void;
  selectedId?: string;
  currentSession?: string;
  highlightedSession?: string;
  osmBoundary?: boolean;
  clipBox?: Coord[];
  onClip?: (p: Coord) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [tileError, setTileError] = useState(false);
  const [size, setSize] = useState({ w: 900, h: 580 });
  const drag = useRef<{
    x: number;
    y: number;
    center: Coord;
    px: Coord;
  } | null>(null);
  useEffect(() => {
    const ob = new ResizeObserver((e) =>
      setSize({ w: e[0].contentRect.width, h: e[0].contentRect.height }),
    );
    if (ref.current) ob.observe(ref.current);
    return () => ob.disconnect();
  }, []);
  const center = world(camera.center, camera.zoom),
    left = center[0] - size.w / 2,
    top = center[1] - size.h / 2;
  const screen = (p: Coord): Coord => {
    const v = world(p, camera.zoom);
    return [v[0] - left, v[1] - top];
  };
  const path = (a: Coord[]) =>
    a.map((p, i) => `${i ? "L" : "M"}${screen(p).join(",")}`).join(" ") + "Z";
  const shoreline = rings(boundary).map(path).join(" ");
  const exterior = exteriorPoints(boundary);
  const tiles = [];
  for (
    let y = Math.floor(top / 256);
    y <= Math.floor((top + size.h) / 256);
    y++
  )
    for (
      let x = Math.floor(left / 256);
      x <= Math.floor((left + size.w) / 256);
      x++
    ) {
      const n = 2 ** camera.zoom;
      if (y >= 0 && y < n)
        tiles.push({
          x,
          y,
          url: `https://tile.openstreetmap.org/${camera.zoom}/${((x % n) + n) % n}/${y}.png`,
        });
    }
  const extension = useMemo(
    () =>
      model && layer === "depth" && smoothColors ? extendShoreField(model) : [],
    [model, layer, smoothColors],
  );
  const fills = useMemo(
    () =>
      model && layer === "depth" && smoothColors
        ? filledContours(model, interval, extension)
        : null,
    [model, layer, interval, smoothColors, extension],
  );
  const lines = useMemo(
    () =>
      model && layer === "depth" ? contours(model, interval, extension) : [],
    [model, layer, interval, extension],
  );
  const curves = useMemo(() => joinContours(lines), [lines]);
  const labelCurves = useMemo(
    () =>
      model && layer === "depth" ? joinContours(contours(model, interval)) : [],
    [model, layer, interval],
  );
  const labels = useMemo(
    () =>
      model && layer === "depth"
        ? mapLabels(
            labelCurves,
            (p) => screen(model.proj.from(p)),
            deepSpots(
              points,
              model.proj.to,
              model.radius,
              model.settings.gpsAccuracy,
            ),
            size.w,
            size.h,
            [
              { x: 100, y: 24, w: 200, h: 48 },
              { x: size.w - 32, y: 85, w: 64, h: 170 },
              { x: 50, y: size.h - 22, w: 100, h: 44 },
              { x: size.w - 35, y: size.h - 48, w: 70, h: 96 },
            ],
          )
        : [],
    [labelCurves, model, points, layer, camera, size],
  );
  const max = model ? Math.max(1, contourMaximum(model)) : 1;
  const depth = layer === "depth";
  const radius = position
    ? position.coords.accuracy /
      ((156543.03392 * Math.cos((position.coords.latitude * Math.PI) / 180)) /
        2 ** camera.zoom)
    : 0;
  const fit = () => {
    if (!exterior.length) return;
    const box = bounds(exterior),
      center: Coord = [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2];
    let z = 18;
    while (z > 3) {
      const b = bounds(exterior.map((p) => world(p, z)));
      if (b.maxX - b.minX < size.w * 0.8 && b.maxY - b.minY < size.h * 0.8)
        break;
      z--;
    }
    onCamera({ center, zoom: z });
  };
  const scaleMeters =
    ((156543.03392 * Math.cos((camera.center[1] * Math.PI) / 180)) /
      2 ** camera.zoom) *
    100;
  const scaleNice = 10 ** Math.floor(Math.log10(scaleMeters));
  const scalePx = (scaleNice / scaleMeters) * 100;
  return (
    <div
      className={"map-surface " + (selecting ? "selecting-lake" : "")}
      ref={ref}
    >
      {!depth && (
        <div className="map-tiles">
          {tiles.map((t) => (
            <img
              alt=""
              draggable={false}
              key={`${t.x}-${t.y}`}
              src={t.url}
              onError={() => setTileError(true)}
              style={{
                position: "absolute",
                left: t.x * 256 - left,
                top: t.y * 256 - top,
                width: 256,
                height: 256,
                maxWidth: "none",
              }}
            />
          ))}
        </div>
      )}
      <svg
        role="img"
        aria-label={
          depth
            ? "Bathymetric chart"
            : selecting
              ? "Click the lake water. Drag to move the map."
              : "Survey map. Drag to move the map."
        }
        width="100%"
        height="100%"
        viewBox={`0 0 ${size.w} ${size.h}`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            center: camera.center,
            px: center,
          };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const d = drag.current;
          if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5)
            onCamera({
              ...camera,
              center: unworld(
                [d.px[0] - (e.clientX - d.x), d.px[1] - (e.clientY - d.y)],
                camera.zoom,
              ),
            });
        }}
        onPointerUp={(e) => {
          if (!drag.current) return;
          const d = drag.current;
          drag.current = null;
          if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) {
            const r = e.currentTarget.getBoundingClientRect();
            const p = unworld(
              [left + e.clientX - r.left, top + e.clientY - r.top],
              camera.zoom,
            );
            if (onClip) onClip(p);
            else if (selecting) onLakeClick?.(p);
          }
        }}
        onPointerCancel={() => (drag.current = null)}
        style={{ touchAction: "none" }}
      >
        <defs>
          <clipPath id="lake-clip">
            <path d={shoreline} clipRule="evenodd" fillRule="evenodd" />
          </clipPath>
          <pattern
            id="unknown"
            width="10"
            height="10"
            patternUnits="userSpaceOnUse"
          >
            <rect width="10" height="10" fill="#dfebeb" />
            <path d="M0 10L10 0" stroke="#afc6c6" strokeWidth=".6" />
          </pattern>
        </defs>
        <rect
          width={size.w}
          height={size.h}
          fill={depth ? "#f1ecd7" : "transparent"}
        />
        {exterior.length > 2 && (
          <path
            d={shoreline}
            fillRule="evenodd"
            fill={
              depth ? "url(#unknown)" : selecting ? "#198f8c50" : "#198f8c18"
            }
            stroke="#267e7c"
            strokeWidth="2"
          />
        )}
        {model && (layer === "coverage" || depth) && (
          <g clipPath="url(#lake-clip)">
            {fills ? (
              fills.map((band) => (
                <path
                  key={band.level}
                  data-depth-band={band.level}
                  d={band.rings
                    .map((ring) => path(ring.map(model.proj.from)))
                    .join(" ")}
                  fill={bandCSS(band.level, max, interval)}
                  fillRule="evenodd"
                />
              ))
            ) : depth ? (
              <DepthGrid
                model={model}
                interval={interval}
                zoom={camera.zoom}
                left={left}
                top={top}
                width={size.w}
                height={size.h}
              />
            ) : (
              model.cells.map((c, i) => {
                const a = screen(
                    model.proj.from([
                      c.x - model.step / 2,
                      c.y + model.step / 2,
                    ]),
                  ),
                  b = screen(
                    model.proj.from([
                      c.x + model.step / 2,
                      c.y - model.step / 2,
                    ]),
                  );
                return (
                  <rect
                    key={i}
                    x={a[0]}
                    y={a[1]}
                    width={Math.abs(b[0] - a[0]) + 0.5}
                    height={Math.abs(b[1] - a[1]) + 0.5}
                    fill={
                      depth
                        ? c.value === null
                          ? "url(#unknown)"
                          : bandCSS(c.value, max, interval)
                        : c.count >= 3
                          ? coverageColors["Hyvä"]
                          : c.count >= 2
                            ? coverageColors["Kohtalainen"]
                            : c.count
                              ? coverageColors["Vähän"]
                              : "#df796830"
                    }
                    opacity={depth ? 1 : 0.62}
                  />
                );
              })
            )}
            {depth &&
              curves.map((curve, i) => (
                <path
                  key={i}
                  d={curve.points
                    .map(
                      (p, j) =>
                        `${j ? "L" : "M"}${screen(model.proj.from(p)).join(",")}`,
                    )
                    .join(" ")}
                  fill="none"
                  stroke="#306b85"
                  strokeWidth={curve.level % 10 === 0 ? 1.35 : 0.6}
                  strokeLinejoin="round"
                  opacity={curve.level % 10 === 0 ? 0.95 : 0.75}
                />
              ))}
            {depth &&
              labels.map((label, i) => (
                <text
                  key={i}
                  x={label.position[0]}
                  y={label.position[1]}
                  transform={`rotate(${label.angle} ${label.position.join(" ")})`}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={label.spot ? 12 : 11}
                  fontWeight={label.spot || label.level! % 10 === 0 ? 600 : 400}
                  paintOrder="stroke"
                  stroke="#f4f9fb"
                  strokeWidth="3.5"
                  strokeLinejoin="round"
                  fill="#204b63"
                >
                  {label.text}
                </text>
              ))}
          </g>
        )}
        {!depth &&
          points.map((p) => {
            const c = screen([p.longitude, p.latitude]);
            return (
              <g
                key={p.id}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect?.(p);
                }}
                style={{ cursor: "pointer" }}
              >
                <circle cx={c[0]} cy={c[1]} r="13" fill="transparent" />
                <circle
                  cx={c[0]}
                  cy={c[1]}
                  r={selectedId === p.id ? 7 : 4}
                  fill={
                    p.sessionId === highlightedSession
                      ? "#d83232"
                      : p.accuracy > 35
                        ? "#bb5440"
                        : p.sessionId === currentSession
                          ? "#ef9a38"
                          : "#137a70"
                  }
                  stroke="white"
                  strokeWidth="1.5"
                />
                <title>
                  {p.depth} m · ±{p.accuracy.toFixed(1)} m
                </title>
              </g>
            );
          })}

        {position &&
          !depth &&
          (() => {
            const c = screen([
              position.coords.longitude,
              position.coords.latitude,
            ]);
            return (
              <g>
                <circle
                  cx={c[0]}
                  cy={c[1]}
                  r={Math.max(10, radius)}
                  fill="#397eef20"
                  stroke="#397eef60"
                />
                <circle
                  cx={c[0]}
                  cy={c[1]}
                  r="7"
                  fill="#387ad4"
                  stroke="white"
                  strokeWidth="3"
                />
              </g>
            );
          })()}
        {clipBox?.length === 2 && (
          <path
            d={path([
              clipBox[0],
              [clipBox[1][0], clipBox[0][1]],
              clipBox[1],
              [clipBox[0][0], clipBox[1][1]],
            ])}
            stroke="#d65d32"
            strokeWidth="2"
            fill="#ffffff30"
          />
        )}
      </svg>
      {depth && model && (
        <DepthReadout
          container={ref}
          model={model}
          smooth={smoothColors}
          extension={extension}
          zoom={camera.zoom}
          left={left}
          top={top}
        />
      )}
      {tileError && !depth && (
        <div className="tile-error">
          Basemap could not load. Check your connection.
        </div>
      )}
      <div className="map-badge">
        <span className="live-dot" />
        {selecting
          ? "SELECT LAKE"
          : depth
            ? "BATHYMETRIC CHART"
            : layer === "coverage"
              ? "SURVEY COVERAGE"
              : "SURVEY MAP"}
      </div>
      <div className="map-buttons">
        <button
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() =>
            onCamera({ ...camera, zoom: Math.min(19, camera.zoom + 1) })
          }
        >
          <Plus />
        </button>
        <button
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() =>
            onCamera({ ...camera, zoom: Math.max(3, camera.zoom - 1) })
          }
        >
          <Minus />
        </button>
        <button title="Fit lake" aria-label="Fit lake" onClick={fit}>
          <Maximize />
        </button>
        <button title="My location" aria-label="My location" onClick={onLocate}>
          <LocateFixed />
        </button>
      </div>
      <div className="north">
        <Navigation size={20} />
        <span>N</span>
      </div>
      <div className="scale">
        <span style={{ width: scalePx }} />
        {scaleNice >= 1000 ? `${scaleNice / 1000} km` : `${scaleNice} m`}
      </div>
      {(!depth || osmBoundary) && (
        <a
          className="attribution"
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          {depth ? "Shoreline © OpenStreetMap" : "© OpenStreetMap"}
        </a>
      )}
      {!selecting && layer === "coverage" && (
        <div className="map-legend">
          <i style={{ background: coverageColors["Hyvä"] }} /> Good{" "}
          <i style={{ background: coverageColors["Kohtalainen"] }} /> Moderate{" "}
          <i style={{ background: coverageColors["Vähän"] }} /> Low{" "}
          <i style={{ background: coverageColors["Ei dataa"] }} /> No data
        </div>
      )}
    </div>
  );
}
