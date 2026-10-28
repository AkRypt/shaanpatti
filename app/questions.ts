/** Seed / fallback packs. Firestore `shaanpatti_words` is source of truth when seeded. */

export const FALLBACK_WORDS: Record<string, string[]> = {
  chaotic: [
    "What do you do when someone flashes the emergency “save me” hand sign?",
    "How do you put out a kitchen fire with only items in a bathroom?",
    "What’s the correct way to land a plane if the pilot passes out?",
    "How do you treat a bear attack using only a Costco membership?",
    "What’s the safest way to defuse a ticking box that says “definitely not a bomb”?",
    "How do you escape a sinking elevator using only a sandwich?",
    "What’s the official protocol when your parachute becomes a tote bag?",
    "How do you negotiate with a raccoon that stole your car keys?",
    "What’s step one when the Wi‑Fi router starts speaking Latin?",
    "How do you CPR a houseplant in front of an audience?",
  ],
  social: [
    "Best excuse for ghosting your group chat for three weeks?",
    "How do you tell your roommate their cooking is a war crime?",
    "What’s the polite way to steal the aux permanently?",
    "How do you break up with someone using only emojis?",
    "What’s your alibi when you’re caught reading their texts?",
    "How do you decline a wedding invite without starting a feud?",
    "What’s the correct response when someone says “we should hang soon” forever?",
    "How do you leave a party without saying goodbye to anyone?",
    "What’s the best lie when you’re 40 minutes late on purpose?",
    "How do you ask someone to stop double-texting without looking mean?",
  ],
  spicy: [
    "Worst possible thing to say right after “I love you”?",
    "How do you make a first date unforgettable for the wrong reasons?",
    "What’s a terrible safe word and why?",
    "How do you ask for the check without killing the mood?",
    "Worst toast at a wedding?",
    "How do you flirt using only corporate jargon?",
    "What’s the boldest wrong move on a second date?",
    "How do you ruin a perfect kiss in three words?",
    "What’s the worst playlist to put on “to set the vibe”?",
    "How do you invent a fake ex to win an argument?",
  ],
  fake_science: [
    "Explain gravity to a toddler using only conspiracy theories.",
    "How does Wi‑Fi actually work? (wrong answers only)",
    "Why is the sky blue? Be confidently incorrect.",
    "What’s inside a black hole?",
    "How do vaccines work? (comedically wrong)",
    "Why do magnets stick? Wrong answers only.",
    "How does the moon control your group chat?",
    "What really causes hiccups, according to you?",
    "Explain photosynthesis like a tech bro pitch.",
    "Why does toast always land butter-side down? Fake science welcome.",
  ],
  desi: [
    "How do you refuse a second helping from auntie without dying?",
    "Best lie when your mom asks where you were until 3am?",
    "How do you win an arranged-marriage biodata war?",
    "What’s the correct response to “beta, beta ho gaya?”",
    "How do you explain a tattoo to relatives?",
    "How do you survive “shaadi mein zaroor aana” season?",
    "What’s the wrong way to bargain at a market with confidence?",
    "How do you hide a new phone purchase from your parents?",
    "What’s your strategy when relatives ask about your salary?",
    "How do you leave a family WhatsApp group without consequences?",
  ],
};

export function formatPackLabel(packId: string): string {
  return packId
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function pickRandomQuestion(
  packs: Record<string, string[]>,
  enabled: string[],
  used: string[]
): { question: string; packId: string } | null {
  const pool: { question: string; packId: string }[] = [];
  for (const id of enabled) {
    for (const q of packs[id] || []) {
      if (!used.includes(q)) pool.push({ question: q, packId: id });
    }
  }
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}
