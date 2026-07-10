// Szerveroldali ClickUp kliens. A token csak itt, a szerveren él.
const BASE = "https://api.clickup.com/api/v2";
const TEAM = process.env.CLICKUP_TEAM_ID || "2410883";

function headers(){
  const t = process.env.CLICKUP_TOKEN;
  if(!t) throw new Error("CLICKUP_TOKEN nincs beállítva");
  return { "Authorization": t, "Content-Type": "application/json" };
}

// Workspace tagok (email -> id párosításhoz)
export async function getMembers(){
  const r = await fetch(`${BASE}/team`, { headers: headers(), cache:"no-store" });
  if(!r.ok) throw new Error("ClickUp team hiba: "+r.status);
  const d = await r.json();
  const team = (d.teams||[]).find(t=>String(t.id)===String(TEAM)) || (d.teams||[])[0];
  const members = (team?.members||[]).map(m=>m.user).filter(Boolean);
  return members.map(u=>({ id:String(u.id), name:u.username||u.email, email:(u.email||"").toLowerCase() }));
}

export async function resolveUserByEmail(email){
  const members = await getMembers();
  const e = (email||"").toLowerCase();
  return members.find(m=>m.email===e) || null;
}

// Egy felhasználó nyitott feladatai (altaszkokkal, parent linkkel)
export async function getTasksForUser(userId){
  const out = [];
  for(let page=0; page<10; page++){
    const url = new URL(`${BASE}/team/${TEAM}/task`);
    url.searchParams.set("subtasks","true");
    url.searchParams.set("include_closed","false");
    url.searchParams.set("page", String(page));
    url.searchParams.append("assignees[]", String(userId));
    const r = await fetch(url, { headers: headers(), cache:"no-store" });
    if(!r.ok) throw new Error("ClickUp task hiba: "+r.status);
    const d = await r.json();
    const tasks = d.tasks||[];
    for(const t of tasks){
      out.push({
        id: t.id,
        name: t.name,
        url: t.url,
        status: t.status?.status || "",
        dateDone: t.date_done || null,
        dateClosed: t.date_closed || null,
        parent: t.parent || null,
        tags: (t.tags||[]).map(x=>({ name:x.name, fg:x.tag_fg||null, bg:x.tag_bg||null })),
        list: t.list ? { id:String(t.list.id), name:t.list.name } : null
      });
    }
    if(tasks.length < 100) break;
  }
  return out;
}

// Privát (lakatos) ClickUp-terek azonosítói. Ezeket sehol nem mutatjuk.
let _privCache = null, _privAt = 0;
export async function getPrivateSpaceIds(){
  const now = Date.now();
  if(_privCache && (now-_privAt) < 5*60*1000) return _privCache;
  const r = await fetch(`${BASE}/team/${TEAM}/space?archived=false`, { headers: headers(), cache:"no-store" });
  if(!r.ok) throw new Error("ClickUp space hiba: "+r.status);
  const d = await r.json();
  const ids = new Set((d.spaces||[]).filter(sp=>sp.private===true).map(sp=>String(sp.id)));
  _privCache = ids; _privAt = now;
  return ids;
}

export async function listSpaces(){
  const r = await fetch(`${BASE}/team/${TEAM}/space?archived=false`, { headers: headers(), cache:"no-store" });
  if(!r.ok) throw new Error("ClickUp space hiba: "+r.status);
  const d = await r.json();
  return (d.spaces||[]).map(sp=>({ id:String(sp.id), name:sp.name, private: sp.private===true }));
}

// A csapat összes nyitott feladata (altaszkokkal) — vezetői nézethez
export async function getAllOpenTasks(){
  const out=[];
  let priv = new Set();
  try{ priv = await getPrivateSpaceIds(); }catch(e){ /* ha nem kérdezhető le, inkább nem szűrünk vakon */ }
  for(let page=0; page<15; page++){
    const url = new URL(`${BASE}/team/${TEAM}/task`);
    url.searchParams.set("subtasks","true");
    url.searchParams.set("include_closed","false");
    url.searchParams.set("page", String(page));
    const r = await fetch(url, { headers: headers(), cache:"no-store" });
    if(!r.ok) throw new Error("ClickUp task hiba: "+r.status);
    const d = await r.json();
    const tasks = d.tasks||[];
    for(const t of tasks){
      const spaceId = t.space ? String(t.space.id) : null;
      if(spaceId && priv.has(spaceId)) continue;   // lakatos tér — kihagyjuk
      out.push({
        id:t.id, name:t.name, url:t.url,
        spaceId,
        status:t.status?.status||"",
        dueDate: t.due_date? Number(t.due_date) : null,
        priority: t.priority?.priority || null,
        assignees: (t.assignees||[]).map(a=>({ id:String(a.id), name:a.username||a.email, email:(a.email||"").toLowerCase() })),
        tags: (t.tags||[]).map(x=>x.name),
        parent: t.parent||null,
        list: t.list ? { id:String(t.list.id), name:t.list.name } : null
      });
    }
    if(tasks.length < 100) break;
  }
  return out;
}

