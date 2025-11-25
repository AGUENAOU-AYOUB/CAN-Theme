/* CG Consent v11 — iOS-proof via hitbox overlays on EasySell CTAs */
(function () {
  document.documentElement.setAttribute('data-cg-consent', 'loaded-v11');
  console.log('[CG Consent] asset loaded v11');

  // EasySell CTA selectors we guard
  var CTA_SELECTORS = [
    '#es-popup-button',
    '.es-popup-button',
    '.es-button',
    '.es-cta-btn',
    '.es-checkout-btn',
    '.es-sticky-btn',
    '.es-sticky-product'
  ];

  var HITBOX_ATTR = 'data-cg-hitbox';
  var ACCEPT_GRACE_MS = 1500; // allow time for EasySell to initialize after accept (good for iOS)

  var pendingResume = null;
  var removeHitboxesTimer = null;

  // --------------- Utilities ---------------
  function $all(selector, root) {
    try { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }
    catch (e) { return []; }
  }

  function isCTA(el) {
    if (!el || el.nodeType !== 1) return false;
    for (var i = 0; i < CTA_SELECTORS.length; i++) {
      try { if (el.matches && el.matches(CTA_SELECTORS[i])) return true; } catch (e) {}
    }
    return false;
  }

  function ensurePositioned(el) {
    var cs = getComputedStyle(el);
    if (cs.position === 'static') {
      el.style.position = 'relative'; // create containing block for absolute hitbox
    }
  }

  function clickSoon(el) {
    if (!el) return;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        try { el.click(); } catch (e) { try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch(_) {} }
      });
    });
  }

  // --------------- Modal (sharp corners, white, Futura) ---------------
  function injectModalOnce() {
    if (document.getElementById('cg-consent-overlay')) return;

    var style = document.createElement('style');
    style.textContent = `
#cg-consent-overlay{position:fixed;inset:0;z-index:99999;display:none}
#cg-consent-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.45)}
#cg-consent-modal{
  position:relative;width:min(520px,92vw);margin:8vh auto;background:#fff;color:inherit;
  border-radius:0;padding:20px;box-shadow:0 0 0 2px rgba(0,0,0,.15),0 8px 24px rgba(0,0,0,.18);
  font-family:"Futura","Century Gothic",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
}
#cg-consent-modal h2{margin:0 0 12px;font-size:clamp(18px,2.6vw,22px);line-height:1.25}
#cg-consent-modal p{margin:0 0 14px;line-height:1.5}
#cg-consent-modal a{text-decoration:underline}
.cg-consent-check{display:flex;gap:10px;align-items:center;margin:12px 0 18px}

/* Force checkbox to be visible/clickable across themes */
#cg-consent-modal input[type="checkbox"]{
  appearance:auto !important;-webkit-appearance:checkbox !important;
  width:18px;height:18px;display:inline-block !important;opacity:1 !important;
  clip:auto !important;clip-path:none !important;transform:none !important;
  pointer-events:auto !important;background:#fff;border:1px solid #111;margin:0;
}
#cg-consent-modal label,#cg-consent-modal label *{cursor:pointer}

.cg-consent-actions{display:flex;gap:12px;justify-content:flex-end;flex-wrap:wrap}
.cg-btn{padding:10px 16px;border-radius:0;border:1px solid #111;background:#fff;color:#111;cursor:pointer}
.cg-btn-primary{background:#111;color:#fff;border-color:#111}
.cg-btn-primary[disabled]{opacity:.5;cursor:not-allowed}
@media (max-width:480px){
  #cg-consent-modal{margin:12vh auto;padding:16px}
  .cg-consent-actions{justify-content:stretch}
  .cg-btn{width:100%;text-align:center}
}

/* Invisible hitbox placed on top of each CTA (captures taps reliably on iOS) */
.cg-consent-hitbox{
  position:absolute; inset:0; z-index: 99998; background: rgba(0,0,0,0);
  cursor:pointer; pointer-events:auto;
}
    `;
    document.head.appendChild(style);

    var html = '' +
      '<div id="cg-consent-overlay" aria-hidden="true">' +
      '  <div id="cg-consent-backdrop"></div>' +
      '  <div id="cg-consent-modal" role="dialog" aria-modal="true" aria-labelledby="cg-consent-title" tabindex="-1">' +
      '    <h2 id="cg-consent-title">Confirmation des Conditions Générales</h2>' +
      '    <p>Avant de finaliser votre commande, vous devez accepter nos ' +
      '      <a href="/pages/conditions-generales" target="_blank" rel="noopener">Conditions Générales</a>.' +
      '    </p>' +
      '    <label class="cg-consent-check" for="cg-consent-checkbox">' +
      '      <input type="checkbox" id="cg-consent-checkbox" />' +
      '      <span>J’ai lu et j’accepte les Conditions Générales.</span>' +
      '    </label>' +
      '    <div class="cg-consent-actions">' +
      '      <button type="button" id="cg-consent-cancel" class="cg-btn">Annuler</button>' +
      '      <button type="button" id="cg-consent-accept" class="cg-btn cg-btn-primary" disabled>Continuer</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';
    document.body.insertAdjacentHTML('beforeend', html);
  }

  function openModal() {
    injectModalOnce();
    var ov = document.getElementById('cg-consent-overlay');
    var cb = document.getElementById('cg-consent-checkbox');
    var accept = document.getElementById('cg-consent-accept');
    var cancel = document.getElementById('cg-consent-cancel');
    var backdrop = document.getElementById('cg-consent-backdrop');
    if (!ov || !cb || !accept || !cancel) return;

    cb.checked = false; accept.disabled = true;
    ov.style.display = 'block';
    document.documentElement.style.overflow = 'hidden';

    function cleanup() {
      ov.style.display = 'none';
      document.documentElement.style.overflow = '';
      cb.removeEventListener('change', onChange);
      accept.removeEventListener('click', onAccept);
      cancel.removeEventListener('click', onCancel);
      backdrop.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onEsc);
    }
    function onChange() { accept.disabled = !cb.checked; }
    function onAccept() {
      var resume = pendingResume; pendingResume = null;
      cleanup();

      // Temporarily remove hitboxes so the real CTA receives the next click
      toggleHitboxes(false);
      clearTimeout(removeHitboxesTimer);
      removeHitboxesTimer = setTimeout(function () {
        toggleHitboxes(true);
      }, ACCEPT_GRACE_MS);

      if (typeof resume === 'function') resume();
    }
    function onCancel() { cleanup(); pendingResume = null; }
    function onEsc(e) { if (e.key === 'Escape') onCancel(); }

    cb.addEventListener('change', onChange);
    accept.addEventListener('click', onAccept);
    cancel.addEventListener('click', onCancel);
    backdrop.addEventListener('click', onCancel);
    document.addEventListener('keydown', onEsc);
  }

  // --------------- Hitboxes (the iOS-proof layer) ---------------
  function attachHitbox(cta) {
    if (!cta || cta.querySelector('[' + HITBOX_ATTR + '="1"]')) return;

    ensurePositioned(cta);
    var hb = document.createElement('div');
    hb.className = 'cg-consent-hitbox';
    hb.setAttribute(HITBOX_ATTR, '1');

    hb.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      // Plan to resume: after accept, click the real CTA
      pendingResume = function () {
        clickSoon(cta);
      };
      openModal();
    }, true);

    cta.appendChild(hb);
  }

  function scanAndAttach() {
    CTA_SELECTORS.forEach(function (sel) {
      $all(sel).forEach(attachHitbox);
    });
  }

  function toggleHitboxes(on) {
    $all('[' + HITBOX_ATTR + '="1"]').forEach(function (hb) {
      hb.style.display = on ? 'block' : 'none';
    });
  }

  // Initial attach + watch for DOM changes (new buttons, re-renders, sticky bars)
  scanAndAttach();
  var mo = new MutationObserver(function () { scanAndAttach(); });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  console.log('[CG Consent] initialized (v11 hitbox overlays for iOS)');
})();
