// トップページのお知らせのデータを扱う純粋関数（news-logic.js）の動作確認テスト
// 実行方法：node --test tests/news-logic.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { NEWS_LOGIC_PATH } = require('./helpers');
const News = require(NEWS_LOGIC_PATH);

const TODAY = '2026-10-20';
const VALID_INPUT = Object.freeze({ date: '2026-11-01', category: 'event', title: '  秋のスポーツ体験会  ', body: '  どなたでも参加できます。\n申し込みは不要です。  ' });
const toPlain = (value) => JSON.parse(JSON.stringify(value));
const item = (id, date, category = 'info') => ({ id, date, category, title: `タイトル${id}`, body: `本文${id}` });

// ---------- 定数・初期サンプル ----------
test('保存キーは facility_dx_news、カテゴリは 重要・ご案内・イベント・休館日 の4つ', () => {
    assert.strictEqual(News.NEWS_STORAGE_KEY, 'facility_dx_news');
    assert.deepStrictEqual(News.NEWS_CATEGORIES.map((category) => `${category.key}:${category.label}`), ['important:重要', 'info:ご案内', 'event:イベント', 'closed:休館日']);
});

test('初期サンプルは3件（重要・ご案内・休館日）で、今日・7日前・14日前の日付になり、すべて入力チェックを通る', () => {
    const samples = News.createSampleNews(TODAY);
    assert.deepStrictEqual(samples.map((sample) => [sample.date, sample.category]), [['2026-10-20', 'important'], ['2026-10-13', 'info'], ['2026-10-06', 'closed']]);
    samples.forEach((sample) => assert.deepStrictEqual(News.validateNewsInput(sample), []));
    assert.strictEqual(new Set(samples.map((sample) => sample.id)).size, 3);
});

test('初期サンプルは月や年をまたいでも正しい日付になる', () => {
    assert.deepStrictEqual(News.createSampleNews('2027-01-03').map((sample) => sample.date), ['2027-01-03', '2026-12-27', '2026-12-20']);
});

// ---------- 日付・カテゴリ ----------
test('isValidDateString は YYYY-MM-DD の実在する日付だけ true（うるう年も判定する）', () => {
    ['2026-10-20', '2028-02-29'].forEach((text) => assert.strictEqual(News.isValidDateString(text), true, text));
    ['2026-02-30', '2027-02-29', '2026-13-01', '2026/10/20', '2026-1-2', '', null, 20261020].forEach((text) => assert.strictEqual(News.isValidDateString(text), false, String(text)));
});

test('formatNewsDate は "2026.10.20" の形にし、カテゴリ名は key から引ける（知らない key は空）', () => {
    assert.strictEqual(News.formatNewsDate('2026-10-20'), '2026.10.20');
    assert.strictEqual(News.findCategoryLabel('closed'), '休館日');
    assert.strictEqual(News.findCategoryLabel('unknown'), '');
});

// ---------- 入力チェック ----------
test('validateNewsInput は、正しい入力なら空の配列を返す（前後の空白は数えない）', () => {
    assert.deepStrictEqual(News.validateNewsInput(VALID_INPUT), []);
});

test('validateNewsInput は、空の入力・null なら日付・カテゴリ・タイトル・本文のすべての誤りを返す', () => {
    const expected = ['日付を正しく入力してください', 'カテゴリを選んでください', 'タイトルを入力してください', '本文を入力してください'];
    assert.deepStrictEqual(News.validateNewsInput({}), expected);
    assert.deepStrictEqual(News.validateNewsInput(null), expected);
    assert.deepStrictEqual(News.validateNewsInput({ ...VALID_INPUT, title: '   ', body: '\n' }), ['タイトルを入力してください', '本文を入力してください']);
});

