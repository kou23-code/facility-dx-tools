// 入力の矛盾チェックと、印刷ボタンのガードの動作確認テスト
// 実行方法：node --test tests/print-guard.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { HTML_PATH, BROWSER_CANDIDATES, readHtml, findBrowser, renderDom, findById } = require('./helpers');

const BROWSER = findBrowser(BROWSER_CANDIDATES);
const STAY_KEYS = ['es', 'hs', 'ad'];
const JOIN_KEYS = ['jg_es_hs', 'jg_ad', 'js_es_hs', 'js_ad', 'jf_es_hs', 'jf_ad'];
const LIMIT_BY_ITEM = {
    gym: { name: '大体育館', unit: '区分', max: 3 },
    gym_s: { name: '小体育館', unit: '区分', max: 3 },
    field: { name: '陸上/球技場', unit: '区分', max: 3 }
};
const CHECK_RULES = { stayKeys: STAY_KEYS, joinKeys: JOIN_KEYS, limitByItem: LIMIT_BY_ITEM };
const TIME_SLOT_NOTE = '（AM 8:30~12:30 ／ PM 12:30~17:00 ／ 夜 17:00~21:00）';

const extractBlock = (html, name) => new RegExp(`// ${name}:start([\\s\\S]*?)// ${name}:end`).exec(html)[1];

const loadInputCheckBlock = (html) => vm.runInNewContext(
    `${extractBlock(html, 'DAY_RANGE')}\n${extractBlock(html, 'STAY_LOCK')}\n${extractBlock(html, 'INPUT_CHECK')}
    ({ JOIN_WITHOUT_STAY_MESSAGE, sumQuantities, isOverLimitCell, buildOverLimitMessage, findOverLimitMessages, findInputConflicts, findPrintBlockers })`
);

const {
    JOIN_WITHOUT_STAY_MESSAGE, sumQuantities, isOverLimitCell, buildOverLimitMessage,
    findOverLimitMessages, findInputConflicts, findPrintBlockers
} = loadInputCheckBlock(readHtml());

const toPlain = (obj) => JSON.parse(JSON.stringify(obj));

test('sumQuantities は指定した項目の数量を日をまたいで合計する', () => {
    const quantities = { es_0: 3, ad_0: 10, ad_1: 8, bf_0: 20, jg_es_hs_0: 4 };
    assert.strictEqual(sumQuantities(quantities, STAY_KEYS), 21);
    assert.strictEqual(sumQuantities(quantities, JOIN_KEYS), 4);
    assert.strictEqual(sumQuantities(quantities, []), 0);
    assert.strictEqual(sumQuantities({}, STAY_KEYS), 0);
});

test('findInputConflicts は宿泊0人で日帰り参加料に人数があるとエラーを返す', () => {
    assert.deepStrictEqual(toPlain(findInputConflicts({ jg_ad_0: 5 }, CHECK_RULES)), [JOIN_WITHOUT_STAY_MESSAGE]);
    assert.deepStrictEqual(toPlain(findInputConflicts({ gym_0: 2, jf_es_hs_1: 1 }, CHECK_RULES)), [JOIN_WITHOUT_STAY_MESSAGE]);
});

test('findInputConflicts は宿泊者がいれば、日帰り参加料があっても矛盾にしない', () => {
    assert.deepStrictEqual(toPlain(findInputConflicts({ ad_0: 1, jg_ad_0: 5 }, CHECK_RULES)), []);
});

test('findInputConflicts は宿泊0人でも、日帰り参加料がなければ矛盾にしない（施設だけの日帰り利用）', () => {
    assert.deepStrictEqual(toPlain(findInputConflicts({ gym_0: 2, lu_0: 30 }, CHECK_RULES)), []);
    assert.deepStrictEqual(toPlain(findInputConflicts({}, CHECK_RULES)), []);
});

