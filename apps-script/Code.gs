const CONFIG = Object.freeze({
  LAUNCHES_SHEET: 'Lancamentos',
  SETTINGS_SHEET: 'Configuracoes',
  LAUNCH_HEADERS: [
    'ID', 'purchaseId', 'Descrição', 'Valor', 'Tipo', 'Categoria', 'Carteira',
    'Tipo de pagamento', 'Parcela', 'Total de parcelas', 'Competência',
    'Data da compra', 'Data de inserção', 'Origem',
  ],
  SETTINGS_HEADERS: ['Carteiras', 'Categorias'],
  DEFAULT_WALLETS: ['Carteira', 'Cartão de crédito 1', 'Cartão de crédito 2'],
  DEFAULT_CATEGORIES: ['Alimentação', 'Lazer', 'Transporte', 'Saúde', 'Moradia', 'Compras', 'Outros'],
  MOVEMENT_TYPES: ['Entrada', 'Saída'],
  PAYMENT_TYPES: ['À vista', 'Parcelado'],
  INSTALLMENT_MODES: ['valorParcela', 'valorTotal'],
  MAX_INSTALLMENTS: 120,
});

function doGet() {
  return jsonResponse({ ok: true, message: 'Cash Of Anarchy API online.' });
}

function doPost(event) {
  try {
    const payload = JSON.parse(event.postData.contents || '{}');
    if (payload.action === 'inicializar') return initializeApplication();
    if (payload.action === 'obterConfiguracoes') return getSettingsResponse();
    if (payload.action === 'adicionar') return addPurchase(payload);
    return jsonResponse({ ok: false, error: 'Ação não permitida.' });
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: safeError(error) });
  }
}

function initializeApplication() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const spreadsheet = getSpreadsheet();
    const launches = getOrCreateSheet(spreadsheet, CONFIG.LAUNCHES_SHEET);
    ensureLaunchHeaders(launches);
    const settings = getOrCreateSheet(spreadsheet, CONFIG.SETTINGS_SHEET);
    initializeSettingsSheet(settings);
    return jsonResponse({
      ok: true,
      message: 'Planilhas de lançamentos e configurações estão prontas.',
      configuracoes: readSettings(settings),
    });
  } finally {
    lock.releaseLock();
  }
}

function getSettingsResponse() {
  const sheet = getOrCreateSheet(getSpreadsheet(), CONFIG.SETTINGS_SHEET);
  initializeSettingsSheet(sheet);
  return jsonResponse({ ok: true, configuracoes: readSettings(sheet) });
}

function addPurchase(payload) {
  const spreadsheet = getSpreadsheet();
  const settingsSheet = getOrCreateSheet(spreadsheet, CONFIG.SETTINGS_SHEET);
  initializeSettingsSheet(settingsSheet);
  const settings = readSettings(settingsSheet);
  const purchase = validatePurchase(payload, settings);
  const installments = createInstallments(purchase);
  const purchaseId = Utilities.getUuid();
  const insertedAt = new Date();

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getOrCreateSheet(spreadsheet, CONFIG.LAUNCHES_SHEET);
    const headerMap = ensureLaunchHeaders(sheet);
    const rows = installments.map((installment) => buildLaunchRow(headerMap, {
      id: Utilities.getUuid(),
      purchaseId,
      description: purchase.description,
      value: installment.valueCents / 100,
      movementType: purchase.movementType,
      category: purchase.category,
      wallet: purchase.wallet,
      paymentType: purchase.paymentType,
      installmentNumber: installment.number,
      installmentCount: installments.length,
      competence: installment.competence,
      purchaseDate: purchase.purchaseDate,
      insertedAt,
    }));
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headerMap.headers.length).setValues(rows);
  } finally {
    lock.releaseLock();
  }

  return jsonResponse({
    ok: true,
    purchaseId,
    parcelasCriadas: installments.length,
    message: installments.length === 1 ? 'Lançamento salvo com sucesso.' : `${installments.length} parcelas salvas com sucesso.`,
  });
}

function validatePurchase(payload, settings) {
  const description = sanitizeText(payload.descricao, 100);
  const value = Number(payload.valor);
  const movementType = sanitizeText(payload.tipo, 10);
  const category = sanitizeText(payload.categoria, 60);
  const wallet = sanitizeText(payload.carteira, 60);
  const paymentType = sanitizeText(payload.tipoPagamento, 20);
  const installmentMode = sanitizeText(payload.modoParcelamento || 'valorParcela', 20);
  const installmentCount = paymentType === 'Parcelado' ? Number(payload.parcelas) : 1;
  const competence = normalizeCompetence(payload.competencia);
  const purchaseDate = normalizeDate(payload.dataCompra);

  if (!description) throw new Error('Informe a descrição.');
  if (!Number.isFinite(value) || value <= 0 || value > 100000000) throw new Error('Informe um valor válido.');
  if (!CONFIG.MOVEMENT_TYPES.includes(movementType)) throw new Error('Tipo de movimento inválido.');
  if (!settings.categorias.includes(category)) throw new Error('Categoria inválida ou removida da configuração.');
  if (!settings.carteiras.includes(wallet)) throw new Error('Carteira inválida ou removida da configuração.');
  if (!CONFIG.PAYMENT_TYPES.includes(paymentType)) throw new Error('Tipo de pagamento inválido.');
  if (!CONFIG.INSTALLMENT_MODES.includes(installmentMode)) throw new Error('Modo de parcelamento inválido.');
  if (!Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > CONFIG.MAX_INSTALLMENTS) {
    throw new Error(`A quantidade de parcelas deve ficar entre 1 e ${CONFIG.MAX_INSTALLMENTS}.`);
  }
  if (!competence) throw new Error('Informe uma competência válida no formato MM/AAAA.');
  if (!purchaseDate) throw new Error('Informe uma data da compra válida.');

  return { description, value, movementType, category, wallet, paymentType, installmentMode, installmentCount, competence, purchaseDate };
}

