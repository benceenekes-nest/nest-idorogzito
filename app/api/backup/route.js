import { backupAll } from "../../../lib/db";

export const dynamic = "force-dynamic";

// Napi biztonsági mentés. A Vercel cron hívja este; kézzel is futtatható.
// Nem destruktív (csak olvas és külön táblákba másol), ezért nyilvánosan hívható.
export async function GET(){
  try{
    const r = await backupAll();
    return Response.json({ ok:true, ...r });
  }catch(e){
    return Response.json({ error:String(e.message||e) }, { status:500 });
  }
}
