(function () {
  var out = [], pass = 0, fail = 0;
  function log(m) { out.push(m); document.getElementById('out').textContent = out.join('\n'); }
  function ok(name, cond) { if (cond) { pass++; log('PASS ' + name); } else { fail++; log('FAIL ' + name); } }
  function run() {
    localStorage.clear();
    // 1. demo catalog loads
    FF.loadDemo();
    var prods = FF.getProducts();
    ok('demo catalog loads 6 products', Object.keys(prods).length === 6);
    // 2. exact lookup, string IDs
    ok('lookup D1 returns product', FF.getProduct('D1') && FF.getProduct('D1').name.indexOf('DEMO') === 0);
    ok('lookup with whitespace trims', !!FF.getProduct('  D2  '));
    // 3. unknown ID
    ok('unknown ID 999999 returns null', FF.getProduct('999999') === null);
    ok('partial ID D returns null (no partial match)', FF.getProduct('D') === null);
    // 4. bill math in paise: 3x D1 (Rs10) + 2x D5 (Rs80) = Rs190
    FF.clearBill();
    FF.addToBill('D1', 3); FF.addToBill('D5', 2);
    ok('total = 19000 paise', FF.billTotalPaise() === 19000);
    ok('count = 5', FF.billCount() === 5);
    // rescan increments, no duplicate line
    FF.addToBill('D1', 1);
    ok('rescan increments same line', FF.getBill().lines.length === 2 && FF.billTotalPaise() === 20000);
    // 5. survives refresh = re-read from localStorage
    var raw = JSON.parse(localStorage.getItem(FF.LS.bill));
    ok('bill persisted in localStorage', raw && raw.lines && raw.lines.length === 2);
    // 6. validation: duplicates and bad prices rejected
    var bad = FF.validateCatalogRows([
      { id: '1', name: 'A', sellPaise: 100 },
      { id: '1', name: 'B', sellPaise: 200 },
      { id: '2', name: 'C', sellPaise: 'abc' },
      { id: '', name: 'D', sellPaise: 100 }
    ]);
    ok('duplicate ID rejected', bad.errors.some(function (e) { return e.indexOf('duplicate') !== -1; }));
    ok('bad price rejected', bad.errors.some(function (e) { return e.indexOf('selling price') !== -1; }));
    ok('empty ID rejected', bad.errors.some(function (e) { return e.indexOf('empty product ID') !== -1; }));
    // 7. re-import replaces, no duplicates
    var v = FF.validateCatalogRows([{ id: '2', name: 'Kuruvi', sellPaise: 900 }, { id: '438', name: 'Pipe Shot', sellPaise: 34000 }]);
    FF.importProducts(v.products, 'test');
    FF.importProducts(v.products, 'test');
    ok('re-import keeps exactly 2 products (no dupes)', Object.keys(FF.getProducts()).length === 2);
    // 8. integer-string IDs from numbers (Excel numeric cells)
    ok('numeric cell 2 normalizes to "2"', FF.normId(2) === '2');
    ok('money parse "Rs 1,234" = 123400 paise', FF.parseMoneyToPaise('\u20B9 1,234') === 123400);
    ok('money parse 45.0 = 4500 paise', FF.parseMoneyToPaise(45.0) === 4500);
    // done
    log('---');
    // 9. Supabase row <-> product mapping round trip
    var row = FF.productToRow({ id: '438', name: 'Pipe Shot', category: 'Magic Pipes', pack: '1 Box', sellPaise: 34000, origPaise: 170000 });
    ok('productToRow maps paise + text id', row.product_id === '438' && row.selling_price_paise === 34000 && row.pack_unit === '1 Box');
    var back = FF.rowToProduct(row);
    ok('rowToProduct round trip', back.id === '438' && back.sellPaise === 34000 && back.origPaise === 170000 && back.name === 'Pipe Shot');
    log('RESULT: ' + pass + ' passed, ' + fail + ' failed');
    document.title = fail === 0 ? 'FF-TESTS-PASS' : 'FF-TESTS-FAIL-' + fail;
    window.FF_TEST_RESULT = { pass: pass, fail: fail };
  }
  try { run(); } catch (e) { log('EXCEPTION: ' + e.message); document.title = 'FF-TESTS-ERROR'; }
  // real sticker decode via the same library the scanner uses
  document.getElementById('sticker').addEventListener('change', function (ev) {
    var f = ev.target.files[0];
    if (!f) return;
    var el = document.getElementById('scanout');
    var h = new Html5Qrcode('sticker', { verbose: false });
    h.scanFile(f, false).then(function (text) {
      el.textContent = 'sticker decoded: "' + text + '"';
      window.FF_STICKER = text;
    }).catch(function (err) {
      el.textContent = 'sticker decode failed: ' + err;
      window.FF_STICKER = 'ERROR';
    });
  });
})();
