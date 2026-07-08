"use client";
import { useEffect, useState, useMemo } from "react";
import { useSession } from "next-auth/react";

function fmt(m){ if(!m) return "0 p"; const h=Math.floor(m/60),r=m%60; return (h?h+" ó ":"")+(r?r+" p":(h?"":"0 p")); }
function localISO(d){ const z=new Date(d.getTime()-d.getTimezoneOffset()*60000); return z.toISOString().slice(0,10); }
function uname(r){ return r.user_name || r.user_email || "—"; }

function Bars({title, map}){
  const rows = Object.entries(map).sort((a,b)=>b[1]-a[1]);
  const max = rows.length? rows[0][1] : 1;
  if(!rows.length) return null;
  return (
    <div className="card">
      <div className="grp" style={{marginTop:0}}>{title}</div>
      <div className="bars">
        {rows.map(([label,min])=>(
          <div className="barrow" key={label}>
            <div className="barlabel" title={label}>{label}</div>
            <div className="bartrack"><div className="barfill" style={{width:Math.max(4,(min/max*100))+"%"}}></div></div>
            <div className="barval">{fmt(min)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Report(){
  const { status } = useSession();
  const today = localISO(new Date());
  const monthStart = today.slice(0,8)+"01";
  const [from,setFrom]=useState(monthStart);
  const [to,setTo]=useState(today);
  const [clientF,setClientF]=useState("");
  const [userF,setUserF]=useState("");
  const [data,setData]=useState(null);
  const [err,setErr]=useState("");
  const [loading,setLoading]=useState(false);

  async function load(){
    setLoading(true); setErr("");
    try{
      const r = await fetch(`/api/report?from=${from}&to=${to}`);
      const d = await r.json();
      if(!r.ok) throw new Error(d.error||"Hiba");
      setData(d);
    }catch(e){ setErr(e.message); } finally{ setLoading(false); }
  }
  useEffect(()=>{ if(status==="authenticated") load(); },[status]);

  const rows = data?.rows||[];
  const isManager = !!data?.isManager;

  const clients = useMemo(()=>[...new Set(rows.map(r=>r.client||"—"))].sort((a,b)=>a.localeCompare(b,"hu")),[rows]);
  const users = useMemo(()=>[...new Set(rows.map(uname))].sort((a,b)=>a.localeCompare(b,"hu")),[rows]);

  const filtered = useMemo(()=> rows.filter(r=>
    (!clientF || (r.client||"—")===clientF) && (!userF || uname(r)===userF)
  ),[rows,clientF,userF]);

  const agg = useMemo(()=>{
    const byClient={}, byActivity={}, byUser={}; let total=0;
    filtered.forEach(r=>{
      const m=Number(r.minutes)||0; total+=m;
      const c=r.client||"—"; byClient[c]=(byClient[c]||0)+m;
      const a=r.activity||"—"; byActivity[a]=(byActivity[a]||0)+m;
      const u=uname(r); byUser[u]=(byUser[u]||0)+m;
    });
    return { byClient, byActivity, byUser, total };
  },[filtered]);

  function exportCSV(){
    const head=["Dátum","Kolléga","Ügyfél","Feladat","Szülő","Tevékenység","Perc","Óra"];
    const lines=[head.join(";")];
    filtered.forEach(r=>{
      const vals=[(r.work_date||"").slice(0,10), uname(r), r.client||"", r.task_name||"", r.parent_name||"", r.activity||"", r.minutes, ((Number(r.minutes)||0)/60).toFixed(2).replace(".",",")];
      lines.push(vals.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(";"));
    });
    const csv="﻿"+lines.join("\r\n");
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=`nest-idorogzites_${from}_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  if(status!=="authenticated") return <div className="wrap"><p className="muted">Betöltés…</p></div>;

  return (
    <div className="wrap">
      <div className="top">
        <div className="brand">
          <img src="/nest-logo.svg" alt="NEST" />
          <span className="divider"></span>
          <div><h1>Kimutatás</h1><div className="who">{isManager? "Összesített (vezetői) nézet":"Saját idő"}</div></div>
        </div>
        <a href="/">← Rögzítő</a>
      </div>

      <div className="card">
        <div className="row1">
          <div className="fld"><label>Kezdő nap</label><input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></div>
          <div className="fld"><label>Záró nap</label><input type="date" value={to} onChange={e=>setTo(e.target.value)}/></div>
          <div className="fld"><label>Ügyfél</label>
            <select value={clientF} onChange={e=>setClientF(e.target.value)}>
              <option value="">Mind</option>
              {clients.map(c=><option key={c} value={c}>{c}</option>)}
            </select></div>
          {isManager && <div className="fld"><label>Kolléga</label>
            <select value={userF} onChange={e=>setUserF(e.target.value)}>
              <option value="">Mind</option>
              {users.map(u=><option key={u} value={u}>{u}</option>)}
            </select></div>}
          <button className="btn" onClick={load} disabled={loading}>{loading?"Betöltés…":"Frissítés"}</button>
          <button className="btn sec" onClick={exportCSV} disabled={!filtered.length}>Export CSV</button>
        </div>
      </div>

      {err && <div className="status err">{err}</div>}

      <div className="kpis">
        <div className="kpi"><div className="kpival">{fmt(agg.total)}</div><div className="kpilabel">Összes idő</div></div>
        {isManager && <div className="kpi"><div className="kpival">{Object.keys(agg.byUser).length}</div><div className="kpilabel">Kolléga</div></div>}
        <div className="kpi"><div className="kpival">{Object.keys(agg.byClient).length}</div><div className="kpilabel">Ügyfél</div></div>
        <div className="kpi"><div className="kpival">{filtered.length}</div><div className="kpilabel">Naplózott tétel</div></div>
      </div>

      {!filtered.length && !loading && <div className="card muted">Nincs adat erre a szűrésre.</div>}

      {filtered.length>0 && <>
        <Bars title="Ügyfél szerint" map={agg.byClient}/>
        <Bars title="Tevékenység szerint" map={agg.byActivity}/>
        {isManager && <Bars title="Kolléga szerint" map={agg.byUser}/>}

        <div className="card">
          <div className="grp" style={{marginTop:0}}>Tételek</div>
          <table>
            <thead><tr><th>Dátum</th><th>Kolléga</th><th>Ügyfél</th><th>Feladat</th><th>Tevékenység</th><th className="n">Idő</th></tr></thead>
            <tbody>
            {filtered.slice().sort((a,b)=>(b.work_date||"").localeCompare(a.work_date||"")).map((r,i)=>(
              <tr key={i}>
                <td>{(r.work_date||"").slice(0,10)}</td>
                <td>{uname(r)}</td>
                <td>{r.client||"—"}</td>
                <td>{r.task_name||"—"}{r.parent_name?<span className="muted"> · ↳ {r.parent_name}</span>:null}</td>
                <td>{r.activity||"—"}</td>
                <td className="n">{fmt(Number(r.minutes)||0)}</td>
              </tr>
            ))}
            </tbody>
          </table>
        </div>
      </>}
    </div>
  );
}
