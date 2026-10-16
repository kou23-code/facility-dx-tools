// ======================================================
//  Web予約システムの計算・判定（純粋関数だけを置くファイル）
//  画面（reservation/index.html）とテスト（tests/）の両方から読み込む
//  ※DOM や localStorage には触らない。必要な値はすべて引数で受け取る
// ======================================================

// FACILITY_INFO:start
// 発行元の情報（ダミー表記）。実名は同じフォルダの facility-config.js（Git管理外）の
// window.CUSTOM_FACILITY_INFO に書く。テストがこのブロックを読み込むため、目印のコメントは消さない
const FACILITY_INFO = Object.freeze({
    organization: '株式会社サンプルリゾート',
    facilityName: 'あおぞらセミナーハウス',
    representativeTitle: '支配人',
    representativeName: '山田 太郎',
    postalCode: '100-0001',
    address: '東京都千代田区千代田1-1-1',
    tel: '03-0000-0000'
});
// 既定値を facility-config.js の設定で上書きする（既定値にあるキーの文字列だけを使う）
const resolveFacilityInfo = (defaults, custom) => Object.freeze(Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [key, typeof custom?.[key] === 'string' ? custom[key] : value])
));
// FACILITY_INFO:end

// ---------- 共通の設定 ----------
const RESERVATION_STORAGE_KEY = 'facility_dx_reservations'; // 予約データを保存する localStorage のキー（ツール共通）
const RESERVATION_CODE_TYPE = 'facility_dx_reservation';   // 職員取込用コードの種類
const RESERVATION_CODE_VERSION = 1;                         // 職員取込用コードの版
const SAMPLE_ID_PREFIX = 'SAMPLE-';                         // デモ用サンプル予約の予約番号の頭文字
const DAY_MS = 24 * 60 * 60 * 1000;

// 中身まで書き換えられないようにする（定数の定義にだけ使う）
const deepFreeze = (value) => {
    if (typeof value === 'object' && value !== null) Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
};

// 予約の受付ルール。facility-config.js の window.CUSTOM_RESERVATION_CONFIG で、書いたキーだけ上書きできる
const RESERVATION_CONFIG = deepFreeze({
    stayCapacity: 100,      // 1泊あたりの宿泊定員（人）
    fewRatio: 0.3,          // 宿泊の残りが定員のこの割合未満なら「△」
    maxNights: 6,           // 最大の泊数
    maxPeople: 300,         // 1件の予約の最大人数
    minLeadDays: 1,         // 今日から何日後以降の利用を受け付けるか（1 = 明日から）
    maxAdvanceDays: 365,    // 今日から何日先までの利用を受け付けるか
    closedDates: ['12-29', '12-30', '12-31', '01-01', '01-02', '01-03'], // 休館日（"MM-DD" は毎年、"YYYY-MM-DD" はその日だけ）
    staffEmail: 'reservation@example.com' // 予約の連絡を受ける職員のメールアドレス
});

const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;
const isRatio = (value) => typeof value === 'number' && value > 0 && value < 1;
const isClosedDateList = (value) => Array.isArray(value)
    && value.every((closedDate) => typeof closedDate === 'string' && /^(\d{4}-)?\d{2}-\d{2}$/.test(closedDate));
const isEmailAddress = (value) => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const CONFIG_VALIDATORS = Object.freeze({
    stayCapacity: isPositiveInteger, fewRatio: isRatio, maxNights: isPositiveInteger, maxPeople: isPositiveInteger,
    minLeadDays: isNonNegativeInteger, maxAdvanceDays: isPositiveInteger, closedDates: isClosedDateList, staffEmail: isEmailAddress
});

// 既定値を facility-config.js の設定で上書きする（正しい形の値だけを使い、結果は書き換えられないようにする）
const resolveReservationConfig = (defaults, custom) => deepFreeze(Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => {
        const customValue = custom?.[key];
        const isUsable = CONFIG_VALIDATORS[key](customValue);
        return [key, isUsable ? JSON.parse(JSON.stringify(customValue)) : value];
    })
));

