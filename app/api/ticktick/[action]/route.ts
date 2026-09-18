import {errorStatus,json,owner,publicOrigin,readConfig,saveConfig} from '@/lib/store';
import {syncTicktick,ticktickProjects,ticktickProjectsWithToken} from '@/lib/ticktick';

export const runtime='nodejs';

function publicProject(project:any){
  return {id:String(project.id),name:String(project.name||'Bez názvu'),permission:String(project.permission||'write')};
}

async function registerClient(redirectUri:string){
  const response=await fetch('https://api.ticktick.com/oauth/register',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      client_name:'Kompas · osobný plánovač',
      redirect_uris:[redirectUri],
      grant_types:['authorization_code'],
      response_types:['code'],
      token_endpoint_auth_method:'none',
    }),
  });
  const registration:any=await response.json().catch(()=>null);
  if(!response.ok||!registration?.client_id)throw new Error('TickTick momentálne nevytvoril bezpečné OAuth pripojenie. Skús to znova.');
  return registration;
}

async function exchangeCode(config:any,code:string,redirectUri:string){
  const form=new URLSearchParams({
    grant_type:'authorization_code',code,redirect_uri:redirectUri,
    client_id:String(config.ticktickClientId),code_verifier:String(config.ticktickVerifier),
  });
  const headers:Record<string,string>={'Content-Type':'application/x-www-form-urlencoded'};
  if(config.ticktickClientSecret)headers.Authorization='Basic '+Buffer.from(`${config.ticktickClientId}:${config.ticktickClientSecret}`).toString('base64');
  const response=await fetch('https://api.ticktick.com/oauth/token',{method:'POST',headers,body:form});
  const token:any=await response.json().catch(()=>null);
  if(!response.ok||!token?.access_token)throw new Error('TickTick neprijal autorizačný kód. Pripojenie zopakuj.');
  return token;
}

export async function GET(req:Request,{params}:any){try{
  const {action}=await params,o=await owner(req),c=await readConfig(o),origin=publicOrigin(req);
  const callback=origin+'/api/ticktick/callback';
  if(action==='status')return json({
    connected:!!(c.ticktickAccessToken||c.ticktickToken),
    projectId:c.ticktickProjectId||'',
    initialized:!!c.ticktickInitialized,
    lastSync:c.ticktickLastSync||null,
    conflictPolicy:'ticktick-wins',
    authMode:c.ticktickAccessToken?'oauth-mcp':c.ticktickToken?'legacy-token':'oauth-mcp',
  });
  if(action==='projects')return json({projects:(await ticktickProjects(o)).map(publicProject)});
  if(action==='callback'){
    const url=new URL(req.url),state=url.searchParams.get('state')||'';
    if(!state||state!==c.ticktickState||Number(c.ticktickStateExpiry||0)<Date.now())throw new Error('TickTick pripojenie vypršalo. Začni ho znova v nastaveniach.');
    const clean={...c};delete clean.ticktickState;delete clean.ticktickStateExpiry;
    if(url.searchParams.get('error')){delete clean.ticktickVerifier;await saveConfig(o,clean);return Response.redirect(origin+'/nastavenia?ticktick=cancelled',303)}
    const code=url.searchParams.get('code');if(!code)throw new Error('TickTick nevrátil autorizačný kód.');
    const token=await exchangeCode(c,code,callback);delete clean.ticktickVerifier;
    let projects:any[]=[];
    try{projects=await ticktickProjectsWithToken(String(token.access_token))}catch{}
    const writable=projects.filter(project=>project.permission!=='read');
    const preferred=writable.find(project=>project.id===c.ticktickProjectId)||writable.find(project=>project.name==='🧭 Týždeň & priority')||writable[0];
    await saveConfig(o,{
      ...clean,
      ticktickAccessToken:token.access_token,
      ticktickRefreshToken:token.refresh_token||null,
      ticktickTokenExpiry:Date.now()+Number(token.expires_in||3600)*1000,
      ticktickProjectId:preferred?.id||c.ticktickProjectId||'',
      ticktickInitialized:false,
      ticktickLastSync:null,
    });
    return Response.redirect(origin+'/nastavenia?ticktick=connected',303);
  }
  return json({error:'Neznáma operácia.'},404);
}catch(error){return json({error:(error as Error).message},errorStatus(error,400))}}

export async function POST(req:Request,{params}:any){try{
  const {action}=await params,o=await owner(req),body:any=await req.json(),c=await readConfig(o);
  if(action==='connect'){
    if(c.ticktickAccessToken||c.ticktickToken)return json({error:'TickTick už je pripojený.'},409);
    const callback=publicOrigin(req)+'/api/ticktick/callback';
    let clientId=c.ticktickClientId,clientSecret=c.ticktickClientSecret;
    if(!clientId||c.ticktickRedirectUri!==callback){
      const registration=await registerClient(callback);
      clientId=registration.client_id;clientSecret=registration.client_secret||null;
    }
    const state=crypto.randomUUID()+crypto.randomUUID(),verifier=crypto.randomUUID()+crypto.randomUUID();
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
    const challenge=Buffer.from(digest).toString('base64url');
    await saveConfig(o,{...c,ticktickClientId:clientId,ticktickClientSecret:clientSecret,ticktickRedirectUri:callback,ticktickState:state,ticktickStateExpiry:Date.now()+600000,ticktickVerifier:verifier});
    const query=new URLSearchParams({
      response_type:'code',client_id:String(clientId),redirect_uri:callback,
      scope:'tasks:read tasks:write',state,code_challenge:challenge,code_challenge_method:'S256',
      resource:'https://mcp.ticktick.com/',
    });
    return json({url:'https://ticktick.com/oauth/authorize?'+query});
  }
  if(action==='preferences'){
    if(!c.ticktickAccessToken&&!c.ticktickToken)return json({error:'Najprv pripoj TickTick.'},400);
    const projectId=String(body.projectId||''),projects=await ticktickProjects(o);
    const project=projects.find(item=>item.id===projectId&&item.permission!=='read');
    if(!project)return json({error:'Do vybraného TickTick zoznamu nemožno zapisovať.'},400);
    await saveConfig(o,{...c,ticktickProjectId:project.id});
    return json({ok:true});
  }
  if(action==='sync')return json(await syncTicktick(o));
  if(action==='disconnect'){
    const next={...c};
    delete next.ticktickToken;delete next.ticktickAccessToken;delete next.ticktickRefreshToken;delete next.ticktickTokenExpiry;
    delete next.ticktickProjectId;delete next.ticktickInitialized;delete next.ticktickLastSync;delete next.ticktickState;delete next.ticktickStateExpiry;delete next.ticktickVerifier;
    await saveConfig(o,next);
    return json({ok:true});
  }
  return json({error:'Neznáma operácia.'},404);
}catch(error){return json({error:(error as Error).message},errorStatus(error,400))}}
