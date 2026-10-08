(() => {
  const frames = Array.from(document.querySelectorAll('[data-print-tool-frame]'));
  function loadVisibleFrames() {
    frames.forEach(frame => {
      if (frame.closest('.tool-panel').hidden) return;
      if (!frame.hasAttribute('src')) frame.src = frame.dataset.src;
    });
  }
  function sendTheme(frame) {
    frame.contentWindow?.postMessage({type: 'cash-tool-theme', theme: document.body.dataset.theme || 'light'}, location.origin === 'null' ? '*' : location.origin);
  }
  frames.forEach(frame => {
    frame.addEventListener('load', () => sendTheme(frame));
    new MutationObserver(loadVisibleFrames).observe(frame.closest('.tool-panel'), {attributes: true, attributeFilter: ['hidden']});
  });
  new MutationObserver(() => frames.forEach(sendTheme)).observe(document.body, {attributes: true, attributeFilter: ['data-theme']});
  window.addEventListener('message', event => {
    if (event.origin !== location.origin) return;
    const frame = frames.find(item => item.contentWindow === event.source);
    if (!frame) return;
    if (event.data?.type === 'cash-tool-frame-height' && Number.isFinite(event.data.height)) {
      frame.style.height = Math.min(18000, Math.max(600, event.data.height)) + 'px';
    }
    if (event.data?.type === 'cash-tool-back') frame.closest('.tool-panel').querySelector('[data-back-to-menu]').click();
  });
  loadVisibleFrames();
  document.querySelector('#logout-app').addEventListener('click', lockChallan);
  document.querySelector('#admin-sign-out').addEventListener('click', lockChallan);
  function lockChallan() {
    sessionStorage.removeItem('cashToolChallanUnlocked');
    const frame = document.querySelector('#tool-challan iframe');
    frame.contentWindow?.postMessage({type: 'cash-tool-lock-challan'}, location.origin === 'null' ? '*' : location.origin);
  }
})();
