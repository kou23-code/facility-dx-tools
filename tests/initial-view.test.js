// 最初の表示（カテゴリをすべて開く・使い方をいつも表示する）の動作確認テスト
// 実行方法：node --test tests/initial-view.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { HTML_PATH, BROWSER_CANDIDATES, readHtml, findBrowser, renderDom, findById } = require('./helpers');

const BROWSER = findBrowser(BROWSER_CANDIDATES);
const BLOCK_PATTERN = /\/\/ COLLAPSE:start([\s\S]*?)\/\/ COLLAPSE:end/;
const CATEGORY_IDS = ['stay', 'food', 'room', 'join'];

const loadCollapseBlock = (html) => vm.runInNewContext(`${BLOCK_PATTERN.exec(html)[1]}\n({ createInitialCollapsed, resolveCollapsed })`);

const { createInitialCollapsed, resolveCollapsed } = loadCollapseBlock(readHtml());

const toPlain = (obj) => JSON.parse(JSON.stringify(obj));

test('createInitialCollapsed は、どのカテゴリも閉じていない状態を返す', () => {
    assert.deepStrictEqual(toPlain(createInitialCollapsed()), {});
});

test('createInitialCollapsed は呼ぶたびに新しいオブジェクトを返す（使い回して書き換わらない）', () => {
    assert.notStrictEqual(createInitialCollapsed(), createInitialCollapsed());
});

test('resolveCollapsed は保存データの開閉状態をコピーして使う', () => {
    const savedCollapsed = { room: true, join: false };
    const resolved = resolveCollapsed(savedCollapsed);
    assert.deepStrictEqual(toPlain(resolved), { room: true, join: false });
    assert.notStrictEqual(resolved, savedCollapsed, '保存データのオブジェクトをそのまま使っています');
});

test('resolveCollapsed は開閉状態がない・壊れている保存データなら、すべて開いた状態にする', () => {
    [undefined, null, 'join', 1, true, ['join']].forEach((savedCollapsed) => {
        assert.deepStrictEqual(toPlain(resolveCollapsed(savedCollapsed)), {}, `値 ${JSON.stringify(savedCollapsed)}`);
    });
});

test('使い方の開閉ボタンがなく、使い方は最初から表示される HTML になっている', () => {
    const html = readHtml();
    assert.ok(!html.includes('toggleHelp'), '使い方を開閉する処理が残っています');
    assert.ok(!html.includes('？ 使い方'), '使い方の開閉ボタンが残っています');
    assert.match(html, /<div id="helpBox" class="(?![^"]*\bhidden\b)[^"]*">/, '使い方が最初は隠れる設定になっています');
});

test('「日帰り参加料」を最初から閉じる設定が残っていない', () => {
    assert.ok(!readHtml().includes('{ join: true }'));
});

// 起動前に保存データを置き（savedData）、起動後の使い方とカテゴリの表示状態を書き出す
const buildPage = (savedData) => {
    const presetScript = savedData
        ? `<script>localStorage.setItem('reservation_estimate_v1', ${JSON.stringify(JSON.stringify(savedData))});</script>`
        : '';
    const dumpScript = `<script>
window.addEventListener('load', () => {
    const helpBox = document.getElementById('helpBox');
    const isRowShown = (id) => document.querySelector('#tb_' + id + ' .item-row').offsetParent !== null;
    const dump = document.createElement('div');
    dump.id = 'test_dump';
    dump.textContent = encodeURIComponent(JSON.stringify({
        helpShown: !helpBox.classList.contains('hidden') && helpBox.offsetParent !== null,
        rowsShown: Object.fromEntries(${JSON.stringify(CATEGORY_IDS)}.map(id => [id, isRowShown(id)]))
    }));
    document.body.appendChild(dump);
});
</script>`;
    return readHtml().replace('<head>', `<head>\n${presetScript}`).replace('</body>', `${dumpScript}\n</body>`);
};

const renderViewState = (savedData) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'initial-view-test-'));
    const htmlPath = path.join(dir, path.basename(HTML_PATH));
    fs.writeFileSync(htmlPath, buildPage(savedData), 'utf8');
    return JSON.parse(decodeURIComponent(findById(renderDom(BROWSER, htmlPath), 'test_dump')));
};

const ALL_SHOWN = { stay: true, food: true, room: true, join: true };

test('画面：初めて開くと、使い方が表示され、日帰り参加料を含むすべてのカテゴリが開いている', { skip: !BROWSER }, () => {
    assert.deepStrictEqual(renderViewState(null), { helpShown: true, rowsShown: ALL_SHOWN });
});

test('画面：保存データがあっても、使い方はいつも表示される', { skip: !BROWSER }, () => {
    const state = renderViewState({ customer: 'あおぞら少年団', inputData: {}, collapsed: {} });
    assert.deepStrictEqual(state, { helpShown: true, rowsShown: ALL_SHOWN });
});

test('画面：保存データで閉じていたカテゴリは、閉じたまま読み込む', { skip: !BROWSER }, () => {
    const state = renderViewState({ inputData: {}, collapsed: { room: true } });
    assert.deepStrictEqual(state.rowsShown, { ...ALL_SHOWN, room: false });
});

test('画面：開閉状態のない古い保存データは、すべてのカテゴリを開いて読み込む', { skip: !BROWSER }, () => {
    assert.deepStrictEqual(renderViewState({ inputData: {} }).rowsShown, ALL_SHOWN);
});
