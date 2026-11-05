import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
process.on('uncaughtException', error => {
 console.error('Role integration failure:', error.message, error.code || '', error.where || '', error.position || '', error.query?.slice(Math.max(0, Number(error.position || 1)-100), Number(error.position || 1)+100))
 process.exit(1)
})
const db = new PGlite()
const fixture = JSON.parse(readFileSync(new URL('../fixtures/role-schema.json', import.meta.url), 'utf8'))
const quote = value => '"' + value.replaceAll('"','""') + '"'
await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth; CREATE SCHEMA storage;
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (auth.jwt()->>'sub')::uuid $$;
 GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,owner_id text,name text);
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 CREATE POLICY fixture_storage ON storage.objects FOR ALL TO public USING(true) WITH CHECK(true);
 GRANT ALL ON storage.objects TO authenticated;
`)
for (const {table_name,columns} of fixture.tables) {
 if (['safe_app_users','registration_requests_admin_view','supplier_stats'].includes(table_name)) continue
 const cols = columns.map(c => {
  let type = c.type === 'ARRAY' ? 'text[]' : c.type === 'USER-DEFINED' ? 'text' : c.type
  let tail = c.name === 'id' && ['uuid','text'].includes(type)
   ? ' PRIMARY KEY DEFAULT gen_random_uuid()' + (type === 'text' ? '::text' : '') : ''
  if (table_name==='budget_plans' && c.name==='remaining_amount') tail=' GENERATED ALWAYS AS (allocated_amount-spent_amount) STORED'
  return quote(c.name)+' '+type+tail
 })
 await db.exec('CREATE TABLE public.'+quote(table_name)+'('+cols.join(',')+'); ALTER TABLE public.'+quote(table_name)+' ENABLE ROW LEVEL SECURITY; CREATE POLICY fixture_permissive ON public.'+quote(table_name)+' FOR ALL TO authenticated USING(true) WITH CHECK(true);')
}
await db.exec(`CREATE VIEW public.safe_app_users AS SELECT id,username FROM public.app_users;
 CREATE VIEW public.registration_requests_admin_view AS SELECT id FROM public.registration_requests;
 CREATE VIEW public.supplier_stats AS SELECT id,name FROM public.suppliers;
 CREATE FUNCTION public.normalize_arabic_name(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT lower(trim($1)) $$;
 CREATE UNIQUE INDEX fixture_movement_fingerprint ON public.movements(fingerprint);
 CREATE UNIQUE INDEX fixture_supplier_name ON public.suppliers(name_key);
 GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated,anon;`)
for (const f of fixture.functions) await db.exec(f.definition.trim().replace(/;?$/, ';'))
const migrationsDir = new URL('../../supabase/migrations/', import.meta.url)
const roleMigrations = readdirSync(migrationsDir).filter(name => /_(department_role_matrix|role_authority_freshness)\.sql$/.test(name)).sort()
const migrationPaths = process.argv.slice(2).length ? process.argv.slice(2) : roleMigrations.map(name => new URL(name, migrationsDir))
if (!migrationPaths.length) throw new Error('Pass the role migration paths')
for (const path of migrationPaths) await db.exec(readFileSync(path,'utf8'))
const roles=['system_admin','admin','warehouse_admin','procurement_admin','warehouse_employee','procurement_employee','warehouse_staff','purchasing_staff','editor','viewer']
const readWh=new Set(['system_admin','admin','warehouse_admin','warehouse_employee','warehouse_staff','editor','viewer'])
const readPc=new Set(['system_admin','admin','procurement_admin','procurement_employee','purchasing_staff','viewer'])
const addWh=new Set(['system_admin','warehouse_employee','warehouse_staff','editor'])
const addPc=new Set(['system_admin','procurement_employee','purchasing_staff'])
const uid=i=>'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0')
for (let i=0;i<roles.length;i++) await db.query("INSERT INTO public.app_users(id,username,role,status,auth_user_id,created_at) VALUES($1,$1,$2,'active',$3,now())",['fixture-'+roles[i],roles[i],uid(i)])
await db.exec(`INSERT INTO public.custody_items(id,warehouse_id,name,quantity,value,unit_price) VALUES('existing','main','Fixture item',30,60,2);
 INSERT INTO public.suppliers(name) VALUES('fixture supplier');
 INSERT INTO public.movements(item,kind,qty_in,qty_out,fingerprint) VALUES('receipt','purchase','2','0','foreign-receipt'),('issue','issue','0','1','foreign-issue');`)
let assertions=0
async function check(value,expected,message){assert.equal(value,expected,message);assertions++}
async function denied(query,params=[]){
 await db.exec('SAVEPOINT operation_test')
 let denied=false
 try { await db.query(query,params) } catch(e) { if(e.code==='42501')denied=true;else throw e }
 await db.exec('ROLLBACK TO SAVEPOINT operation_test; RELEASE SAVEPOINT operation_test')
 return denied
}
for(let i=0;i<roles.length;i++){
 const role=roles[i], sys=role==='system_admin'
 await db.exec('BEGIN')
 await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid(i),app_metadata:{role,system_admin:sys,permissions:['manage_records','view_settings','view_audit']}})])
 await db.exec('SET LOCAL ROLE authenticated')
 await check((await db.query("SELECT count(*)::int n FROM public.custody_items")).rows[0].n,readWh.has(role)?1:0,role+' warehouse read')
 await check((await db.query("SELECT count(*)::int n FROM public.suppliers")).rows[0].n,readPc.has(role)?1:0,role+' procurement read')
 await check(await denied("INSERT INTO public.custody_items(id,name) VALUES('new-row','New')"),!addWh.has(role),role+' warehouse add')
 await check(await denied("INSERT INTO public.suppliers(name) VALUES('New')"),!addPc.has(role),role+' procurement add')
 await check((await db.query("UPDATE public.custody_items SET quantity=999 RETURNING id")).rows.length,sys?1:0,role+' update denied')
 await check((await db.query("DELETE FROM public.suppliers RETURNING id")).rows.length,sys?1:0,role+' delete denied')
 await check((await db.query("SELECT count(*)::int n FROM public.app_users")).rows[0].n,sys?roles.length:1,role+' cannot list others')
 await check((await db.query("SELECT count(*)::int n FROM public.registration_requests_admin_view")).rows[0].n,0,role+' registration view')
 await check(await denied("SELECT public.record_purchase('test','Receipt',1,2)"),!addPc.has(role),role+' purchase command')
 await check(await denied("SELECT public.record_warehouse_issue($1::jsonb)",[JSON.stringify({item:'Fixture item',qty_out:1,qty_in:'0',fingerprint:'test-issue',source_warehouse_id:'main',dest_type:'custodian',recipient:'Recipient'})]),!addWh.has(role),role+' issue command')
 await check(await denied("INSERT INTO public.support_tickets(user_id,status) VALUES(auth.uid(),'مفتوحة')"),!(addWh.has(role)||addPc.has(role)),role+' support creation uses real Arabic status')
 if(!sys) {
  await check(await denied("INSERT INTO public.purchase_requests(status,created_by_id) VALUES('approved',auth.uid())"),true,role+' cannot forge initial approval')
  await check(await denied("INSERT INTO public.disbursement_requests(status,created_by) VALUES('approved',auth.uid())"),true,role+' cannot forge disbursement approval')
 }
 if(addWh.has(role)) {
  await check(await denied("SELECT public.record_warehouse_issue($1::jsonb)",[JSON.stringify({item:'Fixture item',qty_out:1,fingerprint:'foreign-receipt'})]),true,role+' cannot disclose a purchase by fingerprint')
  await db.query("SELECT public.record_warehouse_issue($1::jsonb)",[JSON.stringify({item:'Fixture item',qty_out:2,fingerprint:'transfer-proof',source_warehouse_id:'main',source_custody_id:'existing',dest_type:'warehouse',dest_warehouse_id:'medicine'})])
  await db.exec('RESET ROLE')
  await check(Number((await db.query("SELECT sum(quantity) n FROM public.custody_items")).rows[0].n),sys?999:30,role+' transfer conserves total stock')
  await db.exec('SET LOCAL ROLE authenticated')
 }
 const beforeStorage = await denied("INSERT INTO storage.objects(bucket_id,name) VALUES('procurement-attachments','test.pdf')")
 await check(beforeStorage,!addPc.has(role),role+' attachment upload follows create permission')
 if(!sys) await check(await denied("SELECT public.submit_purchase_request(gen_random_uuid())"),true,role+' cannot submit/edit existing draft')
 await db.exec('ROLLBACK')
}
await db.exec('BEGIN; SET LOCAL ROLE anon')
await check(await denied("SELECT * FROM public.custody_items"),true,'anonymous inventory denied')
await db.exec('ROLLBACK')
// A stale JWT cannot keep a suspended profile authorized.
await db.query("UPDATE public.app_users SET status='suspended' WHERE auth_user_id=$1",[uid(4)])
await db.exec('BEGIN')
await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid(4),app_metadata:{role:'warehouse_employee'}})])
await db.exec('SET LOCAL ROLE authenticated')
await check((await db.query('SELECT count(*)::int n FROM public.custody_items')).rows[0].n,0,'suspended profile read denied')
await check(await denied("INSERT INTO public.custody_items(name) VALUES('stale token')"),true,'suspended profile create denied')
await db.exec('ROLLBACK')
// A demoted administrator's old system-admin claim cannot override its current role.
await db.exec('BEGIN')
await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid(1),app_metadata:{role:'system_admin',system_admin:true}})])
await db.exec('SET LOCAL ROLE authenticated')
await check((await db.query('SELECT public.app_effective_role() r')).rows[0].r,'admin','current database role overrides stale elevated JWT')
await check((await db.query('SELECT public.app_can_modify_records() allowed')).rows[0].allowed,false,'demoted system administrator cannot mutate')
await db.exec('ROLLBACK')
console.log('PostgreSQL role integration checks passed: '+assertions+' assertions, '+roles.length+' roles; in-memory database only.')
await db.close()

