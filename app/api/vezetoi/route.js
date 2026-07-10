import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth";
import { getRange, getWorkDaysRange, getLeaves } from "../../../lib/db";
import { getAllOpenTasks, getCompletedTasks, getMembers, listSpaces } from "../../../lib/clickup";
import { clientOf } from "../../../lib/clients";
import { isExcluded } from "../../../lib/delegates";

export const dynamic = "force-dynamic";

const d2s = v => (v instanceof Date ? v : new Date(v)).toISOString().slice(0,10);
function todayISO(){ const d=new Date(); const z=new Date(d.getTime()-d.getTimezoneOffset()*60000); return z.toISOString().slice(0,10); }
// Elvárt munkaidő: hétfő–csütörtök 8 óra, péntek 7 óra.
function dailyMin(ds){ const w=new Date(ds+"T00:00:00Z").getUTCDay(); if(w===0||w===6) return 0; return w===5?420:480; }
function capacityMin(from,to){
  let m=0; const a=new Date(from+"T00:00:00Z"), b=new Date(to+"T00:00:00Z");
  for(let d=new Date(a); d<=b; d.setUTCDate(d.getUTCDate()+1)) m+=dailyMin(d.toISOString().slice(0,10));
  return m;
}
function weekStart(ds){ const d=new Date(ds+"T00:00:00Z"); const w=(d.getUTCDay()+6)%7; d.setUTCDate(d.getUTCDate()-w); return d.toISOString().slice(0,10); }

