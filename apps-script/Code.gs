const CONFIG = Object.freeze({
  APP_USERS_SHEET: 'Usuarios',
  DATA_SHEET: 'Lancamentos',
  USER_HEADERS: ['Google ID', 'E-mail', 'Nome', 'ID da planilha', 'Atualizado em'],
  DATA_HEADERS: ['ID', 'Data', 'Descrição', 'Valor', 'Tipo', 'Forma de pagamento', 'Origem', 'Usuário'],
  ALLOWED_TYPES: ['Entrada', 'Saída'],
  ALLOWED_PAYMENTS: ['Pix', 'Dinheiro', 'Cartão', 'Transferência', 'Outro'],
});

function doGet() {
  return jsonResponse({ ok: true, message: 'Cash Of Anarchy API v0.2 online.' });
}

function doPost(event) {
  try {
    const payload = JSON.parse(event.postData.contents || '{}');
    const user = authenticate(payload.idToken);
    if (payload.action === 'obterConfiguracao') return getUserConfiguration(user);
    if (payload.action === 'salvarConfiguracao') return saveUserConfiguration(user, payload.spreadsheetId);
    if (payload.action === 'adicionar') return addEntry(user, payload);
    return jsonResponse({ ok: false, error: 'Ação não permitida.' });
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: safeError(error) });
  }
}

function authenticate(idToken) {
  if (!idToken || String(idToken).length > 5000) throw new Error('Faça login para continuar.');
  const clientId = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID não configurado no Apps Script.');

  const cache = CacheService.getScriptCache();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken);
  const cacheKey = `token:${Utilities.base64EncodeWebSafe(digest).slice(0, 32)}`;
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const response = UrlFetchApp.fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error('Sua sessão é inválida ou expirou. Entre novamente.');
  const token = JSON.parse(response.getContentText());
  const issuerIsGoogle = token.iss === 'accounts.google.com' || token.iss === 'https://accounts.google.com';
  if (token.aud !== clientId || !issuerIsGoogle || String(token.email_verified) !== 'true' || Number(token.exp) * 1000 <= Date.now()) {
    throw new Error('Não foi possível validar sua conta Google.');
  }

  const user = { sub: token.sub, email: token.email, name: token.name || token.email };
  cache.put(cacheKey, JSON.stringify(user), 300);
  return user;
}

function getUserConfiguration(user) {
  const row = findUserRow(user.sub);
  return jsonResponse({
    ok: true,
    user: { email: user.email, name: user.name },
    spreadsheetId: row ? String(row.values[3] || '') : '',
  });
}

function saveUserConfiguration(user, rawSpreadsheetId) {
  const spreadsheetId = normalizeSpreadsheetId(rawSpreadsheetId);
  if (!spreadsheetId) throw new Error('Informe um ID de planilha válido.');
  let target;
  try {
    target = SpreadsheetApp.openById(spreadsheetId);
  } catch (error) {
    throw new Error('A planilha não existe ou não foi compartilhada com a conta do Apps Script.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    initializeDataSheet(target);
    const usersSheet = getUsersSheet();
    const existing = findUserRow(user.sub, usersSheet);
    const values = [user.sub, user.email, user.name, spreadsheetId, new Date()];
    if (existing) usersSheet.getRange(existing.rowNumber, 1, 1, values.length).setValues([values]);
    else usersSheet.appendRow(values);
  } finally {
    lock.releaseLock();
  }
  return jsonResponse({ ok: true, spreadsheetId, message: `Planilha “${target.getName()}” conectada com sucesso.` });
}

function addEntry(user, payload) {
  const description = sanitizeText(payload.descricao, 100);
  const value = Number(payload.valor);
  const type = sanitizeText(payload.tipo, 10);
  const payment = sanitizeText(payload.formaPagamento, 20);
  if (!description) throw new Error('Informe a descrição.');
  if (!Number.isFinite(value) || value <= 0 || value > 100000000) throw new Error('Informe um valor válido.');
  if (!CONFIG.ALLOWED_TYPES.includes(type)) throw new Error('Tipo inválido.');
  if (!CONFIG.ALLOWED_PAYMENTS.includes(payment)) throw new Error('Forma de pagamento inválida.');

  const configuration = findUserRow(user.sub);
  if (!configuration || !configuration.values[3]) throw new Error('Configure sua planilha antes de lançar dados.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const spreadsheet = SpreadsheetApp.openById(String(configuration.values[3]));
    const sheet = initializeDataSheet(spreadsheet);
    sheet.appendRow([Utilities.getUuid(), new Date(), description, value, type, payment, 'Frontend', user.email]);
  } finally {
    lock.releaseLock();
  }
  return jsonResponse({ ok: true, message: 'Lançamento salvo com sucesso.' });
}

function getUsersSheet() {
  const appSpreadsheetId = PropertiesService.getScriptProperties().getProperty('APP_SPREADSHEET_ID');
  if (!appSpreadsheetId) throw new Error('APP_SPREADSHEET_ID não configurado no Apps Script.');
  const spreadsheet = SpreadsheetApp.openById(appSpreadsheetId);
  let sheet = spreadsheet.getSheetByName(CONFIG.APP_USERS_SHEET);
  if (!sheet) sheet = spreadsheet.insertSheet(CONFIG.APP_USERS_SHEET);
  if (sheet.getLastRow() === 0) formatHeader(sheet, CONFIG.USER_HEADERS);
  return sheet;
}

function findUserRow(googleId, providedSheet) {
  const sheet = providedSheet || getUsersSheet();
  if (sheet.getLastRow() < 2) return null;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, CONFIG.USER_HEADERS.length).getValues();
  const index = values.findIndex((row) => String(row[0]) === String(googleId));
  return index < 0 ? null : { rowNumber: index + 2, values: values[index] };
}

function initializeDataSheet(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(CONFIG.DATA_SHEET);
  if (!sheet) sheet = spreadsheet.insertSheet(CONFIG.DATA_SHEET);
  if (sheet.getLastRow() === 0) {
    formatHeader(sheet, CONFIG.DATA_HEADERS);
    sheet.getRange('B:B').setNumberFormat('dd/mm/yyyy hh:mm');
    sheet.getRange('D:D').setNumberFormat('R$ #,##0.00');
  }
  return sheet;
}

function formatHeader(sheet, headers) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#b7f22f').setFontColor('#11160d');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
}

function normalizeSpreadsheetId(value) {
  const text = String(value || '').trim();
  const urlMatch = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const id = urlMatch ? urlMatch[1] : text;
  return /^[a-zA-Z0-9-_]{20,100}$/.test(id) ? id : '';
}

function sanitizeText(value, maxLength) {
  const text = String(value || '').trim().slice(0, maxLength);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function safeError(error) {
  const message = String(error && error.message || 'Requisição inválida.');
  const allowed = ['login', 'sessão', 'conta google', 'configurado', 'planilha', 'descrição', 'valor', 'tipo', 'forma', 'ação'];
  return allowed.some((term) => message.toLowerCase().includes(term)) ? message : 'Não foi possível concluir a operação.';
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
