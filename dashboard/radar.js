// Token Launch Radar — dashboard logic. Reads window.RADAR (rows.js, written
// by main.ts) and renders the board, the filters, and one protocol's detail
// view. No network: every figure comes from the snapshot data in rows.js.

(function () {
  'use strict';
  var D = window.RADAR;
  if (!D || !D.rows) return;

  // Row layout from main.ts: [slug, name, category, chains, tvl, change7d,
  // implied, listed, mcap, live, watchlist, band, gasKey, stepIds]
  var R = { slug: 0, name: 1, cat: 2, chains: 3, tvl: 4, chg: 5, val: 6, listed: 7, mcap: 8, live: 9, wl: 10, band: 11, gas: 12, steps: 13 };

  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(window.location.search);

  function fmtUSD(v) {
    if (v === null || v === undefined) return '—';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(v);
  }
  function fmtPct(v) {
    if (v === null || v === undefined) return '—';
    return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  function fillStep(tpl, row) {
    return tpl.split('{N}').join(row[R.name])
      .split('{C}').join(row[R.chains][0] || 'Ethereum')
      .split('{A}').join(D.amounts[row[R.band]])
      .split('{G}').join(D.gas[row[R.gas]]);
  }

  // ---- controls ----------------------------------------------------------
  var cats = [], chains = [];
  D.rows.forEach(function (r) {
    if (r[R.cat] && cats.indexOf(r[R.cat]) < 0) cats.push(r[R.cat]);
    r[R.chains].forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  cats.forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = c; $('cat').appendChild(o); });
  chains.forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = c; $('chain').appendChild(o); });

  var state = {
    q: params.get('q') || '',
    cat: params.get('cat') || '',
    chain: params.get('chain') || '',
    status: params.get('status') || '',
    sort: params.get('sort') || 'rank',
    slug: params.get('slug') || '',
  };
  $('q').value = state.q; $('cat').value = state.cat; $('chain').value = state.chain;
  $('status').value = state.status; $('sort').value = state.sort;

  function syncUrl() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.cat) p.set('cat', state.cat);
    if (state.chain) p.set('chain', state.chain);
    if (state.status) p.set('status', state.status);
    if (state.sort !== 'rank') p.set('sort', state.sort);
    if (state.slug) p.set('slug', state.slug);
    var qs = p.toString();
    history.replaceState(null, '', qs ? '?' + qs : window.location.pathname);
  }

  // ---- stats -------------------------------------------------------------
  $('asof').textContent = D.asOf;
  var pre = D.rows.filter(function (r) { return !r[R.live]; }).length;
  var wl = D.rows.filter(function (r) { return r[R.wl]; }).length;
  var topVal = D.rows.length ? D.rows[0][R.val] : 0;
  $('stats').innerHTML =
    '<div class="stat"><b>' + D.rows.length + '</b><span>protocols ranked</span></div>' +
    '<div class="stat"><b>' + wl + '</b><span>watchlist covered</span></div>' +
    '<div class="stat"><b>' + pre + '</b><span>pre-token</span></div>' +
    '<div class="stat"><b>' + fmtUSD(topVal) + '</b><span>top implied value</span></div>';

  // ---- board -------------------------------------------------------------
  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var list = D.rows.filter(function (r) {
      if (q && r[R.name].toLowerCase().indexOf(q) < 0 && r[R.slug].toLowerCase().indexOf(q) < 0) return false;
      if (state.cat && r[R.cat] !== state.cat) return false;
      if (state.chain && r[R.chains].indexOf(state.chain) < 0) return false;
      if (state.status === 'pre' && r[R.live]) return false;
      if (state.status === 'live' && !r[R.live]) return false;
      if (state.status === 'wl' && !r[R.wl]) return false;
      return true;
    });
    var sorted = list.slice();
    if (state.sort === 'value') sorted.sort(function (a, b) { return b[R.val] - a[R.val]; });
    else if (state.sort === 'tvl') sorted.sort(function (a, b) { return b[R.tvl] - a[R.tvl]; });
    else if (state.sort === 'change') sorted.sort(function (a, b) { return (b[R.chg] === null ? -1e9 : b[R.chg]) - (a[R.chg] === null ? -1e9 : a[R.chg]); });
    return sorted; // rank order is the array order of D.rows
  }

  function rankOf(row) { return D.rows.indexOf(row) + 1; }

  function render() {
    var list = visibleRows();
    var tb = $('rows');
    tb.textContent = '';
    list.forEach(function (r) {
      var tr = document.createElement('tr');
      if (r[R.slug] === state.slug) tr.className = 'sel';
      tr.addEventListener('click', function () { select(r[R.slug], true); });
      var cells = [
        { t: String(rankOf(r)), cls: 'num rank' },
        { t: r[R.name], cls: 'name', sub: r[R.slug] },
        { t: r[R.cat] || '—', cls: '' },
        { t: r[R.chains].join(', '), cls: '' },
        { t: fmtUSD(r[R.tvl]), cls: 'num' },
        { t: fmtPct(r[R.chg]), cls: 'num ' + (r[R.chg] === null ? '' : r[R.chg] >= 0 ? 'up' : 'down') },
        { t: '', cls: '', badge: r },
        { t: fmtUSD(r[R.val]), cls: 'num' },
      ];
      cells.forEach(function (c) {
        var td = document.createElement('td');
        td.className = c.cls;
        if (c.badge) {
          var b = document.createElement('span');
          b.className = 'badge ' + (c.badge[R.live] ? 'live' : 'pre');
          b.textContent = c.badge[R.live] ? 'Token live' : 'Pre-token';
          td.appendChild(b);
          if (c.badge[R.wl]) {
            var w = document.createElement('span');
            w.className = 'badge wl';
            w.textContent = 'Watchlist';
            td.appendChild(w);
          }
        } else {
          td.textContent = c.t;
          if (c.sub) {
            var s = document.createElement('span');
            s.className = 'slug';
            s.textContent = c.sub;
            td.appendChild(s);
          }
        }
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    $('count').textContent = list.length + ' of ' + D.rows.length + ' protocols shown';
    renderDetail();
  }

  // ---- detail ------------------------------------------------------------
  function renderDetail() {
    var row = null;
    if (state.slug) {
      D.rows.forEach(function (r) { if (r[R.slug] === state.slug) row = r; });
    }
    var box = $('detail');
    if (!row) { box.hidden = true; return; }
    box.hidden = false;
    $('d-name').textContent = row[R.name];
    var facts = [
      ['Rank', '#' + rankOf(row)],
      ['Implied value', fmtUSD(row[R.val])],
      ['TVL', fmtUSD(row[R.tvl])],
      ['7-day change', fmtPct(row[R.chg])],
      ['Category', row[R.cat] || '—'],
      ['Chains', row[R.chains].join(', ')],
      ['Listed since', row[R.listed] || '—'],
      ['Market cap', row[R.mcap] === null ? 'No token recorded' : fmtUSD(row[R.mcap])],
    ];
    var dl = $('d-facts');
    dl.textContent = '';
    facts.forEach(function (f) {
      var div = document.createElement('div');
      div.className = 'fact';
      var k = document.createElement('span'); k.className = 'k'; k.textContent = f[0];
      var v = document.createElement('span'); v.className = 'v'; v.textContent = f[1];
      div.appendChild(k); div.appendChild(v);
      dl.appendChild(div);
    });
    $('d-note').textContent = row[R.live]
      ? 'The snapshot records a token for this protocol, so it sits below the pre-token board. Its implied value is its recorded market cap scaled by one common factor; the unscaled market cap is above.'
      : 'The snapshot records no token for this protocol. That is not proof it has none, and not a promise that one will ever be issued.';
    var ol = $('d-steps');
    ol.textContent = '';
    row[R.steps].forEach(function (id) {
      var li = document.createElement('li');
      li.textContent = fillStep(D.steps[id], row);
      ol.appendChild(li);
    });
  }

  function select(slug, scroll) {
    state.slug = slug;
    syncUrl();
    render();
    if (scroll) $('detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  $('d-close').addEventListener('click', function () { select('', false); });
  $('q').addEventListener('input', function () { state.q = $('q').value; syncUrl(); render(); });
  ['cat', 'chain', 'status', 'sort'].forEach(function (id) {
    $(id).addEventListener('change', function () { state[id] = $(id).value; syncUrl(); render(); });
  });

  render();
  // A deep link straight to a protocol shows its detail view first.
  if (state.slug && !$('detail').hidden) document.body.classList.add('deep-link');
})();
