import { createSign } from "crypto";
import { SP_TABLES } from "@/app/constants";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DATASTORE_SCOPE = "https://www.googleapis.com/auth/datastore";

type FirestoreValue = {
  stringValue?: string;
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

function collectionName(): string {
  return `projects/${projectId()}/databases/(default)/documents/${SP_TABLES.WORDS}`;
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

export async function listWordPacks(): Promise<Record<string, string[]>> {
  const packs: Record<string, string[]> = {};
  let pageToken = "";

  do {
    const url = new URL(`https://firestore.googleapis.com/v1/${collectionName()}`);
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
  const url = new URL(
    `https://firestore.googleapis.com/v1/${collectionName()}/${encodeURIComponent(category)}`
  );
  for (const field of ["words", "category", "updatedAt"]) {
    url.searchParams.append("updateMask.fieldPaths", field);
  }
  await firestore(url.toString(), {
    method: "PATCH",
    body: JSON.stringify({ fields: packFields(category, words) }),
  });
}

export async function deleteWordPack(category: string) {
  await firestore(
    `https://firestore.googleapis.com/v1/${collectionName()}/${encodeURIComponent(category)}`,
    { method: "DELETE" },
    true
  );
}

export async function seedWordPacks(packs: Record<string, string[]>, replace: boolean) {
  const writes = Object.entries(packs).map(([category, words]) => {
    const write: {
      update: { name: string; fields: ReturnType<typeof packFields> };
      updateMask?: { fieldPaths: string[] };
    } = {
      update: {
        name: `${collectionName()}/${category}`,
        fields: packFields(category, words),
      },
    };
    if (!replace) {
      write.updateMask = { fieldPaths: ["words", "category", "updatedAt"] };
    }
    return write;
  });

  await firestore(
    `https://firestore.googleapis.com/v1/projects/${projectId()}/databases/(default)/documents:commit`,
    {
      method: "POST",
      body: JSON.stringify({ writes }),
    }
  );
}
