// 日帰りの宿泊人数・最終日の宿泊人数を入力できなくする動作確認テスト
// 実行方法：node --test tests/stay-lock.test.js
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

const loadStayLockBlock = (html) => vm.runInNewContext(
    `${extractBlock(html, 'DAY_RANGE')}\n${extractBlock(html, 'STAY_LOCK')}
    ({ extractItemKey, isStayLockedDay, isLockedStayCell, removeLockedStayData, isLockedJoinCell, removeLockedJoinData, findLockReason })`
);

const {
    extractItemKey, isStayLockedDay, isLockedStayCell, removeLockedStayData,
    isLockedJoinCell, removeLockedJoinData, findLockReason
} = loadStayLockBlock(readHtml());

const toPlain = (obj) => JSON.parse(JSON.stringify(obj));

test('extractItemKey はマスのIDから日のインデックスを除く', () => {
    assert.strictEqual(extractItemKey('ad_0'), 'ad');
    assert.strictEqual(extractItemKey('gym_s_2'), 'gym_s');
    assert.strictEqual(extractItemKey('jg_es_hs_12'), 'jg_es_hs');
    assert.strictEqual(extractItemKey('memo'), 'memo');
});

test('isStayLockedDay は日帰りなら1日目、2日以上なら最終日だけを入力不可にする', () => {
    assert.strictEqual(isStayLockedDay(0, 1), true);
    assert.strictEqual(isStayLockedDay(0, 2), false);
    assert.strictEqual(isStayLockedDay(1, 2), true);
    assert.deepStrictEqual([0, 1, 2, 3, 4, 5, 6].map((dayIndex) => isStayLockedDay(dayIndex, 7)),
        [false, false, false, false, false, false, true]);
});

test('isLockedStayCell は宿泊の項目だけを対象にする', () => {
    assert.strictEqual(isLockedStayCell('es_2', 3, STAY_KEYS), true);
    assert.strictEqual(isLockedStayCell('hs_2', 3, STAY_KEYS), true);
    assert.strictEqual(isLockedStayCell('ad_1', 3, STAY_KEYS), false);
    assert.strictEqual(isLockedStayCell('bf_2', 3, STAY_KEYS), false, '食事は最終日も入力できる');
    assert.strictEqual(isLockedStayCell('jg_es_hs_2', 3, STAY_KEYS), false, '名前に es を含む別の項目は対象外');
    assert.strictEqual(isLockedStayCell('ad', 1, STAY_KEYS), false, '日のインデックスがないIDは対象外');
});

test('removeLockedStayData は日帰りなら宿泊人数をすべて消し、他の項目は残す', () => {
    const quantities = { es_0: 5, hs_0: 3, ad_0: 2, bf_0: 10, gym_0: 2, jg_ad_0: 4 };
    assert.deepStrictEqual(toPlain(removeLockedStayData(quantities, 1, STAY_KEYS)), { bf_0: 10, gym_0: 2, jg_ad_0: 4 });
});

test('removeLockedStayData は2日以上なら最終日の宿泊人数だけを消す', () => {
    const quantities = { ad_0: 10, ad_1: 10, ad_2: 10, es_2: 1, bf_2: 10 };
    assert.deepStrictEqual(toPlain(removeLockedStayData(quantities, 3, STAY_KEYS)), { ad_0: 10, ad_1: 10, bf_2: 10 });
});

test('removeLockedStayData は空のデータに空のデータを返し、元のデータを書き換えない', () => {
    assert.deepStrictEqual(toPlain(removeLockedStayData({}, 3, STAY_KEYS)), {});
    const quantities = { ad_0: 1 };
    removeLockedStayData(quantities, 1, STAY_KEYS);
    assert.deepStrictEqual(quantities, { ad_0: 1 });
});

test('isLockedJoinCell は日帰りのときだけ、日帰り参加料のマスを入力不可にする', () => {
    assert.deepStrictEqual(JOIN_KEYS.map((itemKey) => isLockedJoinCell(`${itemKey}_0`, 1, JOIN_KEYS)), JOIN_KEYS.map(() => true));
    assert.strictEqual(isLockedJoinCell('jg_ad_0', 2, JOIN_KEYS), false, '2日以上なら入力できる');
    assert.strictEqual(isLockedJoinCell('jg_ad_1', 2, JOIN_KEYS), false, '2日以上なら最終日も入力できる');
    assert.strictEqual(isLockedJoinCell('gym_0', 1, JOIN_KEYS), false, '施設は日帰りでも入力できる');
    assert.strictEqual(isLockedJoinCell('jg_ad', 1, JOIN_KEYS), false, '日のインデックスがないIDは対象外');
});