export async function GET(req){
  const session = await getServerSession(authOptions);
  if(!session?.user?.email) return Response.json({ error:"Nincs belépve" }, { status:401 });
  if(!session.user.isManager) return Response.json({ error:"Ehhez vezetői jogosultság kell." }, { status:403 });

  const me = session.user.email.toLowerCase();   // a saját sorait kihagyjuk a listákból
  const url = new URL(req.url);
  if(url.searchParams.get("spaces")==="1"){
    const sp = await listSpaces().catch(e=>({ error:String(e.message||e) }));
    return Response.json({ spaces: sp });
  }
  const t = todayISO();
  const from = url.searchParams.get("from") || (t.slice(0,8)+"01");
  const to   = url.searchParams.get("to")   || t;
  // A kolléga-figyelőhöz kell a lezárás dátumszűrése ms-ben: from 00:00 – to 23:59.
  const fromMs = new Date(from+"T00:00:00").getTime();
  const toMs   = new Date(to+"T23:59:59.999").getTime();

  const [entries, workDays, leaves, allTasks, completedAll, members] = await Promise.all([
    getRange({ email:"", from, to, all:true }),
    getWorkDaysRange({ email:"", from, to, all:true }),
    getLeaves({ email:"", from, to:addDays(t,30), all:true }),
    getAllOpenTasks().catch(()=>[]),
    getCompletedTasks({ fromMs, toMs }).catch(()=>[]),
    getMembers().catch(()=>[])
  ]);

  // Csak a saját magához rendelt feladatok kimaradnak; a közös feladatok maradnak.
  const onlyMine = a => a.length>0 && a.every(u=>u.email===me);
  const tasks = allTasks.filter(x=> !onlyMine(x.assignees||[]));
  const completed = completedAll.filter(x=> !onlyMine(x.assignees||[]));

  // ---- nevek
  const nameOf = {};
  entries.forEach(r=>{ if(r.user_name) nameOf[r.user_email]=r.user_name; });
  leaves.forEach(r=>{ if(r.user_name && !nameOf[r.user_email]) nameOf[r.user_email]=r.user_name; });
  members.forEach(m=>{ if(m.email && !nameOf[m.email]) nameOf[m.email]=m.name; });

  // ---- idő
  const teamEntries = entries.filter(r=>r.user_email!==me);
  const sum=(arr,key)=>{ const m={}; arr.forEach(r=>{ const k=key(r)||"—"; m[k]=(m[k]||0)+Number(r.minutes||0); }); return m; };
  const byUser = sum(teamEntries, r=>r.user_email);
  const byClient = sum(teamEntries, r=>r.client);
  const byActivity = sum(teamEntries, r=>r.activity);
  const byUserClient = {};
  const byClientActivity = {};
  const byWeek = {};
  teamEntries.forEach(r=>{
    const u=r.user_email, c=r.client||"—", a=r.activity||"—", m=Number(r.minutes||0);
    (byUserClient[u] ||= {}); byUserClient[u][c]=(byUserClient[u][c]||0)+m;
    (byClientActivity[c] ||= {}); byClientActivity[c][a]=(byClientActivity[c][a]||0)+m;
    const w=weekStart(d2s(r.work_date)); (byWeek[w] ||= {}); byWeek[w][u]=(byWeek[w][u]||0)+m;
  });

  // ---- távollét
  const teamLeaves = leaves.filter(r=>r.user_email!==me);
  const leaveInRange = teamLeaves.filter(r=>{ const ds=d2s(r.leave_date); return ds>=from && ds<=to && dailyMin(ds)>0; });
  const leaveMin={}, leaveDays={}, sickDays={};
  leaveInRange.forEach(r=>{ const ds=d2s(r.leave_date);
    leaveMin[r.user_email]=(leaveMin[r.user_email]||0)+dailyMin(ds);
    if(r.kind==="beteg") sickDays[r.user_email]=(sickDays[r.user_email]||0)+1;
    else leaveDays[r.user_email]=(leaveDays[r.user_email]||0)+1; });

  const teamWorkDays = workDays.filter(r=>r.user_email!==me);
  const partialDays = teamWorkDays.filter(r=>r.partial && Number(r.missing_minutes)>0).map(r=>({
    email:r.user_email, name:nameOf[r.user_email]||r.user_email, date:d2s(r.work_date),
    missingMin:Number(r.missing_minutes)||0, reason:r.reason||""
  })).sort((a,b)=>a.date.localeCompare(b.date));
  const missingMin={}; partialDays.forEach(p=>{ missingMin[p.email]=(missingMin[p.email]||0)+p.missingMin; });

  const loc={iroda:0,home:0}; const locByUser={};
  teamWorkDays.forEach(r=>{ if(loc[r.location]!==undefined) loc[r.location]++;
    (locByUser[r.user_email] ||= {iroda:0,home:0}); if(locByUser[r.user_email][r.location]!==undefined) locByUser[r.user_email][r.location]++; });

  const baseCap = capacityMin(from,to);
  const roster = new Set([
    ...members.map(m=>m.email).filter(e=>e && e!==me),
    ...Object.keys(byUser), ...Object.keys(leaveMin), ...Object.keys(missingMin)
  ].filter(e=>e && e!==me && !isExcluded(e)));
  const people = [...roster].map(email=>{
    const logged = byUser[email]||0;
    const cap = Math.max(baseCap - (leaveMin[email]||0) - (missingMin[email]||0), 0);
    return { email, name:nameOf[email]||email, loggedMin:logged, capacityMin:cap,
      leaveMin:leaveMin[email]||0, missingMin:missingMin[email]||0,
      leaveDays:leaveDays[email]||0, sickDays:sickDays[email]||0,
      location: locByUser[email]||{iroda:0,home:0},
      byClient: byUserClient[email]||{},
      pct: cap>0 ? Math.round(logged/cap*1000)/10 : null };
  }).sort((a,b)=>b.loggedMin-a.loggedMin);

  const onLeaveToday = teamLeaves.filter(r=>d2s(r.leave_date)===t)
    .map(r=>({ email:r.user_email, name:nameOf[r.user_email]||r.user_email, kind:r.kind }));
  const leaveUpcoming = teamLeaves.filter(r=>{ const ds=d2s(r.leave_date); return ds>t && ds<=addDays(t,30); })
    .map(r=>({ date:d2s(r.leave_date), email:r.user_email, name:nameOf[r.user_email]||r.user_email, kind:r.kind }))
    .sort((a,b)=>a.date.localeCompare(b.date));

  // ---- ClickUp
  const now = Date.now(), in1 = now+864e5, in7 = now+7*864e5, in14 = now+14*864e5;
  const withDue = tasks.filter(x=>x.dueDate);
  const overdue = withDue.filter(x=>x.dueDate < startOfToday());
  const upcoming14 = withDue.filter(x=>x.dueDate >= startOfToday() && x.dueDate <= in14);
  const due24 = withDue.filter(x=>x.dueDate >= startOfToday() && x.dueDate <= in1);
  const slim = x=>({ id:x.id, name:x.name, url:x.url, status:x.status, dueDate:x.dueDate,
    priority:x.priority, client:clientOf(x), assignees:x.assignees.map(a=>a.name) });

  const loadByUser={};
  [...overdue,...upcoming14].forEach(x=>x.assignees.forEach(a=>{
    if(isExcluded(a.email) || a.email===me) return;
    loadByUser[a.name]=(loadByUser[a.name]||0)+1;
  }));

  const clientMap={};
  const touch=c=>(clientMap[c] ||= { open:0, overdue:0, due24:0, soon:0, minutes:0 });
  tasks.forEach(x=>{ const c=clientOf(x); touch(c).open++; });
  overdue.forEach(x=>{ touch(clientOf(x)).overdue++; });
  due24.forEach(x=>{ touch(clientOf(x)).due24++; });
  upcoming14.forEach(x=>{ if(x.dueDate<=in7) touch(clientOf(x)).soon++; });
  Object.entries(byClient).forEach(([c,m])=>{ touch(c).minutes=m; });
  const clients = Object.entries(clientMap).map(([name,v])=>({
    name, ...v, level: (v.overdue||v.due24)? 2 : (v.soon? 1 : 0),
    activities: byClientActivity[name]||{}
  })).sort((a,b)=>b.level-a.level || b.overdue-a.overdue || b.minutes-a.minutes || a.name.localeCompare(b.name,"hu"));

  // ---- ClickUp kollégafigyelő: elvégzett + nyitott terhelés + határidő-tartás + átfutás
  const startToday = startOfToday();
  const staffMap = {};
  const S = (id,name,email)=>{ if(!staffMap[id]) staffMap[id]={ id, name, email:email||"", done:0, open:0, overdue:0, dueDone:0, onTime:0, _cyc:[], doneTasks:[] }; return staffMap[id]; };
  // nyitott terhelés (a már me-only-szűrt nyitott feladatokból)
  tasks.forEach(x=>x.assignees.forEach(a=>{
    if(a.email===me || isExcluded(a.email)) return;
    const s=S(a.id,a.name,a.email); s.open++;
    if(x.dueDate && x.dueDate < startToday) s.overdue++;
  }));
  // elvégzett feladatok az időszakban
  completed.forEach(x=>x.assignees.forEach(a=>{
    if(a.email===me || isExcluded(a.email)) return;
    const s=S(a.id,a.name,a.email); s.done++;
    if(x.dueDate){ s.dueDone++; if(x.closedAt<=x.dueDate) s.onTime++; }
    if(x.createdAt && x.closedAt) s._cyc.push((x.closedAt-x.createdAt)/864e5);
    if(s.doneTasks.length<200) s.doneTasks.push({
      id:x.id, name:x.name, url:x.url, client:clientOf(x),
      closedAt:x.closedAt, dueDate:x.dueDate,
      onTime: x.dueDate!=null ? x.closedAt<=x.dueDate : null
    });
  }));
  const median = arr=>{ if(!arr.length) return null; const s=[...arr].sort((a,b)=>a-b); const n=s.length; return n%2? s[(n-1)/2] : (s[n/2-1]+s[n/2])/2; };
  const staff = Object.values(staffMap).map(s=>({
    id:s.id, name:s.name, email:s.email,
    done:s.done, open:s.open, overdue:s.overdue, dueDone:s.dueDone, onTime:s.onTime,
    onTimePct: s.dueDone>0 ? Math.round(100*s.onTime/s.dueDone) : null,
    cycle: median(s._cyc),
    doneTasks: s.doneTasks.sort((a,b)=>b.closedAt-a.closedAt)
  })).sort((a,b)=> b.done-a.done || b.open-a.open);

  return Response.json({
    range:{ from, to, capacityMin:baseCap }, today:t,
    people, byClient, byActivity, byWeek,
    absence:{ partialDays, onLeaveToday, leaveUpcoming },
    location:{ totals:loc },
    clients,
    staff,
    staffMeta:{ completedCount: completed.length, from, to },
    ops:{
      overdue: overdue.sort((a,b)=>a.dueDate-b.dueDate).map(slim),
      due24: due24.sort((a,b)=>a.dueDate-b.dueDate).map(slim),
      upcoming: upcoming14.sort((a,b)=>a.dueDate-b.dueDate).map(slim),
      loadByUser: Object.entries(loadByUser).sort((a,b)=>b[1]-a[1]),
      totalOpen: tasks.length, teamSize: members.length
    }
  });
}

function addDays(s,n){ const d=new Date(s+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
function startOfToday(){ const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); }
