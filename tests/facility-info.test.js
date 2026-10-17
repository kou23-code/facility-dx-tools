// 発行元の情報（FACILITY_INFO / facility-config.js）と保存キーの動作確認テスト
// 実行方法：node --test tests/facility-info.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { ROOT_DIR, HTML_PATH, BROWSER_CANDIDATES, readHtml, findBrowser, renderDom, findById } = require('./helpers');

const BLOCK_PATTERN = /\/\/ FACILITY_INFO:start([\s\S]*?)\/\/ FACILITY_INFO:end/;
const BROWSER = findBrowser(BROWSER_CANDIDATES);

// 会社名・住所・電話番号らしい表記（FACILITY_INFO の外には書かない）
const PROPER_NOUN_PATTERNS = [/〒/, /TEL\s*\d/, /\d{2,4}-\d{2,4}-\d{3,4}/, /株式会社|協会|財団/, /[都道府県][^\s<'"`]*[市区町村]/];

// 決められたダミー表記（実名を入れるとこのテストが失敗する）
const EXPECTED_DUMMY = {
    organization: '株式会社サンプルリゾート', facilityName: 'あおぞらセミナーハウス',
    representativeTitle: '支配人', representativeName: '山田 太郎',
    postalCode: '100-0001', address: '東京都千代田区千代田1-1-1', tel: '03-0000-0000'
};

// facility-config.js による上書きの確認に使う架空の値
const CUSTOM_INFO = {
    organization: '株式会社テスト商事', facilityName: 'みどり研修センター',
    representativeTitle: '館長', representativeName: '佐藤 花子',
    postalCode: '999-9999', address: 'テスト県テスト市1-2-3', tel: '099-999-9999'
};

const loadFacilityBlock = (html) => {
    const source = `${BLOCK_PATTERN.exec(html)[1]}\n({ FACILITY_INFO, resolveFacilityInfo, buildIssuerLines, buildPageTitle })`;
    return vm.runInNewContext(source);
};

const removeFacilityBlock = (html) => html.replace(BLOCK_PATTERN, '');

const toPlain = (obj) => JSON.parse(JSON.stringify(obj));

// HTML を一時フォルダの中の estimate/ にコピーし、必要なら facility-config.js も置く
// （configSource：estimate/facility-config.js、rootConfigSource：ルートの facility-config.js）
const preparePage = (configSource, rootConfigSource) => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'facility-test-'));
    const dir = path.join(rootDir, 'estimate');
    fs.mkdirSync(dir);
    const htmlPath = path.join(dir, path.basename(HTML_PATH));
    fs.copyFileSync(HTML_PATH, htmlPath);
    if (configSource) fs.writeFileSync(path.join(dir, 'facility-config.js'), configSource, 'utf8');
    if (rootConfigSource) fs.writeFileSync(path.join(rootDir, 'facility-config.js'), rootConfigSource, 'utf8');
    return htmlPath;
};
// ルートの facility-config.js の確認に使う、CUSTOM_INFO とは別の架空の施設名
const ROOT_CUSTOM_INFO = { ...CUSTOM_INFO, facilityName: 'ひかり研修センター' };

const assertIssuerShown = (dom, info, blocks) => {
    Object.entries(blocks.buildIssuerLines(info)).forEach(([id, text]) => {
        assert.strictEqual(findById(dom, id), text, `${id} の表示が違います`);
    });
    assert.ok(dom.includes(`<title>${blocks.buildPageTitle(info)}</title>`), 'ページのタイトルが違います');
};

test('会社名・住所・電話番号らしい表記が FACILITY_INFO の外に書かれていない', () => {
    const outside = removeFacilityBlock(readHtml());
    PROPER_NOUN_PATTERNS.forEach((pattern) => {
        assert.doesNotMatch(outside, pattern, `FACILITY_INFO の外に ${pattern} に当てはまる表記があります`);
    });
});

test('FACILITY_INFO は決められた民間企業風のダミー表記になっている', () => {
    const { FACILITY_INFO } = loadFacilityBlock(readHtml());
    assert.deepStrictEqual(toPlain(FACILITY_INFO), EXPECTED_DUMMY);
});

test('resolveFacilityInfo は設定がなければダミー表記をそのまま使う', () => {
    const { resolveFacilityInfo } = loadFacilityBlock(readHtml());
    assert.deepStrictEqual(toPlain(resolveFacilityInfo(EXPECTED_DUMMY, undefined)), EXPECTED_DUMMY);
    assert.deepStrictEqual(toPlain(resolveFacilityInfo(EXPECTED_DUMMY, null)), EXPECTED_DUMMY);
});

