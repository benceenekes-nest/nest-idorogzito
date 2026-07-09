import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth";
import { setLeave, getLeaves } from "../../../lib/db";

export const dynamic = "force-dynamic";
const KINDS = ["szabadsag","beteg"];

export async function GET(req){
  const session = await getServerSession(authOptions);
  if(!session?.user?.email) return Response.json({ error:"Nincs belépve" }, { status:401 });
  const email = session.user.email.toLowerCase();
  const isManager = !!session.user.isManager;
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if(!from || !to) return Response.json({ error:"Hiányzó időszak" }, { status:400 });
  const wantsAll = url.searchParams.get("all")==="1" && isManager;
  const rows = await getLeaves({ email, from, to, all: wantsAll });
  const days = rows.map(r=>({
    date: (r.leave_date instanceof Date ? r.leave_date : new Date(r.leave_date)).toISOString().slice(0,10),
    kind: r.kind, email: r.user_email, name: r.user_name || r.user_email
  }));
  return Response.json({ isManager, team: wantsAll, me:{ email, name: session.user.name||email }, days });
}

export async function POST(req){
  const session = await getServerSession(authOptions);
  if(!session?.user?.email) return Response.json({ error:"Nincs belépve" }, { status:401 });
  const email = session.user.email.toLowerCase();
  const name = session.user.name || email;
  const body = await req.json().catch(()=>({}));
  const kind = KINDS.includes(body.kind) ? body.kind : null;
  const dates = Array.isArray(body.dates) ? body.dates : (body.date ? [body.date] : []);
  const ok = dates.filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d));
  if(!ok.length) return Response.json({ error:"Nincs érvényes dátum" }, { status:400 });
  for(const d of ok) await setLeave({ email, name, date:d, kind });
  return Response.json({ ok:true, saved: ok.length, kind });
}
