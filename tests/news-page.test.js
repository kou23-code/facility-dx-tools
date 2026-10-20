// お知らせ一覧・詳細ページ（news/index.html）の動作確認テスト
// 実行方法：node --test tests/news-page.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ROOT_DIR, NEWS_LOGIC_PATH, RESERVATION_LOGIC_PATH, BROWSER_CANDIDATES, findBrowser, renderDom, findById } = require('./helpers');

const BROWSER = findBrowser(BROWSER_CANDIDATES);
const NEWS_PAGE_PATH = path.join(ROOT_DIR, 'news', 'index.html');
const readPage = () => fs.readFileSync(NEWS_PAGE_PATH, 'utf8');
const removeComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');
const readInlineScript = (html) => /<script>([\s\S]*?)<\/script>/.exec(html)[1];
const listHrefs = (html) => [...html.matchAll(/\shref="([^"]*)"/g)].map(([, href]) => href);

// ---------- ファイルの中身 ----------
test('お知らせページは facility-config.js → reservation-logic.js → portal-logic.js → news-logic.js の順に ../ から読み込み、let・var を使っていない', () => {
    const html = readPage();
    const sources = [...html.matchAll(/<script src="([^"]*)"><\/script>/g)].map(([, src]) => src);
    assert.deepStrictEqual(sources, ['../facility-config.js', '../reservation/reservation-logic.js', '../portal-logic.js', '../news-logic.js']);
    assert.doesNotMatch(readInlineScript(html), /\b(let|var)\s/);
});

test('お知らせページは、トップページと同じヘッダー・フッター・配色の変数を持ち、絞り込み・記事・画像の拡大表示の場所がある', () => {
    const html = readPage();
    ['siteHeader', 'menuToggle', 'globalNav', 'newsPage', 'newsFilters', 'newsCards', 'imageModal', 'imageModalClose', 'copyright'].forEach((id) => assert.match(html, new RegExp(`id="${id}"`), id));
    ['--sky: #38bdf8', '--mint: #34d3a6', '--accent: #ff9f1c', '--primary: #0a74b8'].forEach((value) => assert.ok(html.includes(value), value));
    assert.match(html, /<dialog class="image-modal" id="imageModal"/);
});

test('お知らせページは一般の利用者向けなので、編集の操作（入力欄・編集/削除・保存）がない', () => {
    const html = removeComments(readPage());
    assert.doesNotMatch(html, /<input|<textarea|<form|編集|削除/);
    assert.doesNotMatch(html, /localStorage\.(setItem|removeItem)/);
});

test('お知らせページのリンク先はすべて存在し、URL に日本語を含まず、会社名・住所・電話番号らしい表記がない', () => {
    const html = removeComments(readPage());
    listHrefs(html).forEach((href) => {
        assert.match(href, /^[\x21-\x7e]+$/, href);
        assert.ok(fs.existsSync(path.join(ROOT_DIR, 'news', href.split('#')[0])), `${href} がありません`);
    });
    [/〒/, /TEL\s*\d/, /\d{2,4}-\d{2,4}-\d{3,4}/, /株式会社|協会|財団/, /[都道府県][^\s<'"`]*[市区町村]/].forEach((pattern) => assert.doesNotMatch(html, pattern, String(pattern)));
});

// ---------- 画面の動作 ----------
// 画面の状態を書き出し、操作するスクリプト（ページの最後に足す）
const CAPTURE_SCRIPT = `<script>
window.addEventListener('load', () => {
    const capture = () => ({
        filters: Array.from(document.querySelectorAll('#newsFilters .filter-button'), (button) => button.textContent + ':' + button.getAttribute('aria-pressed')),
        cards: Array.from(document.querySelectorAll('#newsCards .news-card'), (card) => card.id),
        targets: Array.from(document.querySelectorAll('.news-card.is-target'), (card) => card.id),
        images: Array.from(document.querySelectorAll('.news-image-button img'), (image) => image.getAttribute('src') + '|' + image.alt),
        files: Array.from(document.querySelectorAll('a.file-button'), (link) => [link.dataset.fileType, link.getAttribute('href'), link.getAttribute('download'), link.textContent].join('|')),
        attachBadges: Array.from(document.querySelectorAll('#newsCards .news-attach'), (badge) => badge.textContent),
        modalOpen: document.getElementById('imageModal').open,
        modalImage: document.getElementById('imageModalImage').getAttribute('src'),
        title: document.title,
        facilityName: document.querySelector('[data-contact="facilityName"]').textContent
    });
    const states = [capture()];
    document.querySelector('.filter-button[data-filter="closed"]').click();
    states.push(capture());
    document.querySelector('.filter-button[data-filter="all"]').click();
    const imageButton = document.querySelector('.news-image-button');
    if (imageButton) imageButton.click();
    states.push(capture());
    const dump = document.createElement('div');
    dump.id = 'test_dump';
    dump.textContent = encodeURIComponent(JSON.stringify(states));
    document.body.appendChild(dump);
});
</script>`;

// 本番と同じフォルダ構成（news/・reservation/・files/）で一時フォルダにコピーして開く
const renderNewsPageStates = (configSource, hash) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'news-page-test-'));
    ['news', 'reservation', 'files'].forEach((folder) => fs.mkdirSync(path.join(dir, folder)));
    fs.writeFileSync(path.join(dir, 'news', 'index.html'), readPage().replace('</body>', `${CAPTURE_SCRIPT}\n</body>`), 'utf8');
    fs.copyFileSync(RESERVATION_LOGIC_PATH, path.join(dir, 'reservation', 'reservation-logic.js'));
    [['portal-logic.js', 'portal-logic.js'], [NEWS_LOGIC_PATH, 'news-logic.js']].forEach(([source, name]) => fs.copyFileSync(path.isAbsolute(source) ? source : path.join(ROOT_DIR, source), path.join(dir, name)));
    fs.readdirSync(path.join(ROOT_DIR, 'files')).forEach((name) => fs.copyFileSync(path.join(ROOT_DIR, 'files', name), path.join(dir, 'files', name)));
    if (configSource) fs.writeFileSync(path.join(dir, 'facility-config.js'), configSource, 'utf8');
    return JSON.parse(decodeURIComponent(findById(renderDom(BROWSER, path.join(dir, 'news', 'index.html'), hash), 'test_dump')));
};

