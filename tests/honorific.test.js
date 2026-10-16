// 宛名の敬称（御中／様）の切り替えの動作確認テスト
// 実行方法：node --test tests/honorific.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { HTML_PATH, BROWSER_CANDIDATES, readHtml, findBrowser, renderDom, findById } = require('./helpers');

const BROWSER = findBrowser(BROWSER_CANDIDATES);
const BLOCK_PATTERN = /\/\/ HONORIFIC:start([\s\S]*?)\/\/ HONORIFIC:end/;

const loadHonorificBlock = (html) => vm.runInNewContext(`${BLOCK_PATTERN.exec(html)[1]}\n({ HONORIFICS, resolveHonorific, buildAddressee })`);

const { HONORIFICS, resolveHonorific, buildAddressee } = loadHonorificBlock(readHtml());

const toPlain = (obj) => JSON.parse(JSON.stringify(obj));

test('選べる敬称は「御中」と「様」で、初期値は「御中」', () => {
    assert.deepStrictEqual(toPlain(HONORIFICS), ['御中', '様']);
});

test('resolveHonorific は選べる敬称をそのまま返す', () => {
    assert.strictEqual(resolveHonorific('御中'), '御中');
    assert.strictEqual(resolveHonorific('様'), '様');
});

test('resolveHonorific は古い保存データや不正な値なら「御中」を返す', () => {
    [undefined, null, '', 'さま', '殿', ' 様'].forEach((value) => {
        assert.strictEqual(resolveHonorific(value), '御中', `値 ${JSON.stringify(value)}`);
    });
});

test('buildAddressee は団体名・個人名と敬称を組み合わせる', () => {
    assert.deepStrictEqual(toPlain(buildAddressee('あおぞら少年団', '御中')), { name: 'あおぞら少年団', honorific: '御中' });
    assert.deepStrictEqual(toPlain(buildAddressee('山田 太郎', '様')), { name: '山田 太郎', honorific: '様' });
});

test('buildAddressee は宛名の前後の空白を除き、空なら仮の「○○○○」にする', () => {
    assert.deepStrictEqual(toPlain(buildAddressee('  山田 太郎　', '様')), { name: '山田 太郎', honorific: '様' });
    assert.deepStrictEqual(toPlain(buildAddressee('   ', '様')), { name: '○○○○', honorific: '様' });
    assert.deepStrictEqual(toPlain(buildAddressee('', 'x')), { name: '○○○○', honorific: '御中' });
});

test('入力欄に敬称の選択肢があり、見積書の「御中」は固定の文字ではなく切り替えられる', () => {
    const html = readHtml();
    assert.ok(html.includes('id="in_honorific"'), '敬称の選択欄がありません');
    assert.ok(html.includes('<option value="様">様</option>'), '「様」を選べません');
    assert.ok(html.includes('<span id="out_honorific">'), '見積書の敬称が切り替えられる表示になっていません');
});

// 起動前に保存データを置き（savedData）、起動後に宛名と敬称を入れて、見積書の宛名欄と保存データを書き出す
const buildPage = (savedData, customerName, honorific) => {
    const presetScript = savedData
        ? `<script>localStorage.setItem('reservation_estimate_v1', ${JSON.stringify(JSON.stringify(savedData))});</script>`
        : '';
    const changeScript = `<script>
window.addEventListener('load', () => {
    if (${JSON.stringify(customerName)} !== null) document.getElementById('in_customer').value = ${JSON.stringify(customerName)};
    if (${JSON.stringify(honorific)} !== null) document.getElementById('in_honorific').value = ${JSON.stringify(honorific)};
    onBasicChange();
    const dump = document.createElement('div');
    dump.id = 'test_dump';
    dump.textContent = encodeURIComponent(JSON.stringify({
        selected: document.getElementById('in_honorific').value,
        saved: JSON.parse(localStorage.getItem(STORAGE_KEY)).honorific
    }));
    document.body.appendChild(dump);
});
</script>`;
    return readHtml().replace('<head>', `<head>\n${presetScript}`).replace('</body>', `${changeScript}\n</body>`);
};

const renderPage = (html) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'honorific-test-'));
    const htmlPath = path.join(dir, path.basename(HTML_PATH));
    fs.writeFileSync(htmlPath, html, 'utf8');
    const dom = renderDom(BROWSER, htmlPath);
    const dump = JSON.parse(decodeURIComponent(findById(dom, 'test_dump')));
    return { ...dump, customer: findById(dom, 'out_customer'), honorific: findById(dom, 'out_honorific') };
};

test('画面：初期状態では見積書の敬称は「御中」', { skip: !BROWSER }, () => {
    const state = renderPage(buildPage(null, 'あおぞら少年団', null));
    assert.deepStrictEqual([state.customer, state.honorific, state.selected, state.saved], ['あおぞら少年団', '御中', '御中', '御中']);
});

test('画面：「様」を選ぶと、個人名の見積書に「様」と表示され、保存データにも残る', { skip: !BROWSER }, () => {
    const state = renderPage(buildPage(null, '山田 太郎', '様'));
    assert.deepStrictEqual([state.customer, state.honorific, state.saved], ['山田 太郎', '様', '様']);
});

test('画面：保存データの敬称「様」を読み込み、見積書に反映する', { skip: !BROWSER }, () => {
    const state = renderPage(buildPage({ customer: '山田 太郎', honorific: '様', inputData: {} }, null, null));
    assert.deepStrictEqual([state.customer, state.honorific, state.selected], ['山田 太郎', '様', '様']);
});

test('画面：敬称のない古い保存データを読み込むと「御中」になる', { skip: !BROWSER }, () => {
    const state = renderPage(buildPage({ customer: 'あおぞら少年団', inputData: {} }, null, null));
    assert.deepStrictEqual([state.customer, state.honorific, state.selected], ['あおぞら少年団', '御中', '御中']);
});
