/*
  Anluminium Blank Business - starter web app
  Data model:
  - defaultPrices: { [variantKey]: number }
  - clients: [{ id, name, phone, notes, specialPrices: { [variantKey]: number } }]
  - ledger: [{ id, date, clientId, type, description, debit, credit, items?: { [variantKey]: qty } }]
*/

const SESSION_KEY = 'aluminium-blank-app:session_v1';
if (sessionStorage.getItem(SESSION_KEY) !== 'true') {
    window.location.href = 'login.html';
}


const STORAGE_KEY = 'aluminium-blank-app:v1';

// Variants grouped by OD size for “New Entry” screen
const VARIANTS = [
  { key: '6mm_165', label: '6mm-165', group: 'Size - 140 OD' },
  { key: '8mm_185', label: '8mm-185', group: 'Size - 140 OD' },
  { key: '10mm_205', label: '10mm-205', group: 'Size - 140 OD' },
  { key: 'side_wheel_270', label: 'Side Wheel - 270', group: 'Size - 140 OD' },

  { key: '6mm_185', label: '6mm-185', group: 'Size - 147 OD' },
  { key: '8mm_205', label: '8mm-205', group: 'Size - 147 OD' },
  { key: '10mm_220', label: '10mm-220', group: 'Size - 147 OD' },
];


const MONEY = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

function uid(prefix='id'){
  if (crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  // Fallback for older browsers/non-secure contexts
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16).slice(-4)}`;
}

function debounce(fn, delay) {
  let timeoutId;
  return function(...args) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

function loadState(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(raw){
    try{ return JSON.parse(raw); }catch{ /* fallthrough */ }
  }

  // Defaults based on user-provided data
  const defaultPrices = {
    '6mm_165': 165,
    '6mm_185': 185,
    '8mm_185': 185,
    '8mm_205': 205, // Added missing default price
    '10mm_205': 205,
    '10mm_220': 220,
    'side_wheel_270': 270,
  };

  return {
    defaultPrices,
    clients: [
      { id: uid('c'), name: 'Ravi Traders', phone: '', notes: '', specialPrices: {} },
    ],
    ledger: []
  };
}

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function $(sel){ return document.querySelector(sel); }
function el(tag, props={}, children=[]){
  const n = document.createElement(tag);
  for(const [k,v] of Object.entries(props)){
    if(k === 'class') n.className = v;
    else if(k === 'text') n.textContent = v;
    else if(k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for(const c of children){
    if(c == null) continue;
    if(typeof c === 'string') n.appendChild(document.createTextNode(c));
    else n.appendChild(c);
  }
  return n;
}

// --- State ---
let state = loadState();
// Transient state that is not saved to localStorage
let transientState = {
  selectedClientId: undefined,
  editingLedgerEntryId: undefined,
  __ledgerFilterWired: false,
  clientDetailsFilterClientId: undefined,
};

// --- Helpers ---

// --- UX: Toasts / Modal confirm / Undo ---
let undoStack = [];
let toastTimers = [];

function ensureUxLayer(){
  if (document.getElementById('uxLayer')) return;

  const layer = document.createElement('div');
  layer.id = 'uxLayer';
  layer.innerHTML = `
    <div id="toastHost" aria-live="polite" aria-atomic="true"></div>
    <div id="modalHost" style="display:none;" role="dialog" aria-modal="true">
      <div class="modal">
        <div class="modalHeader">
          <div class="modalTitle" id="modalTitle">Confirm</div>
        </div>
        <div class="modalBody" id="modalBody"></div>
        <div class="modalFooter">
          <button class="secondary" id="modalCancel" type="button">Cancel</button>
          <button class="secondary primary" id="modalOk" type="button">OK</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(layer);

  layer.querySelector('#modalCancel').addEventListener('click', () => closeConfirmModal());
  layer.querySelector('#modalOk').addEventListener('click', () => {
    if (layer.__confirmResolve) layer.__confirmResolve(true);
    closeConfirmModal();
  });

  // Close modal on overlay click
  layer.querySelector('#modalHost').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) { // Clicked on the overlay, not the modal content
        if (layer.__confirmResolve) layer.__confirmResolve(false);
        closeConfirmModal();
    }
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (document.getElementById('modalHost')?.style.display !== 'none') {
        const l = document.getElementById('uxLayer');
        if (l?.__confirmResolve) l.__confirmResolve(false);
        closeConfirmModal();
      }
    }
  });
}

function toast(message, kind='success', durationMs=3200, action = null){
  ensureUxLayer();
  const host = $('#toastHost');
  if(!host) return;

  const t = document.createElement('div');
  t.className = `toast toast-${kind}`;
  const msgEl = el('div', { class: 'toastMsg', text: message });
  t.appendChild(msgEl);

  if (action && action.label && action.callback) {
    const actionBtn = el('button', { class: 'secondary toastAction', text: action.label });
    actionBtn.addEventListener('click', () => {
      action.callback();
      t.remove(); // Remove toast on action click
    });
    msgEl.appendChild(actionBtn);
  }

  host.appendChild(t);
  const timer = setTimeout(() => {
    t.classList.add('toastOut');
    setTimeout(() => t.remove(), 250);
  }, durationMs);
  toastTimers.push(timer);
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'<','>':'>','"':'"','\'':'&#39;'}[c]));
}

function openConfirmModal({title='Confirm', body='', okText='OK', cancelText='Cancel'}={}){
  ensureUxLayer();
  const modalHost = $('#modalHost');
  const layer = $('#uxLayer');
  $('#modalTitle').textContent = title;
  $('#modalBody').textContent = body;
  $('#modalOk').textContent = okText;
  $('#modalCancel').textContent = cancelText;
  modalHost.style.display = 'flex';
  layer.__confirmResolve = null;

  return new Promise((resolve) => {
    layer.__confirmResolve = resolve;
  });
}

function closeConfirmModal(){
  const modalHost = $('#modalHost');
  if(modalHost) modalHost.style.display = 'none';
  const layer = $('#uxLayer');
  if(layer) layer.__confirmResolve = null;
}

function pushUndo({label, apply, undo, ttlMs=6500}){
  // apply already done; store inverse
  const entry = { label, undo, undoAt: Date.now(), ttlMs };
  undoStack.unshift(entry);
  if(undoStack.length > 10) undoStack = undoStack.slice(0,10);
  
  const undoAction = () => {
    const top = undoStack.find(u => u === entry);
    if (!top) return;
    try { top.undo(); } catch(e) { console.error("Undo failed", e); }
    undoStack = undoStack.filter(u => u !== top);
    toast('Undone: ' + label, 'success', 2400);
  };

  toast(label, 'success', ttlMs, { label: 'Undo', callback: undoAction });

  // Expire the undo action from the stack automatically
  setTimeout(() => {
    undoStack = undoStack.filter(u => u !== entry);
  }, ttlMs);
}

