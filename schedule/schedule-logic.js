// ======================================================
//  スケジュール管理表の集計・判定（純粋関数だけを置くファイル）
//  画面（schedule/index.html）とテスト（tests/）の両方から読み込む
//  ※DOM や localStorage には触らない。必要な値（予約の一覧・施設の一覧など）はすべて引数で受け取る
//  ※catalog には reservation/reservation-logic.js の RESERVATION_CATALOG（施設・コマ・食事・区分の一覧）を渡す
//  ※予約システムと同じページで読み込んでも名前がぶつからないよう、全体をブロック { } で囲む
// ======================================================
{
    // ---------- 共通の設定 ----------
    const DAY_MS = 24 * 60 * 60 * 1000;

    // 宿泊の空き状況のしきい値（人数か団体数のどちらかが達したら、その記号）
    const STAY_THRESHOLDS = Object.freeze({
        full: Object.freeze({ guests: 300, groups: 6 }), // ×：満室
        few: Object.freeze({ guests: 200, groups: 4 })   // △：残りわずか
    });

    // 日別集計の食事の項目（mealKeys：品目のキー ／ group：catalog.meals の group が同じ品目をすべて数える）
    const MEAL_SUMMARY_ITEMS = Object.freeze([
        { key: 'breakfast', name: '朝食', mealKeys: ['bf'] },
        { key: 'lunch', name: '昼食', mealKeys: ['lu'] },
        { key: 'dinner', name: '夕食', mealKeys: ['di'] },
        { key: 'bento', name: '弁当', group: '弁当' },
        { key: 'tea', name: 'お茶', mealKeys: ['te'] },
        { key: 'onigiri', name: 'おにぎり', mealKeys: ['on'] }
    ].map(Object.freeze));

    // ---------- 日付（"YYYY-MM-DD" の文字列のまま扱い、タイムゾーンでずれないよう UTC で計算する） ----------
    // 日付の文字列を UTC の時刻（ミリ秒）にする。存在しない日付（2月30日など）や形の違う値は null
    const parseDateString = (dateString) => {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof dateString === 'string' ? dateString : '');
        if (!match) return null;
        const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        return new Date(time).toISOString().slice(0, 10) === dateString ? time : null;
    };
    const isValidDateString = (dateString) => parseDateString(dateString) !== null;
    const addDaysToDateString = (dateString, days) => new Date(parseDateString(dateString) + days * DAY_MS).toISOString().slice(0, 10);
    const countDaysBetween = (fromDate, toDate) => Math.round((parseDateString(toDate) - parseDateString(fromDate)) / DAY_MS);

    // ---------- 予約1件の、その日の数 ----------
    const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
    const toSafeCount = (value) => (isNonNegativeInteger(value) ? value : 0);
    // 予約の何泊目の夜か（0始まり。泊まる夜でなければ -1。チェックアウト日の夜は含まない）
    const findNightIndex = (reservation, date) => {
        const index = countDaysBetween(reservation.startDate, date);
        return index >= 0 && index < reservation.nights ? index : -1;
    };
    // 予約の何日目か（0始まり。利用日でなければ -1。チェックアウト日も利用日）
    const findDayIndex = (reservation, date) => {
        const index = countDaysBetween(reservation.startDate, date);
        return index >= 0 && index <= reservation.nights ? index : -1;
    };
    // キーごとの日ごとの数の表から、1つのキーの1日分の数を取り出す（index が -1 なら0）
    const pickCount = (countTable, key, index) => (index < 0 ? 0 : toSafeCount(countTable?.[key]?.[index]));
    const sumCountTableAt = (countTable, index) => Object.keys(countTable ?? {})
        .reduce((total, key) => total + pickCount(countTable, key, index), 0);
    // 予約1件の、その夜の宿泊人数（すべての区分・性別の合計）
    const countStayOnDate = (reservation, date) => sumCountTableAt(reservation.stays, findNightIndex(reservation, date));

    // ---------- 日別集計 ----------
    // その夜に泊まる人数の合計
    const countStayGuests = (reservationList, date) => reservationList
        .reduce((total, reservation) => total + countStayOnDate(reservation, date), 0);
    // その夜に宿泊する団体の数（宿泊人数が1人以上の予約の数）
    const countStayGroups = (reservationList, date) => reservationList
        .filter((reservation) => countStayOnDate(reservation, date) > 0).length;
    // その夜の、1つの区分×性別（"hs_m" など）の宿泊人数の合計
    const sumStayGuestType = (reservationList, date, guestTypeKey) => reservationList
        .reduce((total, reservation) => total + pickCount(reservation.stays, guestTypeKey, findNightIndex(reservation, date)), 0);
    // その夜の年代（料金区分）×男女別の内訳（{ es_m: 0, es_f: 0, hs_m: 20, ... }）
    const buildStayBreakdown = (reservationList, date, catalog) => Object.fromEntries(catalog.stayGuestTypes
        .map((guestType) => [guestType.key, sumStayGuestType(reservationList, date, guestType.key)]));
    // 食事の集計項目にふくまれる品目のキー
    const resolveMealKeys = (summaryItem, catalog) => summaryItem.mealKeys
        ?? catalog.meals.filter((meal) => meal.group === summaryItem.group).map((meal) => meal.key);
    // その日の、いくつかの品目の数の合計（すべての予約）
    const sumMealsOnDate = (reservationList, date, mealKeys) => reservationList.reduce((total, reservation) => total
        + mealKeys.reduce((subtotal, mealKey) => subtotal + pickCount(reservation.meals, mealKey, findDayIndex(reservation, date)), 0), 0);
    // その日の食事の項目別の合計（{ breakfast, lunch, dinner, bento, tea, onigiri }）
    const buildMealTotals = (reservationList, date, catalog) => Object.fromEntries(MEAL_SUMMARY_ITEMS
        .map((summaryItem) => [summaryItem.key, sumMealsOnDate(reservationList, date, resolveMealKeys(summaryItem, catalog))]));
    // 指定日の集計（宿泊合計人数・宿泊団体数・年代男女別の内訳・食事の項目別合計）
    const summarizeDailyReservations = (reservationList, date, catalog) => ({
        date,
        stayGuests: countStayGuests(reservationList, date),
        stayGroups: countStayGroups(reservationList, date),
        stayBreakdown: buildStayBreakdown(reservationList, date, catalog),
        meals: buildMealTotals(reservationList, date, catalog)
    });

    // ---------- 宿泊の空き状況（◎：空きあり ／ △：残りわずか ／ ×：満室） ----------
    const reachesThreshold = (stayGuests, stayGroups, threshold) => stayGuests >= threshold.guests || stayGroups >= threshold.groups;
    // 300人以上か6団体以上で×、200人以上か4団体以上で△、それ未満は◎（thresholds：STAY_THRESHOLDS）
    const judgeStaySymbol = (stayGuests, stayGroups, thresholds) => {
        if (reachesThreshold(stayGuests, stayGroups, thresholds.full)) return '×';
        return reachesThreshold(stayGuests, stayGroups, thresholds.few) ? '△' : '◎';
    };

    // SCHEDULE_EXPORTS:start
    // ブラウザでは window.ScheduleLogic、Node.js（テスト）では module.exports から使う
    const ScheduleLogic = Object.freeze({
        STAY_THRESHOLDS, MEAL_SUMMARY_ITEMS,
        isValidDateString, addDaysToDateString, countDaysBetween, findNightIndex, findDayIndex, countStayOnDate,
        countStayGuests, countStayGroups, buildStayBreakdown, buildMealTotals, summarizeDailyReservations, judgeStaySymbol
    });
    if (typeof module !== 'undefined') module.exports = ScheduleLogic;
    if (typeof window !== 'undefined') window.ScheduleLogic = ScheduleLogic;
    // SCHEDULE_EXPORTS:end
}
