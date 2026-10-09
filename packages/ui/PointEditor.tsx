import { useState } from "react";
import type { Measurement } from "../core/survey";
import { validDepth } from "../core/files";
export function PointEditor({
  point,
  onSave,
  onDelete,
  onClose,
}: {
  point: Measurement;
  onSave: (depth: number) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(String(point.depth)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal">
      <section role="dialog" aria-modal="true" aria-labelledby="edit-title">
        <h2 id="edit-title">Edit measurement</h2>
        <p>
          {new Date(point.timestamp).toLocaleString()} · GPS ±
          {point.accuracy.toFixed(1)} m
        </p>
        <p>
          {point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}
        </p>
        <label>
          Depth (m)
          <input
            autoFocus
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="actions">
          <button
            className="primary"
            disabled={busy || !validDepth(value)}
            onClick={() => act(() => onSave(Number(value.replace(",", "."))))}
          >
            Save correction
          </button>
          <button
            className="danger"
            disabled={busy}
            onClick={() => act(onDelete)}
          >
            Delete measurement
          </button>
          <button disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}
