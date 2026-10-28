import { NextRequest, NextResponse } from "next/server";
import { isAdminConfigured, isAdminRequest } from "@/utils/adminAuth";

export async function GET(req: NextRequest) {
  return NextResponse.json({
    ok: true,
    configured: isAdminConfigured(),
    authenticated: isAdminRequest(req),
  });
}
