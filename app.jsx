const { useState, useEffect, useRef } = React;

// Supabase client — reads your project URL/key from config.js. If that file
// still has placeholder values, calls will fail and we show a setup notice
// instead of a broken login screen.
let supabaseClient = null;
try {
  if (window.SUPABASE_CONFIG && window.supabase) {
    supabaseClient = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
  }
} catch (e) {
  console.error('Supabase client failed to initialize', e);
}

/* ============================== Constants ============================== */

const COLOR_PALETTE = [
  { chip: 'var(--cyan)',   chipDim: 'var(--cyan-dim)' },
  { chip: 'var(--amber)',  chipDim: 'var(--amber-dim)' },
  { chip: 'var(--purple)', chipDim: 'var(--purple-dim)' },
  { chip: 'var(--green)',  chipDim: 'var(--green-dim)' },
  { chip: 'var(--red)',    chipDim: 'var(--red-dim)' }
];

function colorForIndex(i){
  return COLOR_PALETTE[((i % COLOR_PALETTE.length) + COLOR_PALETTE.length) % COLOR_PALETTE.length];
}

const DEFAULT_CATEGORIES = [
  { id: 'discovery', code: 'CH-01', title: 'Problem Discovery & UATs',  ...colorForIndex(0) },
  { id: 'docs',      code: 'CH-02', title: 'Documentation & Reviews',   ...colorForIndex(1) },
  { id: 'proto',     code: 'CH-03', title: 'Prototyping & Experiments', ...colorForIndex(2) },
  { id: 'testing',   code: 'CH-04', title: 'Testing & Bug Fixes',       ...colorForIndex(3) }
];

const MEETING_TYPES = {
  pod:      { label: 'POD Connect',     color: 'var(--cyan)',   dim: 'var(--cyan-dim)' },
  mentor:   { label: 'Mentor Sync',     color: 'var(--amber)',  dim: 'var(--amber-dim)' },
  champion: { label: 'Champion Review', color: 'var(--purple)', dim: 'var(--purple-dim)' },
  sprint:   { label: 'Sprint Call',     color: 'var(--green)',  dim: 'var(--green-dim)' }
};

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const TABS = [
  { id: 'overview',   label: 'Overview' },
  { id: 'calendar',   label: 'Calendar' },
  { id: 'tasks',      label: 'Task List' },
  { id: 'quicklinks', label: 'Quick Links' }
];

const TASK_FILTERS = [
  { id: 'today', label: 'Today' },
  { id: 'week',  label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'all',   label: 'All' }
];

const STATUS_ORDER = ['todo', 'progress', 'done'];
const STATUS_META = {
  todo:     { label: 'To Do',       color: 'var(--text-lo)' },
  progress: { label: 'In Progress', color: 'var(--cyan)' },
  done:     { label: 'Done',        color: 'var(--green)' }
};

// A task "appears" on a given day if that day falls in its [start, end] range, OR —
// for tasks that aren't done — on every day after it started, since it should keep
// showing up until it's actually marked done (whether it's overdue past its end date,
// or in progress past its start date with no end date set yet).
function taskMatchesRange(task, rangeStart, rangeEnd){
  const { startDate, endDate, status } = task;
  if (!startDate && !endDate) return false;
  const s = startDate || endDate;
  const e = endDate || startDate;
  if (status === 'done') return s <= rangeEnd && e >= rangeStart;
  return s <= rangeEnd;
}

function taskAppearsOn(task, dateISO){
  return taskMatchesRange(task, dateISO, dateISO);
}

function matchesTaskFilter(task, filter, today, weekStart, weekEnd, monthStart, monthEnd){
  if (filter === 'all') return true;
  if (filter === 'today') return taskMatchesRange(task, today, today);
  if (filter === 'week') return taskMatchesRange(task, weekStart, weekEnd);
  if (filter === 'month') return taskMatchesRange(task, monthStart, monthEnd);
  return true;
}

const DEFAULT_LINK_TAGS = ['Quick Access', 'Archives', 'Masters'];

const DOC_TYPE_ORDER = ['doc', 'sheet', 'slide', 'drive', 'pdf', 'other'];
const DOC_TYPE_META = {
  doc:   { label: 'Docs',          icon: '📄' },
  sheet: { label: 'Sheets',        icon: '📊' },
  slide: { label: 'Slides',        icon: '📽' },
  drive: { label: 'Drive folders', icon: '🗂' },
  pdf:   { label: 'PDFs',          icon: '📕' },
  other: { label: 'Other links',   icon: '🔗' }
};

function detectDocType(url){
  const u = (url || '').toLowerCase();
  if (u.includes('docs.google.com/document')) return 'doc';
  if (u.includes('docs.google.com/spreadsheets') || u.includes('sheets.google.com')) return 'sheet';
  if (u.includes('docs.google.com/presentation') || u.includes('slides.google.com')) return 'slide';
  if (u.includes('drive.google.com')) return 'drive';
  if (u.endsWith('.pdf') || u.includes('.pdf?') || u.includes('.pdf#')) return 'pdf';
  return 'other';
}

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

function categoryById(categories, id){
  return categories.find(c => c.id === id);
}

// Once a task's deadline has been consciously revised, we show "Extended" instead of
// treating it as overdue/delayed — the person made a deliberate call, it isn't slipping
// silently. If it's never been revised, fall back to the normal due-soon/overdue read.
function dueStatusInfo(task, today){
  if (!task.endDate || task.status === 'done') return null;
  const extended = task.dueRevisions && task.dueRevisions.length > 0;
  if (extended) return { label: 'Extended', color: 'var(--purple)', cssClass: 'extended' };
  const daysDiff = Math.round((new Date(task.endDate) - new Date(today)) / 86400000);
  if (daysDiff < 0) return { label: `Overdue ${Math.abs(daysDiff)}d`, color: 'var(--red)', cssClass: 'overdue' };
  if (daysDiff === 0) return { label: 'Due today', color: 'var(--red)', cssClass: 'due-soon' };
  if (daysDiff === 1) return { label: 'Due tomorrow', color: 'var(--amber)', cssClass: 'due-soon' };
  if (daysDiff <= 3) return { label: `Due in ${daysDiff}d`, color: 'var(--amber)', cssClass: 'due-soon' };
  return null;
}

// "Meetings to be set up" reminder rule: 48hrs (2 days) before the target date if one's
// set, or every day if no target date has been picked yet.
function needsReminder(pending, today){
  if (!pending.targetDate) return true;
  const daysUntil = Math.round((new Date(pending.targetDate) - new Date(today)) / 86400000);
  return daysUntil <= 2;
}

/* ---------- Time / duration pickers (15-minute steps) ---------- */
const TIME_OPTIONS = (() => {
  const out = [];
  for (let h = 0; h < 24; h++){
    for (let m = 0; m < 60; m += 15){
      out.push(String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'));
    }
  }
  return out;
})();

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120, 180];

