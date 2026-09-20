import {ApiError,acquireSyncLock,readConfig,releaseSyncLock,rows,saveConfig,writeRecord} from './store';
import {splitTicktickNote,withPlanningDetails} from './ticktick-notes';

type TickTask={
  id:string;
  projectId?:string;
  title?:string;
  content?:string;
  desc?:string;
  isAllDay?:boolean;
  startDate?:string;
  dueDate?:string;
  timeZone?:string;
  priority?:number;
  status?:number;
  completedTime?:string;
  repeatFlag?:string;
  reminders?:string[];
  tags?:string[];
  etag?:string;
};

type TickProject={id:string;name:string;permission?:string;closed?:boolean};
type KompasRecord={id:string;kind:string;revision:number;[key:string]:any};

const apiBase='https://api.ticktick.com/open/v1';
const bratislava='Europe/Bratislava';

async function requestWithToken(token:string,path:string,options:RequestInit={}){
  const response=await fetch(apiBase+path,{
    ...options,
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...options.headers},
  });
  const text=await response.text();
  let body:any=null;
  if(text){try{body=JSON.parse(text)}catch{body=text}}
  if(!response.ok){
    if(response.status===401||response.status===403)throw new ApiError('TickTick pripojenie vypršalo alebo bolo odobraté. Pripoj účet znova.',401);
    throw new ApiError(`TickTick požiadavka zlyhala (${response.status}).`,502);
  }
  return body;
}

async function tokenFor(owner:string){
  let config=await readConfig(owner);
  if(config.ticktickAccessToken&&(!config.ticktickTokenExpiry||config.ticktickTokenExpiry>Date.now()+60000))return String(config.ticktickAccessToken);
  if(config.ticktickRefreshToken&&config.ticktickClientId){
    const form=new URLSearchParams({grant_type:'refresh_token',refresh_token:String(config.ticktickRefreshToken),client_id:String(config.ticktickClientId)});
    const headers:Record<string,string>={'Content-Type':'application/x-www-form-urlencoded'};
    if(config.ticktickClientSecret)headers.Authorization='Basic '+Buffer.from(`${config.ticktickClientId}:${config.ticktickClientSecret}`).toString('base64');
    const response=await fetch('https://api.ticktick.com/oauth/token',{method:'POST',headers,body:form});
    const token:any=await response.json().catch(()=>null);
    if(response.ok&&token?.access_token){
      config={...config,ticktickAccessToken:token.access_token,ticktickRefreshToken:token.refresh_token||config.ticktickRefreshToken,ticktickTokenExpiry:Date.now()+Number(token.expires_in||3600)*1000};
      await saveConfig(owner,config);
      return String(token.access_token);
    }
  }
  if(config.ticktickToken)return String(config.ticktickToken);
  throw new ApiError('Najprv pripoj TickTick v nastaveniach.',400);
}

export async function ticktickProjectsWithToken(token:string){
  const projects=await requestWithToken(token,'/project') as TickProject[];
  return (Array.isArray(projects)?projects:[]).filter(project=>!project.closed);
}

export async function ticktickProjects(owner:string){
  return ticktickProjectsWithToken(await tokenFor(owner));
}

function normalize(value:unknown){
  return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('sk-SK').replace(/[^a-z0-9]+/g,' ').trim();
}

function localParts(iso:string|undefined,allDay=false){
  if(!iso)return {date:'',time:''};
  const instant=new Date(iso);
  if(Number.isNaN(instant.valueOf()))return {date:'',time:''};
  const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:bratislava,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(instant);
  const value=(type:string)=>parts.find(part=>part.type===type)?.value||'';
  return {date:`${value('year')}-${value('month')}-${value('day')}`,time:allDay?'':`${value('hour')}:${value('minute')}`};
}

function zonedInstant(date:string,time:string){
  const [year,month,day]=date.split('-').map(Number),[hour,minute]=time.split(':').map(Number);
  const guess=Date.UTC(year,month-1,day,hour,minute);
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:bratislava,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess));
  const value=(type:string)=>Number(parts.find(part=>part.type===type)?.value||0);
  const displayedAsUtc=Date.UTC(value('year'),value('month')-1,value('day'),value('hour'),value('minute'),value('second'));
  return new Date(guess-(displayedAsUtc-guess)).toISOString().replace(/\.\d{3}Z$/,'+0000');
}

function priorityFromTicktick(priority=0){return priority>=5?'A':priority===1?'C':'B'}
function priorityToTicktick(priority='B'){return priority==='A'?5:priority==='C'?1:3}

