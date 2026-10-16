// Web予約システム（reservation/index.html）の画面の動作確認テスト
// 実行方法：node --test tests/reservation-page.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    RESERVATION_HTML_PATH, RESERVATION_LOGIC_PATH, BROWSER_CANDIDATES, findBrowser, renderDom, findById
} = require('./helpers');
const {
    RESERVATION_STORAGE_KEY, RESERVATION_CATALOG: CATALOG, parseReservationCode, toLocalDateString, addDaysToDateString
} = require(RESERVATION_LOGIC_PATH);

const BROWSER = findBrowser(BROWSER_CANDIDATES);
const readPage = () => fs.readFileSync(RESERVATION_HTML_PATH, 'utf8');
const readInlineScript = (html) => /<script>([\s\S]*?)<\/script>/.exec(html)[1];

// 画面の状態を書き出す関数（ページの中で動かす）
const CAPTURE_SOURCE = `const capture = () => ({
    title: document.title,
    heading: document.getElementById('pageHeading').textContent,
    startDate: document.getElementById('in_start').value,
    nights: document.getElementById('in_nights').value,
    buttonDisabled: document.getElementById('confirmButton').disabled,
    blockers: Array.from(document.querySelectorAll('#confirmBlockers li'), (item) => item.textContent),
    warnings: Array.from(document.querySelectorAll('#warningBox > div'), (box) => box.textContent.replace(/\\s+/g, ' ').trim()),
    staySymbols: Array.from(document.querySelectorAll('#availabilityTable td[data-stay-symbol]'), (cell) => cell.dataset.staySymbol),
    gymSymbols: Array.from(document.querySelectorAll('#availabilityTable td[data-facility="gym"]'), (cell) => cell.textContent),
    disabledSlots: document.querySelectorAll('input.slot-check:disabled').length,
    total: document.getElementById('fee_total').textContent,
    formHidden: document.getElementById('formView').classList.contains('hidden'),
    completeHidden: document.getElementById('completeView').classList.contains('hidden'),
    storage: localStorage.getItem('${RESERVATION_STORAGE_KEY}'),
    storageStatus: document.getElementById('storageStatus').textContent,
    code: document.getElementById('out_code').value,
    mailHref: document.getElementById('mailButton').getAttribute('href'),
    receiptText: document.getElementById('receipt').textContent.replace(/\\s+/g, ' ')
});
const setValue = (id, value) => { document.getElementById(id).value = value; };
const fillApplicant = () => {
    [['in_group', 'テスト団体'], ['in_representative', '山田 太郎'], ['in_phone', '000-0000-0000'],
     ['in_email', 'test@example.com'], ['in_purpose', 'スポーツ合宿'], ['in_price_type', 'ad'], ['in_meal_bf', '20']]
        .forEach(([id, value]) => setValue(id, value));
};`;

// 起動後に操作し、操作ごとの画面の状態をページに書き出すスクリプト
const buildScript = (steps) => `<script>
window.addEventListener('load', () => {
    window.confirm = () => true;
    ${CAPTURE_SOURCE}
    const states = [];
    ${steps}
    const dump = document.createElement('div');
    dump.id = 'test_dump';
    dump.textContent = encodeURIComponent(JSON.stringify(states));
    document.body.appendChild(dump);
});
</script>`;

const renderStates = (steps, configSource) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reservation-test-'));
    const htmlPath = path.join(dir, 'index.html');
    fs.writeFileSync(htmlPath, readPage().replace('</body>', `${buildScript(steps)}\n</body>`), 'utf8');
    fs.copyFileSync(RESERVATION_LOGIC_PATH, path.join(dir, 'reservation-logic.js'));
    if (configSource) fs.writeFileSync(path.join(dir, 'facility-config.js'), configSource, 'utf8');
    return JSON.parse(decodeURIComponent(findById(renderDom(BROWSER, htmlPath), 'test_dump')));
};

test('予約画面は reservation-logic.js と facility-config.js を読み込み、let・var を使っていない', () => {
    const html = readPage();
    assert.ok(html.indexOf('<script src="facility-config.js">') < html.indexOf('<script src="reservation-logic.js">'));
    assert.doesNotMatch(readInlineScript(html), /\b(let|var)\s/);
    assert.doesNotMatch(fs.readFileSync(RESERVATION_LOGIC_PATH, 'utf8'), /\b(let|var)\s/);
});

test('予約画面に会社名・住所・電話番号らしい表記が書かれていない', () => {
    const html = readPage();
    [/〒/, /TEL\s*\d/, /\d{2,4}-\d{2,4}-\d{3,4}/, /株式会社|協会|財団/, /[都道府県][^\s<'"`]*[市区町村]/].forEach((pattern) => {
        assert.doesNotMatch(html.replace('例：000-0000-0000', ''), pattern, `${pattern} に当てはまる表記があります`);
    });
});

