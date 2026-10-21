"use client";
import { useEffect, useState, useMemo, useRef } from "react";
import { useSession, signOut } from "next-auth/react";
import { ACTIVITIES } from "../lib/clients";

const DURS=[15,30,45,60,90,120];
const FINISHED=["done","complete","kész","closed","cancelled","törölve"];
function fmt(m){ if(!m) return "0 p"; const h=Math.floor(m/60),r=m%60; return (h?h+" ó ":"")+(r?r+" p":(h?"":"0 p")); }
const emptyLine=()=>({activity:"",min:0});
// Olvasható betűszín a ClickUp címke háttérszínéhez (relatív luminancia).
function readable(bg){
  const m=String(bg||"").trim();
  let r,g,b;
  const h=m.replace("#","");
  if(/^[0-9a-f]{6}$/i.test(h)){ r=parseInt(h.slice(0,2),16); g=parseInt(h.slice(2,4),16); b=parseInt(h.slice(4,6),16); }
  else { const p=m.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/); if(!p) return "#fff"; [r,g,b]=[+p[1],+p[2],+p[3]]; }
  const lin=v=>{ v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); };
  const L=0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
  return L>0.45 ? "#12283f" : "#ffffff";
}

function localISO(d){ const z=new Date(d.getTime()-d.getTimezoneOffset()*60000); return z.toISOString().slice(0,10); }
// ── Piszkozat a böngészőben ──
// Gépelés közben az űrlap folyamatosan ide is mentődik (naponta és kollégánként külön kulccsal),
// így ha a mentés elbukik, a lap bezárul vagy újratöltődik, a beírt adat visszajön.
// Sikeres mentéskor törlődik. A szerveren is van egy másolat (/api/draft).
const DRAFT_PREFIX="ido-piszkozat|";
const draftKey=(actor,target,d)=>`${DRAFT_PREFIX}${(actor||"").toLowerCase()}|${(target||actor||"").toLowerCase()}|${d}`;
function readDraft(k){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):null; }catch(e){ return null; } }
function writeDraft(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
function dropDraft(k){ try{ localStorage.removeItem(k); }catch(e){} }
function pruneDrafts(){
  try{
    const hatar=Date.now()-14*86400000;
    for(let i=localStorage.length-1;i>=0;i--){
      const k=localStorage.key(i); if(!k||!k.startsWith(DRAFT_PREFIX)) continue;
      const v=readDraft(k); if(!v||!(v.savedAt>hatar)) dropDraft(k);
    }
  }catch(e){}
}
function hhmm(ms){ const d=new Date(ms); return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"); }
// Felvihető tartomány: ma + előző munkanap. Hétfőn visszamegy péntekig (a köztes szo/vas is választható).
function dayBounds(){
  const today=new Date(); const day=today.getDay();
  const back = day===1 ? 3 : (day===0 ? 2 : 1);
  const minD=new Date(today); minD.setDate(today.getDate()-back);
  return { min:localISO(minD), max:localISO(today) };
}
function isFinished(t){ return FINISHED.includes((t.status||"").toLowerCase()); }
// Elvárt munkaidő: hétfő–csütörtök 8 óra, péntek 7 óra.
function dailyHours(dateISO){ const w=new Date(dateISO+"T00:00:00").getDay(); return w===5?7:8; }
// Ideiglenes kivétel: adott kollégánál kiterjesztett felvihető tartomány (a hét végén magától lejár).
const EXTEND_RANGE = {
  "lilla.kocsis@nestcom.hu": { min:"2026-07-27", until:"2026-07-31" },
  "eszter.vati@nestcom.hu": { min:"2026-08-26", until:"2026-08-31" },
};

export default function Home(){
  const { data:session, status } = useSession();
  const bounds = useMemo(dayBounds, []);
  const doneCutoff = useMemo(()=>{ const d=new Date(); d.setDate(d.getDate()-30); return localISO(d); },[]);
  const [date,setDate]=useState(bounds.max);
  const [tasks,setTasks]=useState([]);
  const [me,setMe]=useState(null);
  const [ent,setEnt]=useState({});
  const [loc,setLoc]=useState("");        // "iroda" | "home"
  const [partial,setPartial]=useState(false);
  const [missingH,setMissingH]=useState("");   // kieső óra
  const [reason,setReason]=useState("");
  const [delegates,setDelegates]=useState([]);   // akiknek a nevében rögzíthet
  const [target,setTarget]=useState("");         // kinek rögzítünk (üres = saját)
  const [msg,setMsg]=useState(null);
  const [loading,setLoading]=useState(false);
  const [showDone,setShowDone]=useState(false);
  const [origIds,setOrigIds]=useState([]);   // amely feladatoknak betöltéskor volt már rögzített adata
  // Melyik nap / kinek az adatát mutatja ÉPP az űrlap. Csak ez menthető: ha a dátumválasztó
  // közben máshol áll (pl. egy késve érkező betöltés miatt), a mentés megáll.
  const [loaded,setLoaded]=useState(null);   // {date, target, actor, forParam}
  const [dirty,setDirty]=useState(false);    // van-e nem mentett módosítás
  const [draftNote,setDraftNote]=useState(null);
  const seq=useRef(0);
  const footMsg=useRef(null);

  function recentlyDone(t){
    const ms=Number(t.dateDone||t.dateClosed||0);
    if(!ms) return false;
    return localISO(new Date(ms)) >= doneCutoff;
  }

  // A felvihető legkorábbi nap – Lillánál (ideiglenesen) kiterjesztve.
  const ext = me?.email ? EXTEND_RANGE[me.email.toLowerCase()] : null;
  const minDate = (ext && bounds.max <= ext.until) ? ext.min : bounds.min;

  function pickDate(v){
    if(v<minDate) v=minDate;
    if(v>bounds.max) v=bounds.max;
    flushDraft();
    setDate(v);
    // Dátumváltáskor MINDIG újratöltjük az adott nap adatát, hogy a betöltött
    // űrlap sose kerülhessen át egy másik napra (duplikáció-védelem).
    load(v, target);
  }

  async function load(d=date, forEmail=target, opts={}){
    const my=++seq.current;   // csak a LEGUTÓBB indított betöltés eredménye kerülhet az űrlapra
    setLoading(true); if(!opts.keepMsg) setMsg(null); setEnt({}); setTasks([]); setLoc("");
    setPartial(false); setMissingH(""); setReason(""); setLoaded(null); setDirty(false); setDraftNote(null);
    try{
      const r = await fetch(`/api/tasks?date=${d}`+(forEmail?`&for=${encodeURIComponent(forEmail)}`:""));
      const data = await readJson(r);
      if(my!==seq.current) return;
      if(!r.ok) throw new Error(data.error||"Betöltési hiba");
      setMe(data.me);
      setDelegates(data.delegates||[]);
      setTarget(data.target && data.actor && data.target!==data.actor.email ? data.target : "");
      const baseTasks = data.tasks||[];
      const m=data.meta||null;
      setLoc(m?.location||"");
      if(m?.partial){ setPartial(true); setMissingH(String((m.missingMinutes||0)/60));
        setReason(m.reason||""); }
      const e={};
      const known = new Set(baseTasks.map(t=>t.id));
      const orphans=[]; const seenOrphan=new Set();
      (data.prefill||[]).forEach(p=>{
        const id=p.task_id;
        if(!e[id]) e[id]={on:true, lines:[]};
        e[id].lines.push({activity:p.activity||"", min:Number(p.minutes)||0});
        // Korábban rögzített, de az aktuális listában már nem szereplő (pl. lezárt)
        // feladat: külön "archív" sorként hozzuk vissza, hogy ne vesszen el.
        if(!known.has(id) && !seenOrphan.has(id)){
          seenOrphan.add(id);
          orphans.push({ id, name:p.task_name||"(korábban rögzített feladat)", url:null,
            status:"lezárt", tags:[], client:p.client||"Korábban rögzített",
            parentId:p.parent_id||null, parentName:p.parent_name||null, archived:true });
        }
      });
      Object.values(e).forEach(x=>{ if(!x.lines.length) x.lines=[emptyLine()]; });
      setOrigIds(Object.keys(e));   // ezeknek volt eredetileg adata (a törlésjelzés ehhez mér)

      // NEM MENTETT PISZKOZAT: a böngészőé vagy a szerveré, amelyik frissebb. Ha az utolsó
      // sikeres mentés újabb nála (pl. közben másik gépről mentett), elavult — eldobjuk.
      const actorEmail=data.actor?.email||"";
      const targetEmail=data.target||actorEmail;
      const k=draftKey(actorEmail, targetEmail, d);
      const helyi=readDraft(k);
      const szerver=data.draft?.payload ? { ...data.draft.payload, savedAt: new Date(data.draft.updatedAt).getTime() } : null;
      let dr=[helyi,szerver].filter(Boolean).sort((a,b)=>(b.savedAt||0)-(a.savedAt||0))[0]||null;
      const utolsoMentes=m?.updatedAt ? new Date(m.updatedAt).getTime() : 0;
      if(dr && !(dr.savedAt>utolsoMentes)){ dropDraft(k); dr=null; }
      const allTasks=[...baseTasks, ...orphans];
      if(dr && dr.ent){
        const ismert=new Set(allTasks.map(t=>t.id));
        (dr.extraTasks||[]).forEach(t=>{ if(t && t.id && !ismert.has(t.id) && dr.ent[t.id]?.on){ ismert.add(t.id);
          allTasks.push({ ...t, url:t.url||null, tags:t.tags||[], archived:true, status:t.status||"lezárt",
            client:t.client||"Korábban rögzített" }); } });
        Object.keys(dr.ent).forEach(id=>{ if(!ismert.has(id)) delete dr.ent[id]; });
        setTasks(allTasks);
        setEnt(dr.ent);
        setLoc(dr.loc||m?.location||"");
        setPartial(!!dr.partial); setMissingH(dr.missingH||""); setReason(dr.reason||"");
        setDirty(true);
        setDraftNote(dr.savedAt||Date.now());
        writeDraft(k, dr);
      }else{
        setTasks(allTasks);
        setEnt(e);
      }
      setLoaded({ date:d, target:targetEmail, actor:actorEmail, forParam:forEmail||"" });
    }catch(e){ if(my===seq.current) setMsg({type:"err",text:e.message}); }
    finally{ if(my===seq.current) setLoading(false); }
  }

  // A válasz olvasása úgy, hogy egy nem-JSON válasz (pl. időtúllépés, belépőoldal) is
  // érthető üzenetet adjon, ne „Unexpected token" hibát.
  async function readJson(r){
    const t=await r.text();
    try{ return JSON.parse(t); }
    catch(e){
      if(r.status===401) return { error:"Lejárt a belépésed. Lépj be újra — a beírt adataid ebben a böngészőben megmaradtak." };
      return { error:`A szerver nem várt választ adott (${r.status}). A beírt adataid ebben a böngészőben megmaradtak — próbáld újra pár perc múlva.` };
    }
  }

  // A piszkozat tartalma: az űrlap állapota, plusz azoknak a bepipált feladatoknak az adatai,
  // amelyek közben kieshetnek a ClickUp-listából (lezárták őket) — így azok is visszajönnek.
  function draftPayload(){
    const extraTasks=tasks.filter(t=>ent[t.id]?.on).map(t=>({ id:t.id, name:t.name, url:t.url||null,
      client:t.client, parentId:t.parentId||null, parentName:t.parentName||null, status:t.status||"" }));
    return { ent, loc, partial, missingH, reason, extraTasks, savedAt: Date.now() };
  }
  function flushDraft(){
    if(!dirty || !loaded) return;
    writeDraft(draftKey(loaded.actor, loaded.target, loaded.date), draftPayload());
  }
  // Helyi mentés gépelés közben (rövid késleltetéssel), szerveres másolat ritkábban.
  useEffect(()=>{
    if(!dirty || !loaded) return;
    const k=draftKey(loaded.actor, loaded.target, loaded.date);
    const p=draftPayload();
    const t1=setTimeout(()=>writeDraft(k,p), 400);
    const t2=setTimeout(()=>{
      fetch("/api/draft",{ method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ date:loaded.date, for: loaded.forParam||undefined, payload:p }) }).catch(()=>{});
    }, 4000);
    return ()=>{ clearTimeout(t1); clearTimeout(t2); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[ent,loc,partial,missingH,reason,dirty,loaded]);
  // Nem mentett adattal ne lehessen észrevétlenül bezárni a lapot.
  useEffect(()=>{
    const h=(ev)=>{ if(dirty){ flushDraft(); ev.preventDefault(); ev.returnValue=""; } };
    window.addEventListener("beforeunload", h);
    return ()=>window.removeEventListener("beforeunload", h);
  });
  useEffect(()=>{ pruneDrafts(); },[]);

  async function discardDraft(){
    if(!loaded) return;
    if(!window.confirm("Biztosan elveted a nem mentett módosításokat? Az utoljára mentett állapot jön vissza.")) return;
    dropDraft(draftKey(loaded.actor, loaded.target, loaded.date));
    await fetch("/api/draft",{ method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ date:loaded.date, for: loaded.forParam||undefined, torles:true }) }).catch(()=>{});
    setDirty(false);
    load(loaded.date, loaded.forParam);
  }
  useEffect(()=>{ if(status==="authenticated") load(); },[status]);
  function switchTarget(email){ flushDraft(); setTarget(email); load(date, email); }

  function get(id){ return ent[id] || {on:false, lines:[emptyLine()]}; }
  function toggle(id, on){
    setDirty(true);
    const cur=get(id);
    setEnt(s=>({ ...s, [id]:{ on, lines: (cur.lines&&cur.lines.length)?cur.lines:[emptyLine()] } }));
  }
  function setLine(id, i, patch){
    setDirty(true);
    const cur=get(id); const lines=cur.lines.map((l,idx)=> idx===i?{...l,...patch}:l);
    setEnt(s=>({ ...s, [id]:{ ...cur, lines } }));
  }
  function addLine(id){ setDirty(true); const cur=get(id); setEnt(s=>({ ...s, [id]:{ ...cur, lines:[...cur.lines, emptyLine()] } })); }
  function removeLine(id, i){
    setDirty(true);
    const cur=get(id); let lines=cur.lines.filter((_,idx)=>idx!==i);
    if(!lines.length) lines=[emptyLine()];
    setEnt(s=>({ ...s, [id]:{ ...cur, lines } }));
  }

  const grouped = useMemo(()=>{
    let list = tasks.filter(t=>{
      if(!isFinished(t)) return true;
      return showDone && recentlyDone(t);
    });
    return list.slice().sort((a,b)=>{
      if(a.client!==b.client) return a.client.localeCompare(b.client,"hu");
      return (a.name||"").localeCompare(b.name||"","hu");
    });
  },[tasks,showDone,doneCutoff]);

  const total = useMemo(()=> Object.values(ent).reduce((a,e)=> a+(e.on? e.lines.reduce((s,l)=>s+(l.min||0),0):0),0),[ent]);
  const doneCount = tasks.filter(t=> isFinished(t) && recentlyDone(t)).length;

  // Hiba és visszajelzés: a Mentés gomb mellett is megjelenik, és odagörgetünk — hosszú
  // feladatlistánál a lap tetején lévő üzenetet a kolléga nem látta, és azt hitte, mentett.
  function say(m){ setMsg(m); setTimeout(()=>{ try{ footMsg.current?.scrollIntoView({behavior:"smooth",block:"center"}); }catch(e){} }, 50); }

  async function submit(){
    if(!loaded || loaded.date!==date){ say({type:"err",text:"Nincs mentve! Az űrlap nem a kiválasztott napot mutatja. Kattints a „Feladatok behívása” gombra, majd mentsd újra — a beírt adataid megmaradtak."}); return; }
    const rows=[];
    tasks.forEach(t=>{ const e=ent[t.id]; if(!e||!e.on) return;
      e.lines.forEach(l=>{ if((l.min||0)>0) rows.push({
        taskId:t.id, taskName:t.name, parentId:t.parentId, parentName:t.parentName,
        client:t.client, activity:l.activity, minutes:l.min, archived:!!t.archived }); });
    });
    if(!rows.length){ say({type:"err",text:"Nincs mentve! Pipálj be legalább egy feladatot és adj meg időt."}); return; }
    const noAct = rows.filter(r=>!r.archived && (!r.activity || !String(r.activity).trim()));
    if(noAct.length){ say({type:"err",text:"Nincs mentve! Válassz tevékenységtípust minden bejegyzéshez: "+[...new Set(noAct.map(r=>r.taskName))].join(", ")}); return; }
    if(!loc){ say({type:"err",text:"Nincs mentve! Jelöld be a lap tetején, hogy aznap irodában vagy home office-ban dolgoztál."}); return; }
    const missingMinutes = partial ? Math.round(Number(String(missingH).replace(",","."))*60) : 0;
    if(partial){
      if(!(missingMinutes>0)){ say({type:"err",text:"Nincs mentve! Add meg, hány óra esett ki aznap."}); return; }
      if(missingMinutes >= dailyHours(date)*60){ say({type:"err",text:"Nincs mentve! A kieső idő nem lehet több az aznapi munkaidőnél. Egész napos távollétet a Szabadság menüpontban jelölj."}); return; }
      if(!reason.trim()){ say({type:"err",text:"Nincs mentve! Írd le, miért nem volt teljes a munkanap."}); return; }
    }
    // Csak azokat a feladatokat jelezzük törlésre, amelyeknek volt adata, de most
    // nincs beküldve (a felhasználó levette a pipát / kinullázta). Más feladatot a
    // szerver nem bánt, így újramentéskor nem tűnhet el korábbi tétel.
    const submittedIds = new Set(rows.map(r=>r.taskId));
    const removedIds = origIds.filter(id=>!submittedIds.has(id));
    const napja=loaded.date, kinek=loaded.forParam;
    flushDraft();
    setLoading(true); setMsg(null);
    try{
      let r;
      try{
        r = await fetch("/api/time",{ method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ date:napja, rows, location: loc, partial,
            missingMinutes, reason: reason.trim(), for: kinek||undefined,
            removedIds }) });
      }catch(e){ throw new Error("Nincs mentve! Nem sikerült elérni a szervert (internetkapcsolat?). A beírt adataid ebben a böngészőben megmaradtak — próbáld újra."); }
      const d = await readJson(r);
      if(!r.ok) throw new Error("Nincs mentve! "+(d.error||"Mentési hiba."));
      // VISSZAOLVASOTT MEGERŐSÍTÉS: amit a szerver a mentés után az adatbázisban talált.
      const st=d.stored||{};
      const helyStr=loc==="iroda"?"iroda":"home office";
      dropDraft(draftKey(loaded.actor, loaded.target, napja));
      setDirty(false);
      await load(napja, kinek, { keepMsg:true });
      say({type:"ok",text:(kinek? `${me?.name} nevében mentve és ellenőrizve. ` : "Mentve és ellenőrizve. ")
        + `Az adatbázisban most ${st.db ?? d.saved} tétel van, összesen ${fmt(st.perc ?? total)} — ${napja} (${helyStr})`
        + (partial? `, nem teljes munkanap: ${fmt(missingMinutes)} kiesés.` : ".")});
    }catch(e){ say({type:"err",text:e.message}); }
    finally{ setLoading(false); }
  }

  if(status!=="authenticated") return <div className="wrap"><div className="center"><p className="muted">Betöltés…</p></div></div>;

  let lastClient=null;
  return (
    <div className="wrap">
      <div className="top">
        <div className="brand">
          <img src="/nest-logo.svg" alt="NEST" />
          <span className="divider"></span>
          <div><h1>Napi időrögzítő</h1>
            <div className="who">{target? <>Rögzítés <b>{me?.name}</b> nevében</> : <>{me?.name} · {me?.email}</>}</div>
          </div>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <a href="/szabadsag">Szabadság</a>
          {!target && <a href="/report">Kimutatás</a>}
          <button className="btn sec" onClick={()=>signOut({callbackUrl:"/login"})}>Kilépés</button>
        </div>
      </div>

      <div className="card">
        <div className="row1">
          <div className="fld"><label>Nap</label>
            <input type="date" min={minDate} max={bounds.max} value={date}
              onChange={e=>pickDate(e.target.value)}/></div>
          {delegates.length>0 && (
            <div className="fld"><label>Kinek rögzítesz?</label>
              <div className="chips">
                <button className={"chip"+(!target?" sel":"")} onClick={()=>switchTarget("")}>Saját</button>
                {delegates.map(dg=>(
                  <button key={dg.email} className={"chip"+(target===dg.email?" sel":"")}
                    onClick={()=>switchTarget(dg.email)}>{dg.name}</button>
                ))}
              </div>
            </div>
          )}
          <div className="fld"><label>{target?"Hol dolgozott?":"Hol dolgoztál?"}</label>
            <div className="chips">
              <button className={"chip"+(loc==="iroda"?" sel":"")} onClick={()=>{ setDirty(true); setLoc("iroda"); }}>🏢 Iroda</button>
              <button className={"chip"+(loc==="home"?" sel":"")} onClick={()=>{ setDirty(true); setLoc("home"); }}>🏠 Home office</button>
            </div>
          </div>
          <div className="fld"><label>Munkanap</label>
            <div className="chips">
              <button className={"chip"+(partial?" sel":"")} onClick={()=>{ setDirty(true); setPartial(p=>!p); }}>⏳ Nem teljes munkanap</button>
            </div>
          </div>
          <button className="btn" onClick={()=>{ flushDraft(); load(); }} disabled={loading}>{loading?"Betöltés…":"Feladatok behívása"}</button>
        </div>

        {partial && (
          <div className="partial">
            <div className="row1" style={{alignItems:"flex-end"}}>
              <div className="fld"><label>Kieső idő (óra)</label>
                <input className="cmin" type="number" min="0.5" step="0.5" max={dailyHours(date)-0.5}
                  value={missingH} onChange={e=>{ setDirty(true); setMissingH(e.target.value); }} placeholder="pl. 2"/>
              </div>
              <div className="muted" style={{fontSize:12,paddingBottom:8}}>
                Aznapi teljes munkaidő: <b>{dailyHours(date)} óra</b>{new Date(date+"T00:00:00").getDay()===5?" (péntek)":""} ·
                elvárt: <b>{Math.max(dailyHours(date)-(Number(String(missingH).replace(",","."))||0),0)} óra</b>
              </div>
            </div>
            <div className="fld" style={{marginTop:8}}>
              <label>Indoklás</label>
              <input type="text" className="reason" value={reason} maxLength={300}
                onChange={e=>{ setDirty(true); setReason(e.target.value); }}
                placeholder="pl. orvosi vizsgálat napközben, engedéllyel"/>
            </div>
            <div className="muted" style={{fontSize:11.5,marginTop:8}}>
              A kieső idő levonódik az aznapi elvárt munkaidőből, így a kihasználtságod nem romlik el miatta. Mindegy, hogy a nap melyik részében esett ki.
            </div>
          </div>
        )}

        <div className="muted" style={{fontSize:12,marginTop:8}}>Csak a mai és az előző munkanap vihető fel. Egy feladathoz több tevékenység is felvihető.</div>
      </div>

      {target && <div className="status ok" style={{background:"#fff7e6",borderColor:"#e6c98a",color:"#8a5a00"}}>
        Most <b>{me?.name}</b> nevében rögzítesz. A mentés az ő nevén jelenik meg, a rendszer eltárolja, hogy te vitted fel.
      </div>}
      {draftNote && <div className="status ok" style={{background:"#fff7e6",borderColor:"#e6c98a",color:"#8a5a00",display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
        <span>Visszahoztuk a <b>nem mentett</b> piszkozatodat ({hhmm(draftNote)}). Nézd át, és kattints a <b>Mentés</b> gombra.</span>
        <button className="btn sec" onClick={discardDraft}>Piszkozat elvetése</button>
      </div>}
      {msg && <div className={"status "+msg.type}>{msg.text}</div>}

      {grouped.map(t=>{
        const e = get(t.id);
        const header = t.client!==lastClient ? (lastClient=t.client, t.client) : null;
        return (
          <div key={t.id}>
            {header!==null && <div className="grp">{header}</div>}
            <div className={"task"+(e.on?" on":"")}>
              <div className="thead">
                <input type="checkbox" className="cbx" checked={!!e.on}
                  onChange={ev=>toggle(t.id, ev.target.checked)}/>
                <div style={{flex:1}}>
                  <div className="tname">
                    <a href={t.url} target="_blank" rel="noopener">{t.name}</a>
                    <span className="pill">{t.status}</span>
                    {t.parentId && <span className="pill">↳ altaszk</span>}
                    {(t.tags||[]).map(tag=>(
                      <span key={tag.name} className="pill tag"
                        style={tag.bg?{background:tag.bg, color:readable(tag.bg), borderColor:tag.bg}:undefined}>
                        {tag.name}
                      </span>
                    ))}
                  </div>
                  {t.parentName && <div className="sub">Szülő: {t.parentName}</div>}
                </div>
                {e.on && <div className="tsum">{fmt(e.lines.reduce((s,l)=>s+(l.min||0),0))}</div>}
              </div>
              {e.on && e.lines.map((l,i)=>(
                <div className="controls" key={i}>
                  <select value={l.activity} onChange={ev=>setLine(t.id,i,{activity:ev.target.value})} style={(l.min>0 && !l.activity)?{borderColor:"#b3261e",background:"#fff5f5"}:undefined}>
                    <option value="">Tevékenységtípus…</option>
                    {ACTIVITIES.map(a=><option key={a} value={a}>{a}</option>)}
                  </select>
                  <div className="chips">
                    {DURS.map(d=>(
                      <button key={d} className={"chip"+(l.min===d?" sel":"")} onClick={()=>setLine(t.id,i,{min:d})}>{fmt(d)}</button>
                    ))}
                    <input className="cmin" type="number" min="0" step="5" placeholder="egyéni p"
                      value={l.min && !DURS.includes(l.min)? l.min : ""}
                      onChange={ev=>setLine(t.id,i,{min:Number(ev.target.value)||0})}/>
                  </div>
                  {e.lines.length>1 && <button className="lx" title="Sor törlése" onClick={()=>removeLine(t.id,i)}>✕</button>}
                </div>
              ))}
              {e.on && <button className="addline" onClick={()=>addLine(t.id)}>+ tevékenység</button>}
            </div>
          </div>
        );
      })}

      {doneCount>0 && (
        <button className="btn sec" style={{marginTop:6}} onClick={()=>setShowDone(s=>!s)}>
          {showDone? "Kész feladatok elrejtése" : `Kész feladatok (elmúlt 1 hónap) mutatása (${doneCount})`}
        </button>
      )}

      {tasks.length>0 && (
        <div className="foot">
          <div className="total">Napi összesen: <span>{fmt(total)}</span>{loc?<span className="muted" style={{fontWeight:600,fontSize:12.5,marginLeft:8}}>· {loc==="iroda"?"🏢 iroda":"🏠 home office"}</span>:null}
            {partial?<span className="muted" style={{fontWeight:600,fontSize:12.5,marginLeft:8}}>· ⏳ nem teljes nap</span>:null}</div>
          <button className="btn" onClick={submit} disabled={loading}>{loading?"Mentés…":"Mentés"}</button>
        </div>
      )}
      {tasks.length>0 && (
        <div ref={footMsg}>
          {msg ? <div className={"status "+msg.type}>{msg.text}</div>
            : dirty ? <div className="muted" style={{fontSize:12,textAlign:"right",marginTop:6}}>Nem mentett módosítás — a piszkozat ebben a böngészőben megmarad.</div> : null}
        </div>
      )}
    </div>
  );
}