test('isOverLimitCell は上限ちょうどまでは許し、上限を超えたマスだけを検出する', () => {
    assert.strictEqual(isOverLimitCell('gym_0', 3, LIMIT_BY_ITEM), false, '上限ちょうど');
    assert.strictEqual(isOverLimitCell('gym_0', 4, LIMIT_BY_ITEM), true);
    assert.strictEqual(isOverLimitCell('gym_s_2', 10, LIMIT_BY_ITEM), true, '名前が似た別の項目（gym_s）も判定する');
    assert.strictEqual(isOverLimitCell('field_6', 0, LIMIT_BY_ITEM), false);
    assert.strictEqual(isOverLimitCell('gl_f_0', 99, LIMIT_BY_ITEM), false, '上限のない項目は対象外');
    assert.strictEqual(isOverLimitCell('gym_0', NaN, LIMIT_BY_ITEM), false, '空欄は対象外');
});

test('buildOverLimitMessage は項目名・日・入力数・上限をエラーの文言にする', () => {
    assert.strictEqual(buildOverLimitMessage('gym_s_1', 4, LIMIT_BY_ITEM.gym_s),
        `「小体育館」の2日目が4区分になっています。1日最大3区分${TIME_SLOT_NOTE}までにしてください。`);
});

test('findOverLimitMessages は上限を超えたマスごとにエラーを返し、なければ空の一覧を返す', () => {
    const messages = findOverLimitMessages({ gym_0: 4, gym_1: 3, field_2: 5, gl_f_0: 10 }, LIMIT_BY_ITEM);
    assert.strictEqual(messages.length, 2);
    assert.match(messages[0], /^「大体育館」の1日目が4区分/);
    assert.match(messages[1], /^「陸上\/球技場」の3日目が5区分/);
    assert.deepStrictEqual(toPlain(findOverLimitMessages({}, LIMIT_BY_ITEM)), []);
});

test('findInputConflicts は日帰り参加料の矛盾と上限オーバーをまとめて返す', () => {
    const conflicts = findInputConflicts({ jg_ad_0: 5, gym_0: 4 }, CHECK_RULES);
    assert.strictEqual(conflicts.length, 2);
    assert.strictEqual(conflicts[0], JOIN_WITHOUT_STAY_MESSAGE);
    assert.match(conflicts[1], /「大体育館」の1日目が4区分/);
    assert.strictEqual(findInputConflicts({ ad_0: 10, gym_0: 4 }, CHECK_RULES).length, 1, '宿泊があっても上限オーバーはエラー');
});

test('findPrintBlockers はすべて問題がなければ空の一覧を返す', () => {
    assert.deepStrictEqual(toPlain(findPrintBlockers('あおぞら少年団', 1, 0)), []);
});

test('findPrintBlockers は宛名が空か空白だけなら印刷を止める', () => {
    ['', '   ', '　', ' \t '].forEach((customerName) => {
        assert.deepStrictEqual(toPlain(findPrintBlockers(customerName, 1000, 0)), ['宛名が未入力です'], `宛名「${customerName}」`);
    });
});

test('findPrintBlockers は見積合計が0円なら印刷を止める', () => {
    assert.deepStrictEqual(toPlain(findPrintBlockers('あおぞら少年団', 0, 0)), ['見積合計が0円です']);
});

test('findPrintBlockers は矛盾が1つでもあれば印刷を止める', () => {
    assert.strictEqual(findPrintBlockers('あおぞら少年団', 1000, 1).length, 1);
    assert.strictEqual(findPrintBlockers('あおぞら少年団', 1000, 3).length, 1);
});

test('findPrintBlockers は当てはまる理由をすべて返す', () => {
    assert.strictEqual(findPrintBlockers('', 0, 1).length, 3);
});

