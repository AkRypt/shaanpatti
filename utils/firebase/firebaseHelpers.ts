import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  runTransaction,
  deleteField,
} from "firebase/firestore";
import { db } from "./firebase";
import {
  constants,
  GAME_STATE,
  PLAY_MODE,
  PlayMode,
  SP,
  SP_TABLES,
} from "@/app/constants";
import type {
  CurrentRound,
  Lobby,
  Player,
  RoundAnswers,
  RoundVotes,
  UserData,
} from "@/app/types";
import { pickRandomQuestion } from "@/app/questions";
import { modeFromPlayMode, trackLobbyJoined } from "@/utils/analytics";
import {
  getOrCreatePlayerId,
  getStoredPlayerName,
  setStoredPlayerName,
} from "@/utils/identity";
import { shouldSuppressRejoin } from "@/utils/lobbyLeave";

const MAX_ANSWER_LEN = 200;

export type Store = {
  user: UserData;
  lobby: Lobby | null;
  error: string;
  loading: boolean;
};

type Listener = () => void;

const store: Store = {
  user: { userFetched: false },
  lobby: null,
  error: "",
  loading: false,
};

/** Bumps on every store change so useSyncExternalStore snapshots are never stale. */
let revision = 0;

const listeners = new Set<Listener>();

function emit() {
  revision += 1;
  listeners.forEach((l) => l());
}

export function notifyStore() {
  emit();
}

export function getStore(): Store {
  return store;
}

export function getStoreRevision(): number {
  return revision;
}

export function getStoreError(): string {
  return store.error;
}

