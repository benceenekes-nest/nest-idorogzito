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
  const { status } = useSession();
  const [year,setYear]=useState(new Date().getFullYear());
  const [mode,setMode]=useState("szabadsag");   // szabadsag | beteg | torles
  const [team,setTeam]=useState(false);
  const [srv,setSrv]=useState({days:[], isManager:false, me:null, today:""});
  const [draft,setDraft]=useState({});          // date -> kind | null (null = törlés)
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState(null);

  async function load(y=year, t=team){
    setBusy(true); setMsg(null); setDraft({});
    try{
      const r=await fetch(`/api/leave?from=${y}-01-01&to=${y}-12-31${t?"&all=1":""}`);
      const d=await r.json();
      if(!r.ok) throw new Error(d.error||"Betöltési hiba");
      setSrv(d);
    }catch(e){ setMsg({type:"err",text:e.message}); }
    finally{ setBusy(false); }
  }
  useEffect(()=>{ if(status==="authenticated") load(); },[status]);

  const myEmail = srv.me?.email;
  const today = srv.today || "";

  // mentett napok (dátum -> bejegyzések)
  const byDate = useMemo(()=>{
    const m={}; (srv.days||[]).forEach(x=>{ (m[x.date] ||= []).push(x); }); return m;
  },[srv]);
  const savedMine = useMemo(()=>{
    const m={}; (srv.days||[]).forEach(x=>{ if(x.email===myEmail) m[x.date]=x.kind; }); return m;
  },[srv,myEmail]);

  const dirty = Object.keys(draft).length>0;
  function effective(ds){ return (ds in draft) ? draft[ds] : (savedMine[ds]||null); }
  function isLocked(ds){ return !!savedMine[ds] && !(ds in draft) && !srv.isManager && ds<=today; }

  function clickDay(ds){
    if(team || busy) return;
    if(isLocked(ds)){
      setMsg({type:"err",text:`A ${ds} nap már le van mentve és lezárva. Múltbeli napot csak a vezető tud módosítani.`});
      return;
    }
    // mentett, de jövőbeli nap első módosítása → megerősítés
    if(savedMine[ds] && !(ds in draft)){
      if(!window.confirm(`A ${ds} már mentve van (${KINDLABEL[savedMine[ds]]}). Biztosan módosítod?`)) return;
    }
    const cur = effective(ds);
    let kind = mode==="torles" ? null : mode;
    if(kind && cur===kind) kind = null;              // ugyanarra újra kattintva leveszi
    setMsg(null);
    setDraft(s=>{
      const n={...s};
      if((savedMine[ds]||null) === kind) delete n[ds];  // visszaállt az eredetire
      else n[ds]=kind;
      return n;
    });
  }

  async function save(){
    if(!dirty) return;
    const changes = Object.entries(draft).map(([date,kind])=>({date,kind}));
    setBusy(true); setMsg(null);
    try{
      const r=await fetch("/api/leave",{ method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ changes }) });
      const d=await r.json();
      if(!r.ok) throw new Error(d.error||"Mentési hiba");
      await load(year, team);
      const b = (d.blocked||[]).length;
      setMsg({type: b?"err":"ok", text: b
        ? `Mentve ${d.saved} nap. ${b} lezárt napot nem lehetett módosítani: ${d.blocked.join(", ")}`
        : `Mentve: ${d.saved} nap. A múltbeli napok mostantól zároltak.`});
    }catch(e){ setMsg({type:"err",text:e.message}); }
    finally{ setBusy(false); }
  }

  const counts = useMemo(()=>{
    let sz=0,bt=0;
    if(team){
      (srv.days||[]).forEach(x=>{
        const [Y,M,D]=x.date.split("-").map(Number);
        if(isWeekend(Y,M-1,D)) return;
        if(x.kind==="szabadsag") sz++; else if(x.kind==="beteg") bt++;
      });
      return {sz,bt};
    }
    const all={...savedMine}; Object.entries(draft).forEach(([d,k])=>{ if(k) all[d]=k; else delete all[d]; });
    Object.entries(all).forEach(([d,k])=>{
      const [Y,M,D]=d.split("-").map(Number);
      if(isWeekend(Y,M-1,D)) return;
      if(k==="szabadsag") sz++; else if(k==="beteg") bt++;
    });
    return {sz,bt};
  },[srv,draft,savedMine,team]);

  if(status!=="authenticated") return <div className="wrap"><div className="center"><p className="muted">Betöltés…</p></div></div>;

  return (
    <div className="wrap">
      <div className="top">
        <div className="brand">
          <img src="/nest-logo.svg" alt="NEST" />
          <span className="divider"></span>
          <div><h1>Szabadság</h1><div className="who">{srv.me?.name} · {srv.me?.email}</div></div>
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
          {srv.isManager && (
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
                : "Jelöld ki a napokat, majd nyomd meg a Mentés gombot. Mentés után a mai és korábbi napok 🔒 zároltak, azokat csak a vezető tudja módosítani. Jövőbeli mentett nap megerősítéssel átírható. Hétvégéket nem számoljuk bele."}
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
                const wk=isWeekend(year,m,d);
                const eff=effective(ds);
                const pending = ds in draft;
                const locked = isLocked(ds);
                let cls="cday";
                if(wk) cls+=" wk";
                if(ds===today) cls+=" today";
                if(!team && eff) cls+=" "+eff;
                if(!team && pending) cls+=" pending";
                if(!team && locked) cls+=" locked";
                if(team && list.length) cls+=" teamon";
                return (
                  <div key={ds} className={cls} onClick={()=>clickDay(ds)}
                       title={team ? list.map(x=>`${x.name} — ${KINDLABEL[x.kind]}`).join("\n")
                                   : (locked ? `${KINDLABEL[savedMine[ds]]} — lezárva`
                                             : (eff?KINDLABEL[eff]+(pending?" (nem mentett)":""):""))}>
                    <span>{d}</span>
                    {!team && locked && <b className="lock">🔒</b>}
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
        <span><i className="sw pend"></i> Nem mentett</span>
        <span>🔒 Lezárt</span>
      </div>

      {!team && (
        <div className="foot">
          <div className="total">
            {dirty ? <>Nem mentett módosítás: <span>{Object.keys(draft).length} nap</span></>
                   : <span className="muted" style={{fontWeight:600}}>Minden mentve</span>}
          </div>
          <div style={{display:"flex",gap:8}}>
            {dirty && <button className="btn sec" onClick={()=>{setDraft({});setMsg(null);}} disabled={busy}>Elvetés</button>}
            <button className="btn" onClick={save} disabled={busy||!dirty}>{busy?"Mentés…":"Mentés"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
