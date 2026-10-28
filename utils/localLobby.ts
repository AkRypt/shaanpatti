import { constants, GAME_STATE, PLAY_MODE, SP } from "@/app/constants";
import type {
  CurrentRound,
  Lobby,
  Player,
  RoundAnswers,
  RoundVotes,
} from "@/app/types";
import { pickRandomQuestion } from "@/app/questions";
import { generateLobbyCode, makeLocalPlayerId } from ".";
import {
  getStore,
  patchStoreLobby,
  patchStoreUser,
} from "@/utils/firebase/firebaseHelpers";
import { getOrCreatePlayerId } from "@/utils/identity";

const STORAGE_KEY = "shaanpatti_hotseat_lobby";
const MAX_ANSWER_LEN = 200;

export function loadLocalLobby(): Lobby | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Lobby;
  } catch {
    return null;
  }
}

export function clearLocalLobby() {
  if (typeof window !== "undefined") {
    sessionStorage.removeItem(STORAGE_KEY);
  }
}

function persist(lobby: Lobby) {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(lobby));
  }
  patchStoreLobby({ ...lobby, lobbyFetched: true });
}

export function isLocalHotseatCode(code: string): boolean {
  const lobby = loadLocalLobby();
  return !!(lobby && lobby.lobbyCode.toUpperCase() === code.toUpperCase());
}

export function createLocalHotseat(hostName: string): Lobby {
  const lobbyCode = generateLobbyCode();
  const hostId = getOrCreatePlayerId();
  const host: Player = {
    userId: hostId,
    name: hostName || "Host",
    isHost: true,
  };
  const lobby: Lobby = {
    lobbyCode,
    playMode: PLAY_MODE.HOTSEAT,
    hostId: host.userId,
    gameState: GAME_STATE.LOBBY,
    players: [host],
    enabledPacks: null,
    timerSeconds: constants.defaultTimerSeconds,
    round: 0,
    currentRound: null,
    usedQuestions: [],
    scores: {},
  };
  patchStoreUser({
    userId: host.userId,
    playerName: host.name,
    playerLobbyCode: lobbyCode,
    userFetched: true,
  });
  if (typeof window !== "undefined") {
    localStorage.setItem(SP.playerName, host.name);
    localStorage.setItem(SP.lobbyCode, lobbyCode);
  }
  persist(lobby);
  return lobby;
}

export function hydrateLocalIfMatch(code: string): boolean {
  const lobby = loadLocalLobby();
  if (!lobby || lobby.lobbyCode.toUpperCase() !== code.toUpperCase()) return false;
  persist(lobby);
  const store = getStore();
  if (!store.user?.userId && lobby.hostId) {
    patchStoreUser({
      userId: lobby.hostId,
      playerName: lobby.players?.[0]?.name || "Host",
      playerLobbyCode: lobby.lobbyCode,
      userFetched: true,
    });
  }
  return true;
}

function getLobby(): Lobby {
  const fromState = getStore().lobby;
  if (fromState?.playMode === PLAY_MODE.HOTSEAT && fromState.lobbyCode) {
    return JSON.parse(JSON.stringify(fromState));
  }
  const stored = loadLocalLobby();
  if (!stored) throw new Error("No local lobby");
  return stored;
}

