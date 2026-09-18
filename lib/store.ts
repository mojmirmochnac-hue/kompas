import {getStore} from '@netlify/blobs';
import {getUser} from '@netlify/identity';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {timingSafeEqual} from 'node:crypto';

declare const Netlify:{env?:{get:(name:string)=>string|undefined}}|undefined;

type StoredRecord={id:string;kind:string;revision:number;[key:string]:unknown};
const localFile=path.join(process.cwd(),'.kompas-local.json');
const isLocal=process.env.NODE_ENV!=='production'&&process.env.NETLIFY!=='true';

async function localRead(){
  try{return JSON.parse(await readFile(localFile,'utf8')) as {records:Record<string,StoredRecord>;connections:Record<string,any>}}
  catch{return {records:{},connections:{}}}
}
async function localWrite(data:any){await writeFile(localFile,JSON.stringify(data,null,2))}
function store(){return getStore({name:'kompas-data',consistency:'strong'})}
function recordKey(o:string,id:string){return `${o}/records/${encodeURIComponent(id)}`}
function connectionKey(o:string){return `${o}/connection`}

export class ApiError extends Error{
  status:number;
  constructor(message:string,status:number){super(message);this.name='ApiError';this.status=status}
}

export function errorStatus(error:unknown,fallback=500){return error instanceof ApiError?error.status:fallback}

function legacyOwner(req:Request){
  return req.headers.get('cookie')?.match(/(?:^|;\s*)kompas_session=([a-f0-9]{32})/)?.[1]||null;
}

function environmentValue(name:string){
  if(typeof Netlify!=='undefined')return Netlify.env?.get(name)||process.env[name];
  return process.env[name];
}

function normalizedOrigin(value:string|undefined|null){
  if(!value)return null;
  try{return new URL(value).origin}catch{return null}
}

export function publicOrigin(req:Request){
  const configured=normalizedOrigin(environmentValue('KOMPAS_PUBLIC_ORIGIN'))||normalizedOrigin(environmentValue('URL'));
  if(configured)return configured;
  const host=(req.headers.get('x-forwarded-host')||req.headers.get('host')||'').split(',')[0].trim();
  const forwardedProto=(req.headers.get('x-forwarded-proto')||'').split(',')[0].trim();
  if(host)return normalizedOrigin(`${forwardedProto||(/^localhost(?::|$)/.test(host)?'http':'https')}://${host}`)||new URL(req.url).origin;
  return new URL(req.url).origin;
}

function migrationCodeMatches(value:string){
  const expected=environmentValue('KOMPAS_MIGRATION_CODE');
  if(!expected)return false;
  const actualBytes=Buffer.from(value);
  const expectedBytes=Buffer.from(expected);
  return actualBytes.length===expectedBytes.length&&timingSafeEqual(actualBytes,expectedBytes);
}

const migrationClaimKey='migrations/ticktick-import-2026';
async function readMigrationClaim(){
  if(isLocal){const data=await localRead();return data.connections[migrationClaimKey]||null}
  return await store().get(migrationClaimKey,{type:'json'}) as {owner:string}|null;
}
async function saveMigrationClaim(owner:string){
  if(isLocal){const data=await localRead();data.connections[migrationClaimKey]={owner};await localWrite(data);return}
  await store().setJSON(migrationClaimKey,{owner});
}

