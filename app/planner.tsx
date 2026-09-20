'use client';
import { useEffect, useState, useRef, type ComponentProps } from 'react';
import type { User } from '@netlify/identity';
import { Compass, Plus, CalendarDays, CheckSquare, Target, BookOpen, Settings, Sun, ChevronLeft, ChevronRight, ArrowRight, RefreshCw, Cloud, Mountain, Clock, Check, LayoutGrid, Heart, Users, Flag, Trash2, Pencil, ArrowUpRight, Download, ShieldCheck, Leaf, Search, Unplug, Link2, Save, LogOut } from 'lucide-react';
import { SidebarProvider, Sidebar, SidebarContent, SidebarHeader, SidebarFooter, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarInset, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import AuthGate from './auth-gate';
type Rec = {
    id: string;
    kind: string;
    revision?: number;
    [key: string]: any;
};
const nav = [['/', 'Môj deň', Sun], ['/tyzden', 'Týždenný plán', CalendarDays], ['/ulohy', 'Všetky úlohy', CheckSquare], ['/matica', 'Matica priorít', LayoutGrid], ['/ciele', 'Roly a ciele', Target], ['/kompas', 'Môj kompas', Compass], ['/dennik', 'Denník a reflexia', BookOpen]] as const;
const colors = ['#3169de', '#a36bd5', '#dc8b29', '#269d83', '#dc6b83', '#578bad', '#727caf'];
const dateKey = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(d);
const today = () => dateKey(new Date());
const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const monday = (d: string) => addDays(d, -((new Date(d + 'T12:00Z').getUTCDay() + 6) % 7));
const fmt = (d: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) => new Date(d + 'T12:00:00Z').toLocaleDateString('sk-SK', opts);
const fresh = (kind: string, fields: any = {}) => ({ id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16))).map(x => x.toString(16).padStart(2, '0')).join(''), kind, revision: 0, ...fields });
function Pick({ value, onChange, options, label }: {
    value: string;
    onChange: (v: string) => void;
    options: {
        value: string;
        label: string;
    }[];
    label: string;
}) { return <Select value={value || '_'} onValueChange={v => onChange(v === '_' ? '' : v)}><SelectTrigger aria-label={label} className="pick"><SelectValue /></SelectTrigger><SelectContent>{options.map(o => <SelectItem key={o.value || '_'} value={o.value || '_'}>{o.label}</SelectItem>)}</SelectContent></Select>; }
function Empty({ icon: Icon = Mountain, title, children, action }: {
    icon?: any;
    title: string;
    children?: any;
    action?: any;
}) { return <div className="empty"><span className="empty-icon"><Icon size={25}/></span><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>; }
async function api(url: string, body?: any) { const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); const j: any = await r.json(); if (!r.ok)
    throw new Error(j.error || 'Operácia sa nepodarila. Skús to znova.'); return j; }