function deleteLedgerEntry(id) {
  (async () => {
    const ok = await openConfirmModal({
      title: 'Delete entry',
      body: 'Delete this ledger entry? This will affect balances. You can undo for a few seconds.',
      okText: 'Delete',
      cancelText: 'Keep'
    });
    if(!ok) return;

    const prev = state.ledger.find(e => e.id === id);
    state.ledger = state.ledger.filter(e => e.id !== id);
    saveState();

    pushUndo({
      label: 'Entry deleted',
      undo: () => {
        if(prev) state.ledger.push(prev);
        saveState();
        if ($('#viewLedger').style.display !== 'none') renderLedgerView();
        if ($('#viewClientDetails').style.display !== 'none') renderClientDetailsView();
      }
    });

    if ($('#viewLedger').style.display !== 'none') renderLedgerView();
    if ($('#viewClientDetails').style.display !== 'none') renderClientDetailsView();
  })();
}

function editLedgerEntry(id) {
  const entry = state.ledger.find(e => e.id === id);
  if (!entry) return;

  if (entry.items && Object.keys(entry.items).length > 0) {
    toast('This entry was created from New Entry (items). Edit quantities from New Entry instead.', 'danger', 4200);
    return;
  }

  // Switch to ledger view and set state to edit
  document.querySelector('.nav-btn[data-view="ledger"]').click();
  transientState.editingLedgerEntryId = id;
  renderLedgerView();
}

function computeAllTotals() {
  const debitByClient = {};
  const creditByClient = {};
  const balanceByClient = {};

  for (const e of state.ledger) {
    if (!e.clientId) continue;
    const debit = e.debit || 0;
    const credit = e.credit || 0;
    debitByClient[e.clientId] = (debitByClient[e.clientId] ?? 0) + debit;
    creditByClient[e.clientId] = (creditByClient[e.clientId] ?? 0) + credit;
    balanceByClient[e.clientId] = (balanceByClient[e.clientId] ?? 0) + debit - credit;
  }
  return { debitByClient, creditByClient, balanceByClient };
}

function priceForClient(client, variantKey){
  const sp = client?.specialPrices || {};
  if(sp[variantKey] != null && sp[variantKey] !== '') return Number(sp[variantKey]);
  return Number(state.defaultPrices[variantKey] ?? 0);
}

function renderSettingsView() {
  const view = $('#viewSettings');
  view.innerHTML = '';

  const card = el('div', { class: 'card' }, [
    el('h3', { text: 'Settings' }),
    el('p', { class: 'muted', text: 'Manage default application settings.' }),
    el('div', { class: 'section' }, [
      el('h3', { text: 'Default Price Table' }),
      el('p', { class: 'muted', text: 'These prices are used when a client does not have special pricing.' }),
    ])
  ]);
  
  const table = el('table', { class: 'table' });
  const thead = el('thead', {}, [
    el('tr', {}, [
      el('th', { text: 'Price Table (Default)' }),
      el('th', { text: '₹' }),
    ])
  ]);

  const tbody = el('tbody');
  for(const v of VARIANTS){
    const tr = el('tr');
    const td1 = el('td', { text: v.label });
    const td2 = el('td');
    const input = el('input', { class: 'input', type: 'number', value: state.defaultPrices[v.key] ?? '', step: '1' });
    input.addEventListener('change', () => {
      state.defaultPrices[v.key] = input.value === '' ? '' : Number(input.value);
      saveState();
      // Re-render dependent views, but not this one to avoid focus loss
      if ($('#viewNewEntry').style.display !== 'none') {
        renderNewEntryView();
      }
    });
    td2.appendChild(input);
    tr.appendChild(td1);
    tr.appendChild(td2);
    tbody.appendChild(tr);
  }

  table.appendChild(thead);
  table.appendChild(tbody);
  card.querySelector('.section').appendChild(table);
  view.appendChild(card);
}

