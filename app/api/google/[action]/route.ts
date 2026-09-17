import {owner,json,readConfig,saveConfig,rows,readRecord,writeRecord} from '@/lib/store';
import {google,scopes,sync} from '@/lib/google';
export const runtime='nodejs';

function publicOrigin(req:Request){
  const u=new URL(req.url),host=req.headers.get('x-forwarded-host')||u.host;
  const proto=req.headers.get('x-forwarded-proto')||u.protocol.replace(':','');
  return `${proto}://${host}`;
}
export async function GET(req:Request,{params}:any){try{
  const {action}=await params,o=await owner(req),c=await readConfig(o);
  const origin=publicOrigin(req),callback=origin+'/api/google/callback';
  if(action==='status')return json({configured:!!c.clientId,connected:!!c.refresh_token,calendarId:c.calendarId||'primary',readCalendars:c.readCalendars||[],lastSync:c.lastSync||null,callback});
  if(action==='calendars'){
    let items:any[]=[],page='';
    do{const r=await google(o,'users/me/calendarList?maxResults=250'+(page?'&pageToken='+encodeURIComponent(page):''));if(!r.ok)throw new Error('Kalendáre sa nepodarilo načítať.');const j:any=await r.json();items.push(...(j.items||[]));page=j.nextPageToken||''}while(page);
    return json({calendars:items.map((x:any)=>({id:x.id,title:x.summary,accessRole:x.accessRole,primary:x.primary}))});
  }
  if(action==='callback'){
    const u=new URL(req.url),state=u.searchParams.get('state');
    if(!state||c.state!==state||c.expires<Date.now())throw new Error('Pripojenie vypršalo. Začni znova v nastaveniach.');
    const clean={...c,state:null,expires:null};
    if(u.searchParams.get('error')){await saveConfig(o,clean);return Response.redirect(origin+'/nastavenia?google=cancelled',303)}
    const code=u.searchParams.get('code');if(!code)throw new Error('Google nevrátil autorizačný kód.');
    const tr=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({code,client_id:c.clientId,client_secret:c.clientSecret,redirect_uri:callback,grant_type:'authorization_code',code_verifier:c.verifier})});
    const t:any=await tr.json();if(!tr.ok)throw new Error('Google pripojenie sa nepodarilo. Skontroluj OAuth údaje.');
    if(!t.refresh_token&&!c.refresh_token)throw new Error('Google neposkytol trvalý prístup. Pripoj účet znova.');
    delete clean.verifier;await saveConfig(o,{...clean,access_token:t.access_token,refresh_token:t.refresh_token||c.refresh_token,expiry:Date.now()+t.expires_in*1000});
    return Response.redirect(origin+'/nastavenia?google=connected',303);
  }
  return json({error:'Neznáma operácia.'},404);
}catch(e){return json({error:(e as Error).message},400)}}

export async function POST(req:Request,{params}:any){try{
  const {action}=await params,o=await owner(req),b:any=await req.json();let c=await readConfig(o);
  const callback=publicOrigin(req)+'/api/google/callback';
  if(action==='configure'){
    if(typeof b.clientId!=='string'||!b.clientId.endsWith('.apps.googleusercontent.com')||typeof b.clientSecret!=='string'||!b.clientSecret.trim())throw new Error('Zadaj platné Google OAuth Client ID a Client Secret.');
    if(c.refresh_token)throw new Error('Pred zmenou nastavenia najprv odpoj účet.');
    await saveConfig(o,{...c,clientId:b.clientId.trim(),clientSecret:b.clientSecret.trim()});return json({ok:true});
  }
  if(action==='connect'){
    if(!c.clientId||!c.clientSecret)throw new Error('Najprv vyplň OAuth údaje v nastaveniach.');
    const state=crypto.randomUUID()+crypto.randomUUID(),verifier=crypto.randomUUID()+crypto.randomUUID();
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
    const challenge=btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    await saveConfig(o,{...c,verifier,state,expires:Date.now()+600000});
    const p=new URLSearchParams({client_id:c.clientId,redirect_uri:callback,response_type:'code',scope:scopes,access_type:'offline',prompt:'consent',state,code_challenge:challenge,code_challenge_method:'S256'});
    return json({url:'https://accounts.google.com/o/oauth2/v2/auth?'+p});
  }
  if(action==='preferences'){
    if(!c.refresh_token)throw new Error('Najprv pripoj Google.');
    const cal=await google(o,'users/me/calendarList/'+encodeURIComponent(b.calendarId)),v:any=await cal.json();
    if(!cal.ok||!['owner','writer'].includes(v.accessRole))throw new Error('Do tohto kalendára nemáš právo zapisovať.');
    await saveConfig(o,{...c,calendarId:b.calendarId,readCalendars:Array.isArray(b.readCalendars)?b.readCalendars.slice(0,20):[b.calendarId]});return json({ok:true});
  }
  if(action==='disconnect'){
    if(c.refresh_token){const r=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:c.refresh_token})});if(!r.ok&&r.status!==400)throw new Error('Google zatiaľ nepotvrdil odpojenie. Skús to znova.')}
    await saveConfig(o,{clientId:c.clientId,clientSecret:c.clientSecret,calendarId:c.calendarId});return json({ok:true});
  }
  if(action==='resolve'){
    const t=await readRecord(o,b.id);
    if(!t||t.kind!=='task'||!(t as any).gcal)throw new Error('Úloha nemá Google udalosť.');
    await writeRecord(o,{...(t as any),revision:t.revision+1,dirty:false,gcal:{...(t as any).gcal,etag:'refresh'}});return json({ok:true});
  }
  if(action==='sync'){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(b.from)||!/^\d{4}-\d{2}-\d{2}$/.test(b.to))throw new Error('Neplatné obdobie.');
    if(Date.parse(b.to)<Date.parse(b.from)||Date.parse(b.to)-Date.parse(b.from)>100*86400000)throw new Error('Zvoľ obdobie do 100 dní.');
    return json(await sync(o,b.from,b.to));
  }
  return json({error:'Neznáma operácia.'},404);
}catch(e){return json({error:(e as Error).message},400)}}
