import { filledContours, contourMaximum } from "./filled-contours";
import { extendShoreField } from "./shore-field";
import { bandColor, joinContours, mapLabels, deepSpots } from "./cartography";
import { rings } from "./geometry";
import { jsPDF } from "jspdf";
import {
  analyze,
  contours,
  type Lake,
  type Measurement,
  type Coord,
} from "./survey";
export function createPDF(
  lake: Lake,
  points: Measurement[],
  model: ReturnType<typeof analyze>,
  interval: number,
  region?: Coord[],
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const poly = model.poly;
  const area = region?.map(model.proj.to) || poly;
  const minX = Math.min(...area.map((p) => p[0])),
    maxX = Math.max(...area.map((p) => p[0])),
    minY = Math.min(...area.map((p) => p[1])),
    maxY = Math.max(...area.map((p) => p[1]));
  if (maxX - minX < 1 || maxY - minY < 1)
    throw new Error("Select a larger print area.");
  const w = 267,
    h = 133,
    k = Math.min(w / (maxX - minX), h / (maxY - minY));
  const ox = 15 + (w - (maxX - minX) * k) / 2,
    oy = 43 + (h - (maxY - minY) * k) / 2;
  const p = (v: Coord): Coord => [
    ox + (v[0] - minX) * k,
    oy + (maxY - v[1]) * k,
  ];
  doc.setTextColor(23, 60, 64);
  doc.setFontSize(22);
  doc.setFontSize(
    Math.min(22, (22 * 267) / Math.max(1, doc.getTextWidth(lake.name))),
  );
  doc.text(lake.name, 15, 19);
  doc.setFontSize(10);
  doc.text(
    `Contours ${interval} m  |  Measurements ${points.length}  |  Coverage ${model.coverage.toFixed(0)} %`,
    15,
    28,
  );
  const dates = points.map((x) => x.timestamp).sort();
  doc.text(
    `Survey dates: ${dates.length ? new Date(dates[0]).toLocaleDateString("en-GB") + " – " + new Date(dates.at(-1)!).toLocaleDateString("en-GB") : "–"}`,
    15,
    35,
  );
  doc.saveGraphicsState();
  doc.rect(15, 43, w, h, null);
  doc.clip();
  doc.discardPath();
  doc.setFillColor(241, 236, 215);
  doc.rect(15, 43, w, h, "F");
  doc.rect(ox, oy, (maxX - minX) * k, (maxY - minY) * k, null);
  doc.clip();
  doc.discardPath();
  const shape: { op: string; c: number[] }[] = rings(model.geometry).flatMap(
    (ring) => [
      ...ring.map((v, i) => ({ op: i ? "l" : "m", c: p(v) })),
      { op: "h", c: [] },
    ],
  );
  doc.path(shape);
  doc.clipEvenOdd();
  doc.discardPath();
  doc.setFillColor(214, 229, 229);
  doc.rect(15, 43, w, h, "F");
  const max = Math.max(1, contourMaximum(model)),
    smooth = model.settings.smoothColors ?? true,
    extension = smooth ? extendShoreField(model) : [];
  if (smooth)
    for (const band of filledContours(model, interval, extension)) {
      doc.setFillColor(...bandColor(band.level, max, interval));
      doc.path(
        band.rings.flatMap((r) => [
          ...r.map((v, i) => ({ op: i ? "l" : "m", c: p(v) })),
          { op: "h", c: [] },
        ]),
      );
      doc.fillEvenOdd();
    }
  else
    for (const cell of model.cells) {
      if (cell.value === null) continue;
      const a = p([cell.x - model.step / 2, cell.y + model.step / 2]);
      doc.setFillColor(...bandColor(cell.value, max, interval));
      doc.rect(a[0], a[1], model.step * k + 0.05, model.step * k + 0.05, "F");
    }
  doc.setDrawColor(43, 113, 141);
  doc.setLineWidth(0.12);
  const curves = joinContours(contours(model, interval, extension));
  for (const curve of curves) {
    doc.setLineWidth(curve.level % 10 === 0 ? 0.3 : 0.12);
    for (let i = 1; i < curve.points.length; i++) {
      const a = p(curve.points[i - 1]),
        b = p(curve.points[i]);
      doc.line(a[0], a[1], b[0], b[1]);
    }
  }
  doc.setFontSize(7);
  const labels = mapLabels(
    joinContours(contours(model, interval)),
    (v) => {
      const a = p(v);
      return [(a[0] - 15) * 4, (a[1] - 43) * 4];
    },
    deepSpots(points, model.proj.to, model.radius, model.settings.gpsAccuracy),
    w * 4,
    h * 4,
  );
  for (const l of labels) {
    const x = 15 + l.position[0] / 4,
      y = 43 + l.position[1] / 4;
    doc.setFillColor(245, 250, 252);
    doc.roundedRect(
      x - doc.getTextWidth(l.text) / 2 - 0.7,
      y - 1.5,
      doc.getTextWidth(l.text) + 1.4,
      3,
      0.6,
      0.6,
      "F",
    );
    doc.text(l.text, x, y + 0.8, { align: "center" });
  }
  doc.restoreGraphicsState();
  doc.saveGraphicsState();
  doc.rect(ox, oy, (maxX - minX) * k, (maxY - minY) * k, null);
  doc.clip();
  doc.discardPath();
  doc.setDrawColor(45, 105, 118);
  doc.setLineWidth(0.25);
  doc.path(shape);
  doc.stroke();
  doc.restoreGraphicsState();
  doc.setFontSize(10);
  doc.text("N", 277, 50);
  doc.setLineWidth(0.4);
  doc.line(278, 63, 278, 53);
  doc.line(278, 53, 276, 57);
  doc.line(278, 53, 280, 57);
  const meters = 10 ** Math.floor(Math.log10(40 / k));
  doc.line(18, 171, 18 + meters * k, 171);
  doc.line(18, 169, 18, 172);
  doc.line(18 + meters * k, 169, 18 + meters * k, 172);
  doc.setFontSize(8);
  doc.text(`${meters} m`, 18, 167);
  doc.text("Shallow", 15, 185);
  const bands = Math.floor(max / interval) + 1;
  for (let i = 0; i < bands; i++) {
    doc.setFillColor(...bandColor(i * interval, max, interval));
    doc.rect(32 + (i * 80) / bands, 181, 80 / bands, 5, "F");
  }
  doc.text(`${max.toFixed(1)} m`, 116, 185);
  doc.text("Grey: insufficient nearby measurements", 155, 185);
  doc.setFontSize(8);
  doc.text(
    `IDW radius ${model.radius} m · minimum 3 distinct locations · Bands ${interval} m · Not for navigation · DepthCalc`,
    15,
    198,
  );
  if (lake.source) {
    doc.setFontSize(7);
    doc.text("Shoreline © OpenStreetMap contributors (ODbL)", 15, 203);
    doc.link(15, 200, 90, 4, {
      url: "https://www.openstreetmap.org/copyright",
    });
  }
  return doc;
}
export async function exportPDF(
  lake: Lake,
  points: Measurement[],
  model: ReturnType<typeof analyze>,
  interval: number,
) {
  const doc = createPDF(lake, points, model, interval);
  doc.save(`${lake.name.replace(/[^\p{L}\p{N}_-]/gu, "_")}-bathymetry.pdf`);
}
