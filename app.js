function compact(iso) {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function venueAddress(item) {
  return [...new Set([item.location, item.address].filter(Boolean))].join('，');
}

function calendarFile(item) {
  const clean = value => value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/[,;]/g, '\\$&');
  function fold(line) {
    let chunks = [''];
    let length = 0;
    const encoder = new TextEncoder();
    for (const char of line) {
      const bytes = encoder.encode(char).length;
      if (length + bytes > 75) {
        chunks.push(' ');
        length = 1;
      }
      chunks[chunks.length - 1] += char;
      length += bytes;
    }
    return chunks.join('\r\n');
  }
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Gathering//Events//ZH', 'BEGIN:VEVENT',
    'UID:' + item.id + '@party-table', 'DTSTAMP:' + compact(new Date().toISOString()),
    'DTSTART:' + compact(item.start), 'DTEND:' + compact(item.end), 'SUMMARY:' + clean(item.title),
    'LOCATION:' + clean(venueAddress(item)), 'DESCRIPTION:' + clean(item.note ?? ''), 'END:VEVENT', 'END:VCALENDAR'
  ].map(fold).join('\r\n') + '\r\n';
}

const main = document.querySelector('#main');
const backendOrigin = document.querySelector('meta[name="gathering-backend"]')?.content || location.origin;
const backendUrl = path => new URL(path, backendOrigin).href;
const editor = document.querySelector('#editor');
const notice = document.querySelector('#notice');
const statuses = { yes: '會到', maybe: '未定', no: '唔到' };
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const currency = new Intl.NumberFormat('en-HK', {
  style: 'currency', currency: 'HKD', currencyDisplay: 'code'
});
const when = new Intl.DateTimeFormat('zh-HK', {
  timeZone: 'Asia/Hong_Kong', dateStyle: 'medium', timeStyle: 'short'
});
const eventLink = id => './?event=' + encodeURIComponent(id);
const money = cents => currency.format(cents / 100);
const device = localStorage.getItem('party-table-device') ??
  Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
localStorage.setItem('party-table-device', device);
const params = new URLSearchParams(location.search);
const id = params.get('event');
let event;
let toastTimeout;
let poll;

async function api(path = '', data) {
  const options = { headers: { 'x-party-device': device } };
  if (data !== undefined) {
    options.method = 'POST';
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(data);
  }
  const response = await fetch(backendUrl('/api/events' + path), options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '連線暫時有問題，請再試。');
  return result;
}

function announce(message) {
  clearTimeout(toastTimeout);
  notice.textContent = message;
  toastTimeout = setTimeout(() => { notice.textContent = ''; }, 4000);
}

function recent() {
  try { return JSON.parse(localStorage.getItem('party-table-recent') ?? '[]'); }
  catch { return []; }
}

function remember(item) {
  const { id, title, start, location } = item;
  localStorage.setItem('party-table-recent', JSON.stringify([
    { id, title, start, location }, ...recent().filter(record => record.id !== id)
  ].slice(0, 12)));
}

function cards(items) {
  return '<div class="cards">' + items.map(item => `
    <a class="card panel" href="${eventLink(item.id)}"><strong>${escape(item.title)}</strong>
    <span>${when.format(new Date(item.start))} · ${escape(item.location)}</span></a>`).join('') + '</div>';
}