function renderClientsView(){
  const view = $('#viewClients');
  view.innerHTML = '';

  const totals = computeAllTotals();

  const header = el('div', { class: 'grid2' }, [
    el('div', { class: 'card' }, [
      el('h3', { text: 'Clients' }),
      el('div', { class: 'client-list', id: 'clientList' }),
    ]),
    el('div', { class: 'card' }, [
      el('h3', { text: 'Add / Edit Client' }),
      el('div', { class: 'd-grid grid-cols-2 gap-3' }, [
        el('label', { text: 'Name' }),
        el('label', { text: 'Phone' }),
      ]),
      el('div', { class: 'd-grid grid-cols-2 gap-3 mt-1' }, [
        el('input', { id: 'clientName', class: 'input', placeholder: 'Client name' }),
        el('input', { id: 'clientPhone', class: 'input', placeholder: 'Phone (optional)' }),
      ]),
      el('div', { class: 'mt-3' }, [
        el('label', { text: 'Notes' })
      ]),
      el('div', {}, [
        el('input', { id: 'clientNotes', class: 'input', placeholder: 'Special terms / notes (optional)' })
      ]),
      el('div', { class: 'mt-4' }, [
        el('button', {
          class: 'secondary w-full',
          id: 'btnSaveClient',
          text: 'Save Client'
        })
      ]),
      el('div', { class: 'section mt-4' }, [
        el('h3', { text: 'Special Prices (override default)' }),
        el('div', { id: 'specialPricesTable' })
      ])
    ])
  ]);

  view.appendChild(header);

  const clientList = $('#clientList');
  clientList.innerHTML = '';

  const sorted = [...state.clients].sort((a,b)=>a.name.localeCompare(b.name));
  for(const c of sorted){
    const balance = totals.balanceByClient[c.id] ?? 0;
    const balanceColor = balance > 0 ? 'var(--danger)' : (balance < 0 ? 'var(--success)' : 'var(--muted)');

    const item = el('div', { class: 'client-item' }, [
      el('div', {}, [
        el('div', { class: 'font-bold', text: c.name }),
        el('div', { class: 'small', text: c.phone ? `Phone: ${c.phone}` : 'Phone: —' }),
        el('div', { class: 'd-flex gap-2 align-center mt-2' }, [
          el('button', { class:'secondary small', text:'Edit', onclick: () => selectClient(c.id) }),
          el('button', { class:'secondary small danger', text:'Delete', onclick: () => deleteClient(c.id) }),
        ]),
      ]),
      el('div', { class: 'text-right' }, [
        el('div', { class: 'font-bold', style: `color:${balanceColor}; font-size: 1.1rem;`, text: `₹${MONEY.format(balance)}` }),
        el('div', { class: 'small', text: 'Balance' }),
      ])
    ]);
    clientList.appendChild(item);
  }

  function selectClient(id){
    const c = state.clients.find(x=>x.id===id);
    if(!c) return;
    transientState.selectedClientId = id;
    $('#clientName').value = c.name || '';
    $('#clientPhone').value = c.phone || '';
    $('#clientNotes').value = c.notes || '';
    renderSpecialPricesTable(c);
  }

function deleteClient(id){
    (async () => {
      const hasLedgerEntries = state.ledger.some(e => e.clientId === id);
      if (hasLedgerEntries) {
        toast('Cannot delete client: they have ledger entries.', 'danger', 3600);
        return;
      }

      const cprev = state.clients.find(x => x.id === id);
      const ok = await openConfirmModal({
        title: 'Delete client',
        body: 'Delete this client? This cannot be undone (but you can undo for a few seconds).',
        okText: 'Delete',
        cancelText: 'Keep'
      });
      if(!ok) return;

      state.clients = state.clients.filter(x=>x.id!==id);
      if(transientState.selectedClientId === id) {
        transientState.selectedClientId = undefined;
        $('#clientName').value = '';
        $('#clientPhone').value = '';
        $('#clientNotes').value = '';
      }
      saveState();

      pushUndo({
        label: 'Client deleted',
        undo: () => {
          if(cprev) state.clients.push(cprev);
          saveState();
          renderClientsView();
          renderLedgerView();
          if ($('#viewDashboard').style.display !== 'none') renderDashboardView();
          if ($('#viewClientDetails').style.display !== 'none') renderClientDetailsView();
        }
      });

      renderClientsView();
      renderLedgerView();
    })();
  }

  function renderSpecialPricesTable(client){
    const wrap = $('#specialPricesTable');
    wrap.innerHTML = '';

    const table = el('table', { class: 'table' });
    const thead = el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Variant' }),
        el('th', { text: 'Client Price (leave blank to use default)' })
      ])
    ]);

    const tbody = el('tbody');
    for(const v of VARIANTS){
      const tr = el('tr');
      const td1 = el('td', { text: v.label });
      const td2 = el('td');

      const current = (client.specialPrices || {})[v.key];
      const defaultPrice = state.defaultPrices[v.key] ?? 0;

      const input = el('input', { class: 'input', type: 'number', step: '1' });
      if(current !== undefined && current !== null && current !== '') input.value = current;
      else input.value = '';

      const hint = el('div', { class:'small mt-1', text: `Default: ₹${MONEY.format(defaultPrice)}` });

      // Update state on change, but don't re-render the whole view to avoid focus loss
      input.addEventListener('change', () => {
        const val = input.value === '' ? '' : Number(input.value);
        client.specialPrices = client.specialPrices || {};
        if(val === '') delete client.specialPrices[v.key];
        else client.specialPrices[v.key] = val;
        state.clients = state.clients.map(x => x.id===client.id ? client : x);
        saveState();
        // If new entry view is active, re-render it to reflect new prices
        if ($('#viewNewEntry').style.display !== 'none') {
          renderNewEntryView();
        }
      });

      const cell = el('div', {}, [input, hint]);
      td2.appendChild(cell);

      tr.appendChild(td1);
      tr.appendChild(td2);
      tbody.appendChild(tr);
    }

    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);
  }

  $('#btnSaveClient').addEventListener('click', () => {
    const name = $('#clientName').value.trim();
    const phone = $('#clientPhone').value.trim();
    const notes = $('#clientNotes').value.trim();

    if(!name){ toast('Client name required', 'danger', 3000); return; }


    const id = transientState.selectedClientId;
    if(id){
      const c = state.clients.find(x=>x.id===id);
      c.name = name;
      c.phone = phone;
      c.notes = notes;
      state.clients = state.clients.map(x=>x.id===id ? c : x);
    } else {
      state.clients.push({ id: uid('c'), name, phone, notes, specialPrices: {} });
    }

    saveState();
    // refresh
    $('#clientName').value = '';
    $('#clientPhone').value = '';
    $('#clientNotes').value = '';
    $('#specialPricesTable').innerHTML = '';
    transientState.selectedClientId = undefined;
    renderClientsView();
    renderLedgerView();
  });

  // initial selection
  if(transientState.selectedClientId){
    selectClient(transientState.selectedClientId);
  } else {
    $('#specialPricesTable').innerHTML = el('div', { class:'small', text:'Select a client to set special prices.' }).outerHTML;
  }
}

function renderDashboardView() {
  const view = $('#viewDashboard');
  view.innerHTML = '';

  const totals = computeAllTotals();
  const totalClients = state.clients.length;
  const combinedDebit = Object.values(totals.debitByClient).reduce((a, b) => a + (b || 0), 0);
  const combinedCredit = Object.values(totals.creditByClient).reduce((a, b) => a + (b || 0), 0);
  const netBalance = combinedDebit - combinedCredit;

  const header = el('div', {}, [
    el('h2', { text: 'Dashboard', style: 'font-size: 2rem; font-weight: 800; margin-bottom: 0.5rem;' }),
    el('p', { class: 'muted', text: `Welcome! Here's a summary of your business.` })
  ]);

  const statsGrid = el('div', { class: 'd-grid grid-cols-3 gap-3 mt-4' }, [
    el('div', { class: 'card' }, [
      el('div', { class: 'small', text: 'Total Clients' }),
      el('div', { class: 'font-bold text-xl', style: 'font-size: 2rem;', text: totalClients })
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'small', text: 'Total Owing to You (Debit)' }),
      el('div', { class: 'font-bold text-xl', style: 'font-size: 2rem; color: var(--danger);', text: `₹${MONEY.format(combinedDebit)}` })
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'small', text: 'Net Balance' }),
      el('div', { class: 'font-bold text-xl', style: 'font-size: 2rem; color: var(--accent);', text: `₹${MONEY.format(netBalance)}` })
    ]),
  ]);

  const quickActions = el('div', { class: 'mt-4' }, [
      el('h3', { text: 'Quick Actions' }),
      el('div', { class: 'd-flex gap-3' }, [
          el('button', { class: 'secondary', text: 'Add New Client', onclick: () => document.querySelector('[data-view="clients"]').click() }),
          el('button', { class: 'secondary', text: 'Create New Entry', onclick: () => document.querySelector('[data-view="newEntry"]').click() }),
      ])
  ]);

  view.appendChild(header);
  view.appendChild(statsGrid);
  view.appendChild(quickActions);
}