// ---------- 料金表・施設（税込・円。概算見積もりシステムの料金表と同じ金額） ----------
const RESERVATION_CATALOG = deepFreeze({
    priceTypes: [{ key: 'es', name: '小・中学生' }, { key: 'hs', name: '高校生' }, { key: 'ad', name: '大学・一般' }],
    stayPrices: { es: 2200, hs: 2500, ad: 3300 }, // 宿泊料（1人1泊）
    meals: [{ key: 'bf', name: '朝食', price: 660 }, { key: 'lu', name: '昼食', price: 660 }, { key: 'di', name: '夕食', price: 990 }],
    periods: [
        { key: 'am', name: 'AM', time: '8:30~12:30', hours: 4 },
        { key: 'pm', name: 'PM', time: '12:30~17:00', hours: 4.5 },
        { key: 'ev', name: '夜', time: '17:00~21:00', hours: 4 }
    ],
    // billing：'slot' は1区分ごと、'hour' は1時間ごとの料金（区分の時間数で計算する）
    // prices：stay = 宿泊利用料金、day = 日帰り専有料金 ／ Adult = 大学・一般、Youth = 小中高
    facilities: [
        { key: 'gym', name: '大体育館', billing: 'slot', prices: { stayAdult: 8050, stayYouth: 5370, dayAdult: 10060, dayYouth: 6710 } },
        { key: 'gym_s', name: '小体育館', billing: 'slot', prices: { stayAdult: 4030, stayYouth: 2690, dayAdult: 5030, dayYouth: 3360 } },
        { key: 'field', name: '陸上/球技場', billing: 'slot', prices: { stayAdult: 5280, stayYouth: 3520, dayAdult: 6600, dayYouth: 4400 } },
        { key: 'kL', name: '大研修室(1･3研)', billing: 'hour', prices: { stayAdult: 950, stayYouth: 950, dayAdult: 1890, dayYouth: 1890 } },
        { key: 'kS', name: '小研修室(2研)', billing: 'hour', prices: { stayAdult: 630, stayYouth: 630, dayAdult: 1260, dayYouth: 1260 } },
        { key: 'mr', name: 'Mルーム', billing: 'hour', prices: { stayAdult: 330, stayYouth: 330, dayAdult: 660, dayYouth: 660 } }
    ],
    purposes: ['スポーツ合宿', '大会・試合', '研修・会議', '学校行事', 'サークル・クラブ活動', 'その他'],
    taxRate: 0.10 // 宿泊・食堂の食事・施設使用料はすべて標準税率
});

// ---------- 日付（"YYYY-MM-DD" の文字列のまま扱い、タイムゾーンでずれないよう UTC で計算する） ----------
const WEEKDAY_NAMES = Object.freeze(['日', '月', '火', '水', '木', '金', '土']);

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
const getWeekdayName = (dateString) => WEEKDAY_NAMES[new Date(parseDateString(dateString)).getUTCDay()];
const splitDateString = (dateString) => dateString.split('-').map(Number);

