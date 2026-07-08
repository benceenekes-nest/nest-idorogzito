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
  ready = true;
}

// Egy kolléga egy napi lapját felülírja (újraküldhető)
export async function saveDay({ email, name, clickupId, date, rows }){
  await ensureSchema();
  await sql`DELETE FROM time_entries WHERE user_email=${email} AND work_date=${date}`;
  for(const r of rows){
    await sql`INSERT INTO time_entries
      (user_email,user_name,clickup_user_id,work_date,task_id,task_name,parent_id,parent_name,client,activity,minutes)
      VALUES (${email},${name},${clickupId},${date},${r.taskId},${r.taskName||null},${r.parentId||null},${r.parentName||null},${r.client||null},${r.activity||null},${r.minutes})`;
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
