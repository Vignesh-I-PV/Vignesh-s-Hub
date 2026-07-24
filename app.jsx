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

const DEFAULT_MEETING_TYPES = [
  { id: 'pod',      label: 'POD Connect',     color: 'var(--cyan)',   dim: 'var(--cyan-dim)' },
  { id: 'mentor',   label: 'Mentor Sync',     color: 'var(--amber)',  dim: 'var(--amber-dim)' },
  { id: 'champion', label: 'Champion Review', color: 'var(--purple)', dim: 'var(--purple-dim)' },
  { id: 'sprint',   label: 'Sprint Call',     color: 'var(--green)',  dim: 'var(--green-dim)' }
];

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const TABS = [
  { id: 'overview',   label: 'Overview' },
  { id: 'calendar',   label: 'Calendar' },
  { id: 'tasks',      label: 'Task List' },
  { id: 'quicklinks', label: 'Doc Library' }
];

const TASK_FILTERS = [
  { id: 'today', label: 'Today' },
  { id: 'week',  label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'all',   label: 'All' }
];

/* ---------- Claude Assistant: tool schema ---------- */
// Scope, deliberately: task management + the day planner. No meetings/doc-library
// mutations from here. Reads execute immediately; writes always pause for a confirm
// card in the chat panel before anything touches real data.
const READ_ONLY_TOOLS = new Set(['get_app_context', 'preview_day_plan']);

const ASSISTANT_TOOLS = [
  {
    name: 'get_app_context',
    description: "Read the user's open (not-done) tasks, categories, and today's (or another date's) meetings/working hours/out-of-office. Call this first whenever you need real task IDs or category IDs to act on, or need to reason about someone's day.",
    input_schema: {
      type: 'object',
      properties: { dateISO: { type: 'string', description: "Date to pull calendar context for, YYYY-MM-DD. Defaults to today if omitted." } }
    }
  },
  {
    name: 'create_task',
    description: 'Create a new task.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        categoryId: { type: 'string', description: 'A category id from get_app_context.' },
        startDate: { type: 'string', description: 'YYYY-MM-DD, optional' },
        endDate: { type: 'string', description: 'YYYY-MM-DD, optional' },
        weight: { type: 'number', description: '1-10, optional, defaults to 1' },
        estimatedDuration: { type: 'number', description: 'Minutes, optional — needed for this task to be included in day planning.' }
      },
      required: ['title', 'categoryId']
    }
  },
  {
    name: 'update_task',
    description: 'Update fields on an existing task (title, status, dates, weight, estimated duration, notes, risk flag). Only pass fields you want changed.',
    input_schema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        title: { type: 'string' },
        status: { type: 'string', enum: ['todo', 'progress', 'done'] },
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        weight: { type: 'number' },
        estimatedDuration: { type: 'number' },
        notes: { type: 'string' },
        atRisk: { type: 'boolean' }
      },
      required: ['taskId']
    }
  },
  {
    name: 'delete_task',
    description: 'Permanently delete a task. Use sparingly and only when the user clearly wants it gone, not just marked done.',
    input_schema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] }
  },
  {
    name: 'add_subtask',
    description: "Add a sub-task to an existing task. The parent task's own start/end dates are automatically rolled up from its sub-tasks (earliest start, latest end) once any exist. Give it estimatedDurationMinutes if the user mentions how long it'll take — the day planner schedules sub-tasks individually and skips ones with no estimate.",
    input_schema: {
      type: 'object',
      properties: { taskId: { type: 'string' }, title: { type: 'string' }, startDate: { type: 'string' }, endDate: { type: 'string' }, estimatedDurationMinutes: { type: 'number' } },
      required: ['taskId', 'title']
    }
  },
  {
    name: 'toggle_subtask',
    description: "Flip a sub-task's done/not-done state.",
    input_schema: { type: 'object', properties: { taskId: { type: 'string' }, subtaskId: { type: 'string' } }, required: ['taskId', 'subtaskId'] }
  },
  {
    name: 'preview_day_plan',
    description: "Run the rule-based day-planner for a date (defaults to today) and return the proposed focus-time placements, anything that couldn't fit, and any tasks missing a time estimate. This is read-only — it also opens the same preview the user sees from the 'Plan my day' button, but changes nothing until apply_day_plan is called.",
    input_schema: { type: 'object', properties: { dateISO: { type: 'string' } } }
  },
  {
    name: 'apply_day_plan',
    description: "Write the most recently previewed day-plan's focus blocks onto the calendar for that date. Always call preview_day_plan first in the same conversation so there's something current to apply.",
    input_schema: { type: 'object', properties: { dateISO: { type: 'string' } } }
  }
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

// Strict due-today-or-overdue check, distinct from taskAppearsOn above. taskAppearsOn
// intentionally has no upper bound for pending tasks (so a task shows across its whole
// active span in week/month views); this one is for contexts that specifically mean
// "is this actually due by dateISO" — the Overview stat and the day planner's tiering —
// so a task whose due date got pushed to the future is correctly excluded from "today".
function isDueOrOverdue(task, dateISO){
  const e = task.endDate || task.startDate;
  if (!e) return false;
  return e <= dateISO;
}

// Sub-task-aware version of the above. A task's own start/end are rolled up to the
// earliest/latest across all its sub-tasks (see rollUpTaskDates), so checking only
// the parent's dates would hide a task that has one sub-task due today and another
// due next month (the roll-up's latest end date is next month). Instead, when a task
// has sub-tasks, it counts as due today/overdue if ANY not-done sub-task is.
function taskIsDueTodayOrOverdue(task, dateISO){
  const subtasks = task.subtasks || [];
  if (subtasks.length === 0) return isDueOrOverdue(task, dateISO);
  return subtasks.some(s => {
    if (s.done) return false;
    const e = s.endDate || s.startDate || task.endDate || task.startDate;
    if (!e) return false;
    return e <= dateISO;
  });
}

function matchesTaskFilter(task, filter, today, weekStart, weekEnd, monthStart, monthEnd){
  if (filter === 'all') return true;
  if (filter === 'today') return task.status === 'done' ? taskMatchesRange(task, today, today) : taskIsDueTodayOrOverdue(task, today);
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

/* ---------- Google Calendar sync (read-only, via Edge Function) ---------- */

// Bulleted or numbered lines in an event description become agenda-point
// suggestions automatically — e.g. "- Review budget" or "1. Confirm scope".
function detectAgendaFromDescription(desc){
  if (!desc) return [];
  const bulletRe = /^\s*(?:[-*\u2022]|\d+[.)])\s+(.+)/;
  const items = [];
  desc.split(/\r?\n/).forEach(line => {
    const m = line.match(bulletRe);
    if (m && m[1] && m[1].trim()) {
      items.push({ id: uid(), text: m[1].trim(), done: false });
    }
  });
  return items;
}

// Reshapes a raw event from the Edge Function into the same shape our own
// plannedMeetings use, so the rest of the app (schedule grid, Today card,
// prep-task reminders) can treat both uniformly with minimal special-casing.
function normalizeGoogleEvent(ev){
  const start = new Date(ev.start);
  const end = ev.end ? new Date(ev.end) : new Date(start.getTime() + 30 * 60000);
  const durationMin = Math.max(15, Math.round((end - start) / 60000));
  return {
    id: `google-${ev.id}`,
    title: ev.title,
    date: isoOf(start),
    time: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
    duration: durationMin,
    kind: 'google',
    description: ev.description || '',
    url: ev.url || '',
    agenda: detectAgendaFromDescription(ev.description || '')
  };
}

