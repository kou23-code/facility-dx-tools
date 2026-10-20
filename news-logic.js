// ======================================================
//  お知らせ（News & Topics）のデータを扱う純粋関数
//  トップページ（index.html：最新の一覧だけ）・お知らせ一覧・詳細ページ（news/index.html：全記事・画像・添付資料）・
//  職員用のスケジュール管理表（schedule/index.html?mode=staff：追加・編集・削除）・テスト（tests/news-logic.test.js）から読み込む
//  ※DOM・localStorage には触らない。保存されている文字列・今日の日付・facility-config.js の値・ページの位置は引数で受け取る
//  ※ほかのファイルの関数と名前がぶつからないよう、全体をブロック { } で囲む
// ======================================================
{
    // お知らせを保存する localStorage のキー（職員用画面で書き込み、トップページ・お知らせページで読む）
    const NEWS_STORAGE_KEY = 'facility_dx_news';
    const NEWS_DATA_TYPE = 'facility_dx_news';
    const NEWS_DATA_VERSION = 1;
    const NEWS_TITLE_MAX_LENGTH = 60;
    const NEWS_BODY_MAX_LENGTH = 1000;
    const NEWS_NAME_MAX_LENGTH = 100; // 画像の説明・添付資料のファイル名
    // トップページに出すお知らせの件数（新しい順）と、本文の抜粋の文字数
    const PORTAL_NEWS_LIMIT = 5;
    const NEWS_EXCERPT_LENGTH = 48;
    const NEWS_FILTER_ALL = 'all';
    const DAY_MS = 24 * 60 * 60 * 1000;
    const NEWS_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

    // ---------- 画像・添付資料の上限 ----------
    // 画像はファイルを選ぶと長い辺 1280px の JPEG に軽量化してから保存する（localStorage の容量は 5MB 前後のため）
    const IMAGE_MAX_SIDE = 1280;
    const IMAGE_JPEG_QUALITY = 0.8;
    const IMAGE_SOURCE_MAX_BYTES = 15 * 1024 * 1024; // 軽量化する前の画像ファイル
    const IMAGE_DATA_URL_MAX_LENGTH = 1500000; // 軽量化したあとの画像（DataURL の文字数）
    const FILE_MAX_BYTES = 2 * 1024 * 1024; // 添付資料ファイル
    const FILE_DATA_URL_MAX_LENGTH = Math.ceil(FILE_MAX_BYTES * 4 / 3) + 200;

    // カテゴリ（key は保存用、label は画面に出す名前）
    const NEWS_CATEGORIES = Object.freeze([
        { key: 'important', label: '重要' },
        { key: 'info', label: 'ご案内' },
        { key: 'event', label: 'イベント' },
        { key: 'closed', label: '休館日' }
    ].map(Object.freeze));

    // 添付資料の種類（extensions と mimeTypes は同じ順に並べる）
    const FILE_TYPES = Object.freeze([
        { key: 'pdf', label: 'PDF', icon: '📄', actionText: 'PDFを開く・ダウンロード', extensions: ['pdf'], mimeTypes: ['application/pdf'] },
        { key: 'word', label: 'Word', icon: '📘', actionText: 'Wordファイルをダウンロード', extensions: ['doc', 'docx'],
            mimeTypes: ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
        { key: 'excel', label: 'Excel', icon: '📗', actionText: 'Excelファイルをダウンロード', extensions: ['xls', 'xlsx'],
            mimeTypes: ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] }
    ].map(Object.freeze));
    const IMAGE_BADGE = Object.freeze({ icon: '🖼️', label: '画像' });

    // 初期サンプルのお知らせ（daysAgo：今日から何日前の日付にするか。画像・資料の場所はサイトのルートからの相対パス）
    const SAMPLE_NEWS_TEMPLATES = Object.freeze([
        { id: 'sample-1', daysAgo: 0, category: 'important', title: 'Web予約の受付を開始しました', body: '空き状況の確認から概算見積もり、お申し込みまで、Webで24時間受け付けています。\nお電話・窓口でのご予約も、これまでどおり承ります。\nご利用の前に、施設利用要項（PDF）をご確認ください。', fileUrl: './files/riyou-youkou.pdf', fileName: '施設利用要項.pdf' },
        { id: 'sample-2', daysAgo: 7, category: 'info', title: '合宿向けのお弁当メニューを新しくしました', body: '練習の合間に食べやすい、ボリュームのあるお弁当をご用意しました。\nご注文は、ご利用日の5日前までにお申し込みください。' },
        { id: 'sample-3', daysAgo: 14, category: 'closed', title: '設備点検に伴う休館日のお知らせ', body: '設備の定期点検のため、来月の第2月曜日は全館休館とさせていただきます。\nご不便をおかけしますが、ご理解のほどよろしくお願いいたします。' },
        { id: 'sample-4', daysAgo: 3, category: 'event', title: '秋のスポーツ体験会を開催します', body: 'バドミントン・卓球・ボッチャを、どなたでも気軽に体験できます。\n参加は無料、申し込みは不要です。動きやすい服装と室内履きでお越しください。', imageUrl: './files/sample-flyer.svg', imageName: '秋のスポーツ体験会のチラシ' },
        { id: 'sample-5', daysAgo: 10, category: 'info', title: '宿泊者名簿の様式（Excel）を掲載しました', body: '宿泊を伴うご利用の際は、宿泊者名簿をご利用日の7日前までにご提出ください。\n下のボタンから Excel の様式をダウンロードできます。', fileUrl: './files/meibo.xlsx', fileName: '宿泊者名簿.xlsx' },
        { id: 'sample-6', daysAgo: 21, category: 'info', title: '利用申込書（Word）をダウンロードできるようになりました', body: '窓口・郵送・FAXでお申し込みの方は、利用申込書の様式をご利用ください。\nWeb予約からもお申し込みいただけます。', fileUrl: './files/moushikomi.docx', fileName: '施設利用申込書.docx' }
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

    // ---------- 添付資料の種類の判別 ----------
    const isFileTypeKey = (key) => FILE_TYPES.some((fileType) => fileType.key === key);
    const findFileTypeInfo = (key) => FILE_TYPES.find((fileType) => fileType.key === key) || null;

    // ファイル名・URL の拡張子（小文字。? や # より後ろは見ない。なければ ''）
    const extractExtension = (name) => ((/\.([A-Za-z0-9]{1,8})$/.exec(String(name || '').split(/[?#]/)[0]) || [])[1] || '').toLowerCase();
    const findFileTypeByExtension = (name) => FILE_TYPES.find((fileType) => fileType.extensions.includes(extractExtension(name))) || null;
    const findFileTypeByMime = (mimeType) => FILE_TYPES.find((fileType) => fileType.mimeTypes.includes(String(mimeType || '').toLowerCase())) || null;
    // "data:application/pdf;base64,..." → "application/pdf"
    const extractDataUrlMime = (url) => ((/^data:([^;,]*)[;,]/.exec(String(url || '')) || [])[1] || '').toLowerCase();

    // 添付資料の種類（ファイル名の拡張子 → URL の拡張子 → MIME タイプ（DataURL の MIME を含む）の順に見る。わからなければ ''）
    const detectFileType = ({ fileName, fileUrl, mimeType }) => (findFileTypeByExtension(fileName) || findFileTypeByExtension(fileUrl)
        || findFileTypeByMime(mimeType || extractDataUrlMime(fileUrl)) || { key: '' }).key;

    // 拡張子に合う MIME タイプ（"xlsx" → Excel の MIME。知らない拡張子は ''）
    const findMimeByExtension = (extension) => {
        const fileType = FILE_TYPES.find((type) => type.extensions.includes(extension));
        return fileType ? fileType.mimeTypes[fileType.extensions.indexOf(extension)] : '';
    };

    // ---------- 画像・添付資料の URL ----------
    // サイト内の相対パス（英数字と - _ . / % だけ。".." で上のフォルダには出られない）、または http(s) の URL
    const RELATIVE_PATH_PATTERN = /^(\.\/)?(?!.*\.\.)[A-Za-z0-9_\-./%]+$/;
    const HTTP_URL_PATTERN = /^https?:\/\/[^\s"'<>\\]+$/i;
    const IMAGE_DATA_URL_PATTERN = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/;
    const BASE64_DATA_URL_PATTERN = /^data:[a-z0-9.+/-]*;base64,[A-Za-z0-9+/]+=*$/i;

    const isLinkUrl = (url) => HTTP_URL_PATTERN.test(url) || (RELATIVE_PATH_PATTERN.test(url) && !url.startsWith('//'));
    const isDataUrl = (url) => String(url).startsWith('data:');
    const isValidImageUrl = (url) => (isDataUrl(url) ? IMAGE_DATA_URL_PATTERN.test(url) : isLinkUrl(url));
    const isValidFileUrl = (url) => (isDataUrl(url) ? BASE64_DATA_URL_PATTERN.test(url) : isLinkUrl(url));

    // 画面に出すときの URL（サイトのルートからの相対パスに、そのページからルートまでの道のり rootPrefix を付ける。"./" や "../"）
    const resolveNewsAssetUrl = (url, rootPrefix) => (!url || /^(https?:|data:|\/)/i.test(url) ? url : `${rootPrefix}${url.replace(/^\.\//, '')}`);

    // DataURL の MIME タイプを置き換える（Word などがファイルの種類なしで読み込まれたときに直す）
    const replaceDataUrlMime = (dataUrl, mimeType) => String(dataUrl).replace(/^data:[^;,]*/, `data:${mimeType}`);

    // ファイルを選んで読み込んだ DataURL を、拡張子に合う MIME タイプにそろえる（知らない拡張子ならそのまま）
    const normalizeFileDataUrl = (dataUrl, fileName) => {
        const mimeType = findMimeByExtension(extractExtension(fileName));
        return mimeType ? replaceDataUrlMime(dataUrl, mimeType) : dataUrl;
    };

    // ---------- 選んだファイルのチェック（ファイル名・MIME タイプ・バイト数） ----------
    const formatBytes = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.ceil(bytes / 1024))}KB`);

    const checkAttachmentFile = ({ name, type, size }) => [
        findFileTypeByExtension(name) || findFileTypeByMime(type) ? null : 'PDF・Word・Excel（.pdf .doc .docx .xls .xlsx）のファイルを選んでください',
        size <= FILE_MAX_BYTES ? null : `ファイルの容量が大きすぎます（${formatBytes(FILE_MAX_BYTES)}まで。選んだファイルは${formatBytes(size)}）`
    ].filter(Boolean);

    const checkImageFile = ({ type, size }) => [
        /^image\//.test(String(type)) ? null : '画像ファイル（JPEG・PNG・GIF・WebP など）を選んでください',
        size <= IMAGE_SOURCE_MAX_BYTES ? null : `画像の容量が大きすぎます（${formatBytes(IMAGE_SOURCE_MAX_BYTES)}まで。選んだ画像は${formatBytes(size)}）`
    ].filter(Boolean);

    // 画像を軽量化するときの大きさ（縦横比を保ち、長い辺を maxSide 以下にする。小さい画像は拡大しない）
    const calculateResizedSize = (width, height, maxSide) => {
        const scale = Math.min(1, maxSide / Math.max(width, height, 1));
        return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
    };

    // ---------- 入力のチェックと整形 ----------
    // 添付資料の URL（旧形式の pdfUrl も読む）
    const pickFileUrl = (input) => toTrimmedText(input?.fileUrl) || toTrimmedText(input?.pdfUrl);

    // 添付資料の種類（正しい fileType の指定があればそれ、なければ自動判別。旧形式の pdfUrl だけのときは PDF）
    const resolveFileType = (input) => {
        const fileUrl = pickFileUrl(input);
        if (!fileUrl) return '';
        if (isFileTypeKey(input.fileType)) return input.fileType;
        return detectFileType({ fileName: input.fileName, fileUrl, mimeType: input.mimeType }) || (fileUrl === toTrimmedText(input.pdfUrl) ? 'pdf' : '');
    };

    // ファイル名の指定がないときの名前（URL の最後の部分。DataURL なら「添付資料.拡張子」）
    const buildDefaultFileName = (fileUrl, fileType) => (isDataUrl(fileUrl) || !extractExtension(fileUrl)
        ? `添付資料.${(findFileTypeInfo(fileType) || { extensions: ['pdf'] }).extensions.slice(-1)[0]}`
        : fileUrl.split(/[?#]/)[0].split('/').pop());

    // ダウンロードするときのファイル名（拡張子が種類と合わなければ付け足す）
    const buildDownloadName = (fileName, fileType) => {
        const typeInfo = findFileTypeInfo(fileType);
        return !typeInfo || typeInfo.extensions.includes(extractExtension(fileName)) ? fileName : `${fileName}.${typeInfo.extensions.slice(-1)[0]}`;
    };

    // 日付・カテゴリ・タイトル・本文の誤り
    const validateNewsText = (input) => [
        isValidDateString(toTrimmedText(input?.date)) ? null : '日付を正しく入力してください',
        isNewsCategory(input?.category) ? null : 'カテゴリを選んでください',
        toTrimmedText(input?.title) ? null : 'タイトルを入力してください',
        toTrimmedText(input?.title).length <= NEWS_TITLE_MAX_LENGTH ? null : `タイトルは${NEWS_TITLE_MAX_LENGTH}文字以内にしてください`,
        toTrimmedText(input?.body) ? null : '本文を入力してください',
        toTrimmedText(input?.body).length <= NEWS_BODY_MAX_LENGTH ? null : `本文は${NEWS_BODY_MAX_LENGTH}文字以内にしてください`
    ].filter(Boolean);

    // 画像の誤り（任意項目。空ならチェックしない）
    const validateNewsImage = (imageUrl, imageName) => [
        !imageUrl || isValidImageUrl(imageUrl) ? null : '画像の場所が正しくありません（https:// で始まるURLか、./files/flyer.jpg のような英数字の相対パスを入力してください）',
        imageUrl.length <= IMAGE_DATA_URL_MAX_LENGTH ? null : '画像の容量が大きすぎます。小さい画像を選んでください',
        imageName.length <= NEWS_NAME_MAX_LENGTH ? null : `画像の説明は${NEWS_NAME_MAX_LENGTH}文字以内にしてください`
    ].filter(Boolean);

    // 添付資料の誤り（任意項目。空ならチェックしない）
    const validateNewsFile = (input) => {
        const fileUrl = pickFileUrl(input);
        return fileUrl ? [
            isValidFileUrl(fileUrl) ? null : '添付資料の場所が正しくありません（https:// で始まるURLか、./files/meibo.xlsx のような英数字の相対パスを入力してください）',
            fileUrl.length <= FILE_DATA_URL_MAX_LENGTH ? null : `添付資料の容量が大きすぎます（${formatBytes(FILE_MAX_BYTES)}まで）`,
            resolveFileType(input) ? null : '添付資料は PDF・Word・Excel（.pdf .doc .docx .xls .xlsx）のファイルだけ掲載できます',
            toTrimmedText(input.fileName).length <= NEWS_NAME_MAX_LENGTH ? null : `添付資料のファイル名は${NEWS_NAME_MAX_LENGTH}文字以内にしてください`
        ].filter(Boolean) : [];
    };

    // 入力（日付・カテゴリ・タイトル・本文・画像・添付資料）の誤り（なければ空の配列）
    const validateNewsInput = (input) => [
        ...validateNewsText(input), ...validateNewsImage(toTrimmedText(input?.imageUrl), toTrimmedText(input?.imageName)), ...validateNewsFile(input)
    ];

    // 画像の項目（画像がなければ説明も空）
    const toImageFields = (input) => {
        const imageUrl = toTrimmedText(input.imageUrl);
        return { imageUrl, imageName: imageUrl ? toTrimmedText(input.imageName) : '' };
    };

    // 添付資料の項目（旧形式の pdfUrl は fileUrl に読み替える。資料がなければすべて空）
    const toFileFields = (input) => {
        const [fileUrl, fileType] = [pickFileUrl(input), resolveFileType(input)];
        return { fileUrl, fileName: fileUrl ? toTrimmedText(input.fileName) || buildDefaultFileName(fileUrl, fileType) : '', fileType };
    };

    const toNewsFields = (input) => ({
        date: toTrimmedText(input.date), category: input.category, title: toTrimmedText(input.title), body: toTrimmedText(input.body),
        ...toImageFields(input), ...toFileFields(input)
    });

    // ---------- 初期サンプル ----------
    const createSampleNews = (today) => SAMPLE_NEWS_TEMPLATES.map((template) => ({
        id: template.id, ...toNewsFields({ ...template, date: shiftDateString(today, -template.daysAgo) })
    }));

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

    // 初期のお知らせ（facility-config.js の window.CUSTOM_FACILITY_INFO.news に正しいお知らせがあればそれ、なければサンプル）
    const resolveInitialNews = (customNews, today) => {
        const customList = normalizeNewsList(customNews);
        return sortNewsByDateDesc(customList.length > 0 ? customList : createSampleNews(today));
    };

    // 表示するお知らせ（職員が保存したものがあればそれ、なければ初期のお知らせ）
    const resolveNewsList = (storedText, customNews, today) => {
        const storedList = parseStoredNews(storedText);
        return storedList === null ? resolveInitialNews(customNews, today) : sortNewsByDateDesc(storedList);
    };

    // ---------- カテゴリの絞り込み・記事への直接リンク ----------
    const filterNewsByCategory = (list, key) => (key === NEWS_FILTER_ALL ? list : list.filter((item) => item.category === key));

    // 絞り込みボタンの一覧（「すべて」と各カテゴリ。件数つき）
    const buildCategoryFilters = (list) => [
        { key: NEWS_FILTER_ALL, label: 'すべて', count: list.length },
        ...NEWS_CATEGORIES.map((category) => ({ key: category.key, label: category.label, count: filterNewsByCategory(list, category.key).length }))
    ];

    // 記事の要素の id・URL のハッシュ（"news-<id>"）と、ハッシュからお知らせの id を取り出す（違う形なら ''）
    const buildNewsAnchorId = (id) => `news-${id}`;
    const parseNewsAnchorId = (hash) => (/^#?news-([A-Za-z0-9_-]{1,40})$/.exec(String(hash || '')) || [])[1] || '';
    const buildNewsPageHref = (pagePath, id) => `${pagePath}#${buildNewsAnchorId(id)}`;

    // 本文の抜粋（改行・連続した空白は1つの空白にし、長ければ length 文字で切って「…」）
    const buildNewsExcerpt = (body, length) => {
        const text = String(body).replace(/\s+/g, ' ').trim();
        return text.length > length ? `${text.slice(0, length)}…` : text;
    };

    // ---------- 表示用の HTML（一般の利用者向け。編集のボタンは作らない。文字はすべてエスケープする） ----------
    const renderNewsBadgeHtml = (category) => `<span class="news-badge" data-news-category="${escapeHtml(category)}">${escapeHtml(findCategoryLabel(category))}</span>`;
    const formatNewsBodyHtml = (body) => escapeHtml(body).replace(/\r?\n/g, '<br>');

    // 添付があることを示すバッジ（「🖼️画像」「📄PDF」「📘Word」「📗Excel」）
    const renderAttachmentBadgesHtml = (item) => [
        item.imageUrl ? `<span class="news-attach" data-attach="image">${IMAGE_BADGE.icon}${IMAGE_BADGE.label}</span>` : '',
        item.fileType ? `<span class="news-attach" data-attach="${escapeHtml(item.fileType)}">${findFileTypeInfo(item.fileType).icon}${findFileTypeInfo(item.fileType).label}</span>` : ''
    ].join('');

    // トップページのお知らせ1件（押すとお知らせページのその記事へ移る）
    const renderNewsItemHtml = (item, pagePath) => `<li class="news-item" data-news-id="${escapeHtml(item.id)}" data-news-category="${escapeHtml(item.category)}">`
        + `<a class="news-link" href="${escapeHtml(buildNewsPageHref(pagePath, item.id))}">`
        + `<time class="news-date" datetime="${escapeHtml(item.date)}">${escapeHtml(formatNewsDate(item.date))}</time>${renderNewsBadgeHtml(item.category)}`
        + `<span class="news-title">${escapeHtml(item.title)}${renderAttachmentBadgesHtml(item)}</span>`
        + `<span class="news-excerpt">${escapeHtml(buildNewsExcerpt(item.body, NEWS_EXCERPT_LENGTH))}</span></a></li>`;

    // トップページのお知らせの一覧（新しい順に limit 件まで。1件もなければその旨）
    const renderNewsListHtml = (list, limit, pagePath) => (list.length === 0
        ? '<li class="news-empty">現在、お知らせはありません。</li>'
        : sortNewsByDateDesc(list).slice(0, limit).map((item) => renderNewsItemHtml(item, pagePath)).join(''));

    // お知らせページ：カテゴリの絞り込みボタン（押されているボタンは aria-pressed="true"）
    const renderCategoryFilterHtml = (filters, activeKey) => filters.map((filter) => `<button type="button" class="filter-button" data-filter="${escapeHtml(filter.key)}"`
        + ` aria-pressed="${filter.key === activeKey}">${escapeHtml(filter.label)}<span class="filter-count">${filter.count}</span></button>`).join('');

    // お知らせページ：画像（押すと拡大表示）
    const renderNewsImageHtml = (item, rootPrefix) => {
        if (!item.imageUrl) return '';
        const [src, alt] = [escapeHtml(resolveNewsAssetUrl(item.imageUrl, rootPrefix)), escapeHtml(item.imageName || `${item.title}の画像`)];
        return `<figure class="news-figure"><button type="button" class="news-image-button" data-image-src="${src}" data-image-alt="${alt}" aria-label="画像を拡大する：${alt}">`
            + `<img src="${src}" alt="${alt}" loading="lazy"><span class="zoom-hint" aria-hidden="true">🔍 クリックで拡大</span></button>`
            + `${item.imageName ? `<figcaption>${escapeHtml(item.imageName)}</figcaption>` : ''}</figure>`;
    };

    // お知らせページ：添付資料のボタン（種類ごとの色とアイコン、ファイル名つき。download 属性でそのファイル名で保存する）
    const renderNewsFileButtonHtml = (item, rootPrefix) => {
        const typeInfo = findFileTypeInfo(item.fileType);
        if (!item.fileUrl || !typeInfo) return '';
        return `<a class="file-button" data-file-type="${typeInfo.key}" href="${escapeHtml(resolveNewsAssetUrl(item.fileUrl, rootPrefix))}" download="${escapeHtml(buildDownloadName(item.fileName, item.fileType))}" target="_blank" rel="noopener">`
            + `<span class="file-icon" aria-hidden="true">${typeInfo.icon}</span><span class="file-text"><span class="file-action">${typeInfo.actionText}</span>`
            + `<span class="file-name">${escapeHtml(item.fileName)}</span></span></a>`;
    };

    // お知らせページ：記事1件のカード（id="news-<id>" で URL のハッシュから直接移れる）
    const renderNewsCardHtml = (item, rootPrefix) => `<article class="news-card" id="${escapeHtml(buildNewsAnchorId(item.id))}" data-news-id="${escapeHtml(item.id)}" data-news-category="${escapeHtml(item.category)}" tabindex="-1">`
        + `<div class="news-card-meta"><time class="news-date" datetime="${escapeHtml(item.date)}">${escapeHtml(formatNewsDate(item.date))}</time>${renderNewsBadgeHtml(item.category)}${renderAttachmentBadgesHtml(item)}</div>`
        + `<h2 class="news-card-title">${escapeHtml(item.title)}</h2><div class="news-card-body">${formatNewsBodyHtml(item.body)}</div>`
        + `${renderNewsImageHtml(item, rootPrefix)}${renderNewsFileButtonHtml(item, rootPrefix)}</article>`;

    // お知らせページ：記事の一覧（新しい順。1件もなければその旨）
    const renderNewsCardsHtml = (list, rootPrefix) => (list.length === 0
        ? '<p class="news-empty">該当するお知らせはありません。</p>'
        : sortNewsByDateDesc(list).map((item) => renderNewsCardHtml(item, rootPrefix)).join(''));

    // ---------- 職員用の入力フォームに出す説明 ----------
    // DataURL のおおよそのバイト数（base64 の部分の 3/4）
    const estimateDataUrlBytes = (dataUrl) => Math.floor(Math.max(0, String(dataUrl).length - String(dataUrl).indexOf(',') - 1) * 3 / 4);

    // 画像の状態（なし：''。ファイルから読み込んだ画像は容量、URL・相対パスは正しいかどうか）
    const describeNewsImage = (imageUrl) => {
        if (!imageUrl) return '';
        if (isDataUrl(imageUrl)) return `ファイルから読み込み済み（軽量化後 約${formatBytes(estimateDataUrlBytes(imageUrl))}）`;
        return isValidImageUrl(imageUrl) ? 'URL・相対パスの画像を掲載します' : '画像の場所が正しくありません（https:// で始まるURLか、英数字の相対パス）';
    };

    // 添付資料の状態（なし：''。自動判別した種類と、ファイルから読み込んだときは容量）
    const describeNewsFile = (fileUrl, fileName) => {
        const typeInfo = findFileTypeInfo(fileUrl ? resolveFileType({ fileUrl, fileName }) : '');
        if (!fileUrl) return '';
        if (!typeInfo) return '種類を判別できません（.pdf .doc .docx .xls .xlsx のファイルを指定してください）';
        return `種類：${typeInfo.icon}${typeInfo.label}（自動判別）${isDataUrl(fileUrl) ? `・ファイルから読み込み済み（約${formatBytes(estimateDataUrlBytes(fileUrl))}）` : ''}`;
    };

    // NEWS_EXPORTS:start
    // ブラウザでは window.NewsLogic、Node.js（テスト）では module.exports で使えるようにする
    const NewsLogic = Object.freeze({
        NEWS_STORAGE_KEY, NEWS_DATA_TYPE, NEWS_DATA_VERSION, NEWS_TITLE_MAX_LENGTH, NEWS_BODY_MAX_LENGTH, NEWS_NAME_MAX_LENGTH, PORTAL_NEWS_LIMIT,
        NEWS_EXCERPT_LENGTH, NEWS_FILTER_ALL, NEWS_CATEGORIES, FILE_TYPES, IMAGE_BADGE,
        IMAGE_MAX_SIDE, IMAGE_JPEG_QUALITY, IMAGE_SOURCE_MAX_BYTES, IMAGE_DATA_URL_MAX_LENGTH, FILE_MAX_BYTES, FILE_DATA_URL_MAX_LENGTH,
        escapeHtml, isNewsCategory, findCategoryLabel, isValidDateString, shiftDateString, formatNewsDate,
        isFileTypeKey, findFileTypeInfo, extractExtension, findFileTypeByExtension, findFileTypeByMime, extractDataUrlMime, detectFileType, findMimeByExtension,
        isLinkUrl, isValidImageUrl, isValidFileUrl, resolveNewsAssetUrl, replaceDataUrlMime, normalizeFileDataUrl,
        formatBytes, checkAttachmentFile, checkImageFile, calculateResizedSize,
        pickFileUrl, resolveFileType, buildDefaultFileName, buildDownloadName, validateNewsInput, createSampleNews,
        normalizeNewsItem, normalizeNewsList, sortNewsByDateDesc, createNewsId,
        addNewsItem, updateNewsItem, removeNewsItem, findNewsItem, serializeNews, parseStoredNews, resolveInitialNews, resolveNewsList,
        filterNewsByCategory, buildCategoryFilters, buildNewsAnchorId, parseNewsAnchorId, buildNewsPageHref, buildNewsExcerpt,
        renderNewsBadgeHtml, formatNewsBodyHtml, renderAttachmentBadgesHtml, renderNewsItemHtml, renderNewsListHtml,
        renderCategoryFilterHtml, renderNewsImageHtml, renderNewsFileButtonHtml, renderNewsCardHtml, renderNewsCardsHtml,
        estimateDataUrlBytes, describeNewsImage, describeNewsFile
    });
    if (typeof module !== 'undefined') module.exports = NewsLogic;
    if (typeof window !== 'undefined') window.NewsLogic = NewsLogic;
    // NEWS_EXPORTS:end
}