function remoteFields(task:TickTask){
  const start=localParts(task.startDate||task.dueDate,!!task.isAllDay);
  const startMs=task.startDate?Date.parse(task.startDate):NaN,dueMs=task.dueDate?Date.parse(task.dueDate):NaN;
  const duration=Number.isFinite(startMs)&&Number.isFinite(dueMs)&&dueMs>startMs?Math.max(5,Math.round((dueMs-startMs)/60000)):60;
  return {
    title:String(task.title||'Bez názvu'),
    notes:splitTicktickNote(String(task.content||task.desc||'')).notes,
    date:start.date,
    time:start.time,
    duration,
    priority:priorityFromTicktick(task.priority),
    done:task.status===2,
  };
}

function planningFromRemote(remote:TickTask,roles:KompasRecord[],goals:KompasRecord[]){
  const {fields,hasPlanningBlock}=splitTicktickNote(String(remote.content||remote.desc||''));
  if(!hasPlanningBlock)return {};
  const quadrant=fields['Kvadrant']?.match(/^(I{1,3}|IV)\b/)?.[1];
  const role=roles.find(item=>item.title===fields['Rola']);
  const goal=goals.find(item=>item.title===fields['Cieľ']);
  return {
    ...(!fields['Rola']||role?{roleId:role?.id||''}:{}),
    ...(!fields['Cieľ']||goal?{goalId:goal?.id||''}:{}),
    ...(quadrant?{quadrant:String({I:1,II:2,III:3,IV:4}[quadrant]||2)}:{}),
    ...(fields['Veľký kameň']?{bigRock:fields['Veľký kameň']==='Áno'}:{}),
    ...(fields['Poradie']&&Number(fields['Poradie'])>0?{rank:Number(fields['Poradie'])}:{}),
  };
}

function matchKey(title:string,date:string,time:string){return `${normalize(title)}|${date||''}|${time||''}`}
function titleKey(title:string){return normalize(title)}

function roleForTask(task:TickTask,roles:KompasRecord[]){
  const tags=(task.tags||[]).map(normalize).filter(Boolean);
  if(!tags.length)return '';
  const aliases:Record<string,string[]>={
    otec:['otec','rodic'],manzel:['manzel'],krestan:['krestan'],podnikatel:['podnikatel'],
    'vlastna obnova':['vlastna obnova','ostrenie pily'],'brat a syn':['brat','syn','brat syn'],
    'zamestnanec lider':['zamestnanec','lider','praca'],
  };
  return roles.find(role=>{
    const name=normalize(role.title),candidates=[name,...(aliases[name]||[])];
    return tags.some(tag=>candidates.some(candidate=>tag===candidate||name.includes(tag)||tag.includes(name)));
  })?.id||'';
}

function remoteVersion(task:TickTask){
  return task.etag||JSON.stringify({
    projectId:task.projectId||'',
    ...remoteFields(task),
    repeatFlag:task.repeatFlag||'',
  });
}

function mergedFromRemote(local:KompasRecord,remote:TickTask,roles:KompasRecord[],goals:KompasRecord[]){
  const remoteData=remoteFields(remote);
  return {
    ...local,
    ...remoteData,
    roleId:local.roleId||roleForTask(remote,roles),
    ...planningFromRemote(remote,roles,goals),
    deleted:false,
    ticktick:{id:remote.id,projectId:remote.projectId||'',etag:remote.etag||'',version:remoteVersion(remote),repeatFlag:remote.repeatFlag||'',lastSeenAt:new Date().toISOString()},
    ticktickDirty:false,
    ticktickMessage:'',
    revision:(local.revision||0)+1,
  };
}

function newFromRemote(remote:TickTask,roles:KompasRecord[],goals:KompasRecord[]):KompasRecord{
  return {
    id:`ticktick-${remote.id}`,
    kind:'task',
    revision:1,
    ...remoteFields(remote),
    rank:1,
    quadrant:'2',
    roleId:roleForTask(remote,roles),
    goalId:'',
    bigRock:false,
    ...planningFromRemote(remote,roles,goals),
    sync:false,
    deleted:false,
    ticktick:{id:remote.id,projectId:remote.projectId||'',etag:remote.etag||'',version:remoteVersion(remote),repeatFlag:remote.repeatFlag||'',lastSeenAt:new Date().toISOString()},
    ticktickDirty:false,
    ticktickMessage:'',
  };
}