test('validateNewsInput は、タイトル60文字・本文1000文字までを受け付け、1文字でも超えると誤りにする', () => {
    assert.deepStrictEqual(News.validateNewsInput({ ...VALID_INPUT, title: 'あ'.repeat(60), body: 'い'.repeat(1000) }), []);
    assert.deepStrictEqual(News.validateNewsInput({ ...VALID_INPUT, title: 'あ'.repeat(61), body: 'い'.repeat(1001) }),
        ['タイトルは60文字以内にしてください', '本文は1000文字以内にしてください']);
});

// ---------- 並べ替え・追加・編集・削除 ----------
test('sortNewsByDateDesc は日付の新しい順（同じ日付なら番号の大きい順）に並べ、元の配列は変えない', () => {
    const list = Object.freeze([item('news-2', '2026-10-01'), item('news-10', '2026-10-01'), item('news-1', '2026-10-15')]);
    assert.deepStrictEqual(News.sortNewsByDateDesc(list).map((news) => news.id), ['news-1', 'news-10', 'news-2']);
    assert.deepStrictEqual(list.map((news) => news.id), ['news-2', 'news-10', 'news-1']);
    assert.deepStrictEqual(News.sortNewsByDateDesc([]), []);
});

test('createNewsId は "news-番号" の一番大きい番号の次を返す（空なら news-1、サンプルの id は数えない）', () => {
    assert.strictEqual(News.createNewsId([]), 'news-1');
    assert.strictEqual(News.createNewsId(News.createSampleNews(TODAY)), 'news-1');
    assert.strictEqual(News.createNewsId([item('news-3', TODAY), item('news-12', TODAY), item('custom', TODAY)]), 'news-13');
});

test('addNewsItem は新しい id で追加し、前後の空白を取り、日付の新しい順に並べ直す（元の配列は変えない）', () => {
    const list = Object.freeze(News.createSampleNews(TODAY));
    const added = News.addNewsItem(list, VALID_INPUT);
    assert.deepStrictEqual(toPlain(added[0]), { id: 'news-1', date: '2026-11-01', category: 'event', title: '秋のスポーツ体験会', body: 'どなたでも参加できます。\n申し込みは不要です。' });
    assert.strictEqual(added.length, 4);
    assert.strictEqual(list.length, 3);
});

test('updateNewsItem は指定した id のお知らせだけを書き換えて並べ直し、ない id なら内容は変わらない', () => {
    const list = Object.freeze(News.createSampleNews(TODAY));
    const updated = News.updateNewsItem(list, 'sample-3', { ...VALID_INPUT, category: 'closed' });
    assert.deepStrictEqual(updated.map((news) => news.id), ['sample-3', 'sample-1', 'sample-2']);
    assert.deepStrictEqual([updated[0].date, updated[0].category, updated[0].title], ['2026-11-01', 'closed', '秋のスポーツ体験会']);
    assert.deepStrictEqual(toPlain(News.updateNewsItem(list, 'none', VALID_INPUT)), toPlain(list));
});

test('removeNewsItem は指定した id だけを消し、findNewsItem は見つからなければ null を返す', () => {
    const list = Object.freeze(News.createSampleNews(TODAY));
    assert.deepStrictEqual(News.removeNewsItem(list, 'sample-2').map((news) => news.id), ['sample-1', 'sample-3']);
    assert.strictEqual(News.removeNewsItem(list, 'none').length, 3);
    assert.deepStrictEqual(News.removeNewsItem([], 'sample-1'), []);
    assert.strictEqual(News.findNewsItem(list, 'sample-2').title, '合宿向けのお弁当メニューを新しくしました');
    assert.strictEqual(News.findNewsItem(list, 'none'), null);
});

// ---------- 整形・保存・読み込み ----------
test('normalizeNewsList は、正しくないもの・id の重複を除き、id がない・使えない文字なら番号から作る', () => {
    const rawList = [item('a-1', TODAY), { ...item('', TODAY), id: '<b>' }, item('a-1', TODAY), { ...item('x', 'bad-date') }, null, 'text'];
    assert.deepStrictEqual(News.normalizeNewsList(rawList).map((news) => news.id), ['a-1', 'news-2']);
    assert.deepStrictEqual(News.normalizeNewsList('not array'), []);
    assert.deepStrictEqual(News.normalizeNewsList(undefined), []);
});

