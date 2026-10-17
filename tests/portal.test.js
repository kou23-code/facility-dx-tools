// ポータル画面（index.html）とフォルダ構成の動作確認テスト
// 実行方法：node --test tests/portal.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT_DIR, HTML_PATH, PORTAL_PATH, RESERVATION_HTML_PATH, SCHEDULE_HTML_PATH } = require('./helpers');

const PORTAL_TITLE = 'あおぞらセミナーハウス 業務DXツール集';
const SKIP_DIRS = ['.git', 'node_modules'];

// 会社名・住所・電話番号らしい表記（ポータルには書かない）
const PROPER_NOUN_PATTERNS = [/〒/, /TEL\s*\d/, /\d{2,4}-\d{2,4}-\d{3,4}/, /株式会社|協会|財団/, /[都道府県][^\s<'"`]*[市区町村]/];

// HTML コメントは表示されないので、確認の対象から外す
const removeComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

const readPortal = () => removeComments(fs.readFileSync(PORTAL_PATH, 'utf8'));

const textOf = (html, pattern) => (pattern.exec(html) || [])[1];

// <li> ごとに、見出し・リンク先・準備中かどうかを取り出す
const parseCards = (html) => [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(([, card]) => ({
    title: textOf(card, /<h2>([^<]*)<\/h2>/),
    href: textOf(card, /<a [^>]*href="([^"]*)"/) || null,
    isSoon: card.includes('is-soon') && card.includes('準備中')
}));

const listHrefs = (html) => [...html.matchAll(/href="([^"]*)"/g)].map(([, href]) => href);

const resolveLinkTarget = (href) => path.join(ROOT_DIR, href, href.endsWith('/') ? 'index.html' : '');

const listFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !SKIP_DIRS.includes(entry.name))
    .flatMap((entry) => entry.isDirectory()
        ? listFiles(path.join(dir, entry.name))
        : [path.relative(ROOT_DIR, path.join(dir, entry.name))]);

test('ポータルのタイトルと見出しが「あおぞらセミナーハウス 業務DXツール集」になっている', () => {
    const html = readPortal();
    assert.strictEqual(textOf(html, /<title>([^<]*)<\/title>/), PORTAL_TITLE);
    assert.strictEqual(textOf(html, /<h1>([^<]*)<\/h1>/), PORTAL_TITLE);
});

test('ツールのカードが3枚、決められた順番と状態で並んでいる（見積もり・予約・スケジュール管理表は公開中）', () => {
    assert.deepStrictEqual(parseCards(readPortal()), [
        { title: '概算見積もりシステム', href: 'estimate/', isSoon: false },
        { title: 'Web予約システム', href: 'reservation/', isSoon: false },
        { title: 'スケジュール管理表', href: 'schedule/', isSoon: false }
    ]);
});

test('ポータルのリンク先がすべて存在し、URLに日本語を含まない', () => {
    listHrefs(readPortal()).forEach((href) => {
        assert.match(href, /^[\x21-\x7e]+$/, `リンク先 ${href} にASCII以外の文字があります`);
        assert.ok(fs.existsSync(resolveLinkTarget(href)), `リンク先 ${href} のファイルがありません`);
    });
});

test('ポータルに会社名・住所・電話番号らしい表記が書かれていない', () => {
    const html = readPortal();
    PROPER_NOUN_PATTERNS.forEach((pattern) => {
        assert.doesNotMatch(html, pattern, `ポータルに ${pattern} に当てはまる表記があります`);
    });
});

test('見積もりツールは estimate/index.html、予約システムは reservation/index.html、スケジュール管理表は schedule/index.html にあり、HTMLのファイル名・フォルダ名に日本語がない', () => {
    assert.ok(fs.existsSync(HTML_PATH), 'estimate/index.html がありません');
    assert.ok(fs.existsSync(RESERVATION_HTML_PATH), 'reservation/index.html がありません');
    assert.ok(fs.existsSync(SCHEDULE_HTML_PATH), 'schedule/index.html がありません');
    const htmlFiles = listFiles(ROOT_DIR).filter((file) => file.endsWith('.html'));
    assert.deepStrictEqual(htmlFiles.filter((file) => !/^[\x21-\x7e]+$/.test(file.replace(/\\/g, '/'))), []);
});