function shuffleIds(ids: string[]): string[] {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function computeScoresDelta(votes: RoundVotes): Record<string, number> {
  const delta: Record<string, number> = {};
  for (const ownerId of Object.values(votes)) {
    if (!ownerId) continue;
    delta[ownerId] = (delta[ownerId] || 0) + 1;
  }
  return delta;
}

function mergeScores(
  scores: Record<string, number> | undefined,
  delta: Record<string, number>
): Record<string, number> {
  const next = { ...(scores || {}) };
  for (const [id, pts] of Object.entries(delta)) {
    next[id] = (next[id] || 0) + pts;
  }
  return next;
}

function fillMissingAnswers(
  players: Player[],
  answers: RoundAnswers
): RoundAnswers {
  const filled = { ...answers };
  for (const p of players) {
    const text = (filled[p.userId] || "").trim();
    filled[p.userId] = text || "(no answer)";
  }
  return filled;
}

function allPlayersAnswered(players: Player[], answers: RoundAnswers): boolean {
  if (!players.length) return false;
  return players.every((p) => !!(answers[p.userId] || "").trim());
}

function allPlayersVoted(players: Player[], votes: RoundVotes): boolean {
  if (!players.length) return false;
  return players.every((p) => !!votes[p.userId]);
}

function finishAnswering(lobby: Lobby) {
  const players = lobby.players || [];
  const answers = fillMissingAnswers(players, lobby.currentRound?.answers || {});
  if (!lobby.currentRound) return;
  lobby.currentRound.answers = answers;
  lobby.currentRound.answerOrder = shuffleIds(players.map((p) => p.userId));
  lobby.currentRound.votes = {};
  lobby.currentRound.scoresDelta = {};
  lobby.currentRound.hotseatVoterId = null;
  lobby.gameState = GAME_STATE.REVEAL_ANON;
}

function finishVoting(lobby: Lobby) {
  if (!lobby.currentRound) return;
  const votes = lobby.currentRound.votes || {};
  const scoresDelta = computeScoresDelta(votes);
  lobby.currentRound.scoresDelta = scoresDelta;
  lobby.currentRound.hotseatVoterId = null;
  lobby.scores = mergeScores(lobby.scores, scoresDelta);
  lobby.gameState = GAME_STATE.REVEAL_NAMES;
}

export function localAddPlayer(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false as const, message: "Name required" };
  const lobby = getLobby();
  if ((lobby.players || []).length >= constants.maxPlayers) {
    return { ok: false as const, message: "Lobby is full" };
  }
  if ((lobby.players || []).some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
    return { ok: false as const, message: "Name already taken" };
  }
  lobby.players = [
    ...(lobby.players || []),
    {
      userId: makeLocalPlayerId(trimmed, (lobby.players || []).length),
      name: trimmed,
      isHost: false,
    },
  ];
  persist(lobby);
  return { ok: true as const };
}

export function localRemovePlayer(userId: string) {
  const lobby = getLobby();
  lobby.players = (lobby.players || []).filter((p) => p.userId !== userId);
  persist(lobby);
  return { ok: true as const };
}

export function localSetPacks(enabledPacks: string[]) {
  const lobby = getLobby();
  lobby.enabledPacks = enabledPacks;
  persist(lobby);
}

export function localSetTimer(timerSeconds: number) {
  const lobby = getLobby();
  lobby.timerSeconds = Math.min(
    constants.maxTimerSeconds,
    Math.max(constants.minTimerSeconds, Math.round(timerSeconds))
  );
  persist(lobby);
}

function buildRound(
  packs: Record<string, string[]>,
  lobby: Lobby
): CurrentRound | null {
  const enabled = lobby.enabledPacks || Object.keys(packs);
  const pick = pickRandomQuestion(packs, enabled, lobby.usedQuestions || []);
  if (!pick) return null;
  const now = Date.now();
  const timer = lobby.timerSeconds || constants.defaultTimerSeconds;
  return {
    question: pick.question,
    packId: pick.packId,
    startedAt: now,
    endsAt: now + timer * 1000,
    answers: {},
    votes: {},
    hotseatVoterId: lobby.players?.[0]?.userId || null,
  };
}

export function localStartGame(packs: Record<string, string[]>, enabledPacks: string[]) {
  const lobby = getLobby();
  if ((lobby.players || []).length < constants.minPlayers) {
    return {
      ok: false as const,
      error: `Need at least ${constants.minPlayers} players`,
    };
  }
  if (!enabledPacks.length) {
    return { ok: false as const, error: "Select at least one pack" };
  }
  lobby.enabledPacks = enabledPacks;
  lobby.usedQuestions = [];
  lobby.scores = lobby.scores || {};
  const round = buildRound(packs, lobby);
  if (!round) return { ok: false as const, error: "No questions available" };
  lobby.gameState = GAME_STATE.ANSWERING;
  lobby.round = 1;
  lobby.currentRound = round;
  lobby.usedQuestions = [round.question];
  persist(lobby);
  return { ok: true as const, playerCount: lobby.players.length };
}

export function localSubmitAnswer(playerId: string, text: string) {
  const trimmed = text.trim().slice(0, MAX_ANSWER_LEN);
  if (!trimmed) return { ok: false as const, error: "Answer required" };
  const lobby = getLobby();
  if (lobby.gameState !== GAME_STATE.ANSWERING || !lobby.currentRound) {
    return { ok: false as const, error: "Not answering" };
  }

  lobby.currentRound.answers = {
    ...(lobby.currentRound.answers || {}),
    [playerId]: trimmed,
  };

  const players = lobby.players || [];
  if (allPlayersAnswered(players, lobby.currentRound.answers)) {
    finishAnswering(lobby);
  } else {
    const idx = players.findIndex((p) => p.userId === playerId);
    const next = players[idx + 1];
    lobby.currentRound.hotseatVoterId = next?.userId || null;
  }
  persist(lobby);
  return { ok: true as const };
}

