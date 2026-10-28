/**
 * After Leave, block auto-rejoin until the player intentionally
 * creates / joins again (same pattern as Spycy).
 */
export const sp_SUPPRESS_REJOIN_KEY = "shaanpatti_suppress_rejoin";

export function markLeftLobby() {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(sp_SUPPRESS_REJOIN_KEY, "1");
  localStorage.setItem(sp_SUPPRESS_REJOIN_KEY, "1");
}

export function clearSuppressRejoin() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(sp_SUPPRESS_REJOIN_KEY);
  localStorage.removeItem(sp_SUPPRESS_REJOIN_KEY);
}

export function shouldSuppressRejoin(): boolean {
  if (typeof window === "undefined") return false;
  return (
    sessionStorage.getItem(sp_SUPPRESS_REJOIN_KEY) === "1" ||
    localStorage.getItem(sp_SUPPRESS_REJOIN_KEY) === "1"
  );
}