async function fetchGoogleCalendarEvents(accessToken){
  if (!supabaseClient || !window.SUPABASE_CONFIG) throw new Error('Supabase not configured');
  const res = await fetch(`${window.SUPABASE_CONFIG.url}/functions/v1/fetch-google-calendar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `Sync failed (HTTP ${res.status})`);
  return body;
}

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

const GENERAL_MEETING_TYPE = { id: 'other', label: 'General', color: 'var(--purple)', dim: 'var(--purple-dim)' };

// Looks up a meeting type by id from the user's managed list, falling back to the
// fixed 'General' pseudo-type for 'other', unset, or a type that's since been deleted
// (so old meetings referencing a since-removed type still render sensibly).
function meetingTypeById(meetingTypes, id){
  if (!id || id === 'other') return GENERAL_MEETING_TYPE;
  return (meetingTypes || []).find(t => t.id === id) || GENERAL_MEETING_TYPE;
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

// Day-planner tuning: how much buffer to leave before a meeting a prep task is tied
// to, and the smallest sliver of free time worth carving out of a gap.
const PREP_BUFFER_MINUTES = 15;
const MIN_CHUNK_MINUTES = 15;

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
// Once a task has sub-tasks, its own start/end are derived from them: earliest
// sub-task start becomes the task's start, latest sub-task end becomes the task's
// end. Returns null if no sub-task has any date set yet (nothing to roll up).
function rollUpTaskDates(subtasks){
  const starts = (subtasks || []).map(s => s.startDate).filter(Boolean);
  const ends = (subtasks || []).map(s => s.endDate).filter(Boolean);
  if (starts.length === 0 && ends.length === 0) return null;
  return {
    startDate: starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : '',
    endDate: ends.length ? ends.reduce((a, b) => (a > b ? a : b)) : ''
  };
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

function getMeetingDateTime(meeting){
  if (!meeting || !meeting.date) return null;
  const [h, m] = (meeting.time || '00:00').split(':').map(Number);
  const d = new Date(meeting.date + 'T00:00:00');
  d.setHours(h, m, 0, 0);
  return d;
}

// A prep task's reminder should surface at whichever comes first: the start of the
// meeting's working day, or 2 hours before the meeting itself — so an early meeting
// still gives at least 2 hours' notice even if that falls before the day "starts".
function getPrepReminderStatus(meeting, workingHours){
  const meetingDT = getMeetingDateTime(meeting);
  if (!meetingDT) return null;
  const now = new Date();
  if (now >= meetingDT) return null;

  const twoHoursPrior = new Date(meetingDT.getTime() - 2 * 60 * 60 * 1000);
  const dayStart = new Date(meetingDT);
  const [sh, sm] = (workingHours.start || '09:00').split(':').map(Number);
  dayStart.setHours(sh, sm, 0, 0);

  const reminderTime = new Date(Math.min(dayStart.getTime(), twoHoursPrior.getTime()));
  return { active: now >= reminderTime, meetingDT, reminderTime };
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

/* ---------- Day Planner engine ---------- */
// Deterministic, rule-based — no AI in this loop. Given a date and the app's state,
// works out where today's not-yet-done tasks should go, respecting meetings as fixed
// and giving meeting-prep tasks a hard "finish before the meeting" constraint instead
// of just sorting everything by due date.

function minutesToTime(mins){
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60) % 24;
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// Every calendar block already occupying time on a given day — recurring meetings,
// one-off planned meetings (incl. previously-placed Focus Time), and synced Google
// events — normalized to {id, title, date, time, duration}. Recurring meetings can't
// currently have prep tasks linked to them (same as the existing prep-reminder logic),
// so they're busy blocks but not lookup targets for a task's meetingId.
function getMeetingsOnDate(dateISO, { meetings, plannedMeetings, googleEvents }){
  const d = new Date(dateISO);
  const weekdayIdx = (d.getDay() + 6) % 7;
  const monday = getMonday(d);
  const parity = getParity(monday);
  const recurring = meetings
    .filter(m => m.weekday === weekdayIdx && (m.cadence === 'weekly' || m.parity === parity))
    .map(m => ({ id: m.id, title: m.name, date: dateISO, time: m.time, duration: m.duration || 30, kind: 'recurring' }));
  const planned = plannedMeetings.filter(m => m.date === dateISO);
  const google = googleEvents.map(normalizeGoogleEvent).filter(m => m.date === dateISO);
  return [...recurring, ...planned, ...google];
}

// Free minutes-since-midnight intervals left in the working day after subtracting
// OOO and everything already on the calendar. Sorted, merged, no overlaps.
function getFreeIntervals(dateISO, ctx){
  const hours = getWorkingHours(ctx.workingHours, ctx.defaultWorkingHours, dateISO);
  const dayOoo = ctx.oooRanges[dateISO];
  if (dayOoo && dayOoo.fullDay) return [];

  const windowStart = minutesSinceMidnight(hours.start);
  const windowEnd = minutesSinceMidnight(hours.end);
  if (windowEnd <= windowStart) return [];

  const busy = [];
  ((dayOoo && dayOoo.blocks) || []).forEach(b => busy.push([minutesSinceMidnight(b.start), minutesSinceMidnight(b.end)]));
  getMeetingsOnDate(dateISO, ctx).forEach(m => {
    const s = minutesSinceMidnight(m.time || '00:00');
    busy.push([s, s + (m.duration || 30)]);
  });

  busy.sort((a, b) => a[0] - b[0]);
  const merged = [];
  busy.forEach(([bs, be]) => {
    const s = Math.max(bs, windowStart), e = Math.min(be, windowEnd);
    if (e <= s) return;
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  });

  const free = [];
  let cursor = windowStart;
  merged.forEach(([s, e]) => {
    if (s > cursor) free.push([cursor, s]);
    cursor = Math.max(cursor, e);
  });
  if (cursor < windowEnd) free.push([cursor, windowEnd]);
  return free;
}

// The plan itself: which not-done, appears-today tasks get which slot. Meeting-prep
// tasks (tied to a meeting happening today) are placed first, ordered by how soon
// their meeting starts; everything else follows, ordered overdue-first then by
// nearest end date then by weight. Tasks can split across multiple free gaps.
// The plan itself: which not-done, appears-today tasks get which slot, in three
// priority tiers — (1) meeting-prep tasks, hard-constrained to finish before their
// meeting; (2) today's regular tasks, not yet past their deadline; (3) backlog —
// tasks whose deadline has already been breached, simple oldest-first, only using
// whatever capacity is left over once the first two tiers are placed.
function computeDayPlan(dateISO, ctx){
  const { tasks } = ctx;
  const dayOoo = ctx.oooRanges[dateISO];
  if (dayOoo && dayOoo.fullDay) {
    return { placements: [], unfit: [], missingDuration: [], fullDayOff: true };
  }

  const meetingsOnDate = getMeetingsOnDate(dateISO, ctx);
  const meetingById = new Map(meetingsOnDate.filter(m => m.kind !== 'recurring').map(m => [m.id, m]));

  // Builds the flat list of schedulable units for dateISO. A task with sub-tasks
  // schedules each not-done sub-task individually (its own dates/duration); a task
  // with no sub-tasks schedules as a single unit, same as before.
  const schedulable = [];
  const missingDuration = [];
  tasks.forEach(t => {
    if (t.status === 'done') return;
    const subtasks = t.subtasks || [];
    if (subtasks.length > 0) {
      subtasks.forEach(s => {
        if (s.done) return;
        const startDate = s.startDate || t.startDate || '';
        const endDate = s.endDate || t.endDate || '';
        if (!taskMatchesRange({ startDate, endDate, status: 'todo' }, dateISO, dateISO)) return;
        if (!s.estimatedDuration) {
          missingDuration.push({ id: t.id, title: `${t.title} — ${s.title}` });
          return;
        }
        schedulable.push({
          taskId: t.id, subtaskId: s.id, title: s.title, displayTitle: `${t.title} — ${s.title}`,
          theme: t.theme, meetingId: t.meetingId, weight: t.weight,
          startDate, endDate, estimatedDuration: s.estimatedDuration
        });
      });
    } else {
      if (!taskAppearsOn(t, dateISO)) return;
      if (!t.estimatedDuration) {
        missingDuration.push({ id: t.id, title: t.title });
        return;
      }
      schedulable.push({
        taskId: t.id, subtaskId: null, title: t.title, displayTitle: t.title,
        theme: t.theme, meetingId: t.meetingId, weight: t.weight,
        startDate: t.startDate, endDate: t.endDate, estimatedDuration: t.estimatedDuration
      });
    }
  });

  const prepTier = [];
  const todayTier = [];
  const backlogTier = [];
  const futureTier = [];
  schedulable.forEach(u => {
    const meeting = u.meetingId ? meetingById.get(u.meetingId) : null;
    if (meeting) {
      prepTier.push({ unit: u, tier: 'prep', deadline: minutesSinceMidnight(meeting.time || '00:00') - PREP_BUFFER_MINUTES, meetingTitle: meeting.title });
    } else if (u.endDate && u.endDate < dateISO) {
      backlogTier.push({ unit: u, tier: 'backlog' });
    } else if (u.endDate && u.endDate > dateISO) {
      futureTier.push({ unit: u, tier: 'future' });
    } else {
      todayTier.push({ unit: u, tier: 'today' });
    }
  });
  prepTier.sort((a, b) => a.deadline - b.deadline);
  const byNearestEndThenWeight = (a, b) => {
    const aEnd = a.unit.endDate || '9999-99-99';
    const bEnd = b.unit.endDate || '9999-99-99';
    if (aEnd !== bEnd) return aEnd < bEnd ? -1 : 1;
    return (b.unit.weight || 1) - (a.unit.weight || 1);
  };
  todayTier.sort(byNearestEndThenWeight);
  futureTier.sort(byNearestEndThenWeight);
  // Backlog: simple oldest-first by how long-breached the deadline is — no weight
  // tie-break, on purpose, per the "keep it simple" call.
  backlogTier.sort((a, b) => (a.unit.endDate < b.unit.endDate ? -1 : a.unit.endDate > b.unit.endDate ? 1 : 0));

  // Order: meeting-prep (hard constraint) first, then what's actually due today,
  // then backlog (already overdue) — ahead of tasks that aren't due yet — and only
  // then future-dated tasks get whatever time is left over.
  const ordered = [...prepTier, ...todayTier, ...backlogTier, ...futureTier];

  const free = getFreeIntervals(dateISO, ctx);
  const placements = [];
  const unfit = [];

  ordered.forEach(entry => {
    const { unit, deadline, meetingTitle, tier } = entry;
    let remaining = unit.estimatedDuration;

    for (let i = 0; i < free.length && remaining > 0; i++){
      const original = free[i];
      const s = original[0];
      const e = deadline !== undefined ? Math.min(original[1], deadline) : original[1];
      const available = e - s;
      if (available < MIN_CHUNK_MINUTES) continue;
      const take = Math.min(available, remaining);
      if (take < MIN_CHUNK_MINUTES && remaining > MIN_CHUNK_MINUTES) continue;

      placements.push({
        taskId: unit.taskId, subtaskId: unit.subtaskId, taskTitle: unit.displayTitle, theme: unit.theme,
        date: dateISO, time: minutesToTime(s), duration: take,
        meetingId: unit.meetingId || null, meetingTitle: meetingTitle || null,
        tier
      });
      remaining -= take;

      const newStart = s + take;
      if (newStart >= original[1]) { free.splice(i, 1); i--; }
      else free[i] = [newStart, original[1]];
    }

    if (remaining > 0) {
      unfit.push({
        taskId: unit.taskId, subtaskId: unit.subtaskId, taskTitle: unit.displayTitle, remaining, tier,
        reason: deadline !== undefined ? `Not enough free time before "${meetingTitle}"` : (tier === 'backlog' ? 'No leftover time today' : tier === 'future' ? 'No leftover time today (not due yet)' : 'Not enough free time today')
      });
    }
  });

  const backlogCount = backlogTier.length;
  return { placements, unfit, missingDuration, fullDayOff: false, backlogCount };
}

// A lightweight fingerprint of everything computeDayPlan's output actually depends
// on for a given date. Used to detect when something the user did — added/edited/
// deleted a task, added or moved a meeting — would change today's plan, so we know
// when to offer an updated one. Deliberately excludes this planner's own past output
// (auto-plan focus blocks) so applying a plan never immediately looks like "a change".
function getDayPlanSignatureInputs(dateISO, ctx){
  const relevantTasks = ctx.tasks
    .filter(t => t.status !== 'done' && taskAppearsOn(t, dateISO))
    .map(t => {
      const subSig = (t.subtasks || [])
        .map(s => `${s.id}:${s.done ? 1 : 0}:${s.estimatedDuration || 0}:${s.startDate || ''}:${s.endDate || ''}`)
        .sort().join(',');
      return `${t.id}:${t.estimatedDuration || 0}:${t.startDate || ''}:${t.endDate || ''}:${t.meetingId || ''}:${t.weight || 1}:[${subSig}]`;
    })
    .sort();
  const meetingsToday = getMeetingsOnDate(dateISO, ctx)
    .filter(m => !(m.kind === 'focus' && m.source === 'auto-plan'))
    .map(m => `${m.id}:${m.time}:${m.duration}`)
    .sort();
  const hours = getWorkingHours(ctx.workingHours, ctx.defaultWorkingHours, dateISO);
  return JSON.stringify({ relevantTasks, meetingsToday, hours, ooo: ctx.oooRanges[dateISO] || null });
}

// Fingerprints a computed plan's actual output (placements + what didn't fit), so the
// change-detection watcher can tell a real change in the plan apart from an input change
// that happens to recompute to the same result — and skip the popup in the latter case.
function fingerprintDayPlan(preview){
  if (!preview) return '';
  const placements = (preview.placements || []).map(p => `${p.taskId}:${p.subtaskId || ''}:${p.time}:${p.duration}`).sort().join('|');
  const unfit = (preview.unfit || []).map(u => `${u.taskId}:${u.subtaskId || ''}:${u.remaining}`).sort().join('|');
  const missing = (preview.missingDuration || []).map(t => t.id).sort().join('|');
  return `${placements}::${unfit}::${missing}`;
}


/* ---------- A little personality ---------- */
/* ---------- Browser notifications ---------- */
async function notify(title, body){
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    if (navigator.serviceWorker) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        reg.showNotification(title, { body, icon: undefined, tag: title });
        return;
      }
    }
  } catch (e) {
    console.error('Service worker notification failed, falling back', e);
  }
  try {
    new Notification(title, { body });
  } catch (e) {
    console.error('Notification failed', e);
  }
}

function getFirstNameFromEmail(email){
  if (!email) return 'Your';
  const local = (email.split('@')[0] || '').trim();
  const first = (local.split('.')[0] || local).trim();
  if (!first) return 'Your';
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

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

function StickyNotesPanel({ notes, onAdd, onDelete, onFile }){
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
            <div key={n.id} className="sticky-note tone-warm">
              <p className="sticky-note__text">{n.text}</p>
              <div className="sticky-note__actions">
                <button title="File this into a task or meeting" onClick={() => onFile(n.id)}>File</button>
                <button className="sticky-note__del" title="Discard" onClick={() => onDelete(n.id)}>&times;</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// A separate, calmer scratchpad for things that just want to be kept, not filed
// anywhere — no "File this" action, no end-of-day nagging, just persistent notes.
function IdeaBoardPanel({ notes, onAdd, onDelete }){
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
          <p className="panel__eyebrow">Ideas</p>
          <h2 className="panel__title">Just for keeping — nothing to file here</h2>
        </div>
      </div>
      <div className="quick-add-row">
        <input type="text" placeholder="A thought worth keeping around…" value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }} style={{ flex: '3 1 260px' }} />
        <button className="btn btn--amber" onClick={submit}>Add idea</button>
      </div>
      {notes.length > 0 && (
        <div className="sticky-note-list">
          {notes.map(n => (
            <div key={n.id} className="sticky-note tone-cool">
              <p className="sticky-note__text">{n.text}</p>
              <div className="sticky-note__actions" style={{ justifyContent: 'flex-end' }}>
                <button className="sticky-note__del" title="Discard" onClick={() => onDelete(n.id)}>&times;</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function EndOfDayModal({ notes, onClose, onFile }){
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
            Move these into a task, a meeting's agenda, or wherever they belong — otherwise they'll remind you again first thing tomorrow.
          </p>
          <div className="filing-list">
            {notes.map(n => (
              <div key={n.id} className="filing-row">
                <span>{n.text}</span>
                <button className="btn" style={{ fontSize: 10, padding: '4px 8px' }} onClick={() => onFile(n.id)}>File this</button>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn--amber" onClick={onClose} style={{ marginLeft: 'auto' }}>Got it</button>
        </div>
      </div>
    </div>
  );
}

// Chooser shown when a quick note is being filed: standalone task, a task under a
// specific meeting (prep task), or an agenda item on a specific meeting.
function FileNoteModal({ note, meetings, categories, onClose, onFileAgenda, onFilePrepTask, onFileTask }){
  const [dest, setDest] = useState('task');
  const [meetingId, setMeetingId] = useState(meetings[0] ? meetings[0].id : '');
  const [categoryId, setCategoryId] = useState(categories[0] ? categories[0].id : '');

  useEffect(() => {
    function onKey(e){ if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!note) return null;

  function submit(){
    if (dest === 'task') {
      if (!categoryId) return;
      onFileTask(categoryId);
    } else if (dest === 'agenda') {
      if (!meetingId) return;
      onFileAgenda(meetingId);
    } else if (dest === 'prep') {
      if (!meetingId || !categoryId) return;
      onFilePrepTask(meetingId, categoryId);
    }
  }

  const needsMeeting = dest === 'agenda' || dest === 'prep';
  const needsCategory = dest === 'task' || dest === 'prep';
  const canSubmit = (!needsMeeting || !!meetingId) && (!needsCategory || !!categoryId);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <div className="modal-panel__head">
          <div style={{ flex: 1 }}>
            <p className="panel__eyebrow">File this note</p>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, marginTop: 2 }}>{note.text}</div>
          </div>
          <button className="icon-btn" title="Close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-field">
          <label>File as</label>
          <div className="segmented">
            <button className={`segmented__opt${dest === 'task' ? ' is-active' : ''}`} onClick={() => setDest('task')}>Standalone task</button>
            <button className={`segmented__opt${dest === 'prep' ? ' is-active' : ''}`} onClick={() => setDest('prep')}>Task under a meeting</button>
            <button className={`segmented__opt${dest === 'agenda' ? ' is-active' : ''}`} onClick={() => setDest('agenda')}>Agenda item on a meeting</button>
          </div>
        </div>
        {needsMeeting && (
          <div className="modal-field">
            <label>Meeting</label>
            {meetings.length === 0 ? (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-lo)' }}>No scheduled meetings to attach this to yet.</p>
            ) : (
              <select value={meetingId} onChange={e => setMeetingId(e.target.value)}>
                {meetings.map(m => <option key={m.id} value={m.id}>{m.date} &middot; {m.title}</option>)}
              </select>
            )}
          </div>
        )}
        {needsCategory && (
          <div className="modal-field">
            <label>Category</label>
            <select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
              {categories.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
        )}
        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--amber" onClick={submit} disabled={!canSubmit}>File it</button>
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

function FocusTimeModal({ task, initial, onClose, onSave, onDelete }){
  const isEdit = !!initial;
  const [date, setDate] = useState(initial ? initial.date : todayISO());
  const [time, setTime] = useState(initial ? (initial.time || '10:00') : '10:00');
  const [duration, setDuration] = useState(initial ? (initial.duration || 30) : 30);

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
          {isEdit && onDelete && (
            <button className="btn btn--ghost" style={{ color: 'var(--red)', marginRight: 'auto' }} onClick={onDelete}>Remove</button>
          )}
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--amber" onClick={() => onSave(date, time, duration)}>{isEdit ? 'Save changes' : 'Add to calendar'}</button>
        </div>
      </div>
    </div>
  );
}

function TodayMeetingsCard({ meetings, plannedMeetings, googleEvents, pendingMeetings, todayIdx, realParity, onClickMeeting, meetingTypes }){
  const today = todayISO();
  const todayRecurring = meetings
    .filter(m => m.weekday === todayIdx && (m.cadence === 'weekly' || m.parity === realParity))
    .sort((a, b) => a.time.localeCompare(b.time));
  const todayPlanned = plannedMeetings.filter(m => m.date === today && m.kind !== 'focus').sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const todayGoogle = (googleEvents || []).filter(m => m.date === today).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const todayReminders = pendingMeetings.filter(m => needsReminder(m, today));
  const nothing = todayRecurring.length === 0 && todayPlanned.length === 0 && todayGoogle.length === 0 && todayReminders.length === 0;

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
            const mt = meetingTypeById(meetingTypes, m.type);
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
            const status = getMeetingStatus(today, m.time || '00:00', m.duration);
            return (
              <div key={m.id} className={`today-item${status.status === 'done' ? ' is-complete' : ''}`} style={{ '--type-color': 'var(--purple)' }} onClick={onClickMeeting}>
                <span className="today-item__time">{m.time || '—'}</span>
                <span className="today-item__title">{m.title}</span>
                {meetingStatusPill(status) || <span className="pill" style={{ '--pill-color': 'var(--purple)', '--pill-bg': 'var(--purple-dim)' }}>Meeting</span>}
              </div>
            );
          })}
          {todayGoogle.map(m => {
            const status = getMeetingStatus(today, m.time, m.duration);
            return (
              <div key={m.id} className={`today-item${status.status === 'done' ? ' is-complete' : ''}`} style={{ '--type-color': 'var(--cyan)' }} onClick={onClickMeeting}>
                <span className="today-item__time">{m.time}</span>
                <span className="today-item__title">{m.title}</span>
                {meetingStatusPill(status) || <span className="pill" style={{ '--pill-color': 'var(--cyan)', '--pill-bg': 'var(--cyan-dim)' }}>&#128197; Google</span>}
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
  const todayTasks = tasks.filter(t => t.status !== 'done' && taskIsDueTodayOrOverdue(t, today));

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

// Focus Time blocks are task-work, not meetings — they get their own Today card
// (paired with Tasks) instead of being mixed into the Meetings list.
function TodayFocusCard({ plannedMeetings, onClickFocus }){
  const today = todayISO();
  const todayFocus = (plannedMeetings || [])
    .filter(m => m.kind === 'focus' && m.date === today)
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  return (
    <section className="panel">
      <div className="panel__head" style={{ marginBottom: 10 }}>
        <div>
          <p className="panel__eyebrow">Today</p>
          <h2 className="panel__title">Focus Time</h2>
        </div>
      </div>
      {todayFocus.length === 0 ? (
        <p style={{ color: 'var(--text-lo)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>No focus blocks today.</p>
      ) : (
        <div className="today-list">
          {todayFocus.map(m => {
            const status = getMeetingStatus(today, m.time || '00:00', m.duration);
            return (
              <div key={m.id} className={`today-item${status.status === 'done' ? ' is-complete' : ''}`} onClick={() => onClickFocus(m.id)}>
                <span className="today-item__time">{m.time || '—'}</span>
                <span className="today-item__title">{m.title}</span>
                {meetingStatusPill(status) || <span className="pill" style={{ '--pill-color': 'var(--green)', '--pill-bg': 'var(--green-dim)' }}>{formatDuration(m.duration || 30)}</span>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function AddMeetingForm({ open, onCancel, onSubmit, meetingTypes }){
  const [name, setName] = useState('');
  const [type, setType] = useState(meetingTypes[0] ? meetingTypes[0].id : 'other');
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
          <option value="other">General</option>
          {meetingTypes.map(mt => <option key={mt.id} value={mt.id}>{mt.label}</option>)}
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

function ScheduleBoard({ meetings, pendingMeetings, plannedMeetings, googleEvents, tasks, meetingTypes, weekOffset, setWeekOffset, onDeleteMeeting, onDeletePlanned, onOpenMeeting, addOpen, setAddOpen, onAddMeeting, workingHours, defaultWorkingHours, oooRanges, onSetWorkingHours, onToggleFullDayOOO, onAddOOOBlock, onDeleteOOOBlock, onAddMeetingType, onDeleteMeetingType }){
  const monday = getMonday(new Date(Date.now() + weekOffset * 7 * 86400000));
  const parity = getParity(monday);
  const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
  const todayStr = new Date().toDateString();
  const [expandedDay, setExpandedDay] = useState(null);
  const [manageTypesOpen, setManageTypesOpen] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');

  function meetingsForDay(dayIndex){
    return meetings
      .filter(m => m.weekday === dayIndex && (m.cadence === 'weekly' || m.parity === parity))
      .sort((a, b) => a.time.localeCompare(b.time));
  }

  // Whether a meeting (by id) has any not-done prep task tied to it — surfaced as a
  // small flag on its calendar block so a pending prep task isn't only visible from
  // the Overview's 3-day-lookahead "Meeting Prep" strip.
  function hasPendingPrep(meetingId){
    return (tasks || []).some(t => t.meetingId === meetingId && t.status !== 'done');
  }

  function submitNewType(){
    if (!newTypeName.trim()) return;
    onAddMeetingType(newTypeName.trim());
    setNewTypeName('');
  }

  const typeUsageCount = id =>
    meetings.filter(m => m.type === id).length + plannedMeetings.filter(m => m.type === id).length;

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
          <button className="btn" onClick={() => setManageTypesOpen(o => !o)}>Manage meeting types</button>
          <button className="btn btn--amber" onClick={() => setAddOpen(o => !o)}>+ Schedule sync</button>
        </div>
      </div>

      <div className={`add-form${manageTypesOpen ? ' open' : ''}`} style={{ gridTemplateColumns: '1fr auto' }}>
        <div className="full" style={{ display: 'block', marginBottom: 4 }}>
          <label>New meeting type</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="text" placeholder="e.g. Client Check-in" value={newTypeName}
              onChange={e => setNewTypeName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitNewType(); }} />
            <button className="btn btn--amber" onClick={submitNewType}>Create</button>
          </div>
        </div>
        <div className="full" style={{ display: 'block' }}>
          <div className="category-manage-list">
            {meetingTypes.map(mt => {
              const count = typeUsageCount(mt.id);
              return (
                <div key={mt.id} className="category-chip" style={{ '--cchip-color': mt.color }}>
                  <span className="category-chip__title">{mt.label}</span>
                  <span className="category-chip__count">{count}</span>
                  <button
                    className="icon-btn"
                    title={count > 0 ? 'Still used by a meeting — reassign it first' : 'Delete type'}
                    disabled={count > 0}
                    onClick={() => onDeleteMeetingType(mt.id)}
                  >&times;</button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <AddMeetingForm open={addOpen} onCancel={() => setAddOpen(false)} onSubmit={m => { onAddMeeting(m); setAddOpen(false); }} meetingTypes={meetingTypes} />

      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', margin: '10px 0 0' }}>Click a day's date to view or edit its working hours &amp; Out of Office blocks.</p>

      <div className="schedule-grid" style={{ marginTop: 10 }}>
        {Array.from({ length: 7 }).map((_, i) => {
          const d = new Date(monday); d.setDate(d.getDate() + i);
          const isToday = d.toDateString() === todayStr;
          const iso = isoOf(d);
          const dayMeetings = meetingsForDay(i);
          const dayPlanned = plannedMeetings.filter(m => m.date === iso).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
          const dayGoogle = (googleEvents || []).filter(m => m.date === iso).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
          const dayPlaceholders = pendingMeetings.filter(m => m.targetDate === iso);
          const hasAnything = dayMeetings.length > 0 || dayPlanned.length > 0 || dayGoogle.length > 0 || dayPlaceholders.length > 0;
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
                      const t = meetingTypeById(meetingTypes, m.type);
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
                      const t = isFocus ? null : meetingTypeById(meetingTypes, m.type);
                      const color = isFocus ? 'var(--green)' : t.color;
                      const dim = isFocus ? 'var(--green-dim)' : t.dim;
                      const pending = !isFocus && hasPendingPrep(m.id);
                      const status = getMeetingStatus(iso, m.time || '00:00', m.duration);
                      return (
                        <div key={m.id} className={`meeting-block${status.status === 'done' ? ' is-complete' : ''}`} style={{ '--type-color': color, cursor: 'pointer' }}
                          onClick={() => onOpenMeeting(m.id)}>
                          <button className="meeting-block__del" title="Remove" onClick={e => { e.stopPropagation(); onDeletePlanned(m.id); }}>&times;</button>
                          {pending && <span className="meeting-block__flag" title="Has a pending prep task">&#9873;</span>}
                          <div className="meeting-block__time">{m.time || '—'} &middot; {formatDuration(m.duration || 30)}</div>
                          <div className="meeting-block__name">{m.title}</div>
                          <div className="meeting-block__foot">
                            {meetingStatusPill(status) || <span className="pill" style={{ '--pill-color': color, '--pill-bg': dim }}>{isFocus ? 'Focus time' : t.label}</span>}
                            {!isFocus && (m.agenda || []).length > 0 && (
                              <span className="pill" style={{ '--pill-color': 'var(--text-lo)', '--pill-bg': 'var(--ink-700)' }}>{m.agenda.length} agenda</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {dayGoogle.map(m => {
                      const pending = hasPendingPrep(m.id);
                      const status = getMeetingStatus(iso, m.time, m.duration);
                      return (
                        <div key={m.id} className={`meeting-block${status.status === 'done' ? ' is-complete' : ''}`} style={{ '--type-color': 'var(--cyan)', cursor: 'pointer' }}
                          onClick={() => onOpenMeeting(m.id)}>
                          {pending && <span className="meeting-block__flag" title="Has a pending prep task">&#9873;</span>}
                          <div className="meeting-block__time">{m.time} &middot; {formatDuration(m.duration || 30)}</div>
                          <div className="meeting-block__name">{m.title}</div>
                          <div className="meeting-block__foot">
                            {meetingStatusPill(status) || <span className="pill" style={{ '--pill-color': 'var(--cyan)', '--pill-bg': 'var(--cyan-dim)' }}>&#128197; Google</span>}
                            {m.agenda.length > 0 && (
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

function GoogleCalendarSyncPanel({ url, syncStatus, syncError, eventCount, onSave, onUnlink, onSyncNow }){
  const [open, setOpen] = useState(!url);
  const [draft, setDraft] = useState(url || '');

  function save(){
    if (!draft.trim()) return;
    onSave(draft.trim());
    setOpen(false);
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <div>
          <p className="panel__eyebrow">Google Calendar</p>
          <h2 className="panel__title">{url ? 'Synced — read-only' : 'Not linked yet'}</h2>
        </div>
        <div className="week-nav">
          {url && (
            <React.Fragment>
              <span className="pill" style={{
                '--pill-color': syncStatus === 'error' ? 'var(--red)' : 'var(--green)',
                '--pill-bg': syncStatus === 'error' ? 'var(--red-dim)' : 'var(--green-dim)'
              }}>
                {syncStatus === 'syncing' ? 'Syncing…' : syncStatus === 'error' ? 'Sync error' : `${eventCount} events`}
              </span>
              <button className="btn" onClick={onSyncNow}>Sync now</button>
              <button className="btn btn--ghost" onClick={onUnlink}>Unlink</button>
            </React.Fragment>
          )}
          {!url && <button className="btn btn--amber" onClick={() => setOpen(o => !o)}>Link Google Calendar</button>}
        </div>
      </div>

      {syncError && <p style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: 11, marginTop: 4 }}>{syncError}</p>}

      <div className={`add-form${open ? ' open' : ''}`}>
        <div className="full" style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-lo)', lineHeight: 1.7, marginBottom: 8 }}>
          <b style={{ color: 'var(--text-hi)' }}>How to find your calendar's secret address:</b><br />
          1. Open Google Calendar on the web.<br />
          2. Hover your calendar under "My calendars" &rarr; click the &#8942; menu &rarr; <b>Settings and sharing</b>.<br />
          3. Scroll to <b>Integrate calendar</b>.<br />
          4. Copy the <b>Secret address in iCal format</b> (not the public URL).<br />
          Treat this link like a password — anyone who has it can read your events. It's stored securely and never shown in this app after saving.
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label>Secret iCal address</label>
          <input type="url" value={draft} onChange={e => setDraft(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/.../private-.../basic.ics" />
        </div>
        <div className="full">
          <button className="btn btn--ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn btn--amber" onClick={save}>Save &amp; sync</button>
        </div>
      </div>

      {url && (
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', marginTop: 10 }}>
          Events sync into your schedule below automatically (checked every minute while this tab is open). Changes you make here to notes, links, or tasks stay local to this app and never write back to Google.
        </p>
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

function PlannedMeetingRow({ meeting, onOpen, onDelete, meetingTypes }){
  const agendaCount = (meeting.agenda || []).length;
  const doneCount = (meeting.agenda || []).filter(a => a.done).length;
  const typeMeta = meetingTypeById(meetingTypes, meeting.type);
  const color = typeMeta.color;
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

function PlannedMeetingsPanel({ items, onAdd, onOpen, onDelete, meetingTypes }){
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

  const upcoming = items.filter(m => getMeetingStatus(m.date, m.time || '00:00', m.duration).status !== 'done');
  const sorted = [...upcoming].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));

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
            {meetingTypes.map(mt => <option key={mt.id} value={mt.id}>{mt.label}</option>)}
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
        <p className="task-empty">
          {items.length === 0
            ? 'No meetings scheduled yet — add one above, or promote something from "To Be Set Up".'
            : 'Nothing upcoming — completed meetings are hidden here.'}
        </p>
      ) : (
        <div className="planned-meetings">
          {sorted.map(m => (
            <PlannedMeetingRow key={m.id} meeting={m}
              onOpen={() => onOpen(m.id)}
              onDelete={() => onDelete(m.id)}
              meetingTypes={meetingTypes} />
          ))}
        </div>
      )}
    </section>
  );
}


function PrepTaskList({ meeting, prepTasks, categories, onAdd, onToggle, onDelete, onOpenTask }){
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState(categories[0] ? categories[0].id : '');
  const [duration, setDuration] = useState(30);
  const [deadline, setDeadline] = useState(meeting.date || '');

  function submit(){
    if (!title.trim() || !categoryId) return;
    onAdd(categoryId, title.trim(), duration, deadline);
    setTitle(''); setDuration(30); setDeadline(meeting.date || '');
  }

  return (
    <div>
      {prepTasks.length > 0 && (
        <div className="subtask-list">
          {prepTasks.map(t => (
            <div key={t.id} className={`subtask-item${t.status === 'done' ? ' done' : ''}`}>
              <input type="checkbox" checked={t.status === 'done'} onChange={() => onToggle(t.id)} />
              <span className="subtask-item__title" style={{ cursor: 'pointer' }} onClick={() => onOpenTask(t.id)}>{t.title}</span>
              {t.endDate ? <span style={{ color: 'var(--text-faint)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>due {t.endDate}</span> : null}
              {t.estimatedDuration ? <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>{formatDuration(t.estimatedDuration)}</span> : null}
              <button className="icon-btn" title="Remove" onClick={() => onDelete(t.id)}>&times;</button>
            </div>
          ))}
        </div>
      )}
      <div className="quick-add-row">
        <input type="text" placeholder="Something to finish before this meeting…" value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
        <select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
          {categories.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <input type="date" value={deadline} max={meeting.date || undefined}
          title="Deadline (can't be after the meeting itself)"
          onChange={e => setDeadline(e.target.value)} />
        <DurationSelect value={duration} onChange={setDuration} />
        <button className="btn btn--amber" onClick={submit}>Add</button>
      </div>
    </div>
  );
}

function MeetingDetailModal({ meeting, tasks, categories, meetingTypes, onClose, onUpdate, onDelete, onAddPrepTask, onTogglePrepTask, onDeletePrepTask, onOpenTask }){
  useEffect(() => {
    function onKey(e){ if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!meeting) return null;
  const isGoogle = meeting.kind === 'google';

  const today = todayISO();
  const isReviewType = meeting.type === 'mentor' || meeting.type === 'champion';

  let suggestions = [];
  if (isReviewType && !isGoogle){
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
            <p className="panel__eyebrow">{isGoogle ? 'Synced from Google Calendar' : meetingTypeById(meetingTypes, meeting.type).label}</p>
            {isGoogle ? (
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, marginTop: 2 }}>{meeting.title}</div>
            ) : (
              <input className="modal-title-input" type="text" value={meeting.title} onChange={e => onUpdate({ title: e.target.value })} />
            )}
          </div>
          <button className="icon-btn" title="Close" onClick={onClose}>&times;</button>
        </div>

        {isGoogle ? (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-lo)', marginBottom: 10 }}>
            {meeting.date} &middot; {meeting.time} &middot; {formatDuration(meeting.duration)}
            {meeting.url && <> &middot; <a href={meeting.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--cyan)' }}>Open in Google Calendar</a></>}
          </p>
        ) : (
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
                {meetingTypes.map(mt => <option key={mt.id} value={mt.id}>{mt.label}</option>)}
              </select>
            </div>
          </div>
        )}

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
          <label>Agenda &amp; action items{isGoogle ? ' (auto-detected from description)' : ''}</label>
          {isGoogle ? (
            (meeting.agenda || []).length === 0 ? (
              <p className="task-empty">No bulleted or numbered lines found in this event's description.</p>
            ) : (
              <div className="agenda-list">
                {meeting.agenda.map(item => (
                  <div key={item.id} className="agenda-item">
                    <span className="agenda-item__text">{item.text}</span>
                  </div>
                ))}
              </div>
            )
          ) : (
            <AgendaList agenda={meeting.agenda} onChange={agenda => onUpdate({ agenda })} />
          )}
        </div>

        <div className="modal-field">
          <label>Prep tasks &mdash; needed before this meeting</label>
          <PrepTaskList
            meeting={meeting}
            prepTasks={tasks.filter(t => t.meetingId === meeting.id)}
            categories={categories}
            onAdd={(categoryId, title, duration, deadline) => onAddPrepTask(meeting.id, categoryId, title, meeting.date, duration, deadline)}
            onToggle={onTogglePrepTask}
            onDelete={onDeletePrepTask}
            onOpenTask={onOpenTask}
          />
        </div>

        {isGoogle ? (
          meeting.description && (
            <div className="modal-field">
              <label>Description (from Google)</label>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--text-lo)', whiteSpace: 'pre-wrap' }}>{meeting.description}</p>
            </div>
          )
        ) : (
          <div className="modal-field">
            <label>Notes</label>
            <textarea className="modal-notes" rows={6} placeholder="Discussion notes, decisions, follow-ups…"
              value={meeting.notes || ''} onChange={e => onUpdate({ notes: e.target.value })} />
          </div>
        )}

        <div className="modal-footer">
          {!isGoogle && <button className="btn btn--danger" onClick={() => { onDelete(); onClose(); }}>Delete meeting</button>}
          <button className="btn btn--amber" onClick={onClose} style={isGoogle ? { marginLeft: 'auto' } : undefined}>Done</button>
        </div>
      </div>
    </div>
  );
}

function DocLibraryPanel({ links, linkTags, onAdd, onDelete, onAddTag, onDeleteTag, onRetag }){
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
    <section className="panel doc-library">
      <div className="panel__head">
        <div>
          <p className="panel__eyebrow">Doc Library</p>
          <h2 className="panel__title">Everything you keep coming back to</h2>
        </div>
        <div className="week-nav">
          <button className="btn" onClick={() => setManageOpen(o => !o)}>Manage access types</button>
          <button className="btn btn--amber" onClick={() => setOpen(o => !o)}>+ Add document</button>
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
          <label>Access type</label>
          <select value={tag} onChange={e => setTag(e.target.value)}>
            {linkTags.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="full">
          <button className="btn btn--ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn btn--amber" onClick={submit}>Add document</button>
        </div>
      </div>

      <div className={`add-form${manageOpen ? ' open' : ''}`}>
        <div className="full" style={{ display: 'block', marginBottom: 4 }}>
          <label>New access type</label>
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
                    title={count > 0 ? 'Move its documents to another access type first' : 'Delete access type'}
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
        <p className="quick-links-empty" style={{ marginTop: 12 }}>Nothing filed here yet — add your PRD folder, sprint sheet, or any doc you open often.</p>
      ) : DOC_TYPE_ORDER.map(typeKey => {
        const typeLinks = filtered.filter(l => (l.type || detectDocType(l.url)) === typeKey);
        if (typeLinks.length === 0) return null;
        const meta = DOC_TYPE_META[typeKey];
        return (
          <div key={typeKey} className="doc-folder">
            <p className="doc-folder__label">&#128193; {meta.label} <span className="category-chip__count">{typeLinks.length}</span></p>
            <div className="doc-folder-grid">
              {typeLinks.map(l => (
                <div key={l.id} className="doc-file-card">
                  <div className="doc-file-card__icon">{meta.icon}</div>
                  <a className="doc-file-card__name" href={l.url} target="_blank" rel="noopener noreferrer" title={l.label}>{l.label}</a>
                  <select className="doc-file-card__tag" value={l.tag || linkTags[0] || ''} onChange={e => onRetag(l.id, e.target.value)}>
                    {linkTags.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <button className="doc-file-card__remove" title="Remove" onClick={() => onDelete(l.id)}>&times;</button>
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

function TaskRow({ task, onUpdate, onSetStatus, onToggleRisk, onOpenDetail, onReviseDue, onToggleSubtask }){
  const today = todayISO();
  const dueStatus = dueStatusInfo(task, today);
  const dueClass = dueStatus ? ` ${dueStatus.cssClass}` : '';
  const dueTitle = dueStatus ? dueStatus.label : 'End date';
  const hasContent = (task.notes && task.notes.trim()) || (task.closingRemark && task.closingRemark.trim()) || task.link;
  const hasHistory = task.dueRevisions && task.dueRevisions.length > 0;
  const [expanded, setExpanded] = useState(false);

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

  const subtasks = task.subtasks || [];
  const hasSubtasks = subtasks.length > 0;
  const doneCount = subtasks.filter(s => s.done).length;

  return (
    <div className="task-row-wrap">
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
          <input className="task-due" type="date" value={task.startDate || ''}
            title={hasSubtasks ? 'Start date — computed from sub-tasks (earliest sub-task start)' : 'Start date'}
            disabled={hasSubtasks}
            onChange={e => onUpdate({ startDate: e.target.value })} />
          <span className="date-range__arrow">&rarr;</span>
          <div className="due-wrap">
            <input className={`task-due${dueClass}`} type="date" value={task.endDate || ''}
              title={hasSubtasks ? 'Due date — computed from sub-tasks (latest sub-task end)' : dueTitle}
              disabled={hasSubtasks}
              onChange={handleEndDateChange} />
            {hasHistory && <span className="extended-dot" title={`Deadline extended ${task.dueRevisions.length}\u00d7`} />}
          </div>
        </div>
        <button className={`icon-btn${task.atRisk ? ' flag-on' : ''}`} title="Flag at risk" onClick={onToggleRisk}>&#9873;</button>
        {hasSubtasks && (
          <button className={`subtask-badge${expanded ? ' is-open' : ''}`} title="Show sub-tasks" onClick={() => setExpanded(x => !x)}>
            {doneCount}/{subtasks.length} <span className="subtask-badge__caret">{expanded ? '\u25b4' : '\u25be'}</span>
          </button>
        )}
        <button className={`icon-btn${hasContent ? ' link-on' : ''}`} title="Open details & notes" onClick={onOpenDetail}>&#8942;</button>
      </div>
      {hasSubtasks && expanded && (
        <div className="subtask-quickview">
          {subtasks.map(s => (
            <div key={s.id} className={`subtask-quickview__item${s.done ? ' done' : ''}`}>
              <input type="checkbox" checked={s.done} onChange={() => onToggleSubtask(s.id)} />
              <span className="subtask-quickview__title" onClick={onOpenDetail}>{s.title}</span>
              {s.endDate && <span className="subtask-quickview__date">{s.endDate}</span>}
              {s.estimatedDuration ? <span className="subtask-quickview__duration">{formatDuration(s.estimatedDuration)}</span> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SubtaskList({ task, onAdd, onToggle, onUpdate, onDelete }){
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [duration, setDuration] = useState(30);
  const subtasks = task.subtasks || [];
  const doneCount = subtasks.filter(s => s.done).length;

  function submit(){
    if (!title.trim()) return;
    onAdd(title.trim(), startDate, endDate, duration);
    setTitle(''); setStartDate(''); setEndDate(''); setDuration(30);
  }

  return (
    <div>
      {subtasks.length > 0 && (
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-lo)', marginBottom: 8 }}>
          {doneCount}/{subtasks.length} complete &middot; the task's own start/end above are computed from these
        </p>
      )}
      {subtasks.length > 0 && (
        <div className="subtask-list">
          {subtasks.map(s => (
            <div key={s.id} className={`subtask-item${s.done ? ' done' : ''}`}>
              <input type="checkbox" checked={s.done} onChange={() => onToggle(s.id)} />
              <span className="subtask-item__title">{s.title}</span>
              <input type="date" className="subtask-item__date" value={s.startDate || ''} title="Start date"
                onChange={e => onUpdate(s.id, { startDate: e.target.value })} />
              <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>&rarr;</span>
              <input type="date" className="subtask-item__date" value={s.endDate || ''} title="End date"
                onChange={e => onUpdate(s.id, { endDate: e.target.value })} />
              <DurationSelect value={s.estimatedDuration || 0} onChange={val => onUpdate(s.id, { estimatedDuration: val })} />
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
        <DurationSelect value={duration} onChange={setDuration} />
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
  const hasSubtasks = task.subtasks && task.subtasks.length > 0;

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
            <label>Start date{hasSubtasks ? <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> (from sub-tasks)</span> : null}</label>
            <input type="date" value={task.startDate || ''} disabled={hasSubtasks}
              title={hasSubtasks ? 'Computed from sub-tasks — earliest sub-task start' : undefined}
              onChange={e => onUpdate({ startDate: e.target.value })} />
          </div>
          <div>
            <label>End date{hasSubtasks ? <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> (from sub-tasks)</span> : (revisions.length > 0 && <span style={{ color: 'var(--purple)' }}> (Extended)</span>)}</label>
            <input type="date" value={task.endDate || ''} disabled={hasSubtasks}
              title={hasSubtasks ? 'Computed from sub-tasks — latest sub-task end' : undefined}
              onChange={handleEndDateChange} />
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
          <div>
            <label>Estimated time <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>(for day planning)</span></label>
            <select value={task.estimatedDuration || ''} onChange={e => onUpdate({ estimatedDuration: e.target.value ? Number(e.target.value) : null })}>
              <option value="">No estimate</option>
              {DURATION_OPTIONS.map(d => <option key={d} value={d}>{formatDuration(d)}</option>)}
            </select>
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
            onAdd={(title, s, e, dur) => onAddSubtask(title, s, e, dur)}
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

function TaskListView({ tasks, categories, onUpdateTask, onSetTaskStatus, onToggleRisk, onOpenDetail, onReviseDue, onToggleSubtask }){
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
        onToggleSubtask={subId => onToggleSubtask(t.id, subId)}
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

const TIER_LABELS = { prep: 'Meeting prep', today: 'Today', backlog: 'Backlog' };

function DayPlanModal({ preview, categories, variant, onApply, onClose, onGoToTask, onDelay }){
  const [items, setItems] = useState(preview ? preview.placements : []);
  useEffect(() => { setItems(preview ? preview.placements : []); }, [preview]);

  useEffect(() => {
    function onKey(e){ if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!preview) return null;
  const { unfit, missingDuration, fullDayOff, backlogCount } = preview;

  function updateItem(i, patch){
    setItems(its => its.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function removeItem(i){
    setItems(its => its.filter((_, idx) => idx !== i));
  }
  function delayItem(i){
    const item = items[i];
    setItems(its => its.filter((_, idx) => idx !== i));
    if (item) onDelay(item.taskId, item.subtaskId);
  }

  const headings = {
    morning: ['Good morning', "Here's today's plan"],
    update: ['Your day changed', 'Updated plan available'],
    manual: ['Rule-based, not AI — reruns any time', "Today's proposed focus blocks"]
  };
  const [eyebrow, title] = headings[variant] || headings.manual;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-panel__head">
          <div style={{ flex: 1 }}>
            <p className="panel__eyebrow">{eyebrow}</p>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700 }}>{title}</div>
          </div>
          <button className="icon-btn" title="Close" onClick={onClose}>&times;</button>
        </div>

        {fullDayOff ? (
          <p style={{ color: 'var(--text-lo)' }}>Today's marked Out of Office — nothing to plan.</p>
        ) : (
          <React.Fragment>
            <div className="modal-field">
              <label>Suggested blocks {items.length > 0 ? `(${items.length})` : ''}{backlogCount > 0 ? ` · ${backlogCount} in backlog` : ''}</label>
              {items.length === 0 ? (
                <p style={{ color: 'var(--text-lo)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Nothing left in the plan — add tasks or re-run planning.</p>
              ) : (
                <div className="today-list">
                  {items.map((p, i) => {
                    const cat = categoryById(categories, p.theme);
                    return (
                      <div key={`${p.taskId}-${i}`} className="today-item today-item--editable">
                        <TimeSelect value={p.time} onChange={v => updateItem(i, { time: v })} />
                        <DurationSelect value={p.duration} onChange={v => updateItem(i, { duration: v })} />
                        <span className="today-item__title" style={{ cursor: 'pointer' }} onClick={() => onGoToTask(p.taskId)}>
                          {cat && <span className="category-subgroup__dot" style={{ background: cat.chip, marginRight: 6 }} />}
                          {p.taskTitle}
                        </span>
                        {p.tier && <span className="chat-bubble__tool-chip">{TIER_LABELS[p.tier] || p.tier}</span>}
                        {p.meetingTitle && <span style={{ color: 'var(--amber)', fontSize: 11 }}>before "{p.meetingTitle}"</span>}
                        <button className="icon-btn" title="Delay to tomorrow" onClick={() => delayItem(i)}>&raquo;</button>
                        <button className="icon-btn" title="Remove from today's plan" onClick={() => removeItem(i)}>&times;</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {unfit.length > 0 && (
              <div className="modal-field">
                <label style={{ color: 'var(--red)' }}>Couldn't fully fit ({unfit.length})</label>
                <div className="today-list">
                  {unfit.map(u => (
                    <div key={`${u.taskId}-${u.subtaskId || 'task'}`} className="today-item" style={{ cursor: 'pointer' }} onClick={() => onGoToTask(u.taskId)}>
                      <span className="today-item__title">
                        {u.taskTitle}
                        {u.tier && <span className="chat-bubble__tool-chip" style={{ marginLeft: 6 }}>{TIER_LABELS[u.tier] || u.tier}</span>}
                      </span>
                      <span style={{ color: 'var(--red)', fontSize: 11 }}>{u.reason} &middot; {formatDuration(u.remaining)} short</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {missingDuration.length > 0 && (
              <div className="modal-field">
                <label style={{ color: 'var(--amber)' }}>Skipped — no time estimate ({missingDuration.length})</label>
                <div className="today-list">
                  {missingDuration.map(t => (
                    <div key={t.id} className="today-item" style={{ cursor: 'pointer' }} onClick={() => onGoToTask(t.id)}>
                      <span className="today-item__title">{t.title}</span>
                      <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>Open it and add an estimate to include it next time</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </React.Fragment>
        )}

        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose}>{variant === 'update' ? 'Keep current plan' : 'Cancel'}</button>
          {items.length > 0 && (
            <button className="btn btn--amber" onClick={() => onApply(items)}>{variant === 'update' ? 'Update plan' : 'Apply to calendar'}</button>
          )}
        </div>
      </div>
    </div>
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
            <div className="filing-list">
              {unfiledNotes.map(n => (
                <div key={n.id} className="filing-row">
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

/* ============================== Claude Assistant chat panel ============================== */

// Renders a single chat bubble from an Anthropic-format message. Assistant messages
// can mix text blocks with tool_use blocks (shown as small inline chips, not the raw
// JSON) — tool_result / user turns built from tool results are never shown as bubbles.
function ChatMessageBubble({ message }){
  if (message.role === 'user' && typeof message.content !== 'string') return null; // tool-result turn, not user-typed
  const blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
  const textBlocks = blocks.filter(b => b.type === 'text' && b.text && b.text.trim());
  const toolBlocks = blocks.filter(b => b.type === 'tool_use');
  if (textBlocks.length === 0 && toolBlocks.length === 0) return null;

  return (
    <div className={`chat-bubble chat-bubble--${message.role}`}>
      {textBlocks.map((b, i) => <p key={i}>{b.text}</p>)}
      {toolBlocks.map(b => (
        <div key={b.id} className="chat-bubble__tool-chip">&#9881; {b.name.replace(/_/g, ' ')}</div>
      ))}
    </div>
  );
}

function ChatConfirmCard({ confirmation, onAccept, onReject }){
  const destructive = confirmation.name === 'delete_task';
  return (
    <div className={`chat-confirm-card${destructive ? ' chat-confirm-card--danger' : ''}`}>
      <p className="chat-confirm-card__desc">{confirmation.description}</p>
      <div className="chat-confirm-card__actions">
        <button className="btn btn--ghost" onClick={() => onReject(confirmation.id)}>Decline</button>
        <button className={`btn${destructive ? ' btn--danger' : ' btn--amber'}`} onClick={() => onAccept(confirmation.id)}>
          {destructive ? 'Confirm delete' : 'Apply'}
        </button>
      </div>
    </div>
  );
}

function ApiKeyModal({ open, onClose, onSave, onRemove, hasKey, busy, error }){
  const [key, setKey] = useState('');
  useEffect(() => { if (open) setKey(''); }, [open]);
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <div className="modal-panel__head">
          <div style={{ flex: 1 }}>
            <p className="panel__eyebrow">Bring your own key</p>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}>
              {hasKey ? 'Manage your Anthropic API key' : 'Connect your Anthropic API key'}
            </div>
          </div>
          <button className="icon-btn" title="Close" onClick={onClose}>&times;</button>
        </div>

        <p style={{ fontSize: 12, color: 'var(--text-lo)', lineHeight: 1.6 }}>
          The assistant runs on your own Anthropic API key, billed to your own account — not the app owner's.
          Grab one from <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com/settings/keys</a> and paste it below.
          {hasKey && ' A key is already connected — paste a new one to replace it.'}
        </p>

        <div className="modal-field">
          <label>API key</label>
          <input type="password" placeholder="sk-ant-..." value={key} onChange={e => setKey(e.target.value)} autoFocus />
        </div>

        {error && <p style={{ color: 'var(--red)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>{error}</p>}

        <div className="modal-footer">
          {hasKey && <button className="btn btn--danger" disabled={busy} onClick={onRemove}>Disconnect</button>}
          <button className="btn btn--amber" disabled={busy || !key.trim()} style={{ marginLeft: 'auto' }} onClick={() => onSave(key.trim())}>
            {busy ? 'Saving…' : 'Save key'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatPanel({ open, onToggle, messages, loading, error, confirmations, onAccept, onReject, input, onInputChange, onSend, hasApiKey, onOpenApiKeyModal }){
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, confirmations, loading]);

  return (
    <React.Fragment>
      <button className="chat-fab" title="Ask the assistant" onClick={onToggle}>
        {open ? '\u2715' : '\u2726'}
      </button>
      {open && (
        <div className="chat-panel">
          <div className="chat-panel__head">
            <div>
              <p className="panel__eyebrow">Scoped to tasks &amp; day planning</p>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700 }}>Assistant</div>
            </div>
            <button className="icon-btn" title="Close" onClick={onToggle}>&times;</button>
          </div>

          {!hasApiKey ? (
            <div className="chat-panel__body" style={{ justifyContent: 'center' }}>
              <p style={{ fontSize: 13, lineHeight: 1.6 }}>
                {hasApiKey === null ? 'Checking…' : "Connect your own Anthropic API key to use the assistant — usage is billed to whichever Anthropic account you connect, never to the app owner's."}
              </p>
              {hasApiKey === false && (
                <button className="btn btn--amber" onClick={onOpenApiKeyModal} style={{ alignSelf: 'flex-start' }}>Connect API key</button>
              )}
            </div>
          ) : (
            <React.Fragment>
              <div className="chat-panel__body" ref={scrollRef}>
                {messages.length === 0 && confirmations.length === 0 && (
                  <p style={{ color: 'var(--text-lo)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    Try: "What's overdue?", "Add a task to review the deck, due Friday", or "Plan my day".
                  </p>
                )}
                {messages.map((m, i) => <ChatMessageBubble key={i} message={m} />)}
                {confirmations.map(c => (
                  <ChatConfirmCard key={c.id} confirmation={c} onAccept={onAccept} onReject={onReject} />
                ))}
                {loading && <p style={{ color: 'var(--text-lo)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Thinking…</p>}
                {error && <p style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{error}</p>}
              </div>

              <div className="chat-panel__input">
                <input
                  type="text"
                  placeholder={confirmations.length > 0 ? 'Resolve the pending change above first…' : 'Ask or tell it what to do…'}
                  value={input}
                  disabled={loading || confirmations.length > 0}
                  onChange={e => onInputChange(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') onSend(); }}
                />
                <button className="btn btn--amber" disabled={loading || confirmations.length > 0} onClick={onSend}>Send</button>
              </div>
              <div style={{ padding: '0 12px 10px', textAlign: 'right' }}>
                <button className="icon-btn" title="Manage API key" onClick={onOpenApiKeyModal} style={{ fontSize: 10, width: 'auto', color: 'var(--text-faint)' }}>Manage key</button>
              </div>
            </React.Fragment>
          )}
        </div>
      )}
    </React.Fragment>
  );
}

/* ============================== App ============================== */

function App(){
  const [session, setSession] = useState(undefined); // undefined = still checking, null = signed out
  const [loaded, setLoaded] = useState(false);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [categoryCounter, setCategoryCounter] = useState(DEFAULT_CATEGORIES.length + 1);
  const [meetingTypes, setMeetingTypes] = useState(DEFAULT_MEETING_TYPES);
  const [meetings, setMeetings] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [quickLinks, setQuickLinks] = useState([]);
  const [linkTags, setLinkTags] = useState(DEFAULT_LINK_TAGS);
  const [pendingMeetings, setPendingMeetings] = useState([]);
  const [plannedMeetings, setPlannedMeetings] = useState([]);
  const [settings, setSettings] = useState({ calendarEmbedUrl: '', notificationsEnabled: false });
  const [weekOffset, setWeekOffset] = useState(0);
  const [addMeetingOpen, setAddMeetingOpen] = useState(false);
  const [now, setNow] = useState(new Date());
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [detailTaskId, setDetailTaskId] = useState(null);
  const [focusTaskId, setFocusTaskId] = useState(null);
  const [dayPlanPreview, setDayPlanPreview] = useState(null);
  const [dayPlanBaseline, setDayPlanBaseline] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState('');
  const [chatConfirmations, setChatConfirmations] = useState([]);
  const [pendingTurn, setPendingTurn] = useState(null);
  const [hasApiKey, setHasApiKey] = useState(null);
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [apiKeyBusy, setApiKeyBusy] = useState(false);
  const [apiKeyError, setApiKeyError] = useState('');
  const chatMessagesRef = useRef([]);
  useEffect(() => { chatMessagesRef.current = chatMessages; }, [chatMessages]);
  const [meetingDetailId, setMeetingDetailId] = useState(null);
  const [workingHours, setWorkingHours] = useState({});
  const [defaultWorkingHours, setDefaultWorkingHours] = useState({ start: '09:00', end: '18:00' });
  const [lastVisitDate, setLastVisitDate] = useState('');
  const [lastDigestWeek, setLastDigestWeek] = useState('');
  const [dailyPlannerOpen, setDailyPlannerOpen] = useState(false);
  const [digestOpen, setDigestOpen] = useState(false);
  const [oooRanges, setOooRanges] = useState({});
  const [stickyNotes, setStickyNotes] = useState([]);
  const [ideaNotes, setIdeaNotes] = useState([]);
  const [filingNoteId, setFilingNoteId] = useState(null);
  const [lastEodPromptDate, setLastEodPromptDate] = useState('');
  const [eodModalOpen, setEodModalOpen] = useState(false);
  const [legacyImport, setLegacyImport] = useState(null);
  const [googleEvents, setGoogleEvents] = useState([]);
  const [googleSyncStatus, setGoogleSyncStatus] = useState('idle'); // idle | syncing | error
  const [googleSyncError, setGoogleSyncError] = useState('');
  const [googleLinkOpen, setGoogleLinkOpen] = useState(false);
  const saveTimer = useRef(null);
  const notificationsEnabledRef = useRef(false);
  useEffect(() => { notificationsEnabledRef.current = settings.notificationsEnabled; }, [settings.notificationsEnabled]);

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
    setMeetingTypes((parsed.meetingTypes && parsed.meetingTypes.length) ? parsed.meetingTypes : DEFAULT_MEETING_TYPES);
    setMeetings(parsed.meetings || []);
    setTasks(parsed.tasks || []);
    setQuickLinks(parsed.quickLinks || []);
    setLinkTags((parsed.linkTags && parsed.linkTags.length) ? parsed.linkTags : DEFAULT_LINK_TAGS);
    setPendingMeetings(parsed.pendingMeetings || []);
    setPlannedMeetings(parsed.plannedMeetings || []);
    setSettings(Object.assign({ calendarEmbedUrl: '', notificationsEnabled: false }, parsed.settings || {}));
    setWorkingHours(parsed.workingHours || {});
    setDefaultWorkingHours(parsed.defaultWorkingHours || { start: '09:00', end: '18:00' });
    setOooRanges(parsed.oooRanges || {});
    setStickyNotes(parsed.stickyNotes || []);
    setIdeaNotes(parsed.ideaNotes || []);
    setLastEodPromptDate(parsed.lastEodPromptDate || '');
    return { lastVisitDate: parsed.lastVisitDate || '', lastDigestWeek: parsed.lastDigestWeek || '' };
  }

  // Once signed in, load this user's data from Supabase (each user's row is
  // walled off from everyone else's by the database's row-level security).
  //
  // IMPORTANT: this depends on the user's *id* (a stable string), not the whole
  // `session` object. Supabase silently refreshes the auth token roughly every
  // hour and on tab focus, firing onAuthStateChange with a brand-new session
  // object each time — if this effect depended on `session` directly, every one
  // of those routine refreshes would re-run the full load logic, and any
  // transient hiccup in that refetch (network blip, a race during token
  // rotation) could fall through to "no data found" and overwrite real data
  // with empty defaults via the save effect. Keying on the id avoids re-running
  // this at all for same-user token refreshes.
  const userId = session && session.user ? session.user.id : null;
  const hasLoadedOnceRef = useRef(false);

  useEffect(() => {
    if (!userId) { setLoaded(false); hasLoadedOnceRef.current = false; return; }
    let cancelled = false;

    (async () => {
      let resumedLastVisit = '';
      let resumedDigestWeek = '';
      try {
        const { data, error } = await supabaseClient
          .from('app_state')
          .select('data')
          .eq('user_id', userId)
          .maybeSingle();
        if (error) throw error;
        if (cancelled) return;

        if (data && data.data && Object.keys(data.data).length > 0) {
          const resumed = applyLoadedData(data.data);
          resumedLastVisit = resumed.lastVisitDate;
          resumedDigestWeek = resumed.lastDigestWeek;
          setLastVisitDate(resumedLastVisit);
          setLastDigestWeek(resumedDigestWeek);
          hasLoadedOnceRef.current = true;
        } else if (!hasLoadedOnceRef.current) {
          // Only seed defaults on a genuine first load for this account. If we'd
          // already loaded real data once before, an empty result here is
          // suspicious rather than a real "you're new" signal — see note above.
          const seed = getSeedData();
          setCategories(seed.categories);
          setCategoryCounter(seed.categoryCounter);
          setMeetings(seed.meetings);
          setTasks(seed.tasks);
          setQuickLinks(seed.quickLinks);
          setLinkTags(seed.linkTags);
          setPendingMeetings(seed.pendingMeetings);
          setPlannedMeetings(seed.plannedMeetings);
          hasLoadedOnceRef.current = true;
        } else {
          console.warn('Cloud fetch returned no data after an earlier successful load — keeping existing in-memory data rather than overwriting it.');
        }

        // Check for data left over in this browser from before sign-in existed,
        // regardless of whether a (possibly still-empty) cloud row already exists —
        // an early login before this feature shipped can otherwise mask it forever.
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
      } catch (e) {
        console.error('Failed to load cloud data', e);
      }
      if (cancelled) return;

      const today = todayISO();
      if (resumedLastVisit !== today) {
        setDailyPlannerOpen(true);
        if (notificationsEnabledRef.current) notify('Good morning', 'Set up your working hours and today\'s plan in Control Centre.');
      }
      const isFriday = new Date().getDay() === 5;
      const mondayIso = isoOf(getMonday(new Date()));
      if (isFriday && resumedDigestWeek !== mondayIso) {
        setDigestOpen(true);
        if (notificationsEnabledRef.current) notify('Weekly digest ready', 'Your Friday progress digest is ready to review.');
      }

      setLoaded(true);
    })();

    return () => { cancelled = true; };
  }, [userId]);

  // Whether this user has connected their own Anthropic API key yet — checked by
  // presence only, the raw key itself is never fetched back into the browser.
  // null = still checking, so the chat panel doesn't flash the wrong state.
  useEffect(() => {
    if (!userId) { setHasApiKey(null); return; }
    let cancelled = false;
    supabaseClient
      .from('user_api_keys')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { console.error('API key status check failed', error); setHasApiKey(false); return; }
        setHasApiKey(!!data);
      });
    return () => { cancelled = true; };
  }, [userId]);

  // Save whenever data changes, debounced so we're not hitting the database on
  // every keystroke — skipped until the initial load for this user completes.
  useEffect(() => {
    if (!loaded || !session) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const payload = {
        categories, categoryCounter, meetingTypes, meetings, tasks, quickLinks, linkTags,
        pendingMeetings, plannedMeetings, settings, workingHours, defaultWorkingHours,
        lastVisitDate, lastDigestWeek, oooRanges, stickyNotes, ideaNotes, lastEodPromptDate
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
  }, [categories, categoryCounter, meetingTypes, meetings, tasks, quickLinks, linkTags, pendingMeetings, plannedMeetings, settings, workingHours, defaultWorkingHours, lastVisitDate, lastDigestWeek, oooRanges, stickyNotes, ideaNotes, lastEodPromptDate, loaded, session]);

  function signOut(){
    supabaseClient.auth.signOut();
  }

  async function toggleNotifications(){
    if (settings.notificationsEnabled) {
      setSettings(s => ({ ...s, notificationsEnabled: false }));
      return;
    }
    if (typeof Notification === 'undefined') return;
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      setSettings(s => ({ ...s, notificationsEnabled: true }));
      notify('Notifications on', 'Control Centre will now alert you for meeting prep, wrap-ups, and daily reminders.');
    }
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
      if (settings.notificationsEnabled) notify('End of day', `You've got ${stickyNotes.length} unfiled quick note${stickyNotes.length === 1 ? '' : 's'} — file them or they'll resurface tomorrow.`);
    }
  }, [now, loaded, stickyNotes, workingHours, defaultWorkingHours, lastEodPromptDate, settings.notificationsEnabled]);

  // Google Calendar sync: fetch on link, then poll every 60s while the tab is
  // open and a calendar is linked. This is polling, not true push — Google's
  // real push notifications need a public webhook server, which a static
  // site doesn't have. A minute's staleness is the honest trade-off here.
  async function syncGoogleCalendar(){
    if (!settings.googleCalendarUrl || !session) return;
    setGoogleSyncStatus('syncing');
    setGoogleSyncError('');
    try {
      const result = await fetchGoogleCalendarEvents(session.access_token);
      setGoogleEvents(result.events || []);
      setGoogleSyncStatus('idle');
      if (result.error) setGoogleSyncError(result.error);
    } catch (e) {
      console.error('Google Calendar sync failed', e);
      setGoogleSyncStatus('error');
      setGoogleSyncError(e.message || 'Sync failed');
    }
  }

  useEffect(() => {
    if (!loaded || !settings.googleCalendarUrl) { setGoogleEvents([]); return; }
    syncGoogleCalendar();
    const id = setInterval(syncGoogleCalendar, 60000);
    return () => clearInterval(id);
  }, [loaded, settings.googleCalendarUrl, session]);

  // Meeting-prep tasks: notify once, the moment each one's reminder window opens.
  const notifiedPrepRef = useRef(new Set());
  useEffect(() => {
    if (!loaded || !notificationsEnabledRef.current) return;
    const combined = [...plannedMeetings, ...googleEvents.map(normalizeGoogleEvent)];
    tasks.forEach(t => {
      if (!t.meetingId || t.status === 'done') return;
      const meeting = combined.find(m => m.id === t.meetingId);
      if (!meeting) return;
      const hours = getWorkingHours(workingHours, defaultWorkingHours, meeting.date);
      const info = getPrepReminderStatus(meeting, hours);
      if (info && info.active && !notifiedPrepRef.current.has(t.id)) {
        notifiedPrepRef.current.add(t.id);
        notify('Meeting prep needed', `"${t.title}" — before "${meeting.title}" at ${meeting.time}`);
      }
    });
  }, [now, loaded, tasks, plannedMeetings, googleEvents, workingHours, defaultWorkingHours]);

  // Scheduled meetings: notify once when a meeting crosses 75% of its duration.
  const notifiedWrapRef = useRef(new Set());
  useEffect(() => {
    if (!loaded || !notificationsEnabledRef.current) return;
    const today_ = todayISO();
    plannedMeetings.filter(m => m.date === today_ && m.kind !== 'focus').forEach(m => {
      const status = getMeetingStatus(m.date, m.time || '00:00', m.duration);
      const key = `${m.id}-${today_}`;
      if (status.status === 'wrapping' && !notifiedWrapRef.current.has(key)) {
        notifiedWrapRef.current.add(key);
        notify('Wrapping up?', `"${m.title}" is at ~75% — worth checking the agenda.`);
      }
    });
  }, [now, loaded, plannedMeetings]);

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
  function addMeetingType(label){
    const palette = colorForIndex(meetingTypes.length);
    setMeetingTypes(mts => [...mts, { id: uid(), label, color: palette.chip, dim: palette.chipDim }]);
  }
  function deleteMeetingType(id){
    const inUse = meetings.some(m => m.type === id) || plannedMeetings.some(m => m.type === id);
    if (inUse) return; // guarded in the UI too; extra safety here
    setMeetingTypes(mts => mts.filter(t => t.id !== id));
  }

  /* ---------- Task actions ---------- */
  function addTask(categoryId, title, startDate, endDate){
    setTasks(ts => [...ts, { id: uid(), theme: categoryId, title, status: 'todo', atRisk: false, startDate: startDate || '', endDate: endDate || '', notes: '', link: '', closingRemark: '', weight: 1, completedAt: '' }]);
  }
  function addPrepTask(meetingId, categoryId, title, meetingDate, duration, deadline){
    // Defensively cap here too (not just in the UI's max attribute) — a prep
    // task's deadline can be earlier than its meeting but never later.
    let due = deadline || meetingDate || '';
    if (meetingDate && due > meetingDate) due = meetingDate;
    setTasks(ts => [...ts, { id: uid(), theme: categoryId, title, status: 'todo', atRisk: false, startDate: '', endDate: due, notes: '', link: '', closingRemark: '', weight: 1, completedAt: '', meetingId, estimatedDuration: duration || null }]);
  }
  function togglePrepTask(taskId){
    setTasks(ts => ts.map(t => {
      if (t.id !== taskId) return t;
      const nowDone = t.status !== 'done';
      return { ...t, status: nowDone ? 'done' : 'todo', completedAt: nowDone ? todayISO() : '', atRisk: nowDone ? false : t.atRisk };
    }));
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

  /* ---------- Day Planner actions ---------- */
  function buildDayPlanCtx(){
    return { tasks, meetings, plannedMeetings, googleEvents, workingHours, defaultWorkingHours, oooRanges };
  }
  function planMyDay(variant){
    const dateISO = todayISO();
    const ctx = buildDayPlanCtx();
    const preview = computeDayPlan(dateISO, ctx);
    setDayPlanPreview({ dateISO, variant: variant || 'manual', ...preview });
    setDayPlanBaseline({ dateISO, signature: getDayPlanSignatureInputs(dateISO, ctx), planFingerprint: fingerprintDayPlan(preview) });
  }
  // Shared by "Apply to calendar" / "Update plan" and the assistant's apply_day_plan tool.
  // Regenerating for the same day only ever replaces this planner's own past output —
  // anything placed by hand (no `source` tag) is left alone.
  function commitDayPlan(dateISO, placements){
    setPlannedMeetings(pm => {
      const kept = pm.filter(m => !(m.kind === 'focus' && m.source === 'auto-plan' && m.date === dateISO));
      const added = placements.map(p => ({
        id: uid(), title: `Focus: ${p.taskTitle}`, date: p.date, time: p.time, duration: p.duration,
        agenda: [], notes: '', kind: 'focus', taskId: p.taskId, subtaskId: p.subtaskId || null, source: 'auto-plan', planDate: dateISO
      }));
      return [...kept, ...added];
    });
  }
  function applyDayPlanPreview(items){
    if (!dayPlanPreview) return;
    commitDayPlan(dayPlanPreview.dateISO, items || dayPlanPreview.placements);
    setDayPlanPreview(null);
  }
  function goToTaskFromPlan(id){
    setDayPlanPreview(null);
    goToTask(id);
  }
  // "Delay" on a plan row means consciously pushing that item's own deadline to
  // tomorrow (using the same revision-history mechanism as editing its due date
  // anywhere else), not just hiding it from today's view. For a sub-task-level
  // placement, that means the sub-task's own end date (which rolls up to the
  // parent task automatically) rather than the parent task's date directly.
  function delayDayPlanTask(taskId, subtaskId){
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const tomorrow = isoOf(d);
    if (subtaskId) {
      updateSubtask(taskId, subtaskId, { endDate: tomorrow });
    } else {
      reviseDueDate(taskId, tomorrow);
    }
  }

  // Re-checks whether today's plan is still current whenever plan-relevant state
  // changes (a task's dates/estimate/status, a meeting added/moved, working hours,
  // OOO). Waits for a 5-minute quiet period after the last relevant change before
  // recomputing — long enough that a burst of edits doesn't pop the modal mid-edit —
  // and only once a baseline plan exists for today and no plan modal is already open.
  // Even then, it only surfaces "Your day changed" if the recomputed plan's actual
  // placements differ from what's currently applied; an input change that happens to
  // recompute to the same plan is a no-op and stays silent.
  useEffect(() => {
    if (!loaded || !dayPlanBaseline || dayPlanPreview) return;
    const dateISO = todayISO();
    if (dayPlanBaseline.dateISO !== dateISO) return;
    const timer = setTimeout(() => {
      const ctx = buildDayPlanCtx();
      const currentSig = getDayPlanSignatureInputs(dateISO, ctx);
      if (currentSig === dayPlanBaseline.signature) return;
      const preview = computeDayPlan(dateISO, ctx);
      const newFingerprint = fingerprintDayPlan(preview);
      if (newFingerprint === dayPlanBaseline.planFingerprint) {
        // Inputs changed but the resulting plan didn't — update the baseline
        // silently so we're comparing against fresh inputs next time, no popup.
        setDayPlanBaseline({ dateISO, signature: currentSig, planFingerprint: newFingerprint });
        return;
      }
      setDayPlanPreview({ dateISO, variant: 'update', ...preview });
      setDayPlanBaseline({ dateISO, signature: currentSig, planFingerprint: newFingerprint });
    }, 5 * 60 * 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line
  }, [tasks, meetings, plannedMeetings, googleEvents, workingHours, defaultWorkingHours, oooRanges, loaded, dayPlanBaseline, dayPlanPreview]);

  /* ---------- Claude Assistant ---------- */
  // BYOK: each person connects their own Anthropic API key before the assistant will
  // respond for them. The key is written here but never read back into the browser —
  // the hasApiKey check above only ever selects the row's existence, not its value.
  async function saveAnthropicKey(key){
    setApiKeyBusy(true);
    setApiKeyError('');
    try {
      const { error } = await supabaseClient
        .from('user_api_keys')
        .upsert({ user_id: session.user.id, anthropic_api_key: key, updated_at: new Date().toISOString() });
      if (error) throw error;
      setHasApiKey(true);
      setApiKeyModalOpen(false);
    } catch (e) {
      setApiKeyError(e.message || 'Could not save that key.');
    } finally {
      setApiKeyBusy(false);
    }
  }
  async function removeAnthropicKey(){
    setApiKeyBusy(true);
    setApiKeyError('');
    try {
      const { error } = await supabaseClient.from('user_api_keys').delete().eq('user_id', session.user.id);
      if (error) throw error;
      setHasApiKey(false);
      setApiKeyModalOpen(false);
    } catch (e) {
      setApiKeyError(e.message || 'Could not remove that key.');
    } finally {
      setApiKeyBusy(false);
    }
  }
  function describeToolCall(name, input){
    const t = input && input.taskId ? tasks.find(x => x.id === input.taskId) : null;
    switch (name){
      case 'create_task':
        return `Create task "${input.title}"${input.endDate ? ` — due ${input.endDate}` : ''}`;
      case 'update_task':
        return `Update "${t ? t.title : input.taskId}"`;
      case 'delete_task':
        return `Delete task "${t ? t.title : input.taskId}"`;
      case 'add_subtask':
        return `Add sub-task "${input.title}" to "${t ? t.title : input.taskId}"`;
      case 'toggle_subtask':
        return `Toggle a sub-task on "${t ? t.title : input.taskId}"`;
      case 'apply_day_plan':
        return `Apply the previewed focus blocks to ${input && input.dateISO ? input.dateISO : todayISO()}'s calendar`;
      default:
        return name.replace(/_/g, ' ');
    }
  }

  // Executes one tool call against real app state and returns a string result for
  // Claude. Read tools return JSON; write tools return a short confirmation string.
  // This function is only ever reached after either the tool is read-only, or the
  // user has explicitly accepted the confirmation card for it.
  function executeAssistantTool(name, input){
    input = input || {};
    switch (name){
      case 'get_app_context': {
        const dateISO = input.dateISO || todayISO();
        const openTasks = tasks.filter(t => t.status !== 'done').map(t => ({
          id: t.id, title: t.title, status: t.status, categoryId: t.theme,
          startDate: t.startDate || null, endDate: t.endDate || null,
          weight: t.weight || 1, estimatedDuration: t.estimatedDuration || null,
          meetingId: t.meetingId || null, atRisk: !!t.atRisk
        }));
        const todaysMeetings = getMeetingsOnDate(dateISO, { meetings, plannedMeetings, googleEvents })
          .map(m => ({ id: m.id, title: m.title, time: m.time, duration: m.duration }));
        return JSON.stringify({
          date: dateISO,
          categories: categories.map(c => ({ id: c.id, title: c.title, code: c.code })),
          openTasks, todaysMeetings,
          workingHours: getWorkingHours(workingHours, defaultWorkingHours, dateISO),
          outOfOffice: oooRanges[dateISO] || null
        });
      }
      case 'create_task': {
        const cat = categories.find(c => c.id === input.categoryId)
          || categories.find(c => c.title.toLowerCase() === String(input.categoryId || '').toLowerCase());
        if (!cat) return `Failed: no matching category "${input.categoryId}". Valid ids: ${categories.map(c => c.id).join(', ')}`;
        const newTask = {
          id: uid(), theme: cat.id, title: input.title, status: 'todo', atRisk: false,
          startDate: input.startDate || '', endDate: input.endDate || '', notes: '', link: '', closingRemark: '',
          weight: input.weight || 1, completedAt: '', estimatedDuration: input.estimatedDuration || null
        };
        setTasks(ts => [...ts, newTask]);
        return `Created task "${input.title}" (id: ${newTask.id}) in ${cat.title}.`;
      }
      case 'update_task': {
        const t = tasks.find(x => x.id === input.taskId);
        if (!t) return `Failed: no task with id ${input.taskId}`;
        if (input.endDate && input.endDate !== t.endDate) reviseDueDate(input.taskId, input.endDate);
        if (input.status && input.status !== t.status) setTaskStatus(input.taskId, input.status);
        const patch = {};
        ['title', 'weight', 'estimatedDuration', 'startDate', 'notes', 'atRisk'].forEach(k => {
          if (input[k] !== undefined) patch[k] = input[k];
        });
        if (Object.keys(patch).length) updateTask(input.taskId, patch);
        return `Updated "${t.title}".`;
      }
      case 'delete_task': {
        const t = tasks.find(x => x.id === input.taskId);
        if (!t) return `Failed: no task with id ${input.taskId}`;
        deleteTask(input.taskId);
        return `Deleted "${t.title}".`;
      }
      case 'add_subtask': {
        const t = tasks.find(x => x.id === input.taskId);
        if (!t) return `Failed: no task with id ${input.taskId}`;
        addSubtask(input.taskId, input.title, input.startDate || '', input.endDate || '', input.estimatedDurationMinutes || null);
        return `Added sub-task "${input.title}" to "${t.title}".`;
      }
      case 'toggle_subtask': {
        const t = tasks.find(x => x.id === input.taskId);
        if (!t) return `Failed: no task with id ${input.taskId}`;
        toggleSubtask(input.taskId, input.subtaskId);
        return `Toggled sub-task on "${t.title}".`;
      }
      case 'preview_day_plan': {
        const dateISO = input.dateISO || todayISO();
        const ctx = buildDayPlanCtx();
        const preview = computeDayPlan(dateISO, ctx);
        setDayPlanPreview({ dateISO, variant: 'manual', ...preview });
        setDayPlanBaseline({ dateISO, signature: getDayPlanSignatureInputs(dateISO, ctx), planFingerprint: fingerprintDayPlan(preview) });
        return JSON.stringify({ dateISO, ...preview });
      }
      case 'apply_day_plan': {
        const dateISO = input.dateISO || todayISO();
        const ctx = buildDayPlanCtx();
        const preview = (dayPlanPreview && dayPlanPreview.dateISO === dateISO)
          ? dayPlanPreview
          : { dateISO, ...computeDayPlan(dateISO, ctx) };
        commitDayPlan(dateISO, preview.placements);
        setDayPlanPreview(null);
        return `Applied ${preview.placements.length} focus block(s) to ${dateISO}.`;
      }
      default:
        return `Unknown tool: ${name}`;
    }
  }

  // Sends a message array to the assistant Edge Function, handles any tool_use blocks
  // in the reply (read tools execute immediately; write tools wait in chatConfirmations
  // for the user), and — once every tool_use in the turn has a result — loops back
  // automatically so Claude can see the outcome and keep going.
  async function sendToAssistant(messagesToSend){
    setChatLoading(true);
    setChatError('');
    try {
      const { data } = await supabaseClient.auth.getSession();
      const token = data && data.session && data.session.access_token;
      const res = await fetch(`${window.SUPABASE_CONFIG.url}/functions/v1/assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: messagesToSend, tools: ASSISTANT_TOOLS })
      });
      const payload = await res.json();
      if (!res.ok) {
        if (payload.error === 'no_api_key') { setHasApiKey(false); setChatLoading(false); return; }
        throw new Error(payload.error || `Assistant error (HTTP ${res.status})`);
      }

      const assistantMessage = { role: 'assistant', content: payload.content };
      const nextMessages = [...messagesToSend, assistantMessage];
      setChatMessages(nextMessages);

      const toolUseBlocks = (payload.content || []).filter(b => b.type === 'tool_use');
      setChatLoading(false);
      if (toolUseBlocks.length === 0) return;

      const results = {};
      const writeBlocks = [];
      toolUseBlocks.forEach(b => {
        if (READ_ONLY_TOOLS.has(b.name)) results[b.id] = executeAssistantTool(b.name, b.input);
        else writeBlocks.push(b);
      });

      if (writeBlocks.length === 0) {
        const toolResultContent = toolUseBlocks.map(b => ({ type: 'tool_result', tool_use_id: b.id, content: results[b.id] }));
        sendToAssistant([...nextMessages, { role: 'user', content: toolResultContent }]);
        return;
      }

      setChatConfirmations(writeBlocks.map(b => ({ id: b.id, name: b.name, input: b.input, description: describeToolCall(b.name, b.input) })));
      setPendingTurn({ blocks: toolUseBlocks, results });
    } catch (e) {
      setChatError(e.message || 'Something went wrong reaching the assistant.');
      setChatLoading(false);
    }
  }

  function sendChatMessage(){
    if (!chatInput.trim() || chatLoading || pendingTurn) return;
    const next = [...chatMessages, { role: 'user', content: chatInput.trim() }];
    setChatMessages(next);
    setChatInput('');
    sendToAssistant(next);
  }

  function resolveChatConfirmation(toolUseId, accepted){
    const block = pendingTurn && pendingTurn.blocks.find(b => b.id === toolUseId);
    if (!block) return;
    let resultText;
    if (accepted) {
      try { resultText = executeAssistantTool(block.name, block.input); }
      catch (e) { resultText = `Failed: ${e.message}`; }
    } else {
      resultText = 'The user declined this change.';
    }
    setChatConfirmations(cs => cs.filter(c => c.id !== toolUseId));
    setPendingTurn(pt => (pt ? { ...pt, results: { ...pt.results, [toolUseId]: resultText } } : pt));
  }

  // Once every tool_use block in the in-flight turn has a result (auto-executed reads
  // plus user-resolved writes), send them all back so the conversation continues.
  useEffect(() => {
    if (!pendingTurn) return;
    const allDone = pendingTurn.blocks.every(b => pendingTurn.results[b.id] !== undefined);
    if (!allDone) return;
    const toolResultContent = pendingTurn.blocks.map(b => ({ type: 'tool_result', tool_use_id: b.id, content: pendingTurn.results[b.id] }));
    setPendingTurn(null);
    sendToAssistant([...chatMessagesRef.current, { role: 'user', content: toolResultContent }]);
  }, [pendingTurn]);

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
  function retagQuickLink(id, tag){
    setQuickLinks(qs => qs.map(q => (q.id === id ? { ...q, tag } : q)));
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
    const dateISO = todayISO();
    if (todayHours) setWorkingHoursForDate(dateISO, todayHours);
    setLastVisitDate(dateISO);
    setDailyPlannerOpen(false);
    // Use the just-picked hours directly rather than waiting on the state update,
    // so the very first plan of the day reflects what was just set, not last night's.
    const ctx = buildDayPlanCtx();
    if (todayHours) ctx.workingHours = { ...ctx.workingHours, [dateISO]: todayHours };
    const preview = computeDayPlan(dateISO, ctx);
    setDayPlanPreview({ dateISO, variant: 'morning', ...preview });
    setDayPlanBaseline({ dateISO, signature: getDayPlanSignatureInputs(dateISO, ctx), planFingerprint: fingerprintDayPlan(preview) });
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
  function addIdeaNote(text){
    setIdeaNotes(ns => [...ns, { id: uid(), text, createdAt: todayISO() }]);
  }
  function deleteIdeaNote(id){
    setIdeaNotes(ns => ns.filter(n => n.id !== id));
  }
  function fileNoteAsTask(noteId, categoryId){
    const note = stickyNotes.find(n => n.id === noteId);
    if (!note) return;
    addTask(categoryId, note.text, '', '');
    deleteStickyNote(noteId);
    setFilingNoteId(null);
  }
  function fileNoteAsPrepTask(noteId, meetingId, categoryId){
    const note = stickyNotes.find(n => n.id === noteId);
    const meeting = plannedMeetings.find(m => m.id === meetingId);
    if (!note || !meeting) return;
    addPrepTask(meetingId, categoryId, note.text, meeting.date);
    deleteStickyNote(noteId);
    setFilingNoteId(null);
  }
  function fileNoteAsAgenda(noteId, meetingId){
    const note = stickyNotes.find(n => n.id === noteId);
    const meeting = plannedMeetings.find(m => m.id === meetingId);
    if (!note || !meeting) return;
    updatePlannedMeeting(meetingId, { agenda: [...(meeting.agenda || []), { id: uid(), text: note.text, done: false }] });
    deleteStickyNote(noteId);
    setFilingNoteId(null);
  }
  function closeEodModal(){
    setLastEodPromptDate(todayISO());
    setEodModalOpen(false);
  }

  function importLegacyData(){
    if (!legacyImport) return;
    const mergeById = (existing, incoming) => {
      const ids = new Set(existing.map(x => x.id));
      return [...existing, ...(incoming || []).filter(x => !ids.has(x.id))];
    };
    setCategories(cs => {
      const ids = new Set(cs.map(c => c.id));
      return [...cs, ...((legacyImport.categories || []).filter(c => !ids.has(c.id)))];
    });
    setCategoryCounter(c => Math.max(c, legacyImport.categoryCounter || 0));
    setTasks(ts => mergeById(ts, legacyImport.tasks));
    setMeetings(ms => mergeById(ms, legacyImport.meetings));
    setQuickLinks(qs => mergeById(qs, legacyImport.quickLinks));
    setLinkTags(tags => Array.from(new Set([...tags, ...(legacyImport.linkTags || [])])));
    setPendingMeetings(ps => mergeById(ps, legacyImport.pendingMeetings));
    setPlannedMeetings(pm => mergeById(pm, legacyImport.plannedMeetings));
    // The save effect (keyed on `loaded`/`session`) will push the merged result to
    // Supabase automatically once these state updates land.
    localStorage.removeItem('control-centre-state');
    setLegacyImport(null);
  }
  function discardLegacyData(){
    localStorage.removeItem('control-centre-state');
    setLegacyImport(null);
  }

  /* ---------- Sub-tasks ---------- */
  function addSubtask(taskId, title, startDate, endDate, estimatedDuration){
    setTasks(ts => ts.map(t => {
      if (t.id !== taskId) return t;
      const subtasks = [...(t.subtasks || []), {
        id: uid(), title, done: false,
        startDate: startDate || '', endDate: endDate || '',
        estimatedDuration: estimatedDuration || 0
      }];
      const rolled = rollUpTaskDates(subtasks);
      return { ...t, subtasks, ...(rolled || {}) };
    }));
  }
  function toggleSubtask(taskId, subId){
    setTasks(ts => ts.map(t => (t.id !== taskId ? t : { ...t, subtasks: (t.subtasks || []).map(s => (s.id === subId ? { ...s, done: !s.done } : s)) })));
  }
  function updateSubtask(taskId, subId, patch){
    setTasks(ts => ts.map(t => {
      if (t.id !== taskId) return t;
      const subtasks = (t.subtasks || []).map(s => (s.id === subId ? { ...s, ...patch } : s));
      const rolled = rollUpTaskDates(subtasks);
      return { ...t, subtasks, ...(rolled || {}) };
    }));
  }
  function deleteSubtask(taskId, subId){
    setTasks(ts => ts.map(t => {
      if (t.id !== taskId) return t;
      const subtasks = (t.subtasks || []).filter(s => s.id !== subId);
      const rolled = subtasks.length > 0 ? rollUpTaskDates(subtasks) : null;
      return { ...t, subtasks, ...(rolled || {}) };
    }));
  }

  /* ---------- Derived stats ---------- */
  const today = todayISO();
  const realMonday = getMonday(new Date());
  const realParity = getParity(realMonday);
  const todayIdx = (new Date().getDay() + 6) % 7;
  const meetingsToday = meetings.filter(m => m.weekday === todayIdx && (m.cadence === 'weekly' || m.parity === realParity)).length
    + plannedMeetings.filter(m => m.date === today && m.kind !== 'focus').length
    + googleEvents.map(normalizeGoogleEvent).filter(m => m.date === today).length;
  const tasksDueToday = tasks.filter(t => t.status !== 'done' && taskIsDueTodayOrOverdue(t, today)).length;
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

  const normalizedGoogleEvents = googleEvents.map(normalizeGoogleEvent);
  const allMeetingsForLookup = [...plannedMeetings, ...normalizedGoogleEvents];

  const prepReminders = tasks
    .filter(t => t.meetingId && t.status !== 'done')
    .map(t => {
      const meeting = allMeetingsForLookup.find(m => m.id === t.meetingId);
      if (!meeting) return null;
      const hours = getWorkingHours(workingHours, defaultWorkingHours, meeting.date);
      const info = getPrepReminderStatus(meeting, hours);
      return info && info.active ? { task: t, meeting } : null;
    })
    .filter(Boolean);

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
          <p className="topbar__eyebrow">{greeting}</p>
          <h1 className="topbar__title">{getFirstNameFromEmail(session.user.email)}'s Control Centre</h1>
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
          <button className={`btn${settings.notificationsEnabled ? ' btn--amber' : ' btn--ghost'}`} onClick={toggleNotifications} title="Toggle browser notifications">
            {settings.notificationsEnabled ? '🔔 On' : '🔕 Off'}
          </button>
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

          <section className="panel" style={{ textAlign: 'center' }}>
            <button className="btn btn--amber" onClick={() => planMyDay('manual')}>&#10022; Plan my day</button>
          </section>

          <section className="stats-strip">
            <StatChip label="Meetings today" value={meetingsToday} tone="amber" onClick={() => setActiveTab('calendar')} />
            <StatChip label="Tasks due today" value={tasksDueToday} tone="cyan" onClick={() => setActiveTab('tasks')} />
            <StatChip label="At risk" value={atRiskCount} tone="red" onClick={() => setActiveTab('tasks')} />
            <StatChip label="Tasks done" value={doneCount} tone="green" onClick={() => setActiveTab('tasks')} />
          </section>

          <ProgressPanel dailyProgress={dailyProgress} weeklyProgress={weeklyProgress} timeElapsedPercent={timeElapsedPercent} weekElapsedPercent={weekElapsedPercent} />

          <StickyNotesPanel notes={stickyNotes} onAdd={addStickyNote} onDelete={deleteStickyNote} onFile={setFilingNoteId} />

          <IdeaBoardPanel notes={ideaNotes} onAdd={addIdeaNote} onDelete={deleteIdeaNote} />

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

          {prepReminders.length > 0 && (
            <section className="panel deadlines-panel">
              <div className="panel__head" style={{ marginBottom: 8 }}>
                <p className="panel__eyebrow">Meeting Prep</p>
              </div>
              <div className="deadlines-strip">
                {prepReminders.map(({ task, meeting }) => (
                  <div key={task.id} className="deadline-chip" style={{ '--dchip-color': 'var(--amber)' }}
                    onClick={() => goToTask(task.id)} role="button" tabIndex={0}>
                    <span className="deadline-chip__title">{task.title}</span>
                    <span className="deadline-chip__when">Before "{meeting.title}" &middot; {meeting.time}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="overview-cards">
            <TodayMeetingsCard
              meetings={meetings}
              plannedMeetings={plannedMeetings}
              googleEvents={normalizedGoogleEvents}
              pendingMeetings={pendingMeetings}
              todayIdx={todayIdx}
              realParity={realParity}
              onClickMeeting={() => setActiveTab('calendar')}
              meetingTypes={meetingTypes}
            />
            <TodayTasksCard
              tasks={tasks}
              categories={categories}
              onClickTask={goToTask}
            />
            <TodayFocusCard
              plannedMeetings={plannedMeetings}
              onClickFocus={setMeetingDetailId}
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
            meetingTypes={meetingTypes}
          />
          <ScheduleBoard
            meetings={meetings}
            pendingMeetings={pendingMeetings}
            plannedMeetings={plannedMeetings}
            googleEvents={normalizedGoogleEvents}
            tasks={tasks}
            meetingTypes={meetingTypes}
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
            onAddMeetingType={addMeetingType}
            onDeleteMeetingType={deleteMeetingType}
          />
          <GoogleCalendarSyncPanel
            url={settings.googleCalendarUrl}
            syncStatus={googleSyncStatus}
            syncError={googleSyncError}
            eventCount={googleEvents.length}
            onSave={url => setSettings(s => ({ ...s, googleCalendarUrl: url }))}
            onUnlink={() => { setSettings(s => ({ ...s, googleCalendarUrl: '' })); setGoogleEvents([]); }}
            onSyncNow={syncGoogleCalendar}
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
            onToggleSubtask={toggleSubtask}
          />
        </React.Fragment>
      )}

      {activeTab === 'quicklinks' && (
        <DocLibraryPanel
          links={quickLinks}
          linkTags={linkTags}
          onAdd={addQuickLink}
          onDelete={deleteQuickLink}
          onAddTag={addLinkTag}
          onDeleteTag={deleteLinkTag}
          onRetag={retagQuickLink}
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
          onAddSubtask={(title, s, e, dur) => addSubtask(detailTaskId, title, s, e, dur)}
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

      {meetingDetailId && (() => {
        const selected = allMeetingsForLookup.find(m => m.id === meetingDetailId);
        if (selected && selected.kind === 'focus') {
          return (
            <FocusTimeModal
              task={tasks.find(t => t.id === selected.taskId) || { title: (selected.title || '').replace(/^Focus: /, '') }}
              initial={{ date: selected.date, time: selected.time, duration: selected.duration }}
              onClose={() => setMeetingDetailId(null)}
              onSave={(date, time, duration) => { updatePlannedMeeting(meetingDetailId, { date, time, duration }); setMeetingDetailId(null); }}
              onDelete={() => { deletePlannedMeeting(meetingDetailId); setMeetingDetailId(null); }}
            />
          );
        }
        return (
          <MeetingDetailModal
            meeting={selected}
            tasks={tasks}
            categories={categories}
            meetingTypes={meetingTypes}
            onClose={() => setMeetingDetailId(null)}
            onUpdate={patch => { if (!meetingDetailId.startsWith('google-')) updatePlannedMeeting(meetingDetailId, patch); }}
            onDelete={() => { if (!meetingDetailId.startsWith('google-')) deletePlannedMeeting(meetingDetailId); }}
            onAddPrepTask={addPrepTask}
            onTogglePrepTask={togglePrepTask}
            onDeletePrepTask={deleteTask}
            onOpenTask={taskId => { setMeetingDetailId(null); setDetailTaskId(taskId); }}
          />
        );
      })()}

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

      {dayPlanPreview && (
        <DayPlanModal
          preview={dayPlanPreview}
          categories={categories}
          variant={dayPlanPreview.variant}
          onApply={applyDayPlanPreview}
          onClose={() => setDayPlanPreview(null)}
          onGoToTask={goToTaskFromPlan}
          onDelay={delayDayPlanTask}
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
        <EndOfDayModal notes={stickyNotes} onClose={closeEodModal} onFile={setFilingNoteId} />
      )}

      {filingNoteId && (
        <FileNoteModal
          note={stickyNotes.find(n => n.id === filingNoteId)}
          meetings={plannedMeetings.filter(m => m.kind === 'meeting').sort((a, b) => (a.date || '').localeCompare(b.date || ''))}
          categories={categories}
          onClose={() => setFilingNoteId(null)}
          onFileTask={categoryId => fileNoteAsTask(filingNoteId, categoryId)}
          onFilePrepTask={(meetingId, categoryId) => fileNoteAsPrepTask(filingNoteId, meetingId, categoryId)}
          onFileAgenda={meetingId => fileNoteAsAgenda(filingNoteId, meetingId)}
        />
      )}

      {legacyImport && (
        <LegacyImportModal data={legacyImport} onImport={importLegacyData} onDiscard={discardLegacyData} />
      )}

      <ChatPanel
        open={chatOpen}
        onToggle={() => setChatOpen(o => !o)}
        messages={chatMessages}
        loading={chatLoading}
        error={chatError}
        confirmations={chatConfirmations}
        onAccept={id => resolveChatConfirmation(id, true)}
        onReject={id => resolveChatConfirmation(id, false)}
        input={chatInput}
        onInputChange={setChatInput}
        onSend={sendChatMessage}
        hasApiKey={hasApiKey}
        onOpenApiKeyModal={() => setApiKeyModalOpen(true)}
      />

      <ApiKeyModal
        open={apiKeyModalOpen}
        onClose={() => { setApiKeyModalOpen(false); setApiKeyError(''); }}
        onSave={saveAnthropicKey}
        onRemove={removeAnthropicKey}
        hasKey={!!hasApiKey}
        busy={apiKeyBusy}
        error={apiKeyError}
      />

      <p className="footnote">Synced to your account, private to {session.user.email} · a connected Google Calendar embed is only as private as your calendar's own sharing settings</p>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