function remotePayload(task:KompasRecord,projectId:string,roles:KompasRecord[],goals:KompasRecord[]){
  const payload:any={
    id:task.ticktick?.id,
    projectId,
    title:task.title,
    content:withPlanningDetails(task.notes||'',{
      role:roles.find(role=>role.id===task.roleId)?.title,
      goal:goals.find(goal=>goal.id===task.goalId)?.title,
      quadrant:({1:'I · dôležité, naliehavé',2:'II · dôležité, nenaliehavé',3:'III · nedôležité, naliehavé',4:'IV · nedôležité, nenaliehavé'} as Record<string,string>)[task.quadrant||'2'],
      bigRock:!!task.bigRock,
      rank:Number(task.rank||1),
    }),
    priority:priorityToTicktick(task.priority),
    timeZone:bratislava,
  };
  if(task.date){
    payload.isAllDay=!task.time;
    const start=zonedInstant(task.date,task.time||'00:00');
    payload.startDate=start;
    if(task.time){
      const due=new Date(Date.parse(start)+Math.max(5,Number(task.duration||60))*60000);
      payload.dueDate=due.toISOString().replace(/\.\d{3}Z$/,'+0000');
    }else payload.dueDate=start;
  }
  return payload;
}

async function openTasks(token:string){
  const tasks=await requestWithToken(token,'/task/filter',{method:'POST',body:JSON.stringify({status:[0]})}) as TickTask[];
  if(!Array.isArray(tasks))return [];
  if(tasks.length>=200)throw new ApiError('TickTick vrátil limit 200 otvorených úloh. Synchronizácia bola zastavená, aby sa údaje nespracovali iba čiastočne.',409);
  return tasks.map(task=>({...task,status:0}));
}

async function recentlyCompleted(token:string,lastSync?:string){
  if(!lastSync)return [];
  const parsed=Date.parse(lastSync);
  const start=new Date(Math.max((Number.isFinite(parsed)?parsed:Date.now())-2*86400000,Date.now()-90*86400000));
  const end=new Date(Date.now()+60000);
  const tasks=await requestWithToken(token,'/task/completed',{method:'POST',body:JSON.stringify({startDate:start.toISOString(),endDate:end.toISOString()})}) as TickTask[];
  return Array.isArray(tasks)?tasks.map(task=>({...task,status:2})):[];
}

