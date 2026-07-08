"use client";
import { useEffect, useState, useMemo } from "react";
import { useSession, signOut } from "next-auth/react";
import { ACTIVITIES } from "../lib/clients";

const DURS=[15,30,45,60,90,120];
const FINISHED=["done","complete","kész","closed","cancelled","törölve"];
function fmt(m){ if(!m) return "0 p"; const h=Math.floor(m/60),r=m%60; return (h?h+" ó ":"")+(r?r+" p":(h?"":"0 p")); }

export default function Home(){
  const { data:session, status } = useSession();
  const [date,setDate]=useState(new Date().toISOString().slice(0,10));
  const [tasks,setTasks]=useState([]);
  const [me,setMe]=useState(null);
  const [ent,setEnt]=useState({});        // taskId -> {on,activity,min}
  const [msg,setMsg]=useState(null);       // {type,text}
  const [loading,setLoading]=useState(false);
  const [showDone,setShowDone]=useState(false);

  async function load(d=date){
    setLoading(true); setMsg(null); setEnt({}); setTasks([]);
    try{
      const r = await fetch(`/api/tasks?date=${d}`);
      const data = await r.json();
      if(!r.ok) throw new Error(data.error||"Betöltési hiba");
      setMe(data.me);
      setTasks(data.tasks||[]);
      const e={};
      (data.prefill||[]).forEach(p=>{ e[p.task_id]={on:true, activity:p.activity||"", min:Number(p.minutes)||0}; });
      setEnt(e);
    }catch(e){ setMsg({type:"err",text:e.message}); }
    finally{ setLoading(false); }
  }
  useEffect(()=>{ if(status==="authenticated") load(); },[status]);

  function upd(id,patch){ setEnt(s=>({ ...s, [id]:{ on:false,activity:"",min:0, ...(s[id]||{}), ...patch } })); }

  const grouped = useMemo(()=>{
    let list = tasks.filter(t=> showDone ? true : !FINISHED.includes((t.status||"").toLowerCase()));
    list = list.slice().sort((a,b)=>{
      if(a.client!==b.client) return a.client.localeCompare(b.client,"hu");
      return (a.name||"").localeCompare(b.name||"","hu");
    });
    return list;
  },[tasks,showDone]);

  const total = useMemo(()=> Object.values(ent).reduce((a,e)=> a+(e.on? (e.min||0):0),0),[ent]);
  const doneCount = tasks.filter(t=>FINISHED.includes((t.status||"").toLowerCase())).length;

  async function submit(){
    const rows = tasks.filter(t=>ent[t.id]?.on && (ent[t.id]?.min||0)>0).map(t=>({
      taskId:t.id, taskName:t.name, parentId:t.parentId, parentName:t.parentName,
      client:t.client, activity:ent[t.id].activity, minutes:ent[t.id].min
    }));
    if(!rows.length){ setMsg({type:"err",text:"Pipálj be legalább egy feladatot és adj meg időt."}); return; }
    setLoading(true); setMsg(null);
    try{
      const r = await fetch("/api/time",{ method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ date, rows }) });
      const d = await r.json();
      if(!r.ok) throw new Error(d.error||"Mentési hiba");
      setMsg({type:"ok",text:`Mentve: ${d.saved} tétel, összesen ${fmt(total)} — ${date}.`});
    }catch(e){ setMsg({type:"err",text:e.message}); }
    finally{ setLoading(false); }
  }

  if(status!=="authenticated") return <div className="wrap"><div className="center"><p className="muted">Betöltés…</p></div></div>;

  let lastClient=null;
  return (
    <div className="wrap">
      <div className="top">
        <div><h1>Napi időrögzítő</h1><div className="who">{me?.name} · {me?.email}</div></div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <a href="/report">Kimutatás</a>
          <button className="btn sec" onClick={()=>signOut({callbackUrl:"/login"})}>Kilépés</button>
        </div>
      </div>

      <div className="card">
        <div className="row1">
          <div className="fld"><label>Nap</label>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)}/></div>
          <button className="btn" onClick={()=>load()} disabled={loading}>{loading?"Betöltés…":"Feladatok behívása"}</button>
          <span className="muted" style={{fontSize:12}}>Csak azt pipáld, amin aznap dolgoztál.</span>
        </div>
      </div>

      {msg && <div className={"status "+msg.type}>{msg.text}</div>}

      {grouped.map(t=>{
        const e = ent[t.id]||{on:false,activity:"",min:0};
        const header = t.client!==lastClient ? (lastClient=t.client, t.client) : null;
        return (
          <div key={t.id}>
            {header!==null && <div className="grp">{header}</div>}
            <div className={"task"+(e.on?" on":"")}>
              <div className="thead">
                <input type="checkbox" className="cbx" checked={!!e.on}
                  onChange={ev=>upd(t.id,{on:ev.target.checked, ...(ev.target.checked?{}:{min:0,activity:""})})}/>
                <div style={{flex:1}}>
                  <div className="tname">
                    <a href={t.url} target="_blank" rel="noopener">{t.name}</a>
                    <span className="pill">{t.status}</span>
                    {t.parentId && <span className="pill">↳ altaszk</span>}
                  </div>
                  {t.parentName && <div className="sub">Szülő: {t.parentName}</div>}
                </div>
              </div>
              {e.on && (
                <div className="controls">
                  <select value={e.activity} onChange={ev=>upd(t.id,{activity:ev.target.value})}>
                    <option value="">Tevékenységtípus…</option>
                    {ACTIVITIES.map(a=><option key={a} value={a}>{a}</option>)}
                  </select>
                  <div className="chips">
                    {DURS.map(d=>(
                      <button key={d} className={"chip"+(e.min===d?" sel":"")} onClick={()=>upd(t.id,{min:d})}>{fmt(d)}</button>
                    ))}
                    <input className="cmin" type="number" min="0" step="5" placeholder="egyéni p"
                      value={e.min && !DURS.includes(e.min)? e.min : ""}
                      onChange={ev=>upd(t.id,{min:Number(ev.target.value)||0})}/>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {doneCount>0 && (
        <button className="btn sec" style={{marginTop:6}} onClick={()=>setShowDone(s=>!s)}>
          {showDone? "Kész feladatok elrejtése" : `Kész feladatok mutatása (${doneCount})`}
        </button>
      )}

      {tasks.length>0 && (
        <div className="foot">
          <div className="total">Napi összesen: <span>{fmt(total)}</span></div>
          <button className="btn" onClick={submit} disabled={loading}>Mentés</button>
        </div>
      )}
    </div>
  );
}
