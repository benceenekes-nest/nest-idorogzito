import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth";
import { resolveUserByEmail } from "../../../lib/clickup";
import { saveDay, saveDayMeta } from "../../../lib/db";
import { canRecordFor } from "../../../lib/delegates";

export const dynamic = "force-dynamic";

export async function POST(req){
  const session = await getServerSession(authOptions);
  if(!session?.user?.email) return Response.json({ error:"Nincs belépve" }, { status:401 });
  const actor = session.user.email.toLowerCase();
  const body = await req.json().catch(()=>({}));
  const email = (body.for || actor).toLowerCase();
  if(!canRecordFor(actor, email))
    return Response.json({ error:"Nincs jogosultságod más nevében rögzíteni." }, { status:403 });
  const name = (email===actor) ? (session.user.name || email) : null;
  const date = body.date;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||"")) return Response.json({ error:"Hibás dátum" }, { status:400 });

  const clean = (body.rows||[]).filter(r=>r && r.taskId && Number(r.minutes)>0).map(r=>({
    taskId:String(r.taskId), taskName:r.taskName||null, parentId:r.parentId||null, parentName:r.parentName||null,
    client:r.client||null, activity:r.activity||null, minutes:Math.round(Number(r.minutes))
  }));
  if(!clean.length) return Response.json({ error:"Nincs menteni való tétel" }, { status:400 });
  if(clean.some(r=>!r.activity || !String(r.activity).trim()))
    return Response.json({ error:"Minden tételhez kötelező tevékenységtípust választani." }, { status:400 });

  const loc = (body.location==="iroda"||body.location==="home") ? body.location : null;
  if(!loc) return Response.json({ error:"Hiányzik a munkavégzés helye" }, { status:400 });

  const partial = !!body.partial;
  const missingMinutes = partial ? Math.max(0, Math.min(480, Math.round(Number(body.missingMinutes)||0))) : 0;
  const reason = partial ? String(body.reason||"").trim().slice(0,300) : "";
  if(partial && (!missingMinutes || !reason)){
    return Response.json({ error:"Nem teljes munkanapnál add meg a kieső időt és az indokot." }, { status:400 });
  }

  let me=null; try{ me = await resolveUserByEmail(email); }catch(e){}
  const finalName = name || me?.name || email;
  const saved = await saveDay({ email, name: finalName, clickupId: me?.id||null, date, rows: clean,
    enteredBy: (email===actor)? null : actor });
  await saveDayMeta({ email, date, location: loc, partial, missingMinutes, reason: reason||null,
    enteredBy: (email===actor)? null : actor });

  return Response.json({ ok:true, saved, location: loc, partial, missingMinutes, forEmail: email });
}
