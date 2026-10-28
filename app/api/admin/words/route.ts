import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/utils/adminAuth";
import { FALLBACK_WORDS } from "@/app/questions";
import {
  deleteWordPack,
  listWordPacks,
  saveWordPack,
  seedWordPacks,
} from "@/utils/firebase/wordPacks";

function slugifyCategory(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const packs = await listWordPacks();
    return NextResponse.json({ ok: true, packs });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to load packs" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const category = slugifyCategory(String(body?.category || ""));
    const words = Array.isArray(body?.words)
      ? body.words.map((w: unknown) => String(w).trim()).filter(Boolean)
      : [];

    if (!category) {
      return NextResponse.json({ ok: false, error: "Category required" }, { status: 400 });
    }

    await saveWordPack(category, words);
    return NextResponse.json({ ok: true, category, words });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to save" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const category = slugifyCategory(req.nextUrl.searchParams.get("category") || "");
    if (!category) {
      return NextResponse.json({ ok: false, error: "Category required" }, { status: 400 });
    }
    await deleteWordPack(category);
    return NextResponse.json({ ok: true, category });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to delete" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const replace = !!body?.replace;
    const seeded = Object.keys(FALLBACK_WORDS);
    await seedWordPacks(FALLBACK_WORDS, replace);
    return NextResponse.json({ ok: true, seeded });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Seed failed" },
      { status: 500 }
    );
  }
}
