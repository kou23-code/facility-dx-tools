// お知らせのデータを扱う純粋関数（news-logic.js）の動作確認テスト
// 実行方法：node --test tests/news-logic.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT_DIR, NEWS_LOGIC_PATH } = require('./helpers');
const News = require(NEWS_LOGIC_PATH);

const TODAY = '2026-10-20';
const VALID_INPUT = Object.freeze({ date: '2026-11-01', category: 'event', title: '  秋のスポーツ体験会  ', body: '  どなたでも参加できます。\n申し込みは不要です。  ' });
const NO_ATTACHMENT = Object.freeze({ imageUrl: '', imageName: '', fileUrl: '', fileName: '', fileType: '' });
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const toPlain = (value) => JSON.parse(JSON.stringify(value));
const item = (id, date, category = 'info') => ({ id, date, category, title: `タイトル${id}`, body: `本文${id}` });
const SAMPLE_IDS_BY_DATE = ['sample-1', 'sample-4', 'sample-2', 'sample-5', 'sample-3', 'sample-6'];

// ---------- 定数・初期サンプル ----------
test('保存キーは facility_dx_news、カテゴリは 重要・ご案内・イベント・休館日、添付資料の種類は PDF・Word・Excel', () => {
    assert.strictEqual(News.NEWS_STORAGE_KEY, 'facility_dx_news');
    assert.deepStrictEqual(News.NEWS_CATEGORIES.map((category) => `${category.key}:${category.label}`), ['important:重要', 'info:ご案内', 'event:イベント', 'closed:休館日']);
    assert.deepStrictEqual(News.FILE_TYPES.map((type) => `${type.key}:${type.icon}${type.label}:${type.extensions.join('/')}`), ['pdf:📄PDF:pdf', 'word:📘Word:doc/docx', 'excel:📗Excel:xls/xlsx']);
});

test('初期サンプルは6件（重要・ご案内・休館日・イベント・ご案内・ご案内）で、すべて入力チェックを通る', () => {
    const samples = News.createSampleNews(TODAY);
    assert.deepStrictEqual(samples.map((sample) => `${sample.id}:${sample.category}:${sample.date}`), [
        'sample-1:important:2026-10-20', 'sample-2:info:2026-10-13', 'sample-3:closed:2026-10-06',
        'sample-4:event:2026-10-17', 'sample-5:info:2026-10-10', 'sample-6:info:2026-09-29'
    ]);
    samples.forEach((sample) => assert.deepStrictEqual(News.validateNewsInput(sample), [], sample.id));
});

test('初期サンプルには、チラシ画像・利用要項PDF・宿泊者名簿Excel・利用申込書Word の付いた記事があり、そのファイルが files/ にある', () => {
    const byId = Object.fromEntries(News.createSampleNews(TODAY).map((sample) => [sample.id, sample]));
    assert.deepStrictEqual([byId['sample-4'].imageUrl, byId['sample-4'].imageName], ['./files/sample-flyer.svg', '秋のスポーツ体験会のチラシ']);
    assert.deepStrictEqual(['sample-1', 'sample-5', 'sample-6'].map((id) => `${byId[id].fileType}:${byId[id].fileName}:${byId[id].fileUrl}`), [
        'pdf:施設利用要項.pdf:./files/riyou-youkou.pdf', 'excel:宿泊者名簿.xlsx:./files/meibo.xlsx', 'word:施設利用申込書.docx:./files/moushikomi.docx'
    ]);
    assert.deepStrictEqual(toPlain({ ...byId['sample-2'], id: undefined, date: undefined, category: undefined, title: undefined, body: undefined }), NO_ATTACHMENT);
    ['sample-flyer.svg', 'riyou-youkou.pdf', 'meibo.xlsx', 'moushikomi.docx'].forEach((name) => assert.ok(fs.existsSync(path.join(ROOT_DIR, 'files', name)), name));
});