test('resolveFacilityInfo は設定にあるキーだけを上書きする', () => {
    const { resolveFacilityInfo } = loadFacilityBlock(readHtml());
    const resolved = resolveFacilityInfo(EXPECTED_DUMMY, { facilityName: 'みどり研修センター' });
    assert.deepStrictEqual(toPlain(resolved), { ...EXPECTED_DUMMY, facilityName: 'みどり研修センター' });
});

test('resolveFacilityInfo は知らないキーや文字列以外の値を無視し、元の値を書き換えない', () => {
    const { resolveFacilityInfo } = loadFacilityBlock(readHtml());
    const defaults = { ...EXPECTED_DUMMY };
    const resolved = resolveFacilityInfo(defaults, { unknownKey: 'x', tel: 12345, address: null });
    assert.deepStrictEqual(toPlain(resolved), EXPECTED_DUMMY);
    assert.deepStrictEqual(defaults, EXPECTED_DUMMY);
    assert.ok(Object.isFrozen(resolved), '結果が変更できないようになっていません');
});

test('buildIssuerLines は渡された情報から発行元欄の文字列を作る', () => {
    const { buildIssuerLines } = loadFacilityBlock(readHtml());
    assert.deepStrictEqual(toPlain(buildIssuerLines(CUSTOM_INFO)), {
        issuer_name: '株式会社テスト商事 みどり研修センター', issuer_representative: '館長 佐藤 花子',
        issuer_postal: '〒999-9999', issuer_address: 'テスト県テスト市1-2-3', issuer_tel: 'TEL 099-999-9999'
    });
});

test('buildPageTitle は施設名入りのタイトルを作る', () => {
    const { buildPageTitle } = loadFacilityBlock(readHtml());
    assert.strictEqual(buildPageTitle(CUSTOM_INFO), 'みどり研修センター 見積書作成ツール');
});

test('自動保存のキーは一般的な名称 reservation_estimate_v1 になっている', () => {
    assert.ok(readHtml().includes("const STORAGE_KEY = 'reservation_estimate_v1';"));
});

test('facility-config.js は .gitignore で除外されている', () => {
    const lines = fs.readFileSync(path.join(ROOT_DIR, '.gitignore'), 'utf8').split(/\r?\n/);
    assert.ok(lines.includes('facility-config.js'));
});

test('facility-config.js がないときはダミー表記で表示される', { skip: !BROWSER }, () => {
    const blocks = loadFacilityBlock(readHtml());
    assertIssuerShown(renderDom(BROWSER, preparePage(null)), EXPECTED_DUMMY, blocks);
});

test('facility-config.js があるときはその設定で上書き表示される', { skip: !BROWSER }, () => {
    const blocks = loadFacilityBlock(readHtml());
    const configSource = `window.CUSTOM_FACILITY_INFO = ${JSON.stringify(CUSTOM_INFO)};`;
    assertIssuerShown(renderDom(BROWSER, preparePage(configSource)), CUSTOM_INFO, blocks);
});

test('見積もりツールは facility-config.js をこのフォルダ → ルート（../facility-config.js）の順に読み込む', () => {
    const html = readHtml();
    const order = ['<script src="facility-config.js">', '<script src="../facility-config.js">'].map((tag) => html.indexOf(tag));
    assert.ok(order[0] >= 0 && order[0] < order[1], String(order));
});

test('ルートの facility-config.js だけを置いても、その設定で上書き表示される', { skip: !BROWSER }, () => {
    const blocks = loadFacilityBlock(readHtml());
    const rootConfigSource = `window.CUSTOM_FACILITY_INFO = ${JSON.stringify(ROOT_CUSTOM_INFO)};`;
    assertIssuerShown(renderDom(BROWSER, preparePage(null, rootConfigSource)), ROOT_CUSTOM_INFO, blocks);
});

test('ルートとこのフォルダの両方に facility-config.js があるときは、ルートの設定で表示される', { skip: !BROWSER }, () => {
    const blocks = loadFacilityBlock(readHtml());
    const folderConfigSource = `window.CUSTOM_FACILITY_INFO = ${JSON.stringify(CUSTOM_INFO)};`;
    const rootConfigSource = `window.CUSTOM_FACILITY_INFO = ${JSON.stringify(ROOT_CUSTOM_INFO)};`;
    assertIssuerShown(renderDom(BROWSER, preparePage(folderConfigSource, rootConfigSource)), ROOT_CUSTOM_INFO, blocks);
});
