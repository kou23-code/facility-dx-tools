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
    code: decodeURIComponent((/[?&]body=([^&]*)/.exec(document.getElementById('mailButton').getAttribute('href')) || ['', ''])[1]).split('\\n').pop(),
    codeUiCount: document.querySelectorAll('#out_code, #copyButton').length,
    completeText: document.querySelector('#completeView > div').textContent.replace(/\\s+/g, ' '),
    mailOpenedHidden: document.getElementById('mailOpenedNote').classList.contains('hidden'),
    mailHref: document.getElementById('mailButton').getAttribute('href'),
    receiptText: document.getElementById('receipt').textContent.replace(/\\s+/g, ' '),
    dailyHead: Array.from(document.querySelectorAll('#dailyTable thead th'), (cell) => cell.textContent),
    stayInputs: document.querySelectorAll('#dailyTable input[data-row^="stay_"]').length,
    stayNightTotals: Array.from(document.querySelectorAll('#dailyTable td[id^="total_stay_night_"]'), (cell) => cell.textContent),
    stayPlanNote: document.getElementById('stayPlanNote').textContent,
    stayGroupRow: document.querySelector('#dailyTable .group-row td').textContent,
    feeType: document.getElementById('fee_type').textContent,
    stayLimitTexts: Array.from(document.querySelectorAll('.stay-limit-text'), (element) => element.textContent),
    stayRemainings: Array.from(document.querySelectorAll('#availabilityTable .stay-remaining'), (element) => element.textContent),
    dailyRows: Array.from(document.querySelectorAll('#dailyTable tbody th'), (cell) => cell.firstChild.textContent),
    lunchValues: Array.from(document.querySelectorAll('#dailyTable input[data-row="meal_lu"]'), (input) => input.value),
    feeTax: document.getElementById('fee_tax').textContent,
    hourHeaders: Array.from(document.querySelectorAll('#slotGrid table:last-of-type thead th'), (cell) => cell.textContent).slice(2),
    feeQuantities: Array.from(document.querySelectorAll('#feeTable tbody tr'), (row) => row.cells[2].textContent),
    extraFeeNotes: Array.from(document.querySelectorAll('.extra-fee-note'), (element) => element.textContent),
    removedInputCount: document.querySelectorAll('#in_price_type, #in_people').length
});
const setValue = (id, value) => { document.getElementById(id).value = value; };
// 宿泊は2泊とも10人（大学生・一般。利用人数10人）、朝食は2日目・3日目に10食ずつ、幕の内弁当は1日目に10食
const fillApplicant = () => {
    [['in_group', 'テスト団体'], ['in_representative', '山田 太郎'], ['in_phone', '000-0000-0000'],
     ['in_email', 'test@example.com'], ['in_purpose', 'スポーツ合宿'],
     ['in_stay_ad_m_0', '6'], ['in_stay_ad_f_0', '4'], ['in_stay_ad_m_1', '6'], ['in_stay_ad_f_1', '4'], ['in_meal_bf_1', '10'], ['in_meal_bf_2', '10'], ['in_meal_be_maku_0', '10']]
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
        document.querySelector('input.slot-check[data-facility="gym"]:not(:disabled)').checked = true;
        ['h09', 'h10'].forEach((hourKey) => { document.querySelector('input.slot-check[data-facility="kL"][data-time="' + hourKey + '"]').checked = true; });
        refreshSlots();
        states.push(capture());
        setValue('in_stay_ad_m_0', '96');
        refreshSummary();
        states.push(capture());
        setValue('in_stay_ad_m_0', '6');
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
    assert.strictEqual(initial.removedInputCount, 0, '料金区分・利用人数の入力欄はない（宿泊人数の内訳から自動で計算する）');
    assert.deepStrictEqual(initial.hourHeaders, ['9-10時', '10-11時', '11-12時', '12-13時', '13-14時', '14-15時', '15-16時', '16-17時',
        '17-18時', '18-19時', '19-20時', '20-21時'], '研修室・ミーティングルームの見出しは1時間の枠がわかる表記');
    assert.deepStrictEqual(initial.dailyHead.slice(1, 4).map((text) => text.slice(0, 3)), ['1日目', '2日目', '3日目']);
    assert.strictEqual(initial.stayInputs, 12, '宿泊人数は区分×男女の6行で、泊まる夜（2泊）だけ入力できる');
    assert.strictEqual(initial.stayPlanNote, '※現時点での予定人数で構いません（後日変更可能です）');
    assert.ok(initial.stayGroupRow.includes('※現時点での予定人数で構いません（後日変更可能です）'), '表の宿泊の見出しにも注記');
    assert.deepStrictEqual(initial.dailyRows, ['小学生・中学生 男性', '小学生・中学生 女性', '高校生 男性', '高校生 女性',
        '大学生・一般 男性', '大学生・一般 女性', '宿泊人数 合計', '朝食', '昼食', '夕食', '竜田揚げ弁当', '幕の内弁当', 'からマヨ丼', 'おにぎり弁当', 'お茶', '塩おにぎり(2個)']);

    assert.deepStrictEqual(withSamples.staySymbols, ['△', '◎'], '1泊目は85人で残りわずか');
    assert.deepStrictEqual(withSamples.gymSymbols, ['◎', '×', '◎'], '2日目の大体育館はすべて予約済み');
    assert.strictEqual(withSamples.disabledSlots, 17, '予約済みのコマは押せない（区分9コマ＋1時間8コマ）');
    assert.strictEqual(JSON.parse(withSamples.storage).length, 11);
    assert.strictEqual(withSamples.storageStatus, 'このブラウザの予約データ：11件（うちサンプル 11件）');

    assert.deepStrictEqual(ready.blockers, []);
    assert.deepStrictEqual(ready.stayNightTotals, ['10人', '10人'], '夜ごとに区分・男女の合計を出す');
    assert.strictEqual(ready.feeType, '施設は「宿泊利用料金（大学生・一般 基準）」で計算しています');
    assert.strictEqual(ready.buttonDisabled, false);
    assert.strictEqual(ready.total, '96,150', '宿泊 3,300円×(10＋10)人＋大体育館 8,050円＋大研修室 950円×2時間＋朝食 660円×20食＋幕の内弁当 700円×10食');
    assert.strictEqual(ready.feeTax, '（うち消費税 10%：8,104円 ／ 8%：518円）', '弁当は軽減税率');
    assert.deepStrictEqual(ready.feeQuantities, ['10（人／泊）', '10（人／泊）', '20（食）', '10（食）', '1（区分）', '2（時間）']);
    assert.deepStrictEqual(ready.extraFeeNotes, Array(2).fill('※体育館の照明代金、研修室の冷暖房代などは別途料金がかかります'),
        '施設コマの下と概算料金の下に、別途料金の案内を出す');

    assert.strictEqual(overCapacity.buttonDisabled, true, '定員超過では確定できない');
    assert.strictEqual(overCapacity.warnings.length, 1);
    assert.match(overCapacity.warnings[0], /1日あたりの宿泊人数の上限（全団体で300人）を超えます（ご希望 100人 ／ 残り 75人）/);

    assert.strictEqual(completed.formHidden, true);
    assert.strictEqual(completed.completeHidden, false);
    const stored = JSON.parse(completed.storage);
    assert.strictEqual(stored.length, 12);
    assert.strictEqual(completed.storageStatus, 'このブラウザの予約データ：12件（うちサンプル 11件）');
    const parsed = parseReservationCode(completed.code);
    assert.strictEqual(parsed.ok, true);
    assert.deepStrictEqual(parsed.reservation, stored[11], '1行コードは保存した予約と同じ内容');
    assert.match(parsed.reservation.id, /^R\d{8}-001$/);
    assert.strictEqual(parsed.reservation.estimatedTotal, 96150);
    assert.deepStrictEqual([parsed.reservation.people, parsed.reservation.priceType], [10, 'ad'], '利用人数と料金区分は宿泊人数から決める');
    assert.deepStrictEqual(parsed.reservation.stays, { es_m: [0, 0], es_f: [0, 0], hs_m: [0, 0], hs_f: [0, 0], ad_m: [6, 6], ad_f: [4, 4] });
    assert.deepStrictEqual([parsed.reservation.meals.bf, parsed.reservation.meals.be_maku], [[0, 10, 10], [10, 0, 0]]);
    const firstDay = addDaysToDateString(today, 3);
    assert.deepStrictEqual(parsed.reservation.slots, [{ date: firstDay, facilityKey: 'gym', timeKey: 'am' },
        { date: firstDay, facilityKey: 'kL', timeKey: 'h09' }, { date: firstDay, facilityKey: 'kL', timeKey: 'h10' }]);
    assert.ok(completed.mailHref.startsWith('mailto:reservation@example.com?subject='));
    assert.ok(decodeURIComponent(completed.mailHref).endsWith(completed.code), 'メール本文の最後に1行コード');
    assert.ok(completed.receiptText.includes('予約申込控え') && completed.receiptText.includes('テスト団体'));
    assert.ok(completed.receiptText.includes('合計（税込） 96,150円'));
    assert.ok(completed.receiptText.includes('朝食 20食（'));
    assert.ok(completed.receiptText.includes('※体育館の照明代金、研修室の冷暖房代などは別途料金がかかります'), '控えにも別途料金の案内');
    assert.ok(completed.receiptText.includes('10（人／泊）'));
    assert.ok(completed.receiptText.includes(`${CATALOG.facilities[0].name} AM、大研修室(1･3研) 9:00~11:00`));
});

