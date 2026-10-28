import { constants } from "@/app/constants";

/** Ambiguous chars (0/O, 1/l/I) omitted for readable lobby codes. */
export function generateLobbyCode() {
  const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    { length: constants.lobbyCodeLength },
    () => characters[Math.floor(Math.random() * characters.length)]
  ).join("");
}

export function makeLocalPlayerId(name: string, index: number): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "player";
  return `local_${slug}_${index}_${Math.random().toString(36).slice(2, 6)}`;
}

export function tallyVotes(
  votes: Record<string, string> | undefined,
  players: { userId: string; name: string }[]
) {
  const counts = new Map<string, number>();
  for (const target of Object.values(votes || {})) {
    counts.set(target, (counts.get(target) || 0) + 1);
  }
  return players
    .map((p) => ({ ...p, votes: counts.get(p.userId) || 0 }))
    .filter((p) => p.votes > 0)
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
}
