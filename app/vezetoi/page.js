"use client";
import { useEffect, useState, useMemo } from "react";
import { useSession, signOut, signIn } from "next-auth/react";

const fmt = m => !m ? "0 ó" : (m/60).toFixed(1).replace(".",",")+" ó";
const KIND = { beteg:"betegszabadság", szabadsag:"szabadság" };
function localISO(d){ const z=new Date(d.getTime()-d.getTimezoneOffset()*60000); return z.toISOString().slice(0,10); }
function dstr(ms){ if(!ms) return "—"; return localISO(new Date(Number(ms))).slice(5); }

function Bars({ rows, fmtv=fmt, max }){
  if(!rows.length) return <div className="muted">Nincs adat.</div>;
  const m = max || Math.max(...rows.map(r=>r[1]), 1);
  return <div className="bars">{rows.map(([l,v])=>(
    <div className="barrow" key={l}>
      <div className="barlabel" title={l}>{l}</div>
      <div className="bartrack"><div className="barfill" style={{width:Math.max(3,v/m*100)+"%"}}/></div>
      <div className="barval">{fmtv(v)}</div>
    </div>
  ))}</div>;
}

export default function Vezetoi(){
  const { data:session, status } = useSession();
  const today = localISO(new Date());
  const [from,setFrom]=useState(today.slice(0,8)+"01");
  const [to,setTo]=useState(today);
  const [d,setD]=useState(null);
  const [err,setErr]=useState("");
  const [loading,setLoading]=useState(false);
  const [tab,setTab]=useState("kapacitas");
  const [person,setPerson]=useState(null);   // email
  const [client,setClient]=useState(null);   // név
  const [openLoad,setOpenLoad]=useState(null);   // "d1:Név" | "d25:Név"

  async function load(){
    setLoading(true); setErr("");
    try{
      const r = await fetch(`/api/vezetoi?from=${from}&to=${to}`);
      const j = await r.json();
      if(!r.ok) throw new Error(j.error||"Betöltési hiba");
      setD(j);
    }catch(e){ setErr(e.message); }
    finally{ setLoading(false); }
  }
  useEffect(()=>{ if(status==="authenticated") load(); },[status]);

  const p = useMemo(()=> d && person ? d.people.find(x=>x.email===person) : null, [d,person]);
  const c = useMemo(()=> d && client ? d.clients.find(x=>x.name===client) : null, [d,client]);

  if(status==="loading") return <div className="wrap"><div className="center"><p className="muted">Betöltés…</p></div></div>;
  if(status!=="authenticated") return (
    <div className="wrap"><div className="center">
      <img src="/nest-logo.svg" alt="NEST"/>
      <h1>Vezetői felület</h1>
      <p className="muted">Lépj be a céges Google-fiókoddal (@nestcom.hu).</p>
      <button className="btn" onClick={()=>signIn("google")}>Belépés Google-fiókkal</button>
    </div></div>
  );

  return (
    <div className="wrap wide">
      <div className="top">
        <div className="brand">
          <img src="/nest-logo.svg" alt="NEST"/>
          <span className="divider"></span>
          <div><h1>Vezetői felület</h1><div className="who">{session.user.name} · {session.user.email}</div></div>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <a href="https://ido.nestgroup.hu">Időrögzítő</a>
          <button className="btn sec" onClick={()=>signOut({callbackUrl:"/"})}>Kilépés</button>
        </div>
      </div>

      <div className="card noprint">
        <div className="row1">
          <div className="fld"><label>Kezdő nap</label><input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></div>
          <div className="fld"><label>Záró nap</label><input type="date" value={to} onChange={e=>setTo(e.target.value)}/></div>
          <button className="btn" onClick={load} disabled={loading}>{loading?"Betöltés…":"Frissítés"}</button>
          <button className="btn sec" onClick={()=>window.print()}>PDF / Nyomtatás</button>
        </div>
      </div>

      {err && <div className="status err">{err}</div>}
      {!d && !err && <div className="card muted">Betöltés…</div>}

      {d && <>
        <div className="kpis">
          <div className="kpi"><div className="kpival">{fmt(Object.values(d.byClient).reduce((a,b)=>a+b,0))}</div><div className="kpilabel">Rögzített idő</div></div>
          <div className="kpi"><div className="kpival">{avgPct(d.people)}</div><div className="kpilabel">Átlagos kihasználtság</div></div>
          <div className="kpi"><div className="kpival">{d.ops.overdue.length}</div><div className="kpilabel">Lejárt határidő</div></div>
          <div className="kpi"><div className="kpival">{d.ops.due24.length}</div><div className="kpilabel">1 napon belül lejár</div></div>
          <div className="kpi"><div className="kpival">{d.absence.onLeaveToday.length}</div><div className="kpilabel">Ma távol</div></div>
        </div>

        <div className="tabs noprint">
          {[["kapacitas","Kapacitás"],["ugyfel","Ügyfelek"],["operacio","Operáció"],["tavollet","Távollét"]].map(([k,l])=>(
            <button key={k} className={"tab"+(tab===k?" on":"")} onClick={()=>{setTab(k);setPerson(null);setClient(null);}}>{l}</button>
          ))}
        </div>

        {tab==="kapacitas" && !p && (
          <div className="two">
            <div className="card">
              <div className="grp" style={{marginTop:0}}>Kihasználtság kollégánként</div>
              <table><thead><tr><th>Kolléga</th><th className="n">Rögzített</th><th className="n">Elvárt</th><th className="n">%</th></tr></thead>
                <tbody>{d.people.map(x=>(
                  <tr key={x.email} className="clickrow" onClick={()=>setPerson(x.email)}>
                    <td><a>{x.name}</a></td><td className="n">{fmt(x.loggedMin)}</td><td className="n">{fmt(x.capacityMin)}</td>
                    <td className="n"><b style={{color:pctColor(x.pct)}}>{x.pct==null?"–":x.pct+"%"}</b></td>
                  </tr>))}
                </tbody></table>
              <div className="note">Kattints egy kollégára a részletezőhöz.</div>
            </div>
            <div className="card">
              <div className="grp" style={{marginTop:0}}>Idő tevékenységtípusonként</div>
              <Bars rows={Object.entries(d.byActivity).sort((a,b)=>b[1]-a[1]).slice(0,12)}/>
              <div className="grp">Iroda / home office</div>
              <Bars rows={[["🏢 iroda",d.location.totals.iroda],["🏠 home office",d.location.totals.home]]} fmtv={v=>v+" nap"}/>
            </div>
          </div>
        )}

        {tab==="kapacitas" && p && (
          <div className="card">
            <button className="btn sec noprint" onClick={()=>setPerson(null)}>← Vissza</button>
            <div className="grp">{p.name} — {from} … {to}</div>
            <div className="kpis">
              <div className="kpi"><div className="kpival">{fmt(p.loggedMin)}</div><div className="kpilabel">Rögzített idő</div></div>
              <div className="kpi"><div className="kpival">{p.pct==null?"–":p.pct+"%"}</div><div className="kpilabel">Kihasználtság</div></div>
              <div className="kpi"><div className="kpival">{p.leaveDays+p.sickDays}</div><div className="kpilabel">Szabadság + betegnap</div></div>
              <div className="kpi"><div className="kpival">{fmt(p.missingMin)}</div><div className="kpilabel">Kieső idő</div></div>
            </div>
            <div className="grp">Idő ügyfelenként</div>
            <Bars rows={Object.entries(p.byClient).sort((a,b)=>b[1]-a[1])}/>
            <div className="grp">Nem teljes munkanapok</div>
            {d.absence.partialDays.filter(x=>x.email===p.email).length
              ? <table><thead><tr><th>Dátum</th><th className="n">Kieső</th><th>Indoklás</th></tr></thead>
                  <tbody>{d.absence.partialDays.filter(x=>x.email===p.email).map((x,i)=>(
                    <tr key={i}><td>{x.date}</td><td className="n">{fmt(x.missingMin)}</td><td>{x.reason||"—"}</td></tr>
                  ))}</tbody></table>
              : <div className="muted">Nincs.</div>}
            <div className="note">Iroda: {p.location.iroda} nap · home office: {p.location.home} nap</div>
          </div>
        )}

        {tab==="ugyfel" && !c && (
          <div className="card">
            <div className="grp" style={{marginTop:0}}>Ügyfél-jelzőlámpa és ráfordított idő</div>
            <table><thead><tr><th>Ügyfél</th><th></th><th className="n">Idő</th><th className="n">Nyitott</th><th className="n">Lejárt</th><th className="n">1 napon belül</th><th className="n">7 napon belül</th></tr></thead>
              <tbody>{d.clients.map(x=>(
                <tr key={x.name} className="clickrow" onClick={()=>setClient(x.name)}>
                  <td><a>{x.name}</a></td>
                  <td><span className={"dot "+(x.level===2?"r":x.level===1?"y":"g")}></span></td>
                  <td className="n">{x.minutes?fmt(x.minutes):"–"}</td>
                  <td className="n">{x.open}</td>
                  <td className="n">{x.overdue||"–"}</td>
                  <td className="n">{x.due24||"–"}</td>
                  <td className="n">{x.soon||"–"}</td>
                </tr>))}
              </tbody></table>
            <div className="note">Piros: van lejárt vagy 24 órán belül lejáró határidő. Sárga: 7 napon belüli határidő. Zöld: rendben. Az idő a saját időrögzítőből, a határidők a ClickUp-ból.</div>
          </div>
        )}

        {tab==="ugyfel" && c && (
          <div className="card">
            <button className="btn sec noprint" onClick={()=>setClient(null)}>← Vissza</button>
            <div className="grp">{c.name}</div>
            <div className="kpis">
              <div className="kpi"><div className="kpival">{c.minutes?fmt(c.minutes):"–"}</div><div className="kpilabel">Ráfordított idő</div></div>
              <div className="kpi"><div className="kpival">{c.open}</div><div className="kpilabel">Nyitott feladat</div></div>
              <div className="kpi danger"><div className="kpival">{c.overdue}</div><div className="kpilabel">Lejárt határidő</div></div>
              <div className="kpi danger"><div className="kpival">{c.due24}</div><div className="kpilabel">1 napon belül</div></div>
              <div className="kpi"><div className="kpival">{c.soon}</div><div className="kpilabel">7 napon belül</div></div>
            </div>
            <div className="grp">Idő tevékenységtípusonként</div>
            <Bars rows={Object.entries(c.activities).sort((a,b)=>b[1]-a[1])}/>
            <div className="grp">Lejárt és közelgő határidők</div>
            <TaskTable rows={[...d.ops.overdue.filter(t=>t.client===c.name), ...d.ops.upcoming.filter(t=>t.client===c.name)]}/>
          </div>
        )}

        {tab==="operacio" && (
          <>
            <div className="card">
              <div className="grp" style={{marginTop:0}}>1 napon belül lejár ({d.ops.due24.length})</div>
              <TaskTable rows={d.ops.due24}/>
              <div className="note">Ma vagy a következő 24 órában lejáró, nyitott feladatok.</div>
            </div>
            <div className="two" style={{marginTop:12}}>
              <LoadChart title={"Leterheltség — lejárt + következő 1 nap"} prefix="d1"
                tasks={[...d.ops.overdue, ...d.ops.due24]} open={openLoad} setOpen={setOpenLoad}
                hint={"Lejárt vagy 24 órán belül lejáró feladatok. Kattints egy névre a részletekért. Forrás: ClickUp."}/>
              <LoadChart title={"Leterheltség — 2.–5. nap"} prefix="d25"
                tasks={d.ops.due2to5} open={openLoad} setOpen={setOpenLoad}
                hint={"A következő 2–5 napban lejáró feladatok. Kattints egy névre a részletekért."}/>
            </div>
            <div className="card">
              <div className="grp" style={{marginTop:0}}>Következő 14 nap ({d.ops.upcoming.length})</div>
              <TaskTable rows={d.ops.upcoming.slice(0,25)}/>
            </div>
          </>
        )}

        {tab==="tavollet" && (
          <>
            <div className="two">
              <div className="card">
                <div className="grp" style={{marginTop:0}}>Ma távol ({d.absence.onLeaveToday.length})</div>
                {d.absence.onLeaveToday.length
                  ? d.absence.onLeaveToday.map(x=>(
                      <div className="trow" key={x.email}><div>{x.name}</div><div><span className={"pill "+(x.kind==="beteg"?"d":"w")}>{KIND[x.kind]}</span></div></div>))
                  : <div className="muted">Ma mindenki elérhető.</div>}
              </div>
              <div className="card">
                <div className="grp" style={{marginTop:0}}>Közelgő szabadságok (30 nap)</div>
                {d.absence.leaveUpcoming.length
                  ? d.absence.leaveUpcoming.slice(0,15).map((x,i)=>(
                      <div className="trow" key={i}><div>{x.name}<div className="tmeta">{KIND[x.kind]}</div></div><div className="tmeta">{x.date.slice(5)}</div></div>))
                  : <div className="muted">Nincs bejelentett szabadság.</div>}
              </div>
            </div>
            <div className="card">
              <div className="grp" style={{marginTop:0}}>Távollét összesítve</div>
              <table><thead><tr><th>Kolléga</th><th className="n">Szabadság</th><th className="n">Betegszabadság</th><th className="n">Kieső idő</th></tr></thead>
                <tbody>{d.people.map(x=>(
                  <tr key={x.email}><td>{x.name}</td>
                    <td className="n">{x.leaveDays||"–"}</td><td className="n">{x.sickDays||"–"}</td>
                    <td className="n"><b>{x.missingMin?fmt(x.missingMin):"–"}</b></td></tr>))}
                </tbody></table>
            </div>
            <div className="card">
              <div className="grp" style={{marginTop:0}}>Nem teljes munkanapok, indoklással</div>
              {d.absence.partialDays.length
                ? <table><thead><tr><th>Dátum</th><th>Kolléga</th><th className="n">Kieső idő</th><th>Indoklás</th></tr></thead>
                    <tbody>{d.absence.partialDays.map((x,i)=>(
                      <tr key={i}><td>{x.date}</td><td>{x.name}</td><td className="n">{fmt(x.missingMin)}</td><td>{x.reason||"—"}</td></tr>
                    ))}</tbody></table>
                : <div className="muted">Nincs az időszakban.</div>}
            </div>
          </>
        )}
      </>}
    </div>
  );
}

