import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, makeAdminToken, verifyAdminPassword } from "@/utils/adminAuth";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const password = String(body?.password || "");
    if (!verifyAdminPassword(password)) {
      return NextResponse.json({ ok: false, error: "Invalid password" }, { status: 401 });
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set(ADMIN_COOKIE, makeAdminToken(password), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    return res;
  } catch (e: any) {
    const msg = e?.message?.includes("ADMIN_PASSWORD")
      ? "ADMIN_PASSWORD is not configured on the server"
      : "Login failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