export function subscribeStore(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function patchStoreLobby(lobby: Lobby | null) {
  store.lobby = lobby;
  emit();
}

export function patchStoreUser(partial: Partial<UserData>) {
  store.user = { ...store.user, ...partial };
  emit();
}

function setUser(partial: Partial<UserData>) {
  store.user = { ...store.user, ...partial };
  emit();
}

function setLobby(lobby: Lobby | null) {
  store.lobby = lobby;
  emit();
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

/** Prefer host as first hotseat voter — host votes like any other player. */
function firstVoterId(lobby: Lobby): string | null {
  const players = lobby.players || [];
  if (!players.length) return null;
  const host = players.find((p) => p.userId === lobby.hostId);
  return host?.userId || players[0].userId;
}

function nextUnvotedPlayerId(
  players: Player[],
  votes: RoundVotes,
  fromVoterId: string
): string | null {
  const idx = players.findIndex((p) => p.userId === fromVoterId);
  const start = idx >= 0 ? idx : -1;
  for (let step = 1; step <= players.length; step++) {
    const cand = players[(start + step) % players.length];
    if (cand && !votes[cand.userId]) return cand.userId;
  }
  return null;
}

/**
 * No Firebase Auth. Load local UUID + display name from localStorage only.
 * Optional Firestore user docs are written only when joining online lobbies.
 */
export async function initializeUser() {
  const userId = getOrCreatePlayerId();
  const playerName = getStoredPlayerName();
  const storedLobby =
    typeof window !== "undefined" ? localStorage.getItem(SP.lobbyCode) : null;
  setUser({
    userId,
    playerName,
    userFetched: true,
    playerLobbyCode: store.user.playerLobbyCode ?? storedLobby ?? null,
  });
}

async function upsertUserDoc(userId: string, data: Partial<UserData>) {
  const payload: Record<string, unknown> = {
    userId,
    updatedAt: new Date().toISOString(),
    ...data,
  };
  if (data.playerLobbyCode === null) {
    payload.playerLobbyCode = deleteField();
  }
  await setDoc(doc(db, SP_TABLES.USERS, userId), payload, { merge: true });
}

export async function updateUserData(
  userId: string,
  newUserData: Partial<UserData>,
  opts?: { syncRemote?: boolean }
) {
  setUser(newUserData);
  if (newUserData.playerName) {
    setStoredPlayerName(newUserData.playerName);
  }
  if ("playerLobbyCode" in newUserData) {
    if (newUserData.playerLobbyCode) {
      localStorage.setItem(SP.lobbyCode, String(newUserData.playerLobbyCode));
    } else {
      localStorage.removeItem(SP.lobbyCode);
    }
  }
  if (opts?.syncRemote === false) return;
  // Optional remote presence — ignore permission errors until open rules are deployed.
  try {
    await upsertUserDoc(userId, newUserData);
  } catch {
    // local identity is enough
  }
}

export async function setDisplayName(name: string) {
  const trimmed = name.trim().slice(0, 24);
  if (!trimmed) return { ok: false as const, error: "Name required" };
  setStoredPlayerName(trimmed);
  const userId = store.user.userId || getOrCreatePlayerId();
  setUser({ userId, playerName: trimmed });
  const lobby = store.lobby;
  if (lobby?.lobbyCode && lobby.playMode === PLAY_MODE.ONLINE) {
    try {
      const players = (lobby.players || []).map((p) =>
        p.userId === userId ? { ...p, name: trimmed } : p
      );
      await updateDoc(doc(db, SP_TABLES.LOBBIES, lobby.lobbyCode), { players });
      void updateUserData(userId, { playerName: trimmed });
    } catch (error) {
      console.error("setDisplayName lobby update", error);
    }
  }
  return { ok: true as const };
}

export async function createLobby(
  lobbyCode: string,
  hostId: string,
  playMode: PlayMode = PLAY_MODE.ONLINE,
  hostName = "Host"
) {
  try {
    const hostPlayer: Player = {
      userId: hostId,
      name: hostName.trim() || "Host",
      isHost: true,
    };
    const lobby: Lobby = {
      lobbyCode,
      playMode,
      hostId,
      gameState: GAME_STATE.LOBBY,
      players: [hostPlayer],
      enabledPacks: null,
      timerSeconds: constants.defaultTimerSeconds,
      round: 0,
      currentRound: null,
      usedQuestions: [],
      scores: {},
      createdAt: new Date(),
    };
    await setDoc(doc(db, SP_TABLES.LOBBIES, lobbyCode), lobby);
    setLobby({ ...lobby, lobbyFetched: true });
    setUser({ playerLobbyCode: lobbyCode });
    if (typeof window !== "undefined") {
      localStorage.setItem(SP.lobbyCode, lobbyCode);
    }
    return { ok: true as const, data: { lobbyCode } };
  } catch (error) {
    console.error("createLobby", error);
    return {
      ok: false as const,
      error:
        "Failed to create lobby — deploy shaanpatti Firestore rules (open, no Auth) on akxh-games",
    };
  }
}

/** Optimistic local lobby patch (online UI before Firestore confirms). */
export function patchLobbyFields(partial: Partial<Lobby>) {
  const current = store.lobby;
  if (!current) return;
  setLobby({ ...current, ...partial, lobbyFetched: true });
}

export async function joinLobby(lobbyCode: string, userId: string, playerName: string) {
  try {
    if (shouldSuppressRejoin()) {
      return { ok: false as const, message: "Left lobby; rejoin from the home screen." };
    }

    const code = String(lobbyCode).toUpperCase();
    const lobbyRef = doc(db, SP_TABLES.LOBBIES, code);
    const snap = await getDoc(lobbyRef);
    if (!snap.exists()) {
      return { ok: false as const, message: "Lobby not found." };
    }
    const existing = snap.data() as Lobby;

    if (existing.gameState !== GAME_STATE.LOBBY) {
      const alreadyIn = (existing.players || []).some((p) => p.userId === userId);
      if (!alreadyIn) {
        return { ok: false as const, message: "This game has already started." };
      }
      setLobby({ ...existing, lobbyCode: code, lobbyFetched: true });
      setUser({ playerLobbyCode: code });
      return { ok: true as const, data: existing };
    }

    const players = [...(existing.players || [])];
    const idx = players.findIndex((p) => p.userId === userId);
    if (idx === -1) {
      if (players.length >= constants.maxPlayers) {
        return { ok: false as const, message: "Lobby is full." };
      }
      const name =
        playerName.trim() ||
        getStoredPlayerName() ||
        `Player ${players.length + 1}`;
      players.push({
        userId,
        name,
        isHost: existing.hostId === userId || players.length === 0,
      });
      await updateDoc(lobbyRef, { players });
      trackLobbyJoined(modeFromPlayMode(existing.playMode));
    }

    await updateUserData(userId, {
      playerLobbyCode: code,
      playerName: playerName.trim() || undefined,
    });
    const refreshed = (await getDoc(lobbyRef)).data() as Lobby;
    setLobby({ ...refreshed, lobbyCode: code, lobbyFetched: true });
    return { ok: true as const, data: refreshed };
  } catch (error) {
    console.error("joinLobby", error);
    return {
      ok: false as const,
      message:
        "Could not join lobby. Deploy shaanpatti Firestore rules (no Auth) on akxh-games.",
    };
  }
}

/** Clear membership locally first; Firestore unjoin is best-effort. */
export async function leaveLobby(lobbyCode: string, userId: string) {
  clearClientLobbyMembership();

  try {
    const lobbyRef = doc(db, SP_TABLES.LOBBIES, lobbyCode);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(lobbyRef);
      if (!snap.exists()) return;
      const lobby = snap.data() as Lobby;
      const players = (lobby.players || []).filter((p) => p.userId !== userId);
      const patch: Record<string, unknown> = { players };
      if (lobby.hostId === userId && players.length) {
        patch.hostId = players[0].userId;
        players[0] = { ...players[0], isHost: true };
        patch.players = players;
      }
      tx.update(lobbyRef, patch);
    });
  } catch (error) {
    console.error("leaveLobby firestore", error);
  }

  void upsertUserDoc(userId, { playerLobbyCode: null }).catch(() => {});
}

