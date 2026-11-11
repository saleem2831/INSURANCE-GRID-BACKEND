const { test } = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../dist/services/gridVersionPolicy.service.js');
const { validateMotorRequest } = require('../dist/services/motorDeveloperApi.service.js');
const { getComparisonInputSchema } = require('../dist/services/comparisonInputValidation.js');

function pkg(id, from, scope = null, products = ['GCV', 'PCV'], status = 'ACTIVE', end = null, created = undefined) {
  return { _id: id, gridId: id + '-grid', ownerTenantId: scope, effectiveFrom: from, effectiveTo: end,
    status, productCoverage: products, createdAt: created || from };
}
const date = x => new Date(`${x}T00:00:00Z`);

test('business date uses configured Asia/Kolkata, not UTC', () => {
  const stamp = new Date('2026-11-10T19:45:00Z');
  assert.equal(policy.businessDateKey(stamp, 'Asia/Kolkata'), '2026-11-11');
  assert.equal(policy.businessDateKey(stamp, 'UTC'), '2026-11-10');
  const q = policy.resolveQuoteDate(undefined, stamp, 'Asia/Kolkata');
  assert.equal(q.wasDefaulted, true);
  assert.equal(q.key, '2026-11-11');
  assert.equal(q.date.toISOString(), '2026-11-11T00:00:00.000Z');
});

test('explicit past and future quote dates are honored, impossible dates rejected', () => {
  assert.equal(policy.resolveQuoteDate('2026-09-13').key, '2026-09-13');
  assert.equal(policy.resolveQuoteDate('2027-06-01').key, '2027-06-01');
  assert.throws(() => policy.resolveQuoteDate('2026-02-30'), /Invalid policy date/);
  assert.throws(() => policy.resolveQuoteDate('13/09/2026'), /Invalid policy date/);
  assert.throws(() => policy.resolveQuoteDate(1234), /YYYY-MM-DD/);
});

test('approved newer package takes precedence from its exact start day; old package still works historically', () => {
  const versions = [
    pkg('sep','2026-09-01',null,['GCV'],'EXPIRED'),
    pkg('nov','2026-11-15',null,['GCV'],'ACTIVE')
  ];
  assert.equal(policy.choosePackageForDate(versions,date('2026-08-31'),undefined,'GCV'),null);
  assert.equal(policy.choosePackageForDate(versions,date('2026-11-14'),undefined,'GCV')._id,'sep');
  assert.equal(policy.choosePackageForDate(versions,date('2026-11-15'),undefined,'GCV')._id,'nov');
  assert.equal(policy.choosePackageForDate(versions,date('2027-07-01'),undefined,'GCV')._id,'nov');
});

test('new product-specific version cannot extinguish older unrelated product coverage', () => {
  const versions = [pkg('sep','2026-09-01',null,['GCV','PCV'],'EXPIRED'),pkg('nov','2026-11-01',null,['GCV'],'ACTIVE')];
  assert.equal(policy.choosePackageForDate(versions,date('2026-12-01'),undefined,'GCV')._id,'nov');
  assert.equal(policy.choosePackageForDate(versions,date('2026-12-01'),undefined,'PCV')._id,'sep');
});

test('tenant-owned grid overrides shared grid only for its own tenant; no leakage to other tenants', () => {
  const versions = [pkg('shared','2026-11-01',null,['GCV']),pkg('private','2026-10-01','tenant-A',['GCV'])];
  assert.equal(policy.choosePackageForDate(versions,date('2026-11-20'),'tenant-A','GCV')._id,'private');
  assert.equal(policy.choosePackageForDate(versions,date('2026-11-20'),'tenant-B','GCV')._id,'shared');
  assert.equal(policy.choosePackageForDate(versions,date('2026-11-20'),undefined,'GCV')._id,'shared');
});

test('legacy explicitly closed periods do not extend beyond their old end date', () => {
  const legacy = [pkg('may','2026-05-01',null,['GCV'],'EXPIRED','2026-05-31')];
  assert.equal(policy.choosePackageForDate(legacy,date('2026-05-31'),undefined,'GCV')._id,'may');
  assert.equal(policy.choosePackageForDate(legacy,date('2026-06-01'),undefined,'GCV'),null);
});

test('grid review advisory triggers after threshold without affecting eligibility', () => {
  const old = policy.gridReviewState('2026-09-01',new Date('2026-10-11T12:00:00Z'),30,'Asia/Kolkata');
  assert.equal(old.daysSinceEffective,40);
  assert.equal(old.reviewDue,true);
  assert.equal(old.advisoryOnly,true);
  const fresh=policy.gridReviewState('2026-10-01',new Date('2026-10-11T12:00:00Z'),30,'Asia/Kolkata');
  assert.equal(fresh.reviewDue,false);
});

