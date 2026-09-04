const CONFIG = Object.freeze({
  LAUNCHES_SHEET: 'Lancamentos',
  SETTINGS_SHEET: 'Configuracoes',
  RECURRING_SHEET: 'Recorrentes',
  LAUNCH_HEADERS: [
    'Competência', 'Descrição', 'Valor', 'Tipo', 'Carteira', 'Parcela',
    'Total de parcelas', 'Data do lançamento', 'Tipo de pagamento', 'Categoria',
    'groupId', 'ID', 'recurringId', 'Origem', 'Data de inserção',
  ],
  SETTINGS_HEADERS: ['Carteiras', 'Tipo da carteira', 'Dia de fechamento', 'Dia de vencimento', 'Categorias'],
  RECURRING_HEADERS: [
    'recurringId', 'Descrição', 'Valor', 'Tipo', 'Categoria', 'Carteira',
    'Data de início', 'Competência inicial', 'Periodicidade', 'Status',
    'Data de criação', 'Data de atualização',
  ],
  DEFAULT_WALLETS: ['Carteira', 'Cartão de crédito 1', 'Cartão de crédito 2'],
  DEFAULT_CATEGORIES: ['Alimentação', 'Lazer', 'Transporte', 'Saúde', 'Moradia', 'Compras', 'Outros'],
  MOVEMENT_TYPES: ['Entrada', 'Saída'],
  PAYMENT_TYPES: ['À vista', 'Parcelado'],
  INSTALLMENT_MODES: ['valorParcela', 'valorTotal'],
  MAX_INSTALLMENTS: 120,
  RECURRENCE_PERIODS: ['Mensal'],
  RECURRENCE_STATUSES: ['Ativa', 'Inativa'],
});

function doGet() {
  return jsonResponse({ ok: true, message: 'Cash Of Anarchy API online.' });
}

// Execute uma vez pelo editor após instalar ou alterar os escopos do manifesto.
// O Apps Script exibirá a tela de consentimento do proprietário da implantação.
function authorizeApplication() {
  const spreadsheet = getSpreadsheet();
  spreadsheet.getName();
  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=authorization-check', { muteHttpExceptions: true });
  return `Permissões concedidas. Verificação externa respondeu com HTTP ${response.getResponseCode()}.`;
}

function doPost(event) {
  try {
    const payload = JSON.parse(event.postData.contents || '{}');
    if (payload.action === 'autenticarGoogle') {
      const identity = verifyGoogleIdentity(payload.idToken);
      return jsonResponse({ ok: true, usuario: identity, sessionToken: createApplicationSession(identity) });
    }
    verifyApplicationSession(payload.sessionToken);
    if (payload.action === 'inicializar') return initializeApplication();
    if (payload.action === 'obterConfiguracoes') return getSettingsResponse();
    if (payload.action === 'obterDashboard') return getDashboardResponse(payload.competencia);
    if (payload.action === 'adicionar') return addLaunch(payload);
    if (payload.action === 'listarRecorrentes') return listRecurringResponse();
    if (payload.action === 'adicionarRecorrente') return addRecurring(payload);
    if (payload.action === 'atualizarRecorrente') return updateRecurring(payload);
    if (payload.action === 'excluirRecorrente') return deleteRecurring(payload.recurringId);
    if (payload.action === 'processarRecorrentes') return processRecurring(payload.competencia);
    if (payload.action === 'removerLancamentosRecorrentes') return removeRecurringLaunches(payload.competencia);
    if (payload.action === 'efetivarRecorrente') return effectRecurring(payload);
    if (payload.action === 'pagarCartao') return payCreditCard(payload);
    return jsonResponse({ ok: false, error: 'Ação não permitida.' });
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: safeError(error), code: error && error.code || 'REQUEST_FAILED' });
  }
}

function verifyGoogleIdentity(idToken) {
  const properties = PropertiesService.getScriptProperties();
  const clientId = String(properties.getProperty('GOOGLE_CLIENT_ID') || '').trim();
  const allowedEmails = getAllowedGoogleEmails();
  if (!clientId || !allowedEmails.length) throw createAuthError('Login Google não configurado no Apps Script.');

  const token = String(idToken || '').trim();
  if (!token || token.length > 10000) throw createAuthError('Faça login com sua conta Google para continuar.');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)
    .map((byte) => (`0${((byte + 256) % 256).toString(16)}`).slice(-2)).join('');
  const cache = CacheService.getScriptCache();
  const cached = cache.get(`google-identity:${digest}`);
  if (cached) return JSON.parse(cached);

  const response = UrlFetchApp.fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw createAuthError('Sua sessão Google expirou. Entre novamente.');
  const claims = JSON.parse(response.getContentText() || '{}');
  const issuerValid = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  const email = String(claims.email || '').toLowerCase();
  const expiresAt = Number(claims.exp || 0);
  if (!issuerValid || claims.aud !== clientId || String(claims.email_verified) !== 'true' || expiresAt * 1000 <= Date.now()) {
    throw createAuthError('Não foi possível validar sua conta Google.');
  }
  if (!allowedEmails.includes(email)) throw createAuthError('Esta conta Google não tem acesso à aplicação.');

  const identity = { sub: String(claims.sub || ''), email, name: String(claims.name || email), picture: String(claims.picture || '') };
  const ttlSeconds = Math.max(60, Math.min(3300, expiresAt - Math.floor(Date.now() / 1000) - 30));
  cache.put(`google-identity:${digest}`, JSON.stringify(identity), ttlSeconds);
  return identity;
}

function createAuthError(message) {
  const error = new Error(message);
  error.code = 'AUTH_REQUIRED';
  return error;
}

function createApplicationSession(identity) {
  const payload = { sub: identity.sub, email: identity.email, exp: Date.now() + (12 * 60 * 60 * 1000) };
  const encodedPayload = Utilities.base64EncodeWebSafe(JSON.stringify(payload), Utilities.Charset.UTF_8).replace(/=+$/g, '');
  return `${encodedPayload}.${signApplicationSession(encodedPayload)}`;
}