function renderNewEntryView(){
  const view = $('#viewNewEntry');
  view.innerHTML = '';

  const clientsOptions = state.clients.slice().sort((a,b)=>a.name.localeCompare(b.name));

  const card = el('div', { class:'card' }, [
    el('h3', { text: 'New Entry (Item Quantities → Owe/Paid)' }),
    el('p', { class:'muted', text:'Enter quantities for each item variant. Amount is calculated using client special price (if set) otherwise default price.' }),

    el('div', { class:'d-grid grid-cols-2 gap-3 mt-4' }, [
      el('div', {}, [el('div', { class:'small', text:'Date' }), el('input', { id:'neDate', class:'input', type:'date' })]),
      el('div', {}, [
        el('div', { class:'small', text:'Client' }),
        (()=>{
          const sel = el('select', { id:'neClient', class:'input' });
          sel.appendChild(el('option', { value:'', text:'Select client' }));
          for(const c of clientsOptions){
            sel.appendChild(el('option', { value:c.id, text:c.name }));
          }
          return sel;
        })()
      ])
    ]),

    el('div', { class: 'mt-4' }, [
      el('h3', { text:'Quantities' }),
      (()=>{
        const table = el('table', { class:'table' });
        table.appendChild(el('thead', {}, [
          el('tr', {}, [
            el('th', { text:'Item' }),
            el('th', { text:'Qty' }),
            el('th', { text:'Price (₹)' }),
            el('th', { text:'Amount (₹)' }),
          ])
        ]));
        const tbody = el('tbody');

        for(const v of VARIANTS){
          const tr = el('tr');
          tr.appendChild(el('td', { text: v.label }));

          const qtyTd = el('td');
          const qtyInput = el('input', { class:'input', type:'number', step:'1', min:'0', value:'0' });
          qtyInput.addEventListener('input', () => recalc());
          qtyTd.appendChild(qtyInput);

          const priceTd = el('td', { text: '—' });
          const amtTd = el('td', { text: '0' });

          // store references on the row
          tr.appendChild(qtyTd);
          tr.appendChild(priceTd);
          tr.appendChild(amtTd);

          tbody.appendChild(tr);
          // Keep a handle for recalc
          table.__rows = table.__rows || [];
          table.__rows.push({
            variantKey: v.key,
            qtyInput,
            priceTd,
            amtTd,
          });
        }

        table.appendChild(tbody);
        return table;
      })(),
    ]),

    el('div', { class:'d-grid grid-cols-2 gap-3 mt-4' }, [
      el('div', {}, [
        el('div', { class:'small', text:'Payment Type' }),
        (()=>{
          const sel = el('select', { id:'neType', class:'input' });
          sel.appendChild(el('option', { value:'debit', text:'Debit (Owe / Client owes)' }));
          sel.appendChild(el('option', { value:'credit', text:'Credit (Paid by client)' }));
          return sel;
        })()
      ]),
      el('div', {}, [
        el('div', { class:'small', text:'Total Amount (₹)' }),
        el('div', { id:'neTotal', class: 'mt-2', text:'0' })
      ])
    ]),

    el('div', { class: 'mt-3' }, [
      el('div', { class:'small', text:'Description' }),
      el('input', { id:'neDesc', class:'input', placeholder:'Auto summary will be filled if left blank' })
    ]),

    el('div', { class: 'mt-4 d-flex gap-3' }, [
      el('button', { class:'secondary', id:'btnSaveNewEntry', text:'Save Entry' }),
      el('button', { class:'secondary', id:'btnResetNewEntry', text:'Reset' }),
    ]),

    el('div', { class: 'mt-4' }, [
      el('p', { class:'muted', text:'Saving will create a ledger entry with Debit (owe) or Credit (paid).' })
    ])
  ]);

  view.appendChild(card);

  if($('#neDate')) $('#neDate').value = (new Date()).toISOString().slice(0,10);

  const table = view.querySelector('table.table');

  if(!table) return;


  function recalc(){
    const clientId = $('#neClient').value;
    const client = state.clients.find(c => c.id === clientId);

    let total = 0;
    const rows = table?.__rows || [];
    for(const r of rows){
      const qty = Number(r.qtyInput.value || 0);

      const price = priceForClient(client || {}, r.variantKey);
      const amount = qty * price;

      const sp = client?.specialPrices || {};
      const hasOverride = sp[r.variantKey] != null && sp[r.variantKey] !== '';

      if(!clientId){
        r.priceTd.textContent = '—';
        r.priceTd.classList.add('muted');
      } else {
        r.priceTd.innerHTML = `${MONEY.format(price)} <span class="priceSrc">${hasOverride ? 'S' : 'D'}</span>`;
      }

      r.amtTd.textContent = MONEY.format(amount);
      total += amount;
    }

    $('#neTotal').textContent = MONEY.format(total);
  }

  $('#neClient')?.addEventListener('change', recalc);

  $('#btnResetNewEntry').addEventListener('click', () => {
    if($('#neDate')) $('#neDate').value = (new Date()).toISOString().slice(0,10);
    $('#neClient').value = '';
    $('#neType').value = 'debit';
    $('#neDesc').value = '';

    const rows = (table?.__rows || []);
    for(const r of rows){
      r.qtyInput.value = '0';
    }
    recalc();
  });

  $('#btnSaveNewEntry').addEventListener('click', () => {
    const date = $('#neDate').value;
    const clientId = $('#neClient').value;
    const type = $('#neType').value;
    const desc = $('#neDesc').value.trim();

    if(!date){ toast('Select date', 'danger'); return; }
    if(!clientId){ toast('Select client', 'danger'); return; }


    const rows = (table?.__rows || []);
    let total = 0;
    const parts = [];
    for(const r of rows){
      const qty = Number(r.qtyInput.value || 0);
      if(qty > 0){
          const clientObj = state.clients.find(c => c.id === clientId);
          const price = priceForClient(clientObj, r.variantKey);
          const amount = qty * price;
          total += amount;

          const sp = clientObj?.specialPrices || {};
          const hasOverride = sp[r.variantKey] != null && sp[r.variantKey] !== '';
          parts.push(`${r.variantKey}:${qty}${hasOverride ? '(S)' : '(D)'}`);
        }
    }


    if(total <= 0){ toast('Enter quantity > 0 for at least one item', 'danger'); return; }


    const summary = parts.length ? `Items qty -> ${parts.join(', ')}` : '';

    // Save per-item quantities for details/editing later
    const items = {};
    for(const r of rows){
      const qty = Number(r.qtyInput.value || 0);
      if(qty > 0) items[r.variantKey] = qty;
    }

    const newEntry = {
      id: uid('l'),
      date,
      clientId,
      type,
      description: desc || summary,
      debit: type === 'debit' ? total : 0,
      credit: type === 'credit' ? total : 0,
      items
    };
    state.ledger.push(newEntry);

    pushUndo({
      label: 'New entry created',
      undo: () => {
        state.ledger = state.ledger.filter(e => e.id !== newEntry.id);
        saveState();
        // re-render relevant views
        if ($('#viewLedger').style.display !== 'none') renderLedgerView();
        if ($('#viewClientDetails').style.display !== 'none') renderClientDetailsView();
        if ($('#viewDashboard').style.display !== 'none') renderDashboardView();
      }
    });

    saveState();
    // go ledger
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    document.querySelector('.nav-btn[data-view="ledger"]').classList.add('active');
    document.querySelectorAll('.content > .view').forEach(v => v.style.display = 'none');
    $('#viewNewEntry').style.display = 'none';
    $('#viewLedger').style.display = '';
    renderLedgerView();
  });

  // initial totals
  recalc();
}

