// 消費税（内税）の内訳表示の動作確認テスト
// 実行方法：node --test tests/tax-breakdown.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { HTML_PATH, BROWSER_CANDIDATES, readHtml, findBrowser, renderDom, findById } = require('./helpers');

const BROWSER = findBrowser(BROWSER_CANDIDATES);

const extractBlock = (html, name) => new RegExp(`// ${name}:start([\\s\\S]*?)// ${name}:end`).exec(html)[1];

const loadTaxBlocks = (html) => vm.runInNewContext(
    ['TAX_CONFIG', 'DAY_RANGE', 'STAY_LOCK', 'INPUT_CHECK', 'TAX_CALC'].map((name) => extractBlock(html, name)).join('\n')
    + `\n({ TAX_CONFIG, isValidTaxRate, resolveTaxConfig, isReducedTaxItem, buildAmountLines, sumAmountsByTaxRate,
         splitTaxIncludedAmount, calculateTaxBreakdown, formatTaxRate, buildTaxBreakdownLines })`
);

const {
    TAX_CONFIG, isValidTaxRate, resolveTaxConfig, isReducedTaxItem, buildAmountLines, sumAmountsByTaxRate,
    splitTaxIncludedAmount, calculateTaxBreakdown, formatTaxRate, buildTaxBreakdownLines
} = loadTaxBlocks(readHtml());

const toPlain = (obj) => JSON.parse(JSON.stringify(obj));

// 料金表に書かれている項目キーと名前の一覧
const readItemNames = (html) => Object.fromEntries(
    Array.from(html.matchAll(/key: '([^']+)', name: '([^']+)'/g), (match) => [match[1], match[2]])
);

const sumBreakdown = (breakdown) => breakdown.standard.taxExcluded + breakdown.standard.tax
    + breakdown.reduced.taxExcluded + breakdown.reduced.tax;

test('TAX_CONFIG は標準税率10%・軽減税率8%で、軽減税率の対象は弁当4種・お茶・塩おにぎり', () => {
    assert.strictEqual(TAX_CONFIG.standardRate, 0.10);
    assert.strictEqual(TAX_CONFIG.reducedRate, 0.08);
    const itemNames = readItemNames(readHtml());
    const reducedNames = toPlain(TAX_CONFIG.reducedItemIds).map((itemId) => itemNames[itemId]);
    assert.deepStrictEqual(reducedNames, ['竜田揚げ弁当', '幕の内弁当', 'からマヨ丼', 'おにぎり弁当', 'お茶', '塩おにぎり(2個)']);
    assert.ok(Object.isFrozen(TAX_CONFIG) && Object.isFrozen(TAX_CONFIG.reducedItemIds), '設定が書き換えられる状態です');
});

test('食堂の食事・宿泊・施設・日帰り参加料は、軽減税率の対象にしない', () => {
    ['bf', 'lu', 'di', 'cu', 'es', 'hs', 'ad', 'gym', 'gl_f', 'kL', 'jg_ad', 'jf_es_hs'].forEach((itemKey) => {
        assert.strictEqual(isReducedTaxItem(itemKey, TAX_CONFIG), false, itemKey);
    });
    ['be_tatsu', 'be_maku', 'be_kara', 'be_oni', 'te', 'on'].forEach((itemKey) => {
        assert.strictEqual(isReducedTaxItem(itemKey, TAX_CONFIG), true, itemKey);
    });
});

test('isValidTaxRate は0以上1未満の数だけを税率として認める', () => {
    [0, 0.08, 0.1, 0.25, 0.999].forEach((rate) => assert.strictEqual(isValidTaxRate(rate), true, String(rate)));
    [-0.1, 1, 10, NaN, Infinity, '0.1', null, undefined].forEach((rate) => assert.strictEqual(isValidTaxRate(rate), false, String(rate)));
});

test('resolveTaxConfig は設定がなければ既定値をそのまま使う', () => {
    assert.deepStrictEqual(toPlain(resolveTaxConfig(TAX_CONFIG, undefined)), toPlain(TAX_CONFIG));
    assert.deepStrictEqual(toPlain(resolveTaxConfig(TAX_CONFIG, null)), toPlain(TAX_CONFIG));
});

test('resolveTaxConfig は facility-config.js に書いたキーだけを上書きする', () => {
    assert.deepStrictEqual(toPlain(resolveTaxConfig(TAX_CONFIG, { standardRate: 0.12 })), { ...toPlain(TAX_CONFIG), standardRate: 0.12 });
    assert.deepStrictEqual(toPlain(resolveTaxConfig(TAX_CONFIG, { reducedItemIds: ['te'] })), { ...toPlain(TAX_CONFIG), reducedItemIds: ['te'] });
    assert.deepStrictEqual(toPlain(resolveTaxConfig(TAX_CONFIG, { reducedItemIds: [] })).reducedItemIds, [], '空にすると軽減税率の対象なし');
});

