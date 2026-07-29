import { sql } from "@vercel/postgres";

let ready = false;
export async function ensureSchema(){
  if(ready) return;
  await sql`CREATE TABLE IF NOT EXISTS time_entries (
    id BIGSERIAL PRIMARY KEY,
    user_email TEXT NOT NULL,
    user_name TEXT,
    clickup_user_id TEXT,
    work_date DATE NOT NULL,
    task_id TEXT NOT NULL,
    task_name TEXT,
    parent_id TEXT,
    parent_name TEXT,
    client TEXT,
    activity TEXT,
    minutes INTEGER NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_te_user_date ON time_entries(user_email, work_date)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_te_date ON time_entries(work_date)`;
  await sql`CREATE TABLE IF NOT EXISTS work_days (
    user_email TEXT NOT NULL,
    work_date DATE NOT NULL,
    location TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_email, work_date)
  )`;
  await sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS entered_by TEXT`;
  await sql`ALTER TABLE work_days ADD COLUMN IF NOT EXISTS entered_by TEXT`;
  await sql`ALTER TABLE work_days ADD COLUMN IF NOT EXISTS partial BOOLEAN DEFAULT false`;
  await sql`ALTER TABLE work_days ADD COLUMN IF NOT EXISTS missing_minutes INTEGER DEFAULT 0`;
  await sql`ALTER TABLE work_days ADD COLUMN IF NOT EXISTS reason TEXT`;
  await sql`CREATE TABLE IF NOT EXISTS leave_days (
    user_email TEXT NOT NULL,
    leave_date DATE NOT NULL,
    kind TEXT NOT NULL,
    user_name TEXT,
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_email, leave_date)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ld_date ON leave_days(leave_date)`;
  await sql`CREATE TABLE IF NOT EXISTS task_due (
    task_id TEXT PRIMARY KEY,
    name TEXT,
    assignees TEXT,
    client TEXT,
    due_date DATE,
    first_due DATE,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS due_shifts (
    id BIGSERIAL PRIMARY KEY,
    task_id TEXT NOT NULL,
    name TEXT,
    assignees TEXT,
    client TEXT,
    old_due DATE,
    new_due DATE,
    day_diff INTEGER,
    changed_on DATE DEFAULT (now() AT TIME ZONE 'Europe/Budapest')::date,
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_shift_changed ON due_shifts(changed_on)`;
  ready = true;
}

// Napi teljes biztonsági mentés külön táblákba (naponta egy snapshot, előzmény megőrizve).
export async function backupAll(){
  await ensureSchema();
  await sql`CREATE TABLE IF NOT EXISTS time_entries_backup (
    snapshot_date DATE NOT NULL, backed_up_at TIMESTAMPTZ DEFAULT now(),
    user_email TEXT, user_name TEXT, clickup_user_id TEXT, work_date DATE, task_id TEXT, task_name TEXT,
    parent_id TEXT, parent_name TEXT, client TEXT, activity TEXT, minutes INTEGER, entered_by TEXT )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_teb_snap ON time_entries_backup(snapshot_date)`;
  await sql`CREATE TABLE IF NOT EXISTS work_days_backup (
    snapshot_date DATE NOT NULL, backed_up_at TIMESTAMPTZ DEFAULT now(),
    user_email TEXT, work_date DATE, location TEXT, partial BOOLEAN, missing_minutes INTEGER, reason TEXT, entered_by TEXT )`;
  await sql`CREATE TABLE IF NOT EXISTS leave_days_backup (
    snapshot_date DATE NOT NULL, backed_up_at TIMESTAMPTZ DEFAULT now(),
    user_email TEXT, leave_date DATE, kind TEXT, user_name TEXT )`;
  const today = (await sql`SELECT (now() AT TIME ZONE 'Europe/Budapest')::date AS d`).rows[0].d;
  await sql`DELETE FROM time_entries_backup WHERE snapshot_date=${today}`;
  await sql`DELETE FROM work_days_backup WHERE snapshot_date=${today}`;
  await sql`DELETE FROM leave_days_backup WHERE snapshot_date=${today}`;
  const te = await sql`INSERT INTO time_entries_backup
    (snapshot_date,user_email,user_name,clickup_user_id,work_date,task_id,task_name,parent_id,parent_name,client,activity,minutes,entered_by)
    SELECT ${today},user_email,user_name,clickup_user_id,work_date,task_id,task_name,parent_id,parent_name,client,activity,minutes,entered_by FROM time_entries`;
  const wd = await sql`INSERT INTO work_days_backup
    (snapshot_date,user_email,work_date,location,partial,missing_minutes,reason,entered_by)
    SELECT ${today},user_email,work_date,location,partial,missing_minutes,reason,entered_by FROM work_days`;
  const ld = await sql`INSERT INTO leave_days_backup
    (snapshot_date,user_email,leave_date,kind,user_name)
    SELECT ${today},user_email,leave_date,kind,user_name FROM leave_days`;
  return { date: today, timeEntries: te.rowCount, workDays: wd.rowCount, leaves: ld.rowCount };
}

// Teljes adatkiolvasás a Drive-mentéshez (minden tétel, munkanap, szabadság).
export async function dumpAll(){
  await ensureSchema();
  const te = (await sql`SELECT user_email,user_name,work_date,task_id,task_name,parent_id,parent_name,client,activity,minutes,entered_by,updated_at FROM time_entries ORDER BY work_date, user_email`).rows;
  const wd = (await sql`SELECT user_email,work_date,location,partial,missing_minutes,reason,entered_by,updated_at FROM work_days ORDER BY work_date, user_email`).rows;
  const ld = (await sql`SELECT user_email,leave_date,kind,user_name,updated_at FROM leave_days ORDER BY leave_date, user_email`).rows;
  return { time_entries: te, work_days: wd, leave_days: ld };
}

// Diagnosztika: egy munkanaphoz mi esett ki a mentés-pillanatképekhez képest.
export async function diagWorkDate(workDate){
  await ensureSchema();
  const snaps = (await sql`SELECT snapshot_date::text AS snapshot_date, user_email, COUNT(*)::int AS cnt, COALESCE(SUM(minutes),0)::int AS mins
    FROM time_entries_backup WHERE work_date=${workDate}
    GROUP BY snapshot_date, user_email ORDER BY snapshot_date, user_email`).rows;
  const live = (await sql`SELECT user_email, COUNT(*)::int AS cnt, COALESCE(SUM(minutes),0)::int AS mins
    FROM time_entries WHERE work_date=${workDate} GROUP BY user_email ORDER BY user_email`).rows;
  const fr = (await sql`SELECT MIN(snapshot_date)::text AS d FROM time_entries_backup WHERE work_date=${workDate}`).rows[0];
  const firstSnap = fr ? fr.d : null;
  let missing=[];
  if(firstSnap){
    missing = (await sql`SELECT b.user_email, b.task_id, b.task_name, b.activity, b.minutes
      FROM time_entries_backup b
      WHERE b.work_date=${workDate} AND b.snapshot_date=${firstSnap}
        AND NOT EXISTS (SELECT 1 FROM time_entries t
          WHERE t.user_email=b.user_email AND t.work_date=b.work_date AND t.task_id=b.task_id
            AND COALESCE(t.activity,'')=COALESCE(b.activity,'') AND t.minutes=b.minutes)
      ORDER BY b.user_email, b.task_id`).rows;
  }
  return { workDate, firstSnap, snapshotTotals:snaps, liveTotals:live, missingCount:missing.length, missing:missing.slice(0,200) };
}

// Visszaállítás: egy munkanap hiányzó tételeit pótolja egy mentés-pillanatképből.
// CSAK hozzáad (a meglévőt nem bántja), így nem duplikál és nem ír felül semmit.
export async function restoreWorkDate(workDate, snapshotDate, userEmail){
  await ensureSchema();
  const src = userEmail
    ? (await sql`SELECT user_email,user_name,clickup_user_id,work_date,task_id,task_name,parent_id,parent_name,client,activity,minutes,entered_by
        FROM time_entries_backup WHERE work_date=${workDate} AND snapshot_date=${snapshotDate} AND user_email=${userEmail}`).rows
    : (await sql`SELECT user_email,user_name,clickup_user_id,work_date,task_id,task_name,parent_id,parent_name,client,activity,minutes,entered_by
        FROM time_entries_backup WHERE work_date=${workDate} AND snapshot_date=${snapshotDate}`).rows;
  let restored=0; const added=[];
  for(const b of src){
    const ex = (await sql`SELECT 1 FROM time_entries WHERE user_email=${b.user_email} AND work_date=${b.work_date}
      AND task_id=${b.task_id} AND COALESCE(activity,'')=COALESCE(${b.activity||''},'') AND minutes=${b.minutes} LIMIT 1`).rows;
    if(ex.length) continue;
    await sql`INSERT INTO time_entries (user_email,user_name,clickup_user_id,work_date,task_id,task_name,parent_id,parent_name,client,activity,minutes,entered_by)
      VALUES (${b.user_email},${b.user_name},${b.clickup_user_id},${b.work_date},${b.task_id},${b.task_name},${b.parent_id},${b.parent_name},${b.client},${b.activity},${b.minutes},${b.entered_by})`;
    restored++; added.push({ user:b.user_email, task:b.task_name, activity:b.activity, minutes:b.minutes });
  }
  return { workDate, snapshotDate, userEmail:userEmail||null, restored, added:added.slice(0,300) };
}

// Lapozható tábla-export a Drive-mentéshez (web_fetch méretkorlát alatt tartva).
export async function dumpTable(table, offset=0, limit=400){
  await ensureSchema();
  offset = Math.max(0, offset|0); limit = Math.max(1, Math.min(2000, limit|0));
  if(table==="time_entries") return (await sql`SELECT user_email,user_name,work_date,task_id,task_name,parent_name,client,activity,minutes,entered_by FROM time_entries ORDER BY work_date, user_email, task_id OFFSET ${offset} LIMIT ${limit}`).rows;
  if(table==="work_days")  return (await sql`SELECT user_email,work_date,location,partial,missing_minutes,reason,entered_by FROM work_days ORDER BY work_date, user_email OFFSET ${offset} LIMIT ${limit}`).rows;
  if(table==="leave_days") return (await sql`SELECT user_email,leave_date,kind,user_name FROM leave_days ORDER BY leave_date, user_email OFFSET ${offset} LIMIT ${limit}`).rows;
  return null;
}
export const DUMP_COLS = {
  time_entries: ["user_email","user_name","work_date","task_id","task_name","parent_name","client","activity","minutes","entered_by"],
  work_days: ["user_email","work_date","location","partial","missing_minutes","reason","entered_by"],
  leave_days: ["user_email","leave_date","kind","user_name"],
};

// Egy kolléga egy napi lapját felülírja (újraküldhető).
// BOMBABIZTOS: kizárólag azoknak a feladatoknak a tételeit cseréljük, amelyeket a
// mentés ténylegesen tartalmaz (rows), plusz amit a felhasználó KIFEJEZETTEN
// törölt (removedIds). Bármely más feladat korábbi tételeit SOHA nem bántjuk,
// így egy újramentés fizikailag nem tud kiütni be nem küldött tételt.
export async function saveDay({ email, name, clickupId, date, rows, enteredBy=null, removedIds=null }){
  await ensureSchema();
  const submitted = [...new Set(rows.map(r=>String(r.taskId)))];
  const cleared = Array.isArray(removedIds) ? removedIds.map(String) : [];
  const toDelete = [...new Set([...submitted, ...cleared])];
  for(const id of toDelete){
    await sql`DELETE FROM time_entries WHERE user_email=${email} AND work_date=${date} AND task_id=${id}`;
  }
  for(const r of rows){
    await sql`INSERT INTO time_entries
      (user_email,user_name,clickup_user_id,work_date,task_id,task_name,parent_id,parent_name,client,activity,minutes,entered_by)
      VALUES (${email},${name},${clickupId},${date},${r.taskId},${r.taskName||null},${r.parentId||null},${r.parentName||null},${r.client||null},${r.activity||null},${r.minutes},${enteredBy})`;
  }
  return rows.length;
}

export async function getDay({ email, date }){
  await ensureSchema();
  const { rows } = await sql`SELECT task_id, task_name, parent_id, parent_name, client, activity, minutes
    FROM time_entries WHERE user_email=${email} AND work_date=${date}`;
  return rows;
}

export async function getRange({ email, from, to, all=false }){
  await ensureSchema();
  if(all){
    const { rows } = await sql`SELECT * FROM time_entries WHERE work_date BETWEEN ${from} AND ${to} ORDER BY work_date`;
    return rows;
  }
  const { rows } = await sql`SELECT * FROM time_entries WHERE user_email=${email} AND work_date BETWEEN ${from} AND ${to} ORDER BY work_date`;
  return rows;
}

// Napi lap fejadatai: hely + nem teljes munkanap (kieső idő + indoklás)
export async function saveDayMeta({ email, date, location, partial=false, missingMinutes=0, reason=null, enteredBy=null }){
  await ensureSchema();
  if(!location) return null;
  const p = !!partial;
  const mm = p ? Math.max(0, Math.min(480, Number(missingMinutes)||0)) : 0;
  const rs = p ? (reason||null) : null;
  await sql`INSERT INTO work_days (user_email, work_date, location, partial, missing_minutes, reason, entered_by)
    VALUES (${email}, ${date}, ${location}, ${p}, ${mm}, ${rs}, ${enteredBy})
    ON CONFLICT (user_email, work_date)
    DO UPDATE SET location = EXCLUDED.location, partial = EXCLUDED.partial,
      missing_minutes = EXCLUDED.missing_minutes, reason = EXCLUDED.reason,
      entered_by = EXCLUDED.entered_by, updated_at = now()`;
  return location;
}

export async function getDayMeta({ email, date }){
  await ensureSchema();
  const { rows } = await sql`SELECT location, partial, missing_minutes, reason
    FROM work_days WHERE user_email=${email} AND work_date=${date}`;
  if(!rows[0]) return null;
  const r = rows[0];
  return { location:r.location, partial:!!r.partial, missingMinutes:Number(r.missing_minutes)||0,
    reason:r.reason||"" };
}

export async function getWorkDaysRange({ email, from, to, all=false }){
  await ensureSchema();
  if(all){
    const { rows } = await sql`SELECT user_email, work_date, location, partial, missing_minutes, reason
      FROM work_days WHERE work_date BETWEEN ${from} AND ${to} ORDER BY work_date`;
    return rows;
  }
  const { rows } = await sql`SELECT user_email, work_date, location, partial, missing_minutes, reason
    FROM work_days WHERE user_email=${email} AND work_date BETWEEN ${from} AND ${to} ORDER BY work_date`;
  return rows;
}

// ── Szabadság / betegszabadság ────────────────────────────────
// kind: "szabadsag" | "beteg" | null (= törlés)
export async function setLeave({ email, name, date, kind }){
  await ensureSchema();
  if(!kind){
    await sql`DELETE FROM leave_days WHERE user_email=${email} AND leave_date=${date}`;
    return null;
  }
  await sql`INSERT INTO leave_days (user_email, leave_date, kind, user_name)
    VALUES (${email}, ${date}, ${kind}, ${name||null})
    ON CONFLICT (user_email, leave_date)
    DO UPDATE SET kind = EXCLUDED.kind, user_name = EXCLUDED.user_name, updated_at = now()`;
  return kind;
}

export async function getLeaves({ email, from, to, all=false }){
  await ensureSchema();
  if(all){
    const { rows } = await sql`SELECT user_email, user_name, leave_date, kind FROM leave_days
      WHERE leave_date BETWEEN ${from} AND ${to} ORDER BY leave_date`;
    return rows;
  }
  const { rows } = await sql`SELECT user_email, user_name, leave_date, kind FROM leave_days
    WHERE user_email=${email} AND leave_date BETWEEN ${from} AND ${to} ORDER BY leave_date`;
  return rows;
}

// Egy adott nap meglévő bejegyzése (zároltság ellenőrzéshez)
export async function getLeaveOne({ email, date }){
  await ensureSchema();
  const { rows } = await sql`SELECT kind FROM leave_days WHERE user_email=${email} AND leave_date=${date}`;
  return rows[0] ? rows[0].kind : null;
}

// ── Határidő-pillanatkép és csúszásnapló ─────────────────────
// tasks: [{id, name, assignees:[nevek], client, dueDate(ms|null)}]
export async function snapshotDueDates(tasks){
  await ensureSchema();
  const d2 = ms => ms ? new Date(Number(ms)).toISOString().slice(0,10) : null;
  const { rows: prev } = await sql`SELECT task_id, due_date, first_due FROM task_due`;
  const prevMap = {}; prev.forEach(r=>{ prevMap[r.task_id] = {
    due: r.due_date ? (r.due_date instanceof Date ? r.due_date.toISOString().slice(0,10) : String(r.due_date).slice(0,10)) : null,
    first: r.first_due ? (r.first_due instanceof Date ? r.first_due.toISOString().slice(0,10) : String(r.first_due).slice(0,10)) : null }; });
  let shifts = 0;
  for(const t of tasks){
    const due = d2(t.dueDate);
    const names = (t.assignees||[]).join(", ") || null;
    const before = prevMap[t.id];
    if(before && before.due && due && before.due !== due){
      const diff = Math.round((new Date(due)-new Date(before.due))/864e5);
      await sql`INSERT INTO due_shifts (task_id,name,assignees,client,old_due,new_due,day_diff)
        VALUES (${t.id},${t.name||null},${names},${t.client||null},${before.due},${due},${diff})`;
      shifts++;
    }
    const firstDue = before?.first || due;
    await sql`INSERT INTO task_due (task_id,name,assignees,client,due_date,first_due,updated_at)
      VALUES (${t.id},${t.name||null},${names},${t.client||null},${due},${firstDue},now())
      ON CONFLICT (task_id) DO UPDATE SET name=EXCLUDED.name, assignees=EXCLUDED.assignees,
        client=EXCLUDED.client, due_date=EXCLUDED.due_date, updated_at=now()`;
  }
  return shifts;
}

export async function getDueShifts({ limit=100 }={}){
  await ensureSchema();
  const { rows } = await sql`SELECT task_id, name, assignees, client, old_due, new_due, day_diff, changed_on
    FROM due_shifts ORDER BY changed_on DESC, id DESC LIMIT ${limit}`;
  const d = v => v ? (v instanceof Date ? v.toISOString().slice(0,10) : String(v).slice(0,10)) : null;
  return rows.map(r=>({ taskId:r.task_id, name:r.name, assignees:r.assignees, client:r.client,
    oldDue:d(r.old_due), newDue:d(r.new_due), dayDiff:Number(r.day_diff), changedOn:d(r.changed_on) }));
}
