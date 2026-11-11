import { getInputCatalog } from "../services/motorDeveloperApi.service";

export function getMotorOpenApiSpec(baseUrl?: string) {
  const catalog = getInputCatalog();
  const ids = (items: Array<{id:number}>) => items.map(x => x.id);
  const response = (description: string) => ({ description });
  const inputSchema = {
    type: "object", additionalProperties: false,
    required: ["policy_type_id", "motor_type_id", "fuel_type_id", "rto", "vehicle_make"],
    properties: {
      policy_type_id: { type:"integer",enum:ids(catalog.policyTypes),description:"See options catalogue for ID to label mapping" },
      motor_type_id: { type:"integer",enum:ids(catalog.motorTypes),description:"Vehicle age and capacity fields depend on this ID" },
      fuel_type_id: { type:"integer",enum:ids(catalog.fuelTypes) },
      capacity_id: { type:"integer",nullable:true,enum:ids(catalog.capacities),description:"Optional; never use alone to infer the raw capacity; boundaries overlap" },
      capacity_value: { type:"number",minimum:0,description:"Actual CC / GVW kg / seats / watts. Required when motor type needs capacity." },
      policy_date: { type:"string",format:"date",example:"2026-09-13",description:"Optional. Defaults to current business date in BUSINESS_TIME_ZONE; explicitly pass for historical/future quotes" },
      rto: { type:"string",example:"MH-01" }, vehicle_make: { type:"string",example:"TATA" },
      vehicle_age: { type:"integer",minimum:0,nullable:true,description:"Required according to motorType.vehicleAgeRequired" },
      ncb: { type:"number",minimum:0,maximum:100,description:"Optional percentage; exact rules can request this field" },
      model: { type:"string" },
      vehicle_use: { type:"string" }, seating_capacity: { type:"integer",minimum:1 }, school_ownership: { type:"boolean" },
      premium: { type:"object",properties: {gwp:{type:"number",minimum:0},odPremium:{type:"number",minimum:0},tpPremium:{type:"number",minimum:0},netPremium:{type:"number",minimum:0},grossPremium:{type:"number",minimum:0}} },
      business_metrics: { type:"object",properties:{monthlyGwp:{type:"number",minimum:0},nop:{type:"integer",minimum:0}} },
      additional_fields: { type:"object",additionalProperties:true,description:"Supply only extra fields explicitly requested by the insurer engine" }
    }
  };
  const sample = {policy_type_id:1,motor_type_id:17,fuel_type_id:2,capacity_value:15000,rto:"MH-01",vehicle_make:"TATA",vehicle_age:3,ncb:0,premium:{gwp:50000,odPremium:30000,tpPremium:20000},business_metrics:{monthlyGwp:900000}};
  const jsonBody = (example: object) => ({required:true,content:{"application/json":{schema:{$ref:"#/components/schemas/MotorInput"},example}}});
  const ok = {200:{description:"Successful response"},422:{description:"Field-level validation errors"}};
  const paths: Record<string, any> = {
    "/api/v1/motor/options": {get:{tags:["Catalogue"],summary:"All stable policy/motor/fuel/capacity IDs",responses:{200:response("Master catalog")}}},
    "/api/v1/motor/form-config/{motorTypeId}":{get:{tags:["Catalogue"],summary:"Motor and fuel dependent input fields",parameters:[{name:"motorTypeId",in:"path",required:true,schema:{type:"integer"}},{name:"fuelTypeId",in:"query",required:false,schema:{type:"integer"}}],responses:{200:response("Motor type form configuration"),404:response("Unknown motor type")}}},
    "/api/v1/motor/validate": {post:{tags:["Validation"],summary:"Validate input without calculating payouts",requestBody:jsonBody(sample),responses:ok}},
    "/api/v1/motor/compare":{post:{tags:["Compare"],summary:"Validate and calculate all insurers using existing V7 engine",requestBody:jsonBody(sample),responses:{...ok,500:response("Internal engine error")}}},
    "/api/grid-packages/preview": {post: {tags:["Grid Packages"],summary:"Upload/preview a multi-file insurer package (admin only)", description:"Multipart fields include files, companyCode, version, effectiveFrom and optional ownerTenantId. Effective To is RETIRED; later approved Effective From takes precedence without deleting historical rules.", responses:{200:response("Package inspected"),400:response("Invalid package")}}},
    "/api/commission/compare":{post:{tags:["Legacy V7"],summary:"Original V7 comparison endpoint",description:"Uses the original canonical DTO, not the numeric-ID developer DTO",requestBody:{required:true,content:{"application/json":{example:{product:"GCV",policyDate:"2026-09-13",policyType:"COMP",gvw:15000,rtoCode:"MH-01",make:"TATA",vehicleAge:3,ncb:0}}}},responses:{200:response("V7 comparison results")}}},
    "/api/commission/input-schema/{product}":{get:{tags:["Legacy V7"],summary:"Original V7 product input schema",parameters:[{name:"product",in:"path",required:true,schema:{type:"string",enum:["PRIVATE_CAR","TWO_WHEELER","GCV","PCV"]}}],responses:{200:response("V7 minimum input requirements")}}}
  };
  // All administrative and payout APIs use an HTTP x-api-key when tenancy is enabled.
  // Tenant scope is inferred exclusively from the credential, never from a request tenantId.
  const securedPost={security:[{TenantApiKey:[]}]} as any;
  paths["/api/v1/tenants/session"]={get:{tags:["Tenant"],summary:"Identify current workspace / administrator",security:[{TenantApiKey:[]}],responses:{200:response("Current workspace"),401:response("Invalid API key")}}};
  paths["/api/v1/tenants/tenant/visible-packages"]={get:{tags:["Tenant"],summary:"Only packages assigned to the authenticated tenant",security:[{TenantApiKey:[]}],responses:{200:response("Tenant's approved insurer packages")}}};
  paths["/api/v1/tenants"]={get:{tags:["Tenant Admin"],summary:"List tenants (administrator only)",security:[{TenantApiKey:[]}],responses:{200:response("Tenants")}},post:{tags:["Tenant Admin"],summary:"Create tenant and issue one-time API key",security:[{TenantApiKey:[]}],requestBody:{required:true,content:{"application/json":{example:{code:"BROKER_ALPHA",name:"Broker Alpha"}}}},responses:{201:response("One-time API key"),409:response("Duplicate code")}}};
  paths["/api/v1/tenants/{tenantId}/grants"]={get:{tags:["Tenant Admin"],summary:"Tenant package grants",security:[{TenantApiKey:[]}],parameters:[{name:"tenantId",in:"path",required:true,schema:{type:"string"}}],responses:{200:response("Grants")}},post:{tags:["Tenant Admin"],summary:"Assign an ACTIVE insurer package to one tenant",security:[{TenantApiKey:[]}],parameters:[{name:"tenantId",in:"path",required:true,schema:{type:"string"}}],requestBody:{required:true,content:{"application/json":{example:{packageId:"507f1f77bcf86cd799439011"}}}},responses:{200:response("Grant created"),403:response("Tenant ownership mismatch"),409:response("Overlapping package")}}};
  paths["/api/v1/tenants/{tenantId}/rotate-key"]={post:{tags:["Tenant Admin"],summary:"Rotate tenant credential (old key becomes invalid)",security:[{TenantApiKey:[]}],parameters:[{name:"tenantId",in:"path",required:true,schema:{type:"string"}}],responses:{200:response("New one-time API key")}}};
  paths["/api/v1/tenants/{tenantId}"]={patch:{tags:["Tenant Admin"],summary:"Enable/disable tenant access",security:[{TenantApiKey:[]}],parameters:[{name:"tenantId",in:"path",required:true,schema:{type:"string"}}],requestBody:{required:true,content:{"application/json":{example:{active:false}}}},responses:{200:response("Tenant state updated")}}};
  paths["/api/v1/tenants/{tenantId}/grants/{grantId}"]={delete:{tags:["Tenant Admin"],summary:"Revoke one tenant package grant",security:[{TenantApiKey:[]}],parameters:[{name:"tenantId",in:"path",required:true,schema:{type:"string"}},{name:"grantId",in:"path",required:true,schema:{type:"string"}}],responses:{200:response("Grant revoked")}}};
  paths["/api/v1/tenants/packages/available"]={get:{tags:["Tenant Admin"],summary:"List all ACTIVE packages for assignment",security:[{TenantApiKey:[]}],responses:{200:response("Package list")}}};
  for(const path of ["/api/v1/motor/compare","/api/v1/motor/validate","/api/commission/compare"]) if(paths[path]?.post) Object.assign(paths[path].post, securedPost);
  return {
    openapi:"3.0.3",
    info:{title:"Motor Commission Platform — Developer API",version:"9.0.0",description:"Validated input, dynamic dropdowns and deterministic source-audited comparisons. IDs in motorInputMaster.json are not MongoDB ObjectIds."},
    servers:[{url:baseUrl || "http://localhost:4000"}],
    tags:[{name:"Catalogue"},{name:"Validation"},{name:"Compare"},{name:"Grid Packages"},{name:"Legacy V7"},{name:"Tenant"},{name:"Tenant Admin"}],
    paths,
    components:{securitySchemes:{TenantApiKey:{type:"apiKey",in:"header",name:"x-api-key",description:"Required when TENANCY_ENABLED=true. An administrator key can manage packages; a tenant key can access only its own grants."}},schemas:{MotorInput:inputSchema}}
  };
}
