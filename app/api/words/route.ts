import { NextResponse } from "next/server";
import { FALLBACK_WORDS } from "@/app/questions";
import { listWordPacks } from "@/utils/firebase/wordPacks";

export async function GET() {
  try {
    const packs = await listWordPacks();
    if (!Object.keys(packs).length) {
      return NextResponse.json(
        { ok: true, packs: FALLBACK_WORDS, source: "fallback" },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.json(
      { ok: true, packs, source: "firestore" },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: true,
        packs: FALLBACK_WORDS,
        source: "fallback",
        warning: e?.message || "Firestore unavailable",
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
