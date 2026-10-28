import type { GameState, PlayMode } from "./constants";

export type Player = {
  userId: string;
  name: string;
  isHost?: boolean;
};

/** playerId → answer text */
export type RoundAnswers = Record<string, string>;

/** voterId → answer owner playerId */
export type RoundVotes = Record<string, string>;

export type CurrentRound = {
  question: string;
  packId: string;
  startedAt: number;
  endsAt: number;
  answers: RoundAnswers;
  /** Shuffled player ids for anonymous board order */
  answerOrder?: string[];
  votes: RoundVotes;
  /** Points awarded this round (ownerId → +votes) */
  scoresDelta?: Record<string, number>;
  /** Pass-and-play: whose turn to answer/vote secretly */
  hotseatVoterId?: string | null;
};

export type Lobby = {
  lobbyCode: string;
  playMode: PlayMode;
  hostId: string;
  gameState: GameState;
  players: Player[];
  enabledPacks?: string[] | null;
  timerSeconds?: number;
  round?: number;
  currentRound?: CurrentRound | null;
  usedQuestions?: string[];
  /** Cumulative points: playerId → score */
  scores?: Record<string, number>;
  createdAt?: unknown;
  lobbyFetched?: boolean;
  /** Snapshot finished but doc missing / permission failed */
  missing?: boolean;
};

export type UserData = {
  userId?: string;
  playerName?: string;
  playerLobbyCode?: string | null;
  userFetched?: boolean;
};
