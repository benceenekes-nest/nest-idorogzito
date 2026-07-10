import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth";
import { resolveUserByEmail, getTasksForUser, getMembers } from "../../../lib/clickup";
import { clientOf } from "../../../lib/clients";
import { getDay, getDayMeta } from "../../../lib/db";
import { delegatesOf, canRecordFor } from "../../../lib/delegates";

export const dynamic = "force-dynamic";

export async function GET(req){
  const session = await getServerSession(authOptions);
  if(!session?.user?.email) return Response.json({ error:"Nincs belépve" }, { status:401 });
  const actor = session.user.email.toLowerCase();
  const url = new URL(req.url);
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0,10);
  const target = (url.searchParams.get("for") || actor).toLowerCase();

  if(!canRecordFor(actor, target))
    return Response.json({ error:"Nincs jogosultságod más nevében rögzíteni." }, { status:403 });

  const me = await resolveUserByEmail(target);
  if(!me) return Response.json({ error:"Nincs ClickUp-tag ehhez az e-mailhez: "+target }, { status:404 });

  // kinek a nevében rögzíthet a belépett kolléga
  const members = await getMembers().catch(()=>[]);
  const nameByEmail = {}; members.forEach(m=>{ nameByEmail[m.email]=m.name; });
  const delegates = delegatesOf(actor).map(e=>({ email:e, name:nameByEmail[e]||e }));

  const raw = await getTasksForUser(me.id);
  const nameById = {}; raw.forEach(t=>{ nameById[t.id]=t.name; });
  const tasks = raw.map(t=>({
    id:t.id, name:t.name, url:t.url, status:t.status,
    dateDone:t.dateDone, dateClosed:t.dateClosed, tags:t.tags||[],
    client: clientOf(t),
    parentId: t.parent || null,
    parentName: t.parent ? (nameById[t.parent]||null) : null
  }));
  const prefill = await getDay({ email: target, date });
  const meta = await getDayMeta({ email: target, date });

  return Response.json({
    me:{ name:me.name, email:me.email },
    actor: { email: actor, name: session.user.name||actor },
    target, delegates,
    date, tasks, prefill, meta
  });
}