function formatDuration(mins){
  if (mins < 60) return `${mins} min`;
  const h = mins / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} hr`;
}

function TimeSelect({ value, onChange, title }){
  return (
    <select value={value || '09:00'} title={title} onChange={e => onChange(e.target.value)}>
      {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}

function DurationSelect({ value, onChange, title }){
  return (
    <select value={value || 30} title={title} onChange={e => onChange(Number(e.target.value))}>
      {DURATION_OPTIONS.map(d => <option key={d} value={d}>{formatDuration(d)}</option>)}
    </select>
  );
}

function minutesSinceMidnight(hhmm){
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function getWorkingHours(workingHours, defaultWorkingHours, dateISO){
  return (workingHours && workingHours[dateISO]) || defaultWorkingHours || { start: '09:00', end: '18:00' };
}

// A task's effective completion: explicit "done" always wins; otherwise, if it has
// sub-tasks, its progress rolls up from how many of those are checked off.
function taskCompletionFraction(task){
  if (task.status === 'done') return 1;
  const subs = task.subtasks || [];
  if (subs.length > 0) return subs.filter(s => s.done).length / subs.length;
  return 0;
}

// Weighted completion for whichever tasks pass `filterFn` — the same shape powers both
// the daily and weekly progress bars, just with a different scope of tasks passed in.
function computeProgress(tasks, filterFn){
  const relevant = tasks.filter(filterFn);
  const totalWeight = relevant.reduce((sum, t) => sum + (t.weight || 1), 0);
  const doneWeight = relevant.reduce((sum, t) => sum + (t.weight || 1) * taskCompletionFraction(t), 0);
  const percent = totalWeight > 0 ? Math.round((doneWeight / totalWeight) * 100) : null;
  return { percent, totalWeight, doneWeight, count: relevant.length };
}

// A sub-task can never start before, or end after, its parent task's own dates —
// it can only be a tighter window within the parent's timeline.
function clampSubtaskDates(task, startDate, endDate){
  let s = startDate || '';
  let e = endDate || '';
  if (task.startDate && s && s < task.startDate) s = task.startDate;
  if (task.endDate && e && e > task.endDate) e = task.endDate;
  return { startDate: s, endDate: e };
}

/* ---------- Meeting completion / in-progress status ---------- */
function getMeetingStatus(dateISO, time, duration){
  const today = todayISO();
  if (dateISO < today) return { status: 'done', pct: 100 };
  if (dateISO > today) return { status: 'upcoming', pct: 0 };
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const startMin = minutesSinceMidnight(time);
  const dur = duration || 30;
  const pct = ((nowMin - startMin) / dur) * 100;
  if (pct >= 100) return { status: 'done', pct: 100 };
  if (pct < 0) return { status: 'upcoming', pct: 0 };
  if (pct >= 75) return { status: 'wrapping', pct };
  return { status: 'live', pct };
}

/* ---------- Time-lapsed within a day's working-hours window, OOO-aware ---------- */
function computeTimeLapsed(hours, oooForDay, nowDate){
  const startMin = minutesSinceMidnight(hours.start);
  const endMin = minutesSinceMidnight(hours.end);
  const windowMin = Math.max(endMin - startMin, 0);
  if (oooForDay && oooForDay.fullDay) return { fullDayOff: true, percent: 0, effectiveWindow: 0 };

  const blocks = (oooForDay && oooForDay.blocks) || [];
  const oooTotal = blocks.reduce((s, b) => s + Math.max(0, minutesSinceMidnight(b.end) - minutesSinceMidnight(b.start)), 0);
  const effectiveWindow = Math.max(windowMin - oooTotal, 0);

  const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();
  let oooElapsed = 0;
  blocks.forEach(b => {
    const bStart = Math.max(minutesSinceMidnight(b.start), startMin);
    const bEnd = Math.min(minutesSinceMidnight(b.end), endMin, nowMin);
    if (bEnd > bStart) oooElapsed += (bEnd - bStart);
  });
  const rawElapsed = Math.max(0, Math.min(nowMin, endMin) - startMin);
  const netElapsed = Math.max(0, rawElapsed - oooElapsed);
  const percent = effectiveWindow > 0 ? Math.max(0, Math.min(100, Math.round((netElapsed / effectiveWindow) * 100))) : 0;
  return { fullDayOff: false, percent, effectiveWindow };
}

// Same idea as computeTimeLapsed but summed across Monday–Friday of a given week,
// skipping any day marked Out of Office for the full day.
function computeWeekLapsed(workingHours, defaultWorkingHours, oooRanges, monday, today){
  let totalMin = 0, elapsedMin = 0;
  for (let i = 0; i < 5; i++){
    const d = new Date(monday); d.setDate(d.getDate() + i);
    const iso = isoOf(d);
    const dayOoo = oooRanges[iso];
    if (dayOoo && dayOoo.fullDay) continue;
    const hours = getWorkingHours(workingHours, defaultWorkingHours, iso);
    const lapsed = computeTimeLapsed(hours, dayOoo, new Date());
    if (iso < today){
      totalMin += lapsed.effectiveWindow;
      elapsedMin += lapsed.effectiveWindow;
    } else if (iso === today){
      totalMin += lapsed.effectiveWindow;
      elapsedMin += Math.round((lapsed.percent / 100) * lapsed.effectiveWindow);
    } else {
      totalMin += lapsed.effectiveWindow;
    }
  }
  const percent = totalMin > 0 ? Math.round((elapsedMin / totalMin) * 100) : 0;
  return { percent, totalMin, elapsedMin };
}

/* ---------- A little personality ---------- */
function getTimeGreeting(hour){
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Winding down';
}

function getAssistantMessage({ meetingsToday, tasksDueToday, atRiskCount, dailyProgress, timeElapsedPercent }){
  if (atRiskCount > 0) {
    return `${atRiskCount} task${atRiskCount > 1 ? 's need' : ' needs'} attention — worth a look before ${atRiskCount > 1 ? 'they slip' : 'it slips'} further.`;
  }
  if (dailyProgress.percent !== null && dailyProgress.percent >= 100) {
    return "Today's task list is fully wrapped — nice work.";
  }
  if (meetingsToday === 0 && tasksDueToday === 0) {
    return "Nothing urgent on deck today — a good day to chip away at the backlog.";
  }
  if (dailyProgress.percent !== null && timeElapsedPercent > 0 && dailyProgress.percent >= timeElapsedPercent) {
    return "You're on pace for today — keep it up.";
  }
  if (meetingsToday > 0 && tasksDueToday > 0) {
    return `${meetingsToday} meeting${meetingsToday > 1 ? 's' : ''} and ${tasksDueToday} task${tasksDueToday > 1 ? 's' : ''} on deck today.`;
  }
  if (meetingsToday > 0) return `${meetingsToday} meeting${meetingsToday > 1 ? 's' : ''} on the calendar today.`;
  if (tasksDueToday > 0) return `${tasksDueToday} task${tasksDueToday > 1 ? 's' : ''} due today.`;
  return "Here's what's on deck today.";
}

function getSeedData(){
  return {
    categories: DEFAULT_CATEGORIES,
    categoryCounter: DEFAULT_CATEGORIES.length + 1,
    meetings: [],
    tasks: [],
    quickLinks: [],
    linkTags: DEFAULT_LINK_TAGS,
    pendingMeetings: [],
    plannedMeetings: []
  };
}

function AssistantBanner({ message }){
  return (
    <div className="assistant-banner">
      <span className="assistant-banner__icon">&#10022;</span>
      <span>{message}</span>
    </div>
  );
}

function StickyNotesPanel({ notes, onAdd, onDelete }){
  const [text, setText] = useState('');

  function submit(){
    if (!text.trim()) return;
    onAdd(text.trim());
    setText('');
  }

  return (
    <section className="panel">
      <div className="panel__head" style={{ marginBottom: 10 }}>
        <div>
          <p className="panel__eyebrow">Quick Notes</p>
          <h2 className="panel__title">Jot it down, file it later</h2>
        </div>
      </div>
      <div className="quick-add-row">
        <input type="text" placeholder="Something worth remembering…" value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }} style={{ flex: '3 1 260px' }} />
        <button className="btn btn--amber" onClick={submit}>Add note</button>
      </div>
      {notes.length > 0 && (
        <div className="sticky-note-list">
          {notes.map(n => (
            <div key={n.id} className="sticky-note">
              <span>{n.text}</span>
              <button className="icon-btn" title="Filed elsewhere — remove" onClick={() => onDelete(n.id)}>&times;</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function EndOfDayModal({ notes, onClose }){
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div className="modal-panel__head">
          <div style={{ flex: 1 }}>
            <p className="panel__eyebrow">End of day</p>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700 }}>You've got {notes.length} unfiled quick note{notes.length === 1 ? '' : 's'}</div>
          </div>
        </div>
        <div className="modal-field">
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-lo)', marginBottom: 10 }}>
            Move these into a task, a meeting's notes, or wherever they belong — otherwise they'll remind you again first thing tomorrow.
          </p>
          <div className="sticky-note-list">
            {notes.map(n => <div key={n.id} className="sticky-note"><span>{n.text}</span></div>)}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn--amber" onClick={onClose} style={{ marginLeft: 'auto' }}>Got it</button>
        </div>
      </div>
    </div>
  );
}

function LegacyImportModal({ data, onImport, onDiscard }){
  const counts = [
    ['task', (data.tasks || []).length],
    ['meeting', (data.meetings || []).length],
    ['quick link', (data.quickLinks || []).length],
    ['meeting to set up', (data.pendingMeetings || []).length],
    ['scheduled meeting', (data.plannedMeetings || []).length]
  ].filter(([, n]) => n > 0);

  return (
    <div className="modal-backdrop">
      <div className="modal-panel" style={{ maxWidth: 460 }}>
        <div className="modal-panel__head">
          <div style={{ flex: 1 }}>
            <p className="panel__eyebrow">Found something</p>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700 }}>Bring in your earlier data?</div>
          </div>
        </div>
        <div className="modal-field">
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-lo)', marginBottom: 10, lineHeight: 1.6 }}>
            This browser has data saved from before sign-in was added:
          </p>
          <div className="digest-list">
            {counts.map(([label, n]) => (
              <div key={label} className="digest-item"><span>{n} {label}{n === 1 ? '' : 's'}</span></div>
            ))}
          </div>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)', marginTop: 10 }}>
            Import moves it into your signed-in account (one-time). Discard clears it from this browser for good.
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onDiscard}>Discard</button>
          <button className="btn btn--amber" onClick={onImport}>Import into my account</button>
        </div>
      </div>
    </div>
  );
}

/* ============================== Small components ============================== */

function StatChip({ label, value, tone, onClick }){
  return (
    <div className={`stat-chip stat-chip--${tone}`} onClick={onClick} role="button" tabIndex={0}>
      <p className="stat-chip__label">{label}</p>
      <p className="stat-chip__value">{value}</p>
    </div>
  );
}

function DeadlineChip({ task, category, onClick, onFocusClick }){
  const status = dueStatusInfo(task, todayISO()) || { label: 'Due', color: 'var(--amber)' };
  return (
    <div className="deadline-chip" style={{ '--dchip-color': status.color }}>
      <div onClick={onClick} role="button" tabIndex={0} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
        <span className="deadline-chip__code">{category ? category.code : '—'}</span>
        <span className="deadline-chip__title">{task.title}</span>
        <span className="deadline-chip__when">{status.label}</span>
      </div>
      <button className="deadline-chip__focus" title="Set focus time" onClick={e => { e.stopPropagation(); onFocusClick(); }}>&#127919;</button>
    </div>
  );
}

function FocusTimeModal({ task, onClose, onSave }){
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState('10:00');
  const [duration, setDuration] = useState(30);

  useEffect(() => {
    function onKey(e){ if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!task) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="modal-panel__head">
          <div style={{ flex: 1 }}>
            <p className="panel__eyebrow">Focus time for</p>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 600, marginTop: 2 }}>{task.title}</div>
          </div>
          <button className="icon-btn" title="Close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-grid">
          <div>
            <label>Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <label>Start time</label>
            <TimeSelect value={time} onChange={setTime} />
          </div>
          <div>
            <label>Duration</label>
            <DurationSelect value={duration} onChange={setDuration} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--amber" onClick={() => onSave(date, time, duration)}>Add to calendar</button>
        </div>
      </div>
    </div>
  );
}

function TodayMeetingsCard({ meetings, plannedMeetings, pendingMeetings, todayIdx, realParity, onClickMeeting }){
  const today = todayISO();
  const todayRecurring = meetings
    .filter(m => m.weekday === todayIdx && (m.cadence === 'weekly' || m.parity === realParity))
    .sort((a, b) => a.time.localeCompare(b.time));
  const todayPlanned = plannedMeetings.filter(m => m.date === today).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const todayReminders = pendingMeetings.filter(m => needsReminder(m, today));
  const nothing = todayRecurring.length === 0 && todayPlanned.length === 0 && todayReminders.length === 0;

  return (
    <section className="panel">
      <div className="panel__head" style={{ marginBottom: 10 }}>
        <div>
          <p className="panel__eyebrow">Today</p>
          <h2 className="panel__title">Meetings</h2>
        </div>
      </div>
      {nothing ? (
        <p style={{ color: 'var(--text-lo)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>No syncs today. Clear runway.</p>
      ) : (
        <div className="today-list">
          {todayRecurring.map(m => {
            const mt = MEETING_TYPES[m.type];
            const status = getMeetingStatus(today, m.time, m.duration);
            return (
              <div key={m.id} className={`today-item${status.status === 'done' ? ' is-complete' : ''}`} style={{ '--type-color': mt.color }} onClick={onClickMeeting}>
                <span className="today-item__time">{m.time}</span>
                <span className="today-item__title">{m.name}</span>
                {meetingStatusPill(status) || <span className="pill" style={{ '--pill-color': mt.color, '--pill-bg': mt.dim }}>{mt.label}</span>}
              </div>
            );
          })}
          {todayPlanned.map(m => {
            const isFocus = m.kind === 'focus';
            const color = isFocus ? 'var(--green)' : 'var(--purple)';
            const dim = isFocus ? 'var(--green-dim)' : 'var(--purple-dim)';
            const status = getMeetingStatus(today, m.time || '00:00', m.duration);
            return (
              <div key={m.id} className={`today-item${status.status === 'done' ? ' is-complete' : ''}`} style={{ '--type-color': color }} onClick={onClickMeeting}>
                <span className="today-item__time">{m.time || '—'}</span>
                <span className="today-item__title">{m.title}</span>
                {meetingStatusPill(status) || <span className="pill" style={{ '--pill-color': color, '--pill-bg': dim }}>{isFocus ? 'Focus time' : 'Meeting'}</span>}
              </div>
            );
          })}
          {todayReminders.map(m => (
            <div key={m.id} className="today-item" style={{ '--type-color': 'var(--red)' }} onClick={onClickMeeting}>
              <span className="today-item__time" style={{ color: 'var(--red)' }}>&#128276;</span>
              <span className="today-item__title">{m.title}</span>
              <span className="pill" style={{ '--pill-color': 'var(--red)', '--pill-bg': 'var(--red-dim)' }}>Set up</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TodayTasksCard({ tasks, categories, onClickTask }){
  const today = todayISO();
  const todayTasks = tasks.filter(t => t.status !== 'done' && taskAppearsOn(t, today));

  return (
    <section className="panel">
      <div className="panel__head" style={{ marginBottom: 10 }}>
        <div>
          <p className="panel__eyebrow">Today</p>
          <h2 className="panel__title">Tasks</h2>
        </div>
      </div>
      {todayTasks.length === 0 ? (
        <p style={{ color: 'var(--text-lo)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Nothing active today. Clear runway.</p>
      ) : (
        <div className="today-list">
          {todayTasks.map(t => {
            const cat = categoryById(categories, t.theme);
            const status = dueStatusInfo(t, today);
            const label = status ? status.label : (t.startDate && t.startDate <= today ? 'In progress' : 'Active');
            const color = status ? status.color : 'var(--cyan)';
            return (
              <div key={t.id} className="today-item" onClick={() => onClickTask(t.id)}>
                <span className="today-item__time" style={{ color: 'var(--text-faint)' }}>{cat ? cat.code : '—'}</span>
                <span className="today-item__title">{t.title}</span>
                <span className="pill" style={{ '--pill-color': color, '--pill-bg': 'var(--ink-700)' }}>{label}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function AddMeetingForm({ open, onCancel, onSubmit }){
  const [name, setName] = useState('');
  const [type, setType] = useState('pod');
  const [weekday, setWeekday] = useState(0);
  const [time, setTime] = useState('10:00');
  const [duration, setDuration] = useState(30);
  const [cadence, setCadence] = useState('weekly');
  const [parity, setParity] = useState('A');

  function submit(){
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), type, weekday: Number(weekday), time, duration, cadence, parity });
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
        <label>Start time</label>
        <TimeSelect value={time} onChange={setTime} />
      </div>
      <div>
        <label>Duration</label>
        <DurationSelect value={duration} onChange={setDuration} />
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

function meetingStatusPill(status){
  if (status.status === 'done') return <span className="pill" style={{ '--pill-color': 'var(--green)', '--pill-bg': 'var(--green-dim)' }}>&#10003; Completed</span>;
  if (status.status === 'wrapping') return <span className="pill" style={{ '--pill-color': 'var(--amber)', '--pill-bg': 'var(--amber-dim)' }}>Wrapping up &middot; check agenda</span>;
  return null;
}

function DayHoursPanel({ iso, workingHours, defaultWorkingHours, oooRanges, onSetWorkingHours, onToggleFullDayOOO, onAddOOOBlock, onDeleteOOOBlock }){
  const hours = getWorkingHours(workingHours, defaultWorkingHours, iso);
  const ooo = oooRanges[iso] || { fullDay: false, blocks: [] };
  const [oooStart, setOooStart] = useState('12:00');
  const [oooEnd, setOooEnd] = useState('13:00');

  return (
    <div className="day-hours-panel">
      <div className="day-hours-panel__row">
        <label>Working hours</label>
        <TimeSelect value={hours.start} onChange={start => onSetWorkingHours(iso, { ...hours, start })} />
        <span style={{ color: 'var(--text-faint)' }}>&rarr;</span>
        <TimeSelect value={hours.end} onChange={end => onSetWorkingHours(iso, { ...hours, end })} />
      </div>
      <div className="day-hours-panel__row">
        <button className={`btn${ooo.fullDay ? ' btn--danger' : ' btn--ghost'}`} onClick={() => onToggleFullDayOOO(iso)}>
          {ooo.fullDay ? 'Out of office all day — click to undo' : 'Mark whole day Out of Office'}
        </button>
      </div>
      {!ooo.fullDay && (
        <React.Fragment>
          {(ooo.blocks || []).length > 0 && (
            <div className="ooo-block-list">
              {ooo.blocks.map(b => (
                <div key={b.id} className="ooo-block">
                  <span>{b.start} &ndash; {b.end}</span>
                  <button className="icon-btn" onClick={() => onDeleteOOOBlock(iso, b.id)}>&times;</button>
                </div>
              ))}
            </div>
          )}
          <div className="day-hours-panel__row">
            <TimeSelect value={oooStart} onChange={setOooStart} />
            <span style={{ color: 'var(--text-faint)' }}>&rarr;</span>
            <TimeSelect value={oooEnd} onChange={setOooEnd} />
            <button className="btn" onClick={() => onAddOOOBlock(iso, oooStart, oooEnd)}>+ Out of office block</button>
          </div>
        </React.Fragment>
      )}
    </div>
  );
}

function ScheduleBoard({ meetings, pendingMeetings, plannedMeetings, weekOffset, setWeekOffset, onDeleteMeeting, onDeletePlanned, onOpenMeeting, addOpen, setAddOpen, onAddMeeting, workingHours, defaultWorkingHours, oooRanges, onSetWorkingHours, onToggleFullDayOOO, onAddOOOBlock, onDeleteOOOBlock }){
  const monday = getMonday(new Date(Date.now() + weekOffset * 7 * 86400000));
  const parity = getParity(monday);
  const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
  const todayStr = new Date().toDateString();
  const [expandedDay, setExpandedDay] = useState(null);

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
          <h2 className="panel__title">Recurring syncs &amp; scheduled meetings</h2>
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

      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', margin: '10px 0 0' }}>Click a day's date to view or edit its working hours &amp; Out of Office blocks.</p>

      <div className="schedule-grid" style={{ marginTop: 10 }}>
        {Array.from({ length: 7 }).map((_, i) => {
          const d = new Date(monday); d.setDate(d.getDate() + i);
          const isToday = d.toDateString() === todayStr;
          const iso = isoOf(d);
          const dayMeetings = meetingsForDay(i);
          const dayPlanned = plannedMeetings.filter(m => m.date === iso).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
          const dayPlaceholders = pendingMeetings.filter(m => m.targetDate === iso);
          const hasAnything = dayMeetings.length > 0 || dayPlanned.length > 0 || dayPlaceholders.length > 0;
          const dayOoo = oooRanges[iso];
          return (
            <div key={i} className={`schedule-day${isToday ? ' is-today' : ''}`}>
              <div className="schedule-day__head" style={{ cursor: 'pointer' }} onClick={() => setExpandedDay(x => (x === iso ? null : iso))}>
                {WEEKDAY_LABELS[i]}<b>{d.getDate()} {MONTHS[d.getMonth()]}</b>
                {dayOoo && dayOoo.fullDay && <span className="pill" style={{ '--pill-color': 'var(--red)', '--pill-bg': 'var(--red-dim)', marginTop: 4, display: 'inline-block' }}>OOO</span>}
              </div>
              {expandedDay === iso && (
                <DayHoursPanel
                  iso={iso}
                  workingHours={workingHours}
                  defaultWorkingHours={defaultWorkingHours}
                  oooRanges={oooRanges}
                  onSetWorkingHours={onSetWorkingHours}
                  onToggleFullDayOOO={onToggleFullDayOOO}
                  onAddOOOBlock={onAddOOOBlock}
                  onDeleteOOOBlock={onDeleteOOOBlock}
                />
              )}
              <div className="schedule-day__list">
                {!hasAnything ? (
                  <div className="schedule-day__empty">No syncs</div>
                ) : (
                  <React.Fragment>
                    {dayMeetings.map(m => {
                      const t = MEETING_TYPES[m.type];
                      const status = getMeetingStatus(iso, m.time, m.duration);
                      return (
                        <div key={m.id} className={`meeting-block${status.status === 'done' ? ' is-complete' : ''}`} style={{ '--type-color': t.color }}>
                          <button className="meeting-block__del" title="Remove" onClick={() => onDeleteMeeting(m.id)}>&times;</button>
                          <div className="meeting-block__time">{m.time} &middot; {formatDuration(m.duration || 30)}</div>
                          <div className="meeting-block__name">{m.name}</div>
                          <div className="meeting-block__foot">
                            {meetingStatusPill(status) || <span className="pill" style={{ '--pill-color': t.color, '--pill-bg': t.dim }}>{t.label}</span>}
                            <span className="pill" style={{ '--pill-color': 'var(--text-lo)', '--pill-bg': 'var(--ink-700)' }}>{m.cadence === 'weekly' ? 'WK' : 'FN'}</span>
                          </div>
                        </div>
                      );
                    })}
                    {dayPlanned.map(m => {
                      const isFocus = m.kind === 'focus';
                      const color = isFocus ? 'var(--green)' : 'var(--purple)';
                      const dim = isFocus ? 'var(--green-dim)' : 'var(--purple-dim)';
                      const status = getMeetingStatus(iso, m.time || '00:00', m.duration);
                      return (
                        <div key={m.id} className={`meeting-block${status.status === 'done' ? ' is-complete' : ''}`} style={{ '--type-color': color, cursor: isFocus ? 'default' : 'pointer' }}
                          onClick={() => { if (!isFocus) onOpenMeeting(m.id); }}>
                          <button className="meeting-block__del" title="Remove" onClick={e => { e.stopPropagation(); onDeletePlanned(m.id); }}>&times;</button>
                          <div className="meeting-block__time">{m.time || '—'} &middot; {formatDuration(m.duration || 30)}</div>
                          <div className="meeting-block__name">{m.title}</div>
                          <div className="meeting-block__foot">
                            {meetingStatusPill(status) || <span className="pill" style={{ '--pill-color': color, '--pill-bg': dim }}>{isFocus ? 'Focus time' : 'Meeting'}</span>}
                            {!isFocus && (m.agenda || []).length > 0 && (
                              <span className="pill" style={{ '--pill-color': 'var(--text-lo)', '--pill-bg': 'var(--ink-700)' }}>{m.agenda.length} agenda</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {dayPlaceholders.map(m => (
                      <div key={m.id} className="placeholder-block" title="Needs a confirmed slot — set it up from Meetings To Be Set Up">
                        <div className="placeholder-block__name">{m.title}</div>
                        <span className="pill" style={{ '--pill-color': 'var(--amber)', '--pill-bg': 'var(--amber-dim)' }}>Needs setup</span>
                      </div>
                    ))}
                  </React.Fragment>
                )}
              </div>
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

function PendingMeetingsPanel({ items, onAdd, onUpdate, onDelete, onPromote }){
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [notes, setNotes] = useState('');
  const [schedulingId, setSchedulingId] = useState(null);
  const [schedDate, setSchedDate] = useState('');
  const [schedTime, setSchedTime] = useState('09:00');
  const [schedDuration, setSchedDuration] = useState(30);
  const today = todayISO();

  function submit(){
    if (!title.trim()) return;
    onAdd(title.trim(), targetDate, notes.trim());
    setTitle(''); setTargetDate(''); setNotes(''); setOpen(false);
  }

  function startScheduling(m){
    setSchedulingId(m.id);
    setSchedDate(m.targetDate || today);
    setSchedTime('09:00');
    setSchedDuration(30);
  }

  function confirmScheduling(){
    if (!schedDate) return;
    onPromote(schedulingId, schedDate, schedTime, schedDuration);
    setSchedulingId(null);
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <div>
          <p className="panel__eyebrow">Meeting Invites</p>
          <h2 className="panel__title">Meetings To Be Set Up</h2>
        </div>
        <button className="btn btn--amber" onClick={() => setOpen(o => !o)}>+ Add</button>
      </div>

      <div className={`add-form${open ? ' open' : ''}`}>
        <div>
          <label>Meeting</label>
          <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Design review with legal" />
        </div>
        <div>
          <label>Target date (optional)</label>
          <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} />
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label>Notes (optional)</label>
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Who needs to be involved, context, etc." />
        </div>
        <div className="full">
          <button className="btn btn--ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn btn--amber" onClick={submit}>Add</button>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="task-empty">Nothing pending — add a meeting you still need to set up. No target date means you'll see a daily reminder until it's scheduled.</p>
      ) : (
        <div className="pending-meeting-list">
          {items.map(m => {
            const remind = needsReminder(m, today);
            return (
              <div key={m.id}>
                <div className="pending-meeting-row">
                  <span className={`reminder-dot${remind ? ' due' : ''}`} title={remind ? 'Reminder: this still needs setting up' : 'No reminder due yet'} />
                  <input className="task-title" type="text" value={m.title} onChange={e => onUpdate(m.id, { title: e.target.value })} />
                  <input className="task-due" type="date" value={m.targetDate || ''} title="Target date (optional)"
                    onChange={e => onUpdate(m.id, { targetDate: e.target.value })} />
                  <input className="task-notes-inline" type="text" placeholder="Notes" value={m.notes || ''}
                    onChange={e => onUpdate(m.id, { notes: e.target.value })} />
                  <button className="btn btn--amber" onClick={() => startScheduling(m)}>Schedule</button>
                  <button className="icon-btn" title="Delete" onClick={() => onDelete(m.id)}>&times;</button>
                </div>
                {schedulingId === m.id && (
                  <div className="add-form open" style={{ marginTop: 6 }}>
                    <div>
                      <label>Date</label>
                      <input type="date" value={schedDate} onChange={e => setSchedDate(e.target.value)} />
                    </div>
                    <div>
                      <label>Start time</label>
                      <TimeSelect value={schedTime} onChange={setSchedTime} />
                    </div>
                    <div>
                      <label>Duration</label>
                      <DurationSelect value={schedDuration} onChange={setSchedDuration} />
                    </div>
                    <div className="full">
                      <button className="btn btn--ghost" onClick={() => setSchedulingId(null)}>Cancel</button>
                      <button className="btn btn--amber" onClick={confirmScheduling}>Confirm schedule</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function AgendaList({ agenda, onChange }){
  const [text, setText] = useState('');
  const items = agenda || [];

  function addItem(){
    if (!text.trim()) return;
    onChange([...items, { id: uid(), text: text.trim(), done: false }]);
    setText('');
  }
  function toggleItem(id){
    onChange(items.map(a => (a.id === id ? { ...a, done: !a.done } : a)));
  }
  function deleteItem(id){
    onChange(items.filter(a => a.id !== id));
  }

  return (
    <div className="agenda-list">
      {items.map(a => (
        <div key={a.id} className={`agenda-item${a.done ? ' done' : ''}`}>
          <input type="checkbox" checked={a.done} onChange={() => toggleItem(a.id)} />
          <span className="agenda-item__text">{a.text}</span>
          <button className="icon-btn" title="Remove" onClick={() => deleteItem(a.id)}>&times;</button>
        </div>
      ))}
      <div className="agenda-add">
        <input type="text" placeholder="Add agenda point / action item…" value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addItem(); }} />
        <button className="btn" onClick={addItem}>Add</button>
      </div>
    </div>
  );
}

function PlannedMeetingRow({ meeting, onOpen, onDelete }){
  const agendaCount = (meeting.agenda || []).length;
  const doneCount = (meeting.agenda || []).filter(a => a.done).length;
  const typeMeta = MEETING_TYPES[meeting.type];
  const color = meeting.type && typeMeta ? typeMeta.color : 'var(--purple)';
  return (
    <div className="planned-meeting-row" style={{ '--type-color': color }} onClick={onOpen}>
      <div className="planned-meeting-row__time">
        <span>{meeting.date}</span>
        <span>{meeting.time || '—'} &middot; {formatDuration(meeting.duration || 30)}</span>
      </div>
      <div className="planned-meeting-row__title">{meeting.title}</div>
      <div className="planned-meeting-row__meta">
        {typeMeta && <span className="pill" style={{ '--pill-color': typeMeta.color, '--pill-bg': typeMeta.dim }}>{typeMeta.label}</span>}
        {agendaCount > 0 && (
          <span className="pill" style={{ '--pill-color': 'var(--text-lo)', '--pill-bg': 'var(--ink-700)' }}>{doneCount}/{agendaCount} agenda</span>
        )}
      </div>
      <button className="icon-btn" title="Delete meeting" onClick={e => { e.stopPropagation(); onDelete(); }}>&times;</button>
    </div>
  );
}

function PlannedMeetingsPanel({ items, onAdd, onOpen, onDelete }){
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('10:00');
  const [duration, setDuration] = useState(30);
  const [type, setType] = useState('other');

  function submit(){
    if (!title.trim() || !date) return;
    onAdd(title.trim(), date, time, duration, type);
    setTitle(''); setDate(''); setOpen(false);
  }

  const sorted = [...items].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));

  return (
    <section className="panel">
      <div className="panel__head">
        <div>
          <p className="panel__eyebrow">Meeting Invites</p>
          <h2 className="panel__title">Meetings Scheduled</h2>
        </div>
        <button className="btn btn--amber" onClick={() => setOpen(o => !o)}>+ Add</button>
      </div>

      <div className={`add-form${open ? ' open' : ''}`}>
        <div>
          <label>Meeting</label>
          <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Vendor kickoff call" />
        </div>
        <div>
          <label>Type</label>
          <select value={type} onChange={e => setType(e.target.value)}>
            <option value="other">General</option>
            <option value="pod">POD Connect</option>
            <option value="mentor">Mentor Sync</option>
            <option value="champion">Champion Review</option>
            <option value="sprint">Sprint Call</option>
          </select>
        </div>
        <div>
          <label>Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div>
          <label>Start time</label>
          <TimeSelect value={time} onChange={setTime} />
        </div>
        <div>
          <label>Duration</label>
          <DurationSelect value={duration} onChange={setDuration} />
        </div>
        <div className="full">
          <button className="btn btn--ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn btn--amber" onClick={submit}>Add</button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="task-empty">No meetings scheduled yet — add one above, or promote something from "To Be Set Up".</p>
      ) : (
        <div className="planned-meetings">
          {sorted.map(m => (
            <PlannedMeetingRow key={m.id} meeting={m}
              onOpen={() => onOpen(m.id)}
              onDelete={() => onDelete(m.id)} />
          ))}
        </div>
      )}
    </section>
  );
}


function MeetingDetailModal({ meeting, tasks, categories, onClose, onUpdate, onDelete }){
  useEffect(() => {
    function onKey(e){ if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!meeting) return null;

  const today = todayISO();
  const isReviewType = meeting.type === 'mentor' || meeting.type === 'champion';

  let suggestions = [];
  if (isReviewType){
    const atRisk = tasks.filter(t => t.status !== 'done' && (t.atRisk || (t.endDate && t.endDate < today && !(t.dueRevisions && t.dueRevisions.length))));
    const extended = tasks.filter(t => t.status !== 'done' && t.dueRevisions && t.dueRevisions.length > 0);
    const recentlyDone = tasks.filter(t => {
      if (t.status !== 'done' || !t.completedAt) return false;
      const daysAgo = Math.round((new Date(today) - new Date(t.completedAt)) / 86400000);
      return daysAgo >= 0 && daysAgo <= 7;
    });
    const existingAgendaText = (meeting.agenda || []).map(a => a.text);
    const pack = (list, label) => list.map(t => {
      const cat = categoryById(categories, t.theme);
      return { taskId: t.id, text: `${t.title}${cat ? ` (${cat.code})` : ''} — ${label}` };
    });
    suggestions = [...pack(atRisk, 'at risk'), ...pack(extended, 'deadline extended'), ...pack(recentlyDone, 'completed this week')]
      .filter(s => !existingAgendaText.includes(s.text))
      .slice(0, 8);
  }

  function addSuggestion(text){
    onUpdate({ agenda: [...(meeting.agenda || []), { id: uid(), text, done: false }] });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-panel__head">
          <div style={{ flex: 1 }}>
            <p className="panel__eyebrow">{MEETING_TYPES[meeting.type] ? MEETING_TYPES[meeting.type].label : 'Meeting'}</p>
            <input className="modal-title-input" type="text" value={meeting.title} onChange={e => onUpdate({ title: e.target.value })} />
          </div>
          <button className="icon-btn" title="Close" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-grid">
          <div>
            <label>Date</label>
            <input type="date" value={meeting.date || ''} onChange={e => onUpdate({ date: e.target.value })} />
          </div>
          <div>
            <label>Start time</label>
            <TimeSelect value={meeting.time} onChange={time => onUpdate({ time })} />
          </div>
          <div>
            <label>Duration</label>
            <DurationSelect value={meeting.duration} onChange={duration => onUpdate({ duration })} />
          </div>
          <div>
            <label>Type</label>
            <select value={meeting.type || 'other'} onChange={e => onUpdate({ type: e.target.value })}>
              <option value="other">General</option>
              <option value="pod">POD Connect</option>
              <option value="mentor">Mentor Sync</option>
              <option value="champion">Champion Review</option>
              <option value="sprint">Sprint Call</option>
            </select>
          </div>
        </div>

        {suggestions.length > 0 && (
          <div className="modal-field">
            <label>Suggested agenda items</label>
            <div className="suggestion-list">
              {suggestions.map((s, i) => (
                <div key={i} className="suggestion-item">
                  <span>{s.text}</span>
                  <button className="btn" onClick={() => addSuggestion(s.text)}>+ Add</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="modal-field">
          <label>Agenda &amp; action items</label>
          <AgendaList agenda={meeting.agenda} onChange={agenda => onUpdate({ agenda })} />
        </div>

        <div className="modal-field">
          <label>Notes</label>
          <textarea className="modal-notes" rows={6} placeholder="Discussion notes, decisions, follow-ups…"
            value={meeting.notes || ''} onChange={e => onUpdate({ notes: e.target.value })} />
        </div>

        <div className="modal-footer">
          <button className="btn btn--danger" onClick={() => { onDelete(); onClose(); }}>Delete meeting</button>
          <button className="btn btn--amber" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function QuickLinksPanel({ links, linkTags, onAdd, onDelete, onAddTag, onDeleteTag }){
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [type, setType] = useState('auto');
  const [tag, setTag] = useState(linkTags[0] || '');
  const [manageOpen, setManageOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [activeTagFilter, setActiveTagFilter] = useState('all');

  useEffect(() => {
    if (!linkTags.includes(tag) && linkTags.length) setTag(linkTags[0]);
  }, [linkTags, tag]);

  function submit(){
    if (!label.trim() || !url.trim()) return;
    const finalType = type === 'auto' ? detectDocType(url) : type;
    onAdd(label.trim(), url.trim(), finalType, tag || linkTags[0] || 'Quick Access');
    setLabel(''); setUrl(''); setType('auto'); setOpen(false);
  }

  function submitTag(){
    if (!newTagName.trim()) return;
    onAddTag(newTagName.trim());
    setNewTagName('');
  }

  const filtered = activeTagFilter === 'all' ? links : links.filter(l => (l.tag || 'Quick Access') === activeTagFilter);

  return (
    <section className="panel">
      <div className="panel__head">
        <div>
          <p className="panel__eyebrow">External Feed</p>
          <h2 className="panel__title">Quick Links · Docs &amp; Sheets</h2>
        </div>
        <div className="week-nav">
          <button className="btn" onClick={() => setManageOpen(o => !o)}>Manage tags</button>
          <button className="btn btn--amber" onClick={() => setOpen(o => !o)}>+ Add link</button>
        </div>
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
        <div>
          <label>Type</label>
          <select value={type} onChange={e => setType(e.target.value)}>
            <option value="auto">Auto-detect</option>
            {DOC_TYPE_ORDER.map(k => <option key={k} value={k}>{DOC_TYPE_META[k].label}</option>)}
          </select>
        </div>
        <div>
          <label>Tag</label>
          <select value={tag} onChange={e => setTag(e.target.value)}>
            {linkTags.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="full">
          <button className="btn btn--ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn btn--amber" onClick={submit}>Add link</button>
        </div>
      </div>

      <div className={`add-form${manageOpen ? ' open' : ''}`}>
        <div className="full" style={{ display: 'block', marginBottom: 4 }}>
          <label>New tag</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="text" placeholder="e.g. Quick Access" value={newTagName}
              onChange={e => setNewTagName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitTag(); }} />
            <button className="btn btn--amber" onClick={submitTag}>Create</button>
          </div>
        </div>
        <div className="full" style={{ display: 'block' }}>
          <div className="category-manage-list">
            {linkTags.map(t => {
              const count = links.filter(l => (l.tag || 'Quick Access') === t).length;
              return (
                <div key={t} className="category-chip">
                  <span className="category-chip__title">{t}</span>
                  <span className="category-chip__count">{count}</span>
                  <button className="icon-btn" disabled={count > 0}
                    title={count > 0 ? 'Retag its links first' : 'Delete tag'}
                    onClick={() => onDeleteTag(t)}>&times;</button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="task-filter-tabs" style={{ marginTop: 14 }}>
        <button className={`filter-btn${activeTagFilter === 'all' ? ' active' : ''}`} onClick={() => setActiveTagFilter('all')}>All</button>
        {linkTags.map(t => (
          <button key={t} className={`filter-btn${activeTagFilter === t ? ' active' : ''}`} onClick={() => setActiveTagFilter(t)}>{t}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="quick-links-empty" style={{ marginTop: 12 }}>No links here yet — add your PRD folder, sprint sheet, or any doc you open often.</p>
      ) : DOC_TYPE_ORDER.map(typeKey => {
        const typeLinks = filtered.filter(l => (l.type || detectDocType(l.url)) === typeKey);
        if (typeLinks.length === 0) return null;
        const meta = DOC_TYPE_META[typeKey];
        return (
          <div key={typeKey} className="category-subgroup" style={{ marginTop: 14 }}>
            <p className="category-subgroup__label">{meta.icon} {meta.label}</p>
            <div className="quick-links">
              {typeLinks.map(l => (
                <div key={l.id} className="quick-link-chip">
                  <a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a>
                  {l.tag && <span className="quick-link-chip__tag">{l.tag}</span>}
                  <button title="Remove" onClick={() => onDelete(l.id)}>&times;</button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function QuickAddPanel({ categories, tasks, onAddTask, onAddCategory, onDeleteCategory }){
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState(categories[0] ? categories[0].id : '');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [manageOpen, setManageOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');

  useEffect(() => {
    if (!categories.find(c => c.id === categoryId) && categories.length) {
      setCategoryId(categories[0].id);
    }
  }, [categories, categoryId]);

  function submitTask(){
    if (!title.trim() || !categoryId) return;
    onAddTask(categoryId, title.trim(), startDate, endDate);
    setTitle(''); setStartDate(''); setEndDate('');
  }

  function submitCategory(){
    if (!newCatName.trim()) return;
    onAddCategory(newCatName.trim());
    setNewCatName('');
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <div>
          <p className="panel__eyebrow">Quick Add</p>
          <h2 className="panel__title">Log a task, tag its category</h2>
        </div>
        <button className="btn" onClick={() => setManageOpen(o => !o)}>Manage categories</button>
      </div>

      <div className="quick-add-row">
        <input
          type="text"
          placeholder="What needs to get done?"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submitTask(); }}
        />
        <select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
          {categories.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} title="Start date (optional)" />
        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} title="End date (optional)" />
        <button className="btn btn--amber" onClick={submitTask}>Add task</button>
      </div>

      <div className={`add-form${manageOpen ? ' open' : ''}`} style={{ gridTemplateColumns: '1fr auto' }}>
        <div className="full" style={{ display: 'block', marginBottom: 4 }}>
          <label>New category</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="text" placeholder="e.g. UATs" value={newCatName}
              onChange={e => setNewCatName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitCategory(); }} />
            <button className="btn btn--amber" onClick={submitCategory}>Create</button>
          </div>
        </div>
        <div className="full" style={{ display: 'block' }}>
          <div className="category-manage-list">
            {categories.map(c => {
              const count = tasks.filter(t => t.theme === c.id).length;
              return (
                <div key={c.id} className="category-chip" style={{ '--cchip-color': c.chip }}>
                  <span className="category-chip__code">{c.code}</span>
                  <span className="category-chip__title">{c.title}</span>
                  <span className="category-chip__count">{count}</span>
                  <button
                    className="icon-btn"
                    title={count > 0 ? 'Move or delete its tasks first' : 'Delete category'}
                    disabled={count > 0}
                    onClick={() => onDeleteCategory(c.id)}
                  >&times;</button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function TaskRow({ task, onUpdate, onSetStatus, onToggleRisk, onOpenDetail, onReviseDue }){
  const today = todayISO();
  const dueStatus = dueStatusInfo(task, today);
  const dueClass = dueStatus ? ` ${dueStatus.cssClass}` : '';
  const dueTitle = dueStatus ? dueStatus.label : 'End date';
  const hasContent = (task.notes && task.notes.trim()) || (task.closingRemark && task.closingRemark.trim()) || task.link;
  const hasHistory = task.dueRevisions && task.dueRevisions.length > 0;

  function handleStatusChange(e){
    const value = e.target.value;
    onSetStatus(value);
    if (value === 'done') onOpenDetail(); // surface the (optional) closing-remark field right away
  }

  function handleEndDateChange(e){
    const newVal = e.target.value;
    const isRevision = task.endDate && newVal && newVal !== task.endDate;
    onReviseDue(newVal);
    if (isRevision) onOpenDetail(); // surface the (optional) revision remark right away
  }

  return (
    <div className="task-row">
      <select
        className={`status-select status-${task.status}${task.atRisk ? ' at-risk' : ''}`}
        value={task.status}
        title="Update status"
        onChange={handleStatusChange}
      >
        <option value="todo">To do</option>
        <option value="progress">In progress</option>
        <option value="done">Done</option>
      </select>
      <input className={`task-title${task.status === 'done' ? ' is-done' : ''}`} type="text" value={task.title}
        onChange={e => onUpdate({ title: e.target.value })} />
      <div className="date-range">
        <input className="task-due" type="date" value={task.startDate || ''} title="Start date"
          onChange={e => onUpdate({ startDate: e.target.value })} />
        <span className="date-range__arrow">&rarr;</span>
        <div className="due-wrap">
          <input className={`task-due${dueClass}`} type="date" value={task.endDate || ''} title={dueTitle}
            onChange={handleEndDateChange} />
          {hasHistory && <span className="extended-dot" title={`Deadline extended ${task.dueRevisions.length}\u00d7`} />}
        </div>
      </div>
      <button className={`icon-btn${task.atRisk ? ' flag-on' : ''}`} title="Flag at risk" onClick={onToggleRisk}>&#9873;</button>
      {task.subtasks && task.subtasks.length > 0 && (
        <span className="subtask-badge" title="Sub-task progress">{task.subtasks.filter(s => s.done).length}/{task.subtasks.length}</span>
      )}
      <button className={`icon-btn${hasContent ? ' link-on' : ''}`} title="Open details & notes" onClick={onOpenDetail}>&#8942;</button>
    </div>
  );
}

function SubtaskList({ task, onAdd, onToggle, onUpdate, onDelete }){
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const subtasks = task.subtasks || [];
  const doneCount = subtasks.filter(s => s.done).length;

  function submit(){
    if (!title.trim()) return;
    onAdd(title.trim(), startDate, endDate);
    setTitle(''); setStartDate(''); setEndDate('');
  }

  return (
    <div>
      {subtasks.length > 0 && (
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-lo)', marginBottom: 8 }}>{doneCount}/{subtasks.length} complete</p>
      )}
      {subtasks.length > 0 && (
        <div className="subtask-list">
          {subtasks.map(s => (
            <div key={s.id} className={`subtask-item${s.done ? ' done' : ''}`}>
              <input type="checkbox" checked={s.done} onChange={() => onToggle(s.id)} />
              <span className="subtask-item__title">{s.title}</span>
              <input type="date" className="subtask-item__date" value={s.startDate || ''} title="Start date (can't be before the task's own start)"
                onChange={e => onUpdate(s.id, { startDate: e.target.value })} />
              <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>&rarr;</span>
              <input type="date" className="subtask-item__date" value={s.endDate || ''} title="End date (can't be after the task's own end)"
                onChange={e => onUpdate(s.id, { endDate: e.target.value })} />
              <button className="icon-btn" title="Remove" onClick={() => onDelete(s.id)}>&times;</button>
            </div>
          ))}
        </div>
      )}
      <div className="agenda-add">
        <input type="text" placeholder="Add a sub-task…" value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} title="Start date (optional)" />
        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} title="End date (optional)" />
        <button className="btn" onClick={submit}>Add</button>
      </div>
    </div>
  );
}

function TaskDetailModal({ task, category, onClose, onUpdate, onDelete, onReviseDue, onSetFocusTime, onAddSubtask, onToggleSubtask, onUpdateSubtask, onDeleteSubtask }){
  useEffect(() => {
    function onKey(e){ if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!task) return null;

  const revisions = task.dueRevisions || [];

  function handleEndDateChange(e){
    const newVal = e.target.value;
    const isRevision = task.endDate && newVal && newVal !== task.endDate;
    onReviseDue(newVal);
    return isRevision;
  }

  function updateLastRevisionRemark(value){
    if (revisions.length === 0) return;
    const updated = [...revisions];
    updated[updated.length - 1] = { ...updated[updated.length - 1], remark: value };
    onUpdate({ dueRevisions: updated });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-panel__head">
          <div style={{ flex: 1 }}>
            <p className="panel__eyebrow">{category ? `${category.code} · ${category.title}` : 'Uncategorised'}</p>
            <input className="modal-title-input" type="text" value={task.title}
              onChange={e => onUpdate({ title: e.target.value })} />
          </div>
          <button className="icon-btn" title="Close" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-grid">
          <div>
            <label>Status</label>
            <select value={task.status}
              onChange={e => {
                const val = e.target.value;
                onUpdate({ status: val, atRisk: val === 'done' ? false : task.atRisk, completedAt: val === 'done' ? todayISO() : '' });
              }}>
              <option value="todo">To do</option>
              <option value="progress">In progress</option>
              <option value="done">Done</option>
            </select>
          </div>
          <div>
            <label>Start date</label>
            <input type="date" value={task.startDate || ''} onChange={e => onUpdate({ startDate: e.target.value })} />
          </div>
          <div>
            <label>End date {revisions.length > 0 && <span style={{ color: 'var(--purple)' }}>(Extended)</span>}</label>
            <input type="date" value={task.endDate || ''} onChange={handleEndDateChange} />
          </div>
          <div>
            <label>Risk flag</label>
            <button className={`btn${task.atRisk ? ' btn--amber' : ' btn--ghost'}`} style={{ width: '100%' }}
              onClick={() => onUpdate({ atRisk: !task.atRisk })}>
              {task.atRisk ? '⚑ Flagged at risk' : 'Not flagged'}
            </button>
          </div>
          <div>
            <label>Weight</label>
            <input type="number" min="1" max="10" step="1" value={task.weight || 1}
              onChange={e => onUpdate({ weight: Math.max(1, Number(e.target.value) || 1) })} />
          </div>
        </div>

        {revisions.length > 0 && (
          <div className="modal-field">
            <label>Deadline history</label>
            <div className="revision-history">
              {revisions.map((r, i) => (
                <div key={i} className="revision-history__item">
                  <span className="revision-history__dates">{r.from} &rarr; {r.to}</span>
                  {r.remark && <span className="revision-history__remark">{r.remark}</span>}
                </div>
              ))}
            </div>
            <textarea rows={2} placeholder="Optional remark for the latest extension…"
              value={revisions[revisions.length - 1].remark || ''}
              onChange={e => updateLastRevisionRemark(e.target.value)} />
          </div>
        )}

        <div className="modal-field">
          <label>Linked doc / sheet</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="url" placeholder="https://docs.google.com/..." value={task.link || ''}
              onChange={e => onUpdate({ link: e.target.value })} style={{ flex: 1 }} />
            {task.link && <button className="btn" onClick={() => window.open(task.link, '_blank', 'noopener')}>Open</button>}
          </div>
        </div>

        <div className="modal-field">
          <label>Focus time</label>
          <button className="btn btn--amber" onClick={onSetFocusTime}>Set focus time on the calendar</button>
        </div>

        {task.status === 'done' && (
          <div className="modal-field">
            <label>Closing remarks (optional)</label>
            <textarea rows={2} placeholder="Anything worth noting as you close this out…"
              value={task.closingRemark || ''} onChange={e => onUpdate({ closingRemark: e.target.value })} />
          </div>
        )}

        <div className="modal-field">
          <label>Sub-tasks</label>
          <SubtaskList
            task={task}
            onAdd={(title, s, e) => onAddSubtask(title, s, e)}
            onToggle={id => onToggleSubtask(id)}
            onUpdate={(id, patch) => onUpdateSubtask(id, patch)}
            onDelete={id => onDeleteSubtask(id)}
          />
        </div>

        <div className="modal-field">
          <label>Detailed notes</label>
          <textarea className="modal-notes" rows={10}
            placeholder="Write as much as you need — context, decisions, discussion threads, next steps…"
            value={task.notes || ''} onChange={e => onUpdate({ notes: e.target.value })} />
        </div>

        <div className="modal-footer">
          <button className="btn btn--danger" onClick={() => { onDelete(); onClose(); }}>Delete task</button>
          <button className="btn btn--amber" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function categoryStatus(tasks, categoryId){
  const catTasks = tasks.filter(t => t.theme === categoryId);
  const open = catTasks.filter(t => t.status !== 'done');
  const today = todayISO();
  if (open.some(t => t.atRisk || (t.endDate && t.endDate < today && !(t.dueRevisions && t.dueRevisions.length)))) return { label: 'CRITICAL', color: 'var(--red)' };
  if (open.some(t => t.status === 'progress')) return { label: 'ACTIVE', color: 'var(--cyan)' };
  if (open.length > 0) return { label: 'PENDING', color: 'var(--amber)' };
  if (catTasks.length > 0) return { label: 'CLEAR', color: 'var(--green)' };
  return { label: 'IDLE', color: 'var(--text-faint)' };
}

function TaskListView({ tasks, categories, onUpdateTask, onSetTaskStatus, onToggleRisk, onOpenDetail, onReviseDue }){
  const [filter, setFilter] = useState('all');

  const today = todayISO();
  const monday = getMonday(new Date());
  const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
  const weekStart = isoOf(monday);
  const weekEnd = isoOf(sunday);
  const now = new Date();
  const monthStart = isoOf(new Date(now.getFullYear(), now.getMonth(), 1));
  const monthEnd = isoOf(new Date(now.getFullYear(), now.getMonth() + 1, 0));

  const filtered = tasks.filter(t => matchesTaskFilter(t, filter, today, weekStart, weekEnd, monthStart, monthEnd));

  function renderTaskRow(t){
    return (
      <TaskRow
        key={t.id}
        task={t}
        onUpdate={patch => onUpdateTask(t.id, patch)}
        onSetStatus={status => onSetTaskStatus(t.id, status)}
        onToggleRisk={() => onToggleRisk(t.id)}
        onOpenDetail={() => onOpenDetail(t.id)}
        onReviseDue={date => onReviseDue(t.id, date)}
      />
    );
  }

  return (
    <section className="panel" style={{ background: 'transparent', border: 'none', padding: 0 }}>
      <div className="panel__head">
        <div>
          <p className="panel__eyebrow">Task Console</p>
          <h2 className="panel__title">Grouped by status, then category</h2>
        </div>
      </div>

      <div className="task-filter-tabs">
        {TASK_FILTERS.map(f => (
          <button key={f.id} className={`filter-btn${filter === f.id ? ' active' : ''}`} onClick={() => setFilter(f.id)}>{f.label}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="task-empty" style={{ padding: '20px 0' }}>Nothing here yet — try Quick Add above to log your first task.</p>
      ) : STATUS_ORDER.map(statusId => {
        const statusTasks = filtered.filter(t => t.status === statusId);
        if (statusTasks.length === 0) return null;
        const meta = STATUS_META[statusId];
        const orphanTasks = statusTasks.filter(t => !categories.find(c => c.id === t.theme));

        return (
          <div className="status-group" key={statusId}>
            <h3 className="status-group__title" style={{ color: meta.color, borderColor: meta.color }}>
              {meta.label}<span className="status-group__count">{statusTasks.length}</span>
            </h3>

            {categories.map(cat => {
              const catTasks = statusTasks.filter(t => t.theme === cat.id);
              if (catTasks.length === 0) return null;
              const st = categoryStatus(tasks, cat.id);
              return (
                <div className="category-subgroup" key={cat.id}>
                  <p className="category-subgroup__label" style={{ '--cchip-color': cat.chip }}>
                    <span className="category-subgroup__dot" style={{ background: st.color }} />
                    {cat.code} · {cat.title}
                  </p>
                  <div className="task-list">
                    {catTasks.map(renderTaskRow)}
                  </div>
                </div>
              );
            })}

            {orphanTasks.length > 0 && (
              <div className="category-subgroup">
                <p className="category-subgroup__label">Uncategorised</p>
                <div className="task-list">
                  {orphanTasks.map(renderTaskRow)}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

/* ============================== Progress, planning & digest ============================== */

function ProgressBar({ percent, color }){
  const pct = percent === null ? 0 : percent;
  return (
    <div className="progress-track">
      <div className="progress-fill" style={{ width: `${pct}%`, background: color || 'var(--amber)' }} />
    </div>
  );
}

function ProgressPanel({ dailyProgress, weeklyProgress, timeElapsedPercent, weekElapsedPercent }){
  const dailyColor = dailyProgress.percent === null ? 'var(--text-faint)'
    : dailyProgress.percent >= timeElapsedPercent ? 'var(--green)'
    : (timeElapsedPercent - dailyProgress.percent <= 15 ? 'var(--amber)' : 'var(--red)');

  const weeklyColor = weeklyProgress.percent === null ? 'var(--text-faint)'
    : weeklyProgress.percent >= weekElapsedPercent ? 'var(--green)'
    : (weekElapsedPercent - weeklyProgress.percent <= 15 ? 'var(--amber)' : 'var(--red)');

  return (
    <section className="panel">
      <div className="panel__head" style={{ marginBottom: 12 }}>
        <div>
          <p className="panel__eyebrow">My Progress</p>
          <h2 className="panel__title">Weighted task completion</h2>
        </div>
      </div>

      <div className="progress-row">
        <div className="progress-row__label">
          <span>Today</span>
          <span>{dailyProgress.percent === null ? 'No tasks today' : `${dailyProgress.percent}% complete`}</span>
        </div>
        <ProgressBar percent={dailyProgress.percent} color={dailyColor} />
        <div className="progress-row__sub">
          <span>Day elapsed: {timeElapsedPercent}%</span>
          {dailyProgress.percent !== null && (
            <span>{dailyProgress.percent >= timeElapsedPercent ? 'On pace' : 'Behind pace'}</span>
          )}
        </div>
      </div>

      <div className="progress-row">
        <div className="progress-row__label">
          <span>This Week</span>
          <span>{weeklyProgress.percent === null ? 'No tasks this week' : `${weeklyProgress.percent}% complete`}</span>
        </div>
        <ProgressBar percent={weeklyProgress.percent} color={weeklyColor} />
        <div className="progress-row__sub">
          <span>Week elapsed (Mon&ndash;Fri): {weekElapsedPercent}%</span>
          {weeklyProgress.percent !== null && (
            <span>{weeklyProgress.percent >= weekElapsedPercent ? 'On pace' : 'Behind pace'}</span>
          )}
        </div>
      </div>
    </section>
  );
}

function TimeLapsedPanel({ workingHours, defaultWorkingHours, oooRanges, now }){
  const today = todayISO();
  const hours = getWorkingHours(workingHours, defaultWorkingHours, today);
  const ooo = oooRanges[today];
  const lapsed = computeTimeLapsed(hours, ooo, now);

  return (
    <section className="panel">
      <div className="panel__head" style={{ marginBottom: 10 }}>
        <div>
          <p className="panel__eyebrow">Time Lapsed</p>
          <h2 className="panel__title">Today's working window: {hours.start} &ndash; {hours.end}</h2>
        </div>
      </div>
      {lapsed.fullDayOff ? (
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-lo)' }}>Out of office today &mdash; no working hours tracked.</p>
      ) : (
        <React.Fragment>
          <ProgressBar percent={lapsed.percent} color="var(--cyan)" />
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-lo)', marginTop: 8 }}>{lapsed.percent}% of today's working hours elapsed</p>
        </React.Fragment>
      )}
    </section>
  );
}

function DailyPlannerModal({ defaultWorkingHours, todayMeetings, todayTasks, categories, unfiledNotes, onDeleteNote, onAddTask, onAddMeeting, onClose }){
  const [start, setStart] = useState(defaultWorkingHours.start);
  const [end, setEnd] = useState(defaultWorkingHours.end);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskCategory, setTaskCategory] = useState(categories[0] ? categories[0].id : '');
  const [meetingTitle, setMeetingTitle] = useState('');
  const [meetingTime, setMeetingTime] = useState('09:00');
  const [meetingDuration, setMeetingDuration] = useState(30);

  function addTaskQuick(){
    if (!taskTitle.trim() || !taskCategory) return;
    onAddTask(taskCategory, taskTitle.trim(), '', todayISO());
    setTaskTitle('');
  }
  function addMeetingQuick(){
    if (!meetingTitle.trim()) return;
    onAddMeeting(meetingTitle.trim(), todayISO(), meetingTime, meetingDuration, 'other');
    setMeetingTitle('');
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-panel">
        <div className="modal-panel__head">
          <div style={{ flex: 1 }}>
            <p className="panel__eyebrow">{getTimeGreeting(new Date().getHours())}</p>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700 }}>Set up today</div>
          </div>
        </div>

        {unfiledNotes.length > 0 && (
          <div className="modal-field">
            <label style={{ color: 'var(--amber)' }}>Unfiled notes from before</label>
            <div className="sticky-note-list">
              {unfiledNotes.map(n => (
                <div key={n.id} className="sticky-note">
                  <span>{n.text}</span>
                  <button className="icon-btn" title="Filed elsewhere — remove" onClick={() => onDeleteNote(n.id)}>&times;</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="modal-field">
          <label>Working hours for today</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <TimeSelect value={start} onChange={setStart} />
            <span style={{ color: 'var(--text-faint)' }}>&rarr;</span>
            <TimeSelect value={end} onChange={setEnd} />
          </div>
        </div>

        <div className="modal-field">
          <label>Already on the books today</label>
          {todayMeetings.length === 0 && todayTasks.length === 0 ? (
            <p style={{ color: 'var(--text-lo)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Nothing yet — add below if you know what's coming.</p>
          ) : (
            <div className="today-list">
              {todayMeetings.map(m => (
                <div key={m.id} className="today-item" style={{ cursor: 'default' }}>
                  <span className="today-item__time">{m.time || m.time === 0 ? m.time : '—'}</span>
                  <span className="today-item__title">{m.name || m.title}</span>
                </div>
              ))}
              {todayTasks.map(t => (
                <div key={t.id} className="today-item" style={{ cursor: 'default' }}>
                  <span className="today-item__title">{t.title}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-field">
          <label>Quick-add a task for today</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input type="text" placeholder="What needs to get done?" value={taskTitle}
              onChange={e => setTaskTitle(e.target.value)} style={{ flex: '2 1 200px' }}
              onKeyDown={e => { if (e.key === 'Enter') addTaskQuick(); }} />
            <select value={taskCategory} onChange={e => setTaskCategory(e.target.value)} style={{ flex: '1 1 140px' }}>
              {categories.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <button className="btn btn--amber" onClick={addTaskQuick}>Add</button>
          </div>
        </div>

        <div className="modal-field">
          <label>Quick-add a meeting for today</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input type="text" placeholder="Meeting title" value={meetingTitle}
              onChange={e => setMeetingTitle(e.target.value)} style={{ flex: '2 1 200px' }} />
            <TimeSelect value={meetingTime} onChange={setMeetingTime} />
            <DurationSelect value={meetingDuration} onChange={setMeetingDuration} />
            <button className="btn btn--amber" onClick={addMeetingQuick}>Add</button>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn--amber" onClick={() => onClose({ start, end })}>Start my day</button>
        </div>
      </div>
    </div>
  );
}

function WeeklyDigestModal({ weekLabel, categories, tasks, onClose }){
  const today = todayISO();
  const realMonday = getMonday(new Date());
  const weekStart = isoOf(realMonday);
  const realSunday = new Date(realMonday); realSunday.setDate(realSunday.getDate() + 6);
  const weekEnd = isoOf(realSunday);

  const completed = tasks.filter(t => t.status === 'done' && t.completedAt && t.completedAt >= weekStart && t.completedAt <= weekEnd);
  const stillOpen = tasks.filter(t => t.status !== 'done' && taskMatchesRange(t, weekStart, weekEnd));
  const extended = stillOpen.filter(t => t.dueRevisions && t.dueRevisions.length > 0);
  const atRisk = stillOpen.filter(t => t.atRisk || (t.endDate && t.endDate < today && !(t.dueRevisions && t.dueRevisions.length)));
  const progress = computeProgress(tasks, t => taskMatchesRange(t, weekStart, weekEnd));

  function section(title, list, color){
    if (list.length === 0) return null;
    return (
      <div className="modal-field">
        <label style={{ color }}>{title} ({list.length})</label>
        <div className="digest-list">
          {list.map(t => {
            const cat = categoryById(categories, t.theme);
            return (
              <div key={t.id} className="digest-item">
                <span className="digest-item__code">{cat ? cat.code : '—'}</span>
                <span>{t.title}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-panel__head">
          <div style={{ flex: 1 }}>
            <p className="panel__eyebrow">Weekly Digest</p>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700 }}>{weekLabel}</div>
          </div>
          <button className="icon-btn" title="Close" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-field">
          <label>Week progress</label>
          <ProgressBar percent={progress.percent} color="var(--cyan)" />
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-lo)', marginTop: 6 }}>
            {progress.percent === null ? 'No tasks tracked this week.' : `${progress.percent}% of this week's weighted workload complete.`}
          </p>
        </div>

        {section('Completed this week', completed, 'var(--green)')}
        {section('Still open', stillOpen, 'var(--text-lo)')}
        {section('Extended', extended, 'var(--purple)')}
        {section('At risk', atRisk, 'var(--red)')}

        {completed.length === 0 && stillOpen.length === 0 && (
          <p className="task-empty">Nothing tracked for this week yet.</p>
        )}

        <div className="modal-footer">
          <button className="btn btn--amber" onClick={onClose} style={{ marginLeft: 'auto' }}>Close</button>
        </div>
      </div>
    </div>
  );
}