test('developer API accepts omitted policy date but rejects invalid explicit dates', () => {
  const payload={policy_type_id:1,motor_type_id:17,fuel_type_id:2,capacity_value:15000,rto:'MH-01',vehicle_make:'TATA',vehicle_age:3,ncb:0};
  const auto=validateMotorRequest(payload);
  assert.equal(auto.valid,true,JSON.stringify(auto.errors));
  assert.equal(auto.normalized.policy_date_defaulted,true);
  assert.equal(auto.normalized.policy_date,policy.businessDateKey());
  assert.equal(auto.engineInput.policyDate,policy.businessDateKey());
  assert.equal(validateMotorRequest({...payload,policy_date:'2026-09-13'}).normalized.policy_date_defaulted,false);
  const bad=validateMotorRequest({...payload,policy_date:'2026-11-31'});
  assert.equal(bad.valid,false);
  assert.ok(bad.errors.some(x=>x.field==='policy_date'));
});

test('legacy compare schema exposes policy date as optional context, not a required base field', () => {
  const info=getComparisonInputSchema('GCV');
  assert.equal(info.required.some(x=>x.field==='policyDate'),false);
});

// Regression for approved UI changes without starting a browser.
const fs=require('node:fs'); const path=require('node:path');
const frontend=path.resolve(__dirname,'../../frontend/src');
test('frontend removes legacy screens and date is advanced-only',()=>{
  const app=fs.readFileSync(path.join(frontend,'App.tsx'),'utf8');
  const upload=fs.readFileSync(path.join(frontend,'pages/PackageUploadPage.tsx'),'utf8');
  const motor=fs.readFileSync(path.join(frontend,'pages/MotorPayoutPage.tsx'),'utf8');
  const compare=fs.readFileSync(path.join(frontend,'pages/ComparePage.tsx'),'utf8');
  assert.equal(app.includes('Single File (Legacy)'),false);
  assert.equal(app.includes('Legacy Files'),false);
  assert.equal(upload.includes('label>Effective to'),false);
  assert.ok(motor.includes('useCustomQuoteDate'));
  assert.ok(compare.includes('useCustomQuoteDate'));
});

test('activation is tenant-scope-specific and published only after validation using an Atlas transaction',async()=>{
  const mongoose=require('mongoose');
  const Package=require('../dist/models/GridPackage.js').default;
  const Grid=require('../dist/models/CommissionGrid.js').default;
  const Rules=require('../dist/models/CommissionRule.js').default;
  const svc=require('../dist/services/gridPackage.service.js');
  const original={startSession:mongoose.startSession,findById:Package.findById,find:Package.find,updateMany:Package.updateMany,gridUpdateMany:Grid.updateMany,gridUpdateOne:Grid.updateOne,ruleDeleteMany:Rules.deleteMany};
  const events=[];
  const publishing={_id:'pkg-new',gridId:'grid-new',insuranceCompanyId:'company',ownerTenantId:'owner-A',status:'VALIDATED',save:async({session})=>{events.push(['save',session.name]);}};
  try{
    const session={name:'transaction-session',withTransaction:async fn=>{events.push(['transactionBegin']);await fn();events.push(['transactionCommit']);},endSession:async()=>events.push(['endSession'])};
    mongoose.startSession=async()=>session;
    Package.findById=()=>({session:async s=>{assert.equal(s,session);return publishing}});
    Package.find=query=>({session:async s=>{assert.equal(s,session);assert.equal(query.ownerTenantId,'owner-A');events.push(['findOld',query]);return [{_id:'pkg-old',gridId:'grid-old',ownerTenantId:'owner-A',status:'ACTIVE'}];}});
    Package.updateMany=async (_filter,_change,{session:s})=>{assert.equal(s,session);events.push(['expireOldPackage'])};
    Grid.updateMany=async(_filter,_change,{session:s})=>{assert.equal(s,session);events.push(['expireOldGrid'])};
    Grid.updateOne=async(_filter,_change,{session:s})=>{assert.equal(s,session);events.push(['activateGrid'])};
    Rules.deleteMany=async()=>{throw new Error('Historical rule deletion is prohibited during activation')};
    const result=await svc.activateCommittedPackage('pkg-new');
    assert.equal(result.activated,true);
    assert.equal(result.supersededCount,1);
    assert.equal(publishing.status,'ACTIVE');
    assert.deepEqual(events.map(x=>x[0]),['transactionBegin','findOld','expireOldPackage','expireOldGrid','activateGrid','save','transactionCommit','endSession']);
  }finally{
    mongoose.startSession=original.startSession;
    Package.findById=original.findById;Package.find=original.find;Package.updateMany=original.updateMany;
    Grid.updateMany=original.gridUpdateMany;Grid.updateOne=original.gridUpdateOne;Rules.deleteMany=original.ruleDeleteMany;
  }
});
