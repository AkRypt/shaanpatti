"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  constants,
  GAME_STATE,
  PACK_META,
  PLAY_MODE,
  SP,
} from "@/app/constants";
import { FALLBACK_WORDS, formatPackLabel } from "@/app/questions";
import { useLobby, useUser } from "@/hooks";
import {
  castVote,
  clearClientLobbyMembership,
  hostBeginVote,
  hostNextRound,
  hostSkipQuestion,
  joinLobby,
  leaveLobby,
  lockAnswersIfNeeded,
  lockVotesIfNeeded,
  patchLobbyFields,
  returnToLobby,
  setEnabledPacks,
  setTimerSeconds,
  startGame,
  submitAnswer,
  subscribeLobby,
} from "@/utils/firebase/firebaseHelpers";
import {
  clearLocalLobby,
  hydrateLocalIfMatch,
  isLocalHotseatCode,
  localAddPlayer,
  localBeginVote,
  localCastVote,
  localEnsureHotseatVoter,
  localHostNextRound,
  localLockAnswersIfNeeded,
  localLockVotesIfNeeded,
  localRemovePlayer,
  localReturnToLobby,
  localSetPacks,
  localSetTimer,
  localSkipQuestion,
  localStartGame,
  localSubmitAnswer,
} from "@/utils/localLobby";
import NameEditor from "@/app/components/NameEditor";
import {
  modeFromPlayMode,
  trackAnswerSubmitted,
  trackGameStarted,
  trackQuestionSkipped,
  trackRoundFinished,
  trackVoteCast,
} from "@/utils/analytics";
import {
  clearSuppressRejoin,
  markLeftLobby,
  shouldSuppressRejoin,
} from "@/utils/lobbyLeave";