// A csapat időszakban lezárt (elvégzett) feladatai — kollégafigyelőhöz.
// A ClickUp filtered-team-task végpont date_updated_gt szűrőjével gyűjtünk
// (bármely lezárt feladat frissült is a lezáráskor), majd JS-ben szűrünk arra,
// hogy a lezárás dátuma az [fromMs, toMs] intervallumba essen.
export async function getCompletedTasks({ fromMs, toMs }){
  const out=[];
  let priv = new Set();
  try{ priv = await getPrivateSpaceIds(); }catch(e){ /* ha nem kérdezhető le, nem szűrünk vakon */ }
  for(let page=0; page<25; page++){
    const url = new URL(`${BASE}/team/${TEAM}/task`);
    url.searchParams.set("subtasks","true");
    url.searchParams.set("include_closed","true");
    url.searchParams.set("date_updated_gt", String(fromMs));
    url.searchParams.set("page", String(page));
    const r = await fetch(url, { headers: headers(), cache:"no-store" });
    if(!r.ok) throw new Error("ClickUp lezárt task hiba: "+r.status);
    const d = await r.json();
    const tasks = d.tasks||[];
    for(const t of tasks){
      const spaceId = t.space ? String(t.space.id) : null;
      if(spaceId && priv.has(spaceId)) continue;   // lakatos tér — kihagyjuk
      const closedAt = Number(t.date_closed || t.date_done || 0);
      if(!closedAt || closedAt < fromMs || closedAt > toMs) continue;   // csak az időszakban lezártak
      out.push({
        id:t.id, name:t.name, url:t.url,
        spaceId,
        status:t.status?.status||"",
        closedAt,
        createdAt: t.date_created? Number(t.date_created) : null,
        dueDate: t.due_date? Number(t.due_date) : null,
        priority: t.priority?.priority || null,
        assignees: (t.assignees||[]).map(a=>({ id:String(a.id), name:a.username||a.email, email:(a.email||"").toLowerCase() })),
        tags: (t.tags||[]).map(x=>x.name),
        parent: t.parent||null,
        list: t.list ? { id:String(t.list.id), name:t.list.name } : null
      });
    }
    if(tasks.length < 100) break;
  }
  return out;
}

// Manuális időbejegyzés hozzáadása egy taszkhoz
export async function addTimeEntry({ taskId, startMs, durationMs, description, billable=false, activity }){
  const body = {
    tid: taskId,
    start: startMs,
    duration: durationMs,
    billable: !!billable,
    description: description || ""
  };
  if(activity) body.tags = [{ name: activity }];
  const r = await fetch(`${BASE}/team/${TEAM}/time_entries`, {
    method:"POST", headers: headers(), body: JSON.stringify(body)
  });
  if(!r.ok){ const txt = await r.text(); throw new Error("Időbejegyzés hiba: "+r.status+" "+txt); }
  return await r.json();
}

// Időbejegyzések lekérése riporthoz (start/end ms, opcionális assignee id-k)
export async function getTimeEntries({ startMs, endMs, assignees }){
  const url = new URL(`${BASE}/team/${TEAM}/time_entries`);
  url.searchParams.set("start_date", String(startMs));
  url.searchParams.set("end_date", String(endMs));
  if(assignees && assignees.length) url.searchParams.set("assignee", assignees.join(","));
  const r = await fetch(url, { headers: headers(), cache:"no-store" });
  if(!r.ok) throw new Error("Időlekérés hiba: "+r.status);
  const d = await r.json();
  return d.data||[];
}
