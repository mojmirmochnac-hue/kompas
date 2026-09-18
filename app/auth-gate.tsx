'use client';

import {useEffect,useState,type FormEvent,type ReactNode} from 'react';
import {
  AuthError,
  acceptInvite,
  getSettings,
  getUser,
  handleAuthCallback,
  login,
  logout,
  onAuthChange,
  requestPasswordRecovery,
  signup,
  updateUser,
  type Settings,
  type User,
} from '@netlify/identity';
import {ArrowLeft,Compass,KeyRound,LoaderCircle,LockKeyhole,Mail,ShieldCheck} from 'lucide-react';

type AuthMode='login'|'signup'|'forgot'|'reset'|'invite';

function authMessage(error:unknown){
  if(error instanceof AuthError){
    if(error.status===401)return 'E-mail alebo heslo nie je správne.';
    if(error.status===403)return 'Táto operácia nie je povolená. Skontroluj nastavenie prihlásenia.';
    if(error.status===422&&/already|registered|exist/i.test(error.message))return 'Účet s týmto e-mailom už existuje. Prihlás sa.';
    if(error.status===422)return 'Skontroluj e-mail a použi heslo s aspoň 8 znakmi.';
  }
  if(error instanceof Error&&/Identity is not available|MissingIdentity/i.test(error.message))return 'Prihlásenie ešte nie je zapnuté na serveri.';
  return error instanceof Error?error.message:'Operácia sa nepodarila. Skús to znova.';
}

