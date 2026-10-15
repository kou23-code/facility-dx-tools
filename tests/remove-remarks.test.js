// 備考欄の削除の動作確認テスト
// 実行方法：node --test tests/remove-remarks.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { HTML_PATH, BROWSER_CANDIDATES, readHtml, findBrowser, renderDom, findById } = require('./helpers');

test('備考の入力欄と見積書の備考欄がHTMLに残っていない', () => {
    const html = readHtml();
    ['in_note', 'out_note', 'out_note_wrap', '備考'].forEach((word) => {
        assert.ok(!html.includes(word), `「${word}」が残っています`);
    });
});

test('備考を削除してもページが最後まで動き、見積書が表示される', { skip: !findBrowser(BROWSER_CANDIDATES) }, () => {
    const dom = renderDom(findBrowser(BROWSER_CANDIDATES), HTML_PATH);
    assert.ok(!dom.includes('表を読み込み中'), '入力表が作られていません（JavaScriptが途中で止まっています）');
    assert.match(findById(dom, 'price_gym') || '', /^[\d,]+$/, '施設の単価が表示されていません');
    assert.match(findById(dom, 'out_expire') || '', /年.+月.+日/, '有効期限が表示されていません');
    assert.strictEqual(findById(dom, 'out_grand_total'), '0', '初期状態の合計が0円になっていません');
    assert.ok(dom.includes('宛名（団体名）が未入力です。'), '計算の最後の注意表示まで処理が進んでいません');
});
