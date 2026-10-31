import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { supabaseSchemas } from '../test-fixtures/supabase.mjs';

for (const installation of ['new', 'existing']) test(`real Postgres collaboration permissions and profile privacy: ${installation} database`, async () => {
  const db = await PGlite.create();
  try {
    await db.exec(supabaseSchemas);
    const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
    let preserved;
    if (installation === 'new') await db.exec(schema);
    else {
      await db.exec(schema.split('-- Event collaboration:')[0]);
      const user = (await db.query("insert into auth.users(id,email,raw_user_meta_data) values(gen_random_uuid(),'preservation@example.test','{\"name\":\"Existing owner\"}') returning id")).rows[0];
      const event = (await db.query("insert into public.shiftrescue_events(owner_id,name,event_date) values($1,'Existing saved event','2026-10-01') returning id", [user.id])).rows[0];
      await db.query("insert into public.shiftrescue_volunteers(event_id,id,name,skills,availability,max_hours,position) values($1,'existing-person','Existing volunteer','{}','[[600,720]]',2,0)", [event.id]);
      preserved = { userId: user.id, eventId: event.id };
      await db.exec(await readFile(new URL('../supabase/migrations/20261031150622_event_collaboration.sql', import.meta.url), 'utf8'));
      const result = await db.transaction(async tx => {
        await tx.exec('set local role authenticated;');
        await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)", [user.id, JSON.stringify({ sub: user.id, is_anonymous: false })]);
        return tx.query('select public.shiftrescue_load_event($1) as event, public.shiftrescue_event_sharing($1) as sharing', [event.id]);
      });
      assert.equal(result.rows[0].event.role, 'owner');
      assert.equal(result.rows[0].event.state.event, 'Existing saved event');
      assert.equal(result.rows[0].event.state.volunteers[0].name, 'Existing volunteer');
      assert.match(result.rows[0].sharing.code, /^[A-F0-9]{12}$/);
    }
    await db.exec('begin;');
    const results = await db.exec(await readFile(new URL('../test-fixtures/collaboration.sql', import.meta.url), 'utf8'));
    assert.match(results.at(-1).rows[0].result, /Owner, viewer, editor/);
    await db.exec('rollback;');
    assert.equal((await db.query('select count(*)::int as count from auth.users')).rows[0].count, preserved ? 1 : 0);
  } finally { await db.close(); }
});