async function home() {
  main.innerHTML = `
    <section class="hero" aria-labelledby="headline">
      <div class="hero-content"><div class="eyebrow">廣東話聚會助手</div>
      <h1 id="headline">Gathering</h1>
      <p>整張邀請，睇邊個到，散場一齊夾數。</p>
      <button class="button lime" data-action="create">＋ 建立活動</button></div>
      <div class="art" aria-hidden="true"><span class="ticket back"></span><span class="ticket front">✳</span><b>✷</b><b>✦</b><b>✳</b><i></i><i></i></div>
    </section>
    <section class="features" aria-label="聚會工具">
      <div class="feature"><span class="glyph" aria-hidden="true">✓</span><div><h2>連結即覆</h2><p>朋友打開邀請就可以回覆</p></div></div>
      <div class="feature"><span class="glyph" aria-hidden="true">⊞</span><div><h2>加入日曆</h2><p>支援 Google 日曆同 .ics</p></div></div>
      <div class="feature"><span class="glyph" aria-hidden="true">$</span><div><h2>夾數埋單</h2><p>計清轉帳金額同付款進度</p></div></div>
    </section>
    <section aria-labelledby="activity-title">
      <div class="section-head"><h2 id="activity-title">我嘅活動</h2></div>
      <div id="activities" class="stack" aria-live="polite"><p class="subtle">載入緊活動…</p></div>
    </section>`;
  let owned = [];
  let error = '';
  try { owned = await api(); }
  catch { error = '<p class="error">暫時載入唔到你主辦嘅活動。請重新整理試多次。</p>'; }
  const visited = recent().filter(item => !owned.some(record => record.id === item.id));
  document.querySelector('#activities').innerHTML = error
    + (owned.length ? '<strong>我主辦嘅活動</strong>' + cards(owned) : '')
    + (visited.length ? '<strong>睇過嘅邀請</strong>' + cards(visited) : '')
    + (!error && !owned.length && !visited.length ? `
      <div class="empty panel"><span class="glyph" aria-hidden="true">✳</span>
      <strong>暫時未有活動</strong><p>建立活動，或者打開朋友傳畀你嘅邀請連結。</p></div>` : '');
}

function appleCalendar(item) {
  return backendUrl('/calendar/' + encodeURIComponent(item.id) + '.ics');
}

function mapSearch(query) {
  return 'https://www.google.com/maps/search/?' + new URLSearchParams({ api: '1', query });
}

function mapLink(item) {
  return item.mapUrl || mapSearch(venueAddress(item));
}