test('removeLockedJoinData は日帰りなら日帰り参加料をすべて消し、2日以上なら何も消さない', () => {
    const quantities = { jg_ad_0: 5, jf_es_hs_0: 3, gym_0: 2, lu_0: 30 };
    assert.deepStrictEqual(toPlain(removeLockedJoinData(quantities, 1, JOIN_KEYS)), { gym_0: 2, lu_0: 30 });
    assert.deepStrictEqual(toPlain(removeLockedJoinData(quantities, 2, JOIN_KEYS)), quantities);
    assert.deepStrictEqual(toPlain(removeLockedJoinData({}, 1, JOIN_KEYS)), {});
    assert.deepStrictEqual(quantities, { jg_ad_0: 5, jf_es_hs_0: 3, gym_0: 2, lu_0: 30 }, '元のデータを書き換えない');
});

test('findLockReason は入力できない理由を返し、入力できるマスには空文字を返す', () => {
    assert.strictEqual(findLockReason('jg_ad_0', 1, STAY_KEYS, JOIN_KEYS), '日帰りのため日帰り参加料は発生しません');
    assert.strictEqual(findLockReason('ad_0', 1, STAY_KEYS, JOIN_KEYS), '日帰りのため宿泊人数は入力できません');
    assert.strictEqual(findLockReason('ad_2', 3, STAY_KEYS, JOIN_KEYS), '最終日の夜は泊まらないため入力できません');
    assert.strictEqual(findLockReason('ad_1', 3, STAY_KEYS, JOIN_KEYS), '');
    assert.strictEqual(findLockReason('jg_ad_2', 3, STAY_KEYS, JOIN_KEYS), '');
    assert.strictEqual(findLockReason('gym_0', 1, STAY_KEYS, JOIN_KEYS), '');
});

// 起動後に数量を入れて日数を変え、保存データをページに書き出すスクリプト
const buildScript = (quantities, days) => `<script>
window.addEventListener('load', () => {
    inputData = ${JSON.stringify(quantities)};
    document.getElementById('in_days').value = '${days}';
    onGridChange();
    const dump = document.createElement('div');
    dump.id = 'test_dump';
    dump.textContent = encodeURIComponent(localStorage.getItem(STORAGE_KEY));
    document.body.appendChild(dump);
});
</script>`;

const preparePage = (script) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stay-lock-test-'));
    const htmlPath = path.join(dir, path.basename(HTML_PATH));
    fs.writeFileSync(htmlPath, readHtml().replace('</body>', `${script}\n</body>`), 'utf8');
    return htmlPath;
};

// disabled 属性があるか（class の "disabled:bg-gray-200" などには反応しない）
const isDisabledInput = (dom, cellId) => new RegExp(`<input[^>]*id="in_${cellId}"[^>]*\\sdisabled(=""|\\s|>)`).test(dom);

const readSavedQuantities = (dom) => JSON.parse(decodeURIComponent(findById(dom, 'test_dump'))).inputData;

test('画面で3日にすると、最終日の宿泊人数の欄だけが入力不可になり、データも消える', { skip: !BROWSER }, () => {
    const dom = renderDom(BROWSER, preparePage(buildScript({ ad_0: 10, ad_1: 10, ad_2: 10, bf_2: 10 }, 3)));
    assert.deepStrictEqual(['es_2', 'hs_2', 'ad_2'].map((cellId) => isDisabledInput(dom, cellId)), [true, true, true]);
    assert.deepStrictEqual(['ad_0', 'ad_1', 'bf_2'].map((cellId) => isDisabledInput(dom, cellId)), [false, false, false]);
    assert.deepStrictEqual(readSavedQuantities(dom), { ad_0: 10, ad_1: 10, bf_2: 10 });
});

test('画面で日帰りにすると、宿泊人数と日帰り参加料の欄がすべて入力不可になり、データも消える', { skip: !BROWSER }, () => {
    const dom = renderDom(BROWSER, preparePage(buildScript({ es_0: 3, ad_0: 10, jg_ad_0: 5, jf_es_hs_0: 2, gym_0: 2 }, 1)));
    assert.deepStrictEqual(['es_0', 'hs_0', 'ad_0'].map((cellId) => isDisabledInput(dom, cellId)), [true, true, true]);
    assert.deepStrictEqual(JOIN_KEYS.map((itemKey) => isDisabledInput(dom, `${itemKey}_0`)), JOIN_KEYS.map(() => true));
    assert.strictEqual(isDisabledInput(dom, 'gym_0'), false);
    assert.deepStrictEqual(readSavedQuantities(dom), { gym_0: 2 });
});

test('画面で2日以上にすると、日帰り参加料の欄は入力できる', { skip: !BROWSER }, () => {
    const dom = renderDom(BROWSER, preparePage(buildScript({ ad_0: 10, jg_ad_0: 5, jg_ad_1: 5 }, 2)));
    assert.deepStrictEqual(['jg_ad_0', 'jg_ad_1'].map((cellId) => isDisabledInput(dom, cellId)), [false, false]);
    assert.deepStrictEqual(readSavedQuantities(dom), { ad_0: 10, jg_ad_0: 5, jg_ad_1: 5 });
});