function renderClientDetailsView(){
  const view = $('#viewClientDetails');
  view.innerHTML = '';

  const totals = computeAllTotals();
  const clients = state.clients.slice().sort((a,b)=>a.name.localeCompare(b.name));

  // Helper: expand items for display
  function formatItems(e){
    const items = e.items || {};
    const rows = [];
    for(const v of VARIANTS){
      const qty = items[v.key];
      if(qty && Number(qty) > 0){
        rows.push(`${v.label} x ${qty}`);
      }
    }
    const extraKeys = Object.keys(items).filter(k => !VARIANTS.some(v=>v.key===k));
    for(const k of extraKeys){
      const qty = items[k];
      if(qty && Number(qty) > 0) rows.push(`${k} x ${qty}`);
    }
    if (!rows.length) return el('span', { class: 'muted', text: '—' });

    const list = el('ul', { class: 'itemList' });
    for (const row of rows) {
        list.appendChild(el('li', { text: row }));
    }
    return list;
  }

  const top = el('div', { class:'card' }, [
    el('h3', { text:'Client-wise Details (all entries)' }),
    el('p', { class:'muted', text:'This view shows every ledger entry with item-wise quantities (if saved from New Entry).' }),
  ]);
  view.appendChild(top);

  // Add filter section
  const filterSection = el('div', { class: 'card mt-4' }, [
    el('h3', { text: 'Filter by Client' }),
    el('div', {}, [
      el('label', { class: 'small', text: 'Show details for a specific client' }),
      (() => {
        const sel = el('select', { id: 'cdFilterClient', class: 'input' });
        sel.appendChild(el('option', { value: 'all', text: 'All Clients' }));
        for (const c of clients) {
          const opt = el('option', { value: c.id, text: c.name });
          if (transientState.clientDetailsFilterClientId === c.id) {
            opt.selected = true;
          }
          sel.appendChild(opt);
        }
        sel.addEventListener('change', () => {
          transientState.clientDetailsFilterClientId = sel.value === 'all' ? undefined : sel.value;
          renderClientDetailsView();
        });
        return sel;
      })()
    ])
  ]);
  view.appendChild(filterSection);

  // Combined totals header
  const combinedDebit = Object.values(totals.debitByClient).reduce((a,b)=>a+(b||0),0);
  const combinedCredit = Object.values(totals.creditByClient).reduce((a,b)=>a+(b||0),0);
  const combinedNet = combinedDebit - combinedCredit;

  top.appendChild(el('div', { class:'table-card mt-4' }, [
    el('div', { class:'small', text:'Combined totals (Debit = Owe, Credit = Paid)' }),
    el('div', { class: 'd-grid grid-cols-3 gap-3 mt-2' }, [
      el('div', {}, [
        el('div', { class:'small', text:'Total Owing (Debit)' }),
        el('div', { class: 'font-bold text-xl', text: `₹${MONEY.format(combinedDebit)}` })
      ]),
      el('div', {}, [
        el('div', { class:'small', text:'Total Paid (Credit)' }),
        el('div', { class: 'font-bold text-xl', text: `₹${MONEY.format(combinedCredit)}` })
      ]),
      el('div', {}, [
        el('div', { class:'small', text:'Net Balance' }),
        el('div', { class: 'font-bold text-xl', text: `₹${MONEY.format(combinedNet)}` })
      ])
    ])
  ]));

  // Download CSV for this tab only
  top.appendChild(el('div', { class: 'mt-4 d-flex gap-3' }, [
    el('button', {
      class:'secondary',
      id:'btnExportClientDetailsCsv',
      text:'Download Client Details (CSV)'
    })
  ]));

  $('#btnExportClientDetailsCsv').addEventListener('click', () => {
    const lines = [];
    lines.push(['clientName','date','entryId','type','description','debit','credit','itemsSummary'].map(csvEscape).join(','));
    for(const e of [...state.ledger].sort((a,b)=> (b.date||'').localeCompare(a.date||''))){
      const c = state.clients.find(x=>x.id===e.clientId);
      lines.push([
        c?.name || '',
        e.date || '',
        e.id || '',
        e.type || '',
        e.description || '',
        e.debit || 0,
        e.credit || 0,
        formatItems(e),
      ].map(csvEscape).join(','));
    }
    downloadText('aluminium-blank-app-client-details.csv', lines.join('\n'));
  });

  // Tables per client
  const clientsToRender = transientState.clientDetailsFilterClientId
    ? clients.filter(c => c.id === transientState.clientDetailsFilterClientId)
    : clients;

  for(const c of clientsToRender){
    const clientDebit = totals.debitByClient[c.id] ?? 0;
    const clientCredit = totals.creditByClient[c.id] ?? 0;
    const clientNet = clientDebit - clientCredit;

    const section = el('div', { class:'card mt-4' }, [
      el('h3', { text: c.name }),
      el('div', { class:'small', text: c.phone ? `Phone: ${c.phone}` : '' }),
      el('div', { class:'table-card mt-3' }, [
        el('div', { class:'small', text:'Client Totals' }),
        el('div', { class: 'd-grid grid-cols-3 gap-3 mt-2' }, [
          el('div', {}, [
            el('div', { class:'small', text:'Owing (Debit)' }),
            el('div', { class: 'font-bold text-xl', text: `₹${MONEY.format(clientDebit)}` })
          ]),
          el('div', {}, [
            el('div', { class:'small', text:'Paid (Credit)' }),
            el('div', { class: 'font-bold text-xl', text: `₹${MONEY.format(clientCredit)}` })
          ]),
          el('div', {}, [
            el('div', { class:'small', text:'Net Balance' }),
            el('div', { class: 'font-bold text-xl', text: `₹${MONEY.format(clientNet)}` })
          ])
        ])
      ]),
      el('div', { class: 'mt-4' }, [
        el('h3', { text:'Entries' }),
        (function(){
          const entries = [...state.ledger]
            .filter(e=>e.clientId===c.id)
            .sort((a,b)=> (b.date||'').localeCompare(a.date||''));

          if (entries.length === 0) {
            return el('div', { class: 'muted', style: 'padding: 2rem 1rem; text-align: center; background-color: var(--panel); border-radius: 12px;', text: 'No entries found for this client.' });
          }

          const table = el('table', { class:'table' });
          table.appendChild(el('thead', {}, [
            el('tr', {}, [
              el('th', { text:'Date' }),
              el('th', { text:'Type' }),
              el('th', { text:'Description' }),
              el('th', { text:'Items (qty)' }),
              el('th', { text:'Debit' }),
              el('th', { text:'Credit' }),
              el('th', { text:'Actions' }),
            ])
          ]));
          const tbody = el('tbody');
          for(const e of entries){
            const tr = el('tr');
            tr.appendChild(el('td', { text: e.date || '—', 'data-label': 'Date' }));
            tr.appendChild(el('td', { text: e.type || '', 'data-label': 'Type' }));
            tr.appendChild(el('td', { text: e.description || '', 'data-label': 'Description' }));

            const itemsCell = el('td', { 'data-label': 'Items' });
            itemsCell.appendChild(formatItems(e));
            tr.appendChild(itemsCell);

            tr.appendChild(el('td', { text: e.debit ? MONEY.format(e.debit) : '', 'data-label': 'Debit' }));
            tr.appendChild(el('td', { text: e.credit ? MONEY.format(e.credit) : '', 'data-label': 'Credit' }));

            const actionsTd = el('td', { 'data-label': 'Actions' });
            const editBtn = el('button', { class: 'secondary small', text: 'Edit', onclick: () => editLedgerEntry(e.id) });
            const deleteBtn = el('button', { class: 'secondary small danger ml-2', text: 'Delete', onclick: () => deleteLedgerEntry(e.id) });
            actionsTd.append(editBtn, deleteBtn);
            tr.appendChild(actionsTd);
            tbody.appendChild(tr);
          }
          table.appendChild(tbody);
          return table;
        })()
      ])
    ]);

    view.appendChild(section);
  }
}

