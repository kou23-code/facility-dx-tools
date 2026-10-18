// ======================================================
//  公式ホームページ兼DXポータル（index.html）の表示内容を作る純粋関数
//  画面（index.html）とテスト（tests/portal-logic.test.js）の両方から読み込む
//  ※DOM には触らない。施設・料金は reservation/reservation-logic.js の RESERVATION_CATALOG、
//    施設名・所在地などは FACILITY_INFO（facility-config.js で上書きしたもの）を引数で受け取る
//  ※予約システムの関数と名前がぶつからないよう、全体をブロック { } で囲む
// ======================================================
{
    // 施設ごとの紹介文（category：sports = 体育館・グラウンド、room = 研修室）
    const FACILITY_GUIDES = Object.freeze({
        gym: { category: 'sports', usage: 'バスケットボール・バレーボール・バドミントンなど', feature: '大会や合同練習にも使える、いちばん広い屋内競技スペースです。' },
        gym_s: { category: 'sports', usage: '卓球・バドミントン・ダンス・軽運動など', feature: '少人数のチーム練習やウォーミングアップに使いやすい広さです。' },
        track: { category: 'sports', usage: '陸上競技・ランニング・体力づくりなど', feature: '走り込みやフィジカルトレーニングに最適な屋外グラウンドです。' },
        court: { category: 'sports', usage: 'サッカー・ラグビー・ソフトボールなど', feature: '球技の練習試合や紅白戦に使える屋外の競技場です。' },
        kL1: { category: 'room', usage: '研修・講演・全体ミーティングなど', feature: '大人数での講義や開会式に対応できる大研修室です。' },
        kL3: { category: 'room', usage: '研修・セミナー・作戦会議など', feature: '第１研修室と別に予約でき、2会場同時の進行にも便利です。' },
        kS: { category: 'room', usage: 'グループワーク・分科会・勉強会など', feature: '中人数での話し合いや学習に向いた落ち着いた研修室です。' },
        mr: { category: 'room', usage: '打ち合わせ・スタッフ会議・面談など', feature: '監督・引率者の打ち合わせなど、少人数の会議に使えます。' }
    });

    // 施設の大きな区分（料金の単位の説明つき）
    const FACILITY_CATEGORIES = Object.freeze([
        { key: 'sports', title: '体育館・グラウンド', billing: 'period' },
        { key: 'room', title: '研修室', billing: 'hour' }
    ]);

    // 区分コマの呼び名（午前・午後・夜間）
    const PERIOD_LABELS = Object.freeze({ am: '午前', pm: '午後', ev: '夜間' });

    const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    const formatYen = (amount) => `${amount.toLocaleString('ja-JP')}円`;

    // 料金（stay・day の大人・小中高）の一番安い額と一番高い額 → "3,520円〜6,600円"
    const formatPriceRange = (prices) => {
        const amounts = Object.values(prices);
        const [min, max] = [Math.min(...amounts), Math.max(...amounts)];
        return min === max ? formatYen(min) : `${formatYen(min)}〜${formatYen(max)}`;
    };

    // 研修室の利用時間（9時〜21時のコマ → "9〜21時"）
    const formatHourRange = (hourSlots) => `${hourSlots[0].startHour}〜${hourSlots[hourSlots.length - 1].startHour + 1}時`;

    // 区分コマの一覧 → "午前（8:30~12:30）・午後（…）・夜間（…）"
    const formatPeriodList = (periods) => periods.map((period) => `${PERIOD_LABELS[period.key] || period.name}（${period.time}）`).join('・');

    // 料金の単位の説明（区分ごと・1時間ごと）
    const describeBillingUnit = (billing, catalog) => (billing === 'period'
        ? `${catalog.periods.map((period) => PERIOD_LABELS[period.key] || period.name).join('・')}の${catalog.periods.length}区分`
        : `${formatHourRange(catalog.hourSlots)}の1時間単位`);

    // 施設1件のカードの内容
    const buildFacilityCard = (facility, guides) => ({
        key: facility.key, name: facility.name, category: guides[facility.key]?.category || 'sports',
        usage: guides[facility.key]?.usage || '', feature: guides[facility.key]?.feature || '',
        unitLabel: facility.billing === 'period' ? '1区分あたり' : '1時間あたり', priceLabel: formatPriceRange(facility.prices)
    });

    // 区分ごとの利用時間の説明（体育館・グラウンドは各区分の時間、研修室は利用できる時間帯）
    const describeUsageTime = (billing, catalog) => (billing === 'period'
        ? formatPeriodList(catalog.periods) : `${formatHourRange(catalog.hourSlots)}（1時間単位でご予約いただけます）`);

    // 施設紹介のカードを区分ごとにまとめる（区分の見出し・料金の単位と利用時間の説明つき）
    const buildFacilitySections = (catalog, guides) => {
        const cards = catalog.facilities.map((facility) => buildFacilityCard(facility, guides));
        return FACILITY_CATEGORIES.map((category) => ({
            key: category.key, title: category.title, unitNote: describeBillingUnit(category.billing, catalog),
            timeNote: describeUsageTime(category.billing, catalog),
            cards: cards.filter((card) => card.category === category.key)
        }));
    };

    // 宿泊料金の表（年代別・1人1泊）
    const buildStayPriceRows = (catalog) => catalog.priceTypes.map((priceType) => ({
        key: priceType.key, name: priceType.name, priceLabel: formatYen(catalog.stayPrices[priceType.key])
    }));

    // 食事などの案内を group（食堂の食事・弁当・お茶・おにぎり）ごとにまとめる
    const buildMealGroups = (catalog) => [...new Set(catalog.meals.map((meal) => meal.group))].map((group) => ({
        group, items: catalog.meals.filter((meal) => meal.group === group)
            .map((meal) => ({ key: meal.key, name: meal.name, priceLabel: `${formatYen(meal.price)}／${meal.unit}` }))
    }));

    // 宿泊の受け入れ条件（受付ルールの上限から作る）
    const buildStayHighlights = (config) => [
        { label: '最大宿泊人数', value: `${config.stayCapacity}名` },
        { label: '同時受け入れ', value: `${config.maxStayGroups}団体まで` },
        { label: '連泊', value: `最大${config.maxNights}泊` }
    ];

    // ページのタイトル（施設名入り）
    const buildPortalTitle = (info) => `${info.facilityName} 公式ホームページ｜合宿・スポーツ大会・研修の総合施設`;

    // FACILITY_INFO:start
    // ヘッダー・アクセス・フッターに出す施設の情報（year：コピーライトの年）。
    // 郵便番号の記号などの表記はこのブロックの中だけに書く（テストがこのブロックの外を確認するため、目印のコメントは消さない）
    const buildContactInfo = (info, year) => ({
        organization: info.organization, facilityName: info.facilityName, fullName: `${info.organization} ${info.facilityName}`,
        postal: `〒${info.postalCode}`, address: info.address, tel: info.tel,
        telHref: `tel:${info.tel.replace(/[^\d+]/g, '')}`, copyright: `© ${year} ${info.organization} ${info.facilityName}`
    });
    // FACILITY_INFO:end

    // ---------- HTML の文字列を作る（表示する文字はすべてエスケープする） ----------
    const renderFacilityCardHtml = (card) => `<article class="facility-card" data-facility-key="${escapeHtml(card.key)}">`
        + `<h4 class="facility-name">${escapeHtml(card.name)}</h4>`
        + `<p class="facility-usage">${escapeHtml(card.usage)}</p>`
        + `<p class="facility-feature">${escapeHtml(card.feature)}</p>`
        + `<p class="facility-price"><span>${escapeHtml(card.unitLabel)}</span><strong>${escapeHtml(card.priceLabel)}</strong><small>（税込・目安）</small></p>`
        + '</article>';

    const renderFacilitySectionHtml = (section) => `<div class="facility-group" data-category="${escapeHtml(section.key)}">`
        + `<h3 class="facility-group-title">${escapeHtml(section.title)}<span class="facility-unit">${escapeHtml(section.unitNote)}</span></h3>`
        + `<p class="facility-time">${escapeHtml(section.timeNote)}</p>`
        + `<div class="facility-grid">${section.cards.map(renderFacilityCardHtml).join('')}</div></div>`;

    const renderStayPriceRowsHtml = (rows) => rows
        .map((row) => `<tr><th scope="row">${escapeHtml(row.name)}</th><td>${escapeHtml(row.priceLabel)}</td></tr>`).join('');

    const renderMealGroupHtml = (mealGroup) => `<div class="meal-group"><h4>${escapeHtml(mealGroup.group)}</h4><ul>`
        + mealGroup.items.map((item) => `<li><span>${escapeHtml(item.name)}</span><span>${escapeHtml(item.priceLabel)}</span></li>`).join('')
        + '</ul></div>';

    const renderStayHighlightsHtml = (highlights) => highlights
        .map((item) => `<li><span class="highlight-label">${escapeHtml(item.label)}</span><strong class="highlight-value">${escapeHtml(item.value)}</strong></li>`).join('');

    // PORTAL_EXPORTS:start
    // ブラウザでは window.PortalLogic、Node.js（テスト）では module.exports で使えるようにする
    const PortalLogic = Object.freeze({
        FACILITY_GUIDES, FACILITY_CATEGORIES, PERIOD_LABELS, escapeHtml, formatYen, formatPriceRange, formatHourRange, formatPeriodList,
        describeBillingUnit, describeUsageTime, buildFacilityCard, buildFacilitySections, buildStayPriceRows, buildMealGroups, buildStayHighlights,
        buildPortalTitle, buildContactInfo,
        renderFacilityCardHtml, renderFacilitySectionHtml, renderStayPriceRowsHtml, renderMealGroupHtml, renderStayHighlightsHtml
    });
    if (typeof module !== 'undefined') module.exports = PortalLogic;
    if (typeof window !== 'undefined') window.PortalLogic = PortalLogic;
    // PORTAL_EXPORTS:end
}
