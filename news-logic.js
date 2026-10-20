// ======================================================
//  トップページの「お知らせ（News & Topics）」のデータを扱う純粋関数
//  トップページ（index.html：表示だけ）・職員用のスケジュール管理表（schedule/index.html?mode=staff：追加・編集・削除）・
//  テスト（tests/news-logic.test.js）から読み込む
//  ※DOM・localStorage には触らない。保存されている文字列・今日の日付・facility-config.js の値は引数で受け取る
//  ※ほかのファイルの関数と名前がぶつからないよう、全体をブロック { } で囲む
// ======================================================
{
    // お知らせを保存する localStorage のキー（職員用画面で書き込み、トップページで読む）
    const NEWS_STORAGE_KEY = 'facility_dx_news';
    const NEWS_DATA_TYPE = 'facility_dx_news';
    const NEWS_DATA_VERSION = 1;
    const NEWS_TITLE_MAX_LENGTH = 60;
    const NEWS_BODY_MAX_LENGTH = 1000;
    // トップページに出すお知らせの件数（新しい順）
    const PORTAL_NEWS_LIMIT = 5;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const NEWS_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

    // カテゴリ（key は保存用、label は画面に出す名前）
    const NEWS_CATEGORIES = Object.freeze([
        { key: 'important', label: '重要' },
        { key: 'info', label: 'ご案内' },
        { key: 'event', label: 'イベント' },
        { key: 'closed', label: '休館日' }
    ].map(Object.freeze));

    // 初期サンプルのお知らせ（daysAgo：今日から何日前の日付にするか）
    const SAMPLE_NEWS_TEMPLATES = Object.freeze([
        { id: 'sample-1', daysAgo: 0, category: 'important', title: 'Web予約の受付を開始しました', body: '空き状況の確認から概算見積もり、お申し込みまで、Webで24時間受け付けています。\nお電話・窓口でのご予約も、これまでどおり承ります。' },
        { id: 'sample-2', daysAgo: 7, category: 'info', title: '合宿向けのお弁当メニューを新しくしました', body: '練習の合間に食べやすい、ボリュームのあるお弁当をご用意しました。\nご注文は、ご利用日の5日前までにお申し込みください。' },
        { id: 'sample-3', daysAgo: 14, category: 'closed', title: '設備点検に伴う休館日のお知らせ', body: '設備の定期点検のため、来月の第2月曜日は全館休館とさせていただきます。\nご不便をおかけしますが、ご理解のほどよろしくお願いいたします。' }
    ].map(Object.freeze));

    const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    const toTrimmedText = (value) => (typeof value === 'string' ? value.trim() : '');

    // ---------- カテゴリ・日付 ----------
    const isNewsCategory = (key) => NEWS_CATEGORIES.some((category) => category.key === key);
    const findCategoryLabel = (key) => (NEWS_CATEGORIES.find((category) => category.key === key) || { label: '' }).label;

    // "YYYY-MM-DD" の形で、実在する日付か（2026-02-30 などは false）
    const isValidDateString = (text) => typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(text)
        && !Number.isNaN(Date.parse(`${text}T00:00:00Z`)) && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;

    const shiftDateString = (dateText, days) => new Date(Date.parse(`${dateText}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

    // "2026-10-20" → "2026.10.20"
    const formatNewsDate = (dateText) => String(dateText).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1.$2.$3');

    // ---------- 初期サンプル ----------
    const createSampleNews = (today) => SAMPLE_NEWS_TEMPLATES.map((template) => ({
        id: template.id, date: shiftDateString(today, -template.daysAgo), category: template.category, title: template.title, body: template.body
    }));

    // ---------- 入力のチェックと整形 ----------
    // 入力（日付・カテゴリ・タイトル・本文）の誤り（なければ空の配列）
    const validateNewsInput = (input) => [
        isValidDateString(toTrimmedText(input?.date)) ? null : '日付を正しく入力してください',
        isNewsCategory(input?.category) ? null : 'カテゴリを選んでください',
        toTrimmedText(input?.title) ? null : 'タイトルを入力してください',
        toTrimmedText(input?.title).length <= NEWS_TITLE_MAX_LENGTH ? null : `タイトルは${NEWS_TITLE_MAX_LENGTH}文字以内にしてください`,
        toTrimmedText(input?.body) ? null : '本文を入力してください',
        toTrimmedText(input?.body).length <= NEWS_BODY_MAX_LENGTH ? null : `本文は${NEWS_BODY_MAX_LENGTH}文字以内にしてください`
    ].filter(Boolean);

    const toNewsFields = (input) => ({
        date: toTrimmedText(input.date), category: input.category, title: toTrimmedText(input.title), body: toTrimmedText(input.body)
    });

    // 保存されていた（または facility-config.js の）お知らせ1件を整える（正しくなければ null。id がなければ番号から作る）
    const normalizeNewsItem = (raw, index) => (raw && typeof raw === 'object' && validateNewsInput(raw).length === 0
        ? { id: typeof raw.id === 'string' && NEWS_ID_PATTERN.test(raw.id) ? raw.id : `news-${index + 1}`, ...toNewsFields(raw) }
        : null);

    // お知らせの一覧を整える（配列でなければ空。正しくないもの・id が重複する2件目以降は除く）
    const normalizeNewsList = (rawList) => (Array.isArray(rawList) ? rawList.map(normalizeNewsItem).filter(Boolean) : [])
        .filter((item, index, list) => list.findIndex((other) => other.id === item.id) === index);

    // ---------- 並べ替え・追加・編集・削除（いずれも新しい配列を返す） ----------
    // 日付の新しい順（同じ日付なら id の大きい順＝あとから追加した順）
    const compareNewsByDateDesc = (first, second) => second.date.localeCompare(first.date) || second.id.localeCompare(first.id, 'en', { numeric: true });
    const sortNewsByDateDesc = (list) => [...list].sort(compareNewsByDateDesc);

    // 新しいお知らせの id（"news-番号" のうち一番大きい番号の次）
    const createNewsId = (list) => `news-${list.reduce((max, item) => Math.max(max, Number((/^news-(\d+)$/.exec(item.id) || [])[1] || 0)), 0) + 1}`;

    const addNewsItem = (list, input) => sortNewsByDateDesc([...list, { id: createNewsId(list), ...toNewsFields(input) }]);
    const updateNewsItem = (list, id, input) => sortNewsByDateDesc(list.map((item) => (item.id === id ? { id, ...toNewsFields(input) } : item)));
    const removeNewsItem = (list, id) => list.filter((item) => item.id !== id);
    const findNewsItem = (list, id) => list.find((item) => item.id === id) || null;

    // ---------- 保存・読み込み・表示するお知らせの決定 ----------
    const serializeNews = (list) => JSON.stringify({ type: NEWS_DATA_TYPE, version: NEWS_DATA_VERSION, items: list });

    // 保存されていた文字列を一覧に戻す（保存がない・壊れている・種類が違うときは null。全部削除した空の一覧は []）
    const parseStoredNews = (text) => {
        try {
            const parsed = JSON.parse(text);
            return parsed?.type === NEWS_DATA_TYPE && Array.isArray(parsed.items) ? normalizeNewsList(parsed.items) : null;
        } catch (error) { return null; }
    };

    // 初期のお知らせ（facility-config.js の window.CUSTOM_FACILITY_INFO.news に正しいお知らせがあればそれ、なければサンプル3件）
    const resolveInitialNews = (customNews, today) => {
        const customList = normalizeNewsList(customNews);
        return sortNewsByDateDesc(customList.length > 0 ? customList : createSampleNews(today));
    };

    // 表示するお知らせ（職員が保存したものがあればそれ、なければ初期のお知らせ）
    const resolveNewsList = (storedText, customNews, today) => {
        const storedList = parseStoredNews(storedText);
        return storedList === null ? resolveInitialNews(customNews, today) : sortNewsByDateDesc(storedList);
    };

    // ---------- トップページの HTML（表示だけ。編集のボタンは作らない。文字はすべてエスケープする） ----------
    const renderNewsBadgeHtml = (category) => `<span class="news-badge" data-news-category="${escapeHtml(category)}">${escapeHtml(findCategoryLabel(category))}</span>`;
    const formatNewsBodyHtml = (body) => escapeHtml(body).replace(/\r?\n/g, '<br>');

    // お知らせ1件（タイトルを押すと本文が開く）
    const renderNewsItemHtml = (item) => `<li class="news-item" data-news-id="${escapeHtml(item.id)}" data-news-category="${escapeHtml(item.category)}">`
        + '<details class="news-details"><summary class="news-summary">'
        + `<time class="news-date" datetime="${escapeHtml(item.date)}">${escapeHtml(formatNewsDate(item.date))}</time>${renderNewsBadgeHtml(item.category)}`
        + `<span class="news-title">${escapeHtml(item.title)}</span></summary>`
        + `<div class="news-body">${formatNewsBodyHtml(item.body)}</div></details></li>`;

    // お知らせの一覧（新しい順に limit 件まで。1件もなければその旨）
    const renderNewsListHtml = (list, limit) => (list.length === 0
        ? '<li class="news-empty">現在、お知らせはありません。</li>'
        : sortNewsByDateDesc(list).slice(0, limit).map(renderNewsItemHtml).join(''));

    // NEWS_EXPORTS:start
    // ブラウザでは window.NewsLogic、Node.js（テスト）では module.exports で使えるようにする
    const NewsLogic = Object.freeze({
        NEWS_STORAGE_KEY, NEWS_DATA_TYPE, NEWS_DATA_VERSION, NEWS_TITLE_MAX_LENGTH, NEWS_BODY_MAX_LENGTH, PORTAL_NEWS_LIMIT, NEWS_CATEGORIES,
        escapeHtml, isNewsCategory, findCategoryLabel, isValidDateString, shiftDateString, formatNewsDate, createSampleNews,
        validateNewsInput, normalizeNewsItem, normalizeNewsList, sortNewsByDateDesc, createNewsId,
        addNewsItem, updateNewsItem, removeNewsItem, findNewsItem, serializeNews, parseStoredNews, resolveInitialNews, resolveNewsList,
        renderNewsBadgeHtml, formatNewsBodyHtml, renderNewsItemHtml, renderNewsListHtml
    });
    if (typeof module !== 'undefined') module.exports = NewsLogic;
    if (typeof window !== 'undefined') window.NewsLogic = NewsLogic;
    // NEWS_EXPORTS:end
}
