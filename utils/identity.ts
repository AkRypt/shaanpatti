import { SP } from "@/app/constants";

/** Stable device player id — no Firebase Auth. */
export function getOrCreatePlayerId(): string {
  if (typeof window === "undefined") return "";
  const existing = localStorage.getItem(SP.userId)?.trim();
  if (existing) return existing;
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(SP.userId, id);
  return id;
}

export function getStoredPlayerName(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(SP.playerName)?.trim() || "";
}

export function setStoredPlayerName(name: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SP.playerName, name.trim().slice(0, 24));
}