test('resolveTaxConfig は正しくない値を無視し、結果を書き換えられないようにする', () => {
    const resolved = resolveTaxConfig(TAX_CONFIG, { standardRate: 10, reducedRate: '0.05', reducedItemIds: ['te', 1] });
    assert.deepStrictEqual(toPlain(resolved), toPlain(TAX_CONFIG));
    assert.ok(Object.isFrozen(resolved) && Object.isFrozen(resolved.reducedItemIds));
});

test('splitTaxIncludedAmount は税込金額から内消費税（切り捨て）と税抜金額を出す', () => {
    assert.deepStrictEqual(toPlain(splitTaxIncludedAmount(1100, 0.10)), { rate: 0.10, taxIncluded: 1100, taxExcluded: 1000, tax: 100 });
    assert.deepStrictEqual(toPlain(splitTaxIncludedAmount(1080, 0.08)), { rate: 0.08, taxIncluded: 1080, taxExcluded: 1000, tax: 80 });
    assert.deepStrictEqual(toPlain(splitTaxIncludedAmount(150, 0.08)), { rate: 0.08, taxIncluded: 150, taxExcluded: 139, tax: 11 });
    assert.deepStrictEqual(toPlain(splitTaxIncludedAmount(3300, 0.10)), { rate: 0.10, taxIncluded: 3300, taxExcluded: 3000, tax: 300 });
});

test('splitTaxIncludedAmount は0円・1円・税率0%でも正しく計算する', () => {
    assert.deepStrictEqual(toPlain(splitTaxIncludedAmount(0, 0.10)), { rate: 0.10, taxIncluded: 0, taxExcluded: 0, tax: 0 });
    assert.deepStrictEqual(toPlain(splitTaxIncludedAmount(1, 0.10)), { rate: 0.10, taxIncluded: 1, taxExcluded: 1, tax: 0 });
    assert.deepStrictEqual(toPlain(splitTaxIncludedAmount(5000, 0)), { rate: 0, taxIncluded: 5000, taxExcluded: 5000, tax: 0 });
});

test('splitTaxIncludedAmount は0〜10万円のどの金額でも、税抜＋税＝税込 が1円もずれず、税は切り捨てになる', () => {
    [[0.10, 10], [0.08, 8]].forEach(([rate, percent]) => {
        Array.from({ length: 100001 }, (_, amount) => amount).forEach((amount) => {
            const { taxExcluded, tax } = splitTaxIncludedAmount(amount, rate);
            assert.strictEqual(taxExcluded + tax, amount);
            // 切り捨ての確認：tax ≦ 税込×税率÷(1＋税率) ＜ tax＋1 を整数で比べる
            assert.ok(tax * (100 + percent) <= amount * percent && amount * percent < (tax + 1) * (100 + percent), `${amount}円・${percent}%`);
        });
    });
});

test('buildAmountLines は項目ごとに、日をまたいだ数量×単価の税込金額を作る', () => {
    const items = [{ key: 'ad', price: 3300 }, { key: 'be_maku', price: 700 }, { key: 'te', price: 150 }];
    const lines = buildAmountLines(items, { ad_0: 10, ad_1: 10, be_maku_0: 3, bf_0: 5 }, (item) => item.price);
    assert.deepStrictEqual(toPlain(lines), [
        { itemKey: 'ad', amount: 66000 }, { itemKey: 'be_maku', amount: 2100 }, { itemKey: 'te', amount: 0 }
    ]);
});

test('sumAmountsByTaxRate は標準税率と軽減税率の対象に分けて合計する', () => {
    const lines = [{ itemKey: 'ad', amount: 33000 }, { itemKey: 'lu', amount: 6600 }, { itemKey: 'be_oni', amount: 800 }, { itemKey: 'te', amount: 300 }];
    assert.deepStrictEqual(toPlain(sumAmountsByTaxRate(lines, TAX_CONFIG)), { standard: 39600, reduced: 1100 });
    assert.deepStrictEqual(toPlain(sumAmountsByTaxRate([], TAX_CONFIG)), { standard: 0, reduced: 0 });
});

