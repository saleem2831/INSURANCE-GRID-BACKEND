import {Router} from "express";
import crypto from "node:crypto";
import mongoose from "mongoose";
import Tenant from "../models/Tenant";
import GridPackage from "../models/GridPackage";
import TenantGridGrant from "../models/TenantGridGrant";
import InsuranceCompany from "../models/InsuranceCompany";
import { generateTenantKey, tenantKeyHash, tenancyEnabled, type TenantRequest } from "../services/tenantAccess.service";

const router=Router();
const isAdmin=(req:TenantRequest)=>!tenancyEnabled() || req.tenantAuth?.kind === "ADMIN";
const error=(res:any,status:number,code:string,message:string)=>res.status(status).json({success:false,error:code,message});
const idOk=(value:unknown)=>mongoose.Types.ObjectId.isValid(String(value||""));

router.get("/session",(req,res)=>{
  if(!tenancyEnabled()) return res.json({success:true,data:{mode:"SINGLE",name:"Single workspace"}});
  const auth=(req as TenantRequest).tenantAuth;
  if(!auth) return error(res,401,"UNAUTHORIZED","Missing tenant credentials");
  if(auth.kind==="ADMIN") return res.json({success:true,data:{mode:"ADMIN",name:"Platform Administrator"}});
  return res.json({success:true,data:{mode:"TENANT",tenantId:auth.tenantId,code:auth.tenantCode,name:auth.tenantName}});
});

router.get("/",async(req,res)=>{
  if(!isAdmin(req as TenantRequest))return error(res,403,"FORBIDDEN","Admin required");
  const rows=await Tenant.find({}).select("-apiKeyHash").sort({name:1}).lean();
  res.json({success:true,data:rows});
});
router.post("/",async(req,res)=>{
  if(!isAdmin(req as TenantRequest))return error(res,403,"FORBIDDEN","Admin required");
  const code=String(req.body?.code||"").trim().toUpperCase();
  const name=String(req.body?.name||"").trim();
  if(!/^[A-Z0-9_]{2,40}$/.test(code)||!name||name.length>120)return error(res,422,"VALIDATION_ERROR","code (2-40 uppercase letters/numbers/_) and name are required");
  const apiKey=generateTenantKey();
  try{
    const tenant=await Tenant.create({code,name,apiKeyHash:tenantKeyHash(apiKey),active:true});
    return res.status(201).json({success:true,data:{id:tenant._id,code:tenant.code,name:tenant.name,active:tenant.active},apiKey,message:"Copy the API key now; it cannot be retrieved later."});
  }catch(e:any){return error(res,e?.code===11000?409:500,"CREATE_FAILED",e?.code===11000?"Tenant code already exists":"Unable to create tenant");}
});
router.post("/:tenantId/rotate-key",async(req,res)=>{
  if(!isAdmin(req as TenantRequest))return error(res,403,"FORBIDDEN","Admin required");
  if(!idOk(req.params.tenantId))return error(res,400,"INVALID_ID","Invalid tenant ID");
  const apiKey=generateTenantKey();
  const tenant=await Tenant.findByIdAndUpdate(req.params.tenantId,{apiKeyHash:tenantKeyHash(apiKey)},{returnDocument:"after"});
  if(!tenant)return error(res,404,"NOT_FOUND","Tenant not found");
  res.json({success:true,apiKey,message:"Old tenant key is immediately revoked; save this replacement key."});
});
router.patch("/:tenantId",async(req,res)=>{
  if(!isAdmin(req as TenantRequest))return error(res,403,"FORBIDDEN","Admin required");
  if(!idOk(req.params.tenantId)||typeof req.body?.active!=="boolean")return error(res,422,"INVALID_INPUT","Supply tenantId and active boolean");
  const tenant=await Tenant.findByIdAndUpdate(req.params.tenantId,{active:req.body.active},{returnDocument:"after"}).select("-apiKeyHash");
  if(!tenant)return error(res,404,"NOT_FOUND","Tenant not found");
  res.json({success:true,data:tenant});
});