test('画面：初期サンプル6件が新しい順に並び、絞り込み・画像の拡大表示・資料のボタン・#news-<id> での記事の指定ができる', { skip: !BROWSER }, () => {
    const [initial, closedOnly, zoomed] = renderNewsPageStates(null, '#news-sample-5');
    assert.deepStrictEqual(initial.filters, ['すべて6:true', '重要1:false', 'ご案内3:false', 'イベント1:false', '休館日1:false']);
    assert.deepStrictEqual(initial.cards, ['news-sample-1', 'news-sample-4', 'news-sample-2', 'news-sample-5', 'news-sample-3', 'news-sample-6']);
    assert.deepStrictEqual(initial.targets, ['news-sample-5'], 'URL のハッシュの記事が強調される');
    assert.deepStrictEqual(initial.images, ['../files/sample-flyer.svg|秋のスポーツ体験会のチラシ']);
    assert.deepStrictEqual(initial.files, [
        'pdf|../files/riyou-youkou.pdf|施設利用要項.pdf|📄PDFを開く・ダウンロード施設利用要項.pdf',
        'excel|../files/meibo.xlsx|宿泊者名簿.xlsx|📗Excelファイルをダウンロード宿泊者名簿.xlsx',
        'word|../files/moushikomi.docx|施設利用申込書.docx|📘Wordファイルをダウンロード施設利用申込書.docx'
    ]);
    assert.deepStrictEqual(initial.attachBadges, ['📄PDF', '🖼️画像', '📗Excel', '📘Word']);
    assert.deepStrictEqual([initial.title, initial.facilityName, initial.modalOpen], ['お知らせ一覧｜あおぞらセミナーハウス', 'あおぞらセミナーハウス', false]);
    assert.deepStrictEqual([closedOnly.cards, closedOnly.filters[4]], [['news-sample-3'], '休館日1:true']);
    assert.deepStrictEqual([zoomed.cards.length, zoomed.modalOpen, zoomed.modalImage], [6, true, '../files/sample-flyer.svg']);
});

test('画面：facility-config.js の施設名と news（旧形式の pdfUrl を含む）で表示する', { skip: !BROWSER }, () => {
    const news = [{ id: 'old', date: '2026-04-01', category: 'important', title: '旧形式の資料', body: '本文', pdfUrl: './files/riyou-youkou.pdf' }];
    const [initial] = renderNewsPageStates(`window.CUSTOM_FACILITY_INFO = ${JSON.stringify({ facilityName: 'みどり研修センター', news })};`, '');
    assert.deepStrictEqual([initial.title, initial.facilityName, initial.cards, initial.targets], ['お知らせ一覧｜みどり研修センター', 'みどり研修センター', ['news-old'], []]);
    assert.deepStrictEqual(initial.files, ['pdf|../files/riyou-youkou.pdf|riyou-youkou.pdf|📄PDFを開く・ダウンロードriyou-youkou.pdf']);
});