export async function syncTicktick(owner:string){
  const config=await readConfig(owner),token=await tokenFor(owner);
  if(!await acquireSyncLock(owner))throw new ApiError('Iná synchronizácia už prebieha. Skús to o chvíľu.',409);
  const stats={remote:0,matched:0,createdInKompas:0,createdInTicktick:0,updatedFromTicktick:0,updatedInTicktick:0,completedInTicktick:0,unresolved:0};
  const errors:string[]=[];
  try{
    const projects=await ticktickProjectsWithToken(token);
    const writable=projects.filter(project=>project.permission!=='read');
    const preferred=writable.find(project=>project.id===config.ticktickProjectId)||writable.find(project=>project.name==='🧭 Týždeň & priority')||writable[0];
    const all=await rows(owner) as KompasRecord[],localTasks=all.filter(record=>record.kind==='task'),roles=all.filter(record=>record.kind==='role'&&!record.deleted),goals=all.filter(record=>record.kind==='goal'&&!record.deleted);
    const open=await openTasks(token),completed=await recentlyCompleted(token,config.ticktickLastSync);
    const remoteMap=new Map<string,TickTask>();
    for(const task of [...open,...completed])if(task?.id)remoteMap.set(task.id,task);
    stats.remote=open.length;

    const linked=new Map<string,KompasRecord>();
    for(const task of localTasks)if(task.ticktick?.id)linked.set(task.ticktick.id,task);
    const consumedRemote=new Set<string>();

    for(const [remoteId,local] of linked){
      const remote=remoteMap.get(remoteId);
      if(!remote){
        if(!local.ticktickMessage)await writeRecord(owner,{...local,ticktickMessage:'Úloha sa v TickTicku nenašla. V Kompase zostáva zachovaná.',ticktickDirty:false,revision:(local.revision||0)+1});
        stats.unresolved++;
        continue;
      }
      consumedRemote.add(remoteId);
      const knownVersion=local.ticktick?.version||local.ticktick?.etag||'';
      const remoteChanged=!knownVersion||knownVersion!==remoteVersion(remote);
      if(remoteChanged||!local.ticktickDirty||remote.status===2||local.deleted){
        const merged=mergedFromRemote(local,remote,roles,goals);
        const before=JSON.stringify(remoteFields(remote)),after=JSON.stringify({title:local.title,notes:local.notes||'',date:local.date||'',time:local.time||'',duration:Number(local.duration||60),priority:local.priority||'B',done:!!local.done});
        if(before!==after||local.deleted)stats.updatedFromTicktick++;
        await writeRecord(owner,merged);
        continue;
      }
      try{
        const payload=remotePayload(local,local.ticktick.projectId,roles,goals);
        const updated=await requestWithToken(token,`/task/${encodeURIComponent(remoteId)}`,{method:'POST',body:JSON.stringify(payload)}) as TickTask;
        const merged=mergedFromRemote(local,{...remote,...payload,...updated},roles,goals);
        if(local.done){
          await requestWithToken(token,`/project/${encodeURIComponent(local.ticktick.projectId)}/task/${encodeURIComponent(remoteId)}/complete`,{method:'POST'});
          await writeRecord(owner,{...merged,done:true,ticktick:{...merged.ticktick,version:''}});
          stats.completedInTicktick++;
        }else{
          await writeRecord(owner,merged);
          stats.updatedInTicktick++;
        }
      }catch(error){errors.push(`${local.title}: ${(error as Error).message}`)}
    }

    const unlinked=localTasks.filter(task=>!task.ticktick?.id&&!task.deleted);
    const remainingRemote=open.filter(task=>!consumedRemote.has(task.id));
    const localByExact=new Map<string,KompasRecord[]>(),remoteByExact=new Map<string,TickTask[]>();
    const localByTitle=new Map<string,KompasRecord[]>(),remoteByTitle=new Map<string,TickTask[]>();
    for(const task of unlinked){
      const exact=matchKey(task.title,task.date||'',task.time||''),title=titleKey(task.title);
      localByExact.set(exact,[...(localByExact.get(exact)||[]),task]);localByTitle.set(title,[...(localByTitle.get(title)||[]),task]);
    }
    for(const task of remainingRemote){
      const fields=remoteFields(task),exact=matchKey(fields.title,fields.date,fields.time),title=titleKey(fields.title);
      remoteByExact.set(exact,[...(remoteByExact.get(exact)||[]),task]);remoteByTitle.set(title,[...(remoteByTitle.get(title)||[]),task]);
    }
    const matchedLocal=new Set<string>(),matchedRemote=new Set<string>(),pairs=new Map<string,KompasRecord>();
    const pair=(local:KompasRecord,remote:TickTask)=>{matchedLocal.add(local.id);matchedRemote.add(remote.id);pairs.set(remote.id,local)};
    for(const [key,locals] of localByExact){const remotes=remoteByExact.get(key)||[];if(locals.length===1&&remotes.length===1)pair(locals[0],remotes[0])}
    for(const [key,locals] of localByTitle){
      const availableLocals=locals.filter(task=>!matchedLocal.has(task.id)),availableRemotes=(remoteByTitle.get(key)||[]).filter(task=>!matchedRemote.has(task.id));
      if(availableLocals.length===1&&availableRemotes.length===1)pair(availableLocals[0],availableRemotes[0]);
    }
    for(const remote of remainingRemote){
      if(matchedRemote.has(remote.id)){
        const local=pairs.get(remote.id);
        if(local){await writeRecord(owner,mergedFromRemote(local,remote,roles,goals));stats.matched++;continue}
      }
      const sameTitle=unlinked.some(task=>!matchedLocal.has(task.id)&&titleKey(task.title)===titleKey(remoteFields(remote).title));
      if(!config.ticktickInitialized&&sameTitle){stats.unresolved++;continue}
      await writeRecord(owner,newFromRemote(remote,roles,goals));stats.createdInKompas++;
    }

    if(!config.ticktickInitialized){
      for(const local of unlinked.filter(task=>!matchedLocal.has(task.id)&&remainingRemote.some(remote=>titleKey(remoteFields(remote).title)===titleKey(task.title)))){
        await writeRecord(owner,{...local,ticktickDirty:false,ticktickMessage:'Názov sa v TickTicku našiel viackrát alebo s nejasným termínom. Úloha nebola automaticky spárovaná.',revision:(local.revision||0)+1});
      }
    }

    if(config.ticktickInitialized&&preferred){
      for(const local of unlinked.filter(task=>!matchedLocal.has(task.id)&&task.ticktickDirty&&!task.done)){
        try{
          const payload=remotePayload(local,preferred.id,roles,goals);
          const created=await requestWithToken(token,'/task',{method:'POST',body:JSON.stringify(payload)}) as TickTask;
          if(!created?.id)throw new Error('TickTick nevrátil identifikátor novej úlohy.');
          await writeRecord(owner,mergedFromRemote(local,{...payload,...created},roles,goals));stats.createdInTicktick++;
        }catch(error){errors.push(`${local.title}: ${(error as Error).message}`)}
      }
    }

    const latest=await readConfig(owner),lastSync=new Date().toISOString();
    await saveConfig(owner,{...latest,ticktickProjectId:latest.ticktickProjectId||preferred?.id||'',ticktickInitialized:true,ticktickLastSync:lastSync});
    return {stats,errors,lastSync,projectId:latest.ticktickProjectId||preferred?.id||''};
  }finally{await releaseSyncLock(owner)}
}
