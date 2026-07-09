import { sql } from "@vercel/postgres";
import { ensureSchema } from "../../../lib/db";

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "x-exec-key, content-type",
  "Access-Control-Max-Age": "86400"
};
export async function OPTIONS(){ return new Response(null, { status:204, headers: CORS }); }
const J = (obj, status=200) => Response.json(obj, { status, headers: CORS });

function d2s(v){ return (v instanceof Date ? v : new Date(v)).toISOString().slice(0,10); }
function todayISO(){ const d=new Date(); const z=new Date(d.getTime()-d.getTimezoneOffset()*60000); return z.toISOString().slice(0,10); }
function addDays(s,n){ const d=new Date(s+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
// hétfő
function weekStart(s){ const d=new Date(s+"T00:00:00Z"); const w=(d.getUTCDay()+6)%7; d.setUTCDate(d.getUTCDate()-w); return d.toISOString().slice(0,10); }
// Napi elvárt munkaidő percben: hétfő–csütörtök 8 óra, péntek 7 óra, hétvégén 0.
function dailyMinutes(ds){
  const w=new Date(ds+"T00:00:00Z").getUTCDay();
  if(w===0||w===6) return 0;
  return w===5 ? 420 : 480;
}
function workdays(from,to){
  let n=0; const a=new Date(from+"T00:00:00Z"), b=new Date(to+"T00:00:00Z");
  for(let d=new Date(a); d<=b; d.setUTCDate(d.getUTCDate()+1)){ const w=d.getUTCDay(); if(w!==0&&w!==6) n++; }
  return n;
}
function capacityMinutes(from,to){
  let m=0; const a=new Date(from+"T00:00:00Z"), b=new Date(to+"T00:00:00Z");
  for(let d=new Date(a); d<=b; d.setUTCDate(d.getUTCDate()+1)) m+=dailyMinutes(d.toISOString().slice(0,10));
  return m;
}

export async function GET(req){
  const key = process.env.EXEC_KEY || "";
  const given = req.headers.get("x-exec-key") || "";
  if(!key || given !== key) return J({ error:"Hozzáférés megtagadva" }, 401);

  await ensureSchema();
  const url = new URL(req.url);
  const t = todayISO();
  const from = url.searchParams.get("from") || addDays(t,-27);
  const to   = url.searchParams.get("to")   || t;

  const { rows: te } = await sql`SELECT user_email, user_name, work_date, client, activity, minutes
    FROM time_entries WHERE work_date BETWEEN ${from} AND ${to}`;
  const { rows: wd } = await sql`SELECT user_email, work_date, location, partial, missing_minutes, reason
    FROM work_days WHERE work_date BETWEEN ${from} AND ${to}`;
  const { rows: lv } = await sql`SELECT user_email, user_name, leave_date, kind
    FROM leave_days WHERE leave_date BETWEEN ${from} AND ${addDays(t,30)}`;

  const nameOf = {};
  te.forEach(r=>{ if(r.user_name) nameOf[r.user_email]=r.user_name; });
  lv.forEach(r=>{ if(r.user_name && !nameOf[r.user_email]) nameOf[r.user_email]=r.user_name; });

  const sum = (arr,keyfn)=>{ const m={}; arr.forEach(r=>{ const k=keyfn(r); m[k]=(m[k]||0)+Number(r.minutes||0); }); return m; };

  const byUser   = sum(te, r=>r.user_email);
  const byClient = sum(te, r=>r.client||"—");
  const byActivity = sum(te, r=>r.activity||"—");
  const byWeekUser = {};
  te.forEach(r=>{ const w=weekStart(d2s(r.work_date)); const k=r.user_email;
    (byWeekUser[w] ||= {}); byWeekUser[w][k]=(byWeekUser[w][k]||0)+Number(r.minutes||0); });

  // szabadság a vizsgált időszakban, felhasználónként (munkanapok + az aznapi elvárt perc)
  const leaveDays = {}, leaveMin = {};
  lv.forEach(r=>{ const ds=d2s(r.leave_date); if(ds<from||ds>to) return;
    const dm=dailyMinutes(ds); if(!dm) return;
    (leaveDays[r.user_email] ||= 0); leaveDays[r.user_email]++;
    (leaveMin[r.user_email] ||= 0); leaveMin[r.user_email]+=dm; });

  // nem teljes munkanapok: kieső perc és indok
  const missingMin = {}, partialDays = [];
  wd.forEach(r=>{ if(!r.partial) return;
    const mm=Number(r.missing_minutes)||0;
    (missingMin[r.user_email] ||= 0); missingMin[r.user_email]+=mm;
    partialDays.push({ email:r.user_email, name:nameOf[r.user_email]||r.user_email,
      date:d2s(r.work_date), missingMin:mm, reason:r.reason||"" }); });
  partialDays.sort((a,b)=>a.date.localeCompare(b.date));

  const wdCount = workdays(from,to);
  const baseCapacity = capacityMinutes(from,to);
  const utilization = Object.keys(byUser).map(email=>{
    const capacity = baseCapacity - (leaveMin[email]||0) - (missingMin[email]||0);
    const logged = byUser[email];
    return { email, name:nameOf[email]||email, loggedMin:logged, capacityMin:Math.max(capacity,0),
      missingMin: missingMin[email]||0,
      pct: capacity>0 ? Math.round(logged/capacity*1000)/10 : null };
  }).sort((a,b)=>b.loggedMin-a.loggedMin);

  const loc = { iroda:0, home:0 };
  const locByUser = {};
  wd.forEach(r=>{ if(loc[r.location]!==undefined) loc[r.location]++;
    (locByUser[r.user_email] ||= {iroda:0,home:0}); locByUser[r.user_email][r.location]++; });

  const onLeaveToday = lv.filter(r=>d2s(r.leave_date)===t)
    .map(r=>({ email:r.user_email, name:nameOf[r.user_email]||r.user_email, kind:r.kind }));
  const leaveUpcoming = lv.filter(r=>{ const ds=d2s(r.leave_date); return ds>t && ds<=addDays(t,30); })
    .map(r=>({ date:d2s(r.leave_date), email:r.user_email, name:nameOf[r.user_email]||r.user_email, kind:r.kind }))
    .sort((a,b)=>a.date.localeCompare(b.date));

  return J({
    range:{ from, to, workdays:wdCount, capacityMin:baseCapacity }, today:t,
    users: Object.keys(byUser).map(e=>({ email:e, name:nameOf[e]||e, minutes:byUser[e] })).sort((a,b)=>b.minutes-a.minutes),
    byClient: Object.entries(byClient).sort((a,b)=>b[1]-a[1]),
    byActivity: Object.entries(byActivity).sort((a,b)=>b[1]-a[1]),
    byWeekUser, utilization, partialDays, location:{ totals:loc, byUser:locByUser },
    leave:{ today:onLeaveToday, upcoming:leaveUpcoming, daysInRange:leaveDays },
    names: nameOf
  });
}