test('画面：サンプル投入で◎/△/×が出て、定員超過は確定できず、確定すると保存・控え・メール・1行コードが出る', { skip: !BROWSER }, () => {
    const states = renderStates(`
        states.push(capture());
        insertSampleReservations();
        states.push(capture());
        fillApplicant();
        setValue('in_people', '10');
        document.querySelector('input.slot-check[data-facility="gym"]:not(:disabled)').checked = true;
        refreshAll();
        states.push(capture());
        setValue('in_people', '20');
        refreshSummary();
        states.push(capture());
        setValue('in_people', '10');
        refreshSummary();
        confirmReservation();
        states.push(capture());
    `);
    const [initial, withSamples, ready, overCapacity, completed] = states;
    const today = toLocalDateString(new Date());

    assert.strictEqual(initial.title, 'あおぞらセミナーハウス Web予約システム');
    assert.strictEqual(initial.heading, initial.title);
    assert.strictEqual(initial.startDate, addDaysToDateString(today, 3));
    assert.strictEqual(initial.nights, '2');
    assert.strictEqual(initial.buttonDisabled, true, '最初は未入力なので確定できない');
    assert.ok(initial.blockers.includes('団体名が未入力です'));
    assert.deepStrictEqual(initial.staySymbols, ['◎', '◎']);
    assert.strictEqual(initial.storage, null);

    assert.deepStrictEqual(withSamples.staySymbols, ['△', '◎'], '1泊目は85人で残りわずか');
    assert.deepStrictEqual(withSamples.gymSymbols, ['◎', '×', '◎'], '2日目の大体育館はすべて予約済み');
    assert.strictEqual(withSamples.disabledSlots, 11, '予約済みのコマは押せない');
    assert.strictEqual(JSON.parse(withSamples.storage).length, 4);
    assert.strictEqual(withSamples.storageStatus, 'このブラウザの予約データ：4件（うちサンプル 4件）');

    assert.deepStrictEqual(ready.blockers, []);
    assert.strictEqual(ready.buttonDisabled, false);
    assert.strictEqual(ready.total, '87,250', '宿泊 3,300円×20人泊＋大体育館 8,050円＋朝食 660円×20食');

    assert.strictEqual(overCapacity.buttonDisabled, true, '定員超過では確定できない');
    assert.strictEqual(overCapacity.warnings.length, 1);
    assert.match(overCapacity.warnings[0], /宿泊定員を超えます（ご希望 20人 ／ 残り 15人）/);

    assert.strictEqual(completed.formHidden, true);
    assert.strictEqual(completed.completeHidden, false);
    const stored = JSON.parse(completed.storage);
    assert.strictEqual(stored.length, 5);
    assert.strictEqual(completed.storageStatus, 'このブラウザの予約データ：5件（うちサンプル 4件）');
    const parsed = parseReservationCode(completed.code);
    assert.strictEqual(parsed.ok, true);
    assert.deepStrictEqual(parsed.reservation, stored[4], '1行コードは保存した予約と同じ内容');
    assert.match(parsed.reservation.id, /^R\d{8}-001$/);
    assert.strictEqual(parsed.reservation.estimatedTotal, 87250);
    assert.deepStrictEqual(parsed.reservation.slots, [{ date: addDaysToDateString(today, 3), facilityKey: 'gym', periodKey: 'am' }]);
    assert.ok(completed.mailHref.startsWith('mailto:reservation@example.com?subject='));
    assert.ok(decodeURIComponent(completed.mailHref).endsWith(completed.code), 'メール本文の最後に1行コード');
    assert.ok(completed.receiptText.includes('予約申込控え') && completed.receiptText.includes('テスト団体'));
    assert.ok(completed.receiptText.includes('合計（税込） 87,250円'));
    assert.ok(completed.receiptText.includes(`${CATALOG.facilities[0].name} AM`));
});

test('画面：予約済みのコマを選んでいると赤くなって確定できず、リセットで予約データが消える', { skip: !BROWSER }, () => {
    const states = renderStates(`
        fillApplicant();
        setValue('in_people', '10');
        document.querySelectorAll('input.slot-check[data-facility="gym"]')[3].checked = true;
        refreshAll();
        states.push(capture());
        insertSampleReservations();
        states.push(Object.assign(capture(), { conflictSlots: document.querySelectorAll('.slot-conflict input:checked').length }));
        resetReservations();
        states.push(capture());
    `);
    const [beforeSamples, afterSamples, afterReset] = states;
    assert.strictEqual(beforeSamples.buttonDisabled, false);
    assert.strictEqual(afterSamples.conflictSlots, 1, '選んでいたコマが予約済みになると赤くなる');
    assert.strictEqual(afterSamples.buttonDisabled, true);
    assert.ok(afterSamples.warnings.some((warning) => warning.includes('「大体育館 AM」はすでに予約が入っています')));
    assert.strictEqual(afterReset.storage, null);
    assert.strictEqual(afterReset.storageStatus, 'このブラウザの予約データ：0件（うちサンプル 0件）');
    assert.strictEqual(afterReset.buttonDisabled, false, 'リセットすると空くので確定できる');
});

test('画面：facility-config.js で施設名と宿泊定員を上書きできる', { skip: !BROWSER }, () => {
    const configSource = 'window.CUSTOM_FACILITY_INFO = { facilityName: "みどり研修センター" };\n'
        + 'window.CUSTOM_RESERVATION_CONFIG = { stayCapacity: 50 };';
    const [state] = renderStates('insertSampleReservations(); states.push(capture());', configSource);
    assert.strictEqual(state.title, 'みどり研修センター Web予約システム');
    assert.deepStrictEqual(state.staySymbols, ['×', '△'], '定員50人なら85人の夜は×、40人の夜は△');
});
