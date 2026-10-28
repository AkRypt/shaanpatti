import { createSign } from "crypto";
import { PACK_META, SP_TABLES } from "@/app/constants";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DATASTORE_SCOPE = "https://www.googleapis.com/auth/datastore";

type FirestoreValue = {
  stringValue?: string;
  booleanValue?: boolean;
  integerValue?: string;
  arrayValue?: { values?: FirestoreValue[] };
};

let tokenCache: { value: string; expMs: number } | null = null;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} is not set`);
  }
  return value.trim();
}

function privateKey(): string {
  return requiredEnv("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n");
}

function projectId(): string {
  return requiredEnv("FIREBASE_PROJECT_ID");
}

function wordsCollection(): string {
  return `projects/${projectId()}/databases/(default)/documents/${SP_TABLES.WORDS}`;
}

function packsCollection(): string {
  return `projects/${projectId()}/databases/(default)/documents/${SP_TABLES.PACKS}`;
}

async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.expMs > Date.now() + 60_000) {
    return tokenCache.value;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString(
    "base64url"
  );
  const claim = Buffer.from(
    JSON.stringify({
      iss: requiredEnv("FIREBASE_CLIENT_EMAIL"),
      scope: DATASTORE_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  ).toString("base64url");
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(privateKey()).toString("base64url")}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) {
    throw new Error(data?.error_description || "Could not authorize Firestore");
  }

  const expiresIn = Number(data.expires_in) || 3600;
  tokenCache = {
    value: data.access_token,
    expMs: Date.now() + expiresIn * 1000,
  };
  return tokenCache.value;
}

async function firestore(url: string, init?: RequestInit, allowNotFound = false) {
  const token = await accessToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (allowNotFound && res.status === 404) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error?.message || `Firestore request failed (${res.status})`);
  }
  return data;
}

function wordsFromField(field: FirestoreValue | undefined): string[] {
  const values = field?.arrayValue?.values;
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value?.stringValue || "").trim()).filter(Boolean);
}

function packFields(category: string, words: string[]) {
  return {
    category: { stringValue: category },
    words: {
      arrayValue: {
        values: words.map((word) => ({ stringValue: word })),
      },
    },
    updatedAt: { stringValue: new Date().toISOString() },
  };
}

function packMetaFields(category: string, words: string[]) {
  const meta = PACK_META[category] || {
    label: category
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" "),
    blurb: "",
  };
  const fields: Record<string, FirestoreValue> = {
    category: { stringValue: category },
    label: { stringValue: meta.label },
    blurb: { stringValue: meta.blurb },
    count: { integerValue: String(words.length) },
    updatedAt: { stringValue: new Date().toISOString() },
  };
  if ("nsfw" in meta && meta.nsfw) {
    fields.nsfw = { booleanValue: true };
  }
  return fields;
}

export async function listWordPacks(): Promise<Record<string, string[]>> {
  const packs: Record<string, string[]> = {};
  let pageToken = "";

  do {
    const url = new URL(`https://firestore.googleapis.com/v1/${wordsCollection()}`);
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const data = await firestore(url.toString());
    for (const doc of data?.documents || []) {
      const id = decodeURIComponent(String(doc?.name || "").split("/").pop() || "");
      if (!id) continue;
      packs[id] = wordsFromField(doc?.fields?.words);
    }
    pageToken = data?.nextPageToken || "";
  } while (pageToken);

  return packs;
}

export async function saveWordPack(category: string, words: string[]) {
  const wordsUrl = new URL(
    `https://firestore.googleapis.com/v1/${wordsCollection()}/${encodeURIComponent(category)}`
  );
  for (const field of ["words", "category", "updatedAt"]) {
    wordsUrl.searchParams.append("updateMask.fieldPaths", field);
  }
  await firestore(wordsUrl.toString(), {
    method: "PATCH",
    body: JSON.stringify({ fields: packFields(category, words) }),
  });

  const metaUrl = new URL(
    `https://firestore.googleapis.com/v1/${packsCollection()}/${encodeURIComponent(category)}`
  );
  for (const field of ["category", "label", "blurb", "count", "updatedAt", "nsfw"]) {
    metaUrl.searchParams.append("updateMask.fieldPaths", field);
  }
  await firestore(metaUrl.toString(), {
    method: "PATCH",
    body: JSON.stringify({ fields: packMetaFields(category, words) }),
  });
}

export async function deleteWordPack(category: string) {
  await firestore(
    `https://firestore.googleapis.com/v1/${wordsCollection()}/${encodeURIComponent(category)}`,
    { method: "DELETE" },
    true
  );
  await firestore(
    `https://firestore.googleapis.com/v1/${packsCollection()}/${encodeURIComponent(category)}`,
    { method: "DELETE" },
    true
  );
}

export async function seedWordPacks(packs: Record<string, string[]>, replace: boolean) {
  type Write = {
    update: { name: string; fields: Record<string, FirestoreValue> };
    updateMask?: { fieldPaths: string[] };
  };

  const writes: Write[] = [];
  for (const [category, words] of Object.entries(packs)) {
    const wordsWrite: Write = {
      update: {
        name: `${wordsCollection()}/${category}`,
        fields: packFields(category, words),
      },
    };
    if (!replace) {
      wordsWrite.updateMask = { fieldPaths: ["words", "category", "updatedAt"] };
    }
    writes.push(wordsWrite);

    const metaWrite: Write = {
      update: {
        name: `${packsCollection()}/${category}`,
        fields: packMetaFields(category, words),
      },
    };
    if (!replace) {
      metaWrite.updateMask = {
        fieldPaths: ["category", "label", "blurb", "count", "updatedAt", "nsfw"],
      };
    }
    writes.push(metaWrite);
  }

  await firestore(
    `https://firestore.googleapis.com/v1/projects/${projectId()}/databases/(default)/documents:commit`,
    {
      method: "POST",
      body: JSON.stringify({ writes }),
    }
  );
}
