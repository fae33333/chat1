/* ============================================================
   dialogs.js — قوالب حوارات بديلة عن alert / confirm / prompt
   الاستخدام (كلها ترجع Promise):
     await uiAlert('رسالة')
     if (await uiConfirm('هل أنت متأكد؟', { danger: true })) { ... }
     const v = await uiPrompt('اكتب الاسم', { value: 'x' })   // null عند الإلغاء
     const n = await uiPrompt('عدد المقاعد', { type: 'number', min: 1, max: 8, value: 8 })
   ============================================================ */
(function () {
  if (window.__uiDialogsReady) return;
  window.__uiDialogsReady = true;

  const css = `
  .ui-dlg-overlay{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(5,2,15,.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);direction:rtl;animation:uiDlgFade .18s ease}
  .ui-dlg-overlay.closing{opacity:0;transition:opacity .16s ease}
  .ui-dlg{width:100%;max-width:360px;max-height:90vh;overflow:auto;border-radius:22px;padding:22px 20px 18px;color:#fff;text-align:center;font-family:inherit;background:linear-gradient(160deg,rgba(45,22,90,.98),rgba(15,8,34,.99));border:1px solid rgba(167,139,250,.45);box-shadow:0 20px 60px rgba(0,0,0,.65),0 0 34px rgba(139,92,246,.35);animation:uiDlgPop .26s cubic-bezier(.2,.9,.3,1.15)}
  .ui-dlg.danger{border-color:rgba(248,113,113,.6);background:linear-gradient(160deg,rgba(90,18,40,.98),rgba(24,8,20,.99));box-shadow:0 20px 60px rgba(0,0,0,.65),0 0 34px rgba(239,68,68,.35)}
  .ui-dlg-icon{width:56px;height:56px;margin:0 auto 12px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:28px;background:rgba(255,255,255,.1)}
  .ui-dlg.danger .ui-dlg-icon{background:rgba(239,68,68,.25)}
  .ui-dlg-title{font-size:16px;font-weight:800;margin-bottom:8px}
  .ui-dlg-msg{font-size:13.5px;line-height:1.75;color:rgba(255,255,255,.85);white-space:pre-wrap;word-break:break-word}
  .ui-dlg-input{width:100%;margin-top:14px;padding:11px 14px;border-radius:14px;border:1px solid rgba(167,139,250,.45);background:rgba(255,255,255,.08);color:#fff;font:inherit;font-size:14px;text-align:right;outline:none;box-sizing:border-box}
  .ui-dlg-input:focus{border-color:#a78bfa;box-shadow:0 0 0 3px rgba(167,139,250,.25)}
  textarea.ui-dlg-input{min-height:90px;resize:vertical}
  .ui-dlg-chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:12px}
  .ui-dlg-chip{min-width:40px;padding:8px 12px;border-radius:12px;border:1px solid rgba(167,139,250,.4);background:rgba(255,255,255,.07);color:#fff;font:inherit;font-size:14px;font-weight:700;cursor:pointer}
  .ui-dlg-chip.active,.ui-dlg-chip:hover{background:linear-gradient(135deg,#8b5cf6,#ec4899);border-color:transparent}
  .ui-dlg-error{min-height:18px;margin-top:8px;font-size:12px;color:#fca5a5}
  .ui-dlg-actions{display:flex;gap:10px;margin-top:16px}
  .ui-dlg-btn{flex:1;padding:11px 10px;border-radius:14px;border:none;font:inherit;font-size:14px;font-weight:800;cursor:pointer;color:#fff;transition:transform .12s ease,filter .12s ease}
  .ui-dlg-btn:active{transform:scale(.96)}
  .ui-dlg-btn.ok{background:linear-gradient(135deg,#8b5cf6,#ec4899)}
  .ui-dlg.danger .ui-dlg-btn.ok{background:linear-gradient(135deg,#ef4444,#f97316)}
  .ui-dlg-btn.cancel{background:rgba(255,255,255,.12)}
  .ui-dlg-btn:hover{filter:brightness(1.1)}
  @keyframes uiDlgFade{from{opacity:0}to{opacity:1}}
  @keyframes uiDlgPop{from{opacity:0;transform:translateY(18px) scale(.92)}to{opacity:1;transform:none}}`;
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function open(o) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'ui-dlg-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');

      const isPrompt = o.kind === 'prompt';
      const isNumber = isPrompt && o.type === 'number';
      const hasCancel = o.kind !== 'alert';

      let inputHtml = '';
      if (isPrompt) {
        const ph = esc(o.placeholder || '');
        if (o.type === 'textarea') {
          inputHtml = `<textarea class="ui-dlg-input" placeholder="${ph}">${esc(o.value)}</textarea>`;
        } else {
          const attrs = isNumber ? `type="number" inputmode="numeric" min="${o.min ?? ''}" max="${o.max ?? ''}"` : 'type="text"';
          inputHtml = `<input class="ui-dlg-input" ${attrs} placeholder="${ph}" value="${esc(o.value)}" autocomplete="off">`;
        }
        if (isNumber && o.min != null && o.max != null && (o.max - o.min) <= 12) {
          let chips = '';
          for (let i = o.min; i <= o.max; i++) chips += `<button type="button" class="ui-dlg-chip" data-v="${i}">${i}</button>`;
          inputHtml += `<div class="ui-dlg-chips">${chips}</div>`;
        }
        inputHtml += '<div class="ui-dlg-error"></div>';
      }

      overlay.innerHTML = `
        <div class="ui-dlg ${o.danger ? 'danger' : ''}">
          <div class="ui-dlg-icon">${o.icon}</div>
          ${o.title ? `<div class="ui-dlg-title">${esc(o.title)}</div>` : ''}
          <div class="ui-dlg-msg">${esc(o.message)}</div>
          ${inputHtml}
          <div class="ui-dlg-actions">
            <button type="button" class="ui-dlg-btn ok">${esc(o.okText)}</button>
            ${hasCancel ? `<button type="button" class="ui-dlg-btn cancel">${esc(o.cancelText)}</button>` : ''}
          </div>
        </div>`;
      document.body.appendChild(overlay);

      const input = overlay.querySelector('.ui-dlg-input');
      const errEl = overlay.querySelector('.ui-dlg-error');
      const okBtn = overlay.querySelector('.ui-dlg-btn.ok');
      const cancelBtn = overlay.querySelector('.ui-dlg-btn.cancel');
      let done = false;

      const finish = (val) => {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey, true);
        overlay.classList.add('closing');
        setTimeout(() => overlay.remove(), 170);
        resolve(val);
      };
      const cancelValue = o.kind === 'confirm' ? false : (o.kind === 'prompt' ? null : undefined);

      const submit = () => {
        if (o.kind === 'confirm') return finish(true);
        if (o.kind === 'alert') return finish(undefined);
        let v = input.value;
        if (isNumber) {
          const n = parseInt(v, 10);
          if (isNaN(n) || (o.min != null && n < o.min) || (o.max != null && n > o.max)) {
            errEl.textContent = `أدخل رقماً بين ${o.min} و ${o.max}`;
            input.focus();
            return;
          }
          v = String(n);
        }
        finish(v);
      };

      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(cancelValue); }
        else if (e.key === 'Enter' && !(input && input.tagName === 'TEXTAREA' && !e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); submit(); }
      }
      document.addEventListener('keydown', onKey, true);

      okBtn.onclick = submit;
      if (cancelBtn) cancelBtn.onclick = () => finish(cancelValue);
      overlay.addEventListener('mousedown', (e) => { if (e.target === overlay && hasCancel) finish(cancelValue); });
      overlay.querySelectorAll('.ui-dlg-chip').forEach(ch => {
        ch.onclick = () => { input.value = ch.dataset.v; errEl.textContent = ''; overlay.querySelectorAll('.ui-dlg-chip').forEach(c => c.classList.toggle('active', c === ch)); };
        if (input && ch.dataset.v === String(o.value)) ch.classList.add('active');
      });
      if (input) { input.focus(); input.select && input.select(); } else { okBtn.focus(); }
    });
  }

  const opts = (o) => (typeof o === 'string' ? { title: o } : (o || {}));

  window.uiAlert = (message, o) => open(Object.assign({ kind: 'alert', icon: 'ℹ️', okText: 'حسناً', message }, opts(o)));
  window.uiConfirm = (message, o) => {
    o = opts(o);
    return open(Object.assign({ kind: 'confirm', icon: o.danger ? '⚠️' : '❓', okText: 'تأكيد', cancelText: 'إلغاء', message }, o));
  };
  window.uiPrompt = (message, o) => {
    o = opts(o);
    return open(Object.assign({ kind: 'prompt', icon: '✍️', okText: 'موافق', cancelText: 'إلغاء', value: '', message }, o));
  };

  // شبكة أمان: أي alert() قديم يُعرض كقالب بدل نافذة المتصفح
  window.alert = (m) => { window.uiAlert(m); };
})();