function renderLedgerView(){


  const view = $('#viewLedger');
  view.innerHTML = '';

  const clientsOptions = state.clients.slice().sort((a,b)=>a.name.localeCompare(b.name));

  const totals = computeAllTotals();
  const combinedDebit = Object.values(totals.debitByClient).reduce((a,b)=>a+(b||0),0);
  const combinedCredit = Object.values(totals.creditByClient).reduce((a,b)=>a+(b||0),0);
  const combinedNet = combinedDebit - combinedCredit;

  const card = el('div', { class: 'card' }, [
    el('h3', { text: 'Accounts / Ledger' }),
    el('div', { class:'table-card mb-4' }, [
      el('div', { class:'small', text:'Combined totals' }),
      el('div', { class: 'd-grid grid-cols-3 gap-3 mt-2' }, [
        el('div', {}, [
          el('div', { class:'small', text:'Total Owing (Debit)' }),
          el('div', { class: 'font-bold text-xl', text: `₹${MONEY.format(combinedDebit)}` })
        ]),
        el('div', {}, [
          el('div', { class:'small', text:'Total Paid (Credit)' }),
          el('div', { class: 'font-bold text-xl', text: `₹${MONEY.format(combinedCredit)}` })
        ]),
        el('div', {}, [
          el('div', { class:'small', text:'Net Balance' }),
          el('div', { class: 'font-bold text-xl', text: `₹${MONEY.format(combinedNet)}` })
        ])
      ])
    ]),

    el('div', { class:'editBanner', id:'ledgerEditBanner', style:'display:none;' }, [
      el('div', { class:'editBannerTitle', text:'Edit mode' }),
    ]),

    el('p', { class:'muted', text:'Tip: You can add details directly using the ledger entries below (Debit/Owe and Credit/Paid). Also there is a “New Entry” tab for item quantities.' }),

    el('div', { class:'d-grid grid-cols-2 gap-3 mt-4' }, [
      el('div', {}, [el('div', { class:'small', text:'Date' }), el('input', { id:'ledDate', class:'input', type:'date' })]),
      el('div', {}, [el('div', { class:'small', text:'Client' }),
        (()=>{
          const sel = el('select', { id:'ledClient', class:'input' });
          const opt0 = el('option', { value:'', text:'Select client' });
          sel.appendChild(opt0);
          for(const c of clientsOptions){
            const opt = el('option', { value:c.id, text:c.name });
            sel.appendChild(opt);
          }
          return sel;
        })()
      ]),
    ]),

    el('div', { class:'d-grid grid-cols-2 gap-3 mt-3' }, [
      el('div', {}, [el('div', { class:'small', text:'Type' }),
        (()=>{
          const sel = el('select', { id:'ledType', class:'input' });
          sel.appendChild(el('option', { value:'debit', text:'Debit (Client owes)' }));
          sel.appendChild(el('option', { value:'credit', text:'Credit (Client paid)' }));
          return sel;
        })()
      ]),
      el('div', {}, [el('div', { class:'small', text:'Amount (₹)' }), el('input', { id:'ledAmount', class:'input', type:'number', step:'1' })]),
    ]),

    el('div', { class: 'mt-3' }, [
      el('div', { class:'small', text:'Description' }),
      el('input', { id:'ledDesc', class:'input', placeholder:'e.g., Aluminium blanks - invoice #123' })
    ]),

    el('div', { class: 'mt-4 d-flex gap-3' }, [
      el('button', { class:'secondary', id:'btnAddEntry', text:'Add Entry' }),
      el('button', { class:'secondary', id:'btnCancelLedgerEdit', text:'Cancel Edit', style:'display:none;' }),
      el('button', { class:'secondary danger', id:'btnClearLedger', text:'Clear Ledger' }),
    ]),

    el('div', { class: 'mt-4' }, [
      el('h3', { text:'Entries' }),

      el('div', { class:'filterRow' }, [
        el('input', { id:'ledFilterText', class:'input', placeholder:'Search description / client...' }),
        el('select', { id:'ledFilterType', class:'input' }, [
          el('option', { value:'all', text:'All types' }),
          el('option', { value:'debit', text:'Debit (Owe)' }),
          el('option', { value:'credit', text:'Credit (Paid)' }),
        ]),
      ]),

      el('div', { class:'filterRow mt-3' }, [
        el('input', { id:'ledFilterClient', class:'input', placeholder:'Client name contains...' }),
        el('input', { id:'ledFilterFrom', class:'input', type:'date' }),
        el('input', { id:'ledFilterTo', class:'input', type:'date' }),
      ]),
      (()=>{
        const table = el('table', { class:'table' });
        table.appendChild(el('thead', {}, [
          el('tr', {}, [
            el('th', { text:'Date' }),
            el('th', { text:'Client' }),
            el('th', { text:'Type' }),
            el('th', { text:'Description' }),
            el('th', { text:'Debit' }),
            el('th', { text:'Credit' }),
            el('th', { text:'Actions' }),
          ])
        ]));
        const tbody = el('tbody');
        // Filters/search
        const qClient = ($('#ledFilterClient')?.value || '').toLowerCase().trim();
        const qText = ($('#ledFilterText')?.value || '').toLowerCase().trim();
        const qType = ($('#ledFilterType')?.value || 'all');
        const fromDate = ($('#ledFilterFrom')?.value || '');
        const toDate = ($('#ledFilterTo')?.value || '');

        const entries = [...state.ledger]
          .filter(e => {
            const clientName = (state.clients.find(c => c.id === e.clientId)?.name || '').toLowerCase();
            const desc = (e.description || '').toLowerCase();
            if(qClient && !clientName.includes(qClient)) return false;
            if(qText && !(desc.includes(qText) || clientName.includes(qText))) return false;
            if(qType !== 'all' && e.type !== qType) return false;
            if(fromDate && (e.date || '') < fromDate) return false;
            if(toDate && (e.date || '') > toDate) return false;
            return true;
          })
          .sort((a,b)=> (b.date||'').localeCompare(a.date||''));

        // wire filter changes once
        if(!transientState.__ledgerFilterWired){
          const debouncedRender = debounce(renderLedgerView, 250);
          transientState.__ledgerFilterWired = true;
          ['ledFilterText', 'ledFilterClient'].forEach(id => {
            $('#'+id)?.addEventListener('input', debouncedRender);
          });
          ['ledFilterType', 'ledFilterFrom', 'ledFilterTo'].forEach(id => {
            $('#'+id)?.addEventListener('change', renderLedgerView);
          });
        }


        for(const e of entries){
          const c = state.clients.find(x=>x.id===e.clientId);
          const tr = el('tr');
          tr.appendChild(el('td', { text: e.date || '—' }));
          tr.appendChild(el('td', { text: c?.name || '—' }));
          tr.appendChild(el('td', { text: e.type }));
          tr.appendChild(el('td', { text: e.description || '' }));
          tr.appendChild(el('td', { text: e.debit ? MONEY.format(e.debit) : '' }));
          tr.appendChild(el('td', { text: e.credit ? MONEY.format(e.credit) : '' }));
          const actionsTd = el('td', {});
          const editBtn = el('button', { class: 'secondary small', text: 'Edit', onclick: () => editLedgerEntry(e.id) });
          const deleteBtn = el('button', { class: 'secondary small danger ml-2', text: 'Delete', onclick: () => deleteLedgerEntry(e.id) });
          actionsTd.append(editBtn, deleteBtn);
          tr.appendChild(actionsTd);
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        return table;
      })()
    ]),

    el('div', { class: 'mt-4' }, [
      (()=>{
        const card2 = el('div', { class:'table-card' });
        const t = el('div', { class:'small', text: 'Balance per client (Debit - Credit)' });
        card2.appendChild(t);
        const table2 = el('table', { class:'table mt-2' });
        table2.appendChild(el('thead', {}, [
          el('tr', {}, [
            el('th', { text:'Client' }),
            el('th', { text:'Balance (₹)' })
          ])
        ]));
        const tbody2 = el('tbody');
        for(const c of clientsOptions){
          const bal = totals.balanceByClient[c.id] ?? 0;
          const tr = el('tr');
          tr.appendChild(el('td', { text: c.name }));
          tr.appendChild(el('td', { text: MONEY.format(bal) }));
          tbody2.appendChild(tr);
        }
        table2.appendChild(tbody2);
        card2.appendChild(table2);
        return card2;
      })()
    ])
  ]);

  view.appendChild(card);

  $('#btnAddEntry').addEventListener('click', () => {
    const date = $('#ledDate').value;
    const clientId = $('#ledClient').value;
    const type = $('#ledType').value;
    const amount = Number($('#ledAmount').value);
    const description = $('#ledDesc').value.trim();

    if(!date){ toast('Select date', 'danger'); return; }
    if(!clientId){ toast('Select client', 'danger'); return; }
    if(!type){ toast('Select type', 'danger'); return; }
    if(!Number.isFinite(amount) || amount<=0){ toast('Enter amount > 0', 'danger'); return; }

    const editingId = transientState.editingLedgerEntryId;

    if (editingId) {
      const entryIndex = state.ledger.findIndex(e => e.id === editingId);
      if (entryIndex > -1) {
        const prevEntry = { ...state.ledger[entryIndex] }; // Capture for undo
        state.ledger[entryIndex] = {
          ...prevEntry,
          date,
          clientId,
          type,
          description,
          debit: type === 'debit' ? amount : 0,
          credit: type === 'credit' ? amount : 0,
        };

        pushUndo({
          label: 'Entry updated',
          undo: () => {
            const currentIndex = state.ledger.findIndex(e => e.id === editingId);
            if (currentIndex > -1) state.ledger[currentIndex] = prevEntry;
            saveState();
            renderLedgerView();
            if ($('#viewClientDetails').style.display !== 'none') renderClientDetailsView();
            if ($('#viewDashboard').style.display !== 'none') renderDashboardView();
          }
        });
      }
    } else {
      const newEntry = {
        id: uid('l'),
        date,
        clientId,
        type,
        description,
        debit: type === 'debit' ? amount : 0,
        credit: type === 'credit' ? amount : 0
      };
      state.ledger.push(newEntry);

      pushUndo({
        label: 'Entry added',
        undo: () => {
          state.ledger = state.ledger.filter(e => e.id !== newEntry.id);
          saveState();
          renderLedgerView();
          if ($('#viewClientDetails').style.display !== 'none') renderClientDetailsView();
          if ($('#viewDashboard').style.display !== 'none') renderDashboardView();
        }
      });
    }

    transientState.editingLedgerEntryId = undefined; // Clear editing state
    saveState();
    renderLedgerView();
  });

  $('#btnClearLedger').addEventListener('click', () => {
    (async () => {
      const ok = await openConfirmModal({
        title: 'Clear ledger',
        body: 'This removes all ledger entries. You can undo for a few seconds.',
        okText: 'Clear',
        cancelText: 'Cancel'
      });
      if(!ok) return;

      const prevLedger = state.ledger;
      state.ledger = [];
      transientState.editingLedgerEntryId = undefined;
      saveState();
      renderLedgerView();

      pushUndo({
        label: 'Ledger cleared',
        undo: () => {
          state.ledger = prevLedger;
          saveState();
          renderLedgerView();
          if($('#viewClientDetails')?.style?.display !== 'none') renderClientDetailsView();
        }
      });
    })();
  });

  $('#btnCancelLedgerEdit').addEventListener('click', () => {
    transientState.editingLedgerEntryId = undefined;
    renderLedgerView(); // Re-render to reset form
  });

  // If we are in edit mode from another view, populate the form
  if (transientState.editingLedgerEntryId) {
    const entry = state.ledger.find(e => e.id === transientState.editingLedgerEntryId);
    if (entry) {
        $('#ledDate').value = entry.date;
        $('#ledClient').value = entry.clientId;
        $('#ledType').value = entry.type;
        $('#ledAmount').value = entry.debit || entry.credit;
        $('#ledDesc').value = entry.description || '';
        $('#btnAddEntry').textContent = 'Update Entry';
        $('#btnCancelLedgerEdit').style.display = '';

        // Visual edit banner
        const client = state.clients.find(c => c.id === entry.clientId);
        const banner = $('#ledgerEditBanner');
        if(banner){
          banner.style.display = '';
          banner.innerHTML = `Editing: <b>${escapeHtml(client?.name || 'Client')}</b> &bull; ${escapeHtml(entry.type)} &bull; ${escapeHtml(entry.date || '')}`;
        }

        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      transientState.editingLedgerEntryId = undefined; // Not found, clear it
    }
  }
}

function wireNav(){
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');

      const viewName = btn.getAttribute('data-view');
      const viewId = `view${viewName.charAt(0).toUpperCase() + viewName.slice(1)}`;

      document.querySelectorAll('.content > .view').forEach(v => v.style.display = 'none');
      const targetView = $(`#${viewId}`);
      if(targetView) targetView.style.display = '';

      if(viewName === 'clients') renderClientsView();
      if(viewName === 'dashboard') renderDashboardView();
      if(viewName === 'newEntry') renderNewEntryView();
      if(viewName === 'clientDetails') renderClientDetailsView();
      if(viewName === 'ledger') renderLedgerView();
      if(viewName === 'settings') renderSettingsView();
    });
  });
}

