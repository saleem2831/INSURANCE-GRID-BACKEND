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
test('direct compare service fails closed without trusted tenant context',async()=>{
 await assert.rejects(compareCommissions({product:'GCV',policyDate:'2026-09-13',rtoCode:'MH-01'}),/Tenant context is required/);
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
