(() => {
  'use strict';
  const panel = document.querySelector('#admin-panel');
  const issueCard = document.querySelector('#issue-card');
  const sessionKey = 'cashToolAdminSession';
  let session = null;
  let pendingNotice = null;
  let savedNotice = '';
  // Both save dialogs must be available outside the hidden customer tool panels.
  document.body.append(githubSaveDialog);
  const configReady = fetch('./site-config.json', {cache: 'no-store'})
    .then(response => { if (!response.ok) throw new Error('Configuration unavailable.'); return response.json(); })
    .catch(() => ({issueBackendUrl: ''}));

  function feedback(id, text, state = '') {
    const element = document.querySelector('#' + id);
    element.textContent = text;
    element.dataset.state = state;
  }

  async function requestBackend(action, values = {}) {
    const config = await configReady;
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(config.issueBackendUrl || '')) {
      throw new Error('The issue service has not been connected yet.');
    }
    // A POST response frame avoids CORS preflights and never puts passwords in URLs.
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const frame = document.createElement('iframe');
      frame.name = 'cash-tool-' + requestId;
      frame.hidden = true;
      frame.title = 'Secure form response';
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = config.issueBackendUrl;
      form.target = frame.name;
      form.hidden = true;
      const input = document.createElement('input');
      input.name = 'payload';
      input.type = 'hidden';
      input.value = JSON.stringify({action, ...values, token: session?.token || '', requestId, origin: location.origin});
      form.append(input);
      function clean() {
        clearTimeout(timeout);
        window.removeEventListener('message', receive);
        form.remove();
        frame.remove();
      }
      function receive(event) {
        let host;
        try { host = new URL(event.origin).hostname; } catch { return; }
        if (host !== 'script.google.com' && !host.endsWith('.googleusercontent.com')) return;
        if (event.data?.type !== 'cash-tool-response' || event.data.requestId !== requestId) return;
        const result = event.data.result;
        clean();
        if (result?.ok) resolve(result);
        else reject(new Error(result?.error || 'Unable to process the request.'));
      }
      const timeout = setTimeout(() => { clean(); reject(new Error('No confirmation received. Check your connection and refresh before trying again.')); }, 30000);
      window.addEventListener('message', receive);
      document.body.append(frame, form);
      form.submit();
      input.value = '';
    });
  }

  function storeSession(result) {
    session = {token: result.token, username: result.username, expiresAt: result.expiresAt};
    sessionStorage.setItem(sessionKey, JSON.stringify(session));
    document.querySelector('#admin-account-username').value = session.username;
  }

  function openAdmin() {
    appShell.dataset.admin = 'true';
    toolMenu.hidden = true;
    Object.values(toolPanels).forEach(tool => { tool.hidden = true; });
    issueCard.hidden = true;
    panel.hidden = false;
    settingsEditor.hidden = false;
    document.querySelector('#admin-margins').append(settingsEditor);
    renderSettingsList();
    clearTimeout(safetyToastTimer);
    safetyToast.classList.remove('is-visible');
    showApp(true);
    window.scrollTo({top: 0, behavior: 'auto'});
  }

  function resetAdmin() {
    session = null;
    sessionStorage.removeItem(sessionKey);
    panel.hidden = true;
    delete appShell.dataset.admin;
    Object.values(toolPanels).forEach(tool => { tool.hidden = true; });
    const remembered = sessionStorage.getItem(toolSessionKey);
    if (remembered && toolPanels[remembered]) {
      toolMenu.hidden = true;
      toolPanels[remembered].hidden = false;
    } else toolMenu.hidden = false;
    updateIssueVisibility();
  }

  window.cashToolAdminLogin = async (username, password) => {
    const submit = loginForm.querySelector('[type="submit"]');
    const error = document.querySelector('#login-error');
    submit.disabled = true;
    error.hidden = true;
    try {
      const result = await requestBackend('login', {username, password});
      storeSession(result);
      localStorage.removeItem('bfilCashToolsSignedIn');
      openAdmin();
      document.querySelector('#login-password').value = '';
    } catch (problem) {
      error.textContent = problem.message;
      error.hidden = false;
    } finally { submit.disabled = false; }
  };

  async function signOutAdmin() {
    if (session) requestBackend('logout').catch(() => {});
    resetAdmin();
    localStorage.removeItem('bfilCashToolsSignedIn');
    showLogin(true);
    loginForm.reset();
    document.querySelector('#login-password').type = 'password';
    document.querySelector('#password-toggle').setAttribute('aria-pressed', 'false');
    document.querySelector('#password-toggle').setAttribute('aria-label', 'Show password');
    document.querySelector('#admin-account-form').reset();
  }
  document.querySelector('#admin-sign-out').addEventListener('click', signOutAdmin);
  document.querySelector('#logout-app').addEventListener('click', () => { if (session) signOutAdmin(); });

  function updateIssueVisibility() { issueCard.hidden = !panel.hidden || toolMenu.hidden; }
  new MutationObserver(updateIssueVisibility).observe(toolMenu, {attributes: true, attributeFilter: ['hidden']});
  updateIssueVisibility();

  const tabs = Array.from(document.querySelectorAll('[data-admin-tab]'));
  function selectTab(button) {
    tabs.forEach(tab => {
      const selected = tab === button;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      document.querySelector('#admin-' + tab.dataset.adminTab).hidden = !selected;
    });
    if (button.dataset.adminTab === 'submissions') loadInbox();
  }
  tabs.forEach(tab => tab.addEventListener('click', () => selectTab(tab)));
  document.querySelector('.admin-tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let index = tabs.indexOf(document.activeElement);
    if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = tabs.length - 1;
    else index = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    selectTab(tabs[index]); tabs[index].focus();
  });

  let loadingInbox = false;
  async function loadInbox() {
    if (loadingInbox || !session) return;
    loadingInbox = true;
    const button = document.querySelector('#refresh-submissions');
    button.disabled = true;
    feedback('submissions-status', 'Loading submissions…');
    const inbox = document.querySelector('#submission-inbox');
    inbox.replaceChildren();
    try {
      const result = await requestBackend('inbox');
      result.submissions.forEach(item => {
        const article = document.createElement('article'); article.className = 'message-item';
        const meta = document.createElement('div'); meta.className = 'message-meta';
        const name = document.createElement('strong'); name.textContent = item.name;
        const time = document.createElement('time'); time.dateTime = item.date;
        time.textContent = new Date(item.date).toLocaleString('en-IN');
        const message = document.createElement('p'); message.textContent = item.message;
        meta.append(name, time); article.append(meta, message); inbox.append(article);
      });
      if (!result.submissions.length) {
        const empty = document.createElement('p'); empty.className = 'inbox-empty';
        empty.textContent = 'No issues submitted yet.'; inbox.append(empty);
      }
      feedback('submissions-status', result.total > 500 ? 'Showing the latest 500 submissions.' : '');
    } catch (problem) {
      feedback('submissions-status', problem.message, 'error');
      if (problem.message.includes('Session expired')) { await signOutAdmin(); }
    } finally { loadingInbox = false; button.disabled = false; }
  }
  document.querySelector('#refresh-submissions').addEventListener('click', loadInbox);

  document.querySelector('#issue-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    feedback('issue-status', 'Submitting…');
    try {
      let clientId = localStorage.getItem('cashToolIssueClient');
      if (!clientId) { clientId = crypto.randomUUID(); localStorage.setItem('cashToolIssueClient', clientId); }
      await requestBackend('submit', {name: document.querySelector('#issue-name').value.trim(),
        message: document.querySelector('#issue-description').value.trim(), website: document.querySelector('#issue-website').value, clientId});
      form.reset();
      feedback('issue-status', 'Your issue has been submitted. Thank you.', 'success');
    } catch (problem) { feedback('issue-status', problem.message, 'error'); }
    finally { button.disabled = false; }
  });

  document.querySelector('#admin-account-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const password = document.querySelector('#admin-new-password').value;
    if (password !== document.querySelector('#admin-confirm-password').value) {
      feedback('admin-account-status', 'New passwords do not match.', 'error'); return;
    }
    const button = form.querySelector('[type="submit"]'); button.disabled = true;
    feedback('admin-account-status', 'Updating account…');
    try {
      const result = await requestBackend('account', {username: document.querySelector('#admin-account-username').value.trim(),
        currentPassword: document.querySelector('#admin-current-password').value, newPassword: password});
      storeSession(result);
      ['admin-current-password', 'admin-new-password', 'admin-confirm-password'].forEach(id => { document.querySelector('#' + id).value = ''; });
      feedback('admin-account-status', 'Account updated. Other admin sessions must log in again.', 'success');
    } catch (problem) { feedback('admin-account-status', problem.message, 'error'); }
    finally { button.disabled = false; }
  });

  async function loadNotice() {
    try {
      const response = await fetch('./notice.json', {cache: 'no-store'});
      if (!response.ok) return;
      const data = await response.json();
      if (typeof data.text !== 'string') return;
      const text = data.text.slice(0, 500).trim();
      document.querySelector('#published-notice').textContent = text;
      document.querySelector('#notice-footer').hidden = !text;
      const editor = document.querySelector('#notice-content');
      if (editor.value === savedNotice) editor.value = text;
      savedNotice = text;
    } catch { /* Keep the most recently loaded notice when offline. */ }
  }
  loadNotice();
  setInterval(() => { if (!document.hidden) loadNotice(); }, 60000);

  document.querySelector('#notice-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!session) return;
    pendingNotice = document.querySelector('#notice-content').value.trim();
    document.querySelector('#github-save-title').textContent = 'Save shared notice';
    document.querySelector('#github-save-error').hidden = true;
    document.querySelector('#github-save-token').value = '';
    githubSaveDialog.showModal(); document.querySelector('#github-save-token').focus();
  });
  document.querySelector('#save-margin-data').addEventListener('click', () => {
    pendingNotice = null;
    document.querySelector('#github-save-title').textContent = 'Save shared margins';
  }, true);
  githubSaveDialog.addEventListener('close', () => { pendingNotice = null; });
  githubSaveForm.addEventListener('submit', async event => {
    if (pendingNotice === null) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const text = pendingNotice;
    const input = document.querySelector('#github-save-token');
    const token = input.value.trim();
    if (!token) return;
    const button = document.querySelector('#github-save-submit'); button.disabled = true; button.textContent = 'Saving…';
    const error = document.querySelector('#github-save-error'); error.hidden = true;
    try {
      const api = 'https://api.github.com/repos/kriksanta/keralabanking/contents/notice.json';
      const headers = {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'};
      const response = await fetch(api + '?ref=main', {headers});
      let sha;
      if (response.ok) sha = (await response.json()).sha;
      else if (response.status !== 404) throw new Error('Could not read the notice. Check your GitHub token permissions.');
      const binary = Array.from(new TextEncoder().encode(JSON.stringify({text}, null, 2) + '\n'), byte => String.fromCharCode(byte)).join('');
      const body = {message: 'Update footer notice', content: btoa(binary), branch: 'main'};
      if (sha) body.sha = sha;
      const saved = await fetch(api, {method: 'PUT', headers, body: JSON.stringify(body)});
      if (!saved.ok) throw new Error(saved.status === 409 ? 'The notice changed in GitHub. Please save again.' : 'Could not save. The token needs Contents read/write permission.');
      savedNotice = text;
      document.querySelector('#published-notice').textContent = text;
      document.querySelector('#notice-footer').hidden = !text;
      feedback('notice-save-status', 'Saved to GitHub. Other users will see it after the site publishes.', 'success');
      githubSaveDialog.close();
    } catch (problem) { error.textContent = problem.message; error.hidden = false; }
    finally { input.value = ''; button.disabled = false; button.textContent = 'Commit changes'; }
  }, true);

  // Restore admin access only after the server validates the saved session.
  try {
    const remembered = JSON.parse(sessionStorage.getItem(sessionKey) || 'null');
    if (remembered?.token && remembered.expiresAt > Date.now()) {
      session = remembered;
      showLogin();
      const submit = loginForm.querySelector('[type="submit"]');
      submit.disabled = true;
      requestBackend('inbox').then(result => {
        document.querySelector('#admin-account-username').value = result.username;
        openAdmin();
      }).catch(() => { resetAdmin(); showLogin(); }).finally(() => { submit.disabled = false; });
    } else sessionStorage.removeItem(sessionKey);
  } catch { sessionStorage.removeItem(sessionKey); }
})();