async function findImportedLegacyOwner(){
  const candidates=new Set<string>();
  if(isLocal){
    const data=await localRead();
    for(const record of Object.values(data.records)){
      const candidate=(record as StoredRecord&{owner?:string}).owner;
      if(candidate&&/^[a-f0-9]{32}$/.test(candidate))candidates.add(candidate);
    }
  }else{
    const {blobs}=await store().list();
    for(const blob of blobs){
      const match=blob.key.match(/^([a-f0-9]{32})\/records\//);
      if(match)candidates.add(match[1]);
    }
  }
  for(const candidate of candidates){
    const active=(await rows(candidate)).filter(record=>!record.deleted);
    if(active.filter(record=>record.kind==='task').length===121&&active.filter(record=>record.kind==='role').length===7&&active.filter(record=>record.kind==='goal').length===13)return candidate;
  }
  return null;
}

export async function owner(req?:Request){
  if(req&&req.method!=='GET'){
    const origin=normalizedOrigin(req.headers.get('origin'));
    const requestOrigin=normalizedOrigin(req.url);
    const forwardedHost=(req.headers.get('x-forwarded-host')||req.headers.get('host')||'').split(',')[0].trim();
    const forwardedProto=(req.headers.get('x-forwarded-proto')||'').split(',')[0].trim();
    const forwardedOrigin=forwardedHost?normalizedOrigin(`${forwardedProto||(/^localhost(?::|$)/.test(forwardedHost)?'http':'https')}://${forwardedHost}`):null;
    const allowed=new Set([publicOrigin(req),requestOrigin,forwardedOrigin].filter(Boolean));
    if(!origin||!allowed.has(origin))throw new ApiError('Neplatný pôvod požiadavky.',403);
  }
  const user=await getUser();
  if(!user)throw new ApiError('Prihlásenie vypršalo. Prihlás sa znova.',401);
  return `users/${encodeURIComponent(user.id)}`;
}
export function json(data:any,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store'}})}
export async function rows(o:string){
  if(isLocal){const d=await localRead();return Object.values(d.records).filter((r:any)=>r.owner===o).map(({owner,...r}:any)=>r)}
  const {blobs}=await store().list({prefix:`${o}/records/`});
  return (await Promise.all(blobs.map(b=>store().get(b.key,{type:'json'})))).filter(Boolean) as StoredRecord[];
}
export async function readRecord(o:string,id:string){
  if(isLocal){const d=await localRead();return (d.records[recordKey(o,id)] as StoredRecord)||null}
  return await store().get(recordKey(o,id),{type:'json'}) as StoredRecord|null;
}
export async function writeRecord(o:string,r:StoredRecord){
  if(isLocal){const d=await localRead();d.records[recordKey(o,r.id)]={...r,owner:o} as any;await localWrite(d);return}
  await store().setJSON(recordKey(o,r.id),r);
}
export async function readConfig(o:string){
  if(isLocal){const d=await localRead();return d.connections[o]||{}}
  return await store().get(connectionKey(o),{type:'json'})||{};
}
export async function saveConfig(o:string,c:any){
  if(isLocal){const d=await localRead();d.connections[o]=c;await localWrite(d);return}
  await store().setJSON(connectionKey(o),c);
}
export async function migrateLegacyData(req:Request,targetOwner:string,claimCode=''){
  const existingIds=new Set((await rows(targetOwner)).map(record=>record.id));
  let sourceOwner=legacyOwner(req);
  let sourceRecords=sourceOwner?await rows(sourceOwner):[];
  let claimedByCode=false;
  if(sourceRecords.length===0&&existingIds.size===0&&claimCode){
    if(!migrationCodeMatches(claimCode))throw new ApiError('Migračný kód nie je správny.',403);
    const claim=await readMigrationClaim();
    if(claim&&claim.owner!==targetOwner)throw new ApiError('Migračný kód už bol použitý.',409);
    sourceOwner=await findImportedLegacyOwner();
    sourceRecords=sourceOwner?await rows(sourceOwner):[];
    claimedByCode=true;
  }
  if(!sourceOwner||sourceOwner===targetOwner)return {migrated:0,connectionMigrated:false,sourceFound:false};
  let migrated=0;
  for(const record of sourceRecords){
    if(existingIds.has(record.id))continue;
    await writeRecord(targetOwner,record);
    existingIds.add(record.id);
    migrated++;
  }
  const sourceConfig=await readConfig(sourceOwner);
  const targetConfig=await readConfig(targetOwner);
  const connectionMigrated=Object.keys(sourceConfig).length>0&&Object.keys(targetConfig).length===0;
  if(connectionMigrated)await saveConfig(targetOwner,sourceConfig);
  if(claimedByCode)await saveMigrationClaim(targetOwner);
  return {migrated,connectionMigrated,sourceFound:sourceRecords.length>0||Object.keys(sourceConfig).length>0};
}
export async function acquireSyncLock(o:string){
  const c=await readConfig(o);if((c.lock_until||0)>Date.now())return false;
  await saveConfig(o,{...c,lock_until:Date.now()+120000});return true;
}
export async function releaseSyncLock(o:string){
  const c=await readConfig(o);await saveConfig(o,{...c,lock_until:0});
}