function LoadChart({ title, hint, tasks, prefix, open, setOpen }){
  const byUser={};
  tasks.forEach(t=>(t.assignees.length?t.assignees:["(nincs felelős)"]).forEach(n=>{ (byUser[n] ||= []).push(t); }));
  const rows=Object.entries(byUser).map(([n,list])=>[n,list]).sort((a,b)=>b[1].length-a[1].length);
  const max=rows.length?Math.max(...rows.map(r=>r[1].length)):1;
  return <div className="card">
    <div className="grp" style={{marginTop:0}}>{title}</div>
    {!rows.length ? <div className="muted">Nincs ilyen feladat.</div> :
      <div className="bars">{rows.map(([name,list])=>{
        const key=prefix+":"+name, isOpen=open===key;
        return <div key={name}>
          <div className="barrow clickrow" onClick={()=>setOpen(isOpen?null:key)} style={{cursor:"pointer"}}>
            <div className="barlabel" title={name}>{isOpen?"▾ ":"▸ "}{name}</div>
            <div className="bartrack"><div className="barfill" style={{width:Math.max(3,list.length/max*100)+"%"}}/></div>
            <div className="barval">{list.length} db</div>
          </div>
          {isOpen && <div style={{margin:"4px 0 10px 12px",borderLeft:"2px solid var(--beige)",paddingLeft:12}}>
            <TaskTable rows={list.slice().sort((a,b)=>a.dueDate-b.dueDate)} hideAssignee/>
          </div>}
        </div>;
      })}</div>}
    <div className="note">{hint}</div>
  </div>;
}

function TaskTable({ rows, hideAssignee }){
  if(!rows.length) return <div className="muted">Nincs feladat.</div>;
  return <table><thead><tr><th>Feladat</th><th>Ügyfél</th>{!hideAssignee&&<th>Felelős</th>}<th className="n">Határidő</th></tr></thead>
    <tbody>{rows.map(t=>(
      <tr key={t.id}>
        <td><a href={t.url} target="_blank" rel="noopener">{t.name}</a>
          {(t.priority==="urgent"||t.priority==="high") && <span className="pill u">{t.priority}</span>}</td>
        <td>{t.client}</td>
        {!hideAssignee&&<td>{t.assignees.join(", ")||"—"}</td>}
        <td className="n">{dstr(t.dueDate)}</td>
      </tr>))}
    </tbody></table>;
}
function avgPct(people){
  const v = people.filter(x=>x.pct!=null).map(x=>x.pct);
  if(!v.length) return "–";
  return (Math.round(v.reduce((a,b)=>a+b,0)/v.length*10)/10)+"%";
}
function pctColor(p){ if(p==null) return "var(--mut)"; return p>=85?"#1f9c74":p>=50?"#1b395d":"#b45309"; }