// "10/20(火)" の形
const formatDateLabel = (dateString) => {
    const [, month, day] = splitDateString(dateString);
    return `${month}/${day}(${getWeekdayName(dateString)})`;
};
// "2026年10月20日(火)" の形
const formatDateJapanese = (dateString) => {
    const [year, month, day] = splitDateString(dateString);
    return `${year}年${month}月${day}日(${getWeekdayName(dateString)})`;
};
// パソコンの時刻（ローカル時刻）の Date から "YYYY-MM-DD" を作る
const toLocalDateString = (date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0')).join('-');
// パソコンの時刻の Date から "YYYY-MM-DDTHH:mm" を作る
const toLocalDateTimeString = (date) => `${toLocalDateString(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
// 利用する日（チェックイン日〜チェックアウト日）の一覧
const listUsageDates = (startDate, nights) => Array.from({ length: nights + 1 }, (_, index) => addDaysToDateString(startDate, index));
// 泊まる夜の日付の一覧（チェックアウト日の夜は含まない）
const listStayNights = (startDate, nights) => listUsageDates(startDate, nights).slice(0, nights);
// "2026年10月20日(火)〜10月22日(木) 2泊3日" ／ "2026年10月20日(火) 日帰り"
const formatScheduleLabel = (startDate, nights) => {
    if (nights === 0) return `${formatDateJapanese(startDate)} 日帰り`;
    const endDate = addDaysToDateString(startDate, nights);
    return `${formatDateJapanese(startDate)}〜${formatDateJapanese(endDate).replace(/^\d+年/, '')} ${nights}泊${nights + 1}日`;
};

// ---------- 入力値の整理 ----------
// 全角の数字・ハイフンを半角にする
const toHalfWidthDigits = (text) => text.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0)).replace(/[－ー―‐]/g, '-');
const trimText = (value) => (typeof value === 'string' ? value.trim() : '');
// 数量の文字列を整数にする（空欄は0、数字以外・小数・マイナスは NaN にして入力エラーにする）
const parseCount = (value) => {
    const text = toHalfWidthDigits(trimText(String(value ?? '')));
    if (text === '') return 0;
    return /^\d+$/.test(text) ? Number(text) : NaN;
};
const toSafeCount = (value) => (isNonNegativeInteger(value) ? value : 0);

// ---------- 施設コマ ----------
const isSameSlot = (slot, otherSlot) => slot.date === otherSlot.date
    && slot.facilityKey === otherSlot.facilityKey && slot.periodKey === otherSlot.periodKey;
const findIndexByKey = (list, key) => list.findIndex((entry) => entry.key === key);
// 日付 → 施設の並び順 → 時間帯の並び順 で比べる
const compareSlots = (catalog) => (slot, otherSlot) => slot.date.localeCompare(otherSlot.date)
    || findIndexByKey(catalog.facilities, slot.facilityKey) - findIndexByKey(catalog.facilities, otherSlot.facilityKey)
    || findIndexByKey(catalog.periods, slot.periodKey) - findIndexByKey(catalog.periods, otherSlot.periodKey);
// 重なりを除いて並べた、新しい施設コマの一覧を返す
const sortUniqueSlots = (slots, catalog) => slots
    .filter((slot, index) => slots.findIndex((otherSlot) => isSameSlot(otherSlot, slot)) === index)
    .map((slot) => ({ date: slot.date, facilityKey: slot.facilityKey, periodKey: slot.periodKey }))
    .sort(compareSlots(catalog));

// ---------- 予約申込の内容（画面の入力値から作る） ----------
const buildContactPart = (formValues) => ({
    groupName: trimText(formValues.groupName),
    representative: trimText(formValues.representative),
    phone: toHalfWidthDigits(trimText(formValues.phone)),
    email: trimText(formValues.email),
    purpose: trimText(formValues.purpose)
});
const buildUsagePart = (formValues, catalog) => ({
    startDate: trimText(formValues.startDate),
    nights: parseCount(formValues.nights),
    priceType: trimText(formValues.priceType),
    people: parseCount(formValues.people),
    meals: Object.fromEntries(catalog.meals.map((meal) => [meal.key, parseCount(formValues.meals?.[meal.key])]))
});
// 予約申込の内容（formValues：画面の入力値の文字列、slots：選んだ施設コマ）
const buildRequest = (formValues, slots, catalog) => ({
    ...buildContactPart(formValues), ...buildUsagePart(formValues, catalog), slots: sortUniqueSlots(slots, catalog)
});

// ---------- 概算料金 ----------
const findByKey = (list, key) => list.find((entry) => entry.key === key);
// 宿泊者がいるか（いれば施設は「宿泊利用料金」、いなければ「日帰り専有料金」）
const isStayRequest = (request) => toSafeCount(request.nights) > 0 && toSafeCount(request.people) > 0;
const pickFacilityPrice = (facility, isStay, priceType) => facility.prices[`${isStay ? 'stay' : 'day'}${priceType === 'ad' ? 'Adult' : 'Youth'}`];
const sumSlotHours = (slots, periods) => slots.reduce((total, slot) => total + (findByKey(periods, slot.periodKey)?.hours ?? 0), 0);
const buildLine = (label, unitPrice, quantity, unit) => ({ label, unitPrice, quantity, unit, amount: Math.round(unitPrice * quantity) });

const buildStayFeeLine = (request, catalog) => {
    const typeName = findByKey(catalog.priceTypes, request.priceType)?.name ?? '';
    const unitPrice = catalog.stayPrices[request.priceType] ?? 0;
    return buildLine(`宿泊料（${typeName}）`, unitPrice, toSafeCount(request.people) * toSafeCount(request.nights), '人泊');
};
const buildMealFeeLines = (request, catalog) => catalog.meals
    .map((meal) => buildLine(meal.name, meal.price, toSafeCount(request.meals?.[meal.key]), '食'));
const buildFacilityFeeLine = (facility, request, catalog) => {
    const ownSlots = request.slots.filter((slot) => slot.facilityKey === facility.key);
    const isHourly = facility.billing === 'hour';
    const quantity = isHourly ? sumSlotHours(ownSlots, catalog.periods) : ownSlots.length;
    const unitPrice = pickFacilityPrice(facility, isStayRequest(request), request.priceType);
    return buildLine(facility.name, unitPrice, quantity, isHourly ? '時間' : '区分');
};
// 税込金額から内消費税を出す（1円未満は切り捨て。小数の誤差が出ないよう税率を1万分率の整数にする）
const calculateIncludedTax = (taxIncludedAmount, rate) => {
    const rateBasisPoints = Math.round(rate * 10000);
    return Math.floor(taxIncludedAmount * rateBasisPoints / (10000 + rateBasisPoints));
};
// 概算料金（数量が1以上の明細行、税込合計、うち消費税、宿泊利用料金かどうか）
const calculateReservationFee = (request, catalog) => {
    const lines = [buildStayFeeLine(request, catalog), ...buildMealFeeLines(request, catalog),
        ...catalog.facilities.map((facility) => buildFacilityFeeLine(facility, request, catalog))].filter((line) => line.quantity > 0);
    const total = lines.reduce((sum, line) => sum + line.amount, 0);
    return { lines, total, tax: calculateIncludedTax(total, catalog.taxRate), isStay: isStayRequest(request) };
};
const formatYen = (amount) => `${amount.toLocaleString('ja-JP')}円`;

// RESERVATION_EXPORTS:start
// Node.js（テスト）から読み込んだときだけ、関数をまとめて渡す（ブラウザでは何もしない）
if (typeof module !== 'undefined') {
    module.exports = {
        FACILITY_INFO, resolveFacilityInfo, RESERVATION_STORAGE_KEY, RESERVATION_CODE_TYPE, RESERVATION_CODE_VERSION, SAMPLE_ID_PREFIX,
        RESERVATION_CONFIG, resolveReservationConfig, RESERVATION_CATALOG,
        parseDateString, isValidDateString, addDaysToDateString, countDaysBetween, formatDateLabel, formatDateJapanese,
        toLocalDateString, toLocalDateTimeString, listUsageDates, listStayNights, formatScheduleLabel,
        toHalfWidthDigits, parseCount, isSameSlot, sortUniqueSlots, buildRequest,
        isStayRequest, pickFacilityPrice, calculateIncludedTax, calculateReservationFee, formatYen
    };
}
// RESERVATION_EXPORTS:end