function wireLogout() {
    const btnLogout = $('#btnLogout');
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            sessionStorage.removeItem(SESSION_KEY);
            window.location.href = 'login.html';
        });
    }
}



function csvEscape(value){
  const s = value == null ? '' : String(value);
  if(/[\r\n,;"]/.test(s)){
    return '"' + s.replace(/"/g,'""') + '"';
  }
  return s;
}

function downloadText(filename, text, mime='text/csv;charset=utf-8'){
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function parseCsvLine(line){
  // minimal CSV parser for comma-separated values with quotes
  const out = [];
  let cur = '';
  let inQuotes = false;
  for(let i=0;i<line.length;i++){
    const ch = line[i];
    if(inQuotes){
      if(ch === '"'){
        if(line[i+1] === '"'){ cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else {
      if(ch === '"') inQuotes = true;
      else if(ch === ','){ out.push(cur); cur=''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function toNumberOrEmpty(x){
  if(x == null) return '';
  const t = String(x).trim();
  if(t === '') return '';
  const n = Number(t);
  return Number.isFinite(n) ? n : '';
}

function wireCsvImportExport(){
  // CSV format: multiple tables separated by markers
  // #TABLE:CLIENTS
  // header row
  // ...
  // #TABLE:LEDGER
  // header row
  // ...

  $('#btnExportCsv')?.addEventListener('click', () => {
    // ensure specialPricesJson exists

    const lines = [];

    lines.push('#TABLE:CLIENTS');
    lines.push(['id','name','phone','notes','specialPricesJson'].map(csvEscape).join(','));
    for(const c of state.clients){
      lines.push([
        c.id,
        c.name,
        c.phone || '',
        c.notes || '',
        JSON.stringify(c.specialPrices || {}),
      ].map(csvEscape).join(','));
    }

    lines.push('#TABLE:LEDGER');
    // itemsJson is optional
    lines.push(['id','date','clientId','type','description','debit','credit','itemsJson'].map(csvEscape).join(','));
    for(const e of state.ledger){
      lines.push([
        e.id,
        e.date,
        e.clientId,
        e.type,
        e.description || '',
        e.debit || 0,
        e.credit || 0,
        JSON.stringify(e.items || {}),
      ].map(csvEscape).join(','));
    }

    downloadText('aluminium-blank-app-export.csv', lines.join('\n'));
  });

  $('#fileImportCsv')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if(!file) return;

    // replace/block confirm with modal confirm
    const ok = await openConfirmModal({
      title: 'Import CSV',
      body: 'Importing from CSV will replace all existing clients and ledger entries. This cannot be undone.',
      okText: 'Import',
      cancelText: 'Cancel'
    });

    if(!ok){
      e.target.value = ''; // Reset file input so same file can be selected again
      return;
    }

    const text = await file.text();

    const rows = text.replace(/\r\n/g,'\n').split('\n').filter(l=>l.trim().length>0);

    const nextTable = () => null;
    let table = null;

    let clients = [];
    let ledger = [];

    let i = 0;
    while(i < rows.length){
      const line = rows[i].trim();
      if(line.startsWith('#TABLE:')){
        table = line.replace('#TABLE:','').trim().toUpperCase();
        i++;
        const header = parseCsvLine(rows[i] || '');
        i++;

        if(table === 'CLIENTS'){
          while(i < rows.length && !rows[i].startsWith('#TABLE:')){
            const cols = parseCsvLine(rows[i]);
            const obj = Object.fromEntries(header.map((h,idx)=>[h, cols[idx] ?? '']));
            let sp = {};
            try{ sp = obj.specialPricesJson ? JSON.parse(obj.specialPricesJson) : {}; }catch{}
            clients.push({
              id: obj.id || uid('c'),
              name: obj.name || 'Unknown',
              phone: obj.phone || '',
              notes: obj.notes || '',
              specialPrices: sp && typeof sp === 'object' ? sp : {},
            });
            i++;
          }
          continue;
        }

        if(table === 'LEDGER'){
          while(i < rows.length && !rows[i].startsWith('#TABLE:')){
            const cols = parseCsvLine(rows[i]);
            const obj = Object.fromEntries(header.map((h,idx)=>[h, cols[idx] ?? '']));
            let items = {};
            try{ items = obj.itemsJson ? JSON.parse(obj.itemsJson) : {}; }catch{}
            ledger.push({
              id: obj.id || uid('l'),
              date: obj.date || (new Date()).toISOString().slice(0,10),
              clientId: obj.clientId || '',
              type: obj.type || 'debit',
              description: obj.description || '',
              debit: toNumberOrEmpty(obj.debit) || 0,
              credit: toNumberOrEmpty(obj.credit) || 0,
              items: items && typeof items === 'object' ? items : {},
            });
            i++;
          }
          continue;
        }

        // unknown table: skip until next marker
        while(i < rows.length && !rows[i].startsWith('#TABLE:')) i++;
        continue;
      }

      i++;
    }

    state = {
      ...state,
      clients,
      ledger,
    };

    saveState();
    transientState.selectedClientId = undefined;
    renderSettingsView();
    renderClientsView();
    renderLedgerView();
    e.target.value = '';
  });
}


function main(){
  wireNav();
  wireCsvImportExport();
  wireLogout();

  renderDashboardView();
  renderSettingsView();
  renderClientsView();
  renderLedgerView();

  // Set default date
  const d = new Date();
  const iso = d.toISOString().slice(0,10);
  const inp = $('#ledDate');
  if(inp) inp.value = iso;
}

main();
