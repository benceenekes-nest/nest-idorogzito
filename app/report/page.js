"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

function fmt(m){ if(!m) return "0 p"; const h=Math.floor(m/60),r=m%60; return (h?h+" ó ":"")+(r?r+" p":(h?"":"0 p")); }

export default function Report(){
  const { data:session, status } = useSession();
  const today = new Date().toISOString().slice(0,10);
  const weekAgo = new Date(Date.now()-6*864e5).toISOString().slice(0,10);
  const [from,setFrom]=useState(weekAgo);
  const [to,setTo]=useState(today);
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

  if(status!=="authenticated") return <div className="wrap"><p className="muted">Betöltés…</p></div>;

  const rows = data?.rows||[];
  // összesítés: kolléga -> ügyfél -> tevékenység, plusz szülőfeladat rollup
  const byUser = {};
  rows.forEach(r=>{
    const u = r.user_name || r.user_email;
    byUser[u] = byUser[u] || { total:0, clients:{} };
    byUser[u].total += r.minutes;
    const c = r.client||"—";
    const cl = byUser[u].clients[c] = byUser[u].clients[c] || { total:0, acts:{} };
    cl.total += r.minutes;
    const a = r.activity||"—";
    cl.acts[a] = (cl.acts[a]||0) + r.minutes;
  });

  return (
    <div className="wrap">
      <div className="top">
        <h1>Időkimutatás {data?.isManager? "· összesített":"· saját"}</h1>
        <a href="/">← Rögzítő</a>
      </div>
      <div className="card">
        <div className="row1">
          <div className="fld"><label>Kezdő nap</label><input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></div>
          <div className="fld"><label>Záró nap</label><input type="date" value={to} onChange={e=>setTo(e.target.value)}/></div>
          <button className="btn" onClick={load} disabled={loading}>{loading?"Betöltés…":"Frissítés"}</button>
        </div>
      </div>
      {err && <div className="status err">{err}</div>}
      {!rows.length && !loading && <div className="card muted">Nincs adat erre az időszakra.</div>}
      {Object.keys(byUser).sort().map(u=>{
        const ud=byUser[u];
        return (
          <div className="card" key={u}>
            <div className="top"><b>{u}</b><span className="muted">{fmt(ud.total)}</span></div>
            <table><thead><tr><th>Ügyfél</th><th>Tevékenység</th><th className="n">Idő</th></tr></thead>
            <tbody>
            {Object.keys(ud.clients).sort().map(c=>{
              const cd=ud.clients[c]; const acts=Object.keys(cd.acts).sort();
              return acts.map((a,i)=>(
                <tr key={c+a}>
                  <td>{i===0? <b>{c} <span className="muted">({fmt(cd.total)})</span></b> : ""}</td>
                  <td>{a}</td><td className="n">{fmt(cd.acts[a])}</td>
                </tr>
              ));
            })}
            </tbody></table>
          </div>
        );
      })}
    </div>
  );
}
