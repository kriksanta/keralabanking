/* Paste into the Apps Script project attached to your private Google Sheet. */
function doGet() {
  return HtmlService.createHtmlOutput('Cash Tool form service is ready.');
}

function doPost(e) {
  let request = {}, result;
  try {
    request = JSON.parse(e.parameter.payload || '{}');
    if (request.origin !== 'https://kriksanta.github.io') throw new Error('Unsupported website.');
    result = dispatch_(request);
  } catch (error) {
    result = {ok: false, error: error.message || 'Unable to process the request.'};
  }
  const envelope = JSON.stringify({type: 'cash-tool-response', requestId: request.requestId, result: result})
    .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  // The response frame sends confirmation only to the hosted app.
  return HtmlService.createHtmlOutput('<!doctype html><script>window.top.postMessage(' + envelope +
    ',"https://kriksanta.github.io");</script>')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function dispatch_(request) {
  const properties = PropertiesService.getScriptProperties();
  const configuredUser = properties.getProperty('ADMIN_USERNAME');
  if (!configuredUser || !properties.getProperty('ADMIN_PASSWORD')) throw new Error('Admin account has not been configured.');
  if (request.action === 'submit') return submitIssue_(request, properties);
  if (request.action === 'login') {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const cache = CacheService.getScriptCache();
      const failures = Number(cache.get('login-failures') || 0);
      if (failures >= 20) throw new Error('Too many login attempts. Please try again in 5 minutes.');
      if (String(request.username || '').trim().toLowerCase() !== properties.getProperty('ADMIN_USERNAME').toLowerCase() ||
          !equalSecret_(request.password, properties.getProperty('ADMIN_PASSWORD'))) {
        cache.put('login-failures', String(failures + 1), 300);
        throw new Error('Incorrect username or password.');
      }
      cache.remove('login-failures');
      return createSession_(properties);
    } finally { lock.releaseLock(); }
  }
  const session = requireAdmin_(request, properties);
  if (request.action === 'logout') {
    CacheService.getScriptCache().remove('session:' + request.token);
    return {ok: true};
  }
  if (request.action === 'inbox') {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
    const sheet = issueSheet_(properties);
    const lastRow = sheet.getLastRow();
    const start = Math.max(2, lastRow - 499);
    const rows = lastRow < 2 ? [] : sheet.getRange(start, 1, lastRow - start + 1, 5).getValues();
    return {ok: true, username: session.username, total: Math.max(0, lastRow - 1),
      submissions: rows.reverse().map(function(row) {
        return {id: String(row[0]), date: new Date(row[1]).toISOString(), name: String(row[2]), message: String(row[3]),
          status: row[4] === 'closed' ? 'closed' : 'open'};
      })};
    } finally { lock.releaseLock(); }
  }
  if (request.action === 'issue-status') {
    const id = String(request.id || '');
    const status = String(request.status || '');
    if (!/^[a-f0-9-]{36}$/.test(id) || !['open', 'closed'].includes(status)) throw new Error('Invalid issue status.');
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      requireAdmin_(request, properties);
      const sheet = issueSheet_(properties);
      const count = sheet.getLastRow() - 1;
      const ids = count > 0 ? sheet.getRange(2, 1, count, 1).getValues() : [];
      const index = ids.findIndex(function(row) { return String(row[0]) === id; });
      if (index < 0) throw new Error('This issue could not be found. Refresh the inbox.');
      sheet.getRange(index + 2, 5).setValue(status);
      SpreadsheetApp.flush();
      return {ok: true, id: id, status: status};
    } finally { lock.releaseLock(); }
  }
  if (request.action === 'account') {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      requireAdmin_(request, properties);
      if (!equalSecret_(request.currentPassword, properties.getProperty('ADMIN_PASSWORD'))) throw new Error('Current password is incorrect.');
      const username = String(request.username || '').trim();
      const password = String(request.newPassword || '');
      if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username) || username.toLowerCase() === 'admin')
        throw new Error('Use 3–40 letters, numbers, dots, hyphens or underscores. Choose a username other than admin.');
      if (password && (password.length < 10 || password.length > 128)) throw new Error('Use a password with 10–128 characters.');
      properties.setProperty('ADMIN_USERNAME', username);
      if (password) properties.setProperty('ADMIN_PASSWORD', password);
      properties.setProperty('AUTH_VERSION', Utilities.getUuid());
      CacheService.getScriptCache().remove('session:' + request.token);
      return createSession_(properties);
    } finally { lock.releaseLock(); }
  }
  throw new Error('Unknown request.');
}

