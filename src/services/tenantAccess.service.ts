import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import Tenant from "../models/Tenant";
import GridPackage from "../models/GridPackage";
import TenantGridGrant from "../models/TenantGridGrant";

export type TenantAuth = { kind: "ADMIN" } | { kind: "TENANT"; tenantId: string; tenantCode: string; tenantName: string };
export type TenantRequest = Request & { tenantAuth?: TenantAuth };
export const tenancyEnabled = () => String(process.env.TENANCY_ENABLED || "false").toLowerCase() === "true";

export function validateTenantConfig() {
  if (tenancyEnabled() && String(process.env.TENANT_ADMIN_API_KEY || "").length < 24) {
    throw new Error("TENANCY_ENABLED=true requires a TENANT_ADMIN_API_KEY of at least 24 characters");
  }
}

export function generateTenantKey() {
  return "tnt_" + crypto.randomBytes(32).toString("base64url");
}
export function tenantKeyHash(key: string) {
  return crypto.createHash("sha256").update(key, "utf8").digest("hex");
}
function sameSecret(a: string, b: string) {
  const left=Buffer.from(a); const right=Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
export async function resolveTenantAuth(key: string): Promise<TenantAuth | null> {
  if (!key) return null;
  const adminKey=process.env.TENANT_ADMIN_API_KEY || "";
  if (adminKey && sameSecret(key,adminKey)) return { kind:"ADMIN" };
  if (!key.startsWith("tnt_") || key.length < 32) return null;
  const tenant = await Tenant.findOne({apiKeyHash:tenantKeyHash(key),active:true}).lean();
  if (!tenant) return null;
  return {kind:"TENANT",tenantId:String(tenant._id),tenantCode:tenant.code,tenantName:tenant.name};
}

const publicMotorPaths = /^\/v1\/motor\/(options(?:\/)?|form-config\/[^/]+\/?)$/;
const comparePaths = new Set(["/commission/compare","/v1/motor/compare","/v1/motor/validate"]);
const tenantReadPaths = new Set(["/v1/tenants/session","/v1/tenants/tenant/visible-packages"]);

/** When tenancy is enabled: admin-only ingestion/mutation; tenant keys only comparison and own package metadata. */
export async function tenantFirewall(req: Request, res: Response, next: NextFunction) {
  if (!tenancyEnabled()) return next();
  if (req.method === "GET" && (publicMotorPaths.test(req.path) || req.path.startsWith("/commission/input-schema/"))) return next();
  const key = String(req.get("x-api-key") || "");
  try {
    const auth = await resolveTenantAuth(key);
    if (!auth) return res.status(401).json({success:false,error:"UNAUTHORIZED",message:"Supply a valid x-api-key."});
    (req as TenantRequest).tenantAuth = auth;
    if (auth.kind === "ADMIN") return next();
    const allowed=(req.method==="POST" && comparePaths.has(req.path)) || (req.method==="GET" && tenantReadPaths.has(req.path));
    if (!allowed) return res.status(403).json({success:false,error:"FORBIDDEN",message:"Tenant key cannot read or manage other tenants' packages or grids."});
    return next();
  } catch(e) { return res.status(500).json({success:false,error:"AUTH_ERROR",message:"Unable to authenticate API key."}); }
}

/** A grant points to an exact published package. Superseded versions remain readable for historical quotes, never other tenants. */
export async function getTenantPackageMap(tenantId:string) {
  if (!mongoose.Types.ObjectId.isValid(tenantId)) throw new Error("Invalid tenantId");
  const grants=await TenantGridGrant.find({tenantId,enabled:true}).lean();
  const packageIds=grants.map(x=>x.packageId);
  const packages=await GridPackage.find({_id:{$in:packageIds},status:{$in:["ACTIVE","EXPIRED"]}}).lean();
  const byId=new Map(packages.map(p=>[String(p._id),p]));
  const map=new Map<string,string[]>();
  for(const grant of grants){
    const pkg=byId.get(String(grant.packageId));
    if(!pkg || String(pkg.insuranceCompanyId)!==String(grant.insuranceCompanyId)) continue;
    if(pkg.ownerTenantId && String(pkg.ownerTenantId)!==tenantId) continue;
    const id=String(grant.insuranceCompanyId);
    map.set(id,[...(map.get(id)||[]),String(pkg._id)]);
  }
  return map;
}
