const { useState, useEffect } = React;

/* ============================== Constants ============================== */

const THEMES = [
  { id: 'discovery', code: 'CH-01', title: 'Problem Discovery & UATs',      chip: 'var(--cyan)',   chipDim: 'var(--cyan-dim)' },
  { id: 'docs',      code: 'CH-02', title: 'Documentation & Reviews',       chip: 'var(--amber)',  chipDim: 'var(--amber-dim)' },
  { id: 'proto',     code: 'CH-03', title: 'Prototyping & Experiments',     chip: 'var(--purple)', chipDim: 'var(--purple-dim)' },
  { id: 'testing',   code: 'CH-04', title: 'Testing & Bug Fixes',           chip: 'var(--green)',  chipDim: 'var(--green-dim)' }
];

const MEETING_TYPES = {
  pod:      { label: 'POD Connect',     color: 'var(--cyan)',   dim: 'var(--cyan-dim)' },
  mentor:   { label: 'Mentor Sync',     color: 'var(--amber)',  dim: 'var(--amber-dim)' },
  champion: { label: 'Champion Review', color: 'var(--purple)', dim: 'var(--purple-dim)' },
  sprint:   { label: 'Sprint Call',     color: 'var(--green)',  dim: 'var(--green-dim)' }
};

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const STORAGE_KEY = 'control-centre-state';

/* ============================== Helpers ============================== */

function uid(){
  return (crypto.randomUUID) ? crypto.randomUUID() : 'id-' + Date.now() + Math.random().toString(16).slice(2);
}