export function localLockAnswersIfNeeded() {
  const lobby = getLobby();
  if (lobby.gameState !== GAME_STATE.ANSWERING || !lobby.currentRound) return;
  const players = lobby.players || [];
  const answers = lobby.currentRound.answers || {};
  const allDone = allPlayersAnswered(players, answers);
  const timedOut = Date.now() >= lobby.currentRound.endsAt;
  if (!allDone && !timedOut) return;
  finishAnswering(lobby);
  persist(lobby);
}

/** Alias for older call sites. */
export const localLockIfNeeded = localLockAnswersIfNeeded;

export function localBeginVote() {
  const lobby = getLobby();
  if (lobby.gameState !== GAME_STATE.REVEAL_ANON || !lobby.currentRound) {
    return { ok: false as const, error: "Not ready to vote" };
  }
  lobby.gameState = GAME_STATE.VOTING;
  lobby.currentRound.votes = {};
  lobby.currentRound.hotseatVoterId = lobby.players?.[0]?.userId || null;
  persist(lobby);
  return { ok: true as const };
}

export function localCastVote(voterId: string, answerOwnerId: string) {
  const lobby = getLobby();
  if (lobby.gameState !== GAME_STATE.VOTING || !lobby.currentRound) {
    return { ok: false as const, error: "Not voting" };
  }
  lobby.currentRound.votes = {
    ...(lobby.currentRound.votes || {}),
    [voterId]: answerOwnerId,
  };

  const players = lobby.players || [];
  if (allPlayersVoted(players, lobby.currentRound.votes)) {
    finishVoting(lobby);
  } else {
    const idx = players.findIndex((p) => p.userId === voterId);
    const next = players[idx + 1];
    lobby.currentRound.hotseatVoterId = next?.userId || null;
  }
  persist(lobby);
  return { ok: true as const };
}

export function localLockVotesIfNeeded() {
  const lobby = getLobby();
  if (lobby.gameState !== GAME_STATE.VOTING || !lobby.currentRound) return;
  if (!allPlayersVoted(lobby.players || [], lobby.currentRound.votes || {})) return;
  finishVoting(lobby);
  persist(lobby);
}

export function localSkipQuestion(packs: Record<string, string[]>) {
  const lobby = getLobby();
  const skippable = [
    GAME_STATE.ANSWERING,
    GAME_STATE.REVEAL_ANON,
    GAME_STATE.VOTING,
  ] as const;
  if (!(skippable as readonly string[]).includes(lobby.gameState)) {
    return { ok: false as const, error: "Cannot skip right now" };
  }
  const round = buildRound(packs, lobby);
  if (!round) return { ok: false as const, error: "No more questions" };
  lobby.gameState = GAME_STATE.ANSWERING;
  lobby.round = (lobby.round || 0) + 1;
  lobby.currentRound = round;
  lobby.usedQuestions = [...(lobby.usedQuestions || []), round.question];
  persist(lobby);
  return { ok: true as const };
}

export function localHostNextRound(packs: Record<string, string[]>) {
  const lobby = getLobby();
  if (lobby.gameState !== GAME_STATE.REVEAL_NAMES) {
    return { ok: false as const, error: "Round not finished" };
  }
  const round = buildRound(packs, lobby);
  if (!round) return { ok: false as const, error: "No more questions" };
  lobby.gameState = GAME_STATE.ANSWERING;
  lobby.round = (lobby.round || 0) + 1;
  lobby.currentRound = round;
  lobby.usedQuestions = [...(lobby.usedQuestions || []), round.question];
  persist(lobby);
  return { ok: true as const };
}

/** Alias */
export const localNextRound = localHostNextRound;

export function localReturnToLobby() {
  const lobby = getLobby();
  lobby.gameState = GAME_STATE.LOBBY;
  lobby.currentRound = null;
  lobby.round = 0;
  lobby.usedQuestions = [];
  lobby.scores = {};
  persist(lobby);
}

/** Aliases for call-site convenience. */
export const addHotseatPlayer = localAddPlayer;
export const localRemoveHotseatPlayer = localRemovePlayer;
