const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateMotorRequest, getInputCatalog, getMotorFormConfig } = require('../dist/services/motorDeveloperApi.service.js');
const app = require('../dist/app.js').default;
const base = { policy_type_id:1,motor_type_id:17,fuel_type_id:2,capacity_value:15000, policy_date:'2026-09-13', rto:'MH-01',vehicle_make:'TATA',vehicle_age:3,ncb:0 };

test('all catalog labels and IDs exist',()=>{
 const data=getInputCatalog();
 assert.equal(data.policyTypes.length,8);
 assert.equal(data.motorTypes.length,38);
 assert.equal(data.fuelTypes.length,8);
 assert.equal(data.capacities.length,36);
 for (const items of [data.policyTypes,data.motorTypes,data.fuelTypes,data.capacities]) assert.equal(new Set(items.map(x=>x.id)).size,items.length);
});
test('HCV GCV maps raw kg and policy metadata to engine',()=>{
 const r=validateMotorRequest(base);
 assert.equal(r.valid,true,JSON.stringify(r.errors));
 assert.equal(r.engineInput.product,'GCV');
 assert.equal(r.engineInput.gvw,15000);
 assert.equal(r.engineInput.policyType,'COMP');
 assert.equal(r.engineInput.rtoCode,'MH-01');
});
test('age required for commercial vehicle',()=>{
 const r=validateMotorRequest({...base,vehicle_age:undefined});
 assert.equal(r.valid,false);
 assert.ok(r.errors.some(x=>x.field==='vehicle_age'));
});
test('RTO and make required',()=>{
 const r=validateMotorRequest({...base,rto:'',vehicle_make:''});
 assert.equal(r.valid,false);
 assert.ok(r.errors.some(x=>x.field==='rto'));
 assert.ok(r.errors.some(x=>x.field==='vehicle_make'));
});
test('do not guess raw capacity from overlapping label',()=>{
 const r=validateMotorRequest({...base,capacity_value:undefined,capacity_id:14});
 assert.equal(r.valid,false);
 assert.ok(r.errors.some(x=>x.field==='capacity_value'));
});
test('capacity label must match actual dimension',()=>{
 const r=validateMotorRequest({...base,capacity_id:1});
 assert.equal(r.valid,false);
 assert.ok(r.errors.some(x=>x.code==='INCOMPATIBLE_CAPACITY'));
});
test('motor type capacity change and electric 2W watts to kW',()=>{
 const r=validateMotorRequest({...base,motor_type_id:1,fuel_type_id:3,capacity_value:2000,vehicle_age:undefined});
 assert.equal(r.valid,true,JSON.stringify(r.errors));
 assert.equal(r.engineInput.product,'TWO_WHEELER');
 assert.equal(r.engineInput.evKw,2);
 assert.equal(getMotorFormConfig(1,3).capacityDimension,'WATT');
});
test('Private Car ZD maps to nilDep without changing source payout',()=>{
 const r=validateMotorRequest({...base,motor_type_id:7,policy_type_id:2,capacity_value:1197,vehicle_age:undefined});
 assert.equal(r.valid,true,JSON.stringify(r.errors));
 assert.equal(r.engineInput.nilDep,true);
 assert.equal(r.engineInput.policyType,'COMP');
});
test('3W goods and 3W passenger remain distinct insurer products',()=>{
 const goods=validateMotorRequest({...base,motor_type_id:12,capacity_value:500});
 const passengers=validateMotorRequest({...base,motor_type_id:13,capacity_value:4});
 assert.equal(goods.engineInput.product,'GCV');
 assert.equal(passengers.engineInput.product,'PCV');
 assert.equal(passengers.engineInput.seatingCapacity,4);
});
test('fields cannot override canonical derived product',()=>{
 const r=validateMotorRequest({...base,additional_fields:{product:'PRIVATE_CAR',policyType:'SATP',addOnCover:true}});
 assert.equal(r.valid,true);
 assert.equal(r.engineInput.product,'GCV');
 assert.equal(r.engineInput.policyType,'COMP');
 assert.equal(r.engineInput.addOnCover,true);
 assert.ok(r.warnings.some(x=>x.code==='FIELD_NOT_ALLOWED'));
});
test('API HTTP routes and generated Swagger spec (without database)',async()=>{
 const server=app.listen(0,'127.0.0.1');
 try{
  await new Promise(resolve=>server.once('listening',resolve));
  const port=server.address().port;
  const root=`http://127.0.0.1:${port}`;
  const json=async(path,init)=>{const r=await fetch(root+path,init);return {status:r.status,body:await r.json()}};
  let r=await json('/api/v1/motor/options');
  assert.equal(r.status,200);assert.equal(r.body.data.motorTypes.length,38);
  r=await json('/api/v1/motor/form-config/17?fuelTypeId=2');
  assert.equal(r.body.data.capacityDimension,'GVW');
  r=await json('/api/v1/motor/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(base)});
  assert.equal(r.status,200);assert.equal(r.body.valid,true);
  r=await json('/api/v1/motor/compare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...base,rto:''})});
  assert.equal(r.status,422);assert.equal(r.body.error,'VALIDATION_FAILED');
  r=await json('/api-docs/openapi.json');
  assert.equal(r.status,200);assert.equal(r.body.openapi,'3.0.3');
  assert.ok(r.body.paths['/api/v1/motor/compare']);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