export default function LobbyPage() {
  const params = useParams();
  const router = useRouter();
  const lobbyCode = String(params.lobbyCode || "").toUpperCase();
  const lobby = useLobby();
  const { userId, playerName, userFetched, booted } = useUser();
  const [packs, setPacks] = useState<Record<string, string[]>>(FALLBACK_WORDS);
  const [packsState, setPacksState] = useState<"loading" | "ready" | "error">("loading");
  const [hotseatName, setHotseatName] = useState("");
  const [answerDraft, setAnswerDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [passReveal, setPassReveal] = useState(false);
  const joinedRef = useRef(false);
  const packsRef = useRef(packs);
  packsRef.current = packs;

  const local = lobby?.playMode === PLAY_MODE.HOTSEAT || isLocalHotseatCode(lobbyCode);
  const isHost = local || (!!userId && lobby?.hostId === userId);

  useEffect(() => {
    if (hydrateLocalIfMatch(lobbyCode)) return;
    if (shouldSuppressRejoin()) {
      clearClientLobbyMembership();
      router.replace("/");
      return;
    }
    if (!booted || !userFetched || !userId) return;
    const unsub = subscribeLobby(lobbyCode);
    return () => unsub();
  }, [lobbyCode, booted, userFetched, userId, router]);

  useEffect(() => {
    if (local || joinedRef.current || !userId || !userFetched) return;
    if (shouldSuppressRejoin()) return;
    joinedRef.current = true;
    clearSuppressRejoin();
    const name =
      playerName ||
      (typeof window !== "undefined" ? localStorage.getItem(SP.playerName) : "") ||
      "Player";
    void joinLobby(lobbyCode, userId, name).then((res) => {
      if (!res.ok) setError(res.message || "Could not join");
    });
  }, [local, userId, userFetched, lobbyCode, playerName]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch("/api/words", { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (cancel) return;
        if (res.ok && data?.ok && data.packs && Object.keys(data.packs).length) {
          setPacks(data.packs);
          setPacksState("ready");
        } else {
          setPacks(FALLBACK_WORDS);
          setPacksState("ready");
        }
      } catch {
        if (!cancel) {
          setPacks(FALLBACK_WORDS);
          setPacksState("ready");
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (lobby?.gameState !== GAME_STATE.ANSWERING) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [lobby?.gameState, lobby?.currentRound?.endsAt]);

  useEffect(() => {
    if (lobby?.gameState !== GAME_STATE.ANSWERING || !lobby.currentRound) return;
    if (now < lobby.currentRound.endsAt) return;
    if (local) localLockAnswersIfNeeded();
    else void lockAnswersIfNeeded(lobbyCode);
  }, [now, lobby?.gameState, lobby?.currentRound?.endsAt, local, lobbyCode]);

  // Legacy / in-flight lobbies stuck on reveal_anon: open voting without a host tap.
  // Depend only on gameState so we don't re-fire hostBeginVote (which clears votes).
  useEffect(() => {
    if (lobby?.gameState !== GAME_STATE.REVEAL_ANON) return;
    if (local) {
      localBeginVote();
      setPassReveal(false);
    } else if (isHost) {
      void hostBeginVote(lobbyCode);
    }
  }, [lobby?.gameState, local, isHost, lobbyCode]);

  // Pass-and-play: if hotseat pointer is missing/stale, point at host or next unvoted player.
  useEffect(() => {
    if (!local || lobby?.gameState !== GAME_STATE.VOTING) return;
    localEnsureHotseatVoter();
  }, [
    local,
    lobby?.gameState,
    lobby?.currentRound?.hotseatVoterId,
    lobby?.currentRound?.votes,
    lobby?.players,
  ]);

  useEffect(() => {
    if (lobby?.gameState !== GAME_STATE.VOTING || !lobby.currentRound) return;
    const votes = lobby.currentRound.votes || {};
    const players = lobby.players || [];
    if (players.length && players.every((p) => !!votes[p.userId])) {
      if (local) localLockVotesIfNeeded();
      else void lockVotesIfNeeded(lobbyCode);
    }
  }, [lobby?.gameState, lobby?.currentRound?.votes, lobby?.players, local, lobbyCode]);

  useEffect(() => {
    if (lobby?.gameState === GAME_STATE.REVEAL_NAMES && lobby.round) {
      trackRoundFinished({
        mode: modeFromPlayMode(lobby.playMode),
        round: lobby.round,
        lobbyCode,
        packId: lobby.currentRound?.packId,
      });
    }
  }, [lobby?.gameState, lobby?.round, lobby?.playMode, lobby?.currentRound?.packId, lobbyCode]);

  useEffect(() => {
    setAnswerDraft("");
    setPassReveal(false);
  }, [lobby?.gameState, lobby?.round, lobby?.currentRound?.hotseatVoterId]);

  const catalog = useMemo(() => {
    const ids = Object.keys(packs);
    const preferred = Object.keys(PACK_META);
    const ordered = [
      ...preferred.filter((id) => ids.includes(id)),
      ...ids.filter((id) => !preferred.includes(id)).sort(),
    ];
    return ordered;
  }, [packs]);

  const saved = Array.isArray(lobby?.enabledPacks) ? lobby!.enabledPacks! : null;
  const selectable = catalog.filter((id) => (packs[id] || []).length > 0);
  const enabled = saved ? selectable.filter((id) => saved.includes(id)) : selectable;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const players = lobby?.players || [];
  const timerSeconds = lobby?.timerSeconds ?? constants.defaultTimerSeconds;
  const secondsLeft = lobby?.currentRound
    ? Math.max(0, Math.ceil((lobby.currentRound.endsAt - now) / 1000))
    : 0;
  const answers = lobby?.currentRound?.answers || {};
  const votes = lobby?.currentRound?.votes || {};
  const myAnswer = userId ? answers[userId] : undefined;
  const myVote = userId ? votes[userId] : undefined;
  const answeredCount = players.filter((p) => !!(answers[p.userId] || "").trim()).length;
  const votedCount = Object.keys(votes).length;
  const scores = lobby?.scores || {};
  const scoresDelta = lobby?.currentRound?.scoresDelta || {};

  const answerOrder =
    lobby?.currentRound?.answerOrder?.length
      ? lobby.currentRound.answerOrder
      : players.map((p) => p.userId);

  const hotseatVoterId = lobby?.currentRound?.hotseatVoterId;
  const hotseatVoter = players.find((p) => p.userId === hotseatVoterId);
  const hotseatPhase =
    local &&
    (lobby?.gameState === GAME_STATE.ANSWERING || lobby?.gameState === GAME_STATE.VOTING);
  const showHotseatPass = hotseatPhase && !passReveal;

  const togglePack = (id: string) => {
    if (!isHost) {
      setError("Only the host can change packs.");
      return;
    }
    const current = enabledRef.current;
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
    enabledRef.current = next;
    if (local) {
      localSetPacks(next);
      return;
    }
    patchLobbyFields({ enabledPacks: next });
    void setEnabledPacks(lobbyCode, next).catch(() =>
      setError("Could not update packs — check Firestore rules on akxh-games.")
    );
  };

  const onTimerChange = (value: number) => {
    if (!isHost) return;
    if (local) {
      localSetTimer(value);
      return;
    }
    patchLobbyFields({ timerSeconds: value });
    void setTimerSeconds(lobbyCode, value).catch(() =>
      setError("Could not update timer — check Firestore rules on akxh-games.")
    );
  };

  const startBlockedReason =
    packsState !== "ready"
      ? "Loading packs…"
      : players.length < constants.minPlayers
        ? `Add ${constants.minPlayers - players.length} more player${
            constants.minPlayers - players.length === 1 ? "" : "s"
          } (${players.length}/${constants.minPlayers})`
        : enabled.length === 0
          ? "Select at least one pack"
          : "";

  const onStart = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    const chosen = enabledRef.current;
    try {
      if (local) {
        const res = localStartGame(packsRef.current, chosen);
        if (!res.ok) setError(res.error || "Could not start");
        else {
          setPassReveal(false);
          trackGameStarted({
            mode: "pass_and_play",
            playerCount: res.playerCount || players.length,
            lobbyCode,
            packs: chosen,
          });
        }
      } else {
        const res = await startGame(lobbyCode, packsRef.current, chosen);
        if (!res.ok) setError(res.error || "Could not start");
        else {
          trackGameStarted({
            mode: "online",
            playerCount: players.length,
            lobbyCode,
            packs: chosen,
          });
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const onSubmitAnswer = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    const text = answerDraft.trim();
    if (!text) {
      setError("Write a wrong answer first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (local) {
        if (!hotseatVoterId) return;
        const res = localSubmitAnswer(hotseatVoterId, text);
        if (!res.ok) setError(res.error || "Could not submit");
        else {
          trackAnswerSubmitted(modeFromPlayMode(PLAY_MODE.HOTSEAT));
          setAnswerDraft("");
          setPassReveal(false);
        }
      } else {
        if (!userId) return;
        const res = await submitAnswer(lobbyCode, userId, text);
        if (!res.ok) setError(res.error || "Could not submit");
        else {
          trackAnswerSubmitted("online");
          setAnswerDraft("");
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  };

  const onVote = async (answerOwnerId: string) => {
    if (!lobby?.currentRound || busy) return;
    if (local) {
      // Repair stale/null hotseat (host must be able to vote like anyone else).
      const voterId =
        localEnsureHotseatVoter() ||
        hotseatVoterId ||
        lobby.hostId ||
        players[0]?.userId ||
        null;
      if (!voterId) {
        setError("No voter ready — try again.");
        return;
      }
      try {
        const res = localCastVote(voterId, answerOwnerId);
        if (!res.ok) {
          setError(res.error || "Vote failed");
          return;
        }
        trackVoteCast("pass_and_play");
        setError("");
        setPassReveal(false);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Vote failed");
      }
      return;
    }
    if (!userId) {
      setError("Missing player id — refresh and try again.");
      return;
    }
    try {
      await castVote(lobbyCode, userId, answerOwnerId);
      trackVoteCast("online");
      setError("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Vote failed");
    }
  };

  const onSkip = async () => {
    if (busy || !isHost) return;
    setBusy(true);
    setError("");
    try {
      if (local) {
        const res = localSkipQuestion(packsRef.current);
        if (!res.ok) setError(res.error || "Could not skip");
        else {
          setPassReveal(false);
          trackQuestionSkipped("pass_and_play");
        }
      } else {
        const res = await hostSkipQuestion(lobbyCode, packsRef.current);
        if (!res.ok) setError(res.error || "Could not skip");
        else trackQuestionSkipped("online");
      }
    } finally {
      setBusy(false);
    }
  };

  const onNext = async () => {
    setBusy(true);
    setError("");
    try {
      if (local) {
        const res = localHostNextRound(packsRef.current);
        if (!res.ok) setError(res.error || "No more questions");
        else setPassReveal(false);
      } else {
        const res = await hostNextRound(lobbyCode, packsRef.current);
        if (!res.ok) setError(res.error || "Could not advance");
      }
    } finally {
      setBusy(false);
    }
  };

  const onLeave = async () => {
    markLeftLobby();
    if (local || isLocalHotseatCode(lobbyCode)) {
      clearLocalLobby();
      clearClientLobbyMembership();
      router.replace("/");
      return;
    }
    if (userId) await leaveLobby(lobbyCode, userId);
    else clearClientLobbyMembership();
    router.replace("/");
  };

  if (!local && !lobby?.lobbyFetched) {
    return (
      <main className="flex flex-1 items-center justify-center text-[var(--SP-muted)]">
        Connecting to lobby…
      </main>
    );
  }

  if (!lobby || lobby.missing) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 text-center px-4">
        <p className="text-lg">Lobby not found or couldn’t connect.</p>
        <p className="text-sm text-[var(--SP-muted)] max-w-sm">
          If this is an online lobby, publish shaanpatti Firestore rules on akxh-games (no Auth).
          Pass &amp; play does not need that.
        </p>
        <button type="button" className="SP-btn" onClick={() => router.push("/")}>
          Home
        </button>
      </main>
    );
  }

  const rankedScores = [...players]
    .map((p) => ({ ...p, score: scores[p.userId] || 0 }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return (
    <main className="flex flex-1 flex-col animate-riseIn gap-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="SP-brand text-3xl leading-none">Shaanpatti</p>
          <p className="mt-1 text-sm text-[var(--SP-muted)]">
            {local ? "Pass & play" : "Online"} · code{" "}
            <span className="tracking-[0.25em] text-[var(--SP-text)] font-semibold">
              {lobbyCode}
            </span>
          </p>
        </div>
        <button type="button" className="SP-btn-ghost py-2 px-3 text-sm" onClick={onLeave}>
          Leave
        </button>
      </header>

      {!local && (
        <div className="flex justify-start">
          <NameEditor name={playerName} compact />
        </div>
      )}

      {lobby.gameState === GAME_STATE.LOBBY && (
        <section className="space-y-5">
          <div className="SP-panel rounded-2xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-xl">Players</h2>
              <span className="text-sm text-[var(--SP-muted)]">
                {players.length}/{constants.maxPlayers}
              </span>
            </div>
            <ul className="space-y-2">
              {players.map((p) => (
                <li
                  key={p.userId}
                  className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2"
                >
                  <span>
                    {p.name}
                    {(p.isHost || p.userId === lobby.hostId) && (
                      <span className="ml-2 text-xs text-[var(--SP-accent-2)]">host</span>
                    )}
                  </span>
                  {local && isHost && p.userId !== lobby.hostId && (
                    <button
                      type="button"
                      className="text-xs text-[var(--SP-muted)]"
                      onClick={() => localRemovePlayer(p.userId)}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {local && (
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const res = localAddPlayer(hotseatName);
                  if (!res.ok) setError(res.message || "Could not add");
                  else {
                    setHotseatName("");
                    setError("");
                  }
                }}
              >
                <input
                  className="SP-input py-2"
                  value={hotseatName}
                  onChange={(e) => setHotseatName(e.target.value.slice(0, 24))}
                  placeholder="Add player"
                  maxLength={24}
                />
                <button type="submit" className="SP-btn py-2 px-3 text-sm shrink-0">
                  Add
                </button>
              </form>
            )}
            <p className="mt-3 text-xs text-[var(--SP-muted)]">
              Need {constants.minPlayers}+ players to start.
            </p>
          </div>

          <div className="SP-panel rounded-2xl p-4 space-y-3">
            <h2 className="font-display text-xl">Question packs</h2>
            <p className="text-sm text-[var(--SP-muted)]">
              Host picks vibes — everyone writes hilariously wrong answers.
            </p>
            {packsState === "loading" && (
              <p className="text-sm text-[var(--SP-muted)]">Loading packs…</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {catalog.map((id) => {
                const on = enabled.includes(id);
                const meta = PACK_META[id];
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={!isHost}
                    onClick={() => togglePack(id)}
                    className={`SP-chip ${on ? "SP-chip-on" : ""}`}
                  >
                    <div className="font-semibold">
                      {meta?.label || formatPackLabel(id)}
                      {meta?.nsfw ? " · 18+" : ""}
                    </div>
                    <div className="text-xs text-[var(--SP-muted)] mt-0.5">
                      {(packs[id] || []).length} prompts
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="SP-panel rounded-2xl p-4 space-y-3">
            <h2 className="font-display text-xl">Answer timer</h2>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={constants.minTimerSeconds}
                max={constants.maxTimerSeconds}
                step={5}
                value={timerSeconds}
                disabled={!isHost}
                onChange={(e) => onTimerChange(Number(e.target.value))}
                className="flex-1 accent-[var(--SP-accent)]"
              />
              <span className="tabular-nums font-semibold w-12 text-right">{timerSeconds}s</span>
            </div>
          </div>

          {isHost ? (
            <div className="space-y-2">
              <button
                type="button"
                className="SP-btn w-full"
                disabled={busy || !!startBlockedReason}
                onClick={onStart}
              >
                {busy ? "Starting…" : "Start"}
              </button>
              {startBlockedReason && (
                <p className="text-center text-sm text-[var(--SP-muted)]">{startBlockedReason}</p>
              )}
            </div>
          ) : (
            <p className="text-center text-sm text-[var(--SP-muted)]">Waiting for host…</p>
          )}
        </section>
      )}

      {lobby.gameState === GAME_STATE.ANSWERING && lobby.currentRound && (
        <section className="space-y-4 flex-1 flex flex-col">
          {showHotseatPass ? (
            <div className="SP-panel rounded-2xl p-6 flex-1 flex flex-col items-center justify-center text-center gap-4 animate-scaleIn">
              <p className="text-sm uppercase tracking-[0.25em] text-[var(--SP-muted)]">
                Pass the phone
              </p>
              <h2 className="font-display text-3xl">
                {hotseatVoter?.name || "Next player"}
              </h2>
              <p className="text-[var(--SP-muted)]">Write your wrong answer privately.</p>
              <button
                type="button"
                className="SP-btn w-full max-w-xs"
                onClick={() => setPassReveal(true)}
              >
                I&apos;m {hotseatVoter?.name || "ready"}
              </button>
            </div>
          ) : (
            <>
              <div className="SP-panel rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between text-sm text-[var(--SP-muted)]">
                  <span>Round {lobby.round}</span>
                  <span className="tabular-nums text-[var(--SP-accent)] font-semibold text-lg">
                    {secondsLeft}s
                  </span>
                </div>
                <h2 className="font-display text-2xl leading-snug">
                  {lobby.currentRound.question}
                </h2>
                <p className="text-sm text-[var(--SP-muted)]">
                  {answeredCount}/{players.length} answered · wrong answers only
                </p>
                {local && hotseatVoter && (
                  <p className="text-sm text-[var(--SP-mint)]">Answering as {hotseatVoter.name}</p>
                )}
              </div>

              {local || !myAnswer ? (
                <form onSubmit={onSubmitAnswer} className="SP-panel rounded-2xl p-4 space-y-3">
                  <label className="block text-sm text-[var(--SP-muted)]">Your wrong answer</label>
                  <textarea
                    className="SP-input min-h-[110px] resize-none"
                    value={answerDraft}
                    onChange={(e) => setAnswerDraft(e.target.value.slice(0, 200))}
                    placeholder="Be confidently incorrect…"
                    maxLength={200}
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="SP-btn w-full"
                    disabled={busy || !answerDraft.trim()}
                  >
                    {busy ? "Submitting…" : "Submit answer"}
                  </button>
                </form>
              ) : (
                <div className="SP-panel rounded-2xl p-5 space-y-2 animate-scaleIn">
                  <p className="text-sm text-[var(--SP-mint)]">Answer locked in</p>
                  <p className="text-lg leading-snug">{myAnswer}</p>
                  <p className="text-sm text-[var(--SP-muted)]">
                    Waiting for everyone else…
                  </p>
                </div>
              )}

              {isHost && (
                <button
                  type="button"
                  className="SP-btn-ghost w-full text-sm"
                  disabled={busy}
                  onClick={onSkip}
                >
                  Skip question
                </button>
              )}
            </>
          )}
        </section>
      )}

      {lobby.gameState === GAME_STATE.REVEAL_ANON && lobby.currentRound && (
        <section className="space-y-4 animate-scaleIn">
          <div className="SP-panel rounded-2xl p-5 space-y-2">
            <p className="text-sm text-[var(--SP-muted)]">Anonymous board · Round {lobby.round}</p>
            <h2 className="font-display text-2xl leading-snug">
              {lobby.currentRound.question}
            </h2>
            <p className="text-sm text-[var(--SP-muted)]">Opening votes…</p>
          </div>
        </section>
      )}

      {lobby.gameState === GAME_STATE.VOTING && lobby.currentRound && (
        <section className="space-y-4 flex-1 flex flex-col">
          {showHotseatPass ? (
            <div className="SP-panel rounded-2xl p-6 flex-1 flex flex-col items-center justify-center text-center gap-4 animate-scaleIn">
              <p className="text-sm uppercase tracking-[0.25em] text-[var(--SP-muted)]">
                Pass the phone
              </p>
              <h2 className="font-display text-3xl">
                {hotseatVoter?.name || "Next player"}
              </h2>
              <p className="text-[var(--SP-muted)]">Pick the best wrong answer.</p>
              <button
                type="button"
                className="SP-btn w-full max-w-xs"
                onClick={() => setPassReveal(true)}
              >
                I&apos;m {hotseatVoter?.name || "ready"}
              </button>
            </div>
          ) : (
            <>
              <div className="SP-panel rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between text-sm text-[var(--SP-muted)]">
                  <span>Vote · Round {lobby.round}</span>
                  <span className="tabular-nums text-[var(--SP-accent-2)] font-semibold">
                    {votedCount}/{players.length}
                  </span>
                </div>
                <h2 className="font-display text-2xl leading-snug">
                  {lobby.currentRound.question}
                </h2>
                <p className="text-sm text-[var(--SP-muted)]">
                  Best answer wins · self-vote OK · change until everyone locks
                </p>
                {local && hotseatVoter && (
                  <p className="text-sm text-[var(--SP-mint)]">Voting as {hotseatVoter.name}</p>
                )}
                {!local && myVote && (
                  <p className="text-sm text-[var(--SP-mint)]">You voted — tap another to change</p>
                )}
              </div>

              <div className="space-y-2 flex-1">
                {answerOrder.map((ownerId) => {
                  const text = answers[ownerId] || "(no answer)";
                  // Local: highlight only while this voter still has the phone (clears on pass).
                  const selected = local
                    ? !!(hotseatVoterId && votes[hotseatVoterId] === ownerId)
                    : myVote === ownerId;
                  return (
                    <button
                      key={ownerId}
                      type="button"
                      className={`SP-vote ${selected ? "SP-vote-on" : ""}`}
                      onClick={() => onVote(ownerId)}
                    >
                      {text}
                    </button>
                  );
                })}
              </div>

              {isHost && (
                <button
                  type="button"
                  className="SP-btn-ghost w-full text-sm"
                  disabled={busy}
                  onClick={onSkip}
                >
                  Skip question
                </button>
              )}
            </>
          )}
        </section>
      )}

      {lobby.gameState === GAME_STATE.REVEAL_NAMES && lobby.currentRound && (
        <section className="space-y-4 animate-scaleIn">
          <div className="SP-panel rounded-2xl p-5 space-y-2">
            <p className="text-sm text-[var(--SP-muted)]">Names + points · Round {lobby.round}</p>
            <h2 className="font-display text-2xl leading-snug">
              {lobby.currentRound.question}
            </h2>
          </div>

          <ol className="space-y-2">
            {answerOrder.map((ownerId) => {
              const player = players.find((p) => p.userId === ownerId);
              const roundVotes = scoresDelta[ownerId] || 0;
              return (
                <li
                  key={ownerId}
                  className="SP-panel rounded-2xl px-4 py-3 space-y-1"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold">{player?.name || "Unknown"}</span>
                    <span className="tabular-nums text-[var(--SP-accent)] font-bold">
                      +{roundVotes}
                    </span>
                  </div>
                  <p className="text-[var(--SP-muted)] leading-snug">
                    {answers[ownerId] || "(no answer)"}
                  </p>
                </li>
              );
            })}
          </ol>

          <div className="SP-panel rounded-2xl p-4 space-y-2">
            <h3 className="font-display text-lg">Scoreboard</h3>
            <ul className="space-y-1.5">
              {rankedScores.map((p, i) => (
                <li key={p.userId} className="flex justify-between text-sm">
                  <span>
                    <span className="text-[var(--SP-muted)] mr-2 tabular-nums">{i + 1}.</span>
                    {p.name}
                  </span>
                  <span className="tabular-nums font-semibold text-[var(--SP-accent-2)]">
                    {p.score}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {isHost ? (
            <div className="flex flex-col gap-2">
              <button type="button" className="SP-btn w-full" disabled={busy} onClick={onNext}>
                Next question
              </button>
              <button
                type="button"
                className="SP-btn-ghost w-full"
                onClick={() => {
                  if (local) localReturnToLobby();
                  else void returnToLobby(lobbyCode);
                }}
              >
                Back to lobby
              </button>
            </div>
          ) : (
            <p className="text-center text-sm text-[var(--SP-muted)]">
              Waiting for host to continue…
            </p>
          )}
        </section>
      )}

      {error && (
        <p className="text-center text-sm text-[var(--SP-accent)]" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
