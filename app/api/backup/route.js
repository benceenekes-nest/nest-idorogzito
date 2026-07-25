import { backupAll, dumpAll, dumpTable, DUMP_COLS } from "../../../lib/db";

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
