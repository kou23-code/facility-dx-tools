// 利用日数を減らしたときに、範囲外の日の数量データを消す動作確認テスト
// 実行方法：node --test tests/reduce-days.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { HTML_PATH, BROWSER_CANDIDATES, readHtml, findBrowser, renderDom, findById } = require('./helpers');

const BLOCK_PATTERN = /\/\/ DAY_RANGE:start([\s\S]*?)\/\/ DAY_RANGE:end/;
const BROWSER = findBrowser(BROWSER_CANDIDATES);

const loadDayRangeBlock = (html) => vm.runInNewContext(`${BLOCK_PATTERN.exec(html)[1]}\n({ extractDayIndex, removeOutOfRangeDays })`);

const { extractDayIndex, removeOutOfRangeDays } = loadDayRangeBlock(readHtml());

const toPlain = (obj) => JSON.parse(JSON.stringify(obj));

// 3日分（0〜2日目）に、宿泊・食事・施設・加算の数量が入っているデータ
const THREE_DAY_QUANTITIES = Object.freeze({
    ad_0: 10, ad_1: 10, ad_2: 10,
    bf_1: 10, bf_2: 10, di_0: 10,
    gym_s_0: 2, gym_s_2: 3, gl_f_2: 4,
    jg_ad_1: 5, jg_ad_2: 5
});

test('extractDayIndex はマスのIDの末尾から日のインデックスを取り出す', () => {
    assert.strictEqual(extractDayIndex('ad_0'), 0);
    assert.strictEqual(extractDayIndex('gym_s_2'), 2);
    assert.strictEqual(extractDayIndex('jg_es_hs_6'), 6);
    assert.strictEqual(extractDayIndex('be_tatsu_12'), 12);
});

test('extractDayIndex は末尾が数字でないIDに null を返す', () => {
    assert.strictEqual(extractDayIndex('gym_s'), null);
    assert.strictEqual(extractDayIndex(''), null);
    assert.strictEqual(extractDayIndex('ad_'), null);
});

test('3日から2日に減らすと、3日目（インデックス2）のデータだけが消える', () => {
    assert.deepStrictEqual(toPlain(removeOutOfRangeDays(THREE_DAY_QUANTITIES, 2)), {
        ad_0: 10, ad_1: 10, bf_1: 10, di_0: 10, gym_s_0: 2, jg_ad_1: 5
    });
});

test('1日（日帰り）に減らすと、1日目のデータだけが残る', () => {
    assert.deepStrictEqual(toPlain(removeOutOfRangeDays(THREE_DAY_QUANTITIES, 1)), {
        ad_0: 10, di_0: 10, gym_s_0: 2
    });
});

test('日数が同じか増えたときは、データを消さない', () => {
    assert.deepStrictEqual(toPlain(removeOutOfRangeDays(THREE_DAY_QUANTITIES, 3)), toPlain(THREE_DAY_QUANTITIES));
    assert.deepStrictEqual(toPlain(removeOutOfRangeDays(THREE_DAY_QUANTITIES, 7)), toPlain(THREE_DAY_QUANTITIES));
});

test('日数が0のときは、日付付きのデータがすべて消える', () => {
    assert.deepStrictEqual(toPlain(removeOutOfRangeDays(THREE_DAY_QUANTITIES, 0)), {});
});

test('空のデータを渡すと、空のデータを返す', () => {
    assert.deepStrictEqual(toPlain(removeOutOfRangeDays({}, 3)), {});
});

test('末尾が日のインデックスでないIDは消さずに残す', () => {
    assert.deepStrictEqual(toPlain(removeOutOfRangeDays({ ad_5: 1, memo: 2 }, 1)), { memo: 2 });
});

test('元のデータを書き換えず、新しいオブジェクトを返す', () => {
    const quantities = { ad_0: 1, ad_2: 1 };
    const result = removeOutOfRangeDays(quantities, 1);
    assert.deepStrictEqual(quantities, { ad_0: 1, ad_2: 1 });
    assert.notStrictEqual(result, quantities);
});

// 起動後に3日分の数量を入れ、日数を1日に変えたあとの保存データをページに書き出すスクリプト
const REDUCE_DAYS_SCRIPT = `<script>
window.addEventListener('load', () => {
    inputData = ${JSON.stringify(THREE_DAY_QUANTITIES)};
    document.getElementById('in_days').value = '1';
    onGridChange();
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const dump = document.createElement('div');
    dump.id = 'test_dump';
    dump.textContent = encodeURIComponent(JSON.stringify({ memory: inputData, saved: saved.inputData }));
    document.body.appendChild(dump);
});
</script>`;

const preparePage = (html) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reduce-days-test-'));
    const htmlPath = path.join(dir, path.basename(HTML_PATH));
    fs.writeFileSync(htmlPath, html.replace('</body>', `${REDUCE_DAYS_SCRIPT}\n</body>`), 'utf8');
    return htmlPath;
};

test('画面で日数を減らすと、内部データと localStorage から範囲外の日のデータが消える', { skip: !BROWSER }, () => {
    const dom = renderDom(BROWSER, preparePage(readHtml()));
    const dump = JSON.parse(decodeURIComponent(findById(dom, 'test_dump') || 'null'));
    // 日帰りになるので、1日目の宿泊人数（ad_0）も消える
    const expected = { di_0: 10, gym_s_0: 2 };
    assert.deepStrictEqual(dump.memory, expected, '内部データに範囲外の日が残っています');
    assert.deepStrictEqual(dump.saved, expected, 'localStorage に範囲外の日が残っています');
});
