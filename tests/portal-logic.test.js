// 公式ホームページ兼DXポータルの表示内容を作る純粋関数（portal-logic.js）の動作確認テスト
// 実行方法：node --test tests/portal-logic.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT_DIR, PORTAL_PATH, RESERVATION_LOGIC_PATH } = require('./helpers');
const { RESERVATION_CATALOG: CATALOG, RESERVATION_CONFIG, FACILITY_INFO } = require(RESERVATION_LOGIC_PATH);
const Portal = require(path.join(ROOT_DIR, 'portal-logic.js'));

// facility-config.js で上書きしたときの確認に使う架空の値
const CUSTOM_INFO = {
    organization: '株式会社テスト商事', facilityName: 'みどり研修センター', representativeTitle: '館長', representativeName: '佐藤 花子',
    postalCode: '999-9999', address: 'テスト県テスト市1-2-3', tel: '099-999-9999'
};

const toPlain = (value) => JSON.parse(JSON.stringify(value));
const sectionOf = (key) => Portal.buildFacilitySections(CATALOG, Portal.FACILITY_GUIDES).find((section) => section.key === key);

test('施設紹介は、体育館・グラウンド（4施設）と研修室（4施設）の全8施設を、決められた順に分ける', () => {
    const names = (key) => sectionOf(key).cards.map((card) => card.name);
    assert.deepStrictEqual(names('sports'), ['大体育館', '小体育館', '陸上グラウンド', '球技場']);
    assert.deepStrictEqual(names('room'), ['大研修室（第１研修室）', '大研修室（第３研修室）', '小研修室（第２研修室）', 'ミーティングルーム']);
});

test('すべての施設に用途と特徴の紹介文があり、紹介文のない施設やカタログにない施設がない', () => {
    assert.deepStrictEqual(Object.keys(Portal.FACILITY_GUIDES).sort(), CATALOG.facilities.map((facility) => facility.key).sort());
    Portal.buildFacilitySections(CATALOG, Portal.FACILITY_GUIDES).flatMap((section) => section.cards).forEach((card) => {
        assert.ok(card.usage && card.feature, `${card.name} の紹介文がありません`);
    });
});

test('体育館・グラウンドは午前・午後・夜間の3区分、研修室は9〜21時の1時間単位と説明する', () => {
    assert.strictEqual(sectionOf('sports').unitNote, '午前・午後・夜間の3区分');
    assert.strictEqual(sectionOf('sports').timeNote, '午前（8:30~12:30）・午後（12:30~17:00）・夜間（17:00~21:00）');
    assert.strictEqual(sectionOf('room').unitNote, '9〜21時の1時間単位');
    assert.match(sectionOf('room').timeNote, /^9〜21時/);
});

test('施設の料金目安は、料金表の一番安い額〜一番高い額（区分ごと・1時間ごと）を表示する', () => {
    const cardOf = (section, key) => sectionOf(section).cards.find((card) => card.key === key);
    assert.deepStrictEqual([cardOf('sports', 'gym').unitLabel, cardOf('sports', 'gym').priceLabel], ['1区分あたり', '5,370円〜10,060円']);
    assert.deepStrictEqual([cardOf('room', 'mr').unitLabel, cardOf('room', 'mr').priceLabel], ['1時間あたり', '330円〜660円']);
});

test('formatPriceRange は、金額がすべて同じなら1つだけ、違えば「最小〜最大」を返す', () => {
    assert.strictEqual(Portal.formatPriceRange({ a: 950, b: 950 }), '950円');
    assert.strictEqual(Portal.formatPriceRange({ a: 1890, b: 950 }), '950円〜1,890円');
    assert.strictEqual(Portal.formatPriceRange({ a: 0 }), '0円');
});

test('formatHourRange は、最初のコマの開始時刻〜最後のコマの終了時刻を返す', () => {
    assert.strictEqual(Portal.formatHourRange(CATALOG.hourSlots), '9〜21時');
    assert.strictEqual(Portal.formatHourRange([{ startHour: 10 }]), '10〜11時');
});

test('紹介文のない施設は、体育館・グラウンドの区分に入り、紹介文は空になる', () => {
    const card = Portal.buildFacilityCard({ key: 'new', name: '新施設', billing: 'hour', prices: { a: 100 } }, {});
    assert.deepStrictEqual(toPlain(card), { key: 'new', name: '新施設', category: 'sports', usage: '', feature: '', unitLabel: '1時間あたり', priceLabel: '100円' });
});

test('宿泊料金は年代別（小学生・中学生／高校生／大学生・一般）の1人1泊の料金を表示する', () => {
    assert.deepStrictEqual(Portal.buildStayPriceRows(CATALOG).map((row) => [row.name, row.priceLabel]), [
        ['小学生・中学生', '2,200円'], ['高校生', '2,500円'], ['大学生・一般', '3,300円']
    ]);
});