function verifyApplicationSession(sessionToken) {
  const token = String(sessionToken || '').trim();
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw createAuthError('Sua sessão expirou. Entre novamente com Google.');
  if (!constantTimeEquals(parts[1], signApplicationSession(parts[0]))) throw createAuthError('Sua sessão é inválida. Entre novamente com Google.');

  let session;
  try { session = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8')); }
  catch (error) { throw createAuthError('Sua sessão é inválida. Entre novamente com Google.'); }
  const email = String(session.email || '').toLowerCase();
  if (!session.sub || !email || Number(session.exp || 0) <= Date.now() || !getAllowedGoogleEmails().includes(email)) {
    throw createAuthError('Sua sessão expirou ou a conta perdeu o acesso. Entre novamente.');
  }
  return { sub: String(session.sub), email };
}

function signApplicationSession(encodedPayload) {
  const signature = Utilities.computeHmacSha256Signature(encodedPayload, getApplicationSessionSecret());
  return Utilities.base64EncodeWebSafe(signature).replace(/=+$/g, '');
}

function getApplicationSessionSecret() {
  const properties = PropertiesService.getScriptProperties();
  let secret = properties.getProperty('AUTH_SESSION_SECRET');
  if (secret) return secret;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    secret = properties.getProperty('AUTH_SESSION_SECRET');
    if (!secret) {
      secret = `${Utilities.getUuid()}${Utilities.getUuid()}${Utilities.getUuid()}`;
      properties.setProperty('AUTH_SESSION_SECRET', secret);
    }
    return secret;
  } finally { lock.releaseLock(); }
}

function getAllowedGoogleEmails() {
  return String(PropertiesService.getScriptProperties().getProperty('ALLOWED_GOOGLE_EMAILS') || '')
    .split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
}

