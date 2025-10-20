// Replaces your current function
async function renderCandidateRatesTable(rates){
  const div = byId('ratesTable'); if (!div) return;

  // Build a lookup of client_id -> client name
  let clientsById = {};
  try {
    const clients = await listClientsBasic(); // [{id,name}]
    clientsById = Object.fromEntries((clients || []).map(c => [c.id, c.name]));
  } catch (e) {
    console.error('Failed to load clients for candidate rates table', e);
  }

  // Empty state but keep the add button visible
  if (!rates || !rates.length) {
    div.innerHTML = `
      <div class="hint" style="margin-bottom:8px">No candidate-specific rates. Client defaults will apply.</div>
      <div class="actions"><button id="btnAddRate">Add rate override</button></div>
    `;
    const addBtn = byId('btnAddRate');
    if (addBtn) addBtn.onclick = () => openCandidateRateModal(modalCtx.data?.id);
    return;
  }

  // Desired column order + friendly headers
  const cols    = ['client','role','band','pay_day','pay_night','pay_sat','pay_sun','pay_bh','date_from','date_to'];
  const headers = ['Client','Role','Band','Pay Day','Pay Night','Pay Sat','Pay Sun','Pay BH','Date from','Date to'];

  // Enrich rows with client name
  const rows = (rates || []).map(r => ({
    ...r,
    client: clientsById[r.client_id] || ''   // show Client name instead of client_id
  }));

  // Build table
  const tbl   = document.createElement('table'); tbl.className = 'grid';
  const thead = document.createElement('thead');
  const trh   = document.createElement('tr');
  headers.forEach(h => { const th = document.createElement('th'); th.textContent = h; trh.appendChild(th); });
  thead.appendChild(trh); tbl.appendChild(thead);

  const tb = document.createElement('tbody');
  rows.forEach(r => {
    const tr = document.createElement('tr');

    // Double-click to EDIT
    tr.ondblclick = () => openCandidateRateModal(modalCtx.data?.id, r);

    cols.forEach(c => {
      const td = document.createElement('td');
      // Use your formatter for dates/numbers; 'client' is already a name string
      td.textContent = formatDisplayValue(c, r[c]);
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);

  // Footer actions
  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.innerHTML = `<button id="btnAddRate">Add rate override</button>`;

  // Render
  div.innerHTML = '';
  div.appendChild(tbl);
  div.appendChild(actions);

  // Bind after DOM is present
  const addBtn = byId('btnAddRate');
  if (addBtn) addBtn.onclick = () => openCandidateRateModal(modalCtx.data?.id);
}