test('初期サンプルは月や年をまたいでも正しい日付になる', () => {
    assert.deepStrictEqual(News.createSampleNews('2027-01-03').map((sample) => sample.date), ['2027-01-03', '2026-12-27', '2026-12-20', '2026-12-31', '2026-12-24', '2026-12-13']);
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

// ---------- 添付資料の種類の自動判別 ----------
test('extractExtension は拡張子を小文字で返し、? や # より後ろは見ない（なければ空）', () => {
    assert.deepStrictEqual(['名簿.XLSX', './files/a.pdf?v=2#page=3', 'https://example.com/doc', '', undefined, PNG_DATA_URL].map(News.extractExtension), ['xlsx', 'pdf', '', '', '', '']);
});

test('detectFileType は .pdf .doc .docx .xls .xlsx の拡張子から PDF・Word・Excel を判別する', () => {
    const typeOf = (fileName) => News.detectFileType({ fileName });
    assert.deepStrictEqual(['要項.pdf', '申込書.doc', '申込書.docx', '名簿.xls', '名簿.xlsx'].map(typeOf), ['pdf', 'word', 'word', 'excel', 'excel']);
    assert.deepStrictEqual(['写真.jpg', 'メモ.txt', '圧縮.zip', '拡張子なし', ''].map(typeOf), ['', '', '', '', '']);
});

test('detectFileType は、ファイル名 → URL の拡張子 → MIME タイプ（DataURL の MIME を含む）の順に見る', () => {
    assert.strictEqual(News.detectFileType({ fileName: '名簿.xlsx', fileUrl: './files/a.pdf' }), 'excel');
    assert.strictEqual(News.detectFileType({ fileName: '名簿', fileUrl: './files/a.pdf' }), 'pdf');
    assert.strictEqual(News.detectFileType({ fileUrl: 'https://example.com/get?id=1', mimeType: 'application/msword' }), 'word');
    assert.strictEqual(News.detectFileType({ fileUrl: `data:${XLSX_MIME};base64,UEsDBA==` }), 'excel');
    assert.strictEqual(News.detectFileType({ fileUrl: 'data:application/octet-stream;base64,UEsDBA==' }), '');
});

test('normalizeFileDataUrl は、読み込んだ DataURL の MIME をファイルの拡張子に合わせる（知らない拡張子ならそのまま）', () => {
    assert.strictEqual(News.normalizeFileDataUrl('data:application/octet-stream;base64,UEsDBA==', '名簿.xlsx'), `data:${XLSX_MIME};base64,UEsDBA==`);
    assert.strictEqual(News.normalizeFileDataUrl('data:;base64,0M8R', '申込書.doc'), 'data:application/msword;base64,0M8R');
    assert.strictEqual(News.normalizeFileDataUrl('data:text/plain;base64,QQ==', 'memo.txt'), 'data:text/plain;base64,QQ==');
});

// ---------- URL のチェックと表示用の URL ----------
test('画像・添付資料の場所は、http(s) の URL・英数字の相対パス・DataURL を受け付け、危ない書き方は受け付けない', () => {
    ['https://example.com/a.jpg', './files/flyer.jpg', 'files/a%20b.png', '/files/a.png', PNG_DATA_URL].forEach((url) => assert.strictEqual(News.isValidImageUrl(url), true, url));
    ['javascript:alert(1)', '../secret.png', './files/../../x.png', '//evil.example/a.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PGI+', './ファイル.png', 'https://example.com/a b.png', 'https://example.com/"onerror="x']
        .forEach((url) => assert.strictEqual(News.isValidImageUrl(url), false, url));
    assert.strictEqual(News.isValidFileUrl(`data:${XLSX_MIME};base64,UEsDBA==`), true);
    assert.strictEqual(News.isValidFileUrl('data:application/pdf,not-base64'), false);
    assert.strictEqual(News.isValidFileUrl('javascript:alert(1)'), false);
});

test('resolveNewsAssetUrl は、ルートからの相対パスにページの位置（./ や ../）を付け、URL・DataURL・空はそのまま返す', () => {
    assert.strictEqual(News.resolveNewsAssetUrl('./files/meibo.xlsx', '../'), '../files/meibo.xlsx');
    assert.strictEqual(News.resolveNewsAssetUrl('files/meibo.xlsx', './'), './files/meibo.xlsx');
    ['https://example.com/a.pdf', PNG_DATA_URL, '/files/a.pdf', ''].forEach((url) => assert.strictEqual(News.resolveNewsAssetUrl(url, '../'), url));
});

// ---------- 選んだファイルのチェック・画像の軽量化 ----------
test('checkAttachmentFile は、PDF・Word・Excel で2MBまでのファイルを受け付ける（ちょうど2MBは可、1バイト超えると不可）', () => {
    assert.deepStrictEqual(News.checkAttachmentFile({ name: '名簿.xlsx', type: '', size: News.FILE_MAX_BYTES }), []);
    assert.deepStrictEqual(News.checkAttachmentFile({ name: 'download', type: 'application/pdf', size: 0 }), []);
    assert.deepStrictEqual(News.checkAttachmentFile({ name: '写真.jpg', type: 'image/jpeg', size: News.FILE_MAX_BYTES + 1 }), [
        'PDF・Word・Excel（.pdf .doc .docx .xls .xlsx）のファイルを選んでください', 'ファイルの容量が大きすぎます（2.0MBまで。選んだファイルは2.0MB）'
    ]);
});

test('checkImageFile は画像ファイルだけを受け付け、15MBを超えると不可。formatBytes は KB・MB で表す', () => {
    assert.deepStrictEqual(News.checkImageFile({ type: 'image/png', size: News.IMAGE_SOURCE_MAX_BYTES }), []);
    assert.strictEqual(News.checkImageFile({ type: 'application/pdf', size: News.IMAGE_SOURCE_MAX_BYTES + 1 }).length, 2);
    assert.deepStrictEqual([0, 1, 1024, 1025, 1536 * 1024].map(News.formatBytes), ['1KB', '1KB', '1KB', '2KB', '1.5MB']);
});

test('calculateResizedSize は縦横比を保って長い辺を上限以下にし、小さい画像は拡大しない', () => {
    assert.deepStrictEqual(News.calculateResizedSize(4000, 3000, 1280), { width: 1280, height: 960 });
    assert.deepStrictEqual(News.calculateResizedSize(1000, 2560, 1280), { width: 500, height: 1280 });
    assert.deepStrictEqual(News.calculateResizedSize(640, 480, 1280), { width: 640, height: 480 });
    assert.deepStrictEqual(News.calculateResizedSize(0, 0, 1280), { width: 1, height: 1 });
});

// ---------- 入力チェック ----------
test('validateNewsInput は、正しい入力なら空の配列を返す（前後の空白は数えない。画像・添付資料はなくてよい）', () => {
    assert.deepStrictEqual(News.validateNewsInput(VALID_INPUT), []);
    assert.deepStrictEqual(News.validateNewsInput({ ...VALID_INPUT, imageUrl: PNG_DATA_URL, fileUrl: './files/meibo.xlsx' }), []);
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

test('validateNewsInput は、画像・添付資料の場所が正しくない、資料の種類が PDF・Word・Excel でないときに誤りを返す', () => {
    assert.match(News.validateNewsInput({ ...VALID_INPUT, imageUrl: 'javascript:alert(1)' })[0], /^画像の場所が正しくありません/);
    assert.match(News.validateNewsInput({ ...VALID_INPUT, fileUrl: '../x.pdf' })[0], /^添付資料の場所が正しくありません/);
    assert.deepStrictEqual(News.validateNewsInput({ ...VALID_INPUT, fileUrl: './files/memo.txt' }), ['添付資料は PDF・Word・Excel（.pdf .doc .docx .xls .xlsx）のファイルだけ掲載できます']);
    assert.deepStrictEqual(News.validateNewsInput({ ...VALID_INPUT, fileUrl: 'https://example.com/get?id=1', fileType: 'excel' }), []);
});

test('validateNewsInput は、画像・添付資料の容量の上限（DataURL の文字数）と、説明・ファイル名の100文字を確かめる', () => {
    const bigImage = `data:image/jpeg;base64,${'A'.repeat(News.IMAGE_DATA_URL_MAX_LENGTH)}`;
    const bigFile = `data:application/pdf;base64,${'A'.repeat(News.FILE_DATA_URL_MAX_LENGTH)}`;
    assert.deepStrictEqual(News.validateNewsInput({ ...VALID_INPUT, imageUrl: bigImage }), ['画像の容量が大きすぎます。小さい画像を選んでください']);
    assert.deepStrictEqual(News.validateNewsInput({ ...VALID_INPUT, fileUrl: bigFile }), ['添付資料の容量が大きすぎます（2.0MBまで）']);
    assert.strictEqual(News.validateNewsInput({ ...VALID_INPUT, imageUrl: PNG_DATA_URL, imageName: 'あ'.repeat(100), fileUrl: 'a.pdf', fileName: 'い'.repeat(100) }).length, 0);
    assert.strictEqual(News.validateNewsInput({ ...VALID_INPUT, imageUrl: PNG_DATA_URL, imageName: 'あ'.repeat(101), fileUrl: 'a.pdf', fileName: 'い'.repeat(101) }).length, 2);
});

// ---------- 添付資料の項目の整形（旧形式の pdfUrl の互換） ----------
test('旧形式の pdfUrl だけのお知らせは、fileUrl・PDF・ファイル名（URL の最後の部分）に読み替える', () => {
    const [news] = News.normalizeNewsList([{ ...VALID_INPUT, pdfUrl: './files/old-guide.pdf' }]);
    assert.deepStrictEqual([news.fileUrl, news.fileType, news.fileName], ['./files/old-guide.pdf', 'pdf', 'old-guide.pdf']);
    const [noExtension] = News.normalizeNewsList([{ ...VALID_INPUT, pdfUrl: 'https://example.com/download?id=7' }]);
    assert.deepStrictEqual([noExtension.fileType, noExtension.fileName], ['pdf', '添付資料.pdf']);
    assert.strictEqual(News.normalizeNewsList([{ ...VALID_INPUT, fileUrl: './files/a.docx', pdfUrl: './files/b.pdf' }])[0].fileType, 'word');
});

test('fileType の指定が正しくなければ自動判別し、画像がなければ画像の説明は空にする', () => {
    const [news] = News.normalizeNewsList([{ ...VALID_INPUT, fileUrl: './files/meibo.xlsx', fileType: 'zip', imageName: '説明だけ' }]);
    assert.deepStrictEqual([news.fileType, news.fileName, news.imageUrl, news.imageName], ['excel', 'meibo.xlsx', '', '']);
});

test('buildDownloadName は、ファイル名の拡張子が種類と合わなければ付け足し、buildDefaultFileName は DataURL なら「添付資料.拡張子」', () => {
    assert.deepStrictEqual([News.buildDownloadName('宿泊者名簿', 'excel'), News.buildDownloadName('名簿.XLS', 'excel'), News.buildDownloadName('要項.pdf', 'word')], ['宿泊者名簿.xlsx', '名簿.XLS', '要項.pdf.docx']);
    assert.deepStrictEqual([News.buildDefaultFileName('data:application/msword;base64,QQ==', 'word'), News.buildDefaultFileName('./files/a.xls?v=1', 'excel')], ['添付資料.docx', 'a.xls']);
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
    const added = News.addNewsItem(list, { ...VALID_INPUT, fileUrl: ' ./files/meibo.xlsx ', fileName: '' });
    assert.deepStrictEqual(toPlain(added[0]), {
        id: 'news-1', date: '2026-11-01', category: 'event', title: '秋のスポーツ体験会', body: 'どなたでも参加できます。\n申し込みは不要です。',
        ...NO_ATTACHMENT, fileUrl: './files/meibo.xlsx', fileName: 'meibo.xlsx', fileType: 'excel'
    });
    assert.deepStrictEqual([added.length, list.length], [7, 6]);
});

test('updateNewsItem は指定した id のお知らせだけを書き換えて並べ直し（添付を外すこともできる）、ない id なら内容は変わらない', () => {
    const list = Object.freeze(News.createSampleNews(TODAY));
    const updated = News.updateNewsItem(list, 'sample-5', { ...VALID_INPUT, category: 'closed' });
    assert.deepStrictEqual(updated.map((news) => news.id), ['sample-5', ...SAMPLE_IDS_BY_DATE.filter((id) => id !== 'sample-5')]);
    assert.deepStrictEqual([updated[0].date, updated[0].category, updated[0].title, updated[0].fileUrl, updated[0].fileType], ['2026-11-01', 'closed', '秋のスポーツ体験会', '', '']);
    assert.deepStrictEqual(toPlain(News.updateNewsItem(list, 'none', VALID_INPUT)), toPlain(News.sortNewsByDateDesc(list)));
});

test('removeNewsItem は指定した id だけを消し、findNewsItem は見つからなければ null を返す', () => {
    const list = Object.freeze(News.createSampleNews(TODAY));
    assert.deepStrictEqual(News.removeNewsItem(list, 'sample-2').map((news) => news.id), ['sample-1', 'sample-3', 'sample-4', 'sample-5', 'sample-6']);
    assert.strictEqual(News.removeNewsItem(list, 'none').length, 6);
    assert.deepStrictEqual(News.removeNewsItem([], 'sample-1'), []);
    assert.strictEqual(News.findNewsItem(list, 'sample-2').title, '合宿向けのお弁当メニューを新しくしました');
    assert.strictEqual(News.findNewsItem(list, 'none'), null);
});

// ---------- 整形・保存・読み込み ----------
test('normalizeNewsList は、正しくないもの・id の重複を除き、id がない・使えない文字なら番号から作る', () => {
    const rawList = [item('a-1', TODAY), { ...item('', TODAY), id: '<b>' }, item('a-1', TODAY), { ...item('x', 'bad-date') }, { ...item('y', TODAY), imageUrl: 'javascript:x' }, null, 'text'];
    assert.deepStrictEqual(News.normalizeNewsList(rawList).map((news) => news.id), ['a-1', 'news-2']);
    assert.deepStrictEqual(News.normalizeNewsList('not array'), []);
    assert.deepStrictEqual(News.normalizeNewsList(undefined), []);
});

test('serializeNews で保存した文字列は parseStoredNews で同じ一覧に戻り（画像・添付資料も）、空の一覧も [] として戻る', () => {
    const list = News.createSampleNews(TODAY);
    assert.deepStrictEqual(News.parseStoredNews(News.serializeNews(list)), list);
    assert.deepStrictEqual(News.parseStoredNews(News.serializeNews([])), []);
});

test('parseStoredNews は、保存がない・壊れている・種類が違うときは null を返す', () => {
    [null, '', '{壊れた', '[]', JSON.stringify({ type: 'other', items: [] }), JSON.stringify({ type: 'facility_dx_news', items: {} })]
        .forEach((text) => assert.strictEqual(News.parseStoredNews(text), null, String(text)));
});

test('resolveNewsList は、保存があればそれ（空なら空）、なければ CUSTOM_FACILITY_INFO.news、それもなければサンプルを新しい順で返す', () => {
    const custom = [item('c-1', '2026-09-01'), { ...item('c-2', '2026-09-30', 'important'), pdfUrl: './files/old.pdf' }];
    const stored = News.serializeNews([item('s-1', '2026-01-01')]);
    assert.deepStrictEqual(News.resolveNewsList(stored, custom, TODAY).map((news) => news.id), ['s-1']);
    assert.deepStrictEqual(News.resolveNewsList(News.serializeNews([]), custom, TODAY), []);
    assert.deepStrictEqual(News.resolveNewsList(null, custom, TODAY).map((news) => `${news.id}:${news.fileType}`), ['c-2:pdf', 'c-1:']);
    assert.deepStrictEqual(News.resolveNewsList(null, [{ title: '不完全' }], TODAY).map((news) => news.id), SAMPLE_IDS_BY_DATE);
    assert.strictEqual(News.resolveNewsList('{壊れた', undefined, TODAY).length, 6);
});

// ---------- 絞り込み・記事への直接リンク・抜粋 ----------
test('filterNewsByCategory は「すべて」なら全件、カテゴリならそのお知らせだけを返し、buildCategoryFilters は件数を数える', () => {
    const list = News.createSampleNews(TODAY);
    assert.strictEqual(News.filterNewsByCategory(list, 'all').length, 6);
    assert.deepStrictEqual(News.filterNewsByCategory(list, 'info').map((news) => news.id), ['sample-2', 'sample-5', 'sample-6']);
    assert.deepStrictEqual(News.buildCategoryFilters(list).map((filter) => `${filter.label}${filter.count}`), ['すべて6', '重要1', 'ご案内3', 'イベント1', '休館日1']);
    assert.deepStrictEqual(News.buildCategoryFilters([]).map((filter) => filter.count), [0, 0, 0, 0, 0]);
});

test('記事への直接リンクは "#news-<id>" で、ハッシュから id を取り出せる（違う形なら空）', () => {
    assert.strictEqual(News.buildNewsPageHref('./news/index.html', 'sample-4'), './news/index.html#news-sample-4');
    assert.deepStrictEqual(['#news-sample-4', 'news-news-12', '#news-', '#top', '#news-<b>', '', null].map(News.parseNewsAnchorId), ['sample-4', 'news-12', '', '', '', '', '']);
});

test('buildNewsExcerpt は改行・空白をまとめ、長ければ指定の文字数で切って「…」を付ける', () => {
    assert.strictEqual(News.buildNewsExcerpt('1行目\n\n  2行目', 48), '1行目 2行目');
    assert.strictEqual(News.buildNewsExcerpt('あ'.repeat(49), 48), `${'あ'.repeat(48)}…`);
    assert.strictEqual(News.buildNewsExcerpt('あ'.repeat(48), 48), 'あ'.repeat(48));
});

// ---------- トップページの HTML ----------
test('renderNewsListHtml は、日付・カテゴリ・タイトル・添付バッジ・抜粋を新しい順に limit 件まで作り、お知らせページの記事へのリンクにする', () => {
    const html = News.renderNewsListHtml(News.createSampleNews(TODAY), 5, './news/index.html');
    assert.strictEqual((html.match(/<li class="news-item"/g) || []).length, 5);
    assert.match(html, /^<li class="news-item" data-news-id="sample-1" data-news-category="important"><a class="news-link" href="\.\/news\/index\.html#news-sample-1"><time class="news-date" datetime="2026-10-20">2026\.10\.20<\/time><span class="news-badge" data-news-category="important">重要<\/span><span class="news-title">Web予約の受付を開始しました<span class="news-attach" data-attach="pdf">📄PDF<\/span><\/span>/);
    assert.match(html, /<span class="news-attach" data-attach="image">🖼️画像<\/span>/);
    assert.match(html, /<span class="news-attach" data-attach="excel">📗Excel<\/span>/);
    assert.doesNotMatch(html, /sample-6/, '6件目（いちばん古い記事）は出さない');
    assert.doesNotMatch(html, /<button|編集|削除/, 'トップページ用の HTML に編集の操作を出さない');
});

test('renderNewsListHtml は、お知らせがなければ「お知らせはありません」を出し、文字はすべてエスケープする', () => {
    assert.strictEqual(News.renderNewsListHtml([], 5, './news/index.html'), '<li class="news-empty">現在、お知らせはありません。</li>');
    const html = News.renderNewsListHtml([{ id: 'x', date: TODAY, category: 'info', title: '<script>alert(1)</script>', body: '"A" & \'B\'', ...NO_ATTACHMENT }], 5, './news/index.html');
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && html.includes('&quot;A&quot; &amp; &#39;B&#39;'));
    assert.doesNotMatch(html, /<script>|news-attach/);
});

// ---------- お知らせページの HTML ----------
test('renderCategoryFilterHtml は、件数つきの絞り込みボタンを作り、選んでいるものだけ aria-pressed="true" にする', () => {
    const html = News.renderCategoryFilterHtml(News.buildCategoryFilters(News.createSampleNews(TODAY)), 'info');
    assert.strictEqual((html.match(/<button type="button" class="filter-button"/g) || []).length, 5);
    assert.match(html, /data-filter="info" aria-pressed="true">ご案内<span class="filter-count">3<\/span>/);
    assert.strictEqual((html.match(/aria-pressed="true"/g) || []).length, 1);
});

test('renderNewsCardHtml は、id="news-<id>" の記事カードに本文（改行は <br>）・拡大できる画像・ページの位置に合わせた画像の URL を入れる', () => {
    const flyer = News.findNewsItem(News.createSampleNews(TODAY), 'sample-4');
    const html = News.renderNewsCardHtml(flyer, '../');
    assert.match(html, /^<article class="news-card" id="news-sample-4" data-news-id="sample-4" data-news-category="event" tabindex="-1">/);
    assert.match(html, /<h2 class="news-card-title">秋のスポーツ体験会を開催します<\/h2><div class="news-card-body">[^<]*<br>/);
    assert.match(html, /<button type="button" class="news-image-button" data-image-src="\.\.\/files\/sample-flyer\.svg" data-image-alt="秋のスポーツ体験会のチラシ"[^>]*><img src="\.\.\/files\/sample-flyer\.svg" alt="秋のスポーツ体験会のチラシ"/);
    assert.match(html, /<figcaption>秋のスポーツ体験会のチラシ<\/figcaption>/);
    assert.doesNotMatch(html, /file-button/);
});

test('renderNewsFileButtonHtml は、種類ごとのアイコン・文言・ファイル名と download 属性つきのボタンを作る', () => {
    const samples = News.createSampleNews(TODAY);
    const buttonOf = (id) => News.renderNewsFileButtonHtml(News.findNewsItem(samples, id), '../');
    assert.match(buttonOf('sample-1'), /^<a class="file-button" data-file-type="pdf" href="\.\.\/files\/riyou-youkou\.pdf" download="施設利用要項\.pdf" target="_blank" rel="noopener"><span class="file-icon" aria-hidden="true">📄<\/span><span class="file-text"><span class="file-action">PDFを開く・ダウンロード<\/span><span class="file-name">施設利用要項\.pdf<\/span>/);
    assert.match(buttonOf('sample-6'), /data-file-type="word"[^>]*download="施設利用申込書\.docx"[\s\S]*📘[\s\S]*Wordファイルをダウンロード/);
    assert.match(buttonOf('sample-5'), /data-file-type="excel"[^>]*download="宿泊者名簿\.xlsx"[\s\S]*📗[\s\S]*Excelファイルをダウンロード/);
    assert.strictEqual(buttonOf('sample-2'), '');
});

test('お知らせページの HTML は、画像の説明・ファイル名などをすべてエスケープし、記事がなければ「該当するお知らせはありません」', () => {
    const news = { id: 'x', date: TODAY, category: 'info', title: 'T', body: 'B', imageUrl: 'a.png', imageName: '"><img src=x>', fileUrl: 'a.pdf', fileName: '<b>.pdf', fileType: 'pdf' };
    const html = News.renderNewsCardHtml(news, './');
    assert.doesNotMatch(html, /"><img src=x>|<b>\.pdf/);
    assert.ok(html.includes('&quot;&gt;&lt;img src=x&gt;') && html.includes('&lt;b&gt;.pdf'));
    assert.strictEqual(News.renderNewsCardsHtml([], '../'), '<p class="news-empty">該当するお知らせはありません。</p>');
});

// ---------- ファイルの中身 ----------
test('news-logic.js は let・var を使わず、会社名・住所・電話番号らしい表記を含まない', () => {
    const source = fs.readFileSync(NEWS_LOGIC_PATH, 'utf8');
    assert.doesNotMatch(source, /\b(let|var)\s/);
    [/〒/, /TEL\s*\d/, /\d{2,4}-\d{2,4}-\d{3,4}/, /株式会社|協会|財団/, /[都道府県][^\s<'"`]*[市区町村]/].forEach((pattern) => assert.doesNotMatch(source, pattern, String(pattern)));
});
