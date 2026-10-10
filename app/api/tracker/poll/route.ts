import { NextResponse, connection } from "next/server";
import { pollOnce, startPolling } from "@/lib/tracker";

export async function GET() {
  await connection();
  startPolling();
  const result = await pollOnce();
  return NextResponse.json(result);
}
