"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatPackLabel } from "@/app/questions";
import QuestionRow from "./QuestionRow";

type Packs = Record<string, string[]>;

type DraftRow = { id: string; text: string };

function newRow(text = ""): DraftRow {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return { id, text };
}

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { res, data };
  } finally {
    clearTimeout(timer);
  }
}

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [packs, setPacks] = useState<Packs>({});
  const [selected, setSelected] = useState("");
  const [draftRows, setDraftRows] = useState<DraftRow[]>([]);
  const [newCategory, setNewCategory] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [packsLoading, setPacksLoading] = useState(false);
  const focusNewRef = useRef(false);
  const lastInputRef = useRef<HTMLTextAreaElement | null>(null);

  const categories = useMemo(() => Object.keys(packs).sort(), [packs]);

  const applyPacks = useCallback((next: Packs) => {
    setPacks(next);
    const keys = Object.keys(next).sort();
    setSelected((prev) => {
      if (prev && next[prev]) return prev;
      return keys[0] || "";
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError("");
      try {
        const { data } = await fetchJson("/api/admin/session", undefined, 8000);
        if (cancelled) return;
        setConfigured(data?.configured !== false);
        if (!data?.authenticated) {
          setAuthed(false);
          return;
        }
        setAuthed(true);
        setPacksLoading(true);
        const { res, data: packData } = await fetchJson("/api/admin/words");
        if (cancelled) return;
        if (res.status === 401) {
          setAuthed(false);
          return;
        }
        if (!res.ok || !packData?.ok) {
          setError(packData?.error || `Failed to load packs (${res.status})`);
          return;
        }
        applyPacks(packData.packs || {});
      } catch (e: any) {
        if (!cancelled) {
          setError(
            e?.name === "AbortError"
              ? "Timed out reaching admin API."
              : e?.message || "Could not reach admin API"
          );
        }
      } finally {
        if (!cancelled) {
          setChecking(false);
          setPacksLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyPacks]);

  useEffect(() => {
    if (!selected) {
      setDraftRows([]);
      return;
    }
    setDraftRows((packs[selected] || []).map((text) => newRow(text)));
  }, [selected, packs]);

  useEffect(() => {
    if (!focusNewRef.current) return;
    focusNewRef.current = false;
    lastInputRef.current?.focus();
  }, [draftRows.length]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { res, data } = await fetchJson("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!data?.ok) {
        setError(data?.error || (res.status === 401 ? "Invalid password" : "Login failed"));
        return;
      }
      setAuthed(true);
      setPacksLoading(true);
      const loaded = await fetchJson("/api/admin/words");
      if (loaded.res.ok && loaded.data?.ok) applyPacks(loaded.data.packs || {});
      else setError(loaded.data?.error || "Logged in but failed to load packs");
    } finally {
      setBusy(false);
      setPacksLoading(false);
    }
  };

  const logout = async () => {
    await fetchJson("/api/admin/logout", { method: "POST" });
    setAuthed(false);
    setPacks({});
    setSelected("");
  };

  const updateRow = (id: string, value: string) => {
    setDraftRows((prev) => prev.map((row) => (row.id === id ? { ...row, text: value } : row)));
  };

  const removeRow = (id: string) => {
    setDraftRows((prev) => prev.filter((row) => row.id !== id));
  };

  const addRow = () => {
    focusNewRef.current = true;
    setDraftRows((prev) => [...prev, newRow()]);
  };

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    setStatus("");
    setError("");
    try {
      const words = draftRows.map((w) => w.text.trim()).filter(Boolean);
      const { res, data } = await fetchJson("/api/admin/words", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: selected, words }),
      });
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Save failed");
        return;
      }
      setPacks((prev) => ({ ...prev, [selected]: words }));
      setDraftRows(words.map((text) => newRow(text)));
      setStatus(`Saved ${selected} (${words.length})`);
    } finally {
      setBusy(false);
    }
  };

  const createPack = async () => {
    const category = newCategory
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!category) return;
    setBusy(true);
    setError("");
    try {
      const { res, data } = await fetchJson("/api/admin/words", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, words: [] }),
      });
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Create failed");
        return;
      }
      setPacks((prev) => ({ ...prev, [category]: [] }));
      setSelected(category);
      setNewCategory("");
      setStatus(`Created ${category}`);
    } finally {
      setBusy(false);
    }
  };

  const removePack = async () => {
    if (!selected || !confirm(`Delete pack “${selected}”?`)) return;
    setBusy(true);
    setError("");
    try {
      const { res, data } = await fetchJson(
        `/api/admin/words?category=${encodeURIComponent(selected)}`,
        { method: "DELETE" }
      );
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Delete failed");
        return;
      }
      setPacks((prev) => {
        const next = { ...prev };
        delete next[selected];
        return next;
      });
      setSelected("");
      setStatus(`Deleted ${selected}`);
    } finally {
      setBusy(false);
    }
  };

  const seed = async () => {
    if (!confirm("Seed fallback packs into Firestore (merge)?")) return;
    setBusy(true);
    setError("");
    try {
      const { res, data } = await fetchJson("/api/admin/words", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replace: false }),
      });
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Seed failed");
        return;
      }
      const loaded = await fetchJson("/api/admin/words");
      if (loaded.res.ok && loaded.data?.ok) applyPacks(loaded.data.packs || {});
      setStatus(`Seeded: ${(data.seeded || []).join(", ")}`);
    } finally {
      setBusy(false);
    }
  };

  if (checking) {
    return (
      <main className="flex flex-1 items-center justify-center text-[var(--SP-muted)]">
        Loading…
      </main>
    );
  }

  if (!authed) {
    return (
      <main className="flex flex-1 flex-col justify-center animate-riseIn max-w-md mx-auto w-full">
        <h1 className="SP-brand text-4xl mb-2">Shaanpatti admin</h1>
        <p className="text-[var(--SP-muted)] mb-5 text-sm">
          Pack editor · Firestore source of truth
        </p>
        {!configured && (
          <p className="mb-4 text-sm text-[var(--SP-accent)]">
            ADMIN_PASSWORD is not set on the server.
          </p>
        )}
        <form onSubmit={login} className="SP-panel rounded-2xl p-5 space-y-3">
          <input
            type="password"
            className="SP-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Admin password"
            autoFocus
          />
          <button type="submit" className="SP-btn w-full" disabled={busy || !password}>
            Sign in
          </button>
        </form>
        {error && <p className="mt-3 text-sm text-[var(--SP-accent)]">{error}</p>}
      </main>
    );
  }

  const filledCount = draftRows.map((r) => r.text.trim()).filter(Boolean).length;

  return (
    <main className="flex flex-1 flex-col gap-4 animate-riseIn py-2 pb-24">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="SP-brand text-3xl">Pack admin</h1>
          <p className="text-sm text-[var(--SP-muted)]">shaanpatti_words</p>
        </div>
        <button type="button" className="SP-btn-ghost py-2 px-3 text-sm" onClick={logout}>
          Log out
        </button>
      </header>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="SP-btn-ghost py-2 px-3 text-sm" onClick={seed} disabled={busy}>
          Seed fallbacks
        </button>
        <button
          type="button"
          className="SP-btn-ghost py-2 px-3 text-sm"
          onClick={removePack}
          disabled={busy || !selected}
        >
          Delete pack
        </button>
      </div>

      <div className="SP-panel rounded-2xl p-4 flex flex-wrap gap-2">
        {packsLoading && <span className="text-sm text-[var(--SP-muted)]">Loading packs…</span>}
        {categories.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setSelected(id)}
            className={`SP-chip ${selected === id ? "SP-chip-on" : ""}`}
          >
            {formatPackLabel(id)} ({(packs[id] || []).length})
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          className="SP-input py-2"
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          placeholder="new_pack_id"
        />
        <button
          type="button"
          className="SP-btn py-2 px-3 text-sm shrink-0"
          onClick={createPack}
          disabled={busy}
        >
          Add
        </button>
      </div>

      {selected && (
        <div className="SP-panel rounded-2xl p-4 space-y-3 flex-1 flex flex-col min-h-0">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-xl">{formatPackLabel(selected)}</h2>
            <span className="text-xs text-[var(--SP-muted)] tabular-nums">
              {filledCount} question{filledCount === 1 ? "" : "s"}
            </span>
          </div>

          <ul className="flex flex-col gap-3">
            {draftRows.map((row, index) => (
              <QuestionRow
                key={row.id}
                index={index}
                value={row.text}
                onChange={(value) => updateRow(row.id, value)}
                onDelete={() => removeRow(row.id)}
                inputRef={
                  index === draftRows.length - 1
                    ? (el) => {
                        lastInputRef.current = el;
                      }
                    : undefined
                }
              />
            ))}
            {draftRows.length === 0 && (
              <li className="text-sm text-[var(--SP-muted)] py-2 list-none">
                No questions yet — tap + to add one.
              </li>
            )}
          </ul>

          <button
            type="button"
            className="SP-btn-ghost w-full py-3 text-base"
            onClick={addRow}
            disabled={busy}
            aria-label="Add question"
          >
            + Add question
          </button>

          <button type="button" className="SP-btn w-full sticky bottom-0" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save pack"}
          </button>
        </div>
      )}

      {status && <p className="text-sm text-[var(--SP-mint)]">{status}</p>}
      {error && <p className="text-sm text-[var(--SP-accent)]">{error}</p>}
    </main>
  );
}