test('calculateTaxBreakdown の税率ごとの税抜と税をすべて足すと、税込合計と一致する', () => {
    const lines = [{ itemKey: 'ad', amount: 33333 }, { itemKey: 'gym', amount: 4567 }, { itemKey: 'be_kara', amount: 1801 }, { itemKey: 'on', amount: 199 }];
    const breakdown = calculateTaxBreakdown(lines, TAX_CONFIG);
    assert.deepStrictEqual(toPlain(breakdown), {
        standard: { rate: 0.10, taxIncluded: 37900, taxExcluded: 34455, tax: 3445 },
        reduced: { rate: 0.08, taxIncluded: 2000, taxExcluded: 1852, tax: 148 }
    });
    assert.strictEqual(sumBreakdown(breakdown), 39900);
});

test('formatTaxRate は税率を「10%」の形にする', () => {
    assert.deepStrictEqual([0.10, 0.08, 0, 0.075, 0.12].map(formatTaxRate), ['10%', '8%', '0%', '7.5%', '12%']);
});

test('buildTaxBreakdownLines は「10%対象」「税」「8%対象」「税」の4行を、3桁区切りで作る', () => {
    const breakdown = calculateTaxBreakdown([{ itemKey: 'ad', amount: 34100 }, { itemKey: 'be_maku', amount: 2160 }], TAX_CONFIG);
    assert.deepStrictEqual(toPlain(buildTaxBreakdownLines(breakdown)), [
        '（10%対象 31,000円）', '（税 3,100円）', '（8%対象 2,000円）', '（税 160円）'
    ]);
});

test('buildTaxBreakdownLines は0円のときも4行を出す', () => {
    assert.deepStrictEqual(toPlain(buildTaxBreakdownLines(calculateTaxBreakdown([], TAX_CONFIG))), [
        '（10%対象 0円）', '（税 0円）', '（8%対象 0円）', '（税 0円）'
    ]);
});

// 起動後に数量を入れて、見積書の合計と消費税の内訳をページに書き出すスクリプト
const buildScript = (quantities) => `<script>
window.addEventListener('load', () => {
    inputData = ${JSON.stringify(quantities)};
    onGridChange();
    const dump = document.createElement('div');
    dump.id = 'test_dump';
    dump.textContent = encodeURIComponent(JSON.stringify({
        grandTotal: document.getElementById('out_grand_total').textContent,
        lines: Array.from(document.querySelectorAll('#out_tax_breakdown > div'), (line) => line.textContent)
    }));
    document.body.appendChild(dump);
});
</script>`;

const renderTaxState = (quantities, configSource) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tax-breakdown-test-'));
    const htmlPath = path.join(dir, path.basename(HTML_PATH));
    fs.writeFileSync(htmlPath, readHtml().replace('</body>', `${buildScript(quantities)}\n</body>`), 'utf8');
    if (configSource) fs.writeFileSync(path.join(dir, 'facility-config.js'), configSource, 'utf8');
    return JSON.parse(decodeURIComponent(findById(renderDom(BROWSER, htmlPath), 'test_dump')));
};

// 「（10%対象 36,000円）」から金額（36000）だけを取り出す（税率の数字は含めない）
const toYen = (text) => Number(/([\d,]+)円/.exec(text)?.[1]?.replace(/,/g, '') ?? text.replace(/[^\d]/g, ''));

test('画面：合計欄の下に4行の内訳が出て、対象額と税をすべて足すと税込合計と一致する', { skip: !BROWSER }, () => {
    // 宿泊 3,300円×10人（10%）、昼食 660円×10食（10%）、幕の内弁当 700円×3食（8%）、お茶 150円×3本（8%）
    const state = renderTaxState({ ad_0: 10, lu_0: 10, be_maku_0: 3, te_0: 3 });
    assert.strictEqual(state.grandTotal, '42,150');
    assert.deepStrictEqual(state.lines, ['（10%対象 36,000円）', '（税 3,600円）', '（8%対象 2,362円）', '（税 188円）']);
    assert.strictEqual(state.lines.map(toYen).reduce((total, yen) => total + yen, 0), toYen(state.grandTotal));
});

test('画面：facility-config.js の CUSTOM_TAX_CONFIG で税率と軽減税率の対象を上書きできる', { skip: !BROWSER }, () => {
    const configSource = 'window.CUSTOM_TAX_CONFIG = { reducedRate: 0.05, reducedItemIds: ["lu"] };';
    const state = renderTaxState({ ad_0: 10, lu_0: 10, be_maku_0: 3 }, configSource);
    // 10%：宿泊 33,000円＋幕の内弁当 2,100円（軽減の対象から外れる）、5%：昼食 6,600円
    assert.deepStrictEqual(state.lines, ['（10%対象 31,910円）', '（税 3,190円）', '（5%対象 6,286円）', '（税 314円）']);
    assert.strictEqual(state.lines.map(toYen).reduce((total, yen) => total + yen, 0), toYen(state.grandTotal));
});