export function clearClientLobbyMembership() {
  setUser({ playerLobbyCode: null });
  if (typeof window !== "undefined") {
    localStorage.removeItem(SP.lobbyCode);
  }
  setLobby(null);
}

export function subscribeLobby(lobbyCode: string) {
  const code = String(lobbyCode).toUpperCase();
  return onSnapshot(
    doc(db, SP_TABLES.LOBBIES, code),
    (snap) => {
      if (!snap.exists()) {
        store.error = "";
        setLobby({
          lobbyCode: code,
          playMode: PLAY_MODE.ONLINE,
          hostId: "",
          gameState: GAME_STATE.LOBBY,
          players: [],
          lobbyFetched: true,
          missing: true,
        });
        return;
      }
      store.error = "";
      setLobby({ ...(snap.data() as Lobby), lobbyCode: code, lobbyFetched: true, missing: false });
    },
    (error) => {
      console.error("subscribeLobby", error);
      store.error =
        "Could not connect to lobby. Deploy shaanpatti Firestore rules on akxh-games (no Auth).";
      setLobby({
        lobbyCode: code,
        playMode: PLAY_MODE.ONLINE,
        hostId: "",
        gameState: GAME_STATE.LOBBY,
        players: [],
        lobbyFetched: true,
        missing: true,
      });
    }
  );
}

export async function setEnabledPacks(lobbyCode: string, enabledPacks: string[]) {
  await updateDoc(doc(db, SP_TABLES.LOBBIES, lobbyCode), { enabledPacks });
}

export async function setTimerSeconds(lobbyCode: string, timerSeconds: number) {
  const clamped = Math.min(
    constants.maxTimerSeconds,
    Math.max(constants.minTimerSeconds, Math.round(timerSeconds))
  );
  await updateDoc(doc(db, SP_TABLES.LOBBIES, lobbyCode), { timerSeconds: clamped });
}

