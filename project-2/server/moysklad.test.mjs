import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleMoySklad } from './moysklad.mjs';
import {encoder,key,b64} from './security.mjs';
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const employee=uid(1),org=uid(2),store=uid(3),priceType=uid(4),usd=uid(5),uzs=uid(6),product=uid(7),client=uid(8),account=uid(99);
const BASE='https://api.moysklad.ru/api/remap/1.2';
const reference=(type,id)=>({id,meta:{type,href:`${BASE}/entity/${type}/${id}`}});
let created=[],calls=[],price=480,stock=20,archived=false,permission=true,transportFault=null,cdnRedirect=false,cdnRequests=0,unexpectedOrderRows=null,catalogQueries=[];
const orderFixtures=Array.from({length:205},(_,i)=>({id:uid(1000+i),syncId:uid(5000+i),externalCode:'comfort-'+uid(5000+i),name:'ORDER-'+i,description:i===204?'unique-search-comment':'',sum:1000,rate:{currency:{isoCode:'USD'}},agent:{name:'Customer'},owner:reference('employee',employee),store:reference('store',uid(60+i%2)),organization:reference('organization',uid(70+i%2)),positions:{rows:[]}}));
const foreignOrders=[{...orderFixtures[0],id:uid(2000),name:'READER-ORDER',owner:reference('employee',uid(10))},{...orderFixtures[1],id:uid(2001),name:'OTHER-ORDER',owner:reference('employee',uid(11))}];
const outsideOrders=[{...orderFixtures[0],id:uid(3000),name:'MANUAL-ORDER',syncId:uid(4000),externalCode:'manual-order'},{...orderFixtures[1],id:uid(3001),name:'OTHER-INTERFACE',syncId:uid(4001),externalCode:'shop-'+uid(4001)}];
const invalidMarkers=[{...orderFixtures[0],id:uid(3100),externalCode:'comfort-'+uid(9999)},{...orderFixtures[0],id:uid(3101),syncId:'invalid',externalCode:'comfort-invalid'},{...orderFixtures[0],id:uid(3102),syncId:undefined}];
const createdOrderRows=()=>created.map(x=>({id:uid(20),name:'00020',description:x.description,sum:960,rate:{currency:{isoCode:'USD'}},agent:{name:'Customer'},owner:reference('employee',employee),syncId:x.syncId,externalCode:x.externalCode}));
const objects=new Map(),sqlite=new DatabaseSync(':memory:');
sqlite.exec(readFileSync(new URL('../drizzle/0000_abandoned_leo.sql',import.meta.url),'utf8'));
const statement=(sql,values=[])=>({bind(...args){return statement(sql,args)},async first(){return sqlite.prepare(sql).get(...values)||null},async run(){return sqlite.prepare(sql).run(...values)},execute(){return {results:sql.includes('RETURNING')?sqlite.prepare(sql).all(...values):(sqlite.prepare(sql).run(...values),[])}}});
const env={MOYSKLAD_ACCOUNT_ID:account,CONNECTION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64url'),DB:{prepare:statement,async batch(statements){sqlite.exec('BEGIN');try{const result=statements.map(s=>s.execute());sqlite.exec('COMMIT');return result}catch(error){sqlite.exec('ROLLBACK');throw error}}},BUCKET:{async get(k){const v=objects.get(k);return v?{json:async()=>JSON.parse(v)}:null},async put(k,v){objects.set(k,v)},async delete(k){objects.delete(k)}}};
globalThis.fetch=async(input,init={})=>{
 assert.equal(init.redirect,'manual','Use the workerd-compatible mode without forwarding credentials');
 if(new URL(input).hostname==='images.moysklad.ru'){
  cdnRequests++;assert.equal(init.headers?.Authorization,undefined,'Image CDN must not receive employee credentials');
  return cdnRedirect?new Response(null,{status:302,headers:{Location:'https://unexpected.test/image.png'}}):new Response('image bytes',{headers:{'Content-Type':'image/png'}});
 }
 const url=new URL(input),path=url.pathname.replace('/api/remap/1.2',''),authorization=init.headers.Authorization;
 assert.equal(url.origin,'https://api.moysklad.ru');
 assert.match(authorization,/^Basic /);assert.ok(!authorization.includes('Bearer'));
 const credentials=Buffer.from(authorization.slice(6),'base64').toString('utf8');
 const login=credentials.split(':')[0],currentEmployee=login==='reader@company'?uid(10):employee;
 calls.push({path,method:init.method,employee:currentEmployee});let result;
 if(transportFault instanceof Error)throw transportFault;
 if(typeof transportFault==='number')return new Response(null,{status:transportFault,headers:{Location:'https://unexpected.test/credentials'}});
 if(!['owner@company:secret-owner','reader@company:secret-reader','outsider@company:secret-outside'].includes(credentials))return Response.json({errors:[{error:'Authentication failed'}]},{status:401});
 if(path==='/context/employee')result={...reference('employee',currentEmployee),name:'Test Employee',uid:login,accountId:login==='outsider@company'?uid(100):account,archived,permissions:{customerorder:{create:login==='reader@company'||!permission?'NONE':'ALL'},counterparty:{create:login==='reader@company'?'NONE':'ALL'}}};
 else if(path==='/entity/organization')result={rows:[{id:org,name:'Organization'}]};
 else if(path==='/entity/productfolder')result={rows:[{id:uid(80),name:'Fabric',pathName:''},{id:uid(81),name:'Accessories',pathName:''},{id:uid(82),name:'Archived',archived:true}]};
 else if(path==='/entity/store')result={rows:[{id:store,name:'Warehouse'}]};
 else if(path==='/context/companysettings/pricetype')result=[{id:priceType,name:'Retail'}];
 else if(path==='/entity/currency')result={rows:[{...reference('currency',usd),isoCode:'USD',rate:12800,multiplicity:1},{...reference('currency',uzs),isoCode:'UZS',rate:1,multiplicity:1,default:true}]};
 else if(path==='/entity/customerorder/metadata')result={states:[]};
 else if(path==='/entity/counterparty/'+client)result={id:client,name:'Customer'};
 else if(path===`/entity/product/${product}/images`)result={rows:[{miniature:{href:BASE+'/download/test-image'}}]};
 else if(path==='/download/test-image')return new Response(null,{status:302,headers:{Location:'https://images.moysklad.ru/image.png'}});
 else if(path==='/entity/assortment'){const filter=url.searchParams.get('filter');catalogQueries.push({filter,search:url.searchParams.get('search'),offset:url.searchParams.get('offset')});assert.ok(!filter.includes('stockStore='),'Catalogue, quote and draft hydration must use aggregate stock');result={rows:[{...reference('product',product),name:'Product',code:'00001',productFolder:reference('productfolder',filter.includes(uid(81))?uid(81):uid(80)),pathName:filter.includes(uid(81))?'Accessories':'Fabric',stock,reserve:2,uom:{name:'м'},salePrices:[{value:price,currency:reference('currency',usd),priceType:{id:priceType}}]}]};}
 else if(path==='/entity/customerorder'&&init.method==='POST'){const body=JSON.parse(init.body);assert.equal(currentEmployee,employee);assert.ok(!Object.hasOwn(body,'store'),'Never pass a warehouse to a new order');created.push(body);result=createdOrderRows().at(-1);}
 else if(path==='/entity/customerorder'){
  if(url.searchParams.get('filter')?.startsWith('syncId=')){assert.match(url.searchParams.get('filter'),/^syncId=/);result={rows:[...createdOrderRows(),...outsideOrders,...foreignOrders].filter(x=>url.searchParams.get('filter')===`syncId=${x.syncId}`)};}
  else{assert.equal(url.searchParams.get('filter'),`owner=${BASE}/entity/employee/${currentEmployee};externalCode~=comfort-`);assert.equal(url.searchParams.get('limit'),'100');assert.equal(url.searchParams.get('order'),'moment,desc');const search=url.searchParams.get('search')||'',offset=Number(url.searchParams.get('offset'));const visible=(login==='reader@company'?[orderFixtures[0],foreignOrders[0]]:[...orderFixtures,...foreignOrders,...outsideOrders,...createdOrderRows()]).filter(o=>o.owner.id===currentEmployee&&o.externalCode?.startsWith('comfort-')).filter(o=>!search||o.name.includes(search)||o.description.includes(search));result={meta:{size:visible.length,...(offset+100<visible.length?{nextHref:BASE+'/entity/customerorder?offset='+(offset+100)}:{})},rows:visible.slice(offset,offset+100)};if(unexpectedOrderRows)result={meta:{size:101,nextHref:BASE+"/entity/customerorder?offset=100"},rows:unexpectedOrderRows};}
 }
 else if(path.startsWith('/entity/customerorder/')){const found=[...orderFixtures,...foreignOrders,...outsideOrders,...invalidMarkers,...createdOrderRows()].find(o=>o.id===path.split('/').at(-1));if(!found)return Response.json({errors:[{error:'Not found'}]},{status:404});if(login==='reader@company'&&![orderFixtures[0].id,foreignOrders[0].id].includes(found.id))return Response.json({errors:[{error:'Forbidden'}]},{status:403});result=found;}
 else throw new Error('Unexpected provider request '+path);
 return Response.json(result);
};
let cookie='';
async function request(path,body,options={}){
 const headers={cookie:options.cookie??cookie,...options.headers};
 if(body!==undefined){headers['content-type']='application/json';headers.origin=options.origin||'https://site.test';}
 const response=await handleMoySklad(new Request('https://site.test/api/moysklad'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)}),env);
 return {status:response.status,data:await response.json(),headers:response.headers};
}
async function login(name='owner@company',password='secret-owner'){const result=await request('/login',{login:name,password});if(result.status===200)cookie=result.headers.get('set-cookie').split(';')[0];return result;}
assert.equal((await request('/status')).data.authorized,false);
assert.equal((await request('/groups')).status,401);assert.equal((await request('/catalog')).status,401);assert.equal((await request('/orders')).status,401);assert.equal((await request('/order?id='+orderFixtures[0].id)).status,401);
assert.equal((await request('/catalog',undefined,{headers:{'oai-authenticated-user-id':'fake','oai-authenticated-user-email':'owner@example.test'}})).status,401);
assert.equal((await request('/login',{login:'owner@company',password:'secret-owner'},{origin:'https://evil.test'})).status,403);assert.equal(calls.length,0);
assert.equal((await login('outsider@company','secret-outside')).status,403);assert.equal(sqlite.prepare('SELECT count(*) n FROM employee_sessions').get().n,0);
archived=true;assert.equal((await login()).status,403);archived=false;
assert.equal((await login('owner@company','incorrect')).status,401);
for(const status of [301,302,303,307,308]){
 transportFault=status;const before=calls.length,result=await login('transport@company','incorrect');
 assert.equal(result.status,502);assert.equal(result.data.error.code,'upstream_redirect');assert.equal(calls.length,before+1);
}
transportFault=new TypeError('Network failure');let transportResult=await login('transport@company','incorrect');assert.equal(transportResult.status,502);assert.equal(transportResult.data.error.code,'upstream_unavailable');
transportFault=new DOMException('Timed out','TimeoutError');transportResult=await login('transport@company','incorrect');assert.equal(transportResult.status,504);assert.equal(transportResult.data.error.code,'upstream_timeout');
transportFault=null;
const signed=await login();assert.equal(signed.status,200);assert.match(signed.headers.get('set-cookie'),/Secure; HttpOnly; SameSite=Strict; Max-Age=7200/);
const encrypted=sqlite.prepare('SELECT secret FROM employee_sessions').get().secret;assert.ok(!encrypted.includes('secret-owner'));assert.ok(!encrypted.includes(Buffer.from('owner@company:secret-owner').toString('base64')));assert.ok(!JSON.stringify(signed.data).includes('secret-owner'));
assert.equal((await request('/status')).data.employee.id,employee);assert.equal((await request('/status')).data.configured,false);
const browseBeforeSetup=await request('/catalog');assert.equal(browseBeforeSetup.status,200);assert.equal(browseBeforeSetup.data.rows.length,1);assert.equal(browseBeforeSetup.data.rows[0].price,null);assert.equal(browseBeforeSetup.data.rows[0].priceAvailable,false);assert.equal(browseBeforeSetup.data.stockScope,'all');assert.equal(browseBeforeSetup.data.pricingReady,false);assert.ok(!catalogQueries.at(-1).filter.includes('stockStore='));assert.equal(browseBeforeSetup.data.rows[0].category,uid(80));
const allGroups=await request('/groups');assert.equal(allGroups.status,200);assert.equal(allGroups.data.rows.length,2);assert.ok(allGroups.data.rows.some(g=>g.id===uid(81)));
const groupCatalog=await request('/catalog?category='+uid(81)+'&search=barcode&offset=100&available=true');assert.equal(groupCatalog.status,200);assert.equal(groupCatalog.data.rows[0].category,uid(81));assert.ok(catalogQueries.at(-1).filter.includes('productFolder='+BASE+'/entity/productfolder/'+uid(81)));assert.ok(catalogQueries.at(-1).filter.includes('stockMode=positiveOnly'));assert.equal(catalogQueries.at(-1).search,'barcode');assert.equal(catalogQueries.at(-1).offset,'100');
assert.equal((await request('/catalog?category=invalid')).status,400);assert.equal((await request('/catalog?offset=-1')).status,400);assert.equal((await request('/quote',{clientId:client,items:[{id:product,qty:2}]})).data.error.code,'setup_required');
const firstPage=await request('/orders');assert.equal(firstPage.status,200);assert.equal(firstPage.data.rows.length,100);assert.equal(firstPage.data.total,205);assert.equal(firstPage.data.next,100);
const secondPage=await request('/orders?offset=100');assert.equal(secondPage.data.rows.length,100);assert.equal(secondPage.data.next,200);assert.notEqual(firstPage.data.rows[0].id,secondPage.data.rows[0].id);
const lastPage=await request('/orders?offset=200');assert.equal(lastPage.data.rows.length,5);assert.equal(lastPage.data.next,null);assert.equal(lastPage.data.hasMore,false);
const orderSearch=await request('/orders?search=unique-search-comment');assert.equal(orderSearch.data.rows.length,1);assert.equal(orderSearch.data.rows[0].id,uid(1204));
assert.equal((await request('/orders?offset=-1')).status,400);assert.equal((await request('/orders?offset=1.5')).status,400);
assert.equal((await request('/order?id='+orderFixtures[0].id)).status,200);
assert.equal((await request('/order?id='+foreignOrders[0].id)).data.error.code,'order_forbidden');assert.equal((await request('/orders?search=READER-ORDER')).data.rows.length,0);assert.equal((await request('/orders?owner='+uid(10)+'&filter=owner%3Dother')).data.total,205);
for(const order of [...outsideOrders,...invalidMarkers]){const denied=await request('/order?id='+order.id);assert.equal(denied.status,403);assert.equal(denied.data.error.code,'order_forbidden');assert.ok(!JSON.stringify(denied.data).includes(order.name));}
assert.equal((await request('/orders?search=MANUAL-ORDER')).data.rows.length,0);
assert.equal((await request('/orders?search=OTHER-INTERFACE')).data.rows.length,0);
assert.equal((await request('/orders?externalCode=manual-order&source=all&filter=externalCode%3Dmanual-order')).data.total,205);
unexpectedOrderRows=Array.from({length:100},(_,i)=>[...outsideOrders,...invalidMarkers,...foreignOrders][i%7]);
const skippedPage=await request('/orders');assert.equal(skippedPage.data.rows.length,0);assert.equal(skippedPage.data.next,100);
unexpectedOrderRows=null;
// Previously saved warehouse settings must not constrain catalogue or restored draft items.
const preferencesKey='moysklad/preferences-'+account+'-'+employee+'.json';
objects.set(preferencesKey,JSON.stringify({settings:{organizationId:org,storeId:store,storeName:'Old warehouse',priceTypeId:priceType},revision:'legacy'}));
const legacyStatus=await request('/status');assert.equal(legacyStatus.data.configured,true);assert.ok(!Object.hasOwn(legacyStatus.data.settings,'storeId'));assert.ok(!Object.hasOwn(legacyStatus.data.settings,'storeName'));
const legacyCatalog=await request('/catalog?storeId='+store+'&stockStore='+store);assert.equal(legacyCatalog.data.stockScope,'all');assert.equal(legacyCatalog.data.rows[0].free,18);
const restoredItems=await request('/items',{ids:[product],storeId:store});assert.equal(restoredItems.status,200);assert.equal(restoredItems.data.rows[0].free,18);
const setupResult=await request('/setup');assert.equal(setupResult.status,200);assert.ok(!Object.hasOwn(setupResult.data,'stores'));assert.ok(!calls.some(c=>c.path==='/entity/store'));
objects.set(preferencesKey,JSON.stringify({settings:{organizationId:org,storeId:store},revision:'partial'}));assert.equal((await request('/status')).data.configured,false);
assert.equal((await request('/settings',{organizationId:uid(404),priceTypeId:priceType})).status,400);
assert.equal((await request('/settings',{organizationId:org,priceTypeId:uid(404)})).status,400);
// Warehouse values from an older open tab or a crafted request are ignored.
const ignoredWarehouse=await request('/settings',{organizationId:org,storeId:uid(404),priceTypeId:priceType});assert.equal(ignoredWarehouse.status,200);assert.ok(!Object.hasOwn(ignoredWarehouse.data.settings,'storeId'));assert.ok(!JSON.parse(objects.get(preferencesKey)).settings.storeId);
assert.equal((await request('/settings',{organizationId:org,priceTypeId:priceType})).status,200);
assert.equal((await request('/status')).data.configured,true);
const catalog=await request('/catalog');assert.equal(catalog.status,200);assert.equal(catalog.data.rows[0].price,4.8);assert.equal(catalog.data.rows[0].free,18);assert.equal(catalog.data.rate,12800);assert.equal(catalog.data.pricingReady,true);assert.equal(catalog.data.stockScope,'all');assert.ok(!catalogQueries.at(-1).filter.includes('stockStore='));assert.match(catalog.headers.get('cache-control'),/no-store/);
const imageResponse=await handleMoySklad(new Request(`https://site.test/api/moysklad/image?id=${product}`,{headers:{cookie}}),env);assert.equal(imageResponse.status,200);assert.equal(imageResponse.headers.get('content-type'),'image/png');assert.equal(cdnRequests,1);
cdnRedirect=true;const imageRedirect=await request('/image?id='+product);assert.equal(imageRedirect.status,502);assert.equal(imageRedirect.data.error.code,'upstream_redirect');assert.equal(cdnRequests,2);cdnRedirect=false;
assert.equal((await request('/quote',{clientId:client,items:[{id:product,qty:19}]})).status,409);
const reusedSourceQuote=await request('/quote',{clientId:client,items:[{id:product,qty:2}],syncId:outsideOrders[0].syncId});
assert.equal(reusedSourceQuote.status,200);assert.equal((await request('/orders',{quote:reusedSourceQuote.data.quote})).data.error.code,'order_forbidden');assert.equal(created.length,0);
const foreignSourceQuote=await request('/quote',{clientId:client,items:[{id:product,qty:2}],syncId:foreignOrders[0].syncId});assert.equal((await request('/orders',{quote:foreignSourceQuote.data.quote})).data.error.code,'order_forbidden');assert.equal(created.length,0);
const quote=await request('/quote',{clientId:client,items:[{id:product,qty:2,price:.01}],storeId:store});assert.equal(quote.status,200);assert.equal(quote.data.total,9.6);
const decodedQuote=JSON.parse(Buffer.from(quote.data.quote.split('.')[0],'base64url').toString('utf8'));assert.equal(decodedQuote.stockScope,'all');assert.ok(!Object.hasOwn(decodedQuote,'storeId'));
// An already signed confirmation from before this rollout must be reviewed again.
const oldQuote={...decodedQuote,storeId:store};delete oldQuote.stockScope;
const oldBody=b64(encoder.encode(JSON.stringify(oldQuote))),oldSignature=b64(await crypto.subtle.sign('HMAC',await key(env,'HMAC'),encoder.encode(oldBody)));
const staleResult=await request('/orders',{quote:oldBody+'.'+oldSignature});assert.equal(staleResult.status,409);assert.equal(staleResult.data.error.code,'quote_stale');assert.equal(created.length,0);
// Recheck aggregate stock at submission time, not only when showing the review.
stock=3;assert.equal((await request('/orders',{quote:quote.data.quote})).status,409);assert.equal(created.length,0);stock=20;
assert.equal((await request('/orders',{quote:quote.data.quote+'tampered'})).status,400);
assert.equal((await request('/orders',{quote:quote.data.quote})).status,200);assert.equal(created.length,1);assert.equal(created[0].positions[0].price,480);assert.equal(created[0].applicable,false);assert.ok(!Object.hasOwn(created[0],'store'));assert.ok(!created[0].positions.some(p=>p.reserve));assert.equal(created[0].rate.value,12800);assert.equal(created[0].owner.meta.href,BASE+'/entity/employee/'+employee);assert.equal(created[0].externalCode,'comfort-'+created[0].syncId);assert.equal((await request('/order?id='+uid(20))).status,200);assert.equal((await request('/orders?search=00020')).data.rows[0].id,uid(20));
assert.equal((await request('/orders',{quote:quote.data.quote})).status,200);assert.equal(created.length,1);
const second=await request('/quote',{clientId:client,items:[{id:product,qty:2}]});price=600;assert.equal((await request('/orders',{quote:second.data.quote})).status,409);assert.equal(created.length,1);
permission=false;assert.equal((await request('/quote',{clientId:client,items:[{id:product,qty:2}]})).status,403);assert.equal((await request('/orders',{quote:quote.data.quote})).status,403);permission=true;
assert.equal((await request('/draft',{draft:{clientId:client,items:[{id:product,qty:2}],note:'draft'}})).status,200);
const ownerCookie=cookie;
await login('reader@company','secret-reader');const restrictedList=await request('/orders');assert.equal(restrictedList.status,200);assert.equal(restrictedList.data.rows.length,1);assert.equal(restrictedList.data.rows[0].id,foreignOrders[0].id);assert.equal((await request('/order?id='+foreignOrders[0].id)).status,200);assert.equal((await request('/order?id='+orderFixtures[0].id)).data.error.code,'order_forbidden');assert.equal((await request('/order?id='+foreignOrders[1].id)).status,403);assert.equal((await request('/status')).data.configured,false);assert.equal((await request('/draft')).data.draft,null);
assert.equal((await request('/quote',{clientId:client,items:[{id:product,qty:2}]})).status,403);assert.equal((await request('/clients',{name:'Customer',phone:'+998901234567',syncId:uid(30)})).status,403);
assert.equal((await request('/status',undefined,{cookie:ownerCookie})).status,401);
await login();assert.equal((await request('/draft')).data.draft.items[0].qty,2);
archived=true;assert.equal((await request('/status')).status,401);archived=false;
await login();const replay=cookie;await request('/logout',{});assert.equal((await request('/status',undefined,{cookie:replay})).status,401);
cookie='';await login();sqlite.exec('UPDATE employee_sessions SET expires_at=1');assert.equal((await request('/status')).status,401);
cookie='';await login();env.MOYSKLAD_ACCOUNT_ID=uid(100);assert.equal((await request('/status')).status,401);env.MOYSKLAD_ACCOUNT_ID=account;cookie='';
for(let i=0;i<15;i++)assert.equal((await login('rate-limit@company','incorrect')).status,401);
const countBeforeRateLimit=calls.length;assert.equal((await login('rate-limit@company','incorrect')).status,429);assert.equal(calls.length,countBeforeRateLimit);
sqlite.close();
console.log('PASS: no warehouse required in settings, legacy warehouse ignored, all-warehouse catalog/quote/draft stock, submission stock recheck, old confirmations rejected, warehouse omitted from order payload, catalog and complete groups before setup, explicit unknown prices and all-warehouse scope, server group/search/stock filters, configured prices and creation gate, site-source and employee-only orders before setup, manual/other-integration orders denied, malformed source markers denied, source-filter overrides ignored, idempotent source collisions denied, raw pagination advances over rejected rows, blocked cross-employee details and filter overrides, pagination beyond 100, scoped search, provider permissions, Worker-compatible fetch, blocked redirects, network/timeout errors, image CDN credential isolation, employee login, account isolation, archived/revoked users, personal API credentials, encrypted sessions, cookie security, CSRF, session rotation/logout/expiry, rate limits, permissions, isolated preferences/drafts, server pricing, stock, signed quotes and idempotent orders. Provider mocked; real SQLite migrations used.');
