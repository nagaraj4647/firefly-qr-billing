/* Firefly QR Billing - staff PWA.
   All data stays on this device (localStorage). No server, no account.
   QR codes encode the bare product ID as plain text; lookup is exact string match. */
(function () {
'use strict';

var LS = { settings: 'ff_settings', staff: 'ff_staff', products: 'ff_products', bill: 'ff_bill', session: 'ff_session' };
var CATALOG_SNAPSHOT = '2026-10-29';

/* ---------- Supabase backend ---------- */
var FF_SUPA_URL = 'https://sycyaxqopzmsjuhrbjec.supabase.co';
var FF_SUPA_KEY = 'sb_publishable_fNdqFQRTkguYSIRm6JCDRA_jfOniNum';
var sb = null;
if (typeof window !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function') {
  try { sb = window.supabase.createClient(FF_SUPA_URL, FF_SUPA_KEY); } catch (e) { sb = null; }
}
function rowToProduct(r) {
  return { id: String(r.product_id), name: r.name || '', category: r.category || '', pack: r.pack_unit || '',
    sellPaise: r.selling_price_paise, origPaise: r.original_price_paise, active: true };
}
function productToRow(p) {
  return { product_id: String(p.id), name: p.name, category: p.category || '', pack_unit: p.pack || '',
    selling_price_paise: p.sellPaise, original_price_paise: p.origPaise, updated_at: new Date().toISOString() };
}
function sessInfo() { return load(LS.session, null); }
function isDemoSession() { var s = sessInfo(); return !!(s && s.demo); }
function isAdminSession() { var s = sessInfo(); return !!(s && s.role === 'admin'); }
function fetchProfile(uid) {
  return sb.from('profiles').select('id,email,role,full_name,is_active').eq('id', uid).single()
    .then(function (r) { if (r.error) throw r.error; return r.data; });
}
function signInEmail(email, pass) {
  if (!sb) return Promise.reject(new Error('Backend client failed to load (check connection)'));
  return sb.auth.signInWithPassword({ email: email, password: pass }).then(function (r) {
    if (r.error) throw r.error;
    return fetchProfile(r.data.user.id).then(function (prof) {
      if (prof.is_active === false) {
        return sb.auth.signOut().then(function () { throw new Error('Account disabled - ask the admin'); });
      }
      save(LS.session, { uid: prof.id, email: prof.email, role: prof.role, fullName: prof.full_name, at: Date.now() });
      return prof;
    });
  });
}
function signOutAll() {
  localStorage.removeItem(LS.session);
  if (sb) return sb.auth.signOut().catch(function () { });
  return Promise.resolve();
}
function syncProducts() {
  if (!sb || isDemoSession()) return Promise.resolve(0);
  return sb.from('products').select('product_id,name,category,pack_unit,original_price_paise,selling_price_paise').then(function (r) {
    if (r.error) throw r.error;
    var prods = {};
    (r.data || []).forEach(function (row) { var p = rowToProduct(row); prods[p.id] = p; });
    save(LS.products, prods);
    var s = getSettings() || {}; s.demo = false; save(LS.settings, s);
    return (r.data || []).length;
  });
}
function loadCatalogStatus() {
  if (!sb || isDemoSession()) return Promise.resolve(null);
  return sb.from('app_settings').select('value').eq('key', 'catalog_status').maybeSingle().then(function (r) {
    if (r.error) return null;
    var s = getSettings() || {};
    s.cloudStatus = r.data && r.data.value ? r.data.value : null;
    s.pricesConfirmed = !!(s.cloudStatus && s.cloudStatus.prices_unconfirmed === false);
    save(LS.settings, s);
    return s.cloudStatus;
  }).catch(function () { return null; });
}
function writeCatalogStatus(patch) {
  if (!sb || isDemoSession()) return Promise.resolve();
  var cur = (getSettings() || {}).cloudStatus || {};
  var next = Object.assign({}, cur, patch);
  return sb.from('app_settings').upsert({ key: 'catalog_status', value: next, updated_at: new Date().toISOString() }).then(function (r) {
    if (r.error) throw r.error;
    var s = getSettings() || {};
    s.cloudStatus = next;
    s.pricesConfirmed = next.prices_unconfirmed === false;
    save(LS.settings, s);
  });
}
function cloudImportProducts(list) {
  var rows = list.map(productToRow), i = 0;
  function nextChunk() {
    if (i >= rows.length) return Promise.resolve(rows.length);
    var chunk = rows.slice(i, i + 100); i += 100;
    return sb.from('products').upsert(chunk, { onConflict: 'product_id' }).then(function (r) {
      if (r.error) throw r.error;
      return nextChunk();
    });
  }
  return nextChunk();
}

function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

function getSettings() { return load(LS.settings, null); }
function getProducts() { return load(LS.products, {}); }
function getStaff() { return load(LS.staff, []); }
function getBill() { return load(LS.bill, { lines: [], staffId: null, startedAt: null }); }
function saveBill(b) { save(LS.bill, b); renderBillBadge(); }

/* ---------- money ---------- */
function parseMoneyToPaise(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') { if (!isFinite(v) || v < 0) return null; return Math.round(v * 100); }
  var s = String(v).replace(/[\u20B9,\s]/g, '');
  if (s === '') return null;
  var n = parseFloat(s);
  if (!isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
function fmtRs(paise) {
  if (paise === null || paise === undefined) return '-';
  var r = paise / 100;
  return '\u20B9' + (r % 1 === 0 ? r.toLocaleString('en-IN') : r.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
}

/* ---------- catalog ---------- */
function normId(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && Number.isInteger(v)) return String(v);
  return String(v).trim();
}

/* rows: [{id,name,category,pack,origPaise,sellPaise}] -> {ok, products, errors} */
function validateCatalogRows(rows) {
  var errors = [], products = {}, seen = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i], line = i + 1;
    var id = normId(r.id);
    if (!id) { errors.push('row ' + line + ': empty product ID'); continue; }
    if (seen[id]) { errors.push('row ' + line + ': duplicate product ID ' + id); continue; }
    if (!r.name || !String(r.name).trim()) { errors.push('row ' + line + ': empty name (ID ' + id + ')'); continue; }
    var sell = (typeof r.sellPaise === 'number') ? r.sellPaise : parseMoneyToPaise(r.sellPaise);
    var orig = (typeof r.origPaise === 'number' || r.origPaise === null) ? r.origPaise : parseMoneyToPaise(r.origPaise);
    if (sell === null) { errors.push('row ' + line + ': bad selling price (ID ' + id + ')'); continue; }
    seen[id] = true;
    products[id] = { id: id, name: String(r.name).trim(), category: (r.category || '').trim(), pack: (r.pack || '').trim(), origPaise: orig, sellPaise: sell, active: true };
  }
  return { ok: errors.length === 0, products: products, errors: errors, count: Object.keys(products).length };
}

function importProducts(products, sourceLabel) {
  var s = getSettings() || {};
  save(LS.products, products);
  s.catalogMeta = { rows: Object.keys(products).length, importedAt: new Date().toISOString(), snapshot: CATALOG_SNAPSHOT, source: sourceLabel || 'file' };
  if (!s.demo) s.pricesConfirmed = false;
  save(LS.settings, s);
  return Object.keys(products).length;
}

function getProduct(id) {
  var p = getProducts();
  var prod = p[String(id).trim()];
  return (prod && prod.active !== false) ? prod : null;
}

/* Reads .xlsx/.xls/.csv via SheetJS. Looks for the "Product catalog" sheet (or first sheet
   whose headers match). Returns {products, errors, preview, sheetName, count}. */
function parseCatalogWorkbook(arrayBuffer) {
  var wb = XLSX.read(arrayBuffer, { type: 'array' });
  var wanted = null, sheetName = null;
  for (var i = 0; i < wb.SheetNames.length; i++) {
    var sn = wb.SheetNames[i];
    var grid = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
    if (!grid.length) continue;
    var hdr = grid[0].map(function (h) { return String(h).toLowerCase(); });
    var idIdx = hdr.findIndex(function (h) { return h.indexOf('product id') !== -1; });
    var nameIdx = hdr.findIndex(function (h) { return h.indexOf('product name') !== -1; });
    var sellIdx = hdr.findIndex(function (h) { return h.indexOf('selling price') !== -1; });
    if (idIdx !== -1 && nameIdx !== -1 && sellIdx !== -1) {
      var catIdx = hdr.findIndex(function (h) { return h === 'category'; });
      var packIdx = hdr.findIndex(function (h) { return h.indexOf('pack') !== -1; });
      var origIdx = hdr.findIndex(function (h) { return h.indexOf('original price') !== -1; });
      var rows = [], j;
      for (j = 1; j < grid.length; j++) {
        var g = grid[j];
        if (normId(g[idIdx]) === '') continue;
        var toPaise = function (v) { return (typeof v === 'number' && isFinite(v)) ? Math.round(v * 100) : v; };
        rows.push({ id: g[idIdx], name: g[nameIdx], category: catIdx === -1 ? '' : String(g[catIdx]), pack: packIdx === -1 ? '' : String(g[packIdx]), origPaise: origIdx === -1 ? null : toPaise(g[origIdx]), sellPaise: toPaise(g[sellIdx]) });
      }
      wanted = rows; sheetName = sn;
      break;
    }
  }
  if (!wanted) return { fatal: 'No sheet with Product ID / Product name / Selling price headers found.' };
  var res = validateCatalogRows(wanted);
  res.sheetName = sheetName;
  res.preview = wanted.slice(0, 8).map(function (r) { return { id: normId(r.id), name: String(r.name).slice(0, 28), orig: r.origPaise, sell: r.sellPaise }; });
  return res;
}

/* ---------- demo ---------- */
function demoProducts() {
  return validateCatalogRows([
    { id: 'D1', name: 'DEMO 10cm Sparklers', category: 'Demo', pack: '1 Box', origPaise: 5000, sellPaise: 1000 },
    { id: 'D2', name: 'DEMO Flower Pot Big', category: 'Demo', pack: '1 Box', origPaise: 9000, sellPaise: 1800 },
    { id: 'D3', name: 'DEMO Ground Chakkar', category: 'Demo', pack: '1 PKT', origPaise: 6000, sellPaise: 1200 },
    { id: 'D4', name: 'DEMO Rocket Special', category: 'Demo', pack: '1 PKT', origPaise: 8000, sellPaise: 1600 },
    { id: 'D5', name: 'DEMO 1000 Wala Garland', category: 'Demo', pack: '1 Pcs', origPaise: 40000, sellPaise: 8000 },
    { id: 'D6', name: 'DEMO Colour Matches', category: 'Demo', pack: '1 Box', origPaise: 1500, sellPaise: 300 }
  ]).products;
}
function loadDemo() {
  var s = getSettings() || {};
  s.demo = true; s.pricesConfirmed = false;
  save(LS.settings, s);
  importProducts(demoProducts(), 'demo');
  save(LS.settings, s);
}
function clearDemo() {
  var s = getSettings() || {};
  s.demo = false;
  save(LS.settings, s);
  save(LS.products, {});
}

/* ---------- bill ---------- */
function addToBill(id, qty) {
  var prod = getProduct(id);
  if (!prod) return false;
  qty = Math.max(1, Math.floor(qty) || 1);
  var b = getBill();
  if (!b.startedAt) b.startedAt = new Date().toISOString();
  var line = null;
  for (var i = 0; i < b.lines.length; i++) if (b.lines[i].id === prod.id) { line = b.lines[i]; break; }
  if (line) line.qty += qty; else b.lines.push({ id: prod.id, qty: qty });
  saveBill(b);
  return true;
}
function setBillQty(id, qty) {
  var b = getBill();
  b.lines = b.lines.filter(function (l) { return l.id !== id; });
  if (qty > 0) b.lines.push({ id: id, qty: Math.floor(qty) });
  saveBill(b);
}
function clearBill() { saveBill({ lines: [], staffId: (load(LS.session, {}) || {}).staffId || null, startedAt: null }); }
function billTotalPaise() {
  var b = getBill(), t = 0;
  for (var i = 0; i < b.lines.length; i++) {
    var p = getProduct(b.lines[i].id);
    if (p) t += p.sellPaise * b.lines[i].qty;
  }
  return t;
}
function billCount() { var b = getBill(), n = 0; for (var i = 0; i < b.lines.length; i++) n += b.lines[i].qty; return n; }

/* ---------- PIN ---------- */
function hashPin(pin, salt) {
  var data = new TextEncoder().encode('ff::' + salt + '::' + pin);
  return crypto.subtle.digest('SHA-256', data).then(function (buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  });
}

/* ---------- exports for test page ---------- */
window.FF = {
  load: load, save: save, LS: LS,
  parseMoneyToPaise: parseMoneyToPaise, fmtRs: fmtRs, normId: normId,
  validateCatalogRows: validateCatalogRows, importProducts: importProducts,
  parseCatalogWorkbook: parseCatalogWorkbook,
  getProduct: getProduct, getProducts: getProducts,
  demoProducts: demoProducts, loadDemo: loadDemo, clearDemo: clearDemo,
  addToBill: addToBill, setBillQty: setBillQty, clearBill: clearBill,
  getBill: getBill, billTotalPaise: billTotalPaise, billCount: billCount,
  getSettings: getSettings, getStaff: getStaff,
  rowToProduct: rowToProduct, productToRow: productToRow
};

/* ================= UI ================= */
if (!document.getElementById('app')) return;

var scanner = null, scanning = false, lastScan = { text: null, ts: 0 }, modalOpen = false;
var pendingImport = null, loginTarget = null;

function $(id) { return document.getElementById(id); }
function toast(msg, isErr) {
  var t = $('toast');
  t.textContent = msg; t.className = 'toast' + (isErr ? ' err' : '');
  clearTimeout(t._h); t._h = setTimeout(function () { t.classList.add('hidden'); }, 2600);
}
function vibrate() { if (navigator.vibrate) navigator.vibrate(60); }

function showScreen(id) {
  var screens = document.querySelectorAll('.screen');
  for (var i = 0; i < screens.length; i++) screens[i].classList.add('hidden');
  $(id).classList.remove('hidden');
  var navs = document.querySelectorAll('.navBtn');
  for (var j = 0; j < navs.length; j++) navs[j].classList.toggle('active', navs[j].getAttribute('data-screen') === id);
  if (id !== 'screen-scan') stopScanner();
  if (id === 'screen-scan') onEnterScan();
  if (id === 'screen-bill') renderBill();
  if (id === 'screen-catalog') renderCatalog();
  if (id === 'screen-admin') renderAdmin();
}

function refreshBanners() {
  var s = getSettings() || {}, hasCat = Object.keys(getProducts()).length > 0;
  var sess = sessInfo();
  var inDemo = !!(sess && sess.demo);
  $('priceBanner').classList.toggle('hidden', !(hasCat && sess && !inDemo && !s.pricesConfirmed));
  $('demoBanner').classList.toggle('hidden', !inDemo);
}

/* ---------- login ---------- */
function renderLogin() {
  $('loginEmail').value = ''; $('loginPass').value = ''; $('loginMsg').textContent = '';
}
function doLogin() {
  var email = $('loginEmail').value.trim(), pass = $('loginPass').value;
  if (!email || !pass) { toast('Email and password required', true); return; }
  $('loginMsg').textContent = 'Signing in...';
  signInEmail(email, pass).then(function (prof) {
    $('loginMsg').textContent = '';
    afterLogin('Welcome ' + (prof.full_name || prof.email));
  }).catch(function (e) {
    $('loginMsg').textContent = '';
    toast('Login failed: ' + (e && e.message ? e.message : 'check email/password'), true);
  });
}
function afterLogin(msg) {
  enterApp();
  toast(msg || 'Signed in');
  syncProducts().then(function (n) {
    if (n > 0) toast(n + ' products synced');
    return loadCatalogStatus();
  }).then(function () {
    refreshBanners(); renderCatalog(); renderBill(); onEnterScan();
  }).catch(function () {
    toast('Catalog sync failed - using data cached on this device', true);
    refreshBanners(); renderCatalog(); renderBill(); onEnterScan();
  });
}
function enterApp() {
  $('screen-login').classList.add('hidden');
  $('bottomNav').classList.remove('hidden');
  $('logoutBtn').classList.remove('hidden');
  var navs = document.querySelectorAll('.navBtn');
  for (var i = 0; i < navs.length; i++) {
    if (navs[i].getAttribute('data-screen') === 'screen-admin') navs[i].classList.toggle('hidden', !isAdminSession() && !isDemoSession());
  }
  refreshBanners();
  showScreen('screen-scan');
}
function logout() {
  stopScanner();
  signOutAll().then(function () {
    $('bottomNav').classList.add('hidden');
    $('logoutBtn').classList.add('hidden');
    showScreen('screen-login');
    renderLogin();
  });
}

/* ---------- scanner ---------- */
function onEnterScan() {
  var hasCat = Object.keys(getProducts()).length > 0;
  $('noCatalog').classList.toggle('hidden', hasCat);
  if (hasCat && !scanning) startScanner();
}
function startScanner() {
  if (scanning || typeof Html5Qrcode === 'undefined') return;
  $('startCamBtn').style.display = 'none';
  if (!scanner) scanner = new Html5Qrcode('scanReader');
  scanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 220, height: 220 }, rememberLastUsedCamera: true },
    onScanSuccess,
    function () { }
  ).then(function () { scanning = true; })
   .catch(function (err) {
     scanning = false;
     $('startCamBtn').style.display = 'block';
     var msg = String(err || '');
     if (/NotAllowed|Permission/i.test(msg)) toast('Camera permission denied. Allow camera or enter the product ID manually.', true);
     else toast('Camera not started: ' + msg.slice(0, 90), true);
   });
}
function stopScanner() {
  if (scanner && scanning) { scanner.stop().catch(function () { }); scanning = false; }
}
function onScanSuccess(text) {
  var now = Date.now();
  text = String(text || '').trim();
  if (!text || modalOpen) return;
  if (text === lastScan.text && now - lastScan.ts < 2000) return;
  lastScan = { text: text, ts: now };
  lookupAndShow(text);
}
function lookupAndShow(idText) {
  var prod = getProduct(idText);
  if (!prod) { toast('Unknown QR - product not in catalog (ID: ' + idText + ')', true); return; }
  showProductModal(prod);
}

