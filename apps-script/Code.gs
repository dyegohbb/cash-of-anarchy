const CONFIG = Object.freeze({
  SHEET_NAME: 'Lancamentos',
  HEADERS: ['ID', 'Data', 'Descrição', 'Valor', 'Tipo', 'Forma de pagamento', 'Origem'],
  ALLOWED_TYPES: ['Entrada', 'Saída'],
  ALLOWED_PAYMENTS: ['Pix', 'Dinheiro', 'Cartão', 'Transferência', 'Outro'],
});

function doGet() {
  return jsonResponse({ ok: true, message: 'Cash Of Anarchy API online.' });
}

function doPost(event) {
  try {
    const payload = JSON.parse(event.postData.contents || '{}');
    if (payload.action === 'inicializar') return initializeSheet();
    if (payload.action === 'adicionar') return addEntry(payload);
    return jsonResponse({ ok: false, error: 'Ação não permitida.' });
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: 'Requisição inválida.' });
  }
}

function initializeSheet() {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const sheet = getOrCreateSheet();
    return jsonResponse({ ok: true, message: `A aba “${sheet.getName()}” está pronta.` });
  } finally {
    lock.releaseLock();
  }
}

function addEntry(payload) {
  const description = sanitizeText(payload.descricao, 100);
  const value = Number(payload.valor);
  const type = sanitizeText(payload.tipo, 10);
  const payment = sanitizeText(payload.formaPagamento, 20);

  if (!description) return jsonResponse({ ok: false, error: 'Informe a descrição.' });
  if (!Number.isFinite(value) || value <= 0 || value > 100000000) return jsonResponse({ ok: false, error: 'Informe um valor válido.' });
  if (!CONFIG.ALLOWED_TYPES.includes(type)) return jsonResponse({ ok: false, error: 'Tipo inválido.' });
  if (!CONFIG.ALLOWED_PAYMENTS.includes(payment)) return jsonResponse({ ok: false, error: 'Forma de pagamento inválida.' });

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const sheet = getOrCreateSheet();
    sheet.appendRow([Utilities.getUuid(), new Date(), description, value, type, payment, 'Frontend']);
    return jsonResponse({ ok: true, message: 'Lançamento salvo com sucesso.' });
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateSheet() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) throw new Error('SPREADSHEET_ID não configurado.');
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  let sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(CONFIG.SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    const header = sheet.getRange(1, 1, 1, CONFIG.HEADERS.length);
    header.setValues([CONFIG.HEADERS]).setFontWeight('bold').setBackground('#b7f22f').setFontColor('#11160d');
    sheet.setFrozenRows(1);
    sheet.getRange('B:B').setNumberFormat('dd/mm/yyyy hh:mm');
    sheet.getRange('D:D').setNumberFormat('R$ #,##0.00');
    sheet.autoResizeColumns(1, CONFIG.HEADERS.length);
  }
  return sheet;
}

function sanitizeText(value, maxLength) {
  const text = String(value || '').trim().slice(0, maxLength);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
