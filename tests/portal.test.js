// 公式ホームページ兼DXポータル（index.html）とフォルダ構成の動作確認テスト（ブラウザを使わない静的な確認）
// 実行方法：node --test tests/portal.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT_DIR, HTML_PATH, PORTAL_PATH, RESERVATION_HTML_PATH, SCHEDULE_HTML_PATH } = require('./helpers');

const PORTAL_LOGIC_PATH = path.join(ROOT_DIR, 'portal-logic.js');
const SKIP_DIRS = ['.git', 'node_modules'];

// 会社名・住所・電話番号らしい表記（ポータルの HTML と portal-logic.js には書かない）
const PROPER_NOUN_PATTERNS = [/〒/, /TEL\s*\d/, /\d{2,4}-\d{2,4}-\d{3,4}/, /株式会社|協会|財団/, /[都道府県][^\s<'"`]*[市区町村]/];

// HTML コメントは表示されないので、確認の対象から外す
const removeComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

const readPortal = () => removeComments(fs.readFileSync(PORTAL_PATH, 'utf8'));

const textOf = (html, pattern) => (pattern.exec(html) || [])[1];

// id を持つ要素の開始タグ（属性の確認に使う）
const findTagById = (html, id) => textOf(html, new RegExp(`(<[a-z]+ [^>]*id="${id}"[^>]*>)`));

const hrefOf = (tag) => textOf(tag || '', /href="([^"]*)"/);

// 指定した開始タグから、対応する閉じタグの手前までを取り出す（入れ子の同じタグは数えない簡易版）
const sliceBlock = (html, startPattern, closeTag) => {
    const start = html.search(startPattern);
    return start < 0 ? '' : html.slice(start, html.indexOf(closeTag, start));
};

// ツールのカード一覧（ul.tools）の <li> ごとに、見出し・リンク先・準備中かどうかを取り出す
const parseToolCards = (html) => [...sliceBlock(html, /<ul class="tools"/, '</ul>').matchAll(/<li>([\s\S]*?)<\/li>/g)].map(([, card]) => ({
    title: textOf(card, /<h3>([^<]*)<\/h3>/),
    href: textOf(card, /<a class="card" [^>]*href="([^"]*)"/) || null,
    isSoon: card.includes('is-soon') && card.includes('準備中')
}));

