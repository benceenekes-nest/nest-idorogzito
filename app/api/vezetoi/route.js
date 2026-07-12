import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth";
import { getRange, getWorkDaysRange, getLeaves, snapshotDueDates, getDueShifts } from "../../../lib/db";
import { getAllOpenTasks, getMembers, listSpaces, getCompletedTasks } from "../../../lib/clickup";
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

  const yISO = addDays(t,-1);                          // tegnap
  const dayMs = iso => Date.parse(iso+"T00:00:00Z");
  const rangeFromMs = dayMs(from), rangeToMs = dayMs(to)+864e5-1;   // to nap vége
  const fetchFromMs = Math.min(rangeFromMs, dayMs(yISO));
  const fetchToMs   = Math.max(rangeToMs, dayMs(t)+864e5-1);

  const [entries, workDays, leaves, allTasks, members, doneTasks] = await Promise.all([
    getRange({ email:"", from, to, all:true }),
    getWorkDaysRange({ email:"", from, to, all:true }),
    getLeaves({ email:"", from, to:addDays(t,30), all:true }),
    getAllOpenTasks().catch(()=>[]),
    getMembers().catch(()=>[]),
    getCompletedTasks({ fromMs:fetchFromMs, toMs:fetchToMs }).catch(()=>[])
  ]);

  // Csak a saját magához rendelt feladatok kimaradnak; a közös feladatok maradnak.
  const tasks = allTasks.filter(x=>{
    const a = x.assignees||[];
    if(!a.length) return true;
    return !a.every(u=>u.email===me);
  });

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
  const now = Date.now(), in1 = now+864e5, in5 = now+5*864e5, in7 = now+7*864e5, in14 = now+14*864e5;
  const withDue = tasks.filter(x=>x.dueDate);
  const overdue = withDue.filter(x=>x.dueDate < startOfToday());
  const upcoming14 = withDue.filter(x=>x.dueDate >= startOfToday() && x.dueDate <= in14);
  const due24 = withDue.filter(x=>x.dueDate >= startOfToday() && x.dueDate <= in1);
  const due2to5 = withDue.filter(x=>x.dueDate > in1 && x.dueDate <= in5);
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

  // Napi határidő-pillanatkép + csúszásnapló (a nyilvános, nem privát feladatokból)
  let dueShifts = [];
  try{
    await snapshotDueDates(withDue.map(x=>({ id:x.id, name:x.name, assignees:x.assignees.map(a=>a.name), client:clientOf(x), dueDate:x.dueDate })));
    dueShifts = await getDueShifts({ limit:150 });
  }catch(e){ /* a pillanatkép ne törje meg a dashboardot */ }

  // Lejárt határidők öregedése
  const aging = { d1_7:[], d8_30:[], d30p:[] };
  overdue.forEach(x=>{ const days=Math.floor((startOfToday()-x.dueDate)/864e5);
    const o=slim(x); o.overdueDays=days;
    if(days<=7) aging.d1_7.push(o); else if(days<=30) aging.d8_30.push(o); else aging.d30p.push(o); });

  // Kapacitás-előrejelzés: következő 14 nap — kié a szabadság és a határidő
  const forecast = [];
  for(let i=0;i<14;i++){
    const day = addDays(t,i);
    const dm = dailyMin(day);
    const onLeave = leaves.filter(r=>d2s(r.leave_date)===day && r.user_email!==me)
      .map(r=>({ name:nameOf[r.user_email]||r.user_email, kind:r.kind }));
    const deadlines = upcoming14.filter(x=>d2s(x.dueDate)===day).length;
    if(onLeave.length || deadlines) forecast.push({ date:day, weekend:dm===0, onLeave, deadlines });
  }

  // New Business pipeline státusz szerint
  const newbiz = tasks.filter(x=>/new business|üzletfejleszt/i.test(clientOf(x)) || (x.list && /new business/i.test(x.list.name||"")));
  const nbByStatus = {};
  newbiz.forEach(x=>{ const st=x.status||"—"; (nbByStatus[st] ||= []).push({ name:x.name, url:x.url,
    assignees:(x.assignees||[]).map(a=>a.name).join(", "), due: x.dueDate?d2s(x.dueDate):null }); });

  // ── Elvégzett (lezárt) feladatok: ma / tegnap / szűrt időszak ──
  // A naphatárok PONTOS budapesti naptár szerint (Europe/Budapest, DST-vel együtt).
  const budDate = ms => new Intl.DateTimeFormat("en-CA",{ timeZone:"Europe/Budapest",
    year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date(Number(ms)));
  const nowMs = Date.now();
  const tBud = budDate(nowMs);            // ma (Budapest)
  const yBud = budDate(nowMs - 864e5);    // tegnap (Budapest)
  const mine = x => { const a=x.assignees||[]; return a.length && a.every(u=>u.email===me); };
  const slimDone = x => ({
    id:x.id, name:x.name, url:x.url, client:clientOf(x),
    assignees:(x.assignees||[]).map(a=>a.name),
    dueDate:x.dueDate, doneDate:budDate(x.dateDone), doneMs:x.dateDone,
    priority:x.priority, tags:x.tags||[]
  });
  const doneClean = doneTasks.filter(x=>x.dateDone && !mine(x)).map(slimDone)
    .sort((a,b)=>b.doneMs-a.doneMs);
  const seenDone=new Set(); const doneUniq=[];
  for(const x of doneClean){ if(seenDone.has(x.id)) continue; seenDone.add(x.id); doneUniq.push(x); }
  const completedToday = doneUniq.filter(x=>x.doneDate===tBud);
  const completedYesterday = doneUniq.filter(x=>x.doneDate===yBud);
  const completedRange = doneUniq.filter(x=>x.doneDate>=from && x.doneDate<=to);

  return Response.json({
    range:{ from, to, capacityMin:baseCap }, today:t,
    people, byClient, byActivity, byWeek,
    completed:{ today:completedToday, yesterday:completedYesterday, range:completedRange,
      counts:{ today:completedToday.length, yesterday:completedYesterday.length, range:completedRange.length } },
    analytics:{ dueShifts, forecast, nbByStatus, aging:{
        d1_7:aging.d1_7.length, d8_30:aging.d8_30.length, d30p:aging.d30p.length,
        d1_7_list:aging.d1_7.slice(0,20), d8_30_list:aging.d8_30.slice(0,20), d30p_list:aging.d30p.slice(0,20) } },
    absence:{ partialDays, onLeaveToday, leaveUpcoming },
    location:{ totals:loc },
    clients,
    ops:{
      overdue: overdue.sort((a,b)=>a.dueDate-b.dueDate).map(slim),
      due24: due24.sort((a,b)=>a.dueDate-b.dueDate).map(slim),
      due2to5: due2to5.sort((a,b)=>a.dueDate-b.dueDate).map(slim),
      upcoming: upcoming14.sort((a,b)=>a.dueDate-b.dueDate).map(slim),
      loadByUser: Object.entries(loadByUser).sort((a,b)=>b[1]-a[1]),
      totalOpen: tasks.length, teamSize: members.length
    }
  });
}

function addDays(s,n){ const d=new Date(s+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
function startOfToday(){ const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); }