function createInstallments(purchase) {
  const inputCents = Math.round(purchase.value * 100);
  const count = purchase.installmentCount;
  let values;
  if (purchase.paymentType === 'Parcelado' && purchase.installmentMode === 'valorTotal') {
    const base = Math.floor(inputCents / count);
    const remainder = inputCents % count;
    values = Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
  } else {
    values = Array.from({ length: count }, () => inputCents);
  }
  return values.map((valueCents, index) => ({ number: index + 1, valueCents, competence: addMonthsToCompetence(purchase.competence, index) }));
}

function buildLaunchRow(headerMap, data) {
  const row = Array(headerMap.headers.length).fill('');
  const set = (header, value) => { if (headerMap.indexes[header] !== undefined) row[headerMap.indexes[header]] = value; };
  set('ID', data.id);
  set('purchaseId', data.purchaseId);
  set('Descrição', data.description);
  set('Valor', data.value);
  set('Tipo', data.movementType);
  set('Categoria', data.category);
  set('Carteira', data.wallet);
  set('Tipo de pagamento', data.paymentType);
  set('Parcela', data.installmentNumber);
  set('Total de parcelas', data.installmentCount);
  set('Competência', data.competence);
  set('Data da compra', data.purchaseDate);
  set('Data de inserção', data.insertedAt);
  set('Origem', 'Frontend');
  // Mantém colunas legadas preenchidas quando existirem.
  set('Data', data.insertedAt);
  set('Forma de pagamento', data.wallet);
  return row;
}

function ensureLaunchHeaders(sheet) {
  let headers = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String) : [];
  if (sheet.getLastRow() === 0 || headers.every((header) => !header)) headers = [];
  const missing = CONFIG.LAUNCH_HEADERS.filter((header) => !headers.includes(header));
  const merged = headers.concat(missing);
  if (missing.length || sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, merged.length).setValues([merged]).setFontWeight('bold').setBackground('#b7f22f').setFontColor('#11160d');
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, merged.length);
  }
  const indexes = Object.fromEntries(merged.map((header, index) => [header, index]));
  if (indexes['Valor'] !== undefined) sheet.getRange(2, indexes['Valor'] + 1, Math.max(1, sheet.getMaxRows() - 1), 1).setNumberFormat('R$ #,##0.00');
  if (indexes['Data da compra'] !== undefined) sheet.getRange(2, indexes['Data da compra'] + 1, Math.max(1, sheet.getMaxRows() - 1), 1).setNumberFormat('dd/mm/yyyy');
  if (indexes['Data de inserção'] !== undefined) sheet.getRange(2, indexes['Data de inserção'] + 1, Math.max(1, sheet.getMaxRows() - 1), 1).setNumberFormat('dd/mm/yyyy hh:mm');
  return { headers: merged, indexes };
}

function initializeSettingsSheet(sheet) {
  if (sheet.getLastRow() === 0) {
    const rowCount = Math.max(CONFIG.DEFAULT_WALLETS.length, CONFIG.DEFAULT_CATEGORIES.length);
    const rows = Array.from({ length: rowCount }, (_, index) => [CONFIG.DEFAULT_WALLETS[index] || '', CONFIG.DEFAULT_CATEGORIES[index] || '']);
    sheet.getRange(1, 1, 1, 2).setValues([CONFIG.SETTINGS_HEADERS]).setFontWeight('bold').setBackground('#b7f22f').setFontColor('#11160d');
    sheet.getRange(2, 1, rows.length, 2).setValues(rows);
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, 2);
  }
}

function readSettings(sheet) {
  if (sheet.getLastRow() < 2) return { carteiras: [], categorias: [] };
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues();
  return {
    carteiras: uniqueNonEmpty(values.map((row) => row[0])),
    categorias: uniqueNonEmpty(values.map((row) => row[1])),
  };
}

function getSpreadsheet() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) throw new Error('SPREADSHEET_ID não configurado.');
  return SpreadsheetApp.openById(spreadsheetId);
}

function getOrCreateSheet(spreadsheet, name) {
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function normalizeCompetence(value) {
  const match = String(value || '').trim().match(/^(0[1-9]|1[0-2])\/(\d{4})$/);
  return match ? `${match[1]}/${match[2]}` : '';
}

function addMonthsToCompetence(competence, months) {
  const [month, year] = competence.split('/').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? date : null;
}

function uniqueNonEmpty(values) {
  return [...new Set(values.map((value) => sanitizeText(value, 60)).filter(Boolean))];
}

function sanitizeText(value, maxLength) {
  const text = String(value || '').trim().slice(0, maxLength);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function safeError(error) {
  const message = String(error && error.message || 'Requisição inválida.');
  const expected = ['SPREADSHEET_ID', 'descrição', 'valor', 'movimento', 'Categoria', 'Carteira', 'pagamento', 'parcelas', 'competência', 'data da compra'];
  return expected.some((term) => message.toLowerCase().includes(term.toLowerCase())) ? message : 'Não foi possível concluir a operação.';
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
