'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const SRC = path.join(__dirname, '..', 'src');

function loadRouter(relative, modules) {
  const captured = new Map();
  const router = {
    get(route, handler) {captured.set('GET ' + route, handler);return router;},
    post(route, handler) {captured.set('POST ' + route, handler);return router;}
  };
  const source = fs.readFileSync(path.join(SRC, relative), 'utf8');
  const output = ts.transpileModule(source, {fileName: relative, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022,esModuleInterop:true
  }}).outputText;
  const exports={};
  const imports = {express:{Router:()=>router},...modules};
  vm.runInNewContext(output, {
    exports, require(name) {
      if (!(name in imports)) throw new Error('Unexpected import ' + name);
      return imports[name];
    },console
  }, {filename:relative});
  assert.ok(exports.default);
  return captured;
}

async function request(handler, auth, body) {
  const req={tenantAuth:auth,body,params:{}};
  const response={statusCode:200, body:null, status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
  await handler(req,response);
  return response;
}

test('Developer API forwards authenticated admin and tenant contexts unchanged',async()=>{
  const received=[];
  const routes=loadRouter('routes/motorDeveloperApi.routes.ts',{
    '../services/motorDeveloperApi.service':{
      compareMotorRequest:async(body,auth)=>{received.push({body,auth});return {status:200,body:{success:true}};},
      getInputCatalog:()=>({}),getMotorFormConfig:()=>({}),validateMotorRequest:()=>({valid:false})
    }
  });
  const compare=routes.get('POST /compare');
  const admin={kind:'ADMIN'};
  const tenant={kind:'TENANT',tenantId:'tenant-123',tenantCode:'T1',tenantName:'Tenant'};
  assert.equal((await request(compare,admin,{input:1})).statusCode,200);
  assert.equal((await request(compare,tenant,{input:2})).statusCode,200);
  assert.equal(received[0].auth,admin);
  assert.equal(received[1].auth,tenant);
});

test('Legacy comparison API forwards admin and tenant contexts unchanged',async()=>{
  const received=[];
  const routes=loadRouter('routes/commissionComparison.routes.ts',{
    '../services/commissionComparison.service':{
      compareCommissions:async(body,auth)=>{received.push({body,auth});return {results:[]};}
    },
    '../services/comparisonInputValidation':{
      PRODUCT_REQUIRED_FIELDS:{},getComparisonInputSchema:()=>({required:[]})
    }
  });
  const compare=routes.get('POST /compare');
  const admin={kind:'ADMIN'};
  const tenant={kind:'TENANT',tenantId:'tenant-123',tenantCode:'T1',tenantName:'Tenant'};
  assert.equal((await request(compare,admin,{product:'GCV'})).statusCode,200);
  assert.equal((await request(compare,tenant,{product:'GCV'})).statusCode,200);
  assert.equal(received[0].auth,admin);
  assert.equal(received[1].auth,tenant);
});

test('Developer API preserves expected auth errors instead of turning them into 500',async()=>{
  const routes=loadRouter('routes/motorDeveloperApi.routes.ts',{
    '../services/motorDeveloperApi.service':{
      compareMotorRequest:async()=>{const err=new Error('Forbidden');err.statusCode=403;throw err;},
      getInputCatalog:()=>({}),getMotorFormConfig:()=>({}),validateMotorRequest:()=>({valid:false})
    }
  });
  const result=await request(routes.get('POST /compare'),{kind:'ADMIN'},{});
  assert.equal(result.statusCode,403);
  assert.equal(result.body.error,'FORBIDDEN');
});

test('Comparison service rejects missing auth, permits ADMIN, and scopes TENANT grants',()=>{
  const src=fs.readFileSync(path.join(SRC,'services/commissionComparison.service.ts'),'utf8');
  assert.match(src,/tenancyEnabled\(\) && \(!access/);
  assert.match(src,/access\?\.kind === "TENANT"/);
  assert.match(src,/getTenantPackageMap\(access\.tenantId\)/);
  assert.match(src,/ownerTenantId: null/); // admin: shared grids only
  assert.doesNotMatch(src,/tenancyEnabled\(\) && !access\.tenantId/);
});