test('serializeNews で保存した文字列は parseStoredNews で同じ一覧に戻り、空の一覧も [] として戻る', () => {
    const list = News.createSampleNews(TODAY);
    assert.deepStrictEqual(News.parseStoredNews(News.serializeNews(list)), list);
    assert.deepStrictEqual(News.parseStoredNews(News.serializeNews([])), []);
});

test('parseStoredNews は、保存がない・壊れている・種類が違うときは null を返す', () => {
    [null, '', '{壊れた', '[]', JSON.stringify({ type: 'other', items: [] }), JSON.stringify({ type: 'facility_dx_news', items: {} })]
        .forEach((text) => assert.strictEqual(News.parseStoredNews(text), null, String(text)));
});

test('resolveNewsList は、保存があればそれ（空なら空）、なければ CUSTOM_FACILITY_INFO.news、それもなければサンプルを新しい順で返す', () => {
    const custom = [item('c-1', '2026-09-01'), item('c-2', '2026-09-30', 'important')];
    const stored = News.serializeNews([item('s-1', '2026-01-01')]);
    assert.deepStrictEqual(News.resolveNewsList(stored, custom, TODAY).map((news) => news.id), ['s-1']);
    assert.deepStrictEqual(News.resolveNewsList(News.serializeNews([]), custom, TODAY), []);
    assert.deepStrictEqual(News.resolveNewsList(null, custom, TODAY).map((news) => news.id), ['c-2', 'c-1']);
    assert.deepStrictEqual(News.resolveNewsList(null, [{ title: '不完全' }], TODAY).map((news) => news.id), ['sample-1', 'sample-2', 'sample-3']);
    assert.deepStrictEqual(News.resolveNewsList('{壊れた', undefined, TODAY).length, 3);
});

// ---------- トップページの HTML ----------
test('renderNewsListHtml は、日付・カテゴリのバッジ・タイトル・開いて読む本文を新しい順に limit 件まで作る', () => {
    const html = News.renderNewsListHtml(News.createSampleNews(TODAY), 2);
    assert.strictEqual((html.match(/<li class="news-item"/g) || []).length, 2);
    assert.match(html, /^<li class="news-item" data-news-id="sample-1" data-news-category="important"><details class="news-details"><summary class="news-summary"><time class="news-date" datetime="2026-10-20">2026\.10\.20<\/time><span class="news-badge" data-news-category="important">重要<\/span>/);
    assert.match(html, /<div class="news-body">空き状況の確認から[^<]*<br>お電話/);
    assert.doesNotMatch(html, /<button|編集|削除/, 'トップページ用の HTML に編集の操作を出さない');
});

test('renderNewsListHtml は、お知らせがなければ「お知らせはありません」を出し、文字はすべてエスケープする', () => {
    assert.strictEqual(News.renderNewsListHtml([], 5), '<li class="news-empty">現在、お知らせはありません。</li>');
    const html = News.renderNewsListHtml([{ id: 'x', date: TODAY, category: 'info', title: '<script>alert(1)</script>', body: '"A" & \'B\'' }], 5);
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && html.includes('&quot;A&quot; &amp; &#39;B&#39;'));
    assert.doesNotMatch(html, /<script>/);
});

// ---------- ファイルの中身 ----------
test('news-logic.js は let・var を使わず、会社名・住所・電話番号らしい表記を含まない', () => {
    const source = fs.readFileSync(NEWS_LOGIC_PATH, 'utf8');
    assert.doesNotMatch(source, /\b(let|var)\s/);
    [/〒/, /TEL\s*\d/, /\d{2,4}-\d{2,4}-\d{3,4}/, /株式会社|協会|財団/, /[都道府県][^\s<'"`]*[市区町村]/].forEach((pattern) => assert.doesNotMatch(source, pattern, String(pattern)));
});
