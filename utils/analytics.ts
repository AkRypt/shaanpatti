/**
 * Firebase Analytics (GA4) for Shaanpatti on shared akxh-games.
 * Every event includes `app: "shaanpatti"`.
 */
import type { Analytics } from "firebase/analytics";

export const ANALYTICS_APP = "shaanpatti";

export const ANALYTICS_EVENTS = {
  pageView: "page_view",
  lobbyCreated: "lobby_created",
  lobbyJoined: "lobby_joined",
  deckSelected: "deck_selected",
  gameStarted: "game_started",
  answerSubmitted: "answer_submitted",
  voteCast: "vote_cast",
  roundFinished: "round_finished",
  questionSkipped: "question_skipped",
} as const;

export type AnalyticsMode = "online" | "pass_and_play";

type Params = Record<string, string | number>;

let loading: Promise<Analytics | null> | null = null;

function measurementId() {
  return process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID?.trim() || "";
}

async function analytics(): Promise<Analytics | null> {
  if (typeof window === "undefined") return null;
  if (!measurementId()) return null;
  if (!loading) {
    loading = (async () => {
      try {
        const { getAnalytics, initializeAnalytics, isSupported } = await import(
          "firebase/analytics"
        );
        const { app } = await import("@/utils/firebase/firebase");
        if (!(await isSupported())) return null;
        const config: Record<string, string | boolean> = { send_page_view: false };
        if (process.env.NODE_ENV === "development") config.debug_mode = true;
        try {
          return initializeAnalytics(app, { config });
        } catch {
          return getAnalytics(app);
        }
      } catch {
        return null;
      }
    })();
  }
  return loading;
}

export function claimOnce(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const full = `akxh_analytics:${ANALYTICS_APP}:${key}`;
    if (sessionStorage.getItem(full)) return false;
    sessionStorage.setItem(full, "1");
    return true;
  } catch {
    return true;
  }
}

function clip(value: string | number | undefined | null) {
  const raw = String(value ?? "").trim();
  return (raw || "unknown").slice(0, 100);
}

export function modeFromPlayMode(playMode: string | undefined | null): AnalyticsMode {
  return playMode === "hotseat" ? "pass_and_play" : "online";
}

export function track(name: string, params: Params = {}) {
  void analytics().then(async (instance) => {
    if (!instance) return;
    const { logEvent } = await import("firebase/analytics");
    const send = logEvent as (
      analyticsInstance: Analytics,
      eventName: string,
      eventParams?: Params
    ) => void;
    send(instance, name, { app: ANALYTICS_APP, ...params });
  });
}

export function trackPageView(path: string) {
  const page_path = path || "/";
  const bucket = Math.floor(Date.now() / 1000);
  if (!claimOnce(`page:${page_path}:${bucket}`)) return;
  track(ANALYTICS_EVENTS.pageView, {
    page_path,
    page_title: typeof document !== "undefined" ? document.title : ANALYTICS_APP,
    page_location:
      typeof window !== "undefined" ? `${window.location.origin}${page_path}` : page_path,
  });
}

export function trackLobbyCreated(mode: AnalyticsMode) {
  track(ANALYTICS_EVENTS.lobbyCreated, { mode });
}

export function trackLobbyJoined(mode: AnalyticsMode) {
  track(ANALYTICS_EVENTS.lobbyJoined, { mode });
}

export function trackGameStarted(args: {
  mode: AnalyticsMode;
  playerCount: number;
  lobbyCode: string;
  /** Enabled pack ids, e.g. "spicy,chaotic" (clipped). */
  packs?: string[];
}) {
  if (!claimOnce(`game-start:${args.lobbyCode}`)) return;
  const deck_id = clip((args.packs || []).join(",") || "unknown");
  track(ANALYTICS_EVENTS.deckSelected, {
    mode: args.mode,
    deck_id,
  });
  track(ANALYTICS_EVENTS.gameStarted, {
    mode: args.mode,
    player_count: Math.max(0, Math.round(args.playerCount)),
    deck_id,
  });
}

export function trackAnswerSubmitted(mode: AnalyticsMode) {
  track(ANALYTICS_EVENTS.answerSubmitted, { mode });
}

export function trackVoteCast(mode: AnalyticsMode) {
  track(ANALYTICS_EVENTS.voteCast, { mode });
}

export function trackRoundFinished(args: {
  mode: AnalyticsMode;
  round: number;
  lobbyCode: string;
  packId?: string;
}) {
  const round = Number.isFinite(args.round) ? args.round : 1;
  if (!claimOnce(`round-end:${args.lobbyCode}:${round}`)) return;
  track(ANALYTICS_EVENTS.roundFinished, {
    mode: args.mode,
    round,
    deck_id: clip(args.packId),
  });
}

export function trackQuestionSkipped(mode: AnalyticsMode) {
  track(ANALYTICS_EVENTS.questionSkipped, { mode });
}