router.get("/packages/available",async(req,res)=>{
  if(!isAdmin(req as TenantRequest))return error(res,403,"FORBIDDEN","Admin required");
  const list=await GridPackage.find({status:"ACTIVE"}).populate("insuranceCompanyId","name code").populate("ownerTenantId","name code").select("insuranceCompanyId ownerTenantId version effectiveFrom effectiveTo productCoverage totalRules status").sort({createdAt:-1}).lean();
  res.json({success:true,data:list});
});
router.get("/:tenantId/grants",async(req,res)=>{
  if(!isAdmin(req as TenantRequest))return error(res,403,"FORBIDDEN","Admin required");
  if(!idOk(req.params.tenantId))return error(res,400,"INVALID_ID","Invalid tenant ID");
  const grants=await TenantGridGrant.find({tenantId:req.params.tenantId,enabled:true}).populate("insuranceCompanyId","code name").populate("packageId","version status effectiveFrom effectiveTo productCoverage ownerTenantId").lean();
  res.json({success:true,data:grants});
});
router.post("/:tenantId/grants",async(req,res)=>{
  if(!isAdmin(req as TenantRequest))return error(res,403,"FORBIDDEN","Admin required");
  const tenantId=String(req.params.tenantId); const packageId=String(req.body?.packageId||"");
  if(!idOk(tenantId)||!idOk(packageId))return error(res,422,"INVALID_INPUT","A valid tenant ID and packageId are required");
  const [tenant,pkg]=await Promise.all([Tenant.findById(tenantId),GridPackage.findById(packageId)]);
  if(!tenant||!pkg)return error(res,404,"NOT_FOUND","Tenant or grid package not found");
  if(pkg.status!=="ACTIVE" || !pkg.gridId)return error(res,409,"PACKAGE_NOT_ACTIVE","Package must be ACTIVE with a committed grid");
  if(pkg.ownerTenantId&&String(pkg.ownerTenantId)!==tenantId)return error(res,403,"OWNER_MISMATCH","Tenant-owned package may only be assigned to its owner");
  // Multiple explicit version grants are intentional: the newest eligible version
  // applies on its start date, but old grants remain for historical quotations.
  // Tenant-owned packages override shared packages for the same insured risk.
  const grant=await TenantGridGrant.findOneAndUpdate({tenantId,packageId},{$set:{insuranceCompanyId:pkg.insuranceCompanyId,enabled:true}},{upsert:true,returnDocument:"after"});
  res.json({success:true,data:grant});
});
router.delete("/:tenantId/grants/:grantId",async(req,res)=>{
  if(!isAdmin(req as TenantRequest))return error(res,403,"FORBIDDEN","Admin required");
  if(!idOk(req.params.tenantId)||!idOk(req.params.grantId))return error(res,400,"INVALID_ID","Invalid identifier");
  const grant=await TenantGridGrant.findOneAndUpdate({_id:req.params.grantId,tenantId:req.params.tenantId},{$set:{enabled:false}},{returnDocument:"after"});
  if(!grant)return error(res,404,"NOT_FOUND","Grant not found");
  res.json({success:true,data:{revoked:true}});
});

router.get("/tenant/visible-packages",async(req,res)=>{
  const auth=(req as TenantRequest).tenantAuth;
  if(!tenancyEnabled())return res.json({success:true,data:[],mode:"SINGLE"});
  if(!auth || auth.kind!=="TENANT")return error(res,403,"TENANT_ONLY","Tenant key required");
  const grants=await TenantGridGrant.find({tenantId:auth.tenantId,enabled:true}).lean();
  const packages=await GridPackage.find({_id:{$in:grants.map(x=>x.packageId)},status:{$in:["ACTIVE","EXPIRED"]}}).populate("insuranceCompanyId","code name").select("insuranceCompanyId ownerTenantId version effectiveFrom effectiveTo productCoverage totalRules status").lean();
  res.json({success:true,data:packages.filter((p:any)=>!p.ownerTenantId||String(p.ownerTenantId)===auth.tenantId).map((p:any)=>({id:p._id,company:p.insuranceCompanyId,version:p.version,effectiveFrom:p.effectiveFrom,effectiveTo:p.effectiveTo,products:p.productCoverage,status:p.status}))});
});
export default router;
