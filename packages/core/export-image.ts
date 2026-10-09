import { bandCSS, joinContours, mapLabels, deepSpots } from "./cartography";
import { rings, bounds } from "./geometry";
import {
  contours,
  type analyze,
  type Coord,
  type Lake,
  type Measurement,
} from "./survey";
import { filledContours, contourMaximum } from "./filled-contours";
import { extendShoreField } from "./shore-field";
import { download } from "./files";
const escape = (text: string) =>
  text.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
/** Self-contained chart: no remote tiles or fonts, so canvas export cannot be tainted. */
export function chartSVG(
  lake: Lake,
  points: Measurement[],
  model: ReturnType<typeof analyze>,
  interval: number,
) {
  const width = 1600,
    height = 1100,
    margin = 70,
    mapW = 1460,
    mapH = 740;
  const box = bounds(model.poly),
    fullWidth = box.maxX - box.minX,
    fullHeight = box.maxY - box.minY;
  const k = Math.min(mapW / fullWidth, mapH / fullHeight),
    ox = margin + (mapW - fullWidth * k) / 2,
    oy = 150 + (mapH - fullHeight * k) / 2;
  const p = (v: Coord): Coord => [
    ox + (v[0] - box.minX) * k,
    oy + (box.maxY - v[1]) * k,
  ];
  const path = (pts: Coord[], close = false) =>
    pts.map((v, i) => `${i ? "L" : "M"}${p(v).join(",")}`).join(" ") +
    (close ? "Z" : "");
  const shore = rings(model.geometry)
      .map((r) => path(r, true))
      .join(" "),
    max = Math.max(1, contourMaximum(model));
  const smooth = model.settings.smoothColors ?? true,
    extension = smooth ? extendShoreField(model) : [];
  const curves = joinContours(contours(model, interval, extension));
  const labels = mapLabels(
    joinContours(contours(model, interval)),
    (v) => {
      const q = p(v);
      return [q[0] - margin, q[1] - 150];
    },
    deepSpots(points, model.proj.to, model.radius, model.settings.gpsAccuracy),
    mapW,
    mapH,
  );
  const bands = smooth
    ? filledContours(model, interval, extension)
        .map(
          (b) =>
            `<path d="${b.rings.map((r) => path(r, true)).join(" ")}" fill="${bandCSS(b.level, max, interval)}" fill-rule="evenodd"/>`,
        )
        .join("")
    : model.cells
        .filter((c) => c.value !== null)
        .map((c) => {
          const a = p([c.x - model.step / 2, c.y + model.step / 2]);
          return `<rect x="${a[0]}" y="${a[1]}" width="${model.step * k + 0.05}" height="${model.step * k + 0.05}" fill="${bandCSS(c.value!, max, interval)}"/>`;
        })
        .join("");
  const lines = curves
    .map(
      (c) =>
        `<path d="${path(c.points)}" fill="none" stroke="#306b85" stroke-width="${c.level % 10 === 0 ? 1.5 : 0.7}"/>`,
    )
    .join("");
  const text = labels
    .map((l) => {
      const x = l.position[0] + margin,
        y = l.position[1] + 150;
      return `<text x="${x}" y="${y}" transform="rotate(${l.angle} ${x} ${y})" text-anchor="middle" dominant-baseline="central" font-size="14" paint-order="stroke" stroke="#f4f9fb" stroke-width="4" fill="#204b63">${l.text}</text>`;
    })
    .join("");
  const count = Math.floor(max / interval) + 1,
    sw = Math.min(90, 1000 / count);
  const legend = Array.from(
    { length: count },
    (_, i) =>
      `<rect x="${margin + i * sw}" y="950" width="${sw}" height="20" fill="${bandCSS(i * interval, max, interval)}"/>${count <= 16 || i % Math.ceil(count / 16) === 0 ? `<text x="${margin + i * sw}" y="992" font-size="13">${i * interval} m</text>` : ""}`,
  ).join("");
  const scale = 10 ** Math.floor(Math.log10(180 / k));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial,sans-serif" fill="#173c40"><rect width="1600" height="1100" fill="white"/><text x="70" y="66" font-size="36">${escape(lake.name)}</text><text x="70" y="108" font-size="19">DepthCalc · ${points.length} measurements · Coverage ${model.coverage.toFixed(1)}% · Contours ${interval} m</text><defs><clipPath id="water"><path d="${shore}" clip-rule="evenodd"/></clipPath><pattern id="unknown" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#dfebeb"/><path d="M0 12L12 0" stroke="#afc6c6"/></pattern></defs><rect x="70" y="150" width="1460" height="740" fill="#f1ecd7"/><path d="${shore}" fill="url(#unknown)" fill-rule="evenodd"/><g clip-path="url(#water)">${bands}${lines}${text}</g><path d="${shore}" fill="none" stroke="#2d6976" stroke-width="1.5"/><text x="1490" y="185" font-size="22">N</text><path d="M1498 240V200l-8 15m8-15 8 15" stroke="#173c40" stroke-width="2" fill="none"/><path d="M90 850v10h${scale * k}v-10" stroke="#173c40" stroke-width="2" fill="none"/><text x="90" y="840" font-size="15">${scale} m</text><text x="70" y="927" font-size="18">Depth bands · metres</text>${legend}<text x="1130" y="966" font-size="16">Hatched: insufficient data</text><text x="70" y="1040" font-size="16">IDW radius ${model.radius} m · Minimum 3 distinct locations · GPS ≤ ${model.settings.gpsAccuracy} m · Not for navigation</text><text x="70" y="1074" font-size="14">${lake.source ? "Shoreline © OpenStreetMap contributors (ODbL)" : "Synthetic example shoreline"} · DepthCalc</text></svg>`;
}
export async function exportPNG(
  lake: Lake,
  points: Measurement[],
  model: ReturnType<typeof analyze>,
  interval: number,
) {
  const svg = chartSVG(lake, points, model, interval),
    url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 1650;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image export unavailable");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))),
        "image/png",
      ),
    );
    download(`${lake.name}-bathymetry.png`, blob);
  } finally {
    URL.revokeObjectURL(url);
  }
}
