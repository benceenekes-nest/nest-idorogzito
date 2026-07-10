"use client";
import { useEffect, useState, useMemo } from "react";
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

  function recentlyDone(t){
    const ms=Number(t.dateDone||t.dateClosed||0);
    if(!ms) return false;
    return localISO(new Date(ms)) >= doneCutoff;
  }

  function pickDate(v){
    if(v<bounds.min) v=bounds.min;
    if(v>bounds.max) v=bounds.max;
    setDate(v);
  }

  async function load(d=date, forEmail=target){
    setLoading(true); setMsg(null); setEnt({}); setTasks([]); setLoc("");
    setPartial(false); setMissingH(""); setReason("");
    try{
      const r = await fetch(`/api/tasks?date=${d}`+(forEmail?`&for=${encodeURIComponent(forEmail)}`:""));
      const data = await r.json();
      if(!r.ok) throw new Error(data.error||"Betöltési hiba");
      setMe(data.me);
      setDelegates(data.delegates||[]);
      setTarget(data.target && data.actor && data.target!==data.actor.email ? data.target : "");
      setTasks(data.tasks||[]);
      const m=data.meta||null;
      setLoc(m?.location||"");
      if(m?.partial){ setPartial(true); setMissingH(String((m.missingMinutes||0)/60));
        setReason(m.reason||""); }
      const e={};
      (data.prefill||[]).forEach(p=>{
        const id=p.task_id;
        if(!e[id]) e[id]={on:true, lines:[]};
        e[id].lines.push({activity:p.activity||"", min:Number(p.minutes)||0});
      });
      Object.values(e).forEach(x=>{ if(!x.lines.length) x.lines=[emptyLine()]; });
      setEnt(e);
    }catch(e){ setMsg({type:"err",text:e.message}); }
    finally{ setLoading(false); }
  }
  useEffect(()=>{ if(status==="authenticated") load(); },[status]);
  function switchTarget(email){ setTarget(email); load(date, email); }

  function get(id){ return ent[id] || {on:false, lines:[emptyLine()]}; }
  function toggle(id, on){
    const cur=get(id);
    setEnt(s=>({ ...s, [id]:{ on, lines: (cur.lines&&cur.lines.length)?cur.lines:[emptyLine()] } }));
  }
  function setLine(id, i, patch){
    const cur=get(id); const lines=cur.lines.map((l,idx)=> idx===i?{...l,...patch}:l);
    setEnt(s=>({ ...s, [id]:{ ...cur, lines } }));
  }
  function addLine(id){ const cur=get(id); setEnt(s=>({ ...s, [id]:{ ...cur, lines:[...cur.lines, emptyLine()] } })); }
  function removeLine(id, i){
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

  async function submit(){
    const rows=[];
    tasks.forEach(t=>{ const e=ent[t.id]; if(!e||!e.on) return;
      e.lines.forEach(l=>{ if((l.min||0)>0) rows.push({
        taskId:t.id, taskName:t.name, parentId:t.parentId, parentName:t.parentName,
        client:t.client, activity:l.activity, minutes:l.min }); });
    });
    if(!rows.length){ setMsg({type:"err",text:"Pipálj be legalább egy feladatot és adj meg időt."}); return; }
    if(!loc){ setMsg({type:"err",text:"Jelöld be, hogy aznap irodában vagy home office-ban dolgoztál."}); return; }
    const missingMinutes = partial ? Math.round(Number(String(missingH).replace(",","."))*60) : 0;
    if(partial){
      if(!(missingMinutes>0)){ setMsg({type:"err",text:"Add meg, hány óra esett ki aznap."}); return; }
      if(missingMinutes >= dailyHours(date)*60){ setMsg({type:"err",text:"A kieső idő nem lehet több az aznapi munkaidőnél. Egész napos távollétet a Szabadság menüpontban jelölj."}); return; }
      if(!reason.trim()){ setMsg({type:"err",text:"Írd le, miért nem volt teljes a munkanap."}); return; }
    }
    setLoading(true); setMsg(null);
    try{
      const r = await fetch("/api/time",{ method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ date, rows, location: loc, partial,
          missingMinutes, reason: reason.trim(), for: target||undefined }) });
      const d = await r.json();
      if(!r.ok) throw new Error(d.error||"Mentési hiba");
      setMsg({type:"ok",text:(target? `${me?.name} nevében mentve: ` : "Mentve: ")
        + `${d.saved} tétel, összesen ${fmt(total)} — ${date} (${loc==="iroda"?"iroda":"home office"})`
        + (partial? `, nem teljes munkanap: ${fmt(missingMinutes)} kiesés.` : ".")});
    }catch(e){ setMsg({type:"err",text:e.message}); }
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
          {!target && <a href="/szabadsag">Szabadság</a>}
          {!target && <a href="/report">Kimutatás</a>}
          <button className="btn sec" onClick={()=>signOut({callbackUrl:"/login"})}>Kilépés</button>
        </div>
      </div>

      <div className="card">
        <div className="row1">
          <div className="fld"><label>Nap</label>
            <input type="date" min={bounds.min} max={bounds.max} value={date}
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
              <button className={"chip"+(loc==="iroda"?" sel":"")} onClick={()=>setLoc("iroda")}>🏢 Iroda</button>
              <button className={"chip"+(loc==="home"?" sel":"")} onClick={()=>setLoc("home")}>🏠 Home office</button>
            </div>
          </div>
          <div className="fld"><label>Munkanap</label>
            <div className="chips">
              <button className={"chip"+(partial?" sel":"")} onClick={()=>setPartial(p=>!p)}>⏳ Nem teljes munkanap</button>
            </div>
          </div>
          <button className="btn" onClick={()=>load()} disabled={loading}>{loading?"Betöltés…":"Feladatok behívása"}</button>
        </div>

        {partial && (
          <div className="partial">
            <div className="row1" style={{alignItems:"flex-end"}}>
              <div className="fld"><label>Kieső idő (óra)</label>
                <input className="cmin" type="number" min="0.5" step="0.5" max={dailyHours(date)-0.5}
                  value={missingH} onChange={e=>setMissingH(e.target.value)} placeholder="pl. 2"/>
              </div>
              <div className="muted" style={{fontSize:12,paddingBottom:8}}>
                Aznapi teljes munkaidő: <b>{dailyHours(date)} óra</b>{new Date(date+"T00:00:00").getDay()===5?" (péntek)":""} ·
                elvárt: <b>{Math.max(dailyHours(date)-(Number(String(missingH).replace(",","."))||0),0)} óra</b>
              </div>
            </div>
            <div className="fld" style={{marginTop:8}}>
              <label>Indoklás</label>
              <input type="text" className="reason" value={reason} maxLength={300}
                onChange={e=>setReason(e.target.value)}
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
                  <select value={l.activity} onChange={ev=>setLine(t.id,i,{activity:ev.target.value})}>
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
          <button className="btn" onClick={submit} disabled={loading}>Mentés</button>
        </div>
      )}
    </div>
  );
}
