import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth";
import { resolveUserByEmail } from "../../../lib/clickup";
import { saveDay, saveDayMeta } from "../../../lib/db";

export const dynamic = "force-dynamic";

export async function POST(req){
  const session = await getServerSession(authOptions);
  if(!session?.user?.email) return Response.json({ error:"Nincs belépve" }, { status:401 });
  const email = session.user.email.toLowerCase();
  const name = session.user.name || email;

  const body = await req.json().catch(()=>({}));
  const date = body.date;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||"")) return Response.json({ error:"Hibás dátum" }, { status:400 });

  const clean = (body.rows||[]).filter(r=>r && r.taskId && Number(r.minutes)>0).map(r=>({
    taskId:String(r.taskId), taskName:r.taskName||null, parentId:r.parentId||null, parentName:r.parentName||null,
    client:r.client||null, activity:r.activity||null, minutes:Math.round(Number(r.minutes))
  }));
  if(!clean.length) return Response.json({ error:"Nincs menteni való tétel" }, { status:400 });

  const loc = (body.location==="iroda"||body.location==="home") ? body.location : null;
  if(!loc) return Response.json({ error:"Hiányzik a munkavégzés helye" }, { status:400 });

  const partial = !!body.partial;
  const missingMinutes = partial ? Math.max(0, Math.min(480, Math.round(Number(body.missingMinutes)||0))) : 0;
  const lateReason = partial ? String(body.lateReason||"").trim().slice(0,300) : "";
  const earlyReason = partial ? String(body.earlyReason||"").trim().slice(0,300) : "";
  if(partial && (!missingMinutes || (!lateReason && !earlyReason))){
    return Response.json({ error:"Nem teljes munkanapnál add meg a kieső időt és az indokot." }, { status:400 });
  }

  let me=null; try{ me = await resolveUserByEmail(email); }catch(e){}
  const saved = await saveDay({ email, name, clickupId: me?.id||null, date, rows: clean });
  await saveDayMeta({ email, date, location: loc, partial, missingMinutes,
    lateReason: lateReason||null, earlyReason: earlyReason||null });

  return Response.json({ ok:true, saved, location: loc, partial, missingMinutes });
}
