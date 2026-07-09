"use client";
import { useEffect, useMemo, useState } from "react";
import { useSession, signOut } from "next-auth/react";

const MONTHS=["Január","Február","Március","Április","Május","Június","Július","Augusztus","Szeptember","Október","November","December"];
const DOW=["H","K","Sze","Cs","P","Szo","V"];
const KINDLABEL={szabadsag:"Szabadság", beteg:"Betegszabadság"};

function iso(y,m,d){ return `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }
function daysInMonth(y,m){ return new Date(y,m+1,0).getDate(); }
function firstDow(y,m){ const d=new Date(y,m,1).getDay(); return (d+6)%7; } // hétfő = 0
function isWeekend(y,m,d){ const w=new Date(y,m,d).getDay(); return w===0||w===6; }
function initials(n){ return (n||"").split(/\s+/).filter(Boolean).slice(0,2).map(s=>s[0].toUpperCase()).join(""); }

export default function Szabadsag(){
  const { data:session, status } = useSession();
  const [year,setYear]=useState(new Date().getFullYear());
  const [mode,setMode]=useState("szabadsag"); // szabadsag | beteg | torles
  const [team,setTeam]=useState(false);
  const [data,setData]=useState({days:[], isManager:false, me:null, team:false});
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState(null);
  const todayISO = useMemo(()=>{ const t=new Date(); return iso(t.getFullYear(),t.getMonth(),t.getDate()); },[]);

  async function load(y=year, t=team){
    setBusy(true); setMsg(null);
    try{
      const r=await fetch(`/api/leave?from=${y}-01-01&to=${y}-12-31${t?"&all=1":""}`);
      const d=await r.json();
      if(!r.ok) throw new Error(d.error||"Betöltési hiba");
      setData(d);
    }catch(e){ setMsg({type:"err",text:e.message}); }
    finally{ setBusy(false); }
  }
  useEffect(()=>{ if(status==="authenticated") load(); },[status]);

  // dátum -> bejegyzések
  const byDate = useMemo(()=>{
    const m={};
    (data.days||[]).forEach(x=>{ (m[x.date] ||= []).push(x); });
    return m;
  },[data]);

  const myEmail = data.me?.email;
  function mine(dateStr){
    const list = byDate[dateStr]||[];
    return list.find(x=>x.email===myEmail) || null;
  }

  async function clickDay(dateStr){
    if(team) return;                       // csapatnézet csak olvasható
    if(busy) return;
    const cur = mine(dateStr);
    let kind = mode==="torles" ? null : mode;
    if(kind && cur && cur.kind===kind) kind = null;   // ugyanarra kattintva levesszük
    setBusy(true); setMsg(null);
    try{
      const r=await fetch("/api/leave",{ method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ date:dateStr, kind }) });
      const d=await r.json();
      if(!r.ok) throw new Error(d.error||"Mentési hiba");
      setData(s=>{
        const days=(s.days||[]).filter(x=>!(x.email===myEmail && x.date===dateStr));
        if(kind) days.push({ date:dateStr, kind, email:myEmail, name:data.me.name });
        return {...s, days};
      });
    }catch(e){ setMsg({type:"err",text:e.message}); }
    finally{ setBusy(false); }
  }

  // számlálók (csak munkanapok)
  const counts = useMemo(()=>{
    let sz=0,bt=0;
    (data.days||[]).forEach(x=>{
      if(!team && x.email!==myEmail) return;
      const [Y,M,D]=x.date.split("-").map(Number);
      if(isWeekend(Y,M-1,D)) return;
      if(x.kind==="szabadsag") sz++; else if(x.kind==="beteg") bt++;
    });
    return {sz,bt};
  },[data,team,myEmail]);

  if(status!=="authenticated") return <div className="wrap"><div className="center"><p className="muted">Betöltés…</p></div></div>;

  return (
    <div className="wrap">
      <div className="top">
        <div className="brand">
          <img src="/nest-logo.svg" alt="NEST" />
          <span className="divider"></span>
          <div><h1>Szabadság</h1><div className="who">{data.me?.name} · {data.me?.email}</div></div>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <a href="/">Időrögzítő</a>
          <a href="/report">Kimutatás</a>
          <button className="btn sec" onClick={()=>signOut({callbackUrl:"/login"})}>Kilépés</button>
        </div>
      </div>

      <div className="card noprint">
        <div className="row1">
          <div className="fld"><label>Év</label>
            <div className="chips">
              <button className="chip" onClick={()=>{const y=year-1;setYear(y);load(y);}}>‹</button>
              <button className="chip sel" style={{cursor:"default"}}>{year}</button>
              <button className="chip" onClick={()=>{const y=year+1;setYear(y);load(y);}}>›</button>
            </div>
          </div>
          {!team && (
            <div className="fld"><label>Mit jelölsz?</label>
              <div className="chips">
                <button className={"chip"+(mode==="szabadsag"?" sel":"")} onClick={()=>setMode("szabadsag")}>🌴 Szabadság</button>
                <button className={"chip"+(mode==="beteg"?" sel":"")} onClick={()=>setMode("beteg")}>🤒 Betegszabadság</button>
                <button className={"chip"+(mode==="torles"?" sel":"")} onClick={()=>setMode("torles")}>✕ Törlés</button>
              </div>
            </div>
          )}
          {data.isManager && (
            <div className="fld"><label>Nézet</label>
              <div className="chips">
                <button className={"chip"+(!team?" sel":"")} onClick={()=>{setTeam(false);load(year,false);}}>Saját</button>
                <button className={"chip"+(team?" sel":"")} onClick={()=>{setTeam(true);load(year,true);}}>Csapat</button>
              </div>
            </div>
          )}
        </div>
        <div className="muted" style={{fontSize:12,marginTop:8}}>
          {team ? "Csapatnézet — csak olvasható, a napokon a kollégák monogramja látszik."
                : "Kattints egy napra a jelöléshez. Ugyanarra újra kattintva leveszi. Hétvégéket nem számoljuk bele."}
        </div>
      </div>

      {msg && <div className={"status "+msg.type}>{msg.text}</div>}

      <div className="kpis">
        <div className="kpi"><div className="kpival">{counts.sz}</div><div className="kpilabel">Szabadságnap ({year}){team?" — csapat":""}</div></div>
        <div className="kpi"><div className="kpival">{counts.bt}</div><div className="kpilabel">Betegszabadság ({year}){team?" — csapat":""}</div></div>
      </div>

      <div className="cal">
        {MONTHS.map((mn,m)=>(
          <div className="calm card" key={m}>
            <div className="calmh">{mn}</div>
            <div className="calgrid">
              {DOW.map(d=><div className="cdow" key={d}>{d}</div>)}
              {Array.from({length:firstDow(year,m)}).map((_,i)=><div key={"e"+i}></div>)}
              {Array.from({length:daysInMonth(year,m)}).map((_,i)=>{
                const d=i+1, ds=iso(year,m,d);
                const list=byDate[ds]||[];
                const own=list.find(x=>x.email===myEmail);
                const wk=isWeekend(year,m,d);
                let cls="cday";
                if(wk) cls+=" wk";
                if(ds===todayISO) cls+=" today";
                if(!team && own) cls+=" "+own.kind;
                if(team && list.length) cls+=" teamon";
                return (
                  <div key={ds} className={cls} onClick={()=>clickDay(ds)}
                       title={team ? list.map(x=>`${x.name} — ${KINDLABEL[x.kind]}`).join("\n")
                                   : (own?KINDLABEL[own.kind]:"")}>
                    <span>{d}</span>
                    {team && list.length>0 && (
                      <div className="tinit">
                        {list.slice(0,3).map(x=>(
                          <i key={x.email} className={"dot "+x.kind} title={x.name}>{initials(x.name)}</i>
                        ))}
                        {list.length>3 && <i className="dot more">+{list.length-3}</i>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="legend">
        <span><i className="sw szabadsag"></i> Szabadság</span>
        <span><i className="sw beteg"></i> Betegszabadság</span>
        <span><i className="sw wkl"></i> Hétvége</span>
      </div>
    </div>
  );
}