function constantTimeEquals(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
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
    const recurring = getOrCreateSheet(spreadsheet, CONFIG.RECURRING_SHEET);
    ensureHeaders(recurring, CONFIG.RECURRING_HEADERS);
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

function getDashboardResponse(rawCompetence) {
  const competence = normalizeCompetence(rawCompetence);
  if (!competence) throw new Error('Informe uma competência válida no formato MM/AAAA.');
  const sheet = getOrCreateSheet(getSpreadsheet(), CONFIG.LAUNCHES_SHEET);
  const headerMap = ensureLaunchHeaders(sheet);
  const storedLaunches = readDashboardLaunches(sheet, headerMap);
  const actualLaunches = storedLaunches.filter((item) => !item.recurringId || item.origin === 'Recorrência faturada');
  const recurringSheet = getOrCreateSheet(getSpreadsheet(), CONFIG.RECURRING_SHEET);
  const recurringMap = ensureHeaders(recurringSheet, CONFIG.RECURRING_HEADERS);
  const rules = readRecurringRowsRaw(recurringSheet, recurringMap);
  const pending = buildPendingRecurring(rules, actualLaunches, competence);
  const launches = actualLaunches;
  const settingsSheet = getOrCreateSheet(getSpreadsheet(), CONFIG.SETTINGS_SHEET);
  initializeSettingsSheet(settingsSheet);
  const accountNames = new Set(readSettings(settingsSheet).contas);
  actualLaunches.concat(pending).forEach((item) => { item.walletType = accountNames.has(item.wallet) ? 'Conta' : 'Cartão'; });
  const purchaseTotals = launches.reduce((totals, item) => {
    if (item.groupId && item.installmentCount > 1) totals[item.groupId] = (totals[item.groupId] || 0) + Math.abs(item.value);
    return totals;
  }, {});
  launches.forEach((item) => {
    item.purchaseTotal = item.groupId && purchaseTotals[item.groupId]
      ? purchaseTotals[item.groupId]
      : Math.abs(item.value) * item.installmentCount;
  });
  const selected = launches.filter((item) => item.competence === competence);
  const previous = launches.filter((item) => compareCompetences(item.competence, competence) < 0);
  const accumulated = launches.filter((item) => compareCompetences(item.competence, competence) <= 0);
  const future = launches.filter((item) => compareCompetences(item.competence, competence) >= 0);
  const monthGroups = {};
  future.forEach((item) => {
    if (!monthGroups[item.competence]) monthGroups[item.competence] = [];
    monthGroups[item.competence].push(item);
  });

  const planning = Object.keys(monthGroups)
    .sort(compareCompetences)
    .slice(0, 18)
    .map((month) => ({
      competence: month,
      ...summarizeLaunches(monthGroups[month]),
      ...summarizeFinancialPosition(launches.filter((item) => compareCompetences(item.competence, month) <= 0)),
    }));
  const categories = groupDashboardValues(selected.filter((item) => item.value < 0), 'category', true);
  const wallets = groupDashboardValues(selected, 'wallet', false);
  const upcomingDebts = future.filter((item) => item.value < 0)
    .sort((left, right) => compareCompetences(left.competence, right.competence) || left.description.localeCompare(right.description))
    .slice(0, 60);

  return jsonResponse({
    ok: true,
    competencia: competence,
    resumo: summarizeLaunches(selected),
    posicao: {
      ...summarizeFinancialPosition(accumulated),
      cashPrevious: summarizeFinancialPosition(previous).cashBalance,
      cashMovement: selected.filter(isCashLaunch).reduce((total, item) => total + item.value, 0),
    },
    planejamento: planning,
    categorias: categories,
    carteiras: wallets,
    saldosCarteiras: groupDashboardValues(accumulated, 'wallet', false),
    lancamentos: selected.concat(pending.filter((item) => item.competence === competence)).sort((left, right) => Math.abs(right.value) - Math.abs(left.value)),
    recorrenciasPendentes: pending.filter((item) => item.competence === competence),
    totalRecorrenciasPendentes: pending.filter((item) => item.competence === competence).length,
    dividasFuturas: upcomingDebts,
    totalDividasFuturas: future.filter((item) => item.value < 0).reduce((total, item) => total + Math.abs(item.value), 0),
  });
}

function readDashboardLaunches(sheet, headerMap) {
  if (sheet.getLastRow() < 2) return [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headerMap.headers.length).getValues();
  const get = (row, header) => headerMap.indexes[header] === undefined ? '' : row[headerMap.indexes[header]];
  return rows.map((row) => {
    const competence = normalizeCompetence(get(row, 'Competência'));
    const movementType = String(get(row, 'Tipo') || '');
    const rawValue = Number(get(row, 'Valor'));
    if (!competence || !Number.isFinite(rawValue) || !['Entrada', 'Saída'].includes(movementType)) return null;
    return {
      id: String(get(row, 'ID') || ''), groupId: String(get(row, 'groupId') || ''), recurringId: String(get(row, 'recurringId') || ''),
      description: String(get(row, 'Descrição') || ''), value: normalizeSignedValue(rawValue, movementType), movementType,
      category: String(get(row, 'Categoria') || 'Sem categoria'), wallet: String(get(row, 'Carteira') || 'Sem carteira'),
      paymentType: String(get(row, 'Tipo de pagamento') || ''), installment: Number(get(row, 'Parcela')) || 1,
      installmentCount: Number(get(row, 'Total de parcelas')) || 1, competence,
      launchDate: formatDateForApi(get(row, 'Data do lançamento')), origin: String(get(row, 'Origem') || ''),
    };
  }).filter(Boolean);
}

function summarizeLaunches(items) {
  const income = items.reduce((total, item) => total + (item.value > 0 ? item.value : 0), 0);
  const expenses = items.reduce((total, item) => total + (item.value < 0 ? Math.abs(item.value) : 0), 0);
  return { income, expenses, balance: income - expenses, count: items.length };
}

function isCashLaunch(item) {
  return item.walletType === 'Conta' || (!item.walletType && String(item.wallet || '').trim().toLowerCase() === 'dinheiro');
}

function buildPendingRecurring(rules, actualLaunches, competence) {
  const billedKeys = new Set(actualLaunches.filter((item) => item.recurringId).map((item) => `${item.recurringId}|${item.competence}`));
  return rules.filter((rule) => rule.status === 'Ativa' && rule.periodicity === 'Mensal' && rule.initialCompetence
      && compareCompetences(rule.initialCompetence, competence) <= 0 && !billedKeys.has(`${rule.recurringId}|${competence}`))
    .map((rule) => ({ id: `provision:${rule.recurringId}:${competence}`, groupId: '', recurringId: rule.recurringId,
      description: rule.description, value: rule.value, movementType: rule.movementType, category: rule.category || 'Sem categoria',
      wallet: rule.wallet || 'Sem carteira', paymentType: 'Recorrente', installment: 1, installmentCount: 1, competence,
      launchDate: '', origin: 'Recorrência provisionada', purchaseTotal: Math.abs(rule.value), pending: true }));
}

function summarizeFinancialPosition(items) {
  const cashBalance = items.filter(isCashLaunch).reduce((total, item) => total + item.value, 0);
  const cardBalances = groupDashboardValues(items.filter((item) => !isCashLaunch(item)), 'wallet', false);
  const cardDebt = cardBalances.reduce((total, card) => total + (card.balance < 0 ? Math.abs(card.balance) : 0), 0);
  const cardCredit = cardBalances.reduce((total, card) => total + (card.balance > 0 ? card.balance : 0), 0);
  return { cashBalance, cardDebt, cardCredit, netPosition: cashBalance - cardDebt + cardCredit, cardCount: cardBalances.length };
}

function groupDashboardValues(items, property, expensesOnly) {
  const groups = {};
  items.forEach((item) => {
    const key = item[property] || 'Não informado';
    if (!groups[key]) groups[key] = { name: key, income: 0, expenses: 0, balance: 0, count: 0 };
    if (item.value > 0) groups[key].income += item.value;
    if (item.value < 0) groups[key].expenses += Math.abs(item.value);
    groups[key].balance += item.value;
    groups[key].count += 1;
  });
  return Object.values(groups).sort((left, right) => expensesOnly ? right.expenses - left.expenses : Math.abs(right.balance) - Math.abs(left.balance));
}

function addLaunch(payload) {
  const spreadsheet = getSpreadsheet();
  const settingsSheet = getOrCreateSheet(spreadsheet, CONFIG.SETTINGS_SHEET);
  initializeSettingsSheet(settingsSheet);
  const settings = readSettings(settingsSheet);
  const launch = validateLaunch(payload, settings);
  const installments = createInstallments(launch);
  const groupId = Utilities.getUuid();
  const insertedAt = new Date();

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getOrCreateSheet(spreadsheet, CONFIG.LAUNCHES_SHEET);
    const headerMap = ensureLaunchHeaders(sheet);
    const rows = installments.map((installment) => buildLaunchRow(headerMap, {
      id: Utilities.getUuid(),
      groupId,
      description: launch.description,
      value: installment.valueCents / 100,
      movementType: launch.movementType,
      category: launch.category,
      wallet: launch.wallet,
      paymentType: launch.paymentType,
      installmentNumber: installment.number,
      installmentCount: installments.length,
      competence: installment.competence,
      launchDate: launch.launchDate,
      insertedAt,
      recurringId: '',
    }));
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headerMap.headers.length).setValues(rows);
  } finally {
    lock.releaseLock();
  }

  return jsonResponse({
    ok: true,
    groupId,
    parcelasCriadas: installments.length,
    message: installments.length === 1 ? 'Lançamento salvo com sucesso.' : `${installments.length} parcelas salvas com sucesso.`,
  });
}

function listRecurringResponse() {
  const sheet = getOrCreateSheet(getSpreadsheet(), CONFIG.RECURRING_SHEET);
  const headerMap = ensureHeaders(sheet, CONFIG.RECURRING_HEADERS);
  return jsonResponse({ ok: true, recorrentes: readRecurringRows(sheet, headerMap) });
}

function addRecurring(payload) {
  const spreadsheet = getSpreadsheet();
  const settingsSheet = getOrCreateSheet(spreadsheet, CONFIG.SETTINGS_SHEET);
  initializeSettingsSheet(settingsSheet);
  const recurring = validateRecurring(payload, readSettings(settingsSheet));
  const now = new Date();
  const recurringId = Utilities.getUuid();

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getOrCreateSheet(spreadsheet, CONFIG.RECURRING_SHEET);
    const headerMap = ensureHeaders(sheet, CONFIG.RECURRING_HEADERS);
    const row = buildRecurringRow(headerMap, { ...recurring, recurringId, createdAt: now, updatedAt: now });
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, headerMap.headers.length).setValues([row]);
  } finally {
    lock.releaseLock();
  }
  return jsonResponse({ ok: true, recurringId, message: 'Recorrência criada com sucesso.' });
}

