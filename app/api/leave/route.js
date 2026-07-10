import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth";
import { setLeave, getLeaves, getLeaveOne } from "../../../lib/db";
import { delegatesOf, canRecordFor } from "../../../lib/delegates";
import { getMembers } from "../../../lib/clickup";

export const dynamic = "force-dynamic";
const KINDS = ["szabadsag","beteg"];
function todayISO(){
  const d=new Date(); const z=new Date(d.getTime()-d.getTimezoneOffset()*60000);
  return z.toISOString().slice(0,10);
}

export async function GET(req){
  const session = await getServerSession(authOptions);
  if(!session?.user?.email) return Response.json({ error:"Nincs belépve" }, { status:401 });
  const actor = session.user.email.toLowerCase();
  const isManager = !!session.user.isManager;
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if(!from || !to) return Response.json({ error:"Hiányzó időszak" }, { status:400 });

  const target = (url.searchParams.get("for") || actor).toLowerCase();
  if(!canRecordFor(actor, target))
    return Response.json({ error:"Nincs jogosultságod más nevében rögzíteni." }, { status:403 });

  const wantsAll = url.searchParams.get("all")==="1" && isManager;
  const rows = await getLeaves({ email: target, from, to, all: wantsAll });
  const days = rows.map(r=>({
    date: (r.leave_date instanceof Date ? r.leave_date : new Date(r.leave_date)).toISOString().slice(0,10),
    kind: r.kind, email: r.user_email, name: r.user_name || r.user_email
  }));

  const members = await getMembers().catch(()=>[]);
  const nameByEmail = {}; members.forEach(m=>{ nameByEmail[m.email]=m.name; });
  const delegates = delegatesOf(actor).map(e=>({ email:e, name:nameByEmail[e]||e }));
  const targetName = target===actor ? (session.user.name||actor) : (nameByEmail[target]||target);

  return Response.json({ isManager, team: wantsAll, today: todayISO(),
    actor:{ email:actor, name: session.user.name||actor },
    target, targetName, delegates,
    me:{ email: target, name: targetName }, days });
}

// Mentés: { changes:[{date, kind|null}], for?: email }
export async function POST(req){
  const session = await getServerSession(authOptions);
  if(!session?.user?.email) return Response.json({ error:"Nincs belépve" }, { status:401 });
  const actor = session.user.email.toLowerCase();
  const isManager = !!session.user.isManager;
  const t = todayISO();

  const body = await req.json().catch(()=>({}));
  const target = (body.for || actor).toLowerCase();
  if(!canRecordFor(actor, target))
    return Response.json({ error:"Nincs jogosultságod más nevében rögzíteni." }, { status:403 });

  let name = session.user.name || actor;
  if(target !== actor){
    const members = await getMembers().catch(()=>[]);
    name = (members.find(m=>m.email===target)||{}).name || target;
  }

  const raw = Array.isArray(body.changes) ? body.changes : [];
  const changes = raw.filter(c=>/^\d{4}-\d{2}-\d{2}$/.test(c?.date||""));
  if(!changes.length) return Response.json({ error:"Nincs menteni való" }, { status:400 });

  const blocked=[]; let saved=0;
  for(const c of changes){
    const kind = KINDS.includes(c.kind) ? c.kind : null;
    const existing = await getLeaveOne({ email: target, date:c.date });
    if(existing && !isManager && c.date <= t){ blocked.push(c.date); continue; }
    if(existing === kind) continue;
    await setLeave({ email: target, name, date:c.date, kind });
    saved++;
  }
  return Response.json({ ok:true, saved, blocked, forEmail: target });
}