function createSession_(properties) {
  const token = Utilities.getUuid() + Utilities.getUuid();
  const username = properties.getProperty('ADMIN_USERNAME');
  const expiresAt = Date.now() + 6 * 60 * 60 * 1000;
  CacheService.getScriptCache().put('session:' + token,
    JSON.stringify({username: username, version: properties.getProperty('AUTH_VERSION') || '1', expiresAt: expiresAt}), 21600);
  return {ok: true, token: token, username: username, expiresAt: expiresAt};
}

function requireAdmin_(request, properties) {
  const token = String(request.token || '');
  const raw = /^[a-f0-9-]{72}$/.test(token) && CacheService.getScriptCache().get('session:' + token);
  const session = raw ? JSON.parse(raw) : null;
  if (!session || session.expiresAt < Date.now() || session.version !== (properties.getProperty('AUTH_VERSION') || '1'))
    throw new Error('Session expired. Please log in again.');
  return session;
}

function equalSecret_(value, expected) {
  const first = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value || ''));
  const second = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(expected || ''));
  let diff = 0;
  for (let i = 0; i < first.length; i++) diff |= first[i] ^ second[i];
  return diff === 0;
}

function issueSheet_(properties) {
  const id = properties.getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('The submissions sheet has not been configured.');
  const workbook = SpreadsheetApp.openById(id);
  let sheet = workbook.getSheetByName('Issues');
  if (!sheet) {
    sheet = workbook.insertSheet('Issues');
    sheet.appendRow(['ID', 'Date', 'Name', 'Issue', 'Status']);
    sheet.setFrozenRows(1);
  }
  // Upgrade the original four-column sheet without changing names or issues.
  if (sheet.getRange(1, 5).getValue() !== 'Status') {
    sheet.getRange(1, 5).setValue('Status');
    const count = sheet.getLastRow() - 1;
    if (count > 0) {
      const statuses = sheet.getRange(2, 5, count, 1).getValues();
      sheet.getRange(2, 5, count, 1).setValues(statuses.map(function(row) {
        return [row[0] === 'closed' ? 'closed' : 'open'];
      }));
    }
  }
  return sheet;
}

function submitIssue_(request, properties) {
  const name = String(request.name || '').trim();
  const message = String(request.message || '').trim();
  if (request.website) throw new Error('Submission rejected.');
  if (!name || name.length > 80 || !message || message.length > 2000) throw new Error('Enter your name and issue (up to 2,000 characters).');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = issueSheet_(properties);
    const cache = CacheService.getScriptCache();
    const client = /^[a-f0-9-]{36}$/.test(String(request.clientId || '')) ? request.clientId : 'unknown';
    if (cache.get('issue-client:' + client)) throw new Error('Please wait a minute before submitting another issue.');
    const minuteKey = 'issues-minute:' + Math.floor(Date.now() / 60000);
    const count = Number(cache.get(minuteKey) || 0);
    if (count >= 20) throw new Error('The form is busy. Please try again in a minute.');
    // Plain text formatting prevents spreadsheet formula execution.
    const nextRow = sheet.getLastRow() + 1;
    sheet.getRange(nextRow, 1, 1, 5).setNumberFormat('@');
    sheet.getRange(nextRow, 1, 1, 5).setValues([[Utilities.getUuid(), new Date().toISOString(), safeCell_(name), safeCell_(message), 'open']]);
    cache.put('issue-client:' + client, '1', 60);
    cache.put(minuteKey, String(count + 1), 120);
    return {ok: true};
  } finally { lock.releaseLock(); }
}

function safeCell_(value) {
  return /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
}