function updateRecurring(payload) {
  const recurringId = sanitizeText(payload.recurringId, 100);
  if (!recurringId) throw new Error('Identificador da recorrência inválido.');
  const spreadsheet = getSpreadsheet();
  const settingsSheet = getOrCreateSheet(spreadsheet, CONFIG.SETTINGS_SHEET);
  initializeSettingsSheet(settingsSheet);
  const recurring = validateRecurring(payload, readSettings(settingsSheet));

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getOrCreateSheet(spreadsheet, CONFIG.RECURRING_SHEET);
    const headerMap = ensureHeaders(sheet, CONFIG.RECURRING_HEADERS);
    const existing = findRecurringRow(sheet, headerMap, recurringId);
    if (!existing) throw new Error('Recorrência não encontrada.');
    const createdAt = existing.values[headerMap.indexes['Data de criação']] || new Date();
    const row = buildRecurringRow(headerMap, { ...recurring, recurringId, createdAt, updatedAt: new Date() }, existing.values);
    sheet.getRange(existing.rowNumber, 1, 1, headerMap.headers.length).setValues([row]);
  } finally {
    lock.releaseLock();
  }
  return jsonResponse({ ok: true, recurringId, message: 'Recorrência atualizada com sucesso.' });
}

function processRecurring(rawCompetence) {
  const competence = normalizeCompetence(rawCompetence);
  if (!competence) throw new Error('Informe uma competência válida no formato MM/AAAA.');
  const spreadsheet = getSpreadsheet();
  const recurringSheet = getOrCreateSheet(spreadsheet, CONFIG.RECURRING_SHEET);
  const recurringMap = ensureHeaders(recurringSheet, CONFIG.RECURRING_HEADERS);
  const rules = readRecurringRowsRaw(recurringSheet, recurringMap)
    .filter((item) => item.status === 'Ativa' && item.periodicity === 'Mensal' && item.initialCompetence && compareCompetences(item.initialCompetence, competence) <= 0);
  return jsonResponse({ ok: true, competencia: competence, recorrenciasElegiveis: rules.length, lancamentosCriados: 0,
    message: 'Não é mais necessário processar recorrências. Os provisionamentos são gerados automaticamente.' });
}

function removeRecurringLaunches(rawCompetence) {
  const competence = normalizeCompetence(rawCompetence);
  if (!competence) throw new Error('Informe uma competência válida no formato MM/AAAA.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let removed = 0;
  try {
    const sheet = getOrCreateSheet(getSpreadsheet(), CONFIG.LAUNCHES_SHEET);
    const headerMap = ensureLaunchHeaders(sheet);
    if (sheet.getLastRow() < 2) return jsonResponse({ ok: true, competencia: competence, lancamentosRemovidos: 0, message: 'Nenhum lançamento recorrente encontrado nessa competência.' });

    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headerMap.headers.length).getValues();
    const competenceIndex = headerMap.indexes['Competência'];
    const recurringIndex = headerMap.indexes['recurringId'];
    const originIndex = headerMap.indexes['Origem'];
    const rowsToDelete = [];
    rows.forEach((row, index) => {
      if (normalizeCompetence(row[competenceIndex]) === competence && String(row[recurringIndex]).trim() && String(row[originIndex]) !== 'Recorrência faturada') rowsToDelete.push(index + 2);
    });
    rowsToDelete.reverse().forEach((rowNumber) => sheet.deleteRow(rowNumber));
    removed = rowsToDelete.length;
  } finally {
    lock.releaseLock();
  }

  return jsonResponse({
    ok: true,
    competencia: competence,
    lancamentosRemovidos: removed,
    message: removed ? `${removed} provisionamento(s) removido(s).` : 'Nenhum provisionamento removível encontrado nessa competência. Registros faturados são protegidos.',
  });
}

function effectRecurring(payload) {
  const recurringId = sanitizeText(payload.recurringId, 100);
  const competence = normalizeCompetence(payload.competencia);
  const launchDate = normalizeDate(payload.dataLancamento);
  const inputValue = Number(payload.valor);
  const wallet = sanitizeText(payload.carteira, 60);
  if (!recurringId || !competence || !launchDate || !wallet || !Number.isFinite(inputValue) || inputValue === 0) throw new Error('Informe recorrência, competência, origem, data e valor válidos.');
  const spreadsheet = getSpreadsheet();
  const recurringSheet = getOrCreateSheet(spreadsheet, CONFIG.RECURRING_SHEET);
  const recurringMap = ensureHeaders(recurringSheet, CONFIG.RECURRING_HEADERS);
  const rule = readRecurringRowsRaw(recurringSheet, recurringMap).find((item) => item.recurringId === recurringId);
  if (!rule || rule.status !== 'Ativa') throw new Error('Recorrência ativa não encontrada.');
  const settingsSheet = getOrCreateSheet(spreadsheet, CONFIG.SETTINGS_SHEET); initializeSettingsSheet(settingsSheet);
  if (!readSettings(settingsSheet).carteiras.includes(wallet)) throw new Error('A origem selecionada não existe nas configurações.');
  const launches = getOrCreateSheet(spreadsheet, CONFIG.LAUNCHES_SHEET);
  const launchMap = ensureLaunchHeaders(launches);
  const rows = launches.getLastRow() > 1 ? launches.getRange(2, 1, launches.getLastRow() - 1, launchMap.headers.length).getValues() : [];
  const matchingIndexes = [];
  rows.forEach((row, index) => { if (String(row[launchMap.indexes['recurringId']]) === recurringId && normalizeCompetence(row[launchMap.indexes['Competência']]) === competence) matchingIndexes.push(index); });
  if (matchingIndexes.some((index) => String(rows[index][launchMap.indexes['Origem']]) === 'Recorrência faturada')) throw new Error('Esta recorrência já foi faturada nessa competência.');
  const value = normalizeSignedValue(inputValue, rule.movementType);
  const row = buildLaunchRow(launchMap, { id: Utilities.getUuid(), groupId: Utilities.getUuid(), recurringId,
    description: rule.description, value, movementType: rule.movementType, category: rule.category, wallet,
    paymentType: 'À vista', installmentNumber: 1, installmentCount: 1, competence, launchDate,
    insertedAt: new Date(), origin: 'Recorrência faturada' });
  launches.getRange(launches.getLastRow() + 1, 1, 1, launchMap.headers.length).setValues([row]);
  matchingIndexes.reverse().forEach((index) => launches.deleteRow(index + 2));
  return jsonResponse({ ok: true, message: 'Recorrência faturada e incluída nos saldos.' });
}

