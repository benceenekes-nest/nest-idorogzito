import { backupAll, dumpAll, dumpTable, DUMP_COLS, diagWorkDate, restoreWorkDate, ingestRows, purgeUserDate } from "../../../lib/db";

// Visszaállító beszúrás listából (Drive CSV-ből). Kulccsal védett, csak hiányzót ad hozzá.
export async function POST(req){
  try{
    const url = new URL(req.url);
    const key = process.env.BACKUP_KEY;
    if(!(key && url.searchParams.get("key")===key)) return Response.json({ error:"Nincs jogosultság" }, { status:401 });
    const body = await req.json().catch(()=>({}));
    const res = await ingestRows(body.rows||[]);
    return Response.json({ ok:true, ...res });
  }catch(e){
    return Response.json({ error:String(e.message||e) }, { status:500 });
  }
}

export const dynamic = "force-dynamic";

function csvCell(v){
  if(v===null||v===undefined) return "";
  let s = v instanceof Date ? v.toISOString().slice(0,10) : String(v);
  if(/[",\n\r]/.test(s)) s = '"'+s.replace(/"/g,'""')+'"';
  return s;
}
function toCsv(cols, rows, withHeader){
  const lines = [];
  if(withHeader) lines.push(cols.join(","));
  for(const r of rows) lines.push(cols.map(c=>csvCell(r[c])).join(","));
  return lines.join("\n")+"\n";
}

// Napi biztonsági mentés. A Vercel cron hívja este; kézzel is futtatható.
// - alap:  DB-pillanatkép + darabszámok (nyilvános, a cronnak)
// - ?export=<tabla>&key=...&offset=&limit=  → lapozható CSV a Drive-mentéshez
// - ?full=1&key=...  → teljes JSON (kis adatnál / kézi használatra)
export async function GET(req){
  try{
    const url = new URL(req.url);
    const key = process.env.BACKUP_KEY;
    const authed = key && url.searchParams.get("key")===key;

    // Lapozható CSV export egy tábláról
    const exp = url.searchParams.get("export");
    if(exp){
      if(!authed) return new Response("Nincs jogosultság", { status:401 });
      const cols = DUMP_COLS[exp];
      if(!cols) return new Response("Ismeretlen tábla", { status:400 });
      const offset = parseInt(url.searchParams.get("offset")||"0", 10) || 0;
      const limit  = parseInt(url.searchParams.get("limit")||"400", 10) || 400;
      const rows = await dumpTable(exp, offset, limit);
      const csv = toCsv(cols, rows||[], offset===0);
      return new Response(csv, { status:200, headers:{
        "Content-Type":"text/csv; charset=utf-8",
        "X-Row-Count": String((rows||[]).length),
        "X-Offset": String(offset), "X-Limit": String(limit)
      }});
    }

    // Diagnosztika: mi esett ki egy munkanaphoz képest
    const diag = url.searchParams.get("diag");
    if(diag){
      if(!authed) return new Response("Nincs jogosultság", { status:401 });
      const d = await diagWorkDate(diag);
      return Response.json({ ok:true, ...d });
    }

    // Célzott takarítás: egy kolléga adott napi tételeinek törlése
    const purge = url.searchParams.get("purge");
    if(purge){
      if(!authed) return new Response("Nincs jogosultság", { status:401 });
      const date = url.searchParams.get("date");
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date||"")) return new Response("Hiányzik/hibás a date", { status:400 });
      const res = await purgeUserDate(purge, date);
      return Response.json({ ok:true, ...res });
    }

    // Visszaállítás: hiányzó tételek pótlása egy pillanatképből (csak hozzáad)
    const restore = url.searchParams.get("restore");
    if(restore){
      if(!authed) return new Response("Nincs jogosultság", { status:401 });
      const snap = url.searchParams.get("snap");
      if(!snap) return new Response("Hiányzik a snap (snapshot dátum)", { status:400 });
      const user = url.searchParams.get("user") || null;
      const res = await restoreWorkDate(restore, snap, user);
      return Response.json({ ok:true, ...res });
    }

    const r = await backupAll();
    if(url.searchParams.get("full")==="1" && authed){
      const data = await dumpAll();
      return Response.json({ ok:true, ...r, data });
    }
    return Response.json({ ok:true, ...r });
  }catch(e){
    return Response.json({ error:String(e.message||e) }, { status:500 });
  }
}
