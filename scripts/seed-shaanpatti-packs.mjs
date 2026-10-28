/**
 * Seed Firestore shaanpatti_words (+ shaanpatti_packs meta) from FALLBACK_WORDS.
 * Usage: node scripts/seed-shaanpatti-packs.mjs
 * Loads .env.local — never logs secret values.
 */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

function loadEnvLocal() {
  const path = resolve(root, ".env.local");
  if (!existsSync(path)) {
    throw new Error(".env.local not found");
  }
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val.replace(/\\n/g, "\n");
  }
}

function loadFallbackWords() {
  const src = readFileSync(resolve(root, "app/questions.ts"), "utf8");
  const match = src.match(/export const FALLBACK_WORDS[^=]*=\s*(\{[\s\S]*?\n\})/);
  if (!match) throw new Error("Could not parse FALLBACK_WORDS from app/questions.ts");
  // eslint-disable-next-line no-new-func
  return new Function(`return (${match[1]})`)();
}

const PACK_META = {
  spicy: { label: "Spicy", blurb: "Flirty teases" },
  romantic: { label: "Romantic", blurb: "Soft dating energy" },
  adult_18: { label: "Adult 18+", blurb: "Explicit NSFW", nsfw: true },
  philosophy: { label: "Philosophy", blurb: "Deep / weird" },
  parenthood: { label: "Parenthood", blurb: "Kids & family futures" },
  finance: { label: "Finance", blurb: "Money habits" },
  chaotic: { label: "Chaotic", blurb: "Party chaos" },
  soft_roast: { label: "Soft Roast", blurb: "Light insult comedy" },
};

loadEnvLocal();

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!projectId || !clientEmail || !privateKey) {
  console.error("Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY");
  process.exit(1);
}

console.log(`Seeding shaanpatti_words into project (${projectId.length} char id)…`);

const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

if (!getApps().length) {
  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

const db = getFirestore();
const words = loadFallbackWords();
const categories = Object.keys(words);

for (const category of categories) {
  const list = words[category];
  await db.collection("shaanpatti_words").doc(category).set(
    {
      words: list,
      category,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
  const meta = PACK_META[category] || { label: category, blurb: "" };
  await db.collection("shaanpatti_packs").doc(category).set(
    {
      ...meta,
      category,
      count: list.length,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
  console.log(`  ✓ ${category} (${list.length} questions)`);
}

console.log(`Done. Seeded ${categories.length} packs: ${categories.join(", ")}`);
