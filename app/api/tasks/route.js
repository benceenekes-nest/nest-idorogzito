import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth";
import { resolveUserByEmail, getTasksForUser } from "../../../lib/clickup";
import { clientOf } from "../../../lib/clients";
import { getDay, getLocation } from "../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(req){
  const session = await getServerSession(authOptions);
  if(!session?.user?.email) return Response.json({ error:"Nincs belépve" }, { status:401 });
  const email = session.user.email.toLowerCase();
  const url = new URL(req.url);
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0,10);

  const me = await resolveUserByEmail(email);
  if(!me) return Response.json({ error:"Nincs ClickUp-tag ehhez az e-mailhez: "+email }, { status:404 });

  const raw = await getTasksForUser(me.id);
  const nameById = {}; raw.forEach(t=>{ nameById[t.id]=t.name; });
  const tasks = raw.map(t=>({
    id:t.id, name:t.name, url:t.url, status:t.status,
    dateDone:t.dateDone, dateClosed:t.dateClosed,
    client: clientOf(t),
    parentId: t.parent || null,
    parentName: t.parent ? (nameById[t.parent]||null) : null
  }));
  const prefill = await getDay({ email, date });
  const location = await getLocation({ email, date });
  return Response.json({ me:{ name:me.name, email:me.email }, date, tasks, prefill, location });
}