test('画面：完了画面は送信がまだであることを強調し、1行コードは画面に出さずメールの本文にだけ入れる', { skip: !BROWSER }, () => {
    const [completed, afterMailClick] = renderStates(`
        insertSampleReservations();
        fillApplicant();
        refreshSummary();
        confirmReservation();
        states.push(capture());
        onMailButtonClick();
        states.push(capture());
    `);
    assert.strictEqual(completed.completeHidden, false);
    assert.ok(completed.completeText.includes('※まだ予約は完了していません！'), '送信がまだであることを強調する');
    assert.ok(completed.completeText.includes('以下のボタンから、施設へ予約データを送信してください。'));
    assert.ok(completed.completeText.includes('施設へ予約データを送信する'), 'メール送信のボタン');
    assert.ok(completed.completeText.includes('あおぞらセミナーハウス（TEL 03-0000-0000）'), 'メールが開かないときの連絡先');
    assert.strictEqual(completed.codeUiCount, 0, '1行コードの欄・コピーボタンは画面にない');
    ['職員取込用', '1行コード', 'コピー', completed.code].forEach((text) => {
        assert.ok(!completed.completeText.includes(text), `完了画面に「${text.slice(0, 20)}」が出ている`);
    });
    assert.strictEqual(parseReservationCode(completed.code).ok, true, 'メールの本文の最後の行が1行コード');
    assert.ok(decodeURIComponent(completed.mailHref).includes('▼施設の予約管理用データ（この行と次の行は消したり書き換えたりせず、そのまま送信してください）'));
    assert.ok(completed.receiptText.includes('※内容に確認が必要な場合のみ、施設よりご連絡させていただきます'), '控えの注意事項');
    assert.ok(!completed.receiptText.includes('施設の職員から確認の連絡をいたします'), '前の文言は残さない');
    assert.strictEqual(completed.mailOpenedHidden, true);
    assert.strictEqual(afterMailClick.mailOpenedHidden, false, '送信ボタンを押すと、メールソフトで送信するよう案内する');
});

