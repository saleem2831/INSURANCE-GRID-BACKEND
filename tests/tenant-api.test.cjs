const {test}=require('node:test');
const assert=require('node:assert/strict');
process.env.TENANCY_ENABLED='true';
process.env.TENANT_ADMIN_API_KEY='v9-test-platform-admin-super-secret-key-123456789';
const service=require('../dist/services/tenantAccess.service.js');
const Tenant=require('../dist/models/Tenant.js').default;
const TenantGridGrant=require('../dist/models/TenantGridGrant.js').default;
const GridPackage=require('../dist/models/GridPackage.js').default;
const {compareCommissions}=require('../dist/services/commissionComparison.service.js');
const app=require('../dist/app.js').default;
const tenantKey='tnt_'+'A'.repeat(43);
const tenantId='507f1f77bcf86cd799439011';
const companyA='507f1f77bcf86cd799439012';
const companyB='507f1f77bcf86cd799439013';
const pkgShared='507f1f77bcf86cd799439014';
const pkgOther='507f1f77bcf86cd799439015';

test('production tenant mode rejects missing/weak administrator key',()=>{
 const original=process.env.TENANT_ADMIN_API_KEY;
 process.env.TENANT_ADMIN_API_KEY='too-short';
 assert.throws(()=>service.validateTenantConfig(),/TENANT_ADMIN_API_KEY/);
 process.env.TENANT_ADMIN_API_KEY=original;
 assert.doesNotThrow(()=>service.validateTenantConfig());
});
test('tenant API credentials are random and stored only as hash',()=>{
 const key=service.generateTenantKey();
 assert.match(key,/^tnt_/);assert.ok(key.length>=45);
 assert.match(service.tenantKeyHash(key),/^[a-f0-9]{64}$/);
 assert.ok(!service.tenantKeyHash(key).includes(key));
});
test('tenant package selection excludes another tenant owner and unrelated insurer',async()=>{
 const originalGrant=TenantGridGrant.find,originalPackage=GridPackage.find;
 TenantGridGrant.find=()=>({lean:async()=>[
  {tenantId,insuranceCompanyId:companyA,packageId:pkgShared,enabled:true},
  {tenantId,insuranceCompanyId:companyB,packageId:pkgOther,enabled:true}
 ]});
 GridPackage.find=()=>({lean:async()=>[
  {_id:pkgShared,insuranceCompanyId:companyA,ownerTenantId:null,status:'ACTIVE'},
  {_id:pkgOther,insuranceCompanyId:companyB,ownerTenantId:'507f1f77bcf86cd799439099',status:'ACTIVE'}
 ]});
 try{
   const selected=await service.getTenantPackageMap(tenantId);
   assert.deepEqual(selected.get(companyA),[pkgShared]);
   assert.equal(selected.has(companyB),false);
 }finally{TenantGridGrant.find=originalGrant;GridPackage.find=originalPackage}
});
test('direct compare rejects missing context but accepts authenticated platform-admin context',async()=>{
 // Deliberately give an invalid product to stop before any MongoDB query.
 // If admin authentication was dropped, the old implementation threw 403 here.
 await assert.rejects(compareCommissions({product:''}),/Authenticated admin or tenant context is required/);
 await assert.rejects(compareCommissions({product:''}, {kind:'ADMIN'}), /product is required/);
});
test('HTTP: tenant cannot access admin-only package/files; administrator and tenant sessions work',async()=>{
 const original=Tenant.findOne;
 Tenant.findOne=(query)=>({lean:async()=>query.apiKeyHash===service.tenantKeyHash(tenantKey)?{_id:tenantId,code:'BROKER_ALPHA',name:'Broker Alpha',active:true}:null});
 const server=app.listen(0,'127.0.0.1');
 try{
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const call=async(path,key,method='GET',body)=>{
    const headers={'Content-Type':'application/json'};if(key)headers['x-api-key']=key;
    const res=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});
    return {status:res.status,body:await res.json()};
  };
  assert.equal((await call('/health')).status,200);
  assert.equal((await call('/api/v1/motor/options')).status,200);
  assert.equal((await call('/api/v1/tenants/session')).status,401);
  assert.equal((await call('/api/v1/tenants/session','bad')).status,401);
  assert.equal((await call('/api/v1/tenants/session',process.env.TENANT_ADMIN_API_KEY)).body.data.mode,'ADMIN');
  const tenant=await call('/api/v1/tenants/session',tenantKey);
  assert.equal(tenant.status,200);assert.equal(tenant.body.data.code,'BROKER_ALPHA');
  for (const path of ['/api/grid-packages','/api/grid-import/files','/api/insurance-companies','/api/v1/tenants']) {
    const res=await call(path,tenantKey);
    assert.equal(res.status,403,path);
  }
  assert.equal((await call('/api/grid-packages/preview',tenantKey,'POST',{})).status,403);
  assert.equal((await call('/api/v1/motor/validate',tenantKey,'POST',{})).status,422);
  assert.equal((await call('/api/v1/motor/compare',tenantKey,'POST',{})).status,422);
  assert.equal((await call('/api/v1/motor/compare',undefined,'POST',{})).status,401);
 }finally{
  Tenant.findOne=original;
  await new Promise(resolve=>server.close(resolve));
 }
});


