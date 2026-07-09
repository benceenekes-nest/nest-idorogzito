"use client";
import { useEffect, useState, useMemo } from "react";
import { useSession } from "next-auth/react";

function fmt(m){ if(!m) return "0 p"; const h=Math.floor(m/60),r=m%60; return (h?h+" ó ":"")+(r?r+" p":(h?"":"0 p")); }
function hrs(m){ return (m/60).toFixed(1).replace(".",","); }
function localISO(d){ const z=new Date(d.getTime()-d.getTimezoneOffset()*60000); return z.toISOString().slice(0,10); }
function uname(r){ return r.user_name || r.user_email || "—"; }
const WD=["V","H","K","Sze","Cs","P","Szo"];
function workdays(from,to){
  let n=0; const a=new Date(from), b=new Date(to);
  for(let d=new Date(a); d<=b; d.setDate(d.getDate()+1)){ const g=d.getDay(); if(g!==0&&g!==6) n++; }
  return n;
}

function Bars({map}){
  const rows = Object.entries(map).sort((a,b)=>b[1]-a[1]);
  const max = rows.length? rows[0][1] : 1;
  if(!rows.length) return <div className="muted">Nincs adat.</div>;
  return (
    <div className="bars">
      {rows.map(([label,min])=>(
        <div className="barrow" key={label}>
          <div className="barlabel" title={label}>{label}</div>
          <div className="bartrack"><div className="barfill" style={{width:Math.max(4,(min/max*100))+"%"}}></div></div>
          <div className="barval">{fmt(min)}</div>
        </div>
      ))}
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
  const [groupBy,setGroupBy]=useState("client");
  const [tab,setTab]=useState("summary");
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

  const total = useMemo(()=> filtered.reduce((s,r)=>s+(Number(r.minutes)||0),0),[filtered]);
  const byGroup = useMemo(()=>{
    const key = groupBy==="activity"? (r=>r.activity||"—") : groupBy==="user"? uname : (r=>r.client||"—");
    const m={}; filtered.forEach(r=>{ const k=key(r); m[k]=(m[k]||0)+(Number(r.minutes)||0); }); return m;
  },[filtered,groupBy]);
  const byUserTotal = useMemo(()=>{ const m={}; filtered.forEach(r=>{ const u=uname(r); m[u]=(m[u]||0)+(Number(r.minutes)||0); }); return m; },[filtered]);
  const byClient = useMemo(()=>{ const m={}; filtered.forEach(r=>{ const c=r.client||"—"; m[c]=(m[c]||0)+(Number(r.minutes)||0); }); return m; },[filtered]);

  // Heti mátrix
  const dates = useMemo(()=>[...new Set(filtered.map(r=>(r.work_date||"").slice(0,10)))].sort(),[filtered]);
  const matrix = useMemo(()=>{
    const rowKey = isManager? uname : (r=>r.client||"—");
    const rk=[...new Set(filtered.map(rowKey))].sort((a,b)=>a.localeCompare(b,"hu"));
    const cell={}; rk.forEach(k=>cell[k]={});
    filtered.forEach(r=>{ const k=rowKey(r), d=(r.work_date||"").slice(0,10); cell[k][d]=(cell[k][d]||0)+(Number(r.minutes)||0); });
    return { rk, cell };
  },[filtered,isManager]);

  // Kihasználtság
  const util = useMemo(()=>{
    const wd=workdays(from,to); const exp=wd*8*60;
    return { wd, exp, rows:Object.entries(byUserTotal).sort((a,b)=>b[1]-a[1]) };
  },[byUserTotal,from,to]);

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
        <a className="noprint" href="/">← Rögzítő</a>
        <a className="noprint" href="/szabadsag">Szabadság</a>
      </div>

      <div className="card noprint">
        <div className="row1">
          <div className="fld"><label>Kezdő nap</label><input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></div>
          <div className="fld"><label>Záró nap</label><input type="date" value={to} onChange={e=>setTo(e.target.value)}/></div>
          <div className="fld"><label>Ügyfél</label>
            <select value={clientF} onChange={e=>setClientF(e.target.value)}>
              <option value="">Mind</option>{clients.map(c=><option key={c} value={c}>{c}</option>)}
            </select></div>
          {isManager && <div className="fld"><label>Kolléga</label>
            <select value={userF} onChange={e=>setUserF(e.target.value)}>
              <option value="">Mind</option>{users.map(u=><option key={u} value={u}>{u}</option>)}
            </select></div>}
          <button className="btn" onClick={load} disabled={loading}>{loading?"Betöltés…":"Frissítés"}</button>
          <button className="btn sec" onClick={exportCSV} disabled={!filtered.length}>Export CSV</button>
          <button className="btn sec" onClick={()=>window.print()} disabled={!filtered.length}>PDF / Nyomtatás</button>
        </div>
      </div>

      {err && <div className="status err">{err}</div>}

      <div className="kpis">
        <div className="kpi"><div className="kpival">{fmt(total)}</div><div className="kpilabel">Összes idő</div></div>
        {isManager && <div className="kpi"><div className="kpival">{Object.keys(byUserTotal).length}</div><div className="kpilabel">Kolléga</div></div>}
        <div className="kpi"><div className="kpival">{Object.keys(byClient).length}</div><div className="kpilabel">Ügyfél</div></div>
        <div className="kpi"><div className="kpival">{filtered.length}</div><div className="kpilabel">Naplózott tétel</div></div>
      </div>

      <div className="tabs noprint">
        <button className={"tab"+(tab==="summary"?" on":"")} onClick={()=>setTab("summary")}>Összesítő</button>
        <button className={"tab"+(tab==="weekly"?" on":"")} onClick={()=>setTab("weekly")}>Heti mátrix</button>
        <button className={"tab"+(tab==="util"?" on":"")} onClick={()=>setTab("util")}>Kihasználtság</button>
      </div>

      {!filtered.length && !loading && <div className="card muted">Nincs adat erre a szűrésre.</div>}

      {filtered.length>0 && tab==="summary" && <>
        <div className="card">
          <div className="row1" style={{marginBottom:10}}>
            <div className="fld"><label>Csoportosítás</label>
              <select value={groupBy} onChange={e=>setGroupBy(e.target.value)}>
                <option value="client">Ügyfél szerint</option>
                <option value="activity">Tevékenység szerint</option>
                {isManager && <option value="user">Kolléga szerint</option>}
              </select></div>
          </div>
          <Bars map={byGroup}/>
        </div>
        <div className="card">
          <div className="grp" style={{marginTop:0}}>Tételek</div>
          <table>
            <thead><tr><th>Dátum</th><th>Kolléga</th><th>Ügyfél</th><th>Feladat</th><th>Tevékenység</th><th className="n">Idő</th></tr></thead>
            <tbody>
            {filtered.slice().sort((a,b)=>(b.work_date||"").localeCompare(a.work_date||"")).map((r,i)=>(
              <tr key={i}>
                <td>{(r.work_date||"").slice(0,10)}</td><td>{uname(r)}</td><td>{r.client||"—"}</td>
                <td>{r.task_name||"—"}{r.parent_name?<span className="muted"> · ↳ {r.parent_name}</span>:null}</td>
                <td>{r.activity||"—"}</td><td className="n">{fmt(Number(r.minutes)||0)}</td>
              </tr>
            ))}
            </tbody>
          </table>
        </div>
      </>}

      {filtered.length>0 && tab==="weekly" && (
        <div className="card" style={{overflowX:"auto"}}>
          <div className="grp" style={{marginTop:0}}>Heti mátrix — {isManager?"kolléga":"ügyfél"} × nap</div>
          <table className="matrix">
            <thead><tr><th>{isManager?"Kolléga":"Ügyfél"}</th>
              {dates.map(d=><th key={d} className="n">{d.slice(5)}<br/><span className="muted">{WD[new Date(d).getDay()]}</span></th>)}
              <th className="n">Összesen</th></tr></thead>
            <tbody>
            {matrix.rk.map(k=>{
              const rowTotal=dates.reduce((s,d)=>s+(matrix.cell[k][d]||0),0);
              return <tr key={k}><td>{k}</td>
                {dates.map(d=><td key={d} className="n">{matrix.cell[k][d]?fmt(matrix.cell[k][d]):"–"}</td>)}
                <td className="n"><b>{fmt(rowTotal)}</b></td></tr>;
            })}
            <tr><td><b>Összesen</b></td>
              {dates.map(d=><td key={d} className="n"><b>{fmt(matrix.rk.reduce((s,k)=>s+(matrix.cell[k][d]||0),0))}</b></td>)}
              <td className="n"><b>{fmt(total)}</b></td></tr>
            </tbody>
          </table>
        </div>
      )}

      {filtered.length>0 && tab==="util" && (
        <div className="card">
          <div className="grp" style={{marginTop:0}}>Kihasználtság — elvárt: {util.wd} munkanap × 8 ó = {util.wd*8} ó</div>
          <div className="bars">
            {util.rows.map(([u,min])=>{
              const pct = util.exp? Math.round(min/util.exp*100) : 0;
              return <div className="barrow" key={u}>
                <div className="barlabel" title={u}>{u}</div>
                <div className="bartrack"><div className="barfill" style={{width:Math.min(100,pct)+"%",background:pct>=85?"#1f9c74":pct>=50?"#1b395d":"#b45309"}}></div></div>
                <div className="barval">{hrs(min)} ó · {pct}%</div>
              </div>;
            })}
          </div>
          <div className="muted" style={{fontSize:12,marginTop:8}}>Az elvárt óraszám munkanaponként 8 óra (hétvége nélkül). Ez később állítható.</div>
        </div>
      )}
    </div>
  );
}