function deleteRecurring(rawRecurringId) {
  const recurringId = sanitizeText(rawRecurringId, 100);
  if (!recurringId) throw new Error('Recorrência inválida.');
  const spreadsheet = getSpreadsheet();
  const launches = getOrCreateSheet(spreadsheet, CONFIG.LAUNCHES_SHEET); const launchMap = ensureLaunchHeaders(launches);
  const launchRows = launches.getLastRow() > 1 ? launches.getRange(2, 1, launches.getLastRow() - 1, launchMap.headers.length).getValues() : [];
  const hasBilled = launchRows.some((row) => String(row[launchMap.indexes['recurringId']]) === recurringId && String(row[launchMap.indexes['Origem']]) === 'Recorrência faturada');
  if (hasBilled) throw new Error('Esta recorrência possui registros faturados e não pode ser excluída. Você pode deixá-la inativa.');
  const pendingRows = []; launchRows.forEach((row, index) => { if (String(row[launchMap.indexes['recurringId']]) === recurringId) pendingRows.push(index + 2); });
  pendingRows.reverse().forEach((rowNumber) => launches.deleteRow(rowNumber));
  const sheet = getOrCreateSheet(spreadsheet, CONFIG.RECURRING_SHEET); const map = ensureHeaders(sheet, CONFIG.RECURRING_HEADERS);
  const found = findRecurringRow(sheet, map, recurringId); if (!found) throw new Error('Recorrência não encontrada.');
  sheet.deleteRow(found.rowNumber);
  return jsonResponse({ ok: true, message: 'Recorrência e seus provisionamentos foram excluídos.' });
}

function payCreditCard(payload) {
  const card = sanitizeText(payload.cartao, 60);
  const account = sanitizeText(payload.carteira, 60);
  const competence = normalizeCompetence(payload.competencia);
  const launchDate = normalizeDate(payload.dataPagamento);
  const amount = Math.abs(Number(payload.valor));
  const spreadsheet = getSpreadsheet();
  const settingsSheet = getOrCreateSheet(spreadsheet, CONFIG.SETTINGS_SHEET);
  initializeSettingsSheet(settingsSheet);
  const settings = readSettings(settingsSheet);
  if (!settings.cartoes.some((item) => item.nome === card)) throw new Error('Selecione um cartão configurado.');
  if (!settings.contas.includes(account)) throw new Error('Selecione uma conta de origem configurada.');
  if (!competence || !launchDate || !Number.isFinite(amount) || amount <= 0) throw new Error('Informe competência, data e valor válidos.');
  const sheet = getOrCreateSheet(spreadsheet, CONFIG.LAUNCHES_SHEET);
  const headerMap = ensureLaunchHeaders(sheet);
  const groupId = Utilities.getUuid(); const now = new Date();
  const common = { groupId, paymentType: 'À vista', installmentNumber: 1, installmentCount: 1, competence, launchDate, insertedAt: now, recurringId: '' };
  const rows = [
    buildLaunchRow(headerMap, { ...common, id: Utilities.getUuid(), description: `Pagamento ${card}`, value: -amount, movementType: 'Saída', category: 'Pagamento de cartão', wallet: account }),
    buildLaunchRow(headerMap, { ...common, id: Utilities.getUuid(), description: `Pagamento ${card}`, value: amount, movementType: 'Entrada', category: 'Pagamento de cartão', wallet: card }),
  ];
  sheet.getRange(sheet.getLastRow() + 1, 1, 2, headerMap.headers.length).setValues(rows);
  return jsonResponse({ ok: true, groupId, message: 'Pagamento do cartão lançado nas duas carteiras.' });
}

function validateRecurring(payload, settings) {
  const description = sanitizeText(payload.descricao, 100);
  const inputValue = Number(payload.valor);
  const movementType = sanitizeText(payload.tipo, 10);
  const category = sanitizeText(payload.categoria, 60);
  const wallet = sanitizeText(payload.carteira, 60);
  const startDate = normalizeDate(payload.dataInicio);
  const initialCompetence = normalizeCompetence(payload.competenciaInicial);
  const periodicity = sanitizeText(payload.periodicidade, 20);
  const status = sanitizeText(payload.status, 10);
  if (!description) throw new Error('Informe a descrição da recorrência.');
  if (!Number.isFinite(inputValue) || inputValue === 0 || Math.abs(inputValue) > 100000000) throw new Error('Informe um valor válido.');
  if (!CONFIG.MOVEMENT_TYPES.includes(movementType)) throw new Error('Tipo de movimento inválido.');
  if (!settings.categorias.includes(category)) throw new Error('Categoria inválida ou removida da configuração.');
  if (!settings.carteiras.includes(wallet)) throw new Error('Carteira inválida ou removida da configuração.');
  if (!startDate) throw new Error('Informe uma data de início válida.');
  if (!initialCompetence) throw new Error('Informe uma competência inicial válida no formato MM/AAAA.');
  if (!CONFIG.RECURRENCE_PERIODS.includes(periodicity)) throw new Error('Periodicidade inválida.');
  if (!CONFIG.RECURRENCE_STATUSES.includes(status)) throw new Error('Status da recorrência inválido.');
  const value = normalizeSignedValue(inputValue, movementType);
  return { description, value, movementType, category, wallet, startDate, initialCompetence, periodicity, status };
}

