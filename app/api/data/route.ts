import {owner,json,rows,readRecord,writeRecord,errorStatus} from '@/lib/store';
export const runtime='nodejs';
export async function GET(req:Request){try{return json({records:await rows(await owner(req))})}catch(e){return json({error:(e as Error).message},errorStatus(e,503))}}
export async function POST(req:Request){try{
  const o=await owner(req);const b:any=await req.json();
  if(!b.id||typeof b.id!=='string'||b.id.length>100||!['task','role','goal','compass','journal','review','value'].includes(b.kind))return json({error:'Neplatný záznam.'},400);
  const {id,kind,revision=0,...data}=b;
  if(JSON.stringify(data).length>60000)return json({error:'Záznam je príliš veľký.'},400);
  if(['task','role','goal','value'].includes(kind)&&(!data.title?.trim()||data.title.length>500))return json({error:'Vyplň názov (najviac 500 znakov).'},400);
  if(kind==='task'){
    if(data.date&&!/^\d{4}-\d{2}-\d{2}$/.test(data.date))return json({error:'Neplatný dátum.'},400);
    if(data.time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.time))return json({error:'Neplatný čas.'},400);
    if(data.sync&&(!data.date||!data.time))return json({error:'Pre Google kalendár vyplň dátum aj čas.'},400);
    if(data.duration&&(!Number.isFinite(+data.duration)||+data.duration<5||+data.duration>1440))return json({error:'Trvanie musí byť 5 až 1 440 minút.'},400);
  }
  const old=await readRecord(o,id);
  if(old){
    if(old.revision!==revision)return json({error:'Záznam sa zmenil v inom okne. Obnov údaje a zopakuj úpravu.'},409);
    const {id:_id,kind:_kind,revision:_revision,...oldData}=old as any;
    if(oldData.gcal)data.gcal=oldData.gcal;else delete data.gcal;
    if(kind==='task'&&oldData.sync&&(oldData.date!==data.date||oldData.time!==data.time||oldData.duration!==data.duration||oldData.title!==data.title||oldData.notes!==data.notes||oldData.deleted!==data.deleted))data.dirty=true;
  }else delete data.gcal;
  const record={...data,id,kind,revision:revision+1};
  await writeRecord(o,record);return json({record});
}catch(e){console.error('Data save failed');return json({error:(e as Error).message},errorStatus(e))}}