function buildRound(
  packs: Record<string, string[]>,
  enabled: string[],
  used: string[],
  timerSeconds: number,
  players: Player[],
  playMode: PlayMode
): CurrentRound | null {
  const pick = pickRandomQuestion(packs, enabled, used);
  if (!pick) return null;
  const now = Date.now();
  const round: CurrentRound = {
    question: pick.question,
    packId: pick.packId,
    startedAt: now,
    endsAt: now + timerSeconds * 1000,
    answers: {},
    votes: {},
  };
  if (playMode === PLAY_MODE.HOTSEAT) {
    const host = players.find((p) => p.isHost) || players[0];
    if (host) round.hotseatVoterId = host.userId;
  }
  return round;
}

/** Lock answers and open voting (anonymous board = vote UI). No host gate. */
function transitionToVoting(lobby: Lobby): {
  answers: RoundAnswers;
  answerOrder: string[];
  votes: RoundVotes;
  hotseatVoterId: string | null;
} {
  const players = lobby.players || [];
  const answers = fillMissingAnswers(players, lobby.currentRound?.answers || {});
  // Host is included in voting; hotseat starts with host when pass-and-play.
  const hotseatVoterId =
    lobby.playMode === PLAY_MODE.HOTSEAT ? firstVoterId(lobby) : null;
  return {
    answers,
    answerOrder: shuffleIds(players.map((p) => p.userId)),
    votes: {},
    hotseatVoterId,
  };
}

function applyVoteFinish(lobby: Lobby, votes: RoundVotes) {
  const scoresDelta = computeScoresDelta(votes);
  const scores = mergeScores(lobby.scores, scoresDelta);
  return { scoresDelta, scores };
}

export async function startGame(
  lobbyCode: string,
  packs: Record<string, string[]>,
  enabledPacks: string[]
) {
  const lobbyRef = doc(db, SP_TABLES.LOBBIES, lobbyCode);
  const snap = await getDoc(lobbyRef);
  if (!snap.exists()) return { ok: false as const, error: "Lobby not found" };
  const lobby = snap.data() as Lobby;
  const players = lobby.players || [];
  if (players.length < constants.minPlayers) {
    return {
      ok: false as const,
      error: `Need at least ${constants.minPlayers} players`,
    };
  }
  if (!enabledPacks.length) {
    return { ok: false as const, error: "Select at least one pack" };
  }
  const timer = lobby.timerSeconds || constants.defaultTimerSeconds;
  const round = buildRound(packs, enabledPacks, [], timer, players, lobby.playMode);
  if (!round) return { ok: false as const, error: "No questions in selected packs" };

  await updateDoc(lobbyRef, {
    gameState: GAME_STATE.ANSWERING,
    enabledPacks,
    round: 1,
    currentRound: round,
    usedQuestions: [round.question],
    scores: lobby.scores || {},
  });
  return { ok: true as const };
}

export async function submitAnswer(
  lobbyCode: string,
  playerId: string,
  text: string
) {
  const trimmed = text.trim().slice(0, MAX_ANSWER_LEN);
  if (!trimmed) return { ok: false as const, error: "Answer required" };

  const lobbyRef = doc(db, SP_TABLES.LOBBIES, lobbyCode);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(lobbyRef);
    if (!snap.exists()) throw new Error("Lobby missing");
    const lobby = snap.data() as Lobby;
    if (lobby.gameState !== GAME_STATE.ANSWERING || !lobby.currentRound) {
      throw new Error("Not answering");
    }
    const players = lobby.players || [];
    const answers = {
      ...(lobby.currentRound.answers || {}),
      [playerId]: trimmed,
    };

    if (allPlayersAnswered(players, answers)) {
      const next = transitionToVoting({
        ...lobby,
        currentRound: { ...lobby.currentRound, answers },
      });
      tx.update(lobbyRef, {
        gameState: GAME_STATE.VOTING,
        currentRound: {
          ...lobby.currentRound,
          answers: next.answers,
          answerOrder: next.answerOrder,
          votes: next.votes,
          hotseatVoterId: next.hotseatVoterId,
          scoresDelta: {},
        },
      });
    } else {
      tx.update(lobbyRef, { "currentRound.answers": answers });
    }
  });
  return { ok: true as const };
}

