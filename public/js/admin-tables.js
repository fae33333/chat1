/* يضع عنوان العمود داخل كل خلية (data-label) ليعرضه تصميم البطاقات على الشاشات الضيقة.
   يعمل على الجداول الثابتة والجداول التي تُبنى لاحقًا من الخادم. */
(function () {
  'use strict';
  var scheduled = false;

  function labelTable(table) {
    var headRow = table.querySelector('thead tr') || table.querySelector('tr:has(> th)');
    if (!headRow) return;
    var labels = Array.prototype.map.call(headRow.children, function (th) {
      return (th.textContent || '').replace(/\s+/g, ' ').trim();
    });
    Array.prototype.forEach.call(table.querySelectorAll('tr'), function (tr) {
      if (tr === headRow || tr.querySelector(':scope > th')) return;
      var col = 0;
      Array.prototype.forEach.call(tr.children, function (td) {
        if (td.tagName !== 'TD') return;
        var span = parseInt(td.getAttribute('colspan') || '1', 10);
        if (span === 1 && labels[col]) td.setAttribute('data-label', labels[col]);
        else td.removeAttribute('data-label');
        col += span;
      });
    });
  }

  function run() {
    scheduled = false;
    document.querySelectorAll('table.data-table, #paypal-orders-list table').forEach(labelTable);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(run);
  }

  function start() {
    run();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