export default function AuthGate({children}:{children:(user:User,signOut:()=>Promise<void>)=>ReactNode}){
  const [user,setUser]=useState<User|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [mode,setMode]=useState<AuthMode>('login');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [migrationCode,setMigrationCode]=useState('');
  const [settings,setSettings]=useState<Settings|null>(null);
  const [inviteToken,setInviteToken]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');

  useEffect(()=>{
    let active=true;
    const unsubscribe=onAuthChange((event,currentUser)=>{
      if(!active)return;
      setUser(currentUser);
      if(event==='recovery')setMode('reset');
    });
    void (async()=>{
      try{
        const result=await handleAuthCallback();
        if(!active)return;
        if(result?.type==='recovery'){
          setUser(result.user);
          setMode('reset');
          setNotice('Zadaj nové heslo pre svoj účet.');
        }else if(result?.type==='invite'){
          setInviteToken(result.token||'');
          setMode('invite');
          setNotice('Nastav si heslo a dokonči vytvorenie účtu.');
        }else{
          const current=result?.user||await getUser();
          if(active)setUser(current);
          if(result?.type==='confirmation')setNotice('E-mail je potvrdený. Účet je pripravený.');
        }
        try{
          const identitySettings=await getSettings();
          if(active)setSettings(identitySettings);
        }catch(settingsError){
          if(active&&!result?.user)setError(authMessage(settingsError));
        }
      }catch(callbackError){
        if(active)setError(authMessage(callbackError));
      }finally{
        if(active)setLoading(false);
      }
    })();
    return()=>{active=false;unsubscribe()};
  },[]);

  async function submit(event:FormEvent){
    event.preventDefault();
    setBusy(true);setError('');setNotice('');
    try{
      if(mode==='forgot'){
        await requestPasswordRecovery(email.trim());
        setNotice('Odkaz na nastavenie nového hesla sme poslali na tvoj e-mail.');
        setMode('login');
        return;
      }
      if(mode==='reset'){
        const current=await updateUser({password});
        setUser(current);setMode('login');setPassword('');
        return;
      }
      if(mode==='invite'){
        const current=await acceptInvite(inviteToken,password);
        setUser(current);setMode('login');setPassword('');
        return;
      }
      if(mode==='signup'){
        const created=await signup(email.trim(),password);
        if(migrationCode.trim())localStorage.setItem('kompas-migration-code',migrationCode.trim());
        setPassword('');
        if(created.confirmedAt){setUser(created);return}
        setNotice('Skontroluj e-mail a potvrď vytvorenie účtu. Potom sa prihlás.');
        setMode('login');
        return;
      }
      const current=await login(email.trim(),password);
      if(migrationCode.trim())localStorage.setItem('kompas-migration-code',migrationCode.trim());
      setUser(current);setPassword('');
    }catch(submitError){setError(authMessage(submitError))}
    finally{setBusy(false)}
  }

  async function signOut(){
    setBusy(true);
    try{await logout();setUser(null);setMode('login');setNotice('Bol si bezpečne odhlásený.');}
    catch(signOutError){setError(authMessage(signOutError))}
    finally{setBusy(false)}
  }

  if(loading)return <div className="auth-screen"><div className="auth-loading"><LoaderCircle className="spin"/><span>Kontrolujem prihlásenie…</span></div></div>;
  if(user&&mode!=='reset')return <>{children(user,signOut)}</>;

  const passwordMode=!['forgot'].includes(mode);
  const heading=mode==='signup'?'Vytvoriť účet':mode==='forgot'?'Obnoviť heslo':mode==='reset'||mode==='invite'?'Nastaviť heslo':'Prihlásenie';
  const description=mode==='signup'?'Jeden účet sprístupní rovnaký plán na mobile aj počítači.':mode==='forgot'?'Pošleme ti bezpečný odkaz na nastavenie nového hesla.':mode==='reset'||mode==='invite'?'Použi nové heslo s aspoň 8 znakmi.':'Prihlás sa do svojho osobného plánovača.';

  return <main className="auth-screen">
    <section className="auth-card" aria-labelledby="auth-title">
      <div className="auth-brand"><span><Compass size={29}/></span><div>KOMPAS<small>OSOBNÝ PLÁNOVAČ</small></div></div>
      <div className="auth-icon"><ShieldCheck size={27}/></div>
      <h1 id="auth-title">{heading}</h1>
      <p>{description}</p>
      {notice&&<div className="auth-notice" role="status">{notice}</div>}
      {error&&<div className="auth-error" role="alert">{error}</div>}
      <form onSubmit={submit}>
        {!['reset','invite'].includes(mode)&&<label className="field">E-mail<div className="auth-input"><Mail size={17}/><input type="email" required autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} placeholder="tvoj@email.sk"/></div></label>}
        {passwordMode&&<label className="field">{mode==='login'?'Heslo':'Nové heslo'}<div className="auth-input"><LockKeyhole size={17}/><input type="password" required minLength={8} autoComplete={mode==='login'?'current-password':'new-password'} value={password} onChange={event=>setPassword(event.target.value)} placeholder="Aspoň 8 znakov"/></div></label>}
        {(mode==='login'||mode==='signup')&&<details className="auth-migration"><summary>Mám kód na prenos existujúcich údajov</summary><label className="field">Migračný kód<input value={migrationCode} onChange={event=>setMigrationCode(event.target.value)} autoComplete="off" spellCheck={false}/></label><p>Kód stačí zadať raz. Po prihlásení prenesie pôvodný plán pod tento účet.</p></details>}
        <button className="btn primary auth-submit" disabled={busy}>{busy?<LoaderCircle size={17} className="spin"/>:<KeyRound size={17}/>} {busy?'Pracujem…':mode==='signup'?'Vytvoriť účet':mode==='forgot'?'Poslať odkaz':mode==='reset'||mode==='invite'?'Uložiť nové heslo':'Prihlásiť sa'}</button>
      </form>
      {mode==='login'&&<div className="auth-links"><button onClick={()=>{setMode('forgot');setError('');setNotice('')}}>Zabudnuté heslo</button>{!settings?.disableSignup&&<button onClick={()=>{setMode('signup');setError('');setNotice('')}}>Vytvoriť účet</button>}</div>}
      {mode!=='login'&&mode!=='reset'&&mode!=='invite'&&<button className="auth-back" onClick={()=>{setMode('login');setError('');setNotice('')}}><ArrowLeft size={15}/> Späť na prihlásenie</button>}
      <div className="auth-trust"><ShieldCheck size={15}/> Tvoje údaje sú dostupné iba po prihlásení.</div>
    </section>
  </main>;
}