// 起動後に宛名と数量を入れ（typedCells はマスに手で入力したように入れる）、印刷ボタンの状態をページに書き出すスクリプト
const buildScript = (customerName, quantities, typedCells) => `<script>
window.addEventListener('load', () => {
    document.getElementById('in_customer').value = ${JSON.stringify(customerName)};
    inputData = ${JSON.stringify(quantities)};
    onGridChange();
    Object.entries(${JSON.stringify(typedCells)}).forEach(([cellId, text]) => {
        const cell = document.getElementById('in_' + cellId);
        cell.value = text;
        cell.dispatchEvent(new Event('input'));
    });
    const dump = document.createElement('div');
    dump.id = 'test_dump';
    dump.textContent = encodeURIComponent(JSON.stringify({
        disabled: document.getElementById('printButton').disabled,
        printBlocked: document.body.classList.contains('print-blocked'),
        blockers: document.getElementById('printBlockers').textContent,
        warnings: document.getElementById('warningBox').textContent,
        overLimitCells: Array.from(document.querySelectorAll('.over-limit')).map(cell => cell.id),
        saved: JSON.parse(localStorage.getItem(STORAGE_KEY)).inputData
    }));
    document.body.appendChild(dump);
});
</script>`;

const renderPrintState = (customerName, quantities, typedCells = {}) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'print-guard-test-'));
    const htmlPath = path.join(dir, path.basename(HTML_PATH));
    const script = buildScript(customerName, quantities, typedCells);
    fs.writeFileSync(htmlPath, readHtml().replace('</body>', `${script}\n</body>`), 'utf8');
    return JSON.parse(decodeURIComponent(findById(renderDom(BROWSER, htmlPath), 'test_dump')));
};

test('画面：宛名と金額があり矛盾がなければ、印刷ボタンを押せる', { skip: !BROWSER }, () => {
    const state = renderPrintState('あおぞら少年団', { ad_0: 10, jg_ad_0: 3 });
    assert.deepStrictEqual([state.disabled, state.printBlocked, state.blockers], [false, false, '']);
});

test('画面：宛名が空白だけ・合計0円のときは、印刷ボタンを押せない', { skip: !BROWSER }, () => {
    const state = renderPrintState('  ', {});
    assert.deepStrictEqual([state.disabled, state.printBlocked], [true, true]);
    assert.match(state.blockers, /宛名が未入力です/);
    assert.match(state.blockers, /見積合計が0円です/);
});

test('画面：宿泊0人で日帰り参加料に人数があると、矛盾エラーを表示して印刷ボタンを押せない', { skip: !BROWSER }, () => {
    const state = renderPrintState('あおぞら少年団', { gym_0: 2, jg_ad_0: 5 });
    assert.strictEqual(state.disabled, true);
    assert.ok(state.warnings.includes('入力エラー（直すまで印刷できません）'), '矛盾エラーが表示されていません');
    assert.match(state.blockers, /入力エラーがあります/);
});

test('画面：区分数の上限を超えて入力すると、値は直さずに警告ボックスへエラーを出し、印刷ボタンを押せない', { skip: !BROWSER }, () => {
    const state = renderPrintState('あおぞら少年団', { ad_0: 10 }, { gym_0: '4' });
    assert.strictEqual(state.saved.gym_0, 4, '入力した数が上限の値に直されています');
    assert.deepStrictEqual(state.overLimitCells, ['in_gym_0'], '上限を超えたマスが赤く表示されていません');
    assert.ok(state.warnings.includes('入力エラー（直すまで印刷できません）'), '警告ボックスにエラーが出ていません');
    assert.ok(state.warnings.includes('「大体育館」の1日目が4区分になっています。'), '上限オーバーの内容が表示されていません');
    assert.strictEqual(state.disabled, true);
    assert.match(state.blockers, /入力エラーがあります/);
});

test('画面：上限を超えた数を上限以内に直すと、エラーが消えて印刷ボタンを押せる', { skip: !BROWSER }, () => {
    const state = renderPrintState('あおぞら少年団', { ad_0: 10, gym_0: 4 }, { gym_0: '3' });
    assert.deepStrictEqual([state.disabled, state.overLimitCells, state.blockers], [false, [], '']);
    assert.ok(!state.warnings.includes('入力エラー'), 'エラーが残っています');
});