function todayISO(){
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

function isoOf(date){
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function getMonday(date){
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d;
}

function getParity(monday){
  const ref = getMonday(new Date('2024-01-01T00:00:00'));
  const diffDays = Math.round((monday - ref) / 86400000);
  const weeks = Math.round(diffDays / 7);
  return (((weeks % 2) + 2) % 2 === 0) ? 'A' : 'B';
}

function themeById(id){
  return THEMES.find(t => t.id === id);
}

function getSeedData(){
  return {
    meetings: [
      { id: uid(), name: 'Sprint Planning',  type: 'sprint',   weekday: 0, time: '10:00', cadence: 'weekly',      parity: 'A' },
      { id: uid(), name: 'POD Connect',      type: 'pod',      weekday: 1, time: '11:00', cadence: 'weekly',      parity: 'A' },
      { id: uid(), name: 'Mentor Sync',      type: 'mentor',   weekday: 3, time: '16:00', cadence: 'fortnightly', parity: 'A' },
      { id: uid(), name: 'Sprint Review',    type: 'sprint',   weekday: 4, time: '17:00', cadence: 'weekly',      parity: 'A' },
      { id: uid(), name: 'Champion Review',  type: 'champion', weekday: 4, time: '15:00', cadence: 'fortnightly', parity: 'B' }
    ],
    tasks: [
      { id: uid(), theme: 'discovery', title: 'Draft discovery script for pricing flow', status: 'progress', atRisk: false, due: todayISO(), notes: '', link: '' },
      { id: uid(), theme: 'docs',      title: 'PRD: checkout revamp v2',                 status: 'todo',     atRisk: false, due: '',         notes: '', link: '' },
      { id: uid(), theme: 'proto',     title: 'Clickable prototype for onboarding v3',   status: 'todo',     atRisk: false, due: '',         notes: '', link: '' },
      { id: uid(), theme: 'testing',   title: 'UAT sign-off for release 4.2',            status: 'progress', atRisk: true,  due: todayISO(), notes: 'Blocked on data pipeline fix', link: '' }
    ],
    quickLinks: [
      { id: uid(), label: 'PRD Master Folder',   url: 'https://drive.google.com' },
      { id: uid(), label: 'Sprint Tracker Sheet', url: 'https://sheets.google.com' }
    ]
  };
}

/* ============================== Small components ============================== */

function StatChip({ label, value, tone }){
  return (
    <div className={`stat-chip stat-chip--${tone}`}>
      <p className="stat-chip__label">{label}</p>
      <p className="stat-chip__value">{value}</p>
    </div>
  );
}

function DeadlineChip({ task }){
  const today = todayISO();
  const diff = Math.round((new Date(task.due) - new Date(today)) / 86400000);
  const theme = themeById(task.theme);
  let when, color;
  if (diff < 0) { when = `Overdue ${Math.abs(diff)}d`; color = 'var(--red)'; }
  else if (diff === 0) { when = 'Due today'; color = 'var(--red)'; }
  else if (diff === 1) { when = 'Due tomorrow'; color = 'var(--amber)'; }
  else { when = `Due in ${diff}d`; color = 'var(--amber)'; }
  return (
    <div className="deadline-chip" style={{ '--dchip-color': color }}>
      <span className="deadline-chip__code">{theme.code}</span>
      <span className="deadline-chip__title">{task.title}</span>
      <span className="deadline-chip__when">{when}</span>
    </div>
  );
}

function AddMeetingForm({ open, onCancel, onSubmit }){
  const [name, setName] = useState('');
  const [type, setType] = useState('pod');
  const [weekday, setWeekday] = useState(0);
  const [time, setTime] = useState('10:00');
  const [cadence, setCadence] = useState('weekly');
  const [parity, setParity] = useState('A');

  function submit(){
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), type, weekday: Number(weekday), time, cadence, parity });
    setName('');
  }

  return (
    <div className={`add-form${open ? ' open' : ''}`}>
      <div>
        <label>Sync name</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. POD Connect" />
      </div>
      <div>
        <label>Type</label>
        <select value={type} onChange={e => setType(e.target.value)}>
          <option value="pod">POD Connect</option>
          <option value="mentor">Mentor Sync</option>
          <option value="champion">Champion Review</option>
          <option value="sprint">Sprint Call</option>
        </select>
      </div>
      <div>
        <label>Day</label>
        <select value={weekday} onChange={e => setWeekday(e.target.value)}>
          {WEEKDAY_LABELS.map((d, i) => <option key={i} value={i}>{['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][i]}</option>)}
        </select>
      </div>
      <div>
        <label>Time</label>
        <input type="time" value={time} onChange={e => setTime(e.target.value)} />
      </div>
      <div>
        <label>Cadence</label>
        <select value={cadence} onChange={e => setCadence(e.target.value)}>
          <option value="weekly">Weekly</option>
          <option value="fortnightly">Fortnightly</option>
        </select>
      </div>
      {cadence === 'fortnightly' && (
        <div>
          <label>Occurs on</label>
          <select value={parity} onChange={e => setParity(e.target.value)}>
            <option value="A">This week's track</option>
            <option value="B">Alternate track</option>
          </select>
        </div>
      )}
      <div className="full">
        <button className="btn btn--ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn--amber" onClick={submit}>Add to schedule</button>
      </div>
    </div>
  );
}

function ScheduleBoard({ meetings, tasks, weekOffset, setWeekOffset, onDeleteMeeting, onCycleTask, addOpen, setAddOpen, onAddMeeting }){
  const monday = getMonday(new Date(Date.now() + weekOffset * 7 * 86400000));
  const parity = getParity(monday);
  const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
  const todayStr = new Date().toDateString();

  function meetingsForDay(dayIndex){
    return meetings
      .filter(m => m.weekday === dayIndex && (m.cadence === 'weekly' || m.parity === parity))
      .sort((a, b) => a.time.localeCompare(b.time));
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <div>
          <p className="panel__eyebrow">Weekly Flight Schedule</p>
          <h2 className="panel__title">POD · Mentor · Champion · Sprint syncs</h2>
        </div>
        <div className="week-nav">
          <button className="btn" onClick={() => setWeekOffset(w => w - 1)}>&larr; Prev</button>
          <span className="week-range">{monday.getDate()} {MONTHS[monday.getMonth()]} &ndash; {sunday.getDate()} {MONTHS[sunday.getMonth()]}</span>
          <button className="btn" onClick={() => setWeekOffset(w => w + 1)}>Next &rarr;</button>
          <button className="btn" onClick={() => setWeekOffset(0)}>Today</button>
          <button className="btn btn--amber" onClick={() => setAddOpen(o => !o)}>+ Schedule sync</button>
        </div>
      </div>

      <AddMeetingForm open={addOpen} onCancel={() => setAddOpen(false)} onSubmit={m => { onAddMeeting(m); setAddOpen(false); }} />

      <div className="schedule-grid" style={{ marginTop: 14 }}>
        {Array.from({ length: 7 }).map((_, i) => {
          const d = new Date(monday); d.setDate(d.getDate() + i);
          const isToday = d.toDateString() === todayStr;
          const iso = isoOf(d);
          const dayMeetings = meetingsForDay(i);
          const dueTasks = tasks.filter(t => t.due === iso);
          return (
            <div key={i} className={`schedule-day${isToday ? ' is-today' : ''}`}>
              <div className="schedule-day__head">{WEEKDAY_LABELS[i]}<b>{d.getDate()} {MONTHS[d.getMonth()]}</b></div>
              <div className="schedule-day__list">
                {dayMeetings.length === 0 ? (
                  <div className="schedule-day__empty">No syncs</div>
                ) : dayMeetings.map(m => {
                  const t = MEETING_TYPES[m.type];
                  return (
                    <div key={m.id} className="meeting-block" style={{ '--type-color': t.color }}>
                      <button className="meeting-block__del" title="Remove" onClick={() => onDeleteMeeting(m.id)}>&times;</button>
                      <div className="meeting-block__time">{m.time}</div>
                      <div className="meeting-block__name">{m.name}</div>
                      <div className="meeting-block__foot">
                        <span className="pill" style={{ '--pill-color': t.color, '--pill-bg': t.dim }}>{t.label}</span>
                        <span className="pill" style={{ '--pill-color': 'var(--text-lo)', '--pill-bg': 'var(--ink-700)' }}>{m.cadence === 'weekly' ? 'WK' : 'FN'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {dueTasks.length > 0 && (
                <div className="schedule-day__deadlines">
                  {dueTasks.map(t => {
                    const theme = themeById(t.theme);
                    return (
                      <div
                        key={t.id}
                        className={`deadline-mini${t.status === 'done' ? ' is-done' : ''}`}
                        style={{ '--sdchip-color': theme.chip }}
                        title={`${theme.title} — click to update status`}
                        onClick={() => onCycleTask(t.id)}
                      >
                        {t.title}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CalendarPanel({ url, onSave, onHide }){
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(url || '');

  return (
    <section className="panel">
      <div className="panel__head">
        <div>
          <p className="panel__eyebrow">External Feed</p>
          <h2 className="panel__title">Google Calendar</h2>
        </div>
        <div className="week-nav">
          <button className="btn" onClick={() => { setDraft(url || ''); setOpen(o => !o); }}>Connect calendar</button>
          {url && <button className="btn btn--ghost" onClick={onHide}>Hide embed</button>}
        </div>
      </div>
      <div className={`add-form${open ? ' open' : ''}`}>
        <div className="full" style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-lo)', lineHeight: 1.6, marginBottom: 6 }}>
          In Google Calendar: Settings &rarr; pick your calendar &rarr; "Access permissions" &rarr; enable "Make available to public".
          Then under "Integrate calendar", copy the <b>Public URL</b> (or the embed <code>src</code>) and paste it below.
          Note: this makes your calendar's event details visible to anyone with that link.
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label>Calendar embed / public URL</label>
          <input type="url" value={draft} onChange={e => setDraft(e.target.value)} placeholder="https://calendar.google.com/calendar/embed?src=..." />
        </div>
        <div className="full">
          <button className="btn btn--ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn btn--amber" onClick={() => { onSave(draft.trim()); setOpen(false); }}>Save &amp; embed</button>
        </div>
      </div>
      {url && (
        <div style={{ marginTop: 14 }}>
          <iframe title="Google Calendar" src={url} style={{ width: '100%', height: 420, border: '1px solid var(--line)', borderRadius: 8 }} frameBorder="0" scrolling="no" />
        </div>
      )}
    </section>
  );
}

function QuickLinksPanel({ links, onAdd, onDelete }){
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');

  function submit(){
    if (!label.trim() || !url.trim()) return;
    onAdd(label.trim(), url.trim());
    setLabel(''); setUrl(''); setOpen(false);
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <div>
          <p className="panel__eyebrow">External Feed</p>
          <h2 className="panel__title">Quick Links · Docs &amp; Sheets</h2>
        </div>
        <button className="btn btn--amber" onClick={() => setOpen(o => !o)}>+ Add link</button>
      </div>
      <div className={`add-form${open ? ' open' : ''}`}>
        <div>
          <label>Label</label>
          <input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. PRD Master Folder" />
        </div>
        <div style={{ gridColumn: 'span 2' }}>
          <label>Google Doc / Sheet URL</label>
          <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://docs.google.com/..." />
        </div>
        <div className="full">
          <button className="btn btn--ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn btn--amber" onClick={submit}>Add link</button>
        </div>
      </div>
      <div className="quick-links">
        {links.length === 0 ? (
          <div className="quick-links-empty">No quick links yet — add your PRD folder, sprint sheet, or any doc you open often.</div>
        ) : links.map(l => (
          <div key={l.id} className="quick-link-chip">
            <a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a>
            <button title="Remove" onClick={() => onDelete(l.id)}>&times;</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function AddTaskRow({ onAdd }){
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');

  function submit(){
    if (!title.trim()) return;
    onAdd(title.trim(), due);
    setTitle(''); setDue('');
  }

  return (
    <div className="theme-card__add">
      <input type="text" placeholder="Add a task…" value={title} onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
      <input type="date" value={due} onChange={e => setDue(e.target.value)} />
      <button className="btn btn--amber" onClick={submit}>Add</button>
    </div>
  );
}

function TaskRow({ task, onUpdate, onDelete, onCycle, onToggleRisk }){
  const today = todayISO();
  const overdue = task.due && task.due < today && task.status !== 'done';
  const daysDiff = task.due ? Math.round((new Date(task.due) - new Date(today)) / 86400000) : null;
  const dueSoon = !overdue && task.status !== 'done' && daysDiff !== null && daysDiff >= 0 && daysDiff <= 3;

  let dueTitle = '';
  if (task.status !== 'done' && task.due) {
    if (overdue) dueTitle = `Overdue by ${Math.abs(daysDiff)} day(s)`;
    else if (daysDiff === 0) dueTitle = 'Due today';
    else if (daysDiff === 1) dueTitle = 'Due tomorrow';
    else if (daysDiff <= 3) dueTitle = `Due in ${daysDiff} days`;
  }

  const ledClass = task.atRisk ? 'at-risk' : `status-${task.status}`;
  const dueClass = overdue ? ' overdue' : (dueSoon ? ' due-soon' : '');

  return (
    <div className="task-row">
      <button className={`led-btn ${ledClass}`} title="Cycle status" onClick={onCycle} />
      <input className={`task-title${task.status === 'done' ? ' is-done' : ''}`} type="text" value={task.title}
        onChange={e => onUpdate({ title: e.target.value })} />
      <input className={`task-due${dueClass}`} type="date" value={task.due || ''} title={dueTitle}
        onChange={e => onUpdate({ due: e.target.value })} />
      <button className={`icon-btn${task.atRisk ? ' flag-on' : ''}`} title="Flag at risk" onClick={onToggleRisk}>&#9873;</button>
      <button className="icon-btn" title="Delete task" onClick={onDelete}>&times;</button>
      <div className="task-row2">
        <textarea className="task-notes" rows={1} placeholder="Notes / action items" value={task.notes || ''}
          onChange={e => onUpdate({ notes: e.target.value })} />
        <input className="task-link" type="url" placeholder="Paste Google Doc/Sheet link" value={task.link || ''}
          onChange={e => onUpdate({ link: e.target.value })} />
        {task.link && (
          <button className="icon-btn link-on" title="Open link" onClick={() => window.open(task.link, '_blank', 'noopener')}>&#128279;</button>
        )}
      </div>
    </div>
  );
}

function themeStatus(tasks, themeId){
  const themeTasks = tasks.filter(t => t.theme === themeId);
  const open = themeTasks.filter(t => t.status !== 'done');
  const today = todayISO();
  if (open.some(t => t.atRisk || (t.due && t.due < today))) return { label: 'CRITICAL', color: 'var(--red)' };
  if (open.some(t => t.status === 'progress')) return { label: 'ACTIVE', color: 'var(--cyan)' };
  if (open.length > 0) return { label: 'PENDING', color: 'var(--amber)' };
  if (themeTasks.length > 0) return { label: 'CLEAR', color: 'var(--green)' };
  return { label: 'IDLE', color: 'var(--text-faint)' };
}

function ThemeCard({ theme, tasks, onAddTask, onUpdateTask, onDeleteTask, onCycleTask, onToggleRisk }){
  const themeTasks = tasks.filter(t => t.theme === theme.id);
  const openCount = themeTasks.filter(t => t.status !== 'done').length;
  const st = themeStatus(tasks, theme.id);

  return (
    <div className="theme-card">
      <div className="theme-card__head">
        <div className="theme-led" style={{ background: st.color }} />
        <div className="theme-card__meta">
          <div className="theme-card__code">{theme.code}</div>
          <div className="theme-card__title">{theme.title}</div>
          <div className="theme-card__status" style={{ color: st.color }}>{st.label}</div>
        </div>
        <div className="theme-card__count">{openCount} open</div>
      </div>
      <div className="task-list">
        {themeTasks.length === 0 ? (
          <div className="task-empty">No tasks yet — add one below.</div>
        ) : themeTasks.map(t => (
          <TaskRow
            key={t.id}
            task={t}
            onUpdate={patch => onUpdateTask(t.id, patch)}
            onDelete={() => onDeleteTask(t.id)}
            onCycle={() => onCycleTask(t.id)}
            onToggleRisk={() => onToggleRisk(t.id)}
          />
        ))}
      </div>
      <AddTaskRow onAdd={(title, due) => onAddTask(theme.id, title, due)} />
    </div>
  );
}

/* ============================== App ============================== */

function App(){
  const [loaded, setLoaded] = useState(false);
  const [meetings, setMeetings] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [quickLinks, setQuickLinks] = useState([]);
  const [settings, setSettings] = useState({ calendarEmbedUrl: '' });
  const [weekOffset, setWeekOffset] = useState(0);
  const [addMeetingOpen, setAddMeetingOpen] = useState(false);
  const [now, setNow] = useState(new Date());
  const [saved, setSaved] = useState(false);

  // Load once on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setMeetings(parsed.meetings || []);
        setTasks(parsed.tasks || []);
        setQuickLinks(parsed.quickLinks || []);
        setSettings(Object.assign({ calendarEmbedUrl: '' }, parsed.settings || {}));
      } else {
        const seed = getSeedData();
        setMeetings(seed.meetings);
        setTasks(seed.tasks);
        setQuickLinks(seed.quickLinks);
      }
    } catch (e) {
      console.error('Failed to load saved data', e);
    }
    setLoaded(true);
  }, []);

  // Save whenever data changes (skip the very first render, before load completes)
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ meetings, tasks, quickLinks, settings }));
      setSaved(true);
      const t = setTimeout(() => setSaved(false), 900);
      return () => clearTimeout(t);
    } catch (e) {
      console.error('Failed to save data', e);
    }
  }, [meetings, tasks, quickLinks, settings, loaded]);

  // Clock
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  /* ---------- Task actions ---------- */
  function addTask(themeId, title, due){
    setTasks(ts => [...ts, { id: uid(), theme: themeId, title, status: 'todo', atRisk: false, due: due || '', notes: '', link: '' }]);
  }
  function updateTask(id, patch){
    setTasks(ts => ts.map(t => (t.id === id ? { ...t, ...patch } : t)));
  }
  function deleteTask(id){
    setTasks(ts => ts.filter(t => t.id !== id));
  }
  function cycleTaskStatus(id){
    setTasks(ts => ts.map(t => {
      if (t.id !== id) return t;
      const order = ['todo', 'progress', 'done'];
      const status = order[(order.indexOf(t.status) + 1) % order.length];
      return { ...t, status, atRisk: status === 'done' ? false : t.atRisk };
    }));
  }
  function toggleRisk(id){
    setTasks(ts => ts.map(t => (t.id === id ? { ...t, atRisk: !t.atRisk } : t)));
  }

  /* ---------- Meeting actions ---------- */
  function addMeeting(m){
    setMeetings(ms => [...ms, { ...m, id: uid() }]);
  }
  function deleteMeeting(id){
    setMeetings(ms => ms.filter(m => m.id !== id));
  }

  /* ---------- Quick link actions ---------- */
  function addQuickLink(label, url){
    setQuickLinks(qs => [...qs, { id: uid(), label, url }]);
  }
  function deleteQuickLink(id){
    setQuickLinks(qs => qs.filter(q => q.id !== id));
  }

  /* ---------- Derived stats ---------- */
  const today = todayISO();
  const realMonday = getMonday(new Date());
  const realParity = getParity(realMonday);
  const todayIdx = (new Date().getDay() + 6) % 7;
  const meetingsToday = meetings.filter(m => m.weekday === todayIdx && (m.cadence === 'weekly' || m.parity === realParity)).length;
  const tasksDueToday = tasks.filter(t => t.due === today && t.status !== 'done').length;
  const atRiskCount = tasks.filter(t => t.status !== 'done' && (t.atRisk || (t.due && t.due < today))).length;
  const doneCount = tasks.filter(t => t.status === 'done').length;

  const upcomingDeadlines = tasks
    .filter(t => t.status !== 'done' && t.due)
    .map(t => ({ t, diff: Math.round((new Date(t.due) - new Date(today)) / 86400000) }))
    .filter(x => x.diff <= 3)
    .sort((a, b) => a.diff - b.diff)
    .map(x => x.t);

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="topbar__eyebrow">Product Operations</p>
          <h1 className="topbar__title">Control Centre</h1>
        </div>
        <div className="topbar__right">
          <div>
            <div className="sync-label"><span className={`sync-indicator${saved ? ' saved' : ''}`} /> Saved</div>
          </div>
          <div>
            <div className="clock">{now.toLocaleTimeString('en-GB')}</div>
            <div className="clock-date">{WEEKDAY_LABELS[(now.getDay() + 6) % 7]}, {now.getDate()} {MONTHS[now.getMonth()]} {now.getFullYear()}</div>
          </div>
        </div>
      </header>

      <section className="stats-strip">
        <StatChip label="Meetings today" value={meetingsToday} tone="amber" />
        <StatChip label="Tasks due today" value={tasksDueToday} tone="cyan" />
        <StatChip label="At risk" value={atRiskCount} tone="red" />
        <StatChip label="Tasks done" value={doneCount} tone="green" />
      </section>

      {upcomingDeadlines.length > 0 && (
        <section className="panel deadlines-panel">
          <div className="panel__head" style={{ marginBottom: 8 }}>
            <p className="panel__eyebrow">Upcoming Deadlines</p>
          </div>
          <div className="deadlines-strip">
            {upcomingDeadlines.map(t => <DeadlineChip key={t.id} task={t} />)}
          </div>
        </section>
      )}

      <ScheduleBoard
        meetings={meetings}
        tasks={tasks}
        weekOffset={weekOffset}
        setWeekOffset={setWeekOffset}
        onDeleteMeeting={deleteMeeting}
        onCycleTask={cycleTaskStatus}
        addOpen={addMeetingOpen}
        setAddOpen={setAddMeetingOpen}
        onAddMeeting={addMeeting}
      />

      <CalendarPanel
        url={settings.calendarEmbedUrl}
        onSave={url => setSettings(s => ({ ...s, calendarEmbedUrl: url }))}
        onHide={() => setSettings(s => ({ ...s, calendarEmbedUrl: '' }))}
      />

      <QuickLinksPanel links={quickLinks} onAdd={addQuickLink} onDelete={deleteQuickLink} />

      <section className="panel" style={{ background: 'transparent', border: 'none', padding: 0 }}>
        <div className="panel__head">
          <div>
            <p className="panel__eyebrow">Task Console</p>
            <h2 className="panel__title">Discovery · Documentation · Prototyping · Testing</h2>
          </div>
        </div>
        <div className="task-console">
          {THEMES.map(theme => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              tasks={tasks}
              onAddTask={addTask}
              onUpdateTask={updateTask}
              onDeleteTask={deleteTask}
              onCycleTask={cycleTaskStatus}
              onToggleRisk={toggleRisk}
            />
          ))}
        </div>
      </section>

      <p className="footnote">Saved to this browser's local storage · a connected Google Calendar embed is only as private as your calendar's own sharing settings</p>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
