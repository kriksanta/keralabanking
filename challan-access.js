(() => {
  if (new URLSearchParams(location.search).get('tool') === 'income') return;
  const key = 'cashToolChallanUnlocked';
  const gate = document.createElement('section');
  gate.className = 'challan-access';
  gate.innerHTML = '<form class="challan-access-card"><h1>Slip Creator</h1><label for="challan-password">Password</label><input id="challan-password" type="password" autocomplete="current-password" required><p class="challan-access-error" role="alert" hidden>Incorrect password. Try again.</p><button type="submit">Unlock</button></form>';
  document.body.append(gate);
  const input = gate.querySelector('input');
  const error = gate.querySelector('[role="alert"]');
  function lock() {
    sessionStorage.removeItem(key);
    document.body.classList.add('challan-locked');
    gate.hidden = false;
    input.value = '';
    error.hidden = true;
  }
  function unlock() {
    sessionStorage.setItem(key, 'yes');
    document.body.classList.remove('challan-locked');
    gate.hidden = true;
    input.value = '';
  }
  if (sessionStorage.getItem(key) === 'yes') unlock(); else lock();
  gate.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    if (input.value === 'India@1234') unlock();
    else { error.hidden = false; input.select(); }
  });
  input.addEventListener('input', () => { error.hidden = true; });
  window.addEventListener('message', event => {
    if (event.source === window.parent && event.origin === location.origin && event.data?.type === 'cash-tool-lock-challan') lock();
  });
})();