test('予約画面に1行コードの欄・コピーの処理が残っていない', () => {
    const html = readPage();
    ['out_code', 'copyButton', 'copyReservationCode', '職員取込用'].forEach((text) => {
        assert.ok(!html.includes(text), `予約画面に「${text}」が残っている`);
    });
});

test('画面：予約済みのコマを選んでいると赤くなって確定できず、リセットで予約データが消える', { skip: !BROWSER }, () => {
    const states = renderStates(`
        fillApplicant();
        document.querySelectorAll('input.slot-check[data-facility="gym"]')[3].checked = true;
        refreshSlots();
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

test('画面：「全日」で1日目の数をコピーでき、利用日数を変えると入力中の値を残して日ごとの表を作り直す', { skip: !BROWSER }, () => {
    const states = renderStates(`
        setValue('in_meal_lu_0', '7');
        copyFirstDayToAll('meal_lu');
        setValue('in_stay_hs_f_0', '5');
        states.push(capture());
        setValue('in_nights', '1');
        refreshAll();
        states.push(Object.assign(capture(), { stayValue: document.getElementById('in_stay_hs_f_0').value }));
        setValue('in_nights', '0');
        refreshAll();
        states.push(capture());
    `);
    const [copied, twoDays, dayTrip] = states;
    assert.deepStrictEqual(copied.lunchValues, ['7', '7', '7']);
    assert.deepStrictEqual([twoDays.lunchValues, twoDays.stayInputs, twoDays.stayValue], [['7', '7'], 6, '5']);
    assert.deepStrictEqual([dayTrip.lunchValues, dayTrip.stayInputs], [['7'], 0], '日帰りは宿泊人数を入力できない');
    assert.deepStrictEqual(dayTrip.staySymbols, [], '日帰りは宿泊の空きを出さない');
});

test('画面：facility-config.js で施設名と宿泊の上限（人数・団体数）を上書きできる', { skip: !BROWSER }, () => {
    const configSource = 'window.CUSTOM_FACILITY_INFO = { facilityName: "みどり研修センター" };\n'
        + 'window.CUSTOM_RESERVATION_CONFIG = { stayCapacity: 250, maxStayGroups: 4 };';
    const [state] = renderStates('insertSampleReservations(); states.push(capture());', configSource);
    assert.strictEqual(state.title, 'みどり研修センター Web予約システム');
    assert.deepStrictEqual(state.staySymbols, ['×', '◎'], '上限4団体なら4団体泊まる1泊目は×、2団体の2泊目は◎');
    assert.deepStrictEqual(state.stayLimitTexts, ['250人・4団体', '250人・4団体']);
});

test('画面：宿泊の受け入れ団体数が上限（6団体）の夜は、人数に余裕があっても警告を出して確定できない', { skip: !BROWSER }, () => {
    const today = toLocalDateString(new Date());
    const [initial, fullNight] = renderStates(`
        states.push(capture());
        insertSampleReservations();
        setValue('in_start', '${addDaysToDateString(today, 10)}');
        setValue('in_nights', '2');
        refreshAll();
        fillApplicant();
        refreshSummary();
        states.push(capture());
    `);
    assert.deepStrictEqual(initial.stayLimitTexts, ['300人・6団体', '300人・6団体'], '既定の上限を画面に出す');
    assert.deepStrictEqual(initial.stayRemainings, ['残り300人・6団体', '残り300人・6団体']);
    assert.deepStrictEqual(fullNight.staySymbols, ['×', '◎'], '10日後の夜は6団体（150人）、11日後の夜は1団体（100人）');
    assert.deepStrictEqual(fullNight.stayRemainings, ['残り150人・0団体', '残り200人・5団体']);
    assert.strictEqual(fullNight.buttonDisabled, true);
    assert.strictEqual(fullNight.warnings.length, 1, '人数の上限ではなく、団体数の上限の警告だけが出る');
    assert.ok(fullNight.warnings[0].includes('1日あたりの宿泊受け入れ団体数の上限（6団体）に達しています（予約済み 6団体）'));
});
