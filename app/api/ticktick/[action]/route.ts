import {errorStatus,json,owner,readConfig,saveConfig} from '@/lib/store';
import {syncTicktick,ticktickProjects,validateTicktickToken} from '@/lib/ticktick';

export const runtime='nodejs';

function publicProject(project:any){
  return {id:String(project.id),name:String(project.name||'Bez názvu'),permission:String(project.permission||'write')};
}

export async function GET(req:Request,{params}:any){try{
  const {action}=await params,o=await owner(req),c=await readConfig(o);
  if(action==='status')return json({
    connected:!!c.ticktickToken,
    projectId:c.ticktickProjectId||'',
    initialized:!!c.ticktickInitialized,
    lastSync:c.ticktickLastSync||null,
    conflictPolicy:'ticktick-wins',
  });
  if(action==='projects')return json({projects:(await ticktickProjects(o)).map(publicProject)});
  return json({error:'Neznáma operácia.'},404);
}catch(error){return json({error:(error as Error).message},errorStatus(error,400))}}

export async function POST(req:Request,{params}:any){try{
  const {action}=await params,o=await owner(req),body:any=await req.json(),c=await readConfig(o);
  if(action==='configure'){
    const token=typeof body.token==='string'?body.token.trim():'';
    if(token.length<20||token.length>2000||/\s/.test(token))return json({error:'Vlož platný osobný API token z TickTicku.'},400);
    if(c.ticktickToken)return json({error:'TickTick už je pripojený. Pred zmenou tokenu ho najprv odpoj.'},409);
    const projects=await validateTicktickToken(token),writable=projects.filter(project=>project.permission!=='read');
    const preferred=writable.find(project=>project.name==='🧭 Týždeň & priority')||writable[0];
    if(!preferred)return json({error:'V TickTicku sa nenašiel zoznam, do ktorého možno zapisovať.'},409);
    await saveConfig(o,{...c,ticktickToken:token,ticktickProjectId:preferred.id,ticktickInitialized:false,ticktickLastSync:null});
    return json({ok:true,project:publicProject(preferred)});
  }
  if(action==='preferences'){
    if(!c.ticktickToken)return json({error:'Najprv pripoj TickTick.'},400);
    const projectId=String(body.projectId||''),projects=await ticktickProjects(o);
    const project=projects.find(item=>item.id===projectId&&item.permission!=='read');
    if(!project)return json({error:'Do vybraného TickTick zoznamu nemožno zapisovať.'},400);
    await saveConfig(o,{...c,ticktickProjectId:project.id});
    return json({ok:true});
  }
  if(action==='sync')return json(await syncTicktick(o));
  if(action==='disconnect'){
    const next={...c};
    delete next.ticktickToken;delete next.ticktickProjectId;delete next.ticktickInitialized;delete next.ticktickLastSync;
    await saveConfig(o,next);
    return json({ok:true});
  }
  return json({error:'Neznáma operácia.'},404);
}catch(error){return json({error:(error as Error).message},errorStatus(error,400))}}
