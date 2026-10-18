// 公式ホームページ兼DXポータル（index.html）の画面の動作確認テスト（ヘッドレスブラウザで開く）
// 実行方法：node --test tests/portal-page.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ROOT_DIR, PORTAL_PATH, RESERVATION_LOGIC_PATH, BROWSER_CANDIDATES, findBrowser, renderDom, findById } = require('./helpers');

const BROWSER = findBrowser(BROWSER_CANDIDATES);
const YEAR = new Date().getFullYear();

// facility-config.js による上書きの確認に使う架空の値
const CUSTOM_INFO = {
    organization: '株式会社テスト商事', facilityName: 'みどり研修センター', representativeTitle: '館長', representativeName: '佐藤 花子',
    postalCode: '999-9999', address: 'テスト県テスト市1-2-3', tel: '099-999-9999'
};

// ポータルと読み込むファイルを一時フォルダにコピーし、必要ならルートに facility-config.js を置く
const preparePortal = (configSource) => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-test-'));
    fs.mkdirSync(path.join(rootDir, 'reservation'));
    fs.copyFileSync(PORTAL_PATH, path.join(rootDir, 'index.html'));
    fs.copyFileSync(path.join(ROOT_DIR, 'portal-logic.js'), path.join(rootDir, 'portal-logic.js'));
    fs.copyFileSync(RESERVATION_LOGIC_PATH, path.join(rootDir, 'reservation', 'reservation-logic.js'));
    if (configSource) fs.writeFileSync(path.join(rootDir, 'facility-config.js'), configSource, 'utf8');
    return path.join(rootDir, 'index.html');
};

// data-contact="key" の要素に表示された文字（ページの順に並べる）
const listContactTexts = (dom, key) => [...dom.matchAll(new RegExp(`data-contact="${key}"[^>]*>([^<]*)<`, 'g'))].map(([, text]) => text);
const countMatches = (dom, pattern) => (dom.match(pattern) || []).length;

const assertContactShown = (dom, info) => {
    assert.ok(listContactTexts(dom, 'fullName').every((text) => text === `${info.organization} ${info.facilityName}`), '施設名の表示が違います');
    assert.ok(listContactTexts(dom, 'postal').every((text) => text === `〒${info.postalCode}`), '郵便番号の表示が違います');
    assert.ok(listContactTexts(dom, 'address').every((text) => text === info.address), '所在地の表示が違います');
    assert.ok(listContactTexts(dom, 'tel').every((text) => text === info.tel), '電話番号の表示が違います');
    assert.strictEqual(findById(dom, 'copyright'), `© ${YEAR} ${info.organization} ${info.facilityName}`);
    assert.ok(dom.includes(`<title>${info.facilityName} 公式ホームページ｜合宿・スポーツ大会・研修の総合施設</title>`), 'タイトルが違います');
};

test('画面：facility-config.js がないときは、ダミー表記の施設名・所在地・電話番号・コピーライトが表示され、施設8件・宿泊料金3行・食事3グループが並ぶ', { skip: !BROWSER }, () => {
    const dom = renderDom(BROWSER, preparePortal(null));
    assertContactShown(dom, require(RESERVATION_LOGIC_PATH).FACILITY_INFO);
    assert.strictEqual(countMatches(dom, /<article class="facility-card"/g), 8);
    assert.strictEqual(countMatches(dom, /<tbody id="stayPriceRows">(<tr>[\s\S]*?<\/tr>){3}<\/tbody>/g), 1);
    assert.strictEqual(countMatches(dom, /<div class="meal-group">/g), 3);
    assert.match(dom, /<strong class="highlight-value">300名<\/strong>/);
});

test('画面：ルートに facility-config.js があるときは、その施設名・所在地・電話番号で表示され、電話番号のリンクも変わる', { skip: !BROWSER }, () => {
    const dom = renderDom(BROWSER, preparePortal(`window.CUSTOM_FACILITY_INFO = ${JSON.stringify(CUSTOM_INFO)};`));
    assertContactShown(dom, CUSTOM_INFO);
    assert.match(dom, /id="contactTelLink"[^>]*href="tel:0999999999"|href="tel:0999999999"[^>]*id="contactTelLink"/);
});