function invitationText(item) {
  const date = new Date(item.start);
  const parts = new Intl.DateTimeFormat('zh-HK', {
    timeZone: 'Asia/Hong_Kong', month: 'numeric', day: 'numeric', weekday: 'short',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const link = new URL(eventLink(item.id), location.href);
  const shortcut = action => {
    const target = new URL(link);
    target.searchParams.set('go', action);
    return target.href;
  };
  return [
    '🎉 ' + item.title,
    '📅 時間：' + values.month + '月' + values.day + '日 ' + values.weekday + ' ' + values.hour + ':' + values.minute,
    '📍 地點：' + item.location,
    ...(item.address ? ['🏠 地址：' + item.address] : []),
    '🗺️ Google 地圖：' + shortcut('map'),
    '',
    '👉 活動詳情同 RSVP：' + link.href,
    '🗓️ 加入 Google 日曆：' + shortcut('cal'),
    '🍎 加入 Apple 日曆：' + new URL(appleCalendar(item), location.href).href,
    '',
    'Gathering'
  ].join('\n');
}

function showInvitation(item) {
  editor.innerHTML = `<div class="section-head"><h2 id="dialog-title">分享邀請</h2>
    <button class="button outline" data-action="close">關閉</button></div>
    <label class="share-preview">邀請訊息<textarea rows="11" readonly>${escape(invitationText(item))}</textarea></label>
    <div class="row share-actions"><button class="button" data-action="copy-invitation">複製邀請訊息</button>
    ${navigator.share ? '<button class="button outline" data-action="native-share">分享…</button>' : ''}</div>`;
  editor.setAttribute('aria-labelledby', 'dialog-title');
  editor.showModal();
}

function bindPlaceSearch(form) {
  const field = form.elements.location;
  const results = form.elements.placeSuggestion;
  const panel = results.closest('label');
  const status = form.querySelector('#place-status');
  const google = form.querySelector('[data-map-search]');
  let timer;
  let pending;
  let places = [];

  function updateMapSearch() {
    google.href = mapSearch(field.value.trim() || form.elements.address.value.trim() || '香港');
  }

  field.addEventListener('input', () => {
    clearTimeout(timer);
    pending?.abort();
    panel.hidden = true;
    status.textContent = '';
    updateMapSearch();
    const query = field.value.trim();
    if (query.length < 2) return;
    timer = setTimeout(async () => {
      pending = new AbortController();
      const { signal } = pending;
      status.textContent = '搜尋緊香港地址…';
      try {
        const response = await fetch(backendUrl('/api/places?' + new URLSearchParams({ q: query })), { signal });
        if (!response.ok) throw new Error('Address lookup unavailable');
        places = await response.json();
        results.replaceChildren(new Option('揀一個地址', ''));
        places.forEach((place, index) => results.add(new Option(
          [place.name, place.address].filter(Boolean).join(' · '), index
        )));
        panel.hidden = !places.length;
        status.textContent = places.length ? '地址來源：地政總署' : '搵唔到地址，可以手動輸入。';
      } catch (error) {
        if (error.name !== 'AbortError') status.textContent = '暫時搜尋唔到，可以手動輸入。';
      }
    }, 450);
  });

  form.elements.address.addEventListener('input', updateMapSearch);
  results.addEventListener('change', () => {
    const chosen = places[results.value];
    if (!chosen) return;
    field.value = chosen.name.slice(0, 200);
    form.elements.address.value = chosen.address.slice(0, 300);
    form.elements.mapUrl.value = '';
    updateMapSearch();
    panel.hidden = true;
    status.textContent = '已填入所選地點。';
    form.elements.address.focus();
  });
  editor.addEventListener('close', () => {
    clearTimeout(timer);
    pending?.abort();
  }, { once: true });
}

function googleCalendar(item) {
  const params = new URLSearchParams({
    action: 'TEMPLATE', text: item.title, dates: compact(item.start) + '/' + compact(item.end),
    location: venueAddress(item), details: item.note
  });
  return 'https://calendar.google.com/calendar/render?' + params;
}

function settlement(item) {
  const balances = new Map();
  const credit = (person, value) => balances.set(person, (balances.get(person) ?? 0) + value);
  for (const { cents, payer, people } of item.expenses) {
    credit(payer, cents);
    const share = Math.floor(cents / people.length);
    const remainder = cents % people.length;
    people.forEach((person, index) => credit(person, -(share + Number(index < remainder))));
  }
  for (const transfer of item.paid) {
    const [from, to, cents] = transfer.split(':');
    credit(from, Number(cents));
    credit(to, -Number(cents));
  }
  const largest = (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]);
  const debtors = [...balances].filter(([, balance]) => balance < 0).map(([person, value]) => [person, -value]).sort(largest);
  const creditors = [...balances].filter(([, balance]) => balance > 0).sort(largest);
  const result = [];
  let from = 0;
  let to = 0;
  while (from < debtors.length && to < creditors.length) {
    const owing = debtors[from];
    const owed = creditors[to];
    const amount = Math.min(owing[1], owed[1]);
    result.push([owing[0], owed[0], amount, item.expenses.at(-1).id].join(':'));
    owing[1] -= amount;
    owed[1] -= amount;
    if (!owing[1]) from++;
    if (!owed[1]) to++;
  }
  return result;
}

function expensePanel(item) {
  const people = new Map([['host', item.host], ...item.responses.map(response => [response.guest, response.name])]);
  const name = person => escape(people.get(person) ?? '成員');
  const total = item.expenses.reduce((sum, expense) => sum + expense.cents, 0);
  function transferRow(key, paid) {
    const [from, to, cents] = key.split(':');
    return `<li><span>${name(from)} 畀 ${name(to)} <strong>${money(Number(cents))}</strong></span>
      ${item.owner ? `<button class="button outline" data-action="payment" data-transfer="${escape(key)}" data-paid="${!paid}">${paid ? '撤銷已付' : '標記已付'}</button>`
        : `<span class="tag ${paid ? 'yes' : ''}">${paid ? '已付' : '待付款'}</span>`}</li>`;
  }
  return `<section class="panel wide">
    <div class="section-head"><h2>費用分攤</h2>${item.owner ? '<button class="button outline" data-action="expense">＋ 加一筆</button>' : ''}</div>
    ${total ? `<p>總支出 <strong>${money(total)}</strong></p>
      <ul class="list">${item.expenses.map(expense => `<li><span><strong>${escape(expense.label)}</strong><br>
        <span class="subtle">${name(expense.payer)} 先畀 · ${expense.people.length} 人分</span></span><strong>${money(expense.cents)}</strong></li>`).join('')}</ul>
      <h3>轉帳建議</h3><ul class="list">${settlement(item).map(key => transferRow(key, false)).join('')}
      ${item.paid.map(key => transferRow(key, true)).join('')}</ul>${!settlement(item).length ? '<p class="subtle">現時已經平數。</p>' : ''}`
      : '<p class="subtle">暫時未有支出。</p>'}
    ${item.payme ? `<a class="button outline" href="${escape(item.payme)}" target="_blank" rel="noreferrer">主辦人 PayMe</a>` : ''}
  </section>`;
}

function showEvent(item) {
  const response = item.responses.find(person => person.guest === item.guest);
  const counts = Object.keys(statuses).map(key => `<span class="tag ${key}">${statuses[key]} ${item.responses.filter(person => person.status === key).length}</span>`);
  document.title = item.title + ' | Gathering';
  main.innerHTML = `
    <a class="button text" href="./">返活動首頁</a>
    <section class="event-hero">
      <div class="eyebrow">${escape(item.host)} 主辦</div>
      <h1>${escape(item.title)}</h1>
      <div class="meta"><span>◷ ${when.formatRange(new Date(item.start), new Date(item.end))}（香港）</span><span>◎ ${escape(item.location)}</span></div>
      ${item.address ? `<p>${escape(item.address)}</p>` : ''}
      ${item.note ? '<p>' + escape(item.note) + '</p>' : ''}
      <div class="row"><button class="button lime" data-action="share">分享邀請</button>
        <a class="button outline" href="${escape(mapLink(item))}" target="_blank" rel="noreferrer">Google 地圖</a>
        ${item.owner ? '<button class="button outline" data-action="edit">編輯活動</button>' : ''}</div>
    </section>
    <div class="event-grid">
      <section class="panel"><h2>出席回覆</h2>
        <form data-form="rsvp">
          <div class="fields"><label>你個名<input name="name" maxlength="50" required autocomplete="nickname" value="${escape(response?.name)}"></label>
          <label>出席狀態<select name="status">${Object.entries(statuses).map(([key, label]) => `<option value="${key}" ${response?.status === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>
          <p class="error" role="alert"></p>
          <div><button class="button" type="submit">${response ? '更新回覆' : '提交回覆'}</button></div>
        </form>
      </section>
      <section class="panel"><h2>加入日曆</h2><div class="row">
        <a class="button outline" href="${escape(googleCalendar(item))}" target="_blank" rel="noreferrer">Google 日曆</a>
        <a class="button outline" href="${escape(appleCalendar(item))}">Apple 日曆（.ics）</a></div></section>
      <section class="panel wide"><h2>參加名單</h2><div class="breakdown">${counts.join('')}</div>
      ${item.responses.length ? `<ul class="list">${item.responses.map(person => `<li><span>${escape(person.name)}</span><span class="tag ${person.status}">${statuses[person.status]}</span></li>`).join('')}</ul>`
        : '<p class="subtle">仲未有人回覆。</p>'}</section>
      ${expensePanel(item)}
    </div>`;
}

function localTime(iso) {
  return new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

function eventForm(existing = {}) {
  const tomorrow = localTime(Date.now() + 24 * 3600000).slice(0, 10);
  const start = new Date(tomorrow + "T19:00+08:00");
  const end = new Date(start.getTime() + 2 * 3600000);
  editor.innerHTML = `<form data-form="${existing.id ? 'edit' : 'create'}">
    <div class="section-head"><h2 id="dialog-title">${existing.id ? '編輯活動' : '建立活動'}</h2>
      <button class="button outline" type="button" data-action="close">關閉</button></div>
    <label>活動名<input name="title" required maxlength="100" placeholder="例如 星期六打邊爐" value="${escape(existing.title)}"></label>
    <div class="fields">
      <label>開始時間（香港）<input name="start" type="datetime-local" required value="${localTime(existing.start ?? start)}"></label>
      <label>結束時間（香港）<input name="end" type="datetime-local" required value="${localTime(existing.end ?? end)}"></label>
    </div>
    <div class="fields">
      <label>主辦人<input name="host" required maxlength="50" value="${escape(existing.host)}"></label>
    </div>
    <fieldset class="place-fields stack"><legend>地點</legend>
      <label>地點名稱<input name="location" type="search" required maxlength="200" autocomplete="off" placeholder="輸入場所名、大廈名或地址" value="${escape(existing.location)}"></label>
      <label class="place-suggestions" hidden>地址搜尋結果
        <select name="placeSuggestion" aria-describedby="place-status"></select>
      </label>
      <div class="place-meta">
        <span class="subtle" id="place-status" role="status"></span>
        <a class="subtle" data-map-search href="${escape(mapSearch(existing.location || '香港'))}" target="_blank" rel="noreferrer">喺 Google Maps 搜尋</a>
      </div>
      <label>地址（選填）<input name="address" maxlength="300" value="${escape(existing.address)}"></label>
      <label>Google Maps 連結（選填）<input name="mapUrl" type="url" maxlength="2000"
        placeholder="https://maps.app.goo.gl/…" value="${escape(existing.mapUrl)}"></label>
    </fieldset>
    <label>活動備註<textarea name="note" rows="2" maxlength="1200">${escape(existing.note)}</textarea></label>
    <label>PayMe 連結（選填）<input name="payme" type="url" placeholder="https://payme.hsbc.com.hk/…" value="${escape(existing.payme)}"></label>
    ${!existing.id ? '<small class="subtle">主辦權限會儲喺呢個瀏覽器。</small>' : ''}
    <p class="error" role="alert"></p>
    <button class="button" type="submit">${existing.id ? '儲存改動' : '建立活動'}</button>
  </form>`;
  editor.setAttribute('aria-labelledby', 'dialog-title');
  bindPlaceSearch(editor.querySelector('form'));
  editor.showModal();
}

function expenseForm() {
  const people = [['host', event.host], ...event.responses.filter(
    person => person.status === 'yes' && person.guest !== event.guest
  ).map(person => [person.guest, person.name])];
  editor.innerHTML = `<form data-form="expense">
    <div class="section-head"><h2 id="dialog-title">新增支出</h2><button class="button outline" type="button" data-action="close">關閉</button></div>
    <label>項目<input name="label" required maxlength="100" placeholder="例如 晚餐"></label>
    <label>金額（HKD）<input name="amount" type="number" min="0.01" step="0.01" max="1000000" inputmode="decimal" required></label>
    <label>邊個先畀<select name="payer">${people.map(([key, name]) => `<option value="${key}">${escape(name)}</option>`).join('')}</select></label>
    <fieldset><legend>平均分畀</legend><div class="checkgroup">${people.map(([key, name]) => `<label class="check"><input type="checkbox" name="people" value="${key}" checked> ${escape(name)}</label>`).join('')}</div></fieldset>
    <p class="error" role="alert"></p><button class="button" type="submit">記低支出</button>
  </form>`;
  editor.setAttribute('aria-labelledby', 'dialog-title');
  editor.showModal();
}

document.addEventListener('click', async interaction => {
  const button = interaction.target.closest('button[data-action]');
  if (!button) return;
  switch (button.dataset.action) {
    case 'create': eventForm(); break;
    case 'edit': eventForm(event); break;
    case 'expense': expenseForm(); break;
    case 'close': editor.close(); break;
    case 'share': showInvitation(event); break;
    case 'copy-invitation':
      try {
        await navigator.clipboard.writeText(editor.querySelector('textarea').value);
        announce('已複製邀請訊息。');
      } catch {
        editor.querySelector('textarea').select();
        announce('已選取邀請訊息，可以手動複製。');
      }
      break;
    case 'native-share':
      try {
        await navigator.share({ text: editor.querySelector('textarea').value });
      } catch (error) {
        if (error.name !== 'AbortError') announce('暫時分享唔到，你可以複製邀請訊息。');
      }
      break;
    case 'payment':
      button.disabled = true;
      try {
        event = await api('/' + id + '/payment', { transfer: button.dataset.transfer, paid: button.dataset.paid === 'true' });
        showEvent(event);
        announce('已更新付款記錄。');
      } catch (error) {
        announce(error.message);
      } finally {
        button.disabled = false;
      }
      break;
  }
});

document.addEventListener('submit', async interaction => {
  const form = interaction.target;
  if (!form.dataset.form) return;
  interaction.preventDefault();
  const submit = form.querySelector('[type="submit"]');
  const errorbox = form.querySelector('.error');
  if (submit.disabled) return;
  submit.disabled = true;
  errorbox.textContent = '';
  try {
    const data = new FormData(form);
    const values = Object.fromEntries(data);
    const action = form.dataset.form;
    if (action === 'create' || action === 'edit') {
      values.start = new Date(values.start + '+08:00').toISOString();
      values.end = new Date(values.end + '+08:00').toISOString();
      if (values.end <= values.start) throw new Error('結束時間要遲過開始時間。');
    }
    if (action === 'create') {
      const created = await api('', values);
      location.assign(eventLink(created.id));
      return;
    }
    if (action === 'expense') {
      values.people = data.getAll('people');
      values.cents = Math.round(Number(values.amount) * 100);
      if (!values.people.length) throw new Error('請揀至少一位分攤成員。');
    }
    event = await api('/' + id + '/' + action, values);
    remember(event);
    if (editor.open) editor.close();
    showEvent(event);
    announce({ edit: '已更新活動。', rsvp: '已儲存出席回覆。', expense: '已記低支出。' }[action]);
  } catch (error) {
    errorbox.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

async function init() {
  if (!id) {
    await home();
    return;
  }
  main.innerHTML = '<p class="subtle" role="status">載入緊邀請…</p>';
  try {
    event = await api('/' + encodeURIComponent(id));
    remember(event);
    showEvent(event);
    if (params.get('go') === 'map') location.replace(mapLink(event));
    if (params.get('go') === 'cal') location.replace(googleCalendar(event));
    poll = setInterval(async () => {
      if (document.hidden || editor.open || main.contains(document.activeElement)) return;
      const previous = event;
      try {
        const latest = await api('/' + encodeURIComponent(id));
        if (event !== previous || editor.open || main.contains(document.activeElement)) return;
        if (JSON.stringify(latest) !== JSON.stringify(previous)) {
          event = latest;
          remember(latest);
          showEvent(latest);
        }
      } catch {
        // Keep the last successful view visible while the connection recovers.
      }
    }, 5000);
  } catch (error) {
    main.innerHTML = `<div class="empty panel"><strong>${escape(error.message)}</strong><a class="button outline" href="./">返活動首頁</a></div>`;
  }
}

addEventListener('pagehide', () => clearInterval(poll));
addEventListener('pageshow', page => { if (page.persisted) init(); });
init();
