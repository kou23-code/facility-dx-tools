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

const extractBlock = (html, name) => new RegExp(`// ${name}:start([\\s\\S]*?)// ${name}:end`).exec(html)[1];

const loadInputCheckBlock = (html) => vm.runInNewContext(
    `${extractBlock(html, 'DAY_RANGE')}\n${extractBlock(html, 'STAY_LOCK')}\n${extractBlock(html, 'INPUT_CHECK')}
    ({ JOIN_WITHOUT_STAY_MESSAGE, sumQuantities, findInputConflicts, findPrintBlockers })`
);

const { JOIN_WITHOUT_STAY_MESSAGE, sumQuantities, findInputConflicts, findPrintBlockers } = loadInputCheckBlock(readHtml());

const toPlain = (obj) => JSON.parse(JSON.stringify(obj));

test('sumQuantities は指定した項目の数量を日をまたいで合計する', () => {
    const quantities = { es_0: 3, ad_0: 10, ad_1: 8, bf_0: 20, jg_es_hs_0: 4 };
    assert.strictEqual(sumQuantities(quantities, STAY_KEYS), 21);
    assert.strictEqual(sumQuantities(quantities, JOIN_KEYS), 4);
    assert.strictEqual(sumQuantities(quantities, []), 0);
    assert.strictEqual(sumQuantities({}, STAY_KEYS), 0);
});

test('findInputConflicts は宿泊0人で日帰り参加料に人数があると矛盾を返す', () => {
    assert.deepStrictEqual(toPlain(findInputConflicts({ jg_ad_0: 5 }, STAY_KEYS, JOIN_KEYS)), [JOIN_WITHOUT_STAY_MESSAGE]);
    assert.deepStrictEqual(toPlain(findInputConflicts({ gym_0: 2, jf_es_hs_1: 1 }, STAY_KEYS, JOIN_KEYS)), [JOIN_WITHOUT_STAY_MESSAGE]);
});

test('findInputConflicts は宿泊者がいれば、日帰り参加料があっても矛盾にしない', () => {
    assert.deepStrictEqual(toPlain(findInputConflicts({ ad_0: 1, jg_ad_0: 5 }, STAY_KEYS, JOIN_KEYS)), []);
});

test('findInputConflicts は宿泊0人でも、日帰り参加料がなければ矛盾にしない（施設だけの日帰り利用）', () => {
    assert.deepStrictEqual(toPlain(findInputConflicts({ gym_0: 2, lu_0: 30 }, STAY_KEYS, JOIN_KEYS)), []);
    assert.deepStrictEqual(toPlain(findInputConflicts({}, STAY_KEYS, JOIN_KEYS)), []);
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

// 起動後に宛名と数量を入れて、印刷ボタンの状態をページに書き出すスクリプト
const buildScript = (customerName, quantities) => `<script>
window.addEventListener('load', () => {
    document.getElementById('in_customer').value = ${JSON.stringify(customerName)};
    inputData = ${JSON.stringify(quantities)};
    onGridChange();
    const dump = document.createElement('div');
    dump.id = 'test_dump';
    dump.textContent = encodeURIComponent(JSON.stringify({
        disabled: document.getElementById('printButton').disabled,
        printBlocked: document.body.classList.contains('print-blocked'),
        blockers: document.getElementById('printBlockers').textContent,
        warnings: document.getElementById('warningBox').textContent
    }));
    document.body.appendChild(dump);
});
</script>`;

const renderPrintState = (customerName, quantities) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'print-guard-test-'));
    const htmlPath = path.join(dir, path.basename(HTML_PATH));
    fs.writeFileSync(htmlPath, readHtml().replace('</body>', `${buildScript(customerName, quantities)}\n</body>`), 'utf8');
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
    assert.ok(state.warnings.includes('入力が矛盾しています（印刷できません）'), '矛盾エラーが表示されていません');
    assert.match(state.blockers, /入力内容に矛盾があります/);
});
