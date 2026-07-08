import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth";
import { getRange } from "../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(req){
  const session = await getServerSession(authOptions);
  if(!session?.user?.email) return Response.json({ error:"Nincs belépve" }, { status:401 });
  const isManager = !!session.user.isManager;
  const url = new URL(req.url);
  const today = new Date().toISOString().slice(0,10);
  const from = url.searchParams.get("from") || today;
  const to = url.searchParams.get("to") || today;

  // Nem vezető csak a sajátját kérheti le
  const rows = await getRange({ email: session.user.email.toLowerCase(), from, to, all: isManager });
  return Response.json({ isManager, from, to, rows });
}