// ナビゲーション（nav-list）のリンクを、文字とリンク先の組にする
const parseNavLinks = (html) => [...sliceBlock(html, /<ul class="nav-list"/, '</ul>').matchAll(/<a [^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)]
    .map(([, href, label]) => ({ label: label.trim(), href }));

const listHrefs = (html) => [...html.matchAll(/\shref="([^"]*)"/g)].map(([, href]) => href);

// portal-logic.js の、連絡先の表記を作るブロック（FACILITY_INFO:start〜end）より外の部分
const readPortalLogicOutsideFacilityBlock = () => fs.readFileSync(PORTAL_LOGIC_PATH, 'utf8')
    .replace(/\/\/ FACILITY_INFO:start[\s\S]*?\/\/ FACILITY_INFO:end/, '');
const listIds = (html) => [...html.matchAll(/\sid="([^"]*)"/g)].map(([, id]) => id);

// リンク先のファイル（検索部分 ?〜 は外し、フォルダなら index.html）
const resolveLinkTarget = (href) => {
    const filePath = href.split(/[?#]/)[0];
    return path.join(ROOT_DIR, filePath, filePath.endsWith('/') ? 'index.html' : '');
};

const listFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !SKIP_DIRS.includes(entry.name))
    .flatMap((entry) => entry.isDirectory()
        ? listFiles(path.join(dir, entry.name))
        : [path.relative(ROOT_DIR, path.join(dir, entry.name))]);

test('ポータルのタイトルは施設名入りの公式ホームページになっている（会社名は書かず、JavaScript で差し替える）', () => {
    assert.strictEqual(textOf(readPortal(), /<title>([^<]*)<\/title>/), 'あおぞらセミナーハウス 公式ホームページ｜合宿・スポーツ大会・研修の総合施設');
});

test('固定ヘッダーのナビゲーションに、施設紹介・宿泊・食事・ご利用の流れ・料金シミュレーター・空き状況・Web予約が決められた順に並ぶ', () => {
    assert.deepStrictEqual(parseNavLinks(readPortal()), [
        { label: '施設紹介', href: '#facilities' },
        { label: '宿泊・食事', href: '#stay' },
        { label: 'ご利用の流れ', href: '#flow' },
        { label: '料金シミュレーター', href: './estimate/' },
        { label: '空き状況', href: './schedule/' },
        { label: 'Web予約', href: './reservation/' }
    ]);
});

test('ヘッダーの右端に、職員用スケジュール管理（./schedule/?mode=staff）への控えめな導線がある', () => {
    const html = readPortal();
    const tag = findTagById(html, 'staffLink');
    assert.match(tag, /class="staff-link"/);
    assert.strictEqual(hrefOf(tag), './schedule/?mode=staff');
    assert.match(sliceBlock(html, /<a class="staff-link"/, '</a>'), /職員用スケジュール管理/);
});

test('ヒーローに3つの主要アクション（空き状況・概算見積もり・Web予約）のボタンがある', () => {
    const html = readPortal();
    const actions = [['heroScheduleButton', './schedule/', '空き状況を確認する'], ['heroEstimateButton', './estimate/', '概算見積もりを作る'], ['heroReservationButton', './reservation/', 'Web予約を申し込む']];
    actions.forEach(([id, href, label]) => {
        assert.strictEqual(hrefOf(findTagById(html, id)), href, `${id} のリンク先が違います`);
        assert.match(sliceBlock(html, new RegExp(`id="${id}"`), '</a>'), new RegExp(label));
    });
    assert.match(textOf(html, /<h1 id="heroTitle">([\s\S]*?)<\/h1>/), /チーム/);
});

test('ページ内リンクの行き先（施設紹介・宿泊・食事・ご利用の流れ・アクセス）のセクションがある', () => {
    const ids = listIds(readPortal());
    ['facilities', 'stay', 'flow', 'access'].forEach((id) => assert.ok(ids.includes(id), `id="${id}" のセクションがありません`));
    listHrefs(readPortal()).filter((href) => href.startsWith('#')).forEach((href) => {
        assert.ok(ids.includes(href.slice(1)), `ページ内リンク ${href} の行き先がありません`);
    });
});

test('JavaScript で書き込む場所（施設カード・宿泊の受け入れ条件・宿泊料金・食事・連絡先）がある', () => {
    const html = readPortal();
    ['facilitySections', 'stayHighlights', 'stayPriceRows', 'mealGroups', 'copyright'].forEach((id) => assert.ok(listIds(html).includes(id), `id="${id}" がありません`));
    ['fullName', 'postal', 'address', 'tel', 'copyright', 'organization', 'facilityName'].forEach((key) => {
        assert.match(html, new RegExp(`data-contact="${key}"`), `data-contact="${key}" がありません`);
    });
});

test('ご利用の流れは STEP 1〜3（空き状況確認 → 概算見積もり → Web予約）の順に並ぶ', () => {
    const steps = [...sliceBlock(readPortal(), /<ol class="flow-steps"/, '</ol>').matchAll(/<span class="step-num">([^<]*)<\/span>[\s\S]*?<h3>([^<]*)<\/h3>/g)]
        .map(([, num, title]) => `${num}:${title}`);
    assert.deepStrictEqual(steps, ['STEP 1:空き状況を確認', 'STEP 2:概算見積もり', 'STEP 3:Web予約を申し込む']);
});

test('ツールのカードが3枚、ご利用の流れの順番（スケジュール管理表・見積もり・予約）で並び、すべて公開中のリンクになっている', () => {
    assert.deepStrictEqual(parseToolCards(readPortal()), [
        { title: '空き状況カレンダー', href: './schedule/', isSoon: false },
        { title: '料金シミュレーター（概算見積もり）', href: './estimate/', isSoon: false },
        { title: 'Web予約', href: './reservation/', isSoon: false }
    ]);
});

test('ポータルのリンク先がすべて存在し、URLに日本語を含まない', () => {
    listHrefs(readPortal()).filter((href) => !href.startsWith('#')).forEach((href) => {
        assert.match(href, /^[\x21-\x7e]+$/, `リンク先 ${href} にASCII以外の文字があります`);
        assert.ok(fs.existsSync(resolveLinkTarget(href)), `リンク先 ${href} のファイルがありません`);
    });
});

test('ポータルは facility-config.js → reservation-logic.js → portal-logic.js の順に読み込み、読み込むファイルが存在する', () => {
    const html = readPortal();
    const sources = [...html.matchAll(/<script src="([^"]*)"><\/script>/g)].map(([, src]) => src);
    assert.deepStrictEqual(sources, ['./facility-config.js', './reservation/reservation-logic.js', './portal-logic.js']);
    sources.slice(1).forEach((src) => assert.ok(fs.existsSync(path.join(ROOT_DIR, src)), `${src} がありません`));
});

test('ポータルの HTML と portal-logic.js（FACILITY_INFO ブロックの外）に会社名・住所・電話番号らしい表記が書かれていない', () => {
    [readPortal(), readPortalLogicOutsideFacilityBlock()].forEach((source) => {
        PROPER_NOUN_PATTERNS.forEach((pattern) => {
            assert.doesNotMatch(source, pattern, `${pattern} に当てはまる表記があります`);
        });
    });
});

test('スマホ・タブレット向けのレイアウト（viewport・メディアクエリ・メニューの開閉ボタン）がある', () => {
    const html = readPortal();
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1.0">/);
    assert.match(html, /@media \(max-width: 1020px\)/);
    assert.match(html, /@media \(max-width: 680px\)/);
    assert.match(findTagById(html, 'menuToggle'), /aria-expanded="false"/);
});

test('見積もりツールは estimate/index.html、予約システムは reservation/index.html、スケジュール管理表は schedule/index.html にあり、HTMLのファイル名・フォルダ名に日本語がない', () => {
    assert.ok(fs.existsSync(HTML_PATH), 'estimate/index.html がありません');
    assert.ok(fs.existsSync(RESERVATION_HTML_PATH), 'reservation/index.html がありません');
    assert.ok(fs.existsSync(SCHEDULE_HTML_PATH), 'schedule/index.html がありません');
    const htmlFiles = listFiles(ROOT_DIR).filter((file) => file.endsWith('.html'));
    assert.deepStrictEqual(htmlFiles.filter((file) => !/^[\x21-\x7e]+$/.test(file.replace(/\\/g, '/'))), []);
});

// ---------- ヒーローの背景スライドショー ----------
const Portal = require(PORTAL_LOGIC_PATH);

test('ヒーローに背景写真の層（#heroSlides）とドット（#heroDots）があり、読み込めないときのグラデーション背景も残っている', () => {
    const html = readPortal();
    const hero = sliceBlock(html, /<section class="hero"/, '</section>');
    assert.match(findTagById(hero, 'heroSlides'), /class="hero-slides"[^>]*aria-hidden="true"/);
    assert.match(findTagById(hero, 'heroDots'), /class="hero-dots"[^>]*aria-label="背景写真の切り替え"/);
    assert.match(sliceBlock(html, /\.hero \{/, '}'), /linear-gradient\(135deg, #0b3d66/);
    assert.match(sliceBlock(html, /\.hero-slide::after \{/, '}'), /linear-gradient\(135deg, rgba\(6, 27, 52/);
    assert.match(html, /\.hero-slide\.is-loaded\.is-active \{ opacity: 1; transform: scale\(1\.08\); \}/);
    assert.match(html, /startHeroSlideshow\(Portal\.resolveHeroImages\(Portal\.DEFAULT_HERO_IMAGES, window\.CUSTOM_FACILITY_INFO\?\.heroImages\)\)/);
});

test('既定の背景写真は4枚（陸上競技場・体育館・球技場・研修室）で、すべて https の画像URL、切り替えは5秒ごと', () => {
    assert.strictEqual(Portal.HERO_SLIDE_INTERVAL_MS, 5000);
    assert.deepStrictEqual(Portal.DEFAULT_HERO_IMAGES.map((image) => image.alt),
        ['陸上競技場のトラックを走る選手', '明るい体育館のコートでの競技', '緑の芝生の球技場でのプレー', '清潔な研修室でのセミナー']);
    Portal.DEFAULT_HERO_IMAGES.forEach((image) => assert.match(image.url, /^https:\/\/images\.unsplash\.com\/photo-[\w-]+\?/));
    assert.ok(Object.isFrozen(Portal.DEFAULT_HERO_IMAGES) && Object.isFrozen(Portal.DEFAULT_HERO_IMAGES[0]));
});

test('heroImages に URL の配列を指定すると、その写真に差し替わる（前後の空白は取り、空・文字列以外は除く）', () => {
    const images = Portal.resolveHeroImages(Portal.DEFAULT_HERO_IMAGES, [' ./images/gym.jpg ', '', 123, null, './images/field.jpg']);
    assert.deepStrictEqual(images, [{ url: './images/gym.jpg', alt: '施設の写真 1' }, { url: './images/field.jpg', alt: '施設の写真 2' }]);
});

test('heroImages がない・空の配列・配列でない・有効な URL がないときは、既定の写真のまま', () => {
    [undefined, null, [], '', './images/gym.jpg', ['  ', 0]].forEach((customUrls) => {
        assert.strictEqual(Portal.resolveHeroImages(Portal.DEFAULT_HERO_IMAGES, customUrls), Portal.DEFAULT_HERO_IMAGES, `${JSON.stringify(customUrls)} のとき`);
    });
});

test('次に表示する写真の番号は、最後の次で最初に戻り、写真がなければ 0', () => {
    assert.deepStrictEqual([[0, 4], [2, 4], [3, 4], [0, 1], [0, 0]].map(([current, count]) => Portal.nextSlideIndex(current, count)), [1, 3, 0, 0, 0]);
});

test('前回の切り替えから間隔（5秒）が過ぎたときだけ、次の写真へ切り替える', () => {
    assert.strictEqual(Portal.isSlideDue(1000, 5999, 5000), false);
    assert.strictEqual(Portal.isSlideDue(1000, 6000, 5000), true);
    assert.strictEqual(Portal.isSlideDue(1000, 1000, 0), true);
});

test('背景写真の層とドットの HTML を写真の枚数だけ作り、URL・説明はエスケープする。写真が1枚以下ならドットは出さない', () => {
    const images = [{ url: 'a.jpg?x=1&y="2"', alt: '<体育館>' }, { url: 'b.jpg', alt: '球技場' }];
    assert.strictEqual(Portal.renderHeroSlidesHtml(images),
        '<div class="hero-slide" data-slide-index="0" data-src="a.jpg?x=1&amp;y=&quot;2&quot;"></div><div class="hero-slide" data-slide-index="1" data-src="b.jpg"></div>');
    assert.match(Portal.renderHeroDotsHtml(images), /^<button type="button" class="hero-dot" data-slide-index="0" aria-label="背景写真 1（&lt;体育館&gt;）を表示"><\/button><button [^>]*data-slide-index="1"/);
    assert.strictEqual(Portal.renderHeroDotsHtml(images.slice(0, 1)), '');
    assert.strictEqual(Portal.renderHeroSlidesHtml([]), '');
});

test('CSS の url() に入れる値は、引用符・バックスラッシュをエスケープし、改行を取り除く', () => {
    assert.strictEqual(Portal.toCssUrl('./images/gym.jpg'), 'url("./images/gym.jpg")');
    assert.strictEqual(Portal.toCssUrl('a"b\\c\nd.jpg'), 'url("a\\"b\\\\cd.jpg")');
});
