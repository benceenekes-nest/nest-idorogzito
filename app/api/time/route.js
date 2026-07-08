import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth";
import { resolveUserByEmail } from "../../../lib/clickup";
import { saveDay } from "../../../lib/db";

export const dynamic = "force-dynamic";

export async function POST(req){
  const session = await getServerSession(authOptions);
  if(!session?.user?.email) return Response.json({ error:"Nincs belépve" }, { status:401 });
  const email = session.user.email.toLowerCase();
  const name = session.user.name || email;

  const body = await req.json().catch(()=>({}));
  const date = body.date;
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if(!date) return Response.json({ error:"Hiányzó dátum" }, { status:400 });

  // csak a belépett felhasználó nevére menthet — az identitást a szerver adja
  const me = await resolveUserByEmail(email);
  const clean = rows
    .filter(r=>r.taskId && Number(r.minutes)>0)
    .map(r=>({ taskId:String(r.taskId), taskName:r.taskName||null, parentId:r.parentId||null,
               parentName:r.parentName||null, client:r.client||null, activity:r.activity||null,
               minutes: Math.round(Number(r.minutes)) }));

  const saved = await saveDay({ email, name, clickupId: me?.id||null, date, rows: clean });
  return Response.json({ ok:true, saved });
}