test('宿泊の受け入れ条件は、受付ルールの上限（最大300名・6団体まで）から作る', () => {
    assert.deepStrictEqual(Portal.buildStayHighlights(RESERVATION_CONFIG).map((item) => item.value), ['300名', '6団体まで', '最大6泊']);
    assert.deepStrictEqual(Portal.buildStayHighlights({ stayCapacity: 0, maxStayGroups: 1, maxNights: 1 }).map((item) => item.value), ['0名', '1団体まで', '最大1泊']);
});

test('食事の案内は、食堂の食事（朝食・昼食・夕食）・弁当・お茶・おにぎりの3つにまとめる', () => {
    const groups = Portal.buildMealGroups(CATALOG);
    assert.deepStrictEqual(groups.map((group) => group.group), ['食堂の食事', '弁当', 'お茶・おにぎり']);
    assert.deepStrictEqual(groups[0].items.map((item) => `${item.name}:${item.priceLabel}`), ['朝食:660円／食', '昼食:660円／食', '夕食:990円／食']);
    assert.deepStrictEqual(groups[2].items.map((item) => `${item.name}:${item.priceLabel}`), ['お茶:150円／本', '塩おにぎり(2個):200円／食']);
    assert.deepStrictEqual(Portal.buildMealGroups({ meals: [] }), []);
});

test('buildContactInfo は、施設名・所在地・電話番号・コピーライトを作る（ダミー表記）', () => {
    assert.deepStrictEqual(toPlain(Portal.buildContactInfo(FACILITY_INFO, 2026)), {
        organization: '株式会社サンプルリゾート', facilityName: 'あおぞらセミナーハウス', fullName: '株式会社サンプルリゾート あおぞらセミナーハウス',
        postal: '〒100-0001', address: '東京都千代田区千代田1-1-1', tel: '03-0000-0000', telHref: 'tel:0300000000',
        copyright: '© 2026 株式会社サンプルリゾート あおぞらセミナーハウス'
    });
});

test('buildContactInfo と buildPortalTitle は、facility-config.js で上書きした情報をそのまま使う', () => {
    const contact = Portal.buildContactInfo(CUSTOM_INFO, 2030);
    assert.deepStrictEqual([contact.fullName, contact.postal, contact.tel, contact.telHref, contact.copyright], [
        '株式会社テスト商事 みどり研修センター', '〒999-9999', '099-999-9999', 'tel:0999999999', '© 2030 株式会社テスト商事 みどり研修センター'
    ]);
    assert.strictEqual(Portal.buildPortalTitle(CUSTOM_INFO), 'みどり研修センター 公式ホームページ｜合宿・スポーツ大会・研修の総合施設');
});

test('HTML を作る関数は、表示する文字をエスケープする', () => {
    const card = { key: 'x', name: '<b>"A&B"</b>', usage: "'", feature: '', unitLabel: '1時間あたり', priceLabel: '0円' };
    const html = Portal.renderFacilityCardHtml(card);
    assert.ok(html.includes('&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;') && html.includes('&#39;'), html);
    assert.ok(!html.includes('<b>'));
    assert.strictEqual(Portal.renderMealGroupHtml({ group: '<i>', items: [] }), '<div class="meal-group"><h4>&lt;i&gt;</h4><ul></ul></div>');
});

test('施設の区分の HTML には、見出し・料金の単位・利用時間・施設カードが入る', () => {
    const html = Portal.renderFacilitySectionHtml(sectionOf('room'));
    assert.match(html, /^<div class="facility-group" data-category="room"><h3 class="facility-group-title">研修室<span class="facility-unit">9〜21時の1時間単位<\/span><\/h3>/);
    assert.strictEqual((html.match(/<article class="facility-card"/g) || []).length, 4);
});

test('宿泊料金の表と受け入れ条件の HTML は、行・項目の数だけ作り、空なら空文字を返す', () => {
    assert.strictEqual((Portal.renderStayPriceRowsHtml(Portal.buildStayPriceRows(CATALOG)).match(/<tr>/g) || []).length, 3);
    assert.strictEqual(Portal.renderStayPriceRowsHtml([]), '');
    assert.strictEqual((Portal.renderStayHighlightsHtml(Portal.buildStayHighlights(RESERVATION_CONFIG)).match(/<li>/g) || []).length, 3);
});

test('ヒーローの施設数の表示（体育館・グラウンド 4施設・研修室 4室）が施設の一覧と合っている', () => {
    const html = fs.readFileSync(PORTAL_PATH, 'utf8');
    assert.ok(html.includes(`<li>体育館・グラウンド ${sectionOf('sports').cards.length}施設</li>`));
    assert.ok(html.includes(`<li>研修室 ${sectionOf('room').cards.length}室</li>`));
});

test('PortalLogic は変更できないようになっている', () => {
    assert.ok(Object.isFrozen(Portal));
    assert.ok(Object.isFrozen(Portal.FACILITY_GUIDES));
});