/* ---------- product modal ---------- */
var modalProd = null;
function showProductModal(prod) {
  modalProd = prod; modalOpen = true;
  if (scanner && scanning) { try { scanner.pause(true); } catch (e) { } }
  $('pmName').textContent = prod.name;
  $('pmMeta').textContent = 'ID ' + prod.id + (prod.category ? ' | ' + prod.category : '') + (prod.pack ? ' | ' + prod.pack : '');
  $('pmPrices').innerHTML = '<span class="sell">' + fmtRs(prod.sellPaise) + '</span>' +
    (prod.origPaise ? '<span class="orig">' + fmtRs(prod.origPaise) + '</span>' : '');
  $('qtyInput').value = 1;
  $('modal').classList.remove('hidden');
}
function closeModal() {
  modalOpen = false; modalProd = null;
  $('modal').classList.add('hidden');
  if (scanner && scanning) { try { scanner.resume(); } catch (e) { } }
}

/* ---------- bill UI ---------- */
function renderBill() {
  var b = getBill(), box = $('billLines');
  box.innerHTML = '';
  var sess = load(LS.session, {});
  var staffName = sess.fullName || '';
  $('billMeta').textContent = (staffName ? 'Staff: ' + staffName + ' | ' : '') + (b.startedAt ? 'Started ' + new Date(b.startedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '');
  $('billEmpty').classList.toggle('hidden', b.lines.length > 0);
  $('billFooter').classList.toggle('hidden', b.lines.length === 0);
  b.lines.forEach(function (l) {
    var p = getProduct(l.id);
    if (!p) return;
    var div = document.createElement('div');
    div.className = 'bill-line';
    div.innerHTML =
      '<div class="row1"><span class="name">' + esc(p.name) + ' <span class="muted small">(' + esc(p.pack || '') + ')</span></span>' +
      '<button class="rm" data-id="' + esc(p.id) + '">\u00D7</button></div>' +
      '<div class="row2"><span class="muted small">' + fmtRs(p.sellPaise) + ' each</span>' +
      '<span class="qty-ctrl"><button class="btn qm" data-id="' + esc(p.id) + '">-</button><span>' + l.qty + '</span><button class="btn qp" data-id="' + esc(p.id) + '">+</button></span>' +
      '<span class="amt">' + fmtRs(p.sellPaise * l.qty) + '</span></div>';
    box.appendChild(div);
  });
  $('billTotal').textContent = fmtRs(billTotalPaise());
  box.querySelectorAll('.rm').forEach(function (btn) { btn.onclick = function () { setBillQty(btn.getAttribute('data-id'), 0); renderBill(); }; });
  box.querySelectorAll('.qm').forEach(function (btn) { btn.onclick = function () { var id = btn.getAttribute('data-id'); var l = findLine(id); setBillQty(id, (l ? l.qty : 1) - 1); renderBill(); }; });
  box.querySelectorAll('.qp').forEach(function (btn) { btn.onclick = function () { var id = btn.getAttribute('data-id'); addToBill(id, 1); renderBill(); }; });
}
function findLine(id) { var b = getBill(); for (var i = 0; i < b.lines.length; i++) if (b.lines[i].id === id) return b.lines[i]; return null; }
function renderBillBadge() {
  var n = billCount(), el = $('billBadge');
  if (!el) return;
  el.textContent = n; el.classList.toggle('hidden', n === 0);
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/* ---------- catalog tab ---------- */
function renderCatalog() {
  var q = ($('catSearch').value || '').toLowerCase();
  var prods = Object.values(getProducts());
  var list = $('catList'); list.innerHTML = '';
  var shown = 0;
  prods.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  for (var i = 0; i < prods.length && shown < 80; i++) {
    var p = prods[i];
    if (q && (p.name + ' ' + p.category + ' ' + p.id).toLowerCase().indexOf(q) === -1) continue;
    var d = document.createElement('div');
    d.className = 'cat-item';
    d.innerHTML = '<span>' + esc(p.name) + '<br><span class="id">ID ' + esc(p.id) + ' | ' + esc(p.category) + ' | ' + esc(p.pack) + '</span></span><span class="pr">' + fmtRs(p.sellPaise) + '</span>';
    list.appendChild(d);
    shown++;
  }
  if (!shown) list.innerHTML = '<p class="muted" style="margin-top:10px">No products found.</p>';
}

/* ---------- admin ---------- */
function renderAdmin() {
  if (!isAdminSession() && !isDemoSession()) { toast('Admin access only', true); showScreen('screen-scan'); return; }
  var s = getSettings() || {};
  renderStaffAdmin();
  var cb = $('priceConfirmBtn');
  cb.textContent = s.pricesConfirmed ? 'Prices confirmed \u2713 (tap to un-confirm)' : 'Mark prices confirmed';
  cb.className = 'btn' + (s.pricesConfirmed ? ' primary' : '');
  renderAdminProducts();
}
function renderAdminProducts() {
  var q = ($('admSearch').value || '').toLowerCase();
  var prods = Object.values(getProducts());
  var list = $('admList'); list.innerHTML = '';
  var shown = 0;
  for (var i = 0; i < prods.length && shown < 30; i++) {
    var p = prods[i];
    if (q && (p.name + ' ' + p.id).toLowerCase().indexOf(q) === -1) continue;
    var d = document.createElement('div');
    d.className = 'staff-row';
    d.innerHTML = '<span class="small">' + esc(p.name) + ' <span class="muted">(ID ' + esc(p.id) + ')</span><br>' + fmtRs(p.sellPaise) + '</span>';
    var ed = document.createElement('button');
    ed.className = 'btn small'; ed.textContent = 'Edit';
    (function (pp) { ed.onclick = function () { editProduct(pp); }; })(p);
    d.appendChild(ed);
    list.appendChild(d);
    shown++;
  }
  if (!shown) list.innerHTML = '<p class="muted small">No products.</p>';
}
function editProduct(p) {
  var name = prompt('Name', p.name); if (name === null) return;
  var sell = prompt('Selling price (Rs)', p.sellPaise / 100); if (sell === null) return;
  var orig = prompt('Original price (Rs)', p.origPaise === null ? '' : p.origPaise / 100); if (orig === null) return;
  var pack = prompt('Pack / unit', p.pack); if (pack === null) return;
  var sp = parseMoneyToPaise(sell), op = orig.trim() === '' ? null : parseMoneyToPaise(orig);
  if (sp === null) { toast('Bad selling price', true); return; }
  var prods = getProducts();
  prods[p.id] = Object.assign({}, p, { name: name.trim() || p.name, sellPaise: sp, origPaise: op, pack: pack.trim() });
  save(LS.products, prods);
  if (sb && !isDemoSession()) {
    sb.from('products').update({ name: prods[p.id].name, selling_price_paise: sp, original_price_paise: op, pack_unit: prods[p.id].pack, updated_at: new Date().toISOString() }).eq('product_id', p.id).then(function (r) {
      if (r.error) toast('Cloud save failed: ' + r.error.message, true);
    });
  }
  toast('Saved ' + p.id);
  renderAdminProducts(); refreshBanners();
}
function renderStaffAdmin() {
  var list = $('staffAdminList'); list.innerHTML = '';
  if (!sb || isDemoSession() || !isAdminSession()) { list.innerHTML = '<p class="muted small">Staff accounts are managed by the admin (cloud).</p>'; return; }
  var me = sessInfo();
  list.innerHTML = '<p class="muted small">Loading...</p>';
  sb.from('profiles').select('id,email,role,full_name,is_active').order('created_at').then(function (r) {
    if (r.error) { list.innerHTML = '<p class="muted small">Could not load staff: ' + esc(r.error.message) + '</p>'; return; }
    list.innerHTML = '';
    (r.data || []).forEach(function (st) {
      var d = document.createElement('div');
      d.className = 'staff-row';
      d.innerHTML = '<span>' + esc(st.full_name || st.email) + ' <span class="muted small">(' + esc(st.role) + ')</span>' + (st.is_active === false ? ' <span class="muted small">(disabled)</span>' : '') + '</span>';
      if (!me || st.id !== me.uid) {
        var tog = document.createElement('button'); tog.className = 'btn small'; tog.textContent = st.is_active === false ? 'Enable' : 'Disable';
        tog.onclick = function () {
          sb.from('profiles').update({ is_active: st.is_active === false, updated_at: new Date().toISOString() }).eq('id', st.id).then(function (rr) {
            if (rr.error) { toast('Update failed: ' + rr.error.message, true); return; }
            renderStaffAdmin();
          });
        };
        d.appendChild(tog);
      }
      list.appendChild(d);
    });
  });
}

/* ---------- import UI ---------- */
function handleImportFile(file) {
  var reader = new FileReader();
  reader.onload = function () {
    try {
      var res = parseCatalogWorkbook(reader.result);
      var pv = $('importPreview');
      if (res.fatal) { pv.innerHTML = '<p class="muted">' + esc(res.fatal) + '</p>'; return; }
      var html = '<p class="small">Sheet: <b>' + esc(res.sheetName) + '</b> | rows: <b>' + res.count + '</b></p>';
      if (res.errors.length) {
        html += '<p class="small" style="color:#f87171">Errors (' + res.errors.length + '):<br>' + res.errors.slice(0, 10).map(esc).join('<br>') + '</p>';
        pv.innerHTML = html; pendingImport = null; return;
      }
      html += '<table><tr><th>ID</th><th>Name</th><th>Sell</th></tr>' +
        res.preview.map(function (r) { return '<tr><td>' + esc(r.id) + '</td><td>' + esc(r.name) + '</td><td>' + esc(String(r.sell)) + '</td></tr>'; }).join('') + '</table>';
      html += '<button id="confirmImport" class="btn primary">Import ' + res.count + ' products</button>';
      pv.innerHTML = html;
      pendingImport = res;
      $('confirmImport').onclick = function () {
        var toImport = pendingImport; pendingImport = null;
        $('importPreview').innerHTML = '<p class="small">Importing...</p>';
        var finish = function () {
          var n = importProducts(toImport.products, 'file:' + (file.name || 'catalog'));
          var st = getSettings(); st.demo = false; save(LS.settings, st);
          $('importPreview').innerHTML = '<p class="small" style="color:#4ade80">Imported ' + n + ' products.</p>';
          refreshBanners(); renderCatalog(); toast(n + ' products imported');
        };
        if (sb && !isDemoSession() && isAdminSession()) {
          cloudImportProducts(toImport.products).then(function (n) {
            return writeCatalogStatus({ total_products: n, prices_unconfirmed: true, confirmed_at: null, imported_at: new Date().toISOString() });
          }).then(finish).catch(function (e) {
            $('importPreview').innerHTML = '<p class="small" style="color:#f87171">Cloud import failed: ' + esc(e && e.message ? e.message : String(e)) + ' - catalog NOT imported. Check connection and retry.</p>';
          });
        } else {
          finish();
        }
      };
    } catch (e) {
      $('importPreview').innerHTML = '<p class="muted">Could not read file: ' + esc(String(e).slice(0, 120)) + '</p>';
    }
  };
  reader.readAsArrayBuffer(file);
}

/* ---------- events ---------- */
function bind() {
  var navs = document.querySelectorAll('.navBtn');
  for (var i = 0; i < navs.length; i++) navs[i].onclick = function () { showScreen(this.getAttribute('data-screen')); };
  $('logoutBtn').onclick = logout;

  $('loginBtn').onclick = doLogin;
  $('loginPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  $('forgotLink').onclick = function () {
    var email = $('loginEmail').value.trim();
    if (!email) { toast('Type your email first, then tap Forgot password', true); return; }
    if (!sb) { toast('Backend not loaded - check connection', true); return; }
    sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }).then(function (r) {
      if (r.error) toast('Reset failed: ' + r.error.message, true);
      else toast('Reset email sent - open the link on THIS device');
    });
  };
  $('resetSave').onclick = function () {
    var p1 = $('resetPass1').value, p2 = $('resetPass2').value;
    if (p1.length < 6) { toast('Password must be at least 6 characters', true); return; }
    if (p1 !== p2) { toast('Passwords do not match', true); return; }
    sb.auth.updateUser({ password: p1 }).then(function (r) {
      if (r.error) { toast('Could not save: ' + r.error.message, true); return; }
      toast('Password saved - sign in now');
      $('resetBox').classList.add('hidden');
      $('resetPass1').value = ''; $('resetPass2').value = '';
    });
  };
  if (sb) {
    sb.auth.onAuthStateChange(function (event) {
      if (event === 'PASSWORD_RECOVERY') {
        showScreen('screen-login'); renderLogin();
        $('resetBox').classList.remove('hidden');
        toast('Set your new password below');
      }
    });
  }
  $('demoLink').onclick = function () {
    loadDemo();
    save(LS.session, { role: 'staff', fullName: 'Demo', demo: true, at: Date.now() });
    refreshBanners(); enterApp(); toast('Demo preview - sample products only');
  };

  $('startCamBtn').onclick = startScanner;
  $('manualGo').onclick = function () {
    var v = $('manualId').value.trim();
    if (v) { lookupAndShow(v); $('manualId').value = ''; }
  };
  $('manualId').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('manualGo').click(); });

  $('qtyMinus').onclick = function () { var q = Math.max(1, (parseInt($('qtyInput').value, 10) || 1) - 1); $('qtyInput').value = q; };
  $('qtyPlus').onclick = function () { $('qtyInput').value = (parseInt($('qtyInput').value, 10) || 1) + 1; };
  $('pmAdd').onclick = function () {
    if (!modalProd) return;
    var q = Math.max(1, parseInt($('qtyInput').value, 10) || 1);
    addToBill(modalProd.id, q);
    vibrate();
    toast('Added ' + q + ' \u00D7 ' + modalProd.name);
    closeModal();
  };
  $('pmClose').onclick = closeModal;

  $('clearBillBtn').onclick = function () {
    if (confirm('Clear current bill and start a new one?')) { clearBill(); renderBill(); }
  };
  $('catSearch').oninput = renderCatalog;
  $('admSearch').oninput = renderAdminProducts;

  $('importFile').onchange = function () { if (this.files && this.files[0]) handleImportFile(this.files[0]); };
  $('demoBtn1').onclick = $('demoBtn2').onclick = function () { loadDemo(); refreshBanners(); toast('Demo products loaded'); $('noCatalog').classList.add('hidden'); onEnterScan(); };
  $('demoClear').onclick = function () { clearDemo(); clearBill(); refreshBanners(); renderAdmin(); toast('Demo cleared'); };

  $('npAdd').onclick = function () {
    var id = $('npId').value.trim();
    if (!id) { toast('ID required', true); return; }
    var prods = getProducts();
    if (prods[id]) { toast('ID already exists', true); return; }
    var sp = parseMoneyToPaise($('npSell').value);
    if (sp === null || !$('npName').value.trim()) { toast('Name and valid selling price required', true); return; }
    prods[id] = { id: id, name: $('npName').value.trim(), category: $('npCat').value.trim(), pack: $('npPack').value.trim(), origPaise: parseMoneyToPaise($('npOrig').value), sellPaise: sp, active: true };
    save(LS.products, prods);
    if (sb && !isDemoSession()) {
      sb.from('products').insert(productToRow(prods[id])).then(function (r) {
        if (r.error) toast('Cloud save failed: ' + r.error.message, true);
      });
    }
    ['npId', 'npName', 'npCat', 'npPack', 'npOrig', 'npSell'].forEach(function (x) { $(x).value = ''; });
    renderAdminProducts(); toast('Product added');
  };

  $('nsAdd').onclick = function () {
    var name = $('nsName').value.trim(), email = $('nsEmail').value.trim(), pass = $('nsPass').value;
    if (!name || !email || pass.length < 6) { toast('Staff name, email and password (min 6 chars) required', true); return; }
    if (!sb) { toast('Backend not loaded - check connection', true); return; }
    sb.rpc('admin_create_staff_user', { p_email: email, p_password: pass, p_full_name: name, p_role: 'staff' }).then(function (r) {
      if (r.error) { toast('Could not add staff: ' + r.error.message, true); return; }
      $('nsName').value = ''; $('nsEmail').value = ''; $('nsPass').value = '';
      renderStaffAdmin(); toast('Staff account created - share the email + password with them');
    });
  };

  $('priceConfirmBtn').onclick = function () {
    var s = getSettings();
    var next = !s.pricesConfirmed;
    var done = function () { refreshBanners(); renderAdmin(); };
    if (sb && !isDemoSession()) {
      writeCatalogStatus({ prices_unconfirmed: !next, confirmed_at: next ? new Date().toISOString() : null }).then(done).catch(function (e) {
        toast('Save failed: ' + (e && e.message ? e.message : String(e)), true);
      });
    } else {
      s.pricesConfirmed = next; save(LS.settings, s); done();
    }
  };

  $('apChange').onclick = function () {
    var np = $('apNew').value;
    if (np.length < 6) { toast('New password must be at least 6 characters', true); return; }
    if (!sb) { toast('Backend not loaded - check connection', true); return; }
    sb.auth.updateUser({ password: np }).then(function (r) {
      if (r.error) { toast('Password change failed: ' + r.error.message, true); return; }
      $('apNew').value = ''; toast('Password changed');
    });
  };

  $('clearAllBtn').onclick = function () {
    if (confirm('Clear cached data (catalog copy, current bill, login session) on THIS device? Cloud data stays safe.')) {
      Object.keys(LS).forEach(function (k) { localStorage.removeItem(LS[k]); });
      signOutAll().then(function () { location.reload(); });
    }
  };
}

document.addEventListener('DOMContentLoaded', function () {
  bind();
  renderBillBadge(); refreshBanners();
  var sess = sessInfo();
  if (sess && sess.demo) { enterApp(); }
  else if (sess && sb) {
    sb.auth.getSession().then(function (r) {
      if (r.data && r.data.session) {
        enterApp();
        syncProducts().then(loadCatalogStatus).then(function () { refreshBanners(); renderCatalog(); renderBill(); }).catch(function () { });
      } else {
        localStorage.removeItem(LS.session);
        showScreen('screen-login'); renderLogin();
      }
    }).catch(function () {
      enterApp(); // offline: cached catalog + bill keep working
    });
  } else { showScreen('screen-login'); renderLogin(); }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () { });
});

})();
