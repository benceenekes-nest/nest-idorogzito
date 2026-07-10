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
  ready = true;
}

// Egy kolléga egy napi lapját felülírja (újraküldhető)
export async function saveDay({ email, name, clickupId, date, rows, enteredBy=null }){
  await ensureSchema();
  await sql`DELETE FROM time_entries WHERE user_email=${email} AND work_date=${date}`;
  for(const r of rows){
    await sql`INSERT INTO time_entries
      (user_email,user_name,clickup_user_id,work_date,task_id,task_name,parent_id,parent_name,client,activity,minutes,entered_by)
      VALUES (${email},${name},${clickupId},${date},${r.taskId},${r.taskName||null},${r.parentId||null},${r.parentName||null},${r.client||null},${r.activity||null},${r.minutes},${enteredBy})`;
  }
  return rows.length;
}

export async function getDay({ email, date }){
  await ensureSchema();
  const { rows } = await sql`SELECT task_id, activity, minutes FROM time_entries
    WHERE user_email=${email} AND work_date=${date}`;
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
