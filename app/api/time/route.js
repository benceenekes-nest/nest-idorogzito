import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth";
import { resolveUserByEmail } from "../../../lib/clickup";
import { saveDayTx, naploErkezett, naploLezaras, deletePiszkozat } from "../../../lib/db";
import { canRecordFor } from "../../../lib/delegates";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// A mentés menete:
// 1. a beküldött adat NYERSEN a mentési naplóba kerül (még minden ellenőrzés előtt),
// 2. ellenőrzés — ha valami hiányzik, a napló "elutasitva" állapotot kap, a kolléga érthető üzenetet,
// 3. a nap mentése egy tranzakcióban, a végén visszaolvasva, mi van bent,
// 4. ha a visszaolvasott szám nem egyezik a beküldöttel, az hiba — nem "Mentve".
// A naplót a platform óránként átnézi, és a sikertelen mentésről levelet küld.
export async function POST(req){
  const session = await getServerSession(authOptions);
  if(!session?.user?.email) return Response.json({ error:"Lejárt a belépésed. Lépj be újra — a beírt adataid ebben a böngészőben megmaradtak." }, { status:401 });
  const actor = session.user.email.toLowerCase();
  const body = await req.json().catch(()=>({}));
  const email = String(body.for || actor).toLowerCase();
  const date = body.date;

  const nyersSorok = Array.isArray(body.rows) ? body.rows : [];
  let naploId = null;
  try{
    naploId = await naploErkezett({ email, actor, date, payload: body,
      tetelDb: nyersSorok.length, percOssz: nyersSorok.reduce((s,r)=>s+(Math.round(Number(r?.minutes))||0),0) });
  }catch(e){ console.error("Mentési napló írása nem sikerült:", e); }

  const elutasit = async (uzenet, status=400) => {
    await naploLezaras(naploId, { allapot:"elutasitva", hiba: uzenet }).catch(()=>{});
    return Response.json({ error: uzenet }, { status });
  };

  if(!canRecordFor(actor, email)) return elutasit("Nincs jogosultságod más nevében rögzíteni.", 403);
  const name = (email===actor) ? (session.user.name || email) : null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||"")) return elutasit("Hibás dátum.");

  const clean = nyersSorok.filter(r=>r && r.taskId && Number(r.minutes)>0).map(r=>({
    taskId:String(r.taskId), taskName:r.taskName||null, parentId:r.parentId||null, parentName:r.parentName||null,
    client:r.client||null, activity:r.activity||null, minutes:Math.round(Number(r.minutes)), archived:!!r.archived
  }));
  if(!clean.length) return elutasit("Nincs menteni való tétel.");
  // Új (aktív) tételhez kötelező a tevékenységtípus; a korábban rögzített, mostanra
  // lezárt (archív) tételeket viszont nem blokkoljuk, hogy meg tudjanak maradni.
  if(clean.some(r=>!r.archived && (!r.activity || !String(r.activity).trim())))
    return elutasit("Minden tételhez kötelező tevékenységtípust választani.");
  const removedIds = Array.isArray(body.removedIds) ? body.removedIds.map(String) : null;

  const loc = (body.location==="iroda"||body.location==="home") ? body.location : null;
  if(!loc) return elutasit("Hiányzik a munkavégzés helye (iroda vagy home office).");

  const partial = !!body.partial;
  const missingMinutes = partial ? Math.max(0, Math.min(480, Math.round(Number(body.missingMinutes)||0))) : 0;
  const reason = partial ? String(body.reason||"").trim().slice(0,300) : "";
  if(partial && (!missingMinutes || !reason)){
    return elutasit("Nem teljes munkanapnál add meg a kieső időt és az indokot.");
  }

  const vartDb = clean.length;
  const vartPerc = clean.reduce((s,r)=>s+r.minutes,0);
  try{
    let me=null; try{ me = await resolveUserByEmail(email); }catch(e){}
    const finalName = name || me?.name || email;
    const bent = await saveDayTx({ email, name: finalName, clickupId: me?.id||null, date, rows: clean,
      enteredBy: (email===actor)? null : actor, removedIds,
      meta: { location: loc, partial, missingMinutes, reason: reason||null } });

    // A visszaolvasott tételszám lehet NAGYOBB a beküldöttnél (a nap más, nem érintett
    // feladatai megmaradnak), de kisebb nem: az azt jelentené, hogy valami nem került be.
    if(bent.db < vartDb || bent.location !== loc){
      const uzenet = `A mentés után ${bent.db} tétel van bent, de ${vartDb} tételt küldtél. Próbáld újra; ha ismét így jár, szólj Bencének.`;
      await naploLezaras(naploId, { allapot:"hiba", hiba: uzenet, mentettDb: bent.db, mentettPerc: bent.perc }).catch(()=>{});
      return Response.json({ error: uzenet, stored: bent }, { status:500 });
    }
    await naploLezaras(naploId, { allapot:"mentve", mentettDb: bent.db, mentettPerc: bent.perc }).catch(()=>{});
    await deletePiszkozat({ email, date }).catch(()=>{});
    return Response.json({ ok:true, saved: vartDb, submittedMinutes: vartPerc, stored: bent,
      location: loc, partial, missingMinutes, forEmail: email });
  }catch(e){
    console.error("Mentési hiba:", e);
    await naploLezaras(naploId, { allapot:"hiba", hiba: String(e?.message||e) }).catch(()=>{});
    return Response.json({ error:"A mentés nem sikerült (szerverhiba). A beírt adataid ebben a böngészőben megmaradtak — próbáld újra pár perc múlva. A hibáról Bence automatikusan értesítést kap." }, { status:500 });
  }
}