test('HTTP: administrator and tenant contexts reach BOTH compare routes without losing credentials',async()=>{
 const originalTenantFind=Tenant.findOne;
 const comparisonService=require('../dist/services/commissionComparison.service.js');
 const originalCompare=comparisonService.compareCommissions;
 const contexts=[];
 Tenant.findOne=(query)=>({lean:async()=>query.apiKeyHash===service.tenantKeyHash(tenantKey)
   ? {_id:tenantId,code:'BROKER_ALPHA',name:'Broker Alpha',active:true} : null});
 comparisonService.compareCommissions=async(_policy,access)=>{
   contexts.push(access);
   return {results:[],insurersChecked:0,matched:0};
 };
 const server=app.listen(0,'127.0.0.1');
 try{
   await new Promise(resolve=>server.once('listening',resolve));
   const url='http://127.0.0.1:'+server.address().port;
   const post=async(path,key,body)=>{
     const headers={'Content-Type':'application/json'};
     if(key) headers['x-api-key']=key;
     const response=await fetch(url+path,{method:'POST',headers,body:JSON.stringify(body)});
     return {status:response.status,body:await response.json()};
   };
   const developerPayload={policy_type_id:1,motor_type_id:17,fuel_type_id:2,capacity_value:15000,policy_date:'2026-09-13',rto:'MH-01',vehicle_make:'TATA',vehicle_age:3,ncb:0};
   const legacyPayload={product:'GCV',policyDate:'2026-09-13',rtoCode:'MH-01',vehicleAge:3,gvw:15000,make:'TATA',policyType:'COMP',ncb:0};
   const adminKey=process.env.TENANT_ADMIN_API_KEY;
   assert.equal((await post('/api/v1/motor/compare',adminKey,developerPayload)).status,200);
   assert.equal((await post('/api/commission/compare',adminKey,legacyPayload)).status,200);
   assert.deepEqual(contexts.slice(0,2),[{kind:'ADMIN'},{kind:'ADMIN'}]);
   assert.equal((await post('/api/v1/motor/compare',tenantKey,developerPayload)).status,200);
   assert.equal((await post('/api/commission/compare',tenantKey,legacyPayload)).status,200);
   assert.equal(contexts[2].kind,'TENANT');
   assert.equal(contexts[2].tenantId,tenantId);
   assert.equal(contexts[3].kind,'TENANT');
   assert.equal(contexts[3].tenantId,tenantId);
   assert.equal((await post('/api/v1/motor/compare',undefined,developerPayload)).status,401);
   assert.equal((await post('/api/commission/compare',undefined,legacyPayload)).status,401);
 }finally{
   Tenant.findOne=originalTenantFind;
   comparisonService.compareCommissions=originalCompare;
   await new Promise(resolve=>server.close(resolve));
 }
});
