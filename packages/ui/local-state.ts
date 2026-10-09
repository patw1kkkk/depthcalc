import { useEffect, useRef, useState } from "react";
import { readLocal, writeLocal } from "../core/storage";
/** Commit UI changes only after the IndexedDB transaction completes. Serialize rapid edits. */
export function useLocalState<T>(key: string, initial: T) {
  const [state, setState] = useState(initial),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const current = useRef(initial),
    queue = useRef(Promise.resolve());
  useEffect(() => {
    let mounted = true;
    readLocal<T>(key)
      .then((value) => {
        if (mounted) {
          current.current = value ?? initial;
          setState(current.current);
          setReady(true);
        }
      })
      .catch((e) =>
        setError(
          `Cannot open local storage: ${e.message}. Enable browser storage and reload.`,
        ),
      );
    return () => {
      mounted = false;
    };
  }, [key]);
  const commit = (update: (s: T) => T) => {
    setSaving(true);
    const next = queue.current.then(async () => {
      const value = update(current.current);
      await writeLocal(key, value);
      current.current = value;
      setState(value);
      setError("");
    });
    queue.current = next
      .catch((e) =>
        setError(`Not saved: ${e.message}. Export a backup before closing.`),
      )
      .finally(() => setSaving(false));
    return next;
  };
  return { state, ready, error, saving, commit };
}