export async function lockAnswersIfNeeded(lobbyCode: string) {
  const lobbyRef = doc(db, SP_TABLES.LOBBIES, lobbyCode);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(lobbyRef);
    if (!snap.exists()) return;
    const lobby = snap.data() as Lobby;
    if (lobby.gameState !== GAME_STATE.ANSWERING || !lobby.currentRound) return;

    const players = lobby.players || [];
    const answers = lobby.currentRound.answers || {};
    const allDone = allPlayersAnswered(players, answers);
    const timedOut = Date.now() >= lobby.currentRound.endsAt;
    if (!allDone && !timedOut) return;

    const next = transitionToVoting(lobby);
    tx.update(lobbyRef, {
      gameState: GAME_STATE.VOTING,
      currentRound: {
        ...lobby.currentRound,
        answers: next.answers,
        answerOrder: next.answerOrder,
        votes: next.votes,
        hotseatVoterId: next.hotseatVoterId,
        scoresDelta: {},
      },
    });
  });
}

/** Alias for older call sites. */
export const lockRoundIfNeeded = lockAnswersIfNeeded;

export async function hostBeginVote(lobbyCode: string) {
  const lobbyRef = doc(db, SP_TABLES.LOBBIES, lobbyCode);
  const snap = await getDoc(lobbyRef);
  if (!snap.exists()) return { ok: false as const, error: "Lobby not found" };
  const lobby = snap.data() as Lobby;
  if (lobby.gameState !== GAME_STATE.REVEAL_ANON || !lobby.currentRound) {
    return { ok: false as const, error: "Not ready to vote" };
  }

  const patch: Record<string, unknown> = {
    gameState: GAME_STATE.VOTING,
    "currentRound.votes": {},
  };
  if (lobby.playMode === PLAY_MODE.HOTSEAT) {
    patch["currentRound.hotseatVoterId"] = firstVoterId(lobby);
  } else {
    patch["currentRound.hotseatVoterId"] = null;
  }
  await updateDoc(lobbyRef, patch);
  return { ok: true as const };
}

export async function castVote(
  lobbyCode: string,
  voterId: string,
  answerOwnerId: string
) {
  const lobbyRef = doc(db, SP_TABLES.LOBBIES, lobbyCode);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(lobbyRef);
    if (!snap.exists()) throw new Error("Lobby missing");
    const lobby = snap.data() as Lobby;
    if (lobby.gameState !== GAME_STATE.VOTING || !lobby.currentRound) {
      throw new Error("Not voting");
    }
    const players = lobby.players || [];
    // Host casts votes like any other player — do not exclude hostId/isHost.
    if (!players.some((p) => p.userId === voterId)) {
      throw new Error("Unknown voter");
    }
    if (!players.some((p) => p.userId === answerOwnerId)) {
      throw new Error("Unknown answer");
    }
    const votes = {
      ...(lobby.currentRound.votes || {}),
      [voterId]: answerOwnerId,
    };

    if (allPlayersVoted(players, votes)) {
      const { scoresDelta, scores } = applyVoteFinish(lobby, votes);
      tx.update(lobbyRef, {
        gameState: GAME_STATE.REVEAL_NAMES,
        scores,
        currentRound: {
          ...lobby.currentRound,
          votes,
          scoresDelta,
          hotseatVoterId: null,
        },
      });
    } else {
      const patch: Record<string, unknown> = { "currentRound.votes": votes };
      if (lobby.playMode === PLAY_MODE.HOTSEAT) {
        patch["currentRound.hotseatVoterId"] = nextUnvotedPlayerId(
          players,
          votes,
          voterId
        );
      }
      tx.update(lobbyRef, patch);
    }
  });
}

