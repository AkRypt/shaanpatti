import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

export const ADMIN_COOKIE = "shaanpatti_admin";

function getAdminPassword(): string {
  const pwd = process.env.ADMIN_PASSWORD;
  if (!pwd || !pwd.trim()) {
    throw new Error("ADMIN_PASSWORD is not set");
  }
  return pwd;
}

export function makeAdminToken(password = getAdminPassword()): string {
  return createHmac("sha256", password).update("shaanpatti-admin-v1").digest("hex");
}

export function verifyAdminPassword(password: string): boolean {
  try {
    const expected = getAdminPassword();
    const a = new Uint8Array(Buffer.from(password));
    const b = new Uint8Array(Buffer.from(expected));
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function verifyAdminToken(token: string | undefined): boolean {
  if (!token) return false;
  try {
    const expected = new Uint8Array(Buffer.from(makeAdminToken()));
    const got = new Uint8Array(Buffer.from(token));
    if (expected.length !== got.length) return false;
    return timingSafeEqual(expected, got);
  } catch {
    return false;
  }
}

export function isAdminConfigured(): boolean {
  return !!(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.trim());
}

export function isAdminRequest(req: NextRequest): boolean {
  if (!isAdminConfigured()) return false;
  return verifyAdminToken(req.cookies.get(ADMIN_COOKIE)?.value);
}

export async function isAdminSession(): Promise<boolean> {
  const jar = await cookies();
  return verifyAdminToken(jar.get(ADMIN_COOKIE)?.value);
}