function buildRecurringRow(headerMap, data, existingValues) {
  const row = existingValues ? existingValues.slice(0, headerMap.headers.length) : Array(headerMap.headers.length).fill('');
  while (row.length < headerMap.headers.length) row.push('');
  const set = (header, value) => { row[headerMap.indexes[header]] = value; };
  set('recurringId', data.recurringId); set('Descrição', data.description); set('Valor', data.value);
  set('Tipo', data.movementType); set('Categoria', data.category); set('Carteira', data.wallet);
  set('Data de início', data.startDate); set('Competência inicial', data.initialCompetence);
  set('Periodicidade', data.periodicity); set('Status', data.status);
  set('Data de criação', data.createdAt); set('Data de atualização', data.updatedAt);
  return row;
}

function readRecurringRows(sheet, headerMap) {
  return readRecurringRowsRaw(sheet, headerMap).map((item) => ({
    recurringId: item.recurringId, descricao: item.description, valor: item.value, tipo: item.movementType,
    categoria: item.category, carteira: item.wallet, dataInicio: formatDateForApi(item.startDate),
    competenciaInicial: item.initialCompetence, periodicidade: item.periodicity, status: item.status,
  }));
}

function readRecurringRowsRaw(sheet, headerMap) {
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headerMap.headers.length).getValues()
    .filter((row) => row[headerMap.indexes['recurringId']])
    .map((row) => {
      const movementType = String(row[headerMap.indexes['Tipo']] || '');
      return {
      recurringId: String(row[headerMap.indexes['recurringId']]), description: String(row[headerMap.indexes['Descrição']] || ''),
      value: normalizeSignedValue(Number(row[headerMap.indexes['Valor']]), movementType), movementType,
      category: String(row[headerMap.indexes['Categoria']] || ''), wallet: String(row[headerMap.indexes['Carteira']] || ''),
      startDate: row[headerMap.indexes['Data de início']], initialCompetence: normalizeCompetence(row[headerMap.indexes['Competência inicial']]),
      periodicity: String(row[headerMap.indexes['Periodicidade']] || ''), status: String(row[headerMap.indexes['Status']] || ''),
    };
    });
}

function findRecurringRow(sheet, headerMap, recurringId) {
  if (sheet.getLastRow() < 2) return null;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headerMap.headers.length).getValues();
  const index = rows.findIndex((row) => String(row[headerMap.indexes['recurringId']]) === recurringId);
  return index < 0 ? null : { rowNumber: index + 2, values: rows[index] };
}

function readRecurringLaunchKeys(sheet, headerMap) {
  if (sheet.getLastRow() < 2) return new Set();
  const recurringIndex = headerMap.indexes['recurringId'];
  const competenceIndex = headerMap.indexes['Competência'];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headerMap.headers.length).getValues();
  return new Set(rows.map((row) => ({ recurringId: String(row[recurringIndex] || ''), competence: normalizeCompetence(row[competenceIndex]) }))
    .filter((item) => item.recurringId && item.competence)
    .map((item) => `${item.recurringId}|${item.competence}`));
}

function validateLaunch(payload, settings) {
  const description = sanitizeText(payload.descricao, 100);
  const inputValue = Number(payload.valor);
  const movementType = sanitizeText(payload.tipo, 10);
  const category = sanitizeText(payload.categoria, 60);
  const wallet = sanitizeText(payload.carteira, 60);
  const paymentType = sanitizeText(payload.tipoPagamento, 20);
  const installmentMode = sanitizeText(payload.modoParcelamento || 'valorParcela', 20);
  const installmentCount = paymentType === 'Parcelado' ? Number(payload.parcelas) : 1;
  const launchDate = normalizeDate(payload.dataLancamento || payload.dataCompra);
  const card = settings.cartoes.find((item) => item.nome === wallet);
  const competence = card ? calculateCardCompetence(launchDate, card.fechamento) : normalizeCompetence(payload.competencia);

  if (!description) throw new Error('Informe a descrição.');
  if (!Number.isFinite(inputValue) || inputValue === 0 || Math.abs(inputValue) > 100000000) throw new Error('Informe um valor válido.');
  if (!CONFIG.MOVEMENT_TYPES.includes(movementType)) throw new Error('Tipo de movimento inválido.');
  if (!settings.categorias.includes(category)) throw new Error('Categoria inválida ou removida da configuração.');
  if (!settings.carteiras.includes(wallet)) throw new Error('Carteira inválida ou removida da configuração.');
  if (!CONFIG.PAYMENT_TYPES.includes(paymentType)) throw new Error('Tipo de pagamento inválido.');
  if (!CONFIG.INSTALLMENT_MODES.includes(installmentMode)) throw new Error('Modo de parcelamento inválido.');
  if (!Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > CONFIG.MAX_INSTALLMENTS) {
    throw new Error(`A quantidade de parcelas deve ficar entre 1 e ${CONFIG.MAX_INSTALLMENTS}.`);
  }
  if (!competence) throw new Error('Informe uma competência válida no formato MM/AAAA.');
  if (!launchDate) throw new Error('Informe uma data do lançamento válida.');

  const value = normalizeSignedValue(inputValue, movementType);
  return { description, value, movementType, category, wallet, paymentType, installmentMode, installmentCount, competence, launchDate };
}