export async function lockVotesIfNeeded(lobbyCode: string) {
  const lobbyRef = doc(db, SP_TABLES.LOBBIES, lobbyCode);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(lobbyRef);
    if (!snap.exists()) return;
    const lobby = snap.data() as Lobby;
    if (lobby.gameState !== GAME_STATE.VOTING || !lobby.currentRound) return;
    const votes = lobby.currentRound.votes || {};
    if (!allPlayersVoted(lobby.players || [], votes)) return;

    const { scoresDelta, scores } = applyVoteFinish(lobby, votes);
    tx.update(lobbyRef, {
      gameState: GAME_STATE.REVEAL_NAMES,
      scores,
      currentRound: {
        ...lobby.currentRound,
        votes,
        scoresDelta,
        hotseatVoterId: null,
      },
    });
  });
}

export async function hostSkipQuestion(
  lobbyCode: string,
  packs: Record<string, string[]>
) {
  const lobbyRef = doc(db, SP_TABLES.LOBBIES, lobbyCode);
  const snap = await getDoc(lobbyRef);
  if (!snap.exists()) return { ok: false as const, error: "Lobby not found" };
  const lobby = snap.data() as Lobby;
  const skippable = [
    GAME_STATE.ANSWERING,
    GAME_STATE.REVEAL_ANON,
    GAME_STATE.VOTING,
  ] as const;
  if (!(skippable as readonly string[]).includes(lobby.gameState)) {
    return { ok: false as const, error: "Cannot skip right now" };
  }

  const enabled = lobby.enabledPacks || Object.keys(packs);
  const used = lobby.usedQuestions || [];
  const timer = lobby.timerSeconds || constants.defaultTimerSeconds;
  const round = buildRound(
    packs,
    enabled,
    used,
    timer,
    lobby.players || [],
    lobby.playMode
  );
  if (!round) return { ok: false as const, error: "No more questions" };

  await updateDoc(lobbyRef, {
    gameState: GAME_STATE.ANSWERING,
    round: (lobby.round || 0) + 1,
    currentRound: round,
    usedQuestions: [...used, round.question],
  });
  return { ok: true as const };
}

export async function hostNextRound(
  lobbyCode: string,
  packs: Record<string, string[]>
) {
  const lobbyRef = doc(db, SP_TABLES.LOBBIES, lobbyCode);
  const snap = await getDoc(lobbyRef);
  if (!snap.exists()) return { ok: false as const, error: "Lobby not found" };
  const lobby = snap.data() as Lobby;
  if (lobby.gameState !== GAME_STATE.REVEAL_NAMES) {
    return { ok: false as const, error: "Round not finished" };
  }

  const enabled = lobby.enabledPacks || Object.keys(packs);
  const used = lobby.usedQuestions || [];
  const timer = lobby.timerSeconds || constants.defaultTimerSeconds;
  const round = buildRound(
    packs,
    enabled,
    used,
    timer,
    lobby.players || [],
    lobby.playMode
  );
  if (!round) return { ok: false as const, error: "No more questions" };

  await updateDoc(lobbyRef, {
    gameState: GAME_STATE.ANSWERING,
    round: (lobby.round || 0) + 1,
    currentRound: round,
    usedQuestions: [...used, round.question],
  });
  return { ok: true as const };
}

export async function returnToLobby(lobbyCode: string) {
  await updateDoc(doc(db, SP_TABLES.LOBBIES, lobbyCode), {
    gameState: GAME_STATE.LOBBY,
    currentRound: null,
    round: 0,
    usedQuestions: [],
    scores: {},
  });
}