/* ============================== Auth ============================== */

function ConfigMissingNotice(){
  return (
    <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div className="modal-panel" style={{ maxWidth: 440 }}>
        <p className="panel__eyebrow">Setup needed</p>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700, marginBottom: 10 }}>Supabase isn't configured yet</div>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-lo)', lineHeight: 1.6 }}>
          Edit <code>config.js</code> in your repo and replace the placeholder <code>url</code> and <code>anonKey</code> with the values
          from your Supabase project's Settings &rarr; API page, then commit and refresh.
        </p>
      </div>
    </div>
  );
}

function LoadingScreen({ message }){
  return (
    <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-lo)' }}>{message}</p>
    </div>
  );
}

function AuthGate(){
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function sendLink(){
    if (!email.trim()) return;
    setBusy(true); setError('');
    // Compute the redirect target from wherever this page is actually running,
    // rather than relying on it matching Supabase's Site URL setting exactly.
    // This still needs to be added under Authentication → URL Configuration →
    // Redirect URLs in Supabase, but doesn't have to be the *default* Site URL.
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await supabaseClient.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true, emailRedirectTo: redirectTo }
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setSent(true);
  }

  return (
    <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div className="modal-panel" style={{ maxWidth: 400 }}>
        <div className="modal-panel__head">
          <div>
            <p className="panel__eyebrow">Control Centre</p>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700 }}>Sign in</div>
          </div>
        </div>

        {!sent ? (
          <React.Fragment>
            <div className="modal-field">
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com"
                onKeyDown={e => { if (e.key === 'Enter') sendLink(); }} autoFocus />
            </div>
            {error && <p style={{ color: 'var(--red)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>{error}</p>}
            <div className="modal-footer">
              <button className="btn btn--amber" disabled={busy} onClick={sendLink} style={{ marginLeft: 'auto' }}>
                {busy ? 'Sending…' : 'Send sign-in link'}
              </button>
            </div>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-lo)', lineHeight: 1.6 }}>
              Check {email} for a sign-in link. Click it and you'll land back here, signed in.
            </p>
            <div className="modal-footer">
              <button className="btn btn--ghost" onClick={() => { setSent(false); setError(''); }}>Use a different email</button>
            </div>
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

/* ============================== App ============================== */

function App(){
  const [session, setSession] = useState(undefined); // undefined = still checking, null = signed out
  const [loaded, setLoaded] = useState(false);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [categoryCounter, setCategoryCounter] = useState(DEFAULT_CATEGORIES.length + 1);
  const [meetings, setMeetings] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [quickLinks, setQuickLinks] = useState([]);
  const [linkTags, setLinkTags] = useState(DEFAULT_LINK_TAGS);
  const [pendingMeetings, setPendingMeetings] = useState([]);
  const [plannedMeetings, setPlannedMeetings] = useState([]);
  const [settings, setSettings] = useState({ calendarEmbedUrl: '' });
  const [weekOffset, setWeekOffset] = useState(0);
  const [addMeetingOpen, setAddMeetingOpen] = useState(false);
  const [now, setNow] = useState(new Date());
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [detailTaskId, setDetailTaskId] = useState(null);
  const [focusTaskId, setFocusTaskId] = useState(null);
  const [meetingDetailId, setMeetingDetailId] = useState(null);
  const [workingHours, setWorkingHours] = useState({});
  const [defaultWorkingHours, setDefaultWorkingHours] = useState({ start: '09:00', end: '18:00' });
  const [lastVisitDate, setLastVisitDate] = useState('');
  const [lastDigestWeek, setLastDigestWeek] = useState('');
  const [dailyPlannerOpen, setDailyPlannerOpen] = useState(false);
  const [digestOpen, setDigestOpen] = useState(false);
  const [oooRanges, setOooRanges] = useState({});
  const [stickyNotes, setStickyNotes] = useState([]);
  const [lastEodPromptDate, setLastEodPromptDate] = useState('');
  const [eodModalOpen, setEodModalOpen] = useState(false);
  const [legacyImport, setLegacyImport] = useState(null);
  const saveTimer = useRef(null);

  // Check for an existing session on load, and keep listening for sign-in/out.
  useEffect(() => {
    if (!supabaseClient) { setSession(null); return; }
    supabaseClient.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: listener } = supabaseClient.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  function applyLoadedData(parsed){
    const cats = (parsed.categories && parsed.categories.length) ? parsed.categories : DEFAULT_CATEGORIES;
    setCategories(cats);
    setCategoryCounter(parsed.categoryCounter || (cats.length + 1));
    setMeetings(parsed.meetings || []);
    setTasks(parsed.tasks || []);
    setQuickLinks(parsed.quickLinks || []);
    setLinkTags((parsed.linkTags && parsed.linkTags.length) ? parsed.linkTags : DEFAULT_LINK_TAGS);
    setPendingMeetings(parsed.pendingMeetings || []);
    setPlannedMeetings(parsed.plannedMeetings || []);
    setSettings(Object.assign({ calendarEmbedUrl: '' }, parsed.settings || {}));
    setWorkingHours(parsed.workingHours || {});
    setDefaultWorkingHours(parsed.defaultWorkingHours || { start: '09:00', end: '18:00' });
    setOooRanges(parsed.oooRanges || {});
    setStickyNotes(parsed.stickyNotes || []);
    setLastEodPromptDate(parsed.lastEodPromptDate || '');
    return { lastVisitDate: parsed.lastVisitDate || '', lastDigestWeek: parsed.lastDigestWeek || '' };
  }

  // Once signed in, load this user's data from Supabase (each user's row is
  // walled off from everyone else's by the database's row-level security).
  useEffect(() => {
    if (!session) { setLoaded(false); return; }
    let cancelled = false;

    (async () => {
      let resumedLastVisit = '';
      let resumedDigestWeek = '';
      try {
        const { data, error } = await supabaseClient
          .from('app_state')
          .select('data')
          .eq('user_id', session.user.id)
          .maybeSingle();
        if (error) throw error;
        if (cancelled) return;

        if (data && data.data && Object.keys(data.data).length > 0) {
          const resumed = applyLoadedData(data.data);
          resumedLastVisit = resumed.lastVisitDate;
          resumedDigestWeek = resumed.lastDigestWeek;
          setLastVisitDate(resumedLastVisit);
          setLastDigestWeek(resumedDigestWeek);
        } else {
          const seed = getSeedData();
          setCategories(seed.categories);
          setCategoryCounter(seed.categoryCounter);
          setMeetings(seed.meetings);
          setTasks(seed.tasks);
          setQuickLinks(seed.quickLinks);
          setLinkTags(seed.linkTags);
          setPendingMeetings(seed.pendingMeetings);
          setPlannedMeetings(seed.plannedMeetings);

          // No cloud data yet for this account — check whether this browser has
          // data left over from before sign-in was added, and offer to bring it in.
          try {
            const legacyRaw = localStorage.getItem('control-centre-state');
            if (legacyRaw) {
              const legacyParsed = JSON.parse(legacyRaw);
              const hasContent = legacyParsed && (
                (legacyParsed.tasks && legacyParsed.tasks.length) ||
                (legacyParsed.meetings && legacyParsed.meetings.length) ||
                (legacyParsed.quickLinks && legacyParsed.quickLinks.length) ||
                (legacyParsed.pendingMeetings && legacyParsed.pendingMeetings.length) ||
                (legacyParsed.plannedMeetings && legacyParsed.plannedMeetings.length)
              );
              if (hasContent) setLegacyImport(legacyParsed);
            }
          } catch (e) {
            console.error('Failed to read legacy local data', e);
          }
        }
      } catch (e) {
        console.error('Failed to load cloud data', e);
      }
      if (cancelled) return;

      const today = todayISO();
      if (resumedLastVisit !== today) setDailyPlannerOpen(true);
      const isFriday = new Date().getDay() === 5;
      const mondayIso = isoOf(getMonday(new Date()));
      if (isFriday && resumedDigestWeek !== mondayIso) setDigestOpen(true);

      setLoaded(true);
    })();

    return () => { cancelled = true; };
  }, [session]);

  // Save whenever data changes, debounced so we're not hitting the database on
  // every keystroke — skipped until the initial load for this user completes.
  useEffect(() => {
    if (!loaded || !session) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const payload = {
        categories, categoryCounter, meetings, tasks, quickLinks, linkTags,
        pendingMeetings, plannedMeetings, settings, workingHours, defaultWorkingHours,
        lastVisitDate, lastDigestWeek, oooRanges, stickyNotes, lastEodPromptDate
      };
      supabaseClient
        .from('app_state')
        .upsert({ user_id: session.user.id, data: payload, updated_at: new Date().toISOString() })
        .then(({ error }) => {
          if (error) { console.error('Failed to save cloud data', error); return; }
          setSaved(true);
          setTimeout(() => setSaved(false), 900);
        });
    }, 800);
    return () => clearTimeout(saveTimer.current);
  }, [categories, categoryCounter, meetings, tasks, quickLinks, linkTags, pendingMeetings, plannedMeetings, settings, workingHours, defaultWorkingHours, lastVisitDate, lastDigestWeek, oooRanges, stickyNotes, lastEodPromptDate, loaded, session]);

  function signOut(){
    supabaseClient.auth.signOut();
  }

  // Clock
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // End-of-day nudge: once the working day is over, if there are unfiled sticky notes
  // and we haven't already nagged about them today, surface a one-time reminder.
  useEffect(() => {
    if (!loaded) return;
    const today = todayISO();
    if (lastEodPromptDate === today) return;
    if (stickyNotes.length === 0) return;
    const hours = getWorkingHours(workingHours, defaultWorkingHours, today);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    if (nowMin >= minutesSinceMidnight(hours.end)) {
      setEodModalOpen(true);
    }
  }, [now, loaded, stickyNotes, workingHours, defaultWorkingHours, lastEodPromptDate]);

  /* ---------- Category actions ---------- */
  function addCategory(title){
    const code = 'CH-' + String(categoryCounter).padStart(2, '0');
    setCategories(cs => [...cs, { id: uid(), code, title, ...colorForIndex(categoryCounter - 1) }]);
    setCategoryCounter(c => c + 1);
  }
  function deleteCategory(id){
    const hasTasks = tasks.some(t => t.theme === id);
    if (hasTasks) return; // guarded in the UI too; extra safety here
    setCategories(cs => cs.filter(c => c.id !== id));
  }

  /* ---------- Task actions ---------- */
  function addTask(categoryId, title, startDate, endDate){
    setTasks(ts => [...ts, { id: uid(), theme: categoryId, title, status: 'todo', atRisk: false, startDate: startDate || '', endDate: endDate || '', notes: '', link: '', closingRemark: '', weight: 1, completedAt: '' }]);
  }
  function updateTask(id, patch){
    setTasks(ts => ts.map(t => (t.id === id ? { ...t, ...patch } : t)));
  }
  function deleteTask(id){
    setTasks(ts => ts.filter(t => t.id !== id));
  }
  function setTaskStatus(id, status){
    setTasks(ts => ts.map(t => (t.id === id
      ? { ...t, status, atRisk: status === 'done' ? false : t.atRisk, completedAt: status === 'done' ? todayISO() : '' }
      : t)));
  }
  function toggleRisk(id){
    setTasks(ts => ts.map(t => (t.id === id ? { ...t, atRisk: !t.atRisk } : t)));
  }
  function reviseDueDate(id, newDue){
    setTasks(ts => ts.map(t => {
      if (t.id !== id) return t;
      if (t.endDate && newDue && newDue !== t.endDate) {
        const revisions = [...(t.dueRevisions || []), { from: t.endDate, to: newDue, remark: '', at: new Date().toISOString() }];
        return { ...t, endDate: newDue, dueRevisions: revisions };
      }
      return { ...t, endDate: newDue };
    }));
  }
  function addFocusBlock(taskId, taskTitle, date, time, duration){
    setPlannedMeetings(pm => [...pm, { id: uid(), title: `Focus: ${taskTitle}`, date, time, duration: duration || 30, agenda: [], notes: '', kind: 'focus', taskId }]);
  }
  function goToTask(id){
    setActiveTab('tasks');
    setDetailTaskId(id);
  }

  /* ---------- Meeting actions ---------- */
  function addMeeting(m){
    setMeetings(ms => [...ms, { ...m, id: uid() }]);
  }
  function deleteMeeting(id){
    setMeetings(ms => ms.filter(m => m.id !== id));
  }

  /* ---------- Quick link actions ---------- */
  function addQuickLink(label, url, type, tag){
    setQuickLinks(qs => [...qs, { id: uid(), label, url, type, tag }]);
  }
  function deleteQuickLink(id){
    setQuickLinks(qs => qs.filter(q => q.id !== id));
  }
  function addLinkTag(name){
    setLinkTags(ts => (ts.includes(name) ? ts : [...ts, name]));
  }
  function deleteLinkTag(name){
    const inUse = quickLinks.some(l => (l.tag || 'Quick Access') === name);
    if (inUse) return;
    setLinkTags(ts => ts.filter(t => t !== name));
  }

  /* ---------- Meeting-invite actions ---------- */
  function addPendingMeeting(title, targetDate, notes){
    setPendingMeetings(ps => [...ps, { id: uid(), title, targetDate: targetDate || '', notes: notes || '' }]);
  }
  function updatePendingMeeting(id, patch){
    setPendingMeetings(ps => ps.map(p => (p.id === id ? { ...p, ...patch } : p)));
  }
  function deletePendingMeeting(id){
    setPendingMeetings(ps => ps.filter(p => p.id !== id));
  }
  function promotePendingMeeting(id, date, time, duration){
    const m = pendingMeetings.find(p => p.id === id);
    if (!m) return;
    setPendingMeetings(ps => ps.filter(p => p.id !== id));
    setPlannedMeetings(pm => [...pm, {
      id: uid(), title: m.title, date: date || m.targetDate || todayISO(), time: time || '09:00',
      duration: duration || 30, agenda: [], notes: m.notes || '', kind: 'meeting', type: 'other'
    }]);
  }
  function addPlannedMeeting(title, date, time, duration, type){
    setPlannedMeetings(pm => [...pm, { id: uid(), title, date, time, duration: duration || 30, type: type || 'other', agenda: [], notes: '', kind: 'meeting' }]);
  }
  function updatePlannedMeeting(id, patch){
    setPlannedMeetings(pm => pm.map(p => (p.id === id ? { ...p, ...patch } : p)));
  }
  function deletePlannedMeeting(id){
    setPlannedMeetings(pm => pm.filter(p => p.id !== id));
  }

  /* ---------- Working hours / daily planner / weekly digest ---------- */
  function setWorkingHoursForDate(dateISO, hours){
    setWorkingHours(wh => ({ ...wh, [dateISO]: hours }));
  }
  function closeDailyPlanner(todayHours){
    if (todayHours) setWorkingHoursForDate(todayISO(), todayHours);
    setLastVisitDate(todayISO());
    setDailyPlannerOpen(false);
  }
  function closeDigest(){
    if (new Date().getDay() === 5) setLastDigestWeek(isoOf(getMonday(new Date())));
    setDigestOpen(false);
  }

  /* ---------- Out of office ---------- */
  function toggleFullDayOOO(dateISO){
    setOooRanges(o => {
      const current = o[dateISO] || { fullDay: false, blocks: [] };
      return { ...o, [dateISO]: { ...current, fullDay: !current.fullDay } };
    });
  }
  function addOOOBlock(dateISO, start, end){
    if (!start || !end || end <= start) return;
    setOooRanges(o => {
      const current = o[dateISO] || { fullDay: false, blocks: [] };
      return { ...o, [dateISO]: { ...current, blocks: [...(current.blocks || []), { id: uid(), start, end }] } };
    });
  }
  function deleteOOOBlock(dateISO, blockId){
    setOooRanges(o => {
      const current = o[dateISO];
      if (!current) return o;
      return { ...o, [dateISO]: { ...current, blocks: (current.blocks || []).filter(b => b.id !== blockId) } };
    });
  }

  /* ---------- Sticky notes ---------- */
  function addStickyNote(text){
    setStickyNotes(ns => [...ns, { id: uid(), text, createdAt: todayISO() }]);
  }
  function deleteStickyNote(id){
    setStickyNotes(ns => ns.filter(n => n.id !== id));
  }
  function closeEodModal(){
    setLastEodPromptDate(todayISO());
    setEodModalOpen(false);
  }

  function importLegacyData(){
    if (!legacyImport) return;
    applyLoadedData(legacyImport);
    // The save effect (keyed on `loaded`/`session`) will push this to Supabase
    // on the next tick since `loaded` is already true by the time this runs.
    localStorage.removeItem('control-centre-state');
    setLegacyImport(null);
  }
  function discardLegacyData(){
    localStorage.removeItem('control-centre-state');
    setLegacyImport(null);
  }

  /* ---------- Sub-tasks ---------- */
  function addSubtask(taskId, title, startDate, endDate){
    setTasks(ts => ts.map(t => {
      if (t.id !== taskId) return t;
      const clamped = clampSubtaskDates(t, startDate, endDate);
      return { ...t, subtasks: [...(t.subtasks || []), { id: uid(), title, done: false, startDate: clamped.startDate, endDate: clamped.endDate }] };
    }));
  }
  function toggleSubtask(taskId, subId){
    setTasks(ts => ts.map(t => (t.id !== taskId ? t : { ...t, subtasks: (t.subtasks || []).map(s => (s.id === subId ? { ...s, done: !s.done } : s)) })));
  }
  function updateSubtask(taskId, subId, patch){
    setTasks(ts => ts.map(t => {
      if (t.id !== taskId) return t;
      return {
        ...t,
        subtasks: (t.subtasks || []).map(s => {
          if (s.id !== subId) return s;
          const merged = { ...s, ...patch };
          const clamped = clampSubtaskDates(t, merged.startDate, merged.endDate);
          return { ...merged, ...clamped };
        })
      };
    }));
  }
  function deleteSubtask(taskId, subId){
    setTasks(ts => ts.map(t => (t.id !== taskId ? t : { ...t, subtasks: (t.subtasks || []).filter(s => s.id !== subId) })));
  }

  /* ---------- Derived stats ---------- */
  const today = todayISO();
  const realMonday = getMonday(new Date());
  const realParity = getParity(realMonday);
  const todayIdx = (new Date().getDay() + 6) % 7;
  const meetingsToday = meetings.filter(m => m.weekday === todayIdx && (m.cadence === 'weekly' || m.parity === realParity)).length
    + plannedMeetings.filter(m => m.date === today).length;
  const tasksDueToday = tasks.filter(t => t.status !== 'done' && taskAppearsOn(t, today)).length;
  const atRiskCount = tasks.filter(t => t.status !== 'done' && (t.atRisk || (t.endDate && t.endDate < today && !(t.dueRevisions && t.dueRevisions.length)))).length;
  const doneCount = tasks.filter(t => t.status === 'done').length;

  const upcomingDeadlines = tasks
    .filter(t => t.status !== 'done' && t.endDate)
    .map(t => ({ t, diff: Math.round((new Date(t.endDate) - new Date(today)) / 86400000) }))
    .filter(x => x.diff <= 3)
    .sort((a, b) => a.diff - b.diff)
    .map(x => x.t);

  const weekStartIso = isoOf(realMonday);
  const realSunday = new Date(realMonday); realSunday.setDate(realSunday.getDate() + 6);
  const weekEndIso = isoOf(realSunday);

  const dailyProgress = computeProgress(tasks, t => taskAppearsOn(t, today));
  const weeklyProgress = computeProgress(tasks, t => taskMatchesRange(t, weekStartIso, weekEndIso));

  const todayHours = getWorkingHours(workingHours, defaultWorkingHours, today);
  const todayLapsed = computeTimeLapsed(todayHours, oooRanges[today], now);
  const timeElapsedPercent = todayLapsed.fullDayOff ? 100 : todayLapsed.percent;
  const weekLapsed = computeWeekLapsed(workingHours, defaultWorkingHours, oooRanges, realMonday, today);
  const weekElapsedPercent = weekLapsed.percent;

  const greeting = getTimeGreeting(now.getHours());
  const assistantMessage = getAssistantMessage({ meetingsToday, tasksDueToday, atRiskCount, dailyProgress, timeElapsedPercent });

  if (!supabaseClient) return <ConfigMissingNotice />;
  if (session === undefined) return <LoadingScreen message="Checking your session…" />;
  if (!session) return <AuthGate />;
  if (!loaded) return <LoadingScreen message="Loading your data…" />;

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="topbar__eyebrow">{greeting} &middot; Product Operations</p>
          <h1 className="topbar__title">Control Centre</h1>
        </div>
        <div className="topbar__right">
          <div>
            <div className="sync-label"><span className={`sync-indicator${saved ? ' saved' : ''}`} /> Saved</div>
            <div className="clock-date" style={{ marginTop: 4 }}>{session.user.email}</div>
          </div>
          <div>
            <div className="clock">{now.toLocaleTimeString('en-GB')}</div>
            <div className="clock-date">{WEEKDAY_LABELS[(now.getDay() + 6) % 7]}, {now.getDate()} {MONTHS[now.getMonth()]} {now.getFullYear()}</div>
          </div>
          <button className="btn btn--ghost" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <nav className="tab-nav">
        {TABS.map(tab => (
          <button key={tab.id} className={`tab-btn${activeTab === tab.id ? ' active' : ''}`} onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'overview' && (
        <React.Fragment>
          <AssistantBanner message={assistantMessage} />

          <section className="stats-strip">
            <StatChip label="Meetings today" value={meetingsToday} tone="amber" onClick={() => setActiveTab('calendar')} />
            <StatChip label="Tasks due today" value={tasksDueToday} tone="cyan" onClick={() => setActiveTab('tasks')} />
            <StatChip label="At risk" value={atRiskCount} tone="red" onClick={() => setActiveTab('tasks')} />
            <StatChip label="Tasks done" value={doneCount} tone="green" onClick={() => setActiveTab('tasks')} />
          </section>

          <ProgressPanel dailyProgress={dailyProgress} weeklyProgress={weeklyProgress} timeElapsedPercent={timeElapsedPercent} weekElapsedPercent={weekElapsedPercent} />

          <StickyNotesPanel notes={stickyNotes} onAdd={addStickyNote} onDelete={deleteStickyNote} />

          {upcomingDeadlines.length > 0 && (
            <section className="panel deadlines-panel">
              <div className="panel__head" style={{ marginBottom: 8 }}>
                <p className="panel__eyebrow">Upcoming Deadlines</p>
              </div>
              <div className="deadlines-strip">
                {upcomingDeadlines.map(t => (
                  <DeadlineChip key={t.id} task={t} category={categoryById(categories, t.theme)}
                    onClick={() => goToTask(t.id)}
                    onFocusClick={() => setFocusTaskId(t.id)} />
                ))}
              </div>
            </section>
          )}

          <div className="overview-cards">
            <TodayMeetingsCard
              meetings={meetings}
              plannedMeetings={plannedMeetings}
              pendingMeetings={pendingMeetings}
              todayIdx={todayIdx}
              realParity={realParity}
              onClickMeeting={() => setActiveTab('calendar')}
            />
            <TodayTasksCard
              tasks={tasks}
              categories={categories}
              onClickTask={goToTask}
            />
          </div>

          <section className="panel" style={{ textAlign: 'center' }}>
            <button className="btn" onClick={() => setDigestOpen(true)}>View this week's digest</button>
          </section>
        </React.Fragment>
      )}

      {activeTab === 'calendar' && (
        <React.Fragment>
          <TimeLapsedPanel
            workingHours={workingHours}
            defaultWorkingHours={defaultWorkingHours}
            oooRanges={oooRanges}
            now={now}
          />
          <PendingMeetingsPanel
            items={pendingMeetings}
            onAdd={addPendingMeeting}
            onUpdate={updatePendingMeeting}
            onDelete={deletePendingMeeting}
            onPromote={promotePendingMeeting}
          />
          <PlannedMeetingsPanel
            items={plannedMeetings.filter(m => m.kind !== 'focus')}
            onAdd={addPlannedMeeting}
            onOpen={setMeetingDetailId}
            onDelete={deletePlannedMeeting}
          />
          <ScheduleBoard
            meetings={meetings}
            pendingMeetings={pendingMeetings}
            plannedMeetings={plannedMeetings}
            weekOffset={weekOffset}
            setWeekOffset={setWeekOffset}
            onDeleteMeeting={deleteMeeting}
            onDeletePlanned={deletePlannedMeeting}
            onOpenMeeting={setMeetingDetailId}
            addOpen={addMeetingOpen}
            setAddOpen={setAddMeetingOpen}
            onAddMeeting={addMeeting}
            workingHours={workingHours}
            defaultWorkingHours={defaultWorkingHours}
            oooRanges={oooRanges}
            onSetWorkingHours={setWorkingHoursForDate}
            onToggleFullDayOOO={toggleFullDayOOO}
            onAddOOOBlock={addOOOBlock}
            onDeleteOOOBlock={deleteOOOBlock}
          />
          <CalendarPanel
            url={settings.calendarEmbedUrl}
            onSave={url => setSettings(s => ({ ...s, calendarEmbedUrl: url }))}
            onHide={() => setSettings(s => ({ ...s, calendarEmbedUrl: '' }))}
          />
        </React.Fragment>
      )}

      {activeTab === 'tasks' && (
        <React.Fragment>
          <QuickAddPanel
            categories={categories}
            tasks={tasks}
            onAddTask={addTask}
            onAddCategory={addCategory}
            onDeleteCategory={deleteCategory}
          />
          <TaskListView
            tasks={tasks}
            categories={categories}
            onUpdateTask={updateTask}
            onSetTaskStatus={setTaskStatus}
            onToggleRisk={toggleRisk}
            onOpenDetail={setDetailTaskId}
            onReviseDue={reviseDueDate}
          />
        </React.Fragment>
      )}

      {activeTab === 'quicklinks' && (
        <QuickLinksPanel
          links={quickLinks}
          linkTags={linkTags}
          onAdd={addQuickLink}
          onDelete={deleteQuickLink}
          onAddTag={addLinkTag}
          onDeleteTag={deleteLinkTag}
        />
      )}

      {detailTaskId && (
        <TaskDetailModal
          task={tasks.find(t => t.id === detailTaskId)}
          category={categoryById(categories, (tasks.find(t => t.id === detailTaskId) || {}).theme)}
          onClose={() => setDetailTaskId(null)}
          onUpdate={patch => updateTask(detailTaskId, patch)}
          onDelete={() => deleteTask(detailTaskId)}
          onReviseDue={date => reviseDueDate(detailTaskId, date)}
          onSetFocusTime={() => setFocusTaskId(detailTaskId)}
          onAddSubtask={(title, s, e) => addSubtask(detailTaskId, title, s, e)}
          onToggleSubtask={subId => toggleSubtask(detailTaskId, subId)}
          onUpdateSubtask={(subId, patch) => updateSubtask(detailTaskId, subId, patch)}
          onDeleteSubtask={subId => deleteSubtask(detailTaskId, subId)}
        />
      )}

      {focusTaskId && (
        <FocusTimeModal
          task={tasks.find(t => t.id === focusTaskId)}
          onClose={() => setFocusTaskId(null)}
          onSave={(date, time, duration) => {
            const t = tasks.find(x => x.id === focusTaskId);
            if (t) addFocusBlock(focusTaskId, t.title, date, time, duration);
            setFocusTaskId(null);
          }}
        />
      )}

      {meetingDetailId && (
        <MeetingDetailModal
          meeting={plannedMeetings.find(m => m.id === meetingDetailId)}
          tasks={tasks}
          categories={categories}
          onClose={() => setMeetingDetailId(null)}
          onUpdate={patch => updatePlannedMeeting(meetingDetailId, patch)}
          onDelete={() => deletePlannedMeeting(meetingDetailId)}
        />
      )}

      {dailyPlannerOpen && !legacyImport && (
        <DailyPlannerModal
          defaultWorkingHours={getWorkingHours(workingHours, defaultWorkingHours, today)}
          todayMeetings={[
            ...meetings.filter(m => m.weekday === todayIdx && (m.cadence === 'weekly' || m.parity === realParity)),
            ...plannedMeetings.filter(m => m.date === today)
          ]}
          todayTasks={tasks.filter(t => t.status !== 'done' && taskAppearsOn(t, today))}
          categories={categories}
          unfiledNotes={stickyNotes}
          onDeleteNote={deleteStickyNote}
          onAddTask={addTask}
          onAddMeeting={addPlannedMeeting}
          onClose={hours => closeDailyPlanner(hours)}
        />
      )}

      {digestOpen && (
        <WeeklyDigestModal
          weekLabel={`Week of ${realMonday.getDate()} ${MONTHS[realMonday.getMonth()]}`}
          categories={categories}
          tasks={tasks}
          onClose={closeDigest}
        />
      )}

      {eodModalOpen && (
        <EndOfDayModal notes={stickyNotes} onClose={closeEodModal} />
      )}

      {legacyImport && (
        <LegacyImportModal data={legacyImport} onImport={importLegacyData} onDiscard={discardLegacyData} />
      )}

      <p className="footnote">Synced to your account, private to {session.user.email} · a connected Google Calendar embed is only as private as your calendar's own sharing settings</p>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
