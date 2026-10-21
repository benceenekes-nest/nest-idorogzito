import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth";
import { savePiszkozat, deletePiszkozat, frissenMentve } from "../../../lib/db";
import { canRecordFor } from "../../../lib/delegates";

export const dynamic = "force-dynamic";

// A rögzítő űrlap piszkozata a szerveren. A böngésző is tart egy másolatot; ez azért kell,
// hogy egy másik gépről is visszajöjjön, és hogy a platform reggel szólni tudjon,
// ha valaki elkezdett egy napot, de nem mentette el.
export async function POST(req){
  const session = await getServerSession(authOptions);
  if(!session?.user?.email) return Response.json({ error:"Nincs belépve" }, { status:401 });
  const actor = session.user.email.toLowerCase();
  const body = await req.json().catch(()=>({}));
  const email = String(body.for || actor).toLowerCase();
  if(!canRecordFor(actor, email)) return Response.json({ error:"Nincs jogosultság" }, { status:403 });
  const date = body.date;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||"")) return Response.json({ error:"Hibás dátum" }, { status:400 });

  if(body.torles){
    await deletePiszkozat({ email, date });
    return Response.json({ ok:true });
  }
  const payload = body.payload;
  if(!payload || typeof payload !== "object") return Response.json({ error:"Hiányzó piszkozat" }, { status:400 });
  if(await frissenMentve({ email, date })) return Response.json({ ok:true, kihagyva:"frissen mentve" });
  const json = JSON.stringify(payload);
  if(json.length > 200_000) return Response.json({ error:"Túl nagy piszkozat" }, { status:413 });
  const sorok = Object.values(payload.ent||{}).filter(e=>e && e.on).flatMap(e=>e.lines||[]).filter(l=>(Number(l.min)||0)>0);
  await savePiszkozat({ email, actor, date, payload,
    tetelDb: sorok.length, percOssz: sorok.reduce((s,l)=>s+(Math.round(Number(l.min))||0),0) });
  return Response.json({ ok:true });
}
