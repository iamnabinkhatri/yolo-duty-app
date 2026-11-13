const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dateKey = date => date.toISOString().slice(0, 10);
const parseDate = key => new Date(`${key}T12:00:00Z`);
const today = (() => { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); const p = Object.fromEntries(parts.map(p => [p.type, p.value])); return `${p.year}-${p.month}-${p.day}`; })();
const dateFormat = (key, options) => parseDate(key).toLocaleDateString('en-US', { timeZone: 'UTC', ...options });
const state = { month: today.slice(0, 7), selected: today, players: [], duties: [], schedules: [], roster: null, config: {}, loading: true, error: '', view: 'calendar' };
let removing = null, toastTimer;
async function api(path, options = {}) {
  const response = await fetch(`/api/${path}`, { ...options, cache: 'no-store', headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status}).`);
  }
  return data;
}
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => $('toast').hidden = true, 4000); }
function schedule(date) { return state.schedules.find(s => s.weekday === parseDate(date).getUTCDay()); }
function rows(date = state.selected) { return state.duties.filter(d => d.game_date === date); }
function itemIcon(item) { return /coffee|tea/i.test(item) ? '♨' : /donut/i.test(item) ? '◎' : /water/i.test(item) ? '◈' : '◇'; }
function initials(name) { return name.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase(); }
function nextGame(from = today) { for (let i = 0; i < 7; i++) { const d = parseDate(from); d.setUTCDate(d.getUTCDate() + i); if (schedule(dateKey(d))) return dateKey(d); } return from; }
function renderNotice() {
  const notices = [];
  if (state.error) notices.push(state.error);
  if (state.config.storage === 'local') notices.push('Local preview · assignments are saved on this computer. Connect Supabase before deploying for shared duties.');
  if (state.config.storage === 'unconfigured') notices.push('Shared calendar storage is not connected yet. Add the Supabase environment variables in Vercel.');
  if (state.roster?.stale) notices.push(`Showing the last synced roster. ${state.roster.warning || 'Sync will retry shortly.'}`);
  $('notice').textContent = notices.join(' '); $('notice').hidden = notices.length === 0;
}
function renderHeader() {
  const s = schedule(state.selected), duties = rows();
  $('game-label').textContent = s ? `YOLO ${s.label.toUpperCase()} PICKUP` : 'GAME-DAY DUTIES';
  $('game-title').textContent = dateFormat(state.selected, { weekday: 'long', month: 'short', day: 'numeric' });
  const [hour, minute] = (s?.time || '00:00').split(':').map(Number);
  $('game-meta').textContent = s ? `@ ${s.location} · ${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}` : 'Choose any day to plan the little extras.';
  const coverage = ['coffee', 'donut', 'snack'].filter(item => duties.some(d => d.item.toLowerCase().includes(item))).length;
  $('coverage-label').textContent = coverage === 3 ? 'GAME-DAY EXTRAS COVERED' : `${coverage} OF 3 COVERED`;
  $('coverage-bar').style.width = `${coverage / 3 * 100}%`;
  $('coverage-hint').textContent = coverage === 3 ? 'Thanks for taking care of the squad.' : 'Coffee, donuts & snacks';
  $('day-label').textContent = dateFormat(state.selected, { weekday: 'long' });
  $('day-date').textContent = dateFormat(state.selected, { month: 'long', day: 'numeric', year: 'numeric' });
}
function renderCalendar() {
  $('month-label').textContent = dateFormat(`${state.month}-01`, { month: 'long', year: 'numeric' });
  const start = parseDate(`${state.month}-01`); start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  let html = '<table aria-label="Game-day duty calendar"><thead><tr>' + ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map(d => `<th scope="col">${d}</th>`).join('') + '</tr></thead><tbody>';
  for (let week = 0; week < 6; week++) {
    html += '<tr>';
    for (let day = 0; day < 7; day++) {
      const date = new Date(start); date.setUTCDate(start.getUTCDate() + week * 7 + day);
      const key = dateKey(date), game = schedule(key), count = rows(key).length, outside = !key.startsWith(state.month);
      html += `<td><button data-date="${key}" class="${outside ? 'outside' : ''} ${key === today ? 'today' : ''}" aria-pressed="${key === state.selected}" aria-label="${esc(dateFormat(key, { weekday: 'long', month: 'long', day: 'numeric' }))}${game ? ', game day' : ''}, ${count} duties" ${outside ? 'disabled' : ''}><span class="date-number">${date.getUTCDate()}</span>${game && !outside ? '<span class="game-tag">PICKUP</span>' : '<span class="game-tag placeholder">PICKUP</span>'}<span class="duty-dots">${'<i></i>'.repeat(Math.min(count, 4))}</span></button></td>`;
    }
    html += '</tr>';
  }
  $('calendar').innerHTML = html + '</tbody></table>';
  const dates = [...new Set(state.duties.map(d => d.game_date))].sort();
  $('month-list').innerHTML = dates.length ? dates.map(date => `<button class="list-day" data-date="${date}"><strong>${esc(dateFormat(date, { weekday: 'short', month: 'short', day: 'numeric' }))}</strong><span>${rows(date).map(d => `${esc(d.item)} — ${esc(d.player_name)}${d.status === 'done' ? ' ✓' : ''}`).join('<br>')}</span></button>`).join('') : '<p class="empty-list">No duties assigned this month.<br>Choose a game day to get started.</p>';
  $('calendar').hidden = state.view !== 'calendar'; $('month-list').hidden = state.view !== 'list';
  for (const view of ['calendar', 'list']) { $(`${view}-view`).classList.toggle('active', state.view === view); $(`${view}-view`).setAttribute('aria-pressed', state.view === view); }
}
function renderAssignments() {
  const assigned = rows();
  const entries = assigned.map(d => `<div class="duty-row"><span class="item-symbol" aria-hidden="true">${itemIcon(d.item)}</span><div class="duty-info"><h3>${esc(d.item)}</h3><p class="person"><span class="avatar">${esc(initials(d.player_name))}</span>${esc(d.player_name)}</p>${d.note ? `<p class="note">${esc(d.note)}</p>` : ''}<p class="status">${d.status === 'done' ? '✓ BROUGHT & SHARED' : 'ASSIGNED'}</p><div class="duty-actions"><button data-toggle="${d.id}" data-status="${d.status === 'done' ? 'assigned' : 'done'}">${d.status === 'done' ? 'Mark pending' : 'Mark brought'}</button><button data-reassign="${d.id}">Reassign</button><button class="remove" data-remove="${d.id}" aria-label="Remove ${esc(d.item)} assignment">×</button></div></div></div>`);
  for (const item of ['Coffee', 'Donuts', 'Snacks']) if (!assigned.some(d => d.item.toLowerCase().includes(item.toLowerCase().replace(/s$/, '')))) entries.push(`<div class="duty-row unassigned-row"><span class="item-symbol" aria-hidden="true">${itemIcon(item)}</span><div class="duty-info"><h3>${item}</h3><p class="unassigned">Not assigned yet</p><div class="duty-actions"><button data-assign="${item}">＋ Assign someone</button></div></div></div>`);
  $('assignments').innerHTML = state.loading ? '<p class="empty-list">Loading game-day duties…</p>' : entries.join('');
}
function renderRoster() {
  const q = $('player-search').value.trim().toLowerCase();
  $('roster-count').textContent = state.players.length;
  const players = state.players.filter(p => p.name.toLowerCase().includes(q));
  $('roster').innerHTML = players.length ? players.map(p => `<div class="roster-person"><span class="avatar">${esc(initials(p.name))}</span><span>${esc(p.name)}<small>${p.kind === 'guest' ? 'Game guest' : 'YOLO squad'}</small></span></div>`).join('') : '<p class="muted">No matching players.</p>';
  const selected = $('duty-player').value;
  $('duty-player').innerHTML = '<option value="">Choose a teammate…</option>' + state.players.map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.kind === 'guest' ? ' (guest)' : ''}</option>`).join('');
  $('duty-player').value = selected;
  $('sync-status').textContent = state.roster ? `${state.roster.stale ? 'Last successful sync' : 'Synced from the original YOLO website'} · ${new Date(state.roster.syncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. ${state.roster.guestsSynced ? 'Includes server-saved game guests from the last 90 days.' : 'Guest sync unavailable; showing published players.'} Roster refreshes every 5 minutes. Browser-only players cannot sync.` : 'Roster is unavailable. Try syncing again.';
}
function render() { renderNotice(); renderHeader(); renderCalendar(); renderAssignments(); }
async function refreshDuties() {
  const month = state.month;
  try { const data = await api(`duties?month=${month}`); if (state.month !== month) return; state.duties = data.duties; state.error = ''; }
  catch (error) { if (state.month === month) state.error = error.message; }
  finally { if (state.month === month) { state.loading = false; render(); } }
}
async function refreshRoster(force = false) {
  const data = await api(`roster${force ? '?refresh=1' : ''}`);
  state.roster = data; state.players = data.players; state.schedules = data.schedules;
  renderRoster(); render();
}
function assign(item = 'Coffee', reassign = null) {
    $('duty-form').reset(); $('duty-error').textContent = ''; $('duty-date').value = state.selected; $('custom-label').hidden = true; $('custom-item').required = false;
    $('duty-form').dataset.edit = reassign?.id || ''; $('duty-date').disabled = !!reassign;
    if (reassign) {
      $('duty-player').value = reassign.player_id; $('duty-note').value = reassign.note;
      item = reassign.item;
    }
    const choices = [...document.querySelectorAll('input[name="duty-items"]')];
    const custom = !choices.some(choice => choice.value === item);
    choices.forEach(choice => { choice.checked = choice.value === (custom ? 'custom' : item); choice.disabled = !!reassign; });
    if (custom) { $('custom-item').value = item; $('custom-label').hidden = false; $('custom-item').required = !reassign; }
    $('custom-item').disabled = !!reassign;
    $('duty-dialog').showModal();
}
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
$('duty-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  const editing = event.target.dataset.edit;
  const selectedItems = [...document.querySelectorAll('input[name="duty-items"]:checked')].map(choice => choice.value);
  const items = selectedItems.filter(item => item !== 'custom');
  if (selectedItems.includes('custom')) items.push(...$('custom-item').value.split(',').map(item => item.trim()).filter(Boolean));
  if (!editing && (items.length < 1 || items.length > 10)) { $('duty-error').textContent = 'Choose between 1 and 10 items.'; button.disabled = false; return; }
  const payload = editing ? { player_id: $('duty-player').value, note: $('duty-note').value } : { game_date: $('duty-date').value, player_id: $('duty-player').value, items, note: $('duty-note').value };
  try { await api(`duties${editing ? `/${editing}` : ''}`, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload) }); state.selected = $('duty-date').value; state.month = state.selected.slice(0, 7); $('duty-dialog').close(); await refreshDuties(); toast('Duty assignment saved.'); }
  catch (error) { $('duty-error').textContent = error.message; }
  finally { button.disabled = false; }
});
$('custom-choice').addEventListener('change', () => { $('custom-label').hidden = !$('custom-choice').checked; $('custom-item').required = $('custom-choice').checked; });
for (const id of ['add-duty', 'day-add']) $(id).addEventListener('click', () => assign());
$('assignments').addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.assign) return assign(button.dataset.assign);
  if (button.dataset.reassign) return assign('', state.duties.find(d => d.id === button.dataset.reassign));
  if (button.dataset.remove) { removing = button.dataset.remove; $('remove-error').textContent = ''; $('remove-dialog').showModal(); return; }
  if (button.dataset.toggle) { button.disabled = true; try { await api(`duties/${button.dataset.toggle}`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.status }) }); await refreshDuties(); } catch (error) { toast(error.message); button.disabled = false; } }
});
$('confirm-remove').addEventListener('click', async event => {
  event.target.disabled = true;
  try { await api(`duties/${removing}`, { method: 'DELETE' }); $('remove-dialog').close(); await refreshDuties(); toast('Assignment removed.'); }
  catch (error) { $('remove-error').textContent = error.message; }
  finally { event.target.disabled = false; }
});
for (const id of ['calendar', 'month-list']) $(id).addEventListener('click', event => { const button = event.target.closest('[data-date]'); if (button) { state.selected = button.dataset.date; render(); } });
for (const [id, direction] of [['previous', -1], ['next', 1]]) $(id).addEventListener('click', () => { const date = parseDate(`${state.month}-01`); date.setUTCMonth(date.getUTCMonth() + direction); const next = dateKey(date); if (!/^20\d\d/.test(next)) return; state.month = next.slice(0, 7); state.selected = next; state.duties = []; state.loading = true; render(); refreshDuties(); });
$('today').addEventListener('click', () => { state.month = today.slice(0, 7); state.selected = today; state.loading = true; render(); refreshDuties(); });
for (const view of ['calendar', 'list']) $(`${view}-view`).addEventListener('click', () => { state.view = view; renderCalendar(); });
$('player-search').addEventListener('input', renderRoster);
$('sync-roster').addEventListener('click', async () => {
  $('sync-roster').disabled = true;
  try { await refreshRoster(true); toast(state.roster.stale ? 'Roster refresh failed; keeping the last synced list.' : 'Player list is up to date.'); }
  catch (error) { toast(error.message); }
  finally { $('sync-roster').disabled = false; }
});
async function init() {
  render();
  try { state.config = await api('config'); } catch (error) { state.error = error.message; }
  try { await refreshRoster(); state.selected = nextGame(); state.month = state.selected.slice(0, 7); }
  catch (error) { state.error = 'Could not sync the original YOLO roster. Please try again shortly.'; toast(state.error); }
  await refreshDuties(); renderRoster(); render();
}
init();
setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]')) refreshDuties(); }, 30000);
setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]')) refreshRoster().catch(() => {}); }, 300000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !document.querySelector('dialog[open]')) { refreshDuties(); refreshRoster().catch(() => {}); } });
