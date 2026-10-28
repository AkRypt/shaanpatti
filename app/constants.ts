export const constants = {
  siteUrl: "https://shaanpatti.vercel.app",
  lobbyCodeLength: 5,
  defaultTimerSeconds: 120,
  minTimerSeconds: 30,
  maxTimerSeconds: 180,
  minPlayers: 3,
  maxPlayers: 12,
};

export const SP = {
  userId: "shaanpatti_userId",
  playerName: "shaanpatti_playerName",
  lobbyCode: "shaanpatti_lobbyCode",
};

export const GAME_STATE = {
  LOBBY: "lobby",
  ANSWERING: "answering",
  REVEAL_ANON: "reveal_anon",
  VOTING: "voting",
  REVEAL_NAMES: "reveal_names",
  FINISHED: "finished",
} as const;

export type GameState = (typeof GAME_STATE)[keyof typeof GAME_STATE];

export const PLAY_MODE = {
  ONLINE: "online",
  HOTSEAT: "hotseat",
} as const;

export type PlayMode = (typeof PLAY_MODE)[keyof typeof PLAY_MODE];

/** Namespaced for shared Firebase project (akxh-games). */
export const SP_TABLES = {
  USERS: "shaanpatti_users",
  LOBBIES: "shaanpatti_lobbies",
  WORDS: "shaanpatti_words",
  PACKS: "shaanpatti_packs",
} as const;

export const PACK_META: Record<
  string,
  { label: string; blurb: string; nsfw?: boolean }
> = {
  chaotic: { label: "Chaotic", blurb: "Emergency / absurd wrong answers" },
  social: { label: "Socially unhinged", blurb: "Group-chat chaos" },
  spicy: { label: "Spicy", blurb: "Adult wrong answers", nsfw: true },
  fake_science: { label: "Fake expertise", blurb: "Confidently incorrect" },
  desi: { label: "Desi chaos", blurb: "Indian friend-group energy" },
};
