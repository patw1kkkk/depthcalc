"use client";
import { useEffect, useMemo, useState, type RefObject } from "react";
import { depthSampler } from "../core/sample-depth";
import { unworld, type analyze, type Coord } from "../core/survey";
import type { ScalarTriangle } from "../core/shore-field";

/** Pointer state stays here so moving the mouse never rerenders the map. */
export function DepthReadout({
  container,
  model,
  smooth,
  extension,
  zoom,
  left,
  top,
}: {
  container: RefObject<HTMLDivElement | null>;
  model: ReturnType<typeof analyze>;
  smooth: boolean;
  extension: ScalarTriangle[];
  zoom: number;
  left: number;
  top: number;
}) {
  const [pointer, setPointer] = useState<Coord | null>(null);
  const sample = useMemo(
    () => depthSampler(model, smooth, extension),
    [model, smooth, extension],
  );
  useEffect(() => {
    const svg = container.current?.querySelector(":scope > svg");
    if (!svg) return;
    let frame = 0;
    const clear = () => {
      cancelAnimationFrame(frame);
      setPointer(null);
    };
    const move = (event: Event) => {
      const e = event as PointerEvent;
      if (e.pointerType === "touch" || e.buttons) {
        clear();
        return;
      }
      const { clientX, clientY } = e;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = svg.getBoundingClientRect();
        setPointer([clientX - r.left, clientY - r.top]);
      });
    };
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerup", move);
    svg.addEventListener("pointerleave", clear);
    svg.addEventListener("pointerdown", clear);
    svg.addEventListener("pointercancel", clear);
    return () => {
      cancelAnimationFrame(frame);
      svg.removeEventListener("pointermove", move);
      svg.removeEventListener("pointerup", move);
      svg.removeEventListener("pointerleave", clear);
      svg.removeEventListener("pointerdown", clear);
      svg.removeEventListener("pointercancel", clear);
    };
  }, [container]);
  if (!pointer) return null;
  const depth = sample(
    model.proj.to(unworld([left + pointer[0], top + pointer[1]], zoom)),
  );
  return (
    <div className="depth-readout">
      <span>Estimated depth</span>
      <strong>
        {depth === null
          ? "No data"
          : `${depth.toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m`}
      </strong>
    </div>
  );
}
