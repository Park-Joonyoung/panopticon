const $ = id => document.getElementById(id);
let count = 0, paidCount = 0;
const seen = new Set();
let currentVideo = null;
let unreadOnly = false;
let nameFilterEnabled = false;
let searchMode = 'person';
const superChatRows = new Map();
const superChatRecords = new Map();
const paidRowNodes = new Map();
let paidSort = 'time';
let paidDescending = false;
function paidTime(chat) {
  if (typeof chat.timestamp === 'number' && Number.isFinite(chat.timestamp)) return chat.timestamp;
  const value = Date.parse((chat.time || '').replace(' ', 'T'));
  return Number.isFinite(value) ? value : null;
}
function paidAmount(chat) {
  if (typeof chat.amountValue === 'number' && Number.isFinite(chat.amountValue)) return chat.amountValue;
  // Earlier records only contain the displayed amount string.
  let text = (chat.amount || '').replace(/[^\d.,]/g, '');
  if (!text) return null;
  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    text = comma > dot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  } else if (comma >= 0) {
    text = /^\d{1,3}(,\d{3})+$/.test(text) ? text.replace(/,/g, '') : text.replace(',', '.');
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}
function comparePaid(a, b) {
  const getValue = paidSort === 'amount' ? paidAmount : paidTime;
  const left = getValue(a), right = getValue(b);
  // Records with unknown values always stay at the end.
  if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
  return (left - right) * (paidDescending ? -1 : 1);
}
function sortedSuperChats() {
  return [...superChatRecords.values()].sort(comparePaid);
}
function insertPaidRow(feed, row, data) {
  let low = 0, high = feed.children.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const existing = superChatRecords.get(feed.children[middle].dataset.chatId);
    if (comparePaid(data, existing) < 0) high = middle;
    else low = middle + 1;
  }
  feed.insertBefore(row, feed.children[low] || null);
}
function updatePaidSort() {
  $('sort-paid-time').setAttribute('aria-pressed', String(paidSort === 'time'));
  $('sort-paid-amount').setAttribute('aria-pressed', String(paidSort === 'amount'));
  $('sort-paid-direction').textContent = paidDescending ? '내림차순 ↓' : '오름차순 ↑';
  $('sort-paid-direction').setAttribute('aria-pressed', String(paidDescending));
  $('sort-paid-direction').setAttribute('aria-label', paidDescending ? '오름차순으로 전환' : '내림차순으로 전환');
  const feed = $('paid');
  const scroll = feed.scrollTop;
  for (const record of sortedSuperChats()) {
    const row = paidRowNodes.get(record.id);
    if (row) feed.append(row);
  }
  feed.scrollTop = scroll;
}
const authorNames = new Set();
let suggestedNames = [];
let activeSuggestion = -1;
function normalizeName(name) {
  return name.normalize('NFC').trim().toLocaleLowerCase('ko-KR');
}
function closeSuggestions() {
  $('name-suggestions').hidden = true;
  if (searchMode === 'person') $('filter-name').setAttribute('aria-expanded', 'false');
  else $('filter-name').removeAttribute('aria-expanded');
  $('filter-name').removeAttribute('aria-activedescendant');
  activeSuggestion = -1;
}
function selectSuggestion(name) {
  $('filter-name').value = name;
  closeSuggestions();
  if (nameFilterEnabled) applyFilters();
}
function showSuggestions() {
  const query = normalizeName($('filter-name').value);
  const list = $('name-suggestions');
  list.replaceChildren();
  closeSuggestions();
  if (searchMode !== 'person') { suggestedNames = []; return; }
  suggestedNames = query ? [...authorNames]
    .filter(name => normalizeName(name).includes(query))
    .sort((a, b) => a.localeCompare(b, 'ko')) : [];
  if (!suggestedNames.length || document.activeElement !== $('filter-name')) return;
  suggestedNames.forEach((name, index) => {
    const option = document.createElement('li');
    option.id = `name-option-${index}`;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    option.textContent = name;
    option.onpointerdown = event => {
      if (event.button !== 0) return;
      event.preventDefault();
      selectSuggestion(name);
    };
    list.append(option);
  });
  list.hidden = false;
  $('filter-name').setAttribute('aria-expanded', 'true');
}
function rememberAuthor(name) {
  if (!name || authorNames.has(name)) return false;
  authorNames.add(name);
  return true;
}
function applyRowFilter(row, feed) {
  const query = normalizeName($('filter-name').value);
  const target = searchMode === 'person' ? row.dataset.author : row.dataset.message;
  const searchMismatch = nameFilterEnabled && query && !normalizeName(target).includes(query);
  const hideRead = feed.id === 'paid' && unreadOnly && row.classList.contains('is-read');
  row.hidden = !!(searchMismatch || hideRead);
}
function applyFilters() {
  for (const feed of [$('chats'), $('paid')]) {
    for (const row of feed.querySelectorAll('.chat')) applyRowFilter(row, feed);
  }
}
function setReadState(id, read) {
  const record = superChatRecords.get(id);
  if (record) record.read = read;
  for (const item of superChatRows.get(id) || []) {
    item.row.classList.toggle('is-read', read);
    item.checkbox.checked = read;
  }
  applyFilters();
}
async function saveRead(id, checkbox) {
  const video = currentVideo;
  const previous = checkbox.closest('.paid').classList.contains('is-read');
  checkbox.disabled = true;
  try {
    const query = new URLSearchParams({ video, id, read: String(checkbox.checked) });
    const result = await fetch(`/read?${query}`, { method: 'POST' });
    if (!result.ok) throw new Error(await result.text());
  } catch (error) {
    if (currentVideo === video) checkbox.checked = previous;
    setStatus(error.message, 'error');
  } finally { checkbox.disabled = false; }
}
function setStatus(message, state = 'idle') { $('status').textContent = message; $('status').dataset.state = state; }
function imageUrl(value) { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; } }
function renderChat(data) {
  const row = document.createElement('article'); row.className = 'chat' + (data.type === 'superChat' ? ' paid' : '');
  row.dataset.author = data.name || '';
  row.dataset.chatId = data.id;
  row.dataset.message = data.message || '';
  const fallback = document.createElement('span'); fallback.className = 'avatar'; fallback.textContent = (data.name || '?').slice(0, 1);
  const avatarUrl = imageUrl(data.avatar);
  if (avatarUrl) {
    const avatar = document.createElement('img'); avatar.className = 'avatar'; avatar.src = avatarUrl; avatar.alt = `${data.name} 프로필`; avatar.referrerPolicy = 'no-referrer';
    avatar.onerror = () => avatar.replaceWith(fallback); row.append(avatar);
  } else row.append(fallback);
  const content = document.createElement('div'); content.className = 'content';
  const meta = document.createElement('div'); meta.className = 'meta';
  const name = document.createElement('span'); name.className = 'name'; name.textContent = data.name;
  const time = document.createElement('time'); time.textContent = (data.time || '').split(' ').pop();
  meta.append(name, time);
  if (data.type === 'superChat') {
    const label = document.createElement('label'); label.className = 'read-control';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = !!data.read;
    checkbox.onchange = () => saveRead(data.id, checkbox);
    label.append(checkbox, document.createTextNode('읽음')); meta.append(label);
    row.classList.toggle('is-read', !!data.read);
    if (!superChatRows.has(data.id)) superChatRows.set(data.id, []);
    superChatRows.get(data.id).push({ row, checkbox });
  }
  content.append(meta);
  if (data.amount) { const amount = document.createElement('div'); amount.className = 'amount'; amount.textContent = data.amount; content.append(amount); }
  const message = document.createElement('div'); message.className = 'message';
  const parts = Array.isArray(data.parts) && data.parts.length ? data.parts : [data.message || ''];
  for (const part of parts) {
    if (typeof part === 'string') message.append(document.createTextNode(part));
    else if (part && typeof part === 'object') {
      const src = imageUrl(part.url);
      if (src) { const emoji = document.createElement('img'); emoji.className = 'emoji'; emoji.src = src; emoji.alt = part.txt || '이모티콘'; emoji.referrerPolicy = 'no-referrer'; emoji.onerror = () => emoji.replaceWith(document.createTextNode(emoji.alt)); message.append(emoji); }
      else message.append(document.createTextNode(part.txt || ''));
    }
  }
  content.append(message); row.append(content); return row;
}
function append(feed, data) {
  feed.querySelector('.empty')?.remove();
  const row = renderChat(data);
  applyRowFilter(row, feed);
  if (feed.id === 'paid') {
    paidRowNodes.set(data.id, row);
    insertPaidRow(feed, row, data);
  } else feed.append(row);
  if ($('autoscroll').checked && !row.hidden) {
    feed.scrollTop = feed.id === 'paid' ? row.offsetTop : feed.scrollHeight;
  }
}
function receive(data) {
  if (data.event === 'status') { setStatus(data.message, data.state); return; }
  if (data.event === 'read') {
    if (data.video === currentVideo) setReadState(data.id, data.read);
    return;
  }
  if (data.event === 'history') {
    currentVideo = data.video;
    superChatRows.clear();
    superChatRecords.clear();
    paidRowNodes.clear();
    $('chats').replaceChildren();
    $('paid').replaceChildren();
    seen.clear();
    authorNames.clear();
    for (const chat of data.chats) {
      rememberAuthor(chat.name);
      append($('chats'), chat);
      seen.add(chat.id);
    }
    for (const chat of data.paid) {
      superChatRecords.set(chat.id, { ...chat });
      append($('paid'), chat);
    }
    $('export-paid').disabled = superChatRecords.size === 0;
    count = data.count;
    paidCount = data.paidCount;
    $('chat-count').textContent = `${count}개 감시`;
    $('paid-count').textContent = `${paidCount}개 감시`;
    if (data.video) $('video').value = `https://www.youtube.com/watch?v=${data.video}`;
    showSuggestions();
    return;
  }
  if (data.event !== 'chat' || (data.id && seen.has(data.id))) return;
  if (data.id) seen.add(data.id);
  if (rememberAuthor(data.name) && document.activeElement === $('filter-name')) showSuggestions();
  append($('chats'), data); $('chat-count').textContent = `${++count}개 감시`;
  if (data.type === 'superChat') {
    superChatRecords.set(data.id, { ...data });
    $('export-paid').disabled = false;
    append($('paid'), data); $('paid-count').textContent = `${++paidCount}개 감시`;
  }
}
function csvCell(value) {
  let text = String(value ?? '');
  // Prevent user-written text from being interpreted as a spreadsheet formula.
  if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
function superChatsCsv(video, records) {
  const rows = [['영상 ID', '시간', '닉네임', '금액', '메시지', '읽음', '채팅 ID']];
  for (const chat of records) {
    rows.push([video, chat.time, chat.name, chat.amount, chat.message,
      chat.read ? '읽음' : '안 읽음', chat.id]);
  }
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
$('export-paid').onclick = () => {
  if (!currentVideo || !superChatRecords.size) return;
  try {
    const csv = superChatsCsv(currentVideo, sortedSuperChats());
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `superchats_${currentVideo}_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    document.body.append(link);
    try { link.click(); }
    finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  } catch (error) { setStatus(`슈퍼챗 내보내기 실패: ${error.message}`, 'error'); }
};
async function action(endpoint) {
  if (location.protocol === 'file:') { setStatus('실제 감시는 node server.js 실행 후 로컬 주소에서 사용할 수 있어요.', 'error'); return; }
  const buttons = [...$('controls').querySelectorAll('button')]; buttons.forEach(b => b.disabled = true);
  try { const result = await fetch(endpoint, { method: 'POST' }); if (!result.ok) throw new Error(await result.text()); }
  catch (error) { setStatus(error.message, 'error'); }
  finally { buttons.forEach(b => b.disabled = false); }
}
$('controls').onsubmit = event => { event.preventDefault(); action(`/start?video=${encodeURIComponent($('video').value.trim())}`); };
$('stop').onclick = () => action('/stop');
function setPaidFilter(onlyUnread) {
  unreadOnly = onlyUnread;
  $('show-unread').setAttribute('aria-pressed', String(onlyUnread));
  $('show-all').setAttribute('aria-pressed', String(!onlyUnread));
  applyFilters();
}
$('show-unread').onclick = () => setPaidFilter(true);
$('show-all').onclick = () => setPaidFilter(false);
$('sort-paid-time').onclick = () => { paidSort = 'time'; updatePaidSort(); };
$('sort-paid-amount').onclick = () => { paidSort = 'amount'; updatePaidSort(); };
$('sort-paid-direction').onclick = () => { paidDescending = !paidDescending; updatePaidSort(); };
function setSearchMode(mode) {
  searchMode = mode;
  const person = mode === 'person';
  $('search-content').setAttribute('aria-pressed', String(!person));
  $('search-person').setAttribute('aria-pressed', String(person));
  const input = $('filter-name');
  const label = person ? '버섯이끼 이름 검색' : '채팅 내용 검색';
  input.placeholder = label;
  input.setAttribute('aria-label', label);
  input.setAttribute('role', person ? 'combobox' : 'searchbox');
  if (person) {
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', 'name-suggestions');
  } else {
    input.removeAttribute('aria-autocomplete');
    input.removeAttribute('aria-controls');
  }
  closeSuggestions();
  if (nameFilterEnabled) applyFilters();
}
$('search-content').onclick = () => setSearchMode('content');
$('search-person').onclick = () => setSearchMode('person');
$('name-filter').onsubmit = event => {
  event.preventDefault();
  if (!nameFilterEnabled && !normalizeName($('filter-name').value)) {
    $('filter-name').focus();
    return;
  }
  nameFilterEnabled = !nameFilterEnabled;
  closeSuggestions();
  const button = $('toggle-name-filter');
  const label = nameFilterEnabled ? '검색 필터 끄기' : '검색 필터 켜기';
  button.setAttribute('aria-pressed', String(nameFilterEnabled));
  button.setAttribute('aria-label', label);
  button.title = label;
  applyFilters();
};
$('filter-name').oninput = () => {
  showSuggestions();
  if (nameFilterEnabled) applyFilters();
};
$('filter-name').onfocus = showSuggestions;
$('filter-name').onblur = closeSuggestions;
$('filter-name').onkeydown = event => {
  if (searchMode !== 'person' || event.isComposing || event.keyCode === 229) return;
  const list = $('name-suggestions');
  if (event.key === 'Escape') {
    event.preventDefault();
    closeSuggestions();
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (list.hidden) showSuggestions();
    if (list.hidden) return;
    if (activeSuggestion < 0) activeSuggestion = event.key === 'ArrowDown' ? 0 : suggestedNames.length - 1;
    else activeSuggestion = (activeSuggestion + (event.key === 'ArrowDown' ? 1 : -1) + suggestedNames.length) % suggestedNames.length;
    [...list.children].forEach((option, index) => option.setAttribute('aria-selected', String(index === activeSuggestion)));
    const option = list.children[activeSuggestion];
    $('filter-name').setAttribute('aria-activedescendant', option.id);
    option.scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter' && !list.hidden && activeSuggestion >= 0) {
    event.preventDefault();
    selectSuggestion(suggestedNames[activeSuggestion]);
  }
};
if (location.protocol === 'file:') setStatus('node server.js 실행 후 http://127.0.0.1:3000에서 열어 주세요.');
else {
  const events = new EventSource('/events');
  events.onmessage = event => { try { receive(JSON.parse(event.data)); } catch { setStatus('채팅 데이터를 표시하지 못했습니다.', 'error'); } };
  events.onerror = () => setStatus('로컬 서버 연결 끊김 · 재연결 중…', 'error');
}
