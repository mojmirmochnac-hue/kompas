import {getStore} from '@netlify/blobs';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

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

export async function owner(req?:Request){
  if(req&&req.method!=='GET'){
    const origin=req.headers.get('origin');
    if(origin&&origin!==new URL(req.url).origin)throw new Error('Neplatný pôvod požiadavky.');
  }
  const session=req?.headers.get('cookie')?.match(/(?:^|;\s*)kompas_session=([a-f0-9]{32})/)?.[1];
  if(!session)throw new Error('Reláciu sa nepodarilo načítať. Obnov stránku.');
  return session;
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
export async function acquireSyncLock(o:string){
  const c=await readConfig(o);if((c.lock_until||0)>Date.now())return false;
  await saveConfig(o,{...c,lock_until:Date.now()+120000});return true;
}
export async function releaseSyncLock(o:string){
  const c=await readConfig(o);await saveConfig(o,{...c,lock_until:0});
}
