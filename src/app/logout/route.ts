import { destroySession } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  await destroySession();
  return NextResponse.redirect(new URL("/login", req.url));
}