import { backupAll, dumpAll } from "../../../lib/db";

export const dynamic = "force-dynamic";

// Napi biztonsági mentés. A Vercel cron hívja este; kézzel is futtatható.
// Kulccsal (?key=...&full=1) a teljes adatot is visszaadja Drive-mentéshez.
export async function GET(req){
  try{
    const r = await backupAll();
    const url = new URL(req.url);
    const key = process.env.BACKUP_KEY;
    if(url.searchParams.get("full")==="1" && key && url.searchParams.get("key")===key){
      const data = await dumpAll();
      return Response.json({ ok:true, ...r, data });
    }
    return Response.json({ ok:true, ...r });
  }catch(e){
    return Response.json({ error:String(e.message||e) }, { status:500 });
  }
}
