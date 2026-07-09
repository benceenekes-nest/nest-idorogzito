import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth";
import { getRange, getWorkDaysRange, getLeaves } from "../../../lib/db";

export const dynamic = "force-dynamic";
const d2s = v => (v instanceof Date ? v : new Date(v)).toISOString().slice(0,10);

export async function GET(req){
  const session = await getServerSession(authOptions);
  if(!session?.user?.email) return Response.json({ error:"Nincs belépve" }, { status:401 });
  const isManager = !!session.user.isManager;
  const email = session.user.email.toLowerCase();
  const url = new URL(req.url);
  const today = new Date().toISOString().slice(0,10);
  const from = url.searchParams.get("from") || today;
  const to = url.searchParams.get("to") || today;

  // Nem vezető csak a sajátját kérheti le
  const rows = await getRange({ email, from, to, all: isManager });
  const wd = await getWorkDaysRange({ email, from, to, all: isManager });
  const lv = await getLeaves({ email, from, to, all: isManager });

  const nameOf = {};
  rows.forEach(r=>{ if(r.user_name) nameOf[r.user_email]=r.user_name; });
  lv.forEach(r=>{ if(r.user_name && !nameOf[r.user_email]) nameOf[r.user_email]=r.user_name; });

  const partialDays = wd.filter(r=>r.partial && Number(r.missing_minutes)>0).map(r=>({
    email:r.user_email, name:nameOf[r.user_email]||r.user_email,
    date:d2s(r.work_date), missingMin:Number(r.missing_minutes)||0, reason:r.reason||""
  }));
  const leaves = lv.map(r=>({
    email:r.user_email, name:nameOf[r.user_email]||r.user_email,
    date:d2s(r.leave_date), kind:r.kind
  }));
  const locations = wd.map(r=>({ email:r.user_email, date:d2s(r.work_date), location:r.location }));

  return Response.json({ isManager, from, to, rows, partialDays, leaves, locations });
}