function calculateCardCompetence(launchDate, closingDay) {
  if (!launchDate) return '';
  const date = launchDate instanceof Date ? launchDate : new Date(`${launchDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  const close = Number(closingDay) || 31;
  const offset = date.getDate() > close ? 2 : 1;
  return Utilities.formatDate(new Date(date.getFullYear(), date.getMonth() + offset, 1), Session.getScriptTimeZone(), 'MM/yyyy');
}

function createInstallments(launch) {
  const inputCents = Math.round(Math.abs(launch.value) * 100);
  const sign = launch.movementType === 'Saída' ? -1 : 1;
  const count = launch.installmentCount;
  let values;
  if (launch.paymentType === 'Parcelado' && launch.installmentMode === 'valorTotal') {
    const base = Math.floor(inputCents / count);
    const remainder = inputCents % count;
    values = Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
  } else {
    values = Array.from({ length: count }, () => inputCents);
  }
  return values.map((valueCents, index) => ({ number: index + 1, valueCents: valueCents * sign, competence: addMonthsToCompetence(launch.competence, index) }));
}

function buildLaunchRow(headerMap, data) {
  const row = Array(headerMap.headers.length).fill('');
  const set = (header, value) => { if (headerMap.indexes[header] !== undefined) row[headerMap.indexes[header]] = value; };
  set('ID', data.id);
  set('groupId', data.groupId);
  set('Descrição', data.description);
  set('Valor', data.value);
  set('Tipo', data.movementType);
  set('Categoria', data.category);
  set('Carteira', data.wallet);
  set('Tipo de pagamento', data.paymentType);
  set('Parcela', data.installmentNumber);
  set('Total de parcelas', data.installmentCount);
  set('Competência', data.competence);
  set('Data do lançamento', data.launchDate);
  set('Data de inserção', data.insertedAt);
  set('Origem', data.origin || 'Frontend');
  set('recurringId', data.recurringId || '');
  // Mantém a coluna legada de carteira preenchida quando existir.
  set('Forma de pagamento', data.wallet);
  return row;
}

function ensureLaunchHeaders(sheet) {
  migrateLegacyColumn(sheet, 'Data', 'Data de inserção');
  migrateLegacyColumn(sheet, 'Data da compra', 'Data do lançamento');
  migrateLegacyColumn(sheet, 'purchaseId', 'groupId');
  let headers = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String) : [];
  if (sheet.getLastRow() === 0 || headers.every((header) => !header)) headers = [];
  const missing = CONFIG.LAUNCH_HEADERS.filter((header) => !headers.includes(header));
  const merged = headers.concat(missing);
  if (missing.length || sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, merged.length).setValues([merged]).setFontWeight('bold').setBackground('#b7f22f').setFontColor('#11160d');
  }
  const orderedHeaders = CONFIG.LAUNCH_HEADERS.concat(merged.filter((header) => !CONFIG.LAUNCH_HEADERS.includes(header)));
  const ordered = reorderSheetColumns(sheet, merged, orderedHeaders);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, ordered.length);
  const indexes = Object.fromEntries(ordered.map((header, index) => [header, index]));
  normalizeExistingLaunchSigns(sheet, indexes);
  normalizeCompetenceColumn(sheet, indexes['Competência']);
  if (indexes['Valor'] !== undefined) sheet.getRange(2, indexes['Valor'] + 1, Math.max(1, sheet.getMaxRows() - 1), 1).setNumberFormat('R$ #,##0.00');
  if (indexes['Data do lançamento'] !== undefined) sheet.getRange(2, indexes['Data do lançamento'] + 1, Math.max(1, sheet.getMaxRows() - 1), 1).setNumberFormat('dd/mm/yyyy');
  if (indexes['Data de inserção'] !== undefined) sheet.getRange(2, indexes['Data de inserção'] + 1, Math.max(1, sheet.getMaxRows() - 1), 1).setNumberFormat('dd/mm/yyyy hh:mm');
  return { headers: ordered, indexes };
}

function reorderSheetColumns(sheet, currentHeaders, orderedHeaders) {
  if (currentHeaders.join('\u0000') === orderedHeaders.join('\u0000')) return currentHeaders;
  const lastRow = Math.max(1, sheet.getLastRow());
  const values = sheet.getRange(1, 1, lastRow, currentHeaders.length).getValues();
  const currentIndexes = Object.fromEntries(currentHeaders.map((header, index) => [header, index]));
  const reorderedValues = values.map((row) => orderedHeaders.map((header) => row[currentIndexes[header]]));
  sheet.getRange(1, 1, lastRow, orderedHeaders.length).setValues(reorderedValues);
  sheet.getRange(1, 1, 1, orderedHeaders.length).setFontWeight('bold').setBackground('#b7f22f').setFontColor('#11160d');
  return orderedHeaders;
}

function normalizeExistingLaunchSigns(sheet, indexes) {
  if (sheet.getLastRow() < 2 || indexes['Valor'] === undefined || indexes['Tipo'] === undefined) return;
  const rowCount = sheet.getLastRow() - 1;
  const typeValues = sheet.getRange(2, indexes['Tipo'] + 1, rowCount, 1).getDisplayValues();
  const valueRange = sheet.getRange(2, indexes['Valor'] + 1, rowCount, 1);
  const values = valueRange.getValues();
  let changed = false;
  for (let index = 0; index < rowCount; index += 1) {
    const type = String(typeValues[index][0] || '');
    const currentValue = values[index][0];
    if (!['Entrada', 'Saída'].includes(type) || typeof currentValue !== 'number' || !Number.isFinite(currentValue)) continue;
    const normalized = normalizeSignedValue(currentValue, type);
    if (normalized !== currentValue) {
      values[index][0] = normalized;
      changed = true;
    }
  }
  if (changed) valueRange.setValues(values);
}

function ensureHeaders(sheet, requiredHeaders) {
  let headers = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String) : [];
  if (sheet.getLastRow() === 0 || headers.every((header) => !header)) headers = [];
  const missing = requiredHeaders.filter((header) => !headers.includes(header));
  const merged = headers.concat(missing);
  if (missing.length || sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, merged.length).setValues([merged]).setFontWeight('bold').setBackground('#b7f22f').setFontColor('#11160d');
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, merged.length);
  }
  const indexes = Object.fromEntries(merged.map((header, index) => [header, index]));
  if (indexes['Valor'] !== undefined) sheet.getRange(2, indexes['Valor'] + 1, Math.max(1, sheet.getMaxRows() - 1), 1).setNumberFormat('R$ #,##0.00');
  normalizeCompetenceColumn(sheet, indexes['Competência inicial']);
  ['Data de início', 'Data de criação', 'Data de atualização'].forEach((header) => {
    if (indexes[header] !== undefined) sheet.getRange(2, indexes[header] + 1, Math.max(1, sheet.getMaxRows() - 1), 1).setNumberFormat(header === 'Data de início' ? 'dd/mm/yyyy' : 'dd/mm/yyyy hh:mm');
  });
  return { headers: merged, indexes };
}

function migrateLegacyColumn(sheet, legacyHeader, currentHeader) {
  if (sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) return;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const legacyIndex = headers.indexOf(legacyHeader);
  const insertionIndex = headers.indexOf(currentHeader);
  if (legacyIndex < 0) return;

  // Se só existe a coluna antiga, renomeá-la preserva cabeçalho, dados e posição.
  if (insertionIndex < 0) {
    sheet.getRange(1, legacyIndex + 1).setValue(currentHeader);
    return;
  }

  // Se as duas existem, preserva o valor antigo apenas onde o novo está vazio.
  if (sheet.getLastRow() > 1) {
    const rowCount = sheet.getLastRow() - 1;
    const legacyValues = sheet.getRange(2, legacyIndex + 1, rowCount, 1).getValues();
    const insertionRange = sheet.getRange(2, insertionIndex + 1, rowCount, 1);
    const insertionValues = insertionRange.getValues();
    let changed = false;
    for (let index = 0; index < rowCount; index += 1) {
      if ((insertionValues[index][0] === '' || insertionValues[index][0] === null) && legacyValues[index][0] !== '') {
        insertionValues[index][0] = legacyValues[index][0];
        changed = true;
      }
    }
    if (changed) insertionRange.setValues(insertionValues);
  }
  sheet.deleteColumn(legacyIndex + 1);
}

function initializeSettingsSheet(sheet) {
  if (sheet.getLastRow() === 0) {
    const rowCount = Math.max(CONFIG.DEFAULT_WALLETS.length, CONFIG.DEFAULT_CATEGORIES.length);
    const rows = Array.from({ length: rowCount }, (_, index) => [CONFIG.DEFAULT_WALLETS[index] || '', index === 0 ? 'Conta' : 'Cartão', index ? 25 : '', index ? 5 : '', CONFIG.DEFAULT_CATEGORIES[index] || '']);
    sheet.getRange(1, 1, 1, CONFIG.SETTINGS_HEADERS.length).setValues([CONFIG.SETTINGS_HEADERS]).setFontWeight('bold').setBackground('#b7f22f').setFontColor('#11160d');
    sheet.getRange(2, 1, rows.length, CONFIG.SETTINGS_HEADERS.length).setValues(rows);
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, CONFIG.SETTINGS_HEADERS.length);
    return;
  }
  const oldHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  if (oldHeaders.length === 2 && oldHeaders[0] === 'Carteiras' && oldHeaders[1] === 'Categorias') {
    const oldRows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues() : [];
    sheet.clear();
    sheet.getRange(1, 1, 1, CONFIG.SETTINGS_HEADERS.length).setValues([CONFIG.SETTINGS_HEADERS]).setFontWeight('bold').setBackground('#b7f22f').setFontColor('#11160d');
    if (oldRows.length) sheet.getRange(2, 1, oldRows.length, CONFIG.SETTINGS_HEADERS.length).setValues(oldRows.map((row) => [row[0], String(row[0]).trim().toLowerCase() === 'dinheiro' ? 'Conta' : 'Cartão', '', '', row[1]]));
  }
}

function readSettings(sheet) {
  if (sheet.getLastRow() < 2) return { carteiras: [], contas: [], cartoes: [], categorias: [] };
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, CONFIG.SETTINGS_HEADERS.length).getDisplayValues();
  const wallets = uniqueNonEmpty(values.map((row) => row[0]));
  return {
    carteiras: wallets,
    contas: uniqueNonEmpty(values.filter((row) => String(row[1]).trim().toLowerCase() !== 'cartão' && String(row[1]).trim().toLowerCase() !== 'cartao').map((row) => row[0])),
    cartoes: values.filter((row) => row[0] && ['cartão', 'cartao'].includes(String(row[1]).trim().toLowerCase())).map((row) => ({ nome: row[0], fechamento: Number(row[2]) || 25, vencimento: Number(row[3]) || 5 })),
    categorias: uniqueNonEmpty(values.map((row) => row[4])),
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
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'MM/yyyy');
  }
  const match = String(value || '').trim().match(/^(0[1-9]|1[0-2])\/(\d{4})$/);
  return match ? `${match[1]}/${match[2]}` : '';
}

function normalizeCompetenceColumn(sheet, zeroBasedIndex) {
  if (zeroBasedIndex === undefined) return;
  const rowCount = Math.max(1, sheet.getMaxRows() - 1);
  const range = sheet.getRange(2, zeroBasedIndex + 1, rowCount, 1);
  range.setNumberFormat('@');
  if (sheet.getLastRow() < 2) return;

  const usedRange = sheet.getRange(2, zeroBasedIndex + 1, sheet.getLastRow() - 1, 1);
  const values = usedRange.getValues();
  let changed = false;
  values.forEach((row) => {
    const normalized = normalizeCompetence(row[0]);
    if (normalized && row[0] !== normalized) { row[0] = normalized; changed = true; }
  });
  if (changed) usedRange.setValues(values);
}

function addMonthsToCompetence(competence, months) {
  const [month, year] = competence.split('/').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
}

function compareCompetences(left, right) {
  const [leftMonth, leftYear] = left.split('/').map(Number);
  const [rightMonth, rightYear] = right.split('/').map(Number);
  return (leftYear * 12 + leftMonth) - (rightYear * 12 + rightMonth);
}

function dateForCompetence(startDate, competence) {
  const source = startDate instanceof Date ? startDate : new Date(startDate);
  const [month, year] = competence.split('/').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return new Date(year, month - 1, Math.min(source.getDate(), lastDay), 12, 0, 0);
}

function formatDateForApi(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '';
  return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
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

function normalizeSignedValue(value, movementType) {
  const absoluteValue = Math.abs(Number(value));
  return movementType === 'Saída' ? -absoluteValue : absoluteValue;
}

function sanitizeText(value, maxLength) {
  const text = String(value || '').trim().slice(0, maxLength);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function safeError(error) {
  const message = String(error && error.message || 'Requisição inválida.');
  const expected = ['SPREADSHEET_ID', 'descrição', 'valor', 'movimento', 'Categoria', 'Carteira', 'pagamento', 'parcelas', 'competência', 'data do lançamento', 'recorrência', 'Periodicidade', 'Status', 'data de início', 'Google', 'conta', 'acesso', 'sessão', 'login'];
  return expected.some((term) => message.toLowerCase().includes(term.toLowerCase())) ? message : 'Não foi possível concluir a operação.';
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