// Use ordinary document navigation so each route works independently of the client router.
function PlannerLink({ onClick, ...props }: ComponentProps<'a'>) {
    const { setOpenMobile } = useSidebar();
    return <a {...props} onClick={event => {
            onClick?.(event);
            if (!event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0)
                setOpenMobile(false);
        }}/>;
}
export default function Planner({ path = '/' }: {
    path?: string;
}) {
    return <AuthGate>{(user, signOut) => <PlannerWorkspace path={path} user={user} onSignOut={signOut}/>}</AuthGate>;
}
function PlannerWorkspace({ path = '/', user, onSignOut }: {
    path?: string;
    user: User;
    onSignOut: () => Promise<void>;
}) {
    const [records, setRecords] = useState<Rec[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);
    const [date, setDate] = useState(today);
    const [edit, setEdit] = useState<Rec | null>(null);
    const [remove, setRemove] = useState<Rec | null>(null);
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState('open');
    const [roleFilter, setRoleFilter] = useState('');
    const [googleStatus, setGoogleStatus] = useState<any>({ connected: false });
    const [events, setEvents] = useState<any[]>([]);
    const [syncing, setSyncing] = useState(false);
    const [syncErrors, setSyncErrors] = useState<string[]>([]);
    const [calendarList, setCalendarList] = useState<any[]>([]);
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [writeCal, setWriteCal] = useState('primary');
    const [readCals, setReadCals] = useState<string[]>([]);
    const syncLock = useRef(false);
    const [ticktickStatus, setTicktickStatus] = useState<any>({ connected: false });
    const [ticktickSyncing, setTicktickSyncing] = useState(false);
    const [ticktickErrors, setTicktickErrors] = useState<string[]>([]);
    const [ticktickResult, setTicktickResult] = useState<any>(null);
    const ticktickLock = useRef(false);
    const load = async () => { const j = await api('/api/data'); let records = j.records as Rec[]; if (records.length === 0) {
        try {
            const legacy = JSON.parse(localStorage.getItem('kompas-records') || '[]') as Rec[];
            if (legacy.length) {
                records = [];
                for (const item of legacy) {
                    const saved = await api('/api/data', { ...item, revision: 0 });
                    records.push(saved.record);
                }
                localStorage.removeItem('kompas-records');
                setNotice('Údaje z tohto zariadenia boli prenesené online');
            }
        }
        catch { }
    } setRecords(records); setError(''); return records; };
    const status = async () => { const j = await api('/api/google/status'); setGoogleStatus(j); setWriteCal(j.calendarId); setReadCals(j.readCalendars); if (j.connected) {
        const c = await api('/api/google/calendars');
        setCalendarList(c.calendars);
        if (j.calendarId === 'primary')
            setWriteCal(c.calendars.find((x: any) => x.primary)?.id || 'primary');
    } return j; };
    const ticktickStatusLoad = async () => { const j = await api('/api/ticktick/status'); setTicktickStatus(j); return j; };
    useEffect(() => { const code = localStorage.getItem('kompas-migration-code') || ''; api('/api/migrate', { code }).then(async (migration) => { if (code)
        localStorage.removeItem('kompas-migration-code'); await Promise.all([load(), status(), ticktickStatusLoad()]); if (migration.migrated)
        setNotice(`${migration.migrated} existujúcich záznamov bolo prenesených pod tvoj účet`); }).catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
    useEffect(() => { if (!notice)
        return; const t = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(t); }, [notice]);
    async function save(r: Rec) { setBusy(true); try {
        const j = await api('/api/data', r);
        setRecords(prev => [...prev.filter(x => x.id !== r.id), j.record]);
        setNotice('Uložené online');
        if (j.record.kind === 'task' && ticktickStatus.connected)
            void ticktickSyncNow();
        return j.record;
    }
    catch (e) {
        setError((e as Error).message);
        throw e;
    }
    finally {
        setBusy(false);
    } }
    const run = async (fn: () => Promise<any>) => { setBusy(true); setError(''); try {
        await fn();
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } };
    async function syncNow() { if (syncLock.current)
        return; syncLock.current = true; setSyncing(true); try {
        const j = await api('/api/google/sync', { from: addDays(monday(date), -21), to: addDays(monday(date), 42) });
        setEvents(j.events);
        setSyncErrors(j.errors);
        setGoogleStatus((s: any) => ({ ...s, lastSync: j.lastSync }));
        await load();
    }
    catch (e) {
        setSyncErrors([(e as Error).message]);
    }
    finally {
        setSyncing(false);
        syncLock.current = false;
    } }
    async function ticktickSyncNow() { if (ticktickLock.current)
        return null; ticktickLock.current = true; setTicktickSyncing(true); try {
        const j = await api('/api/ticktick/sync', {});
        setTicktickErrors(j.errors || []);
        setTicktickResult(j);
        setTicktickStatus((s: any) => ({ ...s, lastSync: j.lastSync, projectId: j.projectId, initialized: true }));
        await load();
        return j;
    }
    catch (e) {
        setTicktickErrors([(e as Error).message]);
        return null;
    }
    finally {
        setTicktickSyncing(false);
        ticktickLock.current = false;
    } }
    async function syncAllNow() {
        if (ticktickStatus.connected)
            await ticktickSyncNow();
        if (googleStatus.connected)
            await syncNow();
    }
    useEffect(() => { if (!googleStatus.connected && !ticktickStatus.connected)
        return; void syncAllNow(); const id = setInterval(() => { if (document.visibilityState === 'visible')
        void syncAllNow(); }, 60000); return () => clearInterval(id); }, [googleStatus.connected, ticktickStatus.connected, date]);
    const alive = records.filter(r => !r.deleted);
    const tasks = alive.filter(r => r.kind === 'task');
    const roles = alive.filter(r => r.kind === 'role');
    const goals = alive.filter(r => r.kind === 'goal');
    const values = alive.filter(r => r.kind === 'value').sort((a, b) => (a.rank || 0) - (b.rank || 0));
    const compass = alive.find(r => r.kind === 'compass');
    const dayTasks = tasks.filter(t => t.date === date).sort((a, b) => (a.priority || 'B').localeCompare(b.priority || 'B') || (a.rank || 1) - (b.rank || 1));
    const week = monday(date);
    const weekTasks = tasks.filter(t => t.date >= week && t.date <= addDays(week, 6));
    const rocks = weekTasks.filter(t => t.bigRock);
    const done = dayTasks.filter(t => t.done).length;
    const q2 = dayTasks.filter(t => t.quadrant === '2').length;
    const overdue = tasks.filter(t => t.date && t.date < date && !t.done);
    const role = (id: string) => roles.find(r => r.id === id);
    const title = nav.find(n => n[0] === path)?.[1] || (path === '/nastavenia' ? 'Nastavenia' : 'Môj deň');
    const newTask = (extra: any = {}) => setEdit(fresh('task', { title: '', date, time: '', duration: 60, priority: 'B', rank: 1, quadrant: '2', roleId: '', goalId: '', bigRock: false, done: false, sync: false, ...extra }));
    const startMinutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const eventDate = (e: any) => e.start.date || dateKey(new Date(e.start.dateTime));
    const eventOnDay = (e: any, d: string) => e.start.date ? d >= e.start.date && d < e.end.date : eventDate(e) === d;
    const eventTime = (e: any) => e.start.dateTime ? new Intl.DateTimeFormat('sk-SK', { timeZone: 'Europe/Bratislava', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(e.start.dateTime)) : '';
    const googleTemplate = (t: Rec) => { const start = (t.date || '').replaceAll('-', '') + 'T' + (t.time || '').replace(':', '') + '00'; const endDate = new Date((t.date || today()) + 'T' + (t.time || '00:00') + ':00'); endDate.setMinutes(endDate.getMinutes() + Number(t.duration || 60)); const end = dateKey(endDate).replaceAll('-', '') + 'T' + String(endDate.getHours()).padStart(2, '0') + String(endDate.getMinutes()).padStart(2, '0') + '00'; return 'https://calendar.google.com/calendar/render?action=TEMPLATE&ctz=Europe%2FBratislava&text=' + encodeURIComponent(t.title || 'Úloha') + '&dates=' + start + '/' + end + '&details=' + encodeURIComponent(t.notes || ''); };
    const initials = (user.name || user.email || 'JA').split(/\s+|@/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'JA';
    function taskRow(t: Rec, compact = false) { return <div className={'task-row ' + (t.done ? 'completed' : '')} key={t.id} draggable={!t.done} onDragStart={e => e.dataTransfer.setData('text/kompas', t.id)}><Checkbox aria-label={'Dokončiť: ' + t.title} checked={!!t.done} disabled={busy} onCheckedChange={v => run(() => save({ ...t, done: !!v }))}/><span className={'priority ' + (t.priority || 'B').toLowerCase()}>{t.priority || 'B'}{t.rank || 1}</span><button className="task-body" onClick={() => setEdit({ ...t })}><span className="task-title">{t.title}</span>{!compact && <span className="task-meta">{t.bigRock && <Mountain size={12}/>}<i style={{ background: role(t.roleId)?.color || '#a5b2c7' }}/>{role(t.roleId)?.title || 'Bez roly'}{t.time && ' · ' + t.time}{t.ticktick && ' · TickTick'}{t.gcal && ' · Google'}</span>}</button>{t.bigRock && <Mountain className="rock-icon" size={16}/>}</div>; }
    function dateControls() { return <div className="date-controls"><button className="icon-btn" aria-label="Predchádzajúce obdobie" onClick={() => setDate(addDays(date, path === '/tyzden' ? -7 : -1))}><ChevronLeft size={18}/></button><button className="btn small" onClick={() => setDate(today())}>Dnes</button><button className="icon-btn" aria-label="Nasledujúce obdobie" onClick={() => setDate(addDays(date, path === '/tyzden' ? 7 : 1))}><ChevronRight size={18}/></button><input aria-label="Vybrať dátum" type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)}/></div>; }
    function dailyNotes() { const note = records.find(x => x.id === 'journal-' + date); return <NoteEditor key={date + ':' + (note?.revision || 0)} record={note || { id: 'journal-' + date, kind: 'journal', revision: 0, date, content: '' }} save={save} compact/>; }
    const viewIsDay = !nav.some(n => n[0] === path) && path !== '/nastavenia' || path === '/';
    return <SidebarProvider style={{ '--sidebar-width': '236px' } as any}><Sidebar className="app-sidebar"><SidebarHeader><PlannerLink href="/" className="brand"><span className="brand-symbol"><Compass size={26}/></span><span>KOMPAS<small>OSOBNÝ PLÁNOVAČ</small></span></PlannerLink></SidebarHeader><SidebarContent><div className="nav-label">MÔJ PRIESTOR</div><SidebarMenu>{nav.map(([url, label, Icon]) => <SidebarMenuItem key={url}><SidebarMenuButton asChild isActive={path === url} className="nav-link"><PlannerLink href={url} aria-current={path === url ? 'page' : undefined}><Icon size={19}/><span>{label}</span>{url === '/ulohy' && tasks.filter(t => !t.done).length > 0 && <span className="nav-count">{tasks.filter(t => !t.done).length}</span>}</PlannerLink></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu><div className="sidebar-guide"><Compass size={22}/><strong>Najprv to najdôležitejšie.</strong><p>Vytvor v týždni priestor pre to, na čom ti záleží.</p><PlannerLink href="/tyzden">Naplánovať týždeň <ArrowRight size={15}/></PlannerLink></div></SidebarContent><SidebarFooter><SidebarMenuButton asChild isActive={path === '/nastavenia'} className="nav-link"><PlannerLink href="/nastavenia" aria-current={path === '/nastavenia' ? 'page' : undefined}><Settings size={19}/>Nastavenia</PlannerLink></SidebarMenuButton><div className="profile"><span>{initials}</span><div><b>{user.name || 'Môj osobný priestor'}</b><small>{user.email || 'Prihlásený účet'}</small></div><button className="profile-logout" aria-label="Odhlásiť sa" title="Odhlásiť sa" onClick={() => void onSignOut()}><LogOut size={17}/></button></div></SidebarFooter></Sidebar><SidebarInset className="app-main"><header className="topbar"><div className="crumb"><SidebarTrigger /><span>Môj priestor</span><ChevronRight size={13}/><b>{title}</b></div><div className="top-actions"><span className="cloud-label"><Cloud size={16}/>{loading ? 'Načítavam…' : busy ? 'Ukladám…' : error ? 'Úložisko nedostupné' : 'Online úložisko'}</span><button className="btn primary" onClick={() => newTask()}><Plus size={17}/><span>Nová úloha</span></button></div></header><main className="workspace">
    {error && <div className="error" role="alert">{error}<button onClick={() => run(load)}>Obnoviť údaje</button></div>}{notice && <div className="toast" role="status"><Check size={16}/>{notice}</div>}
    <div className="page-heading"><div><div className="eyebrow">{path === '/tyzden' ? 'PRIESTOR PRE DÔLEŽITÉ VECI' : viewIsDay ? fmt(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'ŽI S JASNÝM SMEROM'}</div><h1>{title}<span className="heading-dot">.</span></h1><p>{viewIsDay ? 'Venuj svoj najlepší čas svojim najdôležitejším veciam.' : path === '/tyzden' ? 'Najskôr veľké kamene. Potom všetko ostatné.' : path === '/ulohy' ? 'Všetko na jednom mieste. Rozhodni, čo urobíš ďalej.' : path === '/matica' ? 'Rozlišuj medzi tým, čo je naliehavé, a tým, čo je dôležité.' : path === '/ciele' ? 'Prepoj to, kým chceš byť, s tým, čo každý deň robíš.' : path === '/kompas' ? 'Hodnoty dávajú smer. Poslanie spája tvoje rozhodnutia.' : path === '/dennik' ? 'Zastav sa, všimni si súvislosti a urob ďalší malý krok.' : 'Tvoje údaje a prepojenia s TickTickom a Google kalendárom.'}</p></div>{(viewIsDay || path === '/tyzden' || path === '/dennik') && dateControls()}</div>
        {loading ? <div className="panel empty"><RefreshCw className="spin"/><p>Načítavam tvoj plán…</p></div> : <>
        {path === '/nastavenia' && <TickTickSettings status={ticktickStatus} syncing={ticktickSyncing} result={ticktickResult} errors={ticktickErrors} onRefresh={ticktickStatusLoad} onSync={ticktickSyncNow} onDisconnect={() => setRemove({ id: 'ticktick', kind: 'connection', provider: 'ticktick', title: 'TickTick' })} notify={setNotice}/>}
        {viewIsDay && <><div className="stats"><div><span className="stat-icon blue"><CheckSquare size={21}/></span><div><small>Dokončené úlohy</small><strong>{done}<em> / {dayTasks.length}</em></strong></div><Progress value={dayTasks.length ? done / dayTasks.length * 100 : 0}/></div><div><span className="stat-icon purple"><Mountain size={21}/></span><div><small>Veľké kamene dnes</small><strong>{dayTasks.filter(t => t.bigRock).length}<em> priorít</em></strong></div></div><div><span className="stat-icon green"><Leaf size={21}/></span><div><small>Dôležité, nenaliehavé</small><strong>{q2}<em> úloh v II. kvadrante</em></strong></div></div></div><div className="daily-grid"><section className="panel tasks-panel"><div className="panel-heading"><h2><CheckSquare size={18}/> Denné priority</h2><span className="count">{dayTasks.length}</span></div><div className="subtle-line">A · nevyhnutné <span>B · dôležité</span> C · voliteľné</div><form className="quick-add" onSubmit={e => { e.preventDefault(); const f = e.currentTarget; const el = f.elements.namedItem('title') as HTMLInputElement; if (el.value.trim()) {
            const text = el.value.trim();
            run(async () => { await save(fresh('task', { title: text, date, priority: 'B', rank: 1, quadrant: '2', duration: 60 })); f.reset(); });
        } }}><Plus size={17}/><input name="title" aria-label="Rýchlo pridať úlohu" placeholder="Pridať úlohu na tento deň…" maxLength={500}/><button type="submit" disabled={busy} aria-label="Pridať úlohu"><ArrowRight size={16}/></button></form>{dayTasks.length ? dayTasks.map(t => taskRow(t)) : <Empty title="Daj dňu jasnú prioritu" action={<button className="text-btn" onClick={() => newTask({ bigRock: true })}>Pridať prvý veľký kameň <ArrowRight size={14}/></button>}>Čo je jedna dôležitá vec, ktorej dnes chceš venovať čas?</Empty>}{overdue.length > 0 && <div className="overdue"><h3>Na preplánovanie <span>{overdue.length}</span></h3>{overdue.slice(0, 4).map(t => <div key={t.id}><button onClick={() => setEdit({ ...t })}>{t.title}<small>{fmt(t.date)}</small></button><button className="text-btn" disabled={busy} onClick={() => run(() => save({ ...t, date, dirty: true }))}>Na dnes</button></div>)}</div>}<div className="panel-bottom"><PlannerLink href="/ulohy">Všetky úlohy <ArrowRight size={14}/></PlannerLink><PlannerLink href="/matica">Matica priorít</PlannerLink></div></section><section className="panel calendar-panel"><div className="panel-heading"><h2><CalendarDays size={18}/> Časový plán</h2><PlannerLink href="/tyzden" className="text-btn">Týždeň <ArrowUpRight size={14}/></PlannerLink></div><div className="calendar-date"><b>{fmt(date, { weekday: 'long' })}</b><span>{fmt(date)}</span></div>{events.filter(e => eventOnDay(e, date) && !e.start.dateTime).map(e => <div key={e.id} className="all-day">Celý deň · {e.title}</div>)}<div className="timeline" ref={el => { if (el && !el.dataset.scrolled) {
            el.scrollTop = 5 * 53;
            el.dataset.scrolled = '1';
        } }}>{Array.from({ length: 24 }, (_, i) => i).map(h => <div className="hour" key={h} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const t = tasks.find(t => t.id === e.dataTransfer.getData('text/kompas')); if (t)
            run(() => save({ ...t, date, time: String(h).padStart(2, '0') + ':00', dirty: true })); }}><span className="hour-label">{String(h).padStart(2, '0')}:00</span><div className="hour-space"><button className="hour-add" aria-label={'Naplánovať o ' + h + ':00'} onClick={() => newTask({ time: String(h).padStart(2, '0') + ':00' })}/>{dayTasks.filter(t => t.time && Number(t.time.split(':')[0]) === h).map(t => <button className="time-event" style={{ borderLeftColor: role(t.roleId)?.color || '#3169de' }} key={t.id} onClick={() => setEdit({ ...t })}><b>{t.title}</b><span>{t.time} · {t.duration || 60} min {t.bigRock ? ' · Veľký kameň' : ''}</span></button>)}{events.filter(e => eventOnDay(e, date) && e.start.dateTime && Number(eventTime(e).split(':')[0]) === h && !tasks.some(t => t.gcal?.id === e.id)).map(e => <a className="time-event google-event" href={e.htmlLink} target="_blank" rel="noreferrer" key={e.calendarId + e.id}><b>{e.title}</b><span>{eventTime(e)} · Google kalendár</span></a>)}</div></div>)}</div><div className="panel-bottom">Europe/Bratislava <PlannerLink href="/nastavenia">{googleStatus.connected ? 'Google pripojený' : 'Pripojiť Google'} <Link2 size={13}/></PlannerLink></div></section><aside className="daily-aside"><section className="focus-card"><div className="eyebrow"><Mountain size={16}/> MÔJ DNEŠNÝ ZÁMER</div><h2>Čo dnes spraví<br />skutočný rozdiel?</h2>{dayTasks.filter(t => t.bigRock && !t.done).length ? <div className="focus-list">{dayTasks.filter(t => t.bigRock && !t.done).slice(0, 3).map(t => <button key={t.id} onClick={() => setEdit({ ...t })}><span /><b>{t.title}</b></button>)}</div> : <p>Vyber dôležitú úlohu, ktorá nemusí byť naliehavá. Vyhraď jej miesto v kalendári.</p>}<button onClick={() => newTask({ bigRock: true, quadrant: '2' })}><Plus size={16}/> Pridať veľký kameň</button></section><section className="panel note-panel"><div className="panel-heading"><h2><Pencil size={17}/> Denné poznámky</h2></div>{dailyNotes()}</section><section className="mini-compass"><Compass size={20}/><div><b>Vráť sa k svojmu smeru</b><p>{compass?.mission ? compass.mission.slice(0, 130) + (compass.mission.length > 130 ? '…' : '') : 'Čomu chceš venovať svoj čas a energiu?'}</p><PlannerLink href="/kompas">Môj kompas <ArrowRight size={14}/></PlannerLink></div></section></aside></div></>}
        {path === '/tyzden' && <><div className="week-intro"><div className="week-title"><CalendarDays size={24}/><h2>{fmt(week)} – {fmt(addDays(week, 6), { day: 'numeric', month: 'long', year: 'numeric' })}</h2></div><div className="week-steps"><PlannerLink href="/kompas"><span>1</span>Pripomeň si smer</PlannerLink><PlannerLink href="/ciele"><span>2</span>Pozri svoje roly</PlannerLink><button onClick={() => newTask({ bigRock: true })}><span>3</span>Vyber veľké kamene</button><a href="#week-board"><span>4</span>Vyhraď im čas</a></div></div><div className="week-layout"><section className="panel weekly-compass"><div className="panel-heading"><h2><Compass size={19}/> Týždenný kompas</h2></div><p className="muted">Čo je najdôležitejšie v každej tvojej role?</p>{roles.length ? roles.map(r => <div className="role-rocks" key={r.id}><h3><i style={{ background: r.color }}/>{r.title}</h3>{rocks.filter(t => t.roleId === r.id).map(t => taskRow(t, true))}<button className="text-btn" onClick={() => newTask({ bigRock: true, roleId: r.id, quadrant: '2' })}><Plus size={14}/> Dôležitý krok</button></div>) : <Empty icon={Users} title="Začni svojimi rolami" action={<PlannerLink className="btn" href="/ciele">Nastaviť životné roly</PlannerLink>}>Rodina, práca, vzťahy a vlastná obnova.</Empty>}<div className="renewal"><Leaf size={18}/><div><b>Nezabudni na obnovu</b><p>Telo · myseľ · vzťahy · duchovný život</p><button className="text-btn" onClick={() => newTask({ title: 'Čas na vlastnú obnovu', bigRock: true, quadrant: '2' })}>Vyhradiť čas</button></div></div></section><div className="week-board" id="week-board">{Array.from({ length: 7 }, (_, i) => addDays(week, i)).map(d => <section className={'week-day ' + (d === today() ? 'is-today' : '')} key={d} onDragOver={e => e.preventDefault()} onDrop={e => { const t = tasks.find(x => x.id === e.dataTransfer.getData('text/kompas')); if (t)
            run(() => save({ ...t, date: d, dirty: true })); }}><header><div><b>{fmt(d, { weekday: 'long' })}</b><span>{fmt(d, { day: 'numeric', month: 'numeric' })}</span></div><button aria-label={'Pridať úlohu ' + d} className="icon-btn" onClick={() => newTask({ date: d })}><Plus size={17}/></button></header><div className="week-content">{tasks.filter(t => t.date === d).sort((a, b) => (a.time || '99').localeCompare(b.time || '99')).map(t => <button key={t.id} className={'week-task ' + (t.bigRock ? 'big-rock ' : '') + (t.done ? 'completed' : '')} onClick={() => setEdit({ ...t })} draggable onDragStart={e => e.dataTransfer.setData('text/kompas', t.id)}><span>{t.time || 'Bez času'}{t.bigRock && <Mountain size={13}/>}</span><b>{t.title}</b><small>{role(t.roleId)?.title || t.priority + ' priorita'}</small></button>)}{events.filter(e => eventOnDay(e, d) && !tasks.some(t => t.gcal?.id === e.id)).map(e => <a className="week-task google-event" href={e.htmlLink} target="_blank" rel="noreferrer" key={e.calendarId + e.id}><span>{eventTime(e) || 'Celý deň'} · Google</span><b>{e.title}</b></a>)}{!tasks.some(t => t.date === d) && !events.some(e => eventOnDay(e, d)) && <button className="free-space" onClick={() => newTask({ date: d, bigRock: true })}>Priestor pre tvoje priority<Plus size={18}/></button>}</div></section>)}</div></div><section className="panel week-review"><div><h2>Týždeň sa nekončí odškrtnutím úloh.</h2><p>Čo sa podarilo? Čo chceš nabudúce urobiť inak?</p></div><PlannerLink href="/dennik" className="btn">Reflexia týždňa <ArrowRight size={16}/></PlannerLink></section></>}
        {path === '/ulohy' && <section className="panel full-panel"><div className="filters"><div className="search"><Search size={17}/><input aria-label="Hľadať úlohy" placeholder="Hľadať v úlohách…" value={query} onChange={e => setQuery(e.target.value)}/></div><Pick label="Stav úloh" value={filter} onChange={setFilter} options={[{ value: 'open', label: 'Otvorené úlohy' }, { value: 'all', label: 'Všetky úlohy' }, { value: 'done', label: 'Dokončené' }, { value: 'unscheduled', label: 'Bez dátumu' }]}/><Pick label="Filtrovať podľa roly" value={roleFilter} onChange={setRoleFilter} options={[{ value: '', label: 'Všetky roly' }, ...roles.map(r => ({ value: r.id, label: r.title }))]}/><button className="btn" onClick={() => newTask({ date: '' })}><Plus size={16}/> Do zásobníka</button></div>{['A', 'B', 'C'].map(p => { const ts = tasks.filter(t => (t.priority || 'B') === p && (!roleFilter || t.roleId === roleFilter) && t.title.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || filter === 'done' && t.done || filter === 'open' && !t.done || filter === 'unscheduled' && !t.date && !t.done)).sort((a, b) => (a.rank || 1) - (b.rank || 1)); return <div className="task-group" key={p}><h3><span className={'priority ' + p.toLowerCase()}>{p}</span>{p === 'A' ? 'Nevyhnutné' : p === 'B' ? 'Dôležité' : 'Voliteľné'}<small>{ts.length}</small></h3>{ts.length ? ts.map(t => <div className="master-task" key={t.id}>{taskRow(t)}<span>{t.date ? fmt(t.date) : 'Bez dátumu'}</span><button className="icon-btn" aria-label={'Upraviť ' + t.title} onClick={() => setEdit({ ...t })}><Pencil size={15}/></button></div>) : <p className="empty-line">Žiadne úlohy v tejto skupine.</p>}</div>; })}</section>}
        {path === '/matica' && <><div className="matrix-caption"><Leaf size={19}/><p><b>Chráň si II. kvadrant.</b> Vzťahy, príprava, prevencia a rozvoj potrebujú vedomé rozhodnutie.</p></div><div className="matrix">{[{ id: '1', roman: 'I', title: 'Dôležité a naliehavé', sub: 'Urob čo najskôr', class: 'q1' }, { id: '2', roman: 'II', title: 'Dôležité, nenaliehavé', sub: 'Naplánuj a chráň si čas', class: 'q2' }, { id: '3', roman: 'III', title: 'Naliehavé, nedôležité', sub: 'Zváž delegovanie', class: 'q3' }, { id: '4', roman: 'IV', title: 'Nedôležité, nenaliehavé', sub: 'Obmedz alebo vynechaj', class: 'q4' }].map(q => <section className={'panel quadrant ' + q.class} key={q.id} onDragOver={e => e.preventDefault()} onDrop={e => { const t = tasks.find(x => x.id === e.dataTransfer.getData('text/kompas')); if (t)
            run(() => save({ ...t, quadrant: q.id })); }}><header><span className="roman">{q.roman}</span><div><h2>{q.title}</h2><p>{q.sub}</p></div><span className="count">{tasks.filter(t => t.quadrant === q.id && !t.done).length}</span></header>{tasks.filter(t => t.quadrant === q.id && !t.done).map(t => taskRow(t))}<button className="quadrant-add" onClick={() => newTask({ quadrant: q.id, date: '' })}><Plus size={16}/> Pridať úlohu</button></section>)}</div><p className="footnote">Kvadrant vyjadruje dôležitosť a naliehavosť. A/B/C určuje poradie realizácie; tieto dve označenia sa nastavujú samostatne.</p></>}
        {path === '/ciele' && <><div className="section-heading"><h2>Moje životné roly</h2><button className="btn" onClick={() => setEdit(fresh('role', { title: '', description: '', color: colors[roles.length % colors.length] }))}><Plus size={16}/> Nová rola</button></div>{!roles.length ? <div className="panel onboarding-roles"><Users size={30}/><h2>Kým chceš byť pre ľudí, na ktorých ti záleží?</h2><p>Začni so vzorovými rolami a uprav si ich podľa seba.</p><div className="role-suggestions">{['Partner', 'Rodič', 'Práca', 'Podnikanie', 'Priatelia a rodina', 'Duchovný život', 'Vlastná obnova'].map((r, i) => <span key={r}><i style={{ background: colors[i] }}/>{r}</span>)}</div><button className="btn primary" disabled={busy} onClick={() => run(async () => { for (const [i, title] of ['Partner', 'Rodič', 'Práca', 'Podnikanie', 'Priatelia a rodina', 'Duchovný život', 'Vlastná obnova'].entries())
            await save(fresh('role', { title, color: colors[i], description: '' })); })}>Použiť tieto roly</button></div> : <div className="role-grid">{roles.map(r => <section className="panel role-card" key={r.id} style={{ borderTopColor: r.color }}><div><span className="role-icon" style={{ color: r.color, background: r.color + '15' }}><Users size={20}/></span><button className="icon-btn" aria-label={'Upraviť rolu ' + r.title} onClick={() => setEdit({ ...r })}><Pencil size={15}/></button></div><h2>{r.title}</h2><p>{r.description || 'Čo pre teba znamená dobre žiť túto rolu?'}</p><footer><span>{goals.filter(g => g.roleId === r.id).length} cieľov</span><button className="text-btn" onClick={() => setEdit(fresh('goal', { title: '', roleId: r.id, why: '', date: '', done: false }))}><Plus size={14}/> Cieľ</button></footer></section>)}</div>}<div className="section-heading"><h2>Dlhodobé ciele a ďalšie kroky</h2><button className="btn primary" onClick={() => setEdit(fresh('goal', { title: '', roleId: '', why: '', date: '', done: false }))}><Plus size={16}/> Nový cieľ</button></div>{!goals.length ? <section className="panel"><Empty icon={Target} title="Daj svojim rolám konkrétny smer">Pomenuj výsledok, dôvod a najbližší malý krok.</Empty></section> : <div className="goals-grid">{goals.map(g => { const steps = tasks.filter(t => t.goalId === g.id); const progress = steps.length ? Math.round(steps.filter(t => t.done).length / steps.length * 100) : 0; return <section className="panel goal-card" key={g.id}><div className="goal-top"><span className="tag">{role(g.roleId)?.title || 'Osobný cieľ'}</span><button className="icon-btn" aria-label={'Upraviť cieľ ' + g.title} onClick={() => setEdit({ ...g })}><Pencil size={15}/></button></div><h2 className={g.done ? 'completed' : ''}>{g.title}</h2><p>{g.why || 'Doplň, prečo je tento cieľ dôležitý.'}</p><div className="goal-progress"><span>{g.done ? 'Cieľ dosiahnutý' : progress + ' % krokov dokončených'}</span><span>{g.date ? fmt(g.date, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Bez termínu'}</span></div><Progress value={g.done ? 100 : progress}/>{steps.map(t => taskRow(t, true))}<button className="text-btn" onClick={() => newTask({ goalId: g.id, roleId: g.roleId, date: '', bigRock: true })}><Plus size={15}/> Pridať ďalší krok</button></section>; })}</div>}</>}
        {path === '/kompas' && <div className="compass-layout"><section className="panel mission-panel"><div className="section-kicker"><Compass size={24}/> OSOBNÉ POSLANIE</div><h2>Aký život chcem žiť?</h2><p>Napíš si vlastnými slovami, kým chceš byť a čím chceš prispieť.</p><MissionEditor key={compass?.revision || 0} record={compass || { id: 'my-compass', kind: 'compass', revision: 0, mission: '', vision: '' }} save={save}/></section><section className="panel values-panel"><div className="panel-heading"><h2><Heart size={18}/> Moje hodnoty</h2><button className="icon-btn" aria-label="Pridať hodnotu" onClick={() => setEdit(fresh('value', { title: '', description: '', rank: values.length + 1 }))}><Plus size={19}/></button></div><p className="muted">Čo je pre teba najdôležitejšie a ako sa to prejaví v konaní?</p>{values.map((v, i) => <button key={v.id} className="value-item" onClick={() => setEdit({ ...v })}><span>{String(i + 1).padStart(2, '0')}</span><div><h3>{v.title}</h3><p>{v.description || 'Doplň konkrétny prejav tejto hodnoty.'}</p></div><Pencil size={14}/></button>)}{!values.length && <Empty icon={Heart} title="Pomenuj svoje hodnoty">Napríklad rodina, viera, zdravie, čestnosť alebo služba. Vyber tie vlastné.</Empty>}<button className="btn" onClick={() => setEdit(fresh('value', { title: '', description: '', rank: values.length + 1 }))}><Plus size={16}/> Pridať hodnotu</button></section><section className="panel principles-panel"><h2>Od smeru ku konkrétnemu kroku</h2><div className="principles"><div><span>01</span><b>Hodnoty a poslanie</b><p>Čo považujem za dôležité?</p></div><div><span>02</span><b>Roly a ciele</b><p>Čím chcem prispieť a kam sa posunúť?</p></div><div><span>03</span><b>Týždenné priority</b><p>Čo tomu tento týždeň venujem?</p></div><div><span>04</span><b>Dnešné konanie</b><p>Aký konkrétny krok urobím dnes?</p></div></div><PlannerLink href="/tyzden" className="btn primary">Preniesť smer do týždňa <ArrowRight size={16}/></PlannerLink></section></div>}
        {path === '/dennik' && <Tabs defaultValue="daily" className="journal-tabs"><TabsList><TabsTrigger value="daily">Denné poznámky</TabsTrigger><TabsTrigger value="weekly">Týždenná reflexia</TabsTrigger><TabsTrigger value="gaps">Tri rozdiely</TabsTrigger></TabsList><TabsContent value="daily"><section className="panel journal-paper"><div className="panel-heading"><h2>{fmt(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2><BookOpen size={20}/></div><NoteEditor key={date + ':' + (records.find(r => r.id === 'journal-' + date)?.revision || 0)} record={records.find(r => r.id === 'journal-' + date) || { id: 'journal-' + date, kind: 'journal', revision: 0, date, content: '' }} save={save}/></section></TabsContent><TabsContent value="weekly"><section className="panel"><h2>Týždeň {fmt(week)} – {fmt(addDays(week, 6))}</h2><ReviewEditor key={week + ':' + (records.find(r => r.id === 'review-' + week)?.revision || 0)} record={records.find(r => r.id === 'review-' + week) || { id: 'review-' + week, kind: 'review', revision: 0, date: week }} fields={['Čo sa podarilo a za čo som vďačný?', 'Dostal sa čas na moje najdôležitejšie roly a priority?', 'Čo upravím v ďalšom týždni?']} save={save}/></section></TabsContent><TabsContent value="gaps"><div className="gaps-intro"><h2>Zmenši rozdiel medzi zámerom a životom.</h2><p>Vlastná reflexia inšpirovaná knihou The 3 Gaps. Zvoľ jeden konkrétny krok.</p></div><section className="panel"><ReviewEditor key={date + ':' + (records.find(r => r.id === 'gaps-' + date)?.revision || 0)} record={records.find(r => r.id === 'gaps-' + date) || { id: 'gaps-' + date, kind: 'review', revision: 0, date }} fields={['Presvedčenia: Ktorý predpoklad ovplyvňuje moje správanie? Čo ukazujú skúsenosti?', 'Hodnoty: Kde sa moje konanie rozchádza s tým, čo považujem za dôležité?', 'Čas: Čomu venujem čas a akú zmenu urobím, aby lepšie slúžil mojim hodnotám?']} save={save}/></section></TabsContent></Tabs>}
        {path === '/nastavenia' && <div className="settings-layout"><section className="panel"><div className="panel-heading"><h2><CalendarDays size={21}/> Google kalendár</h2><span className={'connection-badge ' + (googleStatus.connected ? 'connected' : '')}>{googleStatus.connected ? 'Pripojený' : 'Nepripojený'}</span></div><p className="settings-lead">Udalosti z Googlu v tvojom pláne. Vybrané časové bloky z Kompasu v Google kalendári.</p>{googleStatus.connected ? <><div className="connection-box"><ShieldCheck /><div><b>Pripojenie je aktívne</b><p>{googleStatus.lastSync ? 'Posledná synchronizácia: ' + new Date(googleStatus.lastSync).toLocaleString('sk-SK', { timeZone: 'Europe/Bratislava' }) : 'Čaká na prvú synchronizáciu.'}</p></div></div><label className="field">Nové udalosti zapisovať do<Pick label="Cieľový Google kalendár" value={writeCal} onChange={setWriteCal} options={calendarList.filter(c => ['owner', 'writer'].includes(c.accessRole)).map(c => ({ value: c.id, label: c.title }))}/></label><h3>Zobrazovať tieto kalendáre</h3><div className="calendar-checks">{calendarList.map(c => <label key={c.id}><Checkbox checked={readCals.includes(c.id)} onCheckedChange={v => setReadCals(v ? [...readCals, c.id] : readCals.filter(x => x !== c.id))}/>{c.title}</label>)}</div><div className="button-row"><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api('/api/google/preferences', { calendarId: writeCal, readCalendars: readCals }); await status(); await syncNow(); setNotice('Kalendáre uložené'); })}>Uložiť výber</button><button className="btn" disabled={syncing} onClick={syncNow}><RefreshCw size={16} className={syncing ? 'spin' : ''}/>Synchronizovať</button><button className="text-btn danger" onClick={() => setRemove({ id: 'google', kind: 'connection', title: 'Google účet' })}><Unplug size={16}/> Odpojiť</button></div></> : <><div className="connection-box amber"><Link2 /><div><b>Vyžaduje vlastné pripojenie aplikácie</b><p>Google doplnok v ChatGPT neposkytuje tejto aplikácii automatický prístup. Najprv nastav OAuth aplikáciu a potom povoľ prístup k svojmu kalendáru.</p></div></div><details className="setup-guide" open={!googleStatus.configured}><summary>Jednorazové nastavenie Google pripojenia</summary><ol><li>V <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud Console</a> vytvor alebo vyber projekt a zapni Google Calendar API.</li><li>V Google Auth Platform nastav súhlas, typ publika a pri testovacom režime pridaj svoj Google účet medzi testovacích používateľov.</li><li>Vytvor OAuth klienta typu <b>Web application</b>. Medzi autorizované presmerovania vlož túto adresu:<code>{googleStatus.callback || 'Načítavam adresu…'}</code></li><li>Skopíruj Client ID a Client Secret do polí nižšie. Nie je to heslo tvojho Google účtu.</li></ol><form onSubmit={e => { e.preventDefault(); run(async () => { await api('/api/google/configure', { clientId, clientSecret }); setClientSecret(''); setClientId(''); await status(); setNotice('Google OAuth nastavenie uložené'); }); }}><label className="field">Google Client ID<input required value={clientId} onChange={e => setClientId(e.target.value)} placeholder="…apps.googleusercontent.com" autoComplete="off"/></label><label className="field">Google Client Secret<input required type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} autoComplete="new-password"/></label><button className="btn" disabled={busy}>Uložiť nastavenie pripojenia</button></form><p className="footnote">Údaje sa ukladajú iba na serveri. Google projekt v testovacom režime môže vyžadovať obnovenie súhlasu po vypršaní prístupu.</p></details><button className="btn primary" disabled={!googleStatus.configured || busy} onClick={() => run(async () => { const j = await api('/api/google/connect', {}); window.location.assign(j.url); })}><CalendarDays size={17}/>Pripojiť Google účet</button></>}<div className="sync-explanation"><h3>Ako synchronizácia funguje</h3><ul><li>Pri otvorenej aplikácii sa obnovuje každú minútu a tlačidlom Synchronizovať.</li><li>Do Googlu sa posielajú iba úlohy s dátumom, časom a zapnutou voľbou „Synchronizovať s Googlom“.</li><li>Úpravy názvu, času a poznámok prepojených úloh sa prenášajú oboma smermi. Pri súbežných úpravách sa zobrazí konflikt.</li><li>Odstránenie prepojenej úlohy odstráni jej udalosť pri ďalšej synchronizácii. Cudzie udalosti otvoríš a upravíš v Google kalendári.</li><li>Dokončenie úlohy nemení udalosť v Googli. Bez otvorenej aplikácie sa synchronizácia nespúšťa.</li></ul></div></section><aside><section className="panel account-panel"><h2><ShieldCheck size={19}/> Prihlásený účet</h2><b>{user.email || user.name || 'Používateľ Kompasu'}</b><p>Tento účet prepája tvoje údaje medzi telefónom a počítačom.</p><button className="btn" onClick={() => void onSignOut()}><LogOut size={16}/> Odhlásiť sa</button></section><section className="panel"><h2><Cloud size={19}/> Moje údaje</h2><p>Úlohy, ciele, poslanie a poznámky sa ukladajú online pod tvojím účtom. Uložené údaje sú dostupné aj pri ďalšej návšteve.</p><button className="btn" onClick={() => { const safe = records.filter(r => !r.deleted).map(({ gcal, ...r }) => r); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ exported: new Date().toISOString(), records: safe }, null, 2)], { type: 'application/json' })); a.download = 'kompas-zaloha-' + today() + '.json'; a.click(); URL.revokeObjectURL(a.href); }}><Download size={16}/> Exportovať moje údaje</button><p className="footnote">Export obsahuje tvoj plán a poznámky. Neobsahuje Google prihlasovacie údaje.</p></section><section className="panel source-panel"><h2>Na čom plánovač stojí</h2><p><b>Stephen R. Covey</b><br />The 7 Habits… Personal Workbook<br /><small>3. návyk: dôležitosť, roly a týždenné priority.</small></p><p><b>Hyrum W. Smith</b><br />The 10 Natural Laws…<br /><small>Hodnoty, ciele a každodenné konanie.</small></p><p>The Advanced Day Planner User’s Guide<br /><small>Denné úlohy, plánovanie a poznámky.</small></p><p>The 3 Gaps<br /><small>Reflexia presvedčení, hodnôt a času.</small></p><a href="https://www.planplusonline.com/online-planner-2/" target="_blank" rel="noreferrer">Inšpirácia: PlanPlus Online <ArrowUpRight size={13}/></a><p className="footnote">Samostatná aplikácia inšpirovaná princípmi uvedených kníh; nejde o oficiálny produkt ich autorov ani PlanPlus.</p></section></aside></div>}
        </>}{syncErrors.length > 0 && <section className="sync-errors" role="status"><h3>Synchronizácia vyžaduje pozornosť</h3>{syncErrors.map((e, i) => <p key={i}>{e}</p>)}<PlannerLink href="/nastavenia">Otvoriť nastavenia</PlannerLink></section>}<footer className="workspace-footer"><span><Compass size={13}/> Kompas · Najprv to najdôležitejšie</span><span>Europe/Bratislava{(googleStatus.connected || ticktickStatus.connected) && <button onClick={() => void syncAllNow()} disabled={syncing || ticktickSyncing}><RefreshCw size={13} className={syncing || ticktickSyncing ? 'spin' : ''}/>{syncing || ticktickSyncing ? 'Synchronizujem…' : 'Synchronizovať'}</button>}</span></footer>
    </main></SidebarInset>
    <Dialog open={!!edit} onOpenChange={o => !o && !busy && setEdit(null)}><DialogContent className="edit-dialog"><DialogHeader><DialogTitle>{edit?.revision ? 'Upraviť' : 'Pridať'} {edit?.kind === 'task' ? 'úlohu' : edit?.kind === 'role' ? 'rolu' : edit?.kind === 'goal' ? 'cieľ' : 'hodnotu'}</DialogTitle><DialogDescription>{edit?.kind === 'task' ? 'Prepoj prioritu so svojou rolou a vyhraď jej čas.' : 'Pomenuj to, na čom ti záleží.'}</DialogDescription></DialogHeader>{edit && <form onSubmit={e => { e.preventDefault(); run(async () => { await save(edit); setEdit(null); if (googleStatus.connected)
        await syncNow(); }); }}>{error && <p className="error" role="alert">{error}</p>}<label className="field">Názov<input required maxLength={500} autoFocus value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} placeholder={edit.kind === 'task' ? 'Čo chcem urobiť?' : 'Názov'}/></label>{edit.kind === 'task' && <><div className="form-grid"><label className="field">Priorita<Pick label="Priorita" value={edit.priority || 'B'} onChange={v => setEdit({ ...edit, priority: v })} options={[{ value: 'A', label: 'A · nevyhnutné' }, { value: 'B', label: 'B · dôležité' }, { value: 'C', label: 'C · voliteľné' }]}/></label><label className="field">Poradie<input type="number" min="1" max="99" value={edit.rank || 1} onChange={e => setEdit({ ...edit, rank: Number(e.target.value) })}/></label><label className="field">Dátum<input type="date" value={edit.date || ''} onChange={e => setEdit({ ...edit, date: e.target.value })}/></label><label className="field">Začiatok<input type="time" value={edit.time || ''} onChange={e => setEdit({ ...edit, time: e.target.value })}/></label><label className="field">Trvanie v minútach<input type="number" min="5" max="1440" step="5" value={edit.duration || 60} onChange={e => setEdit({ ...edit, duration: Number(e.target.value) })}/></label><label className="field">Kvadrant<Pick label="Kvadrant" value={edit.quadrant || '2'} onChange={v => setEdit({ ...edit, quadrant: v })} options={[{ value: '1', label: 'I · dôležité, naliehavé' }, { value: '2', label: 'II · dôležité, nenaliehavé' }, { value: '3', label: 'III · nedôležité, naliehavé' }, { value: '4', label: 'IV · nedôležité, nenaliehavé' }]}/></label></div><div className="form-grid"><label className="field">Životná rola<Pick label="Životná rola" value={edit.roleId || ''} onChange={v => setEdit({ ...edit, roleId: v })} options={[{ value: '', label: 'Bez roly' }, ...roles.map(r => ({ value: r.id, label: r.title }))]}/></label><label className="field">Súvisiaci cieľ<Pick label="Súvisiaci cieľ" value={edit.goalId || ''} onChange={v => setEdit({ ...edit, goalId: v, roleId: goals.find(g => g.id === v)?.roleId || edit.roleId })} options={[{ value: '', label: 'Bez cieľa' }, ...goals.map(g => ({ value: g.id, label: g.title }))]}/></label></div><label className="check-field"><Checkbox checked={!!edit.bigRock} onCheckedChange={v => setEdit({ ...edit, bigRock: !!v })}/><span><b>Veľký kameň</b><small>Jedna z najdôležitejších priorít týždňa.</small></span><Mountain size={20}/></label><label className="field">Poznámky<textarea value={edit.notes || ''} onChange={e => setEdit({ ...edit, notes: e.target.value })}/></label><label className="check-field"><Checkbox checked={!!edit.sync} disabled={!googleStatus.connected && !edit.sync} onCheckedChange={v => setEdit({ ...edit, sync: !!v, dirty: true })}/><span><b>Synchronizovať s Googlom</b><small>{googleStatus.connected ? 'Vyžaduje dátum a čas.' : 'Najprv pripoj Google účet v nastaveniach.'}</small></span></label>{edit.kind === 'task' && !googleStatus.connected && edit.date && edit.time && <a className="btn google-template" href={googleTemplate(edit)} target="_blank" rel="noreferrer"><CalendarDays size={16}/> Pridať do Google kalendára</a>}{edit.sync && edit.date && edit.time && tasks.some(t => t.id !== edit.id && t.date === edit.date && t.time && startMinutes(t.time) < startMinutes(edit.time) + Number(edit.duration || 60) && startMinutes(t.time) + Number(t.duration || 60) > startMinutes(edit.time)) && <p className="conflict-warning">Tento čas sa prekrýva s inou úlohou v pláne.</p>}{edit.gcal && <button type="button" className="text-btn" onClick={() => run(async () => { await api('/api/google/resolve', { id: edit.id }); setEdit(null); await syncNow(); })}>Prevziať názov, čas a poznámky z Googlu</button>}</>}{edit.kind === 'role' && <><label className="field">Čo pre mňa táto rola znamená<textarea value={edit.description || ''} onChange={e => setEdit({ ...edit, description: e.target.value })}/></label><label className="field">Farba roly<input type="color" value={edit.color || colors[0]} onChange={e => setEdit({ ...edit, color: e.target.value })}/></label></>}{edit.kind === 'goal' && <><label className="field">Prečo je tento cieľ dôležitý<textarea value={edit.why || ''} onChange={e => setEdit({ ...edit, why: e.target.value })}/></label><div className="form-grid"><label className="field">Rola<Pick label="Rola cieľa" value={edit.roleId || ''} onChange={v => setEdit({ ...edit, roleId: v })} options={[{ value: '', label: 'Bez roly' }, ...roles.map(r => ({ value: r.id, label: r.title }))]}/></label><label className="field">Termín<input type="date" value={edit.date || ''} onChange={e => setEdit({ ...edit, date: e.target.value })}/></label></div><label className="check-field"><Checkbox checked={!!edit.done} onCheckedChange={v => setEdit({ ...edit, done: !!v })}/>Cieľ je dosiahnutý</label></>}{edit.kind === 'value' && <><label className="field">Ako túto hodnotu žijem<textarea value={edit.description || ''} onChange={e => setEdit({ ...edit, description: e.target.value })} placeholder="Konkrétne správanie, podľa ktorého spoznám, že ju žijem."/></label><label className="field">Poradie dôležitosti<input type="number" min="1" value={edit.rank || 1} onChange={e => setEdit({ ...edit, rank: +e.target.value })}/></label></>}<div className="dialog-actions">{!!edit.revision && <button type="button" className="icon-btn danger" aria-label="Odstrániť záznam" onClick={() => setRemove(edit)}><Trash2 size={18}/></button>}<button type="button" className="btn" onClick={() => setEdit(null)} disabled={busy}>Zrušiť</button><button className="btn primary" disabled={busy}><Save size={16}/>{busy ? 'Ukladám…' : 'Uložiť'}</button></div></form>}</DialogContent></Dialog>
    <AlertDialog open={!!remove} onOpenChange={o => !o && setRemove(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{remove?.kind === 'connection' ? `Odpojiť ${remove.id === 'ticktick' ? 'TickTick' : 'Google účet'}?` : 'Odstrániť tento záznam?'}</AlertDialogTitle><AlertDialogDescription>{remove?.title}. {remove?.kind === 'connection' ? remove.id === 'ticktick' ? 'Úlohy v TickTicku aj Kompase zostanú zachované.' : 'Udalosti v Googli zostanú zachované.' : remove?.gcal ? 'Prepojená udalosť sa pri synchronizácii odstráni aj z Google kalendára.' : 'Súvisiace úlohy sa neodstránia.'}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Zrušiť</AlertDialogCancel><AlertDialogAction onClick={() => { if (!remove)
        return; const r = remove; setRemove(null); run(async () => { if (r.kind === 'connection') {
        if (r.id === 'ticktick') {
            await api('/api/ticktick/disconnect', {});
            await ticktickStatusLoad();
            setTicktickResult(null);
            setTicktickErrors([]);
        }
        else {
            await api('/api/google/disconnect', {});
            await status();
            setEvents([]);
        }
    }
    else {
        await save({ ...r, deleted: true, dirty: true });
        setEdit(null);
        if (googleStatus.connected)
            await syncNow();
    } }); }}>Potvrdiť</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </SidebarProvider>;
}
function TickTickSettings({ status, syncing, result, errors, onRefresh, onSync, onDisconnect, notify }: {
    status: any;
    syncing: boolean;
    result: any;
    errors: string[];
    onRefresh: () => Promise<any>;
    onSync: () => Promise<any>;
    onDisconnect: () => void;
    notify: (message: string) => void;
}) {
    const [projects, setProjects] = useState<any[]>([]);
    const [projectId, setProjectId] = useState(status.projectId || '');
    const [working, setWorking] = useState(false);
    const [localError, setLocalError] = useState('');
    useEffect(() => {
        if (!status.connected)
            return;
        api('/api/ticktick/projects').then(j => {
            setProjects(j.projects || []);
            setProjectId((current: string) => current || status.projectId || '');
        }).catch(e => setLocalError(e.message));
    }, [status.connected, status.projectId]);
    const act = async (fn: () => Promise<void>) => {
        setWorking(true);
        setLocalError('');
        try {
            await fn();
        }
        catch (e) {
            setLocalError((e as Error).message);
        }
        finally {
            setWorking(false);
        }
    };
    const stats = result?.stats;
    return <section className="panel ticktick-settings"><div className="panel-heading"><h2><CheckSquare size={21}/> TickTick úlohy</h2><span className={'connection-badge ' + (status.connected ? 'connected' : '')}>{status.connected ? 'Pripojený' : 'Nepripojený'}</span></div><p className="settings-lead">TickTick je hlavný správca úloh. Kompas ich dopĺňa o roly, ciele, veľké kamene, priority a miesto v týždni.</p>
        {status.connected ? <><div className="connection-box"><ShieldCheck /><div><b>TickTick má pri konflikte vždy prednosť</b><p>{status.lastSync ? 'Posledná synchronizácia: ' + new Date(status.lastSync).toLocaleString('sk-SK', { timeZone: 'Europe/Bratislava' }) : 'Čaká na prvú bezpečnú synchronizáciu.'}</p></div></div><label className="field">Nové úlohy z Kompasu zapisovať do<Pick label="Cieľový TickTick zoznam" value={projectId} onChange={setProjectId} options={projects.filter(project => project.permission !== 'read').map(project => ({ value: project.id, label: project.name }))}/></label><div className="button-row"><button className="btn primary" disabled={working || !projectId} onClick={() => void act(async () => { await api('/api/ticktick/preferences', { projectId }); await onRefresh(); notify('TickTick zoznam bol uložený'); })}>Uložiť zoznam</button><button className="btn" disabled={syncing || working} onClick={() => void onSync()}><RefreshCw size={16} className={syncing ? 'spin' : ''}/>{syncing ? 'Synchronizujem…' : 'Synchronizovať teraz'}</button><button className="text-btn danger" onClick={onDisconnect}><Unplug size={16}/> Odpojiť</button></div>{stats && <div className="sync-summary"><b>Posledný výsledok</b><p>{stats.remote} otvorených v TickTicku · {stats.matched} spárovaných · {stats.createdInKompas} pridaných do Kompasu · {stats.createdInTicktick} pridaných do TickTicku</p></div>}</> : <><div className="connection-box amber"><Link2 /><div><b>Oficiálne pripojenie cez TickTick MCP a OAuth</b><p>API token ani heslo sa nevkladajú. TickTick otvorí vlastnú prihlasovaciu stránku, kde povolíš Kompasu čítať a upravovať úlohy.</p></div></div><div className="setup-guide"><h3>Jednorazové bezpečné pripojenie</h3><ol><li>Klikni na tlačidlo nižšie.</li><li>V TickTicku sa prihlás a povoľ prístup k úlohám.</li><li>Po návrate Kompas automaticky začne prvé bezpečné párovanie.</li></ol><button className="btn primary" disabled={working || syncing} onClick={() => void act(async () => { const connected = await api('/api/ticktick/connect', {}); window.location.assign(connected.url); })}><Link2 size={16}/>{working ? 'Pripájam…' : 'Pripojiť TickTick'}</button><p className="footnote">Použije sa oficiálny server <b>mcp.ticktick.com</b> a oprávnenia iba na čítanie a zápis úloh.</p></div></>}
        {(localError || errors.length > 0) && <div className="error" role="alert">{localError && <p>{localError}</p>}{errors.map((message, index) => <p key={index}>{message}</p>)}</div>}
        <div className="sync-explanation"><h3>Ako synchronizácia funguje</h3><ul><li>Pri otvorení Kompasu, každú minútu počas používania a tlačidlom vyššie.</li><li>Ak sa rovnaká úloha zmení na oboch miestach, Kompas prevezme verziu z TickTicku.</li><li>Prvé spojenie najskôr páruje existujúce úlohy podľa názvu, dátumu a času. Nejasnú zhodu nevytvorí ani neprepíše.</li><li>TickTick spravuje samotné úlohy. Roly, ciele, kvadranty a veľké kamene zostávajú plánovacou vrstvou Kompasu.</li><li>TickTick momentálne neposkytuje zdokumentované webhooky, preto sa bez otvoreného Kompasu synchronizácia nespúšťa.</li></ul></div>
    </section>;
}
function NoteEditor({ record, save, compact = false }: {
    record: Rec;
    save: (r: Rec) => Promise<any>;
    compact?: boolean;
}) { const [text, setText] = useState(record.content || ''); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); return <form className={'note-editor ' + (compact ? 'compact' : '')} onSubmit={async (e) => { e.preventDefault(); setSaving(true); try {
    await save({ ...record, content: text });
}
catch (e) {
    setError((e as Error).message);
}
finally {
    setSaving(false);
} }}><textarea aria-label="Denné poznámky" value={text} onChange={e => setText(e.target.value)} placeholder={compact ? 'Myšlienka, nápad alebo niečo, na čo nechcem zabudnúť…' : 'Čo bolo dnes dôležité? Čo som si uvedomil? Čo si chcem zapamätať?'} maxLength={40000}/>{error && <p className="error">{error}</p>}<div className="editor-footer"><small>{text !== record.content && text ? 'Neuložené zmeny' : 'Moje poznámky'}</small><button className="text-btn" disabled={saving}>{saving ? 'Ukladám…' : 'Uložiť poznámky'}</button></div></form>; }
function MissionEditor({ record, save }: {
    record: Rec;
    save: (r: Rec) => Promise<any>;
}) { const [r, setR] = useState(record); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); return <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); try {
    await save(r);
}
catch (e) {
    setError((e as Error).message);
}
finally {
    setBusy(false);
} }}><label className="field">Moje základné princípy<textarea value={r.principles || ''} onChange={e => setR({ ...r, principles: e.target.value })} placeholder="Podľa čoho sa rozhodujem a žijem…"/></label><label className="field">Moje poslanie<textarea className="mission-input" value={r.mission || ''} onChange={e => setR({ ...r, mission: e.target.value })} placeholder="Chcem byť človekom, ktorý…"/></label><label className="field">Moja vízia do budúcnosti<textarea value={r.vision || ''} onChange={e => setR({ ...r, vision: e.target.value })} placeholder="Keď sa raz obzriem späť, chcem vidieť…"/></label><label className="field">Môj štýl života · 7 návykov<textarea value={r.habits || ''} onChange={e => setR({ ...r, habits: e.target.value })} placeholder="Návyky, podľa ktorých chcem žiť…"/></label><label className="field">Moje každodenné obnovovanie · 4 dimenzie<textarea value={r.renewal || ''} onChange={e => setR({ ...r, renewal: e.target.value })} placeholder="Ako sa starám o telo, ducha, myseľ a vzťahy…"/></label><label className="field">Môj životný postoj a dedičstvo<textarea value={r.legacy || ''} onChange={e => setR({ ...r, legacy: e.target.value })} placeholder="Čo chcem odovzdať svojim blízkym…"/></label>{error && <p className="error">{error}</p>}<button className="btn primary" disabled={busy}><Save size={16}/>{busy ? 'Ukladám…' : 'Uložiť môj kompas'}</button></form>; }
function ReviewEditor({ record, fields, save }: {
    record: Rec;
    fields: string[];
    save: (r: Rec) => Promise<any>;
}) { const [r, setR] = useState(record); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); return <form className="review-form" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try {
    await save(r);
}
catch (e) {
    setError((e as Error).message);
}
finally {
    setBusy(false);
} }}>{fields.map((f, i) => <label className="field" key={f}><span><b className="question-number">0{i + 1}</b>{f}</span><textarea value={r['answer' + i] || ''} onChange={e => setR({ ...r, ['answer' + i]: e.target.value })} placeholder="Moja odpoveď…"/></label>)}{error && <p className="error">{error}</p>}<button className="btn primary" disabled={busy}><Save size={16}/>{busy ? 'Ukladám…' : 'Uložiť reflexiu'}</button></form>; }
