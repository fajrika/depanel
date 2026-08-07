import { NextResponse } from "next/server";

export async function GET() {
  const url = process.env.SSH_WS_URL || "";
  return NextResponse.json({ url });
}
