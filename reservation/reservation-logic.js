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
// 予約申込控えの発行元欄に出す3行
const buildIssuerLines = (info) => [`${info.organization} ${info.facilityName}`, `〒${info.postalCode} ${info.address}`, `TEL ${info.tel}`];
// FACILITY_INFO:end

// ---------- 共通の設定 ----------
const RESERVATION_STORAGE_KEY = 'facility_dx_reservations'; // 予約データを保存する localStorage のキー（ツール共通）
const RESERVATION_CODE_TYPE = 'facility_dx_reservation';   // 職員取込用コードの種類
const RESERVATION_CODE_VERSION = 3;                         // 職員取込用コードの版（3：宿泊人数を区分×性別ごとにした版）
const SAMPLE_ID_PREFIX = 'SAMPLE-';                         // デモ用サンプル予約の予約番号の頭文字
const DAY_MS = 24 * 60 * 60 * 1000;

// 中身まで書き換えられないようにする（定数の定義にだけ使う）
const deepFreeze = (value) => {
    if (typeof value === 'object' && value !== null) Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
};

// 予約の受付ルール。facility-config.js の window.CUSTOM_RESERVATION_CONFIG で、書いたキーだけ上書きできる
const RESERVATION_CONFIG = deepFreeze({
    stayCapacity: 300,      // 1日（1泊）あたりの、全団体の合計宿泊人数の上限（人）
    maxStayGroups: 6,       // 1日（1泊）あたりの、宿泊を受け入れる団体数の上限
    fewRatio: 0.3,          // 宿泊の残りが上限のこの割合未満なら「△」
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
    stayCapacity: isPositiveInteger, maxStayGroups: isPositiveInteger, fewRatio: isRatio, maxNights: isPositiveInteger, maxPeople: isPositiveInteger,
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
// 1時間単位のコマのキー（9時 → "h09"）
const toHourKey = (hour) => `h${String(hour).padStart(2, '0')}`;
// startHour 時から endHour 時までの1時間単位のコマ（9, 21 なら 9:00~10:00 〜 20:00~21:00 の12コマ）
const buildHourSlots = (startHour, endHour) => Array.from({ length: Math.max(endHour - startHour, 0) }, (_, index) => {
    const hour = startHour + index;
    return { key: toHourKey(hour), name: String(hour), label: `${hour}:00~${hour + 1}:00`, startHour: hour };
});

// 1時間のコマの表の見出し（9時のコマ → "9-10時"。1時間の枠であることがわかるようにする）
const formatHourHeader = (hourSlot) => `${hourSlot.startHour}-${hourSlot.startHour + 1}時`;

// 料金区分と性別の組み合わせ（宿泊人数の入力欄。キーは "es_m" のように 料金区分_性別）
const buildStayGuestTypes = (priceTypes, genders) => priceTypes.flatMap((priceType) => genders.map((gender) => ({
    key: `${priceType.key}_${gender.key}`, priceType: priceType.key, gender: gender.key, name: `${priceType.name} ${gender.name}`
})));
const PRICE_TYPES = deepFreeze([{ key: 'es', name: '小学生・中学生' }, { key: 'hs', name: '高校生' }, { key: 'ad', name: '大学生・一般' }]);
const GENDERS = deepFreeze([{ key: 'm', name: '男性', shortName: '男' }, { key: 'f', name: '女性', shortName: '女' }]);

const RESERVATION_CATALOG = deepFreeze({
    priceTypes: PRICE_TYPES,
    genders: GENDERS,
    stayGuestTypes: buildStayGuestTypes(PRICE_TYPES, GENDERS), // es_m・es_f・hs_m・hs_f・ad_m・ad_f
    stayPrices: { es: 2200, hs: 2500, ad: 3300 }, // 宿泊料（1人1泊）
    // 日ごとに数を入れる食事など。perPerson：1日あたり利用人数まで ／ reducedTax：軽減税率（8%）の対象
    meals: [
        { key: 'bf', name: '朝食', price: 660, unit: '食', group: '食堂の食事', perPerson: true, reducedTax: false },
        { key: 'lu', name: '昼食', price: 660, unit: '食', group: '食堂の食事', perPerson: true, reducedTax: false },
        { key: 'di', name: '夕食', price: 990, unit: '食', group: '食堂の食事', perPerson: true, reducedTax: false },
        { key: 'be_tatsu', name: '竜田揚げ弁当', price: 700, unit: '食', group: '弁当', perPerson: false, reducedTax: true },
        { key: 'be_maku', name: '幕の内弁当', price: 700, unit: '食', group: '弁当', perPerson: false, reducedTax: true },
        { key: 'be_kara', name: 'からマヨ丼', price: 600, unit: '食', group: '弁当', perPerson: false, reducedTax: true },
        { key: 'be_oni', name: 'おにぎり弁当', price: 400, unit: '食', group: '弁当', perPerson: false, reducedTax: true },
        { key: 'te', name: 'お茶', price: 150, unit: '本', group: 'お茶・おにぎり', perPerson: false, reducedTax: true },
        { key: 'on', name: '塩おにぎり(2個)', price: 200, unit: '食', group: 'お茶・おにぎり', perPerson: false, reducedTax: true }
    ],
    maxDailyItemCount: 999, // perPerson でない品目の1日あたりの上限
    // 体育館・競技場の区分（コマ）
    periods: [
        { key: 'am', name: 'AM', label: 'AM', time: '8:30~12:30' },
        { key: 'pm', name: 'PM', label: 'PM', time: '12:30~17:00' },
        { key: 'ev', name: '夜', label: '夜', time: '17:00~21:00' }
    ],
    // 研修室・ミーティングルームの1時間単位のコマ（9時〜21時）
    hourSlots: buildHourSlots(9, 21),
    // billing：'period' は区分（periods）ごと、'hour' は1時間（hourSlots）ごとの料金
    // prices：stay = 宿泊利用料金、day = 日帰り専有料金 ／ Adult = 大学・一般、Youth = 小中高
    facilities: [
        { key: 'gym', name: '大体育館', billing: 'period', prices: { stayAdult: 8050, stayYouth: 5370, dayAdult: 10060, dayYouth: 6710 } },
        { key: 'gym_s', name: '小体育館', billing: 'period', prices: { stayAdult: 4030, stayYouth: 2690, dayAdult: 5030, dayYouth: 3360 } },
        { key: 'field', name: '陸上/球技場', billing: 'period', prices: { stayAdult: 5280, stayYouth: 3520, dayAdult: 6600, dayYouth: 4400 } },
        { key: 'kL', name: '大研修室(1･3研)', billing: 'hour', prices: { stayAdult: 950, stayYouth: 950, dayAdult: 1890, dayYouth: 1890 } },
        { key: 'kS', name: '小研修室(2研)', billing: 'hour', prices: { stayAdult: 630, stayYouth: 630, dayAdult: 1260, dayYouth: 1260 } },
        { key: 'mr', name: 'ミーティングルーム', billing: 'hour', prices: { stayAdult: 330, stayYouth: 330, dayAdult: 660, dayYouth: 660 } }
    ],
    dayTripPriceType: 'ad', // 宿泊者がいないとき（日帰り）の施設料金の区分
    purposes: ['スポーツ合宿', '大会・試合', '研修・会議', '学校行事', 'サークル・クラブ活動', 'その他'],
    standardTaxRate: 0.10, // 宿泊・食堂の食事・施設使用料
    reducedTaxRate: 0.08   // 弁当・お茶・おにぎり（meals の reducedTax: true）
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

// ---------- 施設コマ（{ date, facilityKey, timeKey }。timeKey は区分 "am" か1時間 "h09"） ----------
const isSameSlot = (slot, otherSlot) => slot.date === otherSlot.date
    && slot.facilityKey === otherSlot.facilityKey && slot.timeKey === otherSlot.timeKey;
const findByKey = (list, key) => list.find((entry) => entry.key === key);
const findIndexByKey = (list, key) => list.findIndex((entry) => entry.key === key);
// 施設で選べるコマの一覧（区分の施設は AM・PM・夜、1時間の施設は 9時〜20時台）
const listTimeUnits = (facility, catalog) => (facility?.billing === 'hour' ? catalog.hourSlots : catalog.periods);
const findTimeUnit = (slot, catalog) => findByKey(listTimeUnits(findByKey(catalog.facilities, slot.facilityKey), catalog), slot.timeKey);
const findTimeIndex = (slot, catalog) => findIndexByKey(listTimeUnits(findByKey(catalog.facilities, slot.facilityKey), catalog), slot.timeKey);
// 日付 → 施設の並び順 → 時間の並び順 で比べる
const compareSlots = (catalog) => (slot, otherSlot) => slot.date.localeCompare(otherSlot.date)
    || findIndexByKey(catalog.facilities, slot.facilityKey) - findIndexByKey(catalog.facilities, otherSlot.facilityKey)
    || findTimeIndex(slot, catalog) - findTimeIndex(otherSlot, catalog);
// 重なりを除いて並べた、新しい施設コマの一覧を返す
const sortUniqueSlots = (slots, catalog) => slots
    .filter((slot, index) => slots.findIndex((otherSlot) => isSameSlot(otherSlot, slot)) === index)
    .map((slot) => ({ date: slot.date, facilityKey: slot.facilityKey, timeKey: slot.timeKey }))
    .sort(compareSlots(catalog));

// ---------- 予約申込の内容（画面の入力値から作る） ----------
const buildContactPart = (formValues) => ({
    groupName: trimText(formValues.groupName),
    representative: trimText(formValues.representative),
    phone: toHalfWidthDigits(trimText(formValues.phone)),
    email: trimText(formValues.email),
    purpose: trimText(formValues.purpose)
});
// 日ごとの数の一覧を、決まった日数分の整数にする（足りない日は0、余った日は捨てる）
const fitCounts = (values, length) => Array.from({ length }, (_, index) => parseCount(Array.isArray(values) ? values[index] : undefined));
// キーごとの日ごとの数の表を、keyedList のキーごとに決まった日数分の整数の配列にする
const fitCountTable = (table, keyedList, length) => Object.fromEntries(keyedList.map((entry) => [entry.key, fitCounts(table?.[entry.key], length)]));
const buildUsagePart = (formValues, catalog) => {
    const nights = parseCount(formValues.nights);
    const dayCount = toSafeCount(nights) + 1;
    const stays = fitCountTable(formValues.stays, catalog.stayGuestTypes, dayCount - 1);
    return {
        startDate: trimText(formValues.startDate), nights, ...buildDerivedStayPart(nights, stays, catalog),
        meals: fitCountTable(formValues.meals, catalog.meals, dayCount)
    };
};
// 宿泊人数と、そこから自動で決める料金区分（priceType）・利用人数（people）。どちらも画面に入力欄はない
const buildDerivedStayPart = (nights, stays, catalog) => ({
    priceType: resolveFacilityPriceType({ nights, stays }, catalog), people: countRequestPeople({ nights, stays }), stays
});
// 予約申込の内容（formValues：画面の入力値の文字列。stays は区分×性別ごとに泊まる夜ごと、meals は品目ごとに利用日ごとの配列。slots：選んだ施設コマ）
const buildRequest = (formValues, slots, catalog) => ({
    ...buildContactPart(formValues), ...buildUsagePart(formValues, catalog), slots: sortUniqueSlots(slots, catalog)
});

// ---------- 概算料金 ----------
// 日ごとの数の合計（正しくない数は0として数える）
const sumCounts = (counts) => (Array.isArray(counts) ? counts : []).reduce((total, count) => total + toSafeCount(count), 0);
// ---------- 宿泊人数（stays：区分×性別のキーごとに、泊まる夜ごとの人数の配列） ----------
// その夜の宿泊人数の合計（すべての区分・性別）
const sumStayOnNight = (stays, nightIndex) => Object.values(stays ?? {})
    .reduce((total, counts) => total + toSafeCount(Array.isArray(counts) ? counts[nightIndex] : undefined), 0);
// 夜ごとの宿泊人数の合計の一覧
const listNightTotals = (request) => Array.from({ length: toSafeCount(request.nights) }, (_, nightIndex) => sumStayOnNight(request.stays, nightIndex));
// 利用人数：夜ごとの宿泊人数の合計のうち、いちばん多い夜の人数（宿泊者がいなければ0）
const countRequestPeople = (request) => Math.max(0, ...listNightTotals(request));
// その夜の、1つの料金区分の宿泊人数（男女の合計）
const countStayOfPriceType = (stays, priceTypeKey, nightIndex, catalog) => catalog.stayGuestTypes
    .filter((type) => type.priceType === priceTypeKey)
    .reduce((total, type) => total + toSafeCount(stays?.[type.key]?.[nightIndex]), 0);
// 全日程の、1つの料金区分の宿泊人数（男女の合計）
const sumStayOfPriceType = (stays, priceTypeKey, catalog) => catalog.stayGuestTypes
    .filter((type) => type.priceType === priceTypeKey).reduce((total, type) => total + sumCounts(stays?.[type.key]), 0);
// 宿泊者がいるか（いれば施設は「宿泊利用料金」、いなければ「日帰り専有料金」）
const isStayRequest = (request) => Object.values(request.stays ?? {}).some((counts) => sumCounts(counts) > 0);
// 料金区分：宿泊者がいれば宿泊人数がいちばん多い区分（同じ人数なら 小中→高校→大学一般 の順で先のほう）、いなければ日帰りの区分（大学生・一般）
const resolveFacilityPriceType = (request, catalog) => {
    if (!isStayRequest(request)) return catalog.dayTripPriceType;
    return catalog.priceTypes.map((type) => ({ key: type.key, total: sumStayOfPriceType(request.stays, type.key, catalog) }))
        .reduce((best, entry) => (entry.total > best.total ? entry : best)).key;
};
const pickFacilityPrice = (facility, isStay, priceType) => facility.prices[`${isStay ? 'stay' : 'day'}${priceType === 'ad' ? 'Adult' : 'Youth'}`];
// 明細1行（isReducedTax：軽減税率の対象か）
const buildLine = (label, unitPrice, quantity, unit, isReducedTax) => ({ label, unitPrice, quantity, unit, isReducedTax, amount: Math.round(unitPrice * quantity) });
// 何日目（何泊目）かの表示。日付が正しければ "10/20(火)"、正しくなければ "1日目"
const formatDayOfRequest = (request, dayIndex) => (isValidDateString(request.startDate)
    ? formatDateLabel(addDaysToDateString(request.startDate, dayIndex)) : `${dayIndex + 1}日目`);

// 宿泊料は泊まる夜ごと・料金区分ごとに1行（男女の合計。数量の単位は「人／泊」）
const buildStayFeeLines = (request, catalog) => Array.from({ length: toSafeCount(request.nights) }, (_, nightIndex) => nightIndex)
    .flatMap((nightIndex) => catalog.priceTypes.map((type) => buildLine(
        `宿泊料（${type.name}） ${formatDayOfRequest(request, nightIndex)}泊`, catalog.stayPrices[type.key],
        countStayOfPriceType(request.stays, type.key, nightIndex, catalog), '人／泊', false)));
const buildMealFeeLines = (request, catalog) => catalog.meals
    .map((meal) => buildLine(meal.name, meal.price, sumCounts(request.meals?.[meal.key]), meal.unit, meal.reducedTax));
// 施設は「1区分の料金 × 区分の数」か「1時間の料金 × 時間の数」
const buildFacilityFeeLine = (facility, request, catalog) => {
    const quantity = request.slots.filter((slot) => slot.facilityKey === facility.key).length;
    const unitPrice = pickFacilityPrice(facility, isStayRequest(request), resolveFacilityPriceType(request, catalog));
    return buildLine(facility.name, unitPrice, quantity, facility.billing === 'hour' ? '時間' : '区分', false);
};
// 税込金額から内消費税を出す（1円未満は切り捨て。小数の誤差が出ないよう税率を1万分率の整数にする）
const calculateIncludedTax = (taxIncludedAmount, rate) => {
    const rateBasisPoints = Math.round(rate * 10000);
    return Math.floor(taxIncludedAmount * rateBasisPoints / (10000 + rateBasisPoints));
};
const sumLineAmounts = (lines) => lines.reduce((sum, line) => sum + line.amount, 0);
const buildTaxPart = (lines, rate) => {
    const taxIncluded = sumLineAmounts(lines);
    return { rate, taxIncluded, tax: calculateIncludedTax(taxIncluded, rate) };
};
// 税率ごとの内訳（standard：標準税率、reduced：軽減税率）
const calculateTaxBreakdown = (lines, catalog) => ({
    standard: buildTaxPart(lines.filter((line) => !line.isReducedTax), catalog.standardTaxRate),
    reduced: buildTaxPart(lines.filter((line) => line.isReducedTax), catalog.reducedTaxRate)
});
// 概算料金（数量が1以上の明細行、税込合計、税率ごとの内訳、うち消費税の合計、宿泊利用料金かどうか、施設料金の区分）
const calculateReservationFee = (request, catalog) => {
    const lines = [...buildStayFeeLines(request, catalog), ...buildMealFeeLines(request, catalog),
        ...catalog.facilities.map((facility) => buildFacilityFeeLine(facility, request, catalog))].filter((line) => line.quantity > 0);
    const taxBreakdown = calculateTaxBreakdown(lines, catalog);
    const tax = taxBreakdown.standard.tax + taxBreakdown.reduced.tax;
    return { lines, total: sumLineAmounts(lines), taxBreakdown, tax, isStay: isStayRequest(request), facilityPriceType: resolveFacilityPriceType(request, catalog) };
};
const formatYen = (amount) => `${amount.toLocaleString('ja-JP')}円`;
// 明細の数量の表示（"20（人／泊）" ／ "3（時間）" ／ "40（食）"）
const formatQuantity = (quantity, unit) => `${quantity.toLocaleString('ja-JP')}（${unit}）`;
// 概算料金に含めない料金の案内（画面と予約申込控えに出す）
const EXTRA_FEE_NOTE = '※体育館の照明代金、研修室の冷暖房代、および宿泊を伴わない日帰り参加者の施設利用料などは別途料金がかかります';

// ---------- 空き状況（◎：空きあり ／ △：残りわずか・一部予約あり ／ ×：満室・予約済み） ----------
// 休館日か（closedDates の "MM-DD" は毎年、"YYYY-MM-DD" はその日だけ）
const isClosedDate = (date, closedDates) => closedDates.some((closedDate) => closedDate === date || closedDate === date.slice(5));
// 予約1件の、その夜の宿泊人数（泊まる夜でなければ0）
const getStayCountOnDate = (reservation, date) => {
    const nightIndex = countDaysBetween(reservation.startDate, date);
    return nightIndex >= 0 && nightIndex < reservation.nights ? sumStayOnNight(reservation.stays, nightIndex) : 0;
};
// その夜に泊まる人数の合計
const countStayGuests = (reservations, date) => reservations
    .reduce((total, reservation) => total + getStayCountOnDate(reservation, date), 0);
// その夜に宿泊する団体の数（宿泊人数が1人以上の予約の数）
const countStayGroups = (reservations, date) => reservations.filter((reservation) => getStayCountOnDate(reservation, date) > 0).length;
// 宿泊の空き：人数が上限に達したか団体数が上限に達したら×、人数の残りが上限の30%未満か団体の残りが1団体なら△、それ以外は◎
const judgeStayAvailability = (bookedGuests, bookedGroups, config) => {
    const remaining = config.stayCapacity - bookedGuests;
    if (remaining <= 0 || bookedGroups >= config.maxStayGroups) return '×';
    return remaining < config.stayCapacity * config.fewRatio || bookedGroups >= config.maxStayGroups - 1 ? '△' : '◎';
};
const isSlotBooked = (reservations, slot) => reservations.some((reservation) => reservation.slots.some((booked) => isSameSlot(booked, slot)));
// 予約済みのコマのキーの一覧
const listBookedTimeKeys = (reservations, date, facilityKey, timeUnits) => timeUnits
    .filter((unit) => isSlotBooked(reservations, { date, facilityKey, timeKey: unit.key }))
    .map((unit) => unit.key);
const judgeFacilityAvailability = (bookedCount, unitCount) => {
    if (bookedCount === 0) return '◎';
    return bookedCount >= unitCount ? '×' : '△';
};
// その夜の宿泊の空き（予約済みの人数・団体数と、それぞれの残り）
const buildStayStatus = (reservations, date, config) => {
    const booked = countStayGuests(reservations, date);
    const groups = countStayGroups(reservations, date);
    const symbol = judgeStayAvailability(booked, groups, config);
    return { booked, remaining: Math.max(config.stayCapacity - booked, 0), groups, remainingGroups: Math.max(config.maxStayGroups - groups, 0), symbol };
};
const buildFacilityStatus = (reservations, date, facility, catalog) => {
    const timeUnits = listTimeUnits(facility, catalog);
    const bookedTimeKeys = listBookedTimeKeys(reservations, date, facility.key, timeUnits);
    return { facilityKey: facility.key, bookedTimeKeys, symbol: judgeFacilityAvailability(bookedTimeKeys.length, timeUnits.length) };
};
// 日程の日ごとの空き状況（stay はその夜の宿泊。チェックアウト日・日帰りの日は null。休館日は施設もすべて×）
const buildAvailabilityRows = (reservations, startDate, nights, context) => listUsageDates(startDate, nights).map((date, index) => {
    const isClosed = isClosedDate(date, context.config.closedDates);
    const stay = index < nights ? buildStayStatus(reservations, date, context.config) : null;
    const facilities = context.catalog.facilities.map((facility) => buildFacilityStatus(reservations, date, facility, context.catalog));
    const closedFacilities = facilities.map((status) => ({ ...status, symbol: '×' }));
    return { date, isClosed, stay: stay && isClosed ? { ...stay, symbol: '×' } : stay, facilities: isClosed ? closedFacilities : facilities };
});

// ---------- 重複・定員超過・予約不可の判定 ----------
// すでに予約が入っている施設コマ
const findSlotConflicts = (reservations, slots) => slots.filter((slot) => isSlotBooked(reservations, slot));
// 申込の中で2回以上選ばれている施設コマ（2回目以降を返す）
const findDuplicateSlots = (slots) => slots.filter((slot, index) => slots.findIndex((otherSlot) => isSameSlot(otherSlot, slot)) !== index);
// 宿泊定員を超える夜（{ date, booked, requested, remaining }）。その夜に泊まらない（0人）なら超えない
const findCapacityOverflows = (reservations, request, capacity) => listStayNights(request.startDate, request.nights)
    .map((date, nightIndex) => ({ date, booked: countStayGuests(reservations, date), requested: sumStayOnNight(request.stays, nightIndex) }))
    .filter(({ booked, requested }) => requested > 0 && booked + requested > capacity)
    .map((overflow) => ({ ...overflow, remaining: Math.max(capacity - overflow.booked, 0) }));
// 日程の外の日、または知らない施設・その施設で選べない時間の施設コマ
const findInvalidSlots = (request, catalog) => request.slots.filter((slot) => !listUsageDates(request.startDate, request.nights).includes(slot.date)
    || !findByKey(catalog.facilities, slot.facilityKey) || !findTimeUnit(slot, catalog));
// "大体育館 AM" ／ "大研修室(1･3研) 9:00~10:00"（知らないキーはそのまま出す）
const formatSlotName = (slot, catalog) => `${findByKey(catalog.facilities, slot.facilityKey)?.name ?? slot.facilityKey} ${findTimeUnit(slot, catalog)?.label ?? slot.timeKey}`;
// 宿泊する団体数が上限に達している夜（{ date, groups }）。その夜に泊まらない（0人）なら対象外
const findGroupLimitOverflows = (reservations, request, maxStayGroups) => listStayNights(request.startDate, request.nights)
    .map((date, nightIndex) => ({ date, groups: countStayGroups(reservations, date), requested: sumStayOnNight(request.stays, nightIndex) }))
    .filter(({ groups, requested }) => requested > 0 && groups >= maxStayGroups)
    .map(({ date, groups }) => ({ date, groups }));
const buildCapacityMessage = (overflow, capacity) => `${formatDateLabel(overflow.date)}の夜は、1日あたりの宿泊人数の上限（全団体で${capacity}人）を超えます`
    + `（ご希望 ${overflow.requested}人 ／ 残り ${overflow.remaining}人）。人数か日程を変更してください。`;
const buildGroupLimitMessage = (overflow, maxStayGroups) => `${formatDateLabel(overflow.date)}の夜は、1日あたりの宿泊受け入れ団体数の上限（${maxStayGroups}団体）に`
    + `達しています（予約済み ${overflow.groups}団体）。日程を変更してください。`;
const buildSlotConflictMessage = (slot, catalog) => `${formatDateLabel(slot.date)}の「${formatSlotName(slot, catalog)}」はすでに予約が入っています。別の時間帯か日程を選んでください。`;
const buildClosedMessage = (date) => `${formatDateLabel(date)}は休館日のため予約できません。日程を変更してください。`;
const canCheckSchedule = (request, config) => isValidDateString(request.startDate)
    && isNonNegativeInteger(request.nights) && request.nights <= config.maxNights;

// 空き状況による予約不可の理由（休館日・宿泊定員の超過・施設コマの重複）。context：{ reservations, config, catalog }
const findAvailabilityConflicts = (request, context) => {
    if (!canCheckSchedule(request, context.config)) return [];
    const closedDates = listUsageDates(request.startDate, request.nights).filter((date) => isClosedDate(date, context.config.closedDates));
    const { stayCapacity, maxStayGroups } = context.config;
    const overflows = findCapacityOverflows(context.reservations, request, stayCapacity);
    const groupOverflows = findGroupLimitOverflows(context.reservations, request, maxStayGroups);
    return [...closedDates.map(buildClosedMessage), ...overflows.map((overflow) => buildCapacityMessage(overflow, stayCapacity)),
        ...groupOverflows.map((overflow) => buildGroupLimitMessage(overflow, maxStayGroups)), ...findSlotMessages(request, context)];
};
// 施設コマの重複（予約済み・申込の中で2回）の文言
const findSlotMessages = (request, context) => [
    ...findSlotConflicts(context.reservations, request.slots).map((slot) => buildSlotConflictMessage(slot, context.catalog)),
    ...findDuplicateSlots(request.slots).map((slot) => `${formatDateLabel(slot.date)}の「${formatSlotName(slot, context.catalog)}」が2回選ばれています。`)
];

// ---------- 入力の不備の判定 ----------
const REQUIRED_FIELDS = Object.freeze([
    ['groupName', '団体名'], ['representative', '代表者名'], ['phone', '電話番号'], ['email', 'メールアドレス'], ['purpose', '利用目的']
]);
// 数字とハイフンだけで、数字が10〜11桁
const isPhoneNumber = (value) => /^[\d-]+$/.test(value) && /^\d{10,11}$/.test(value.replace(/-/g, ''));
const findMissingFieldMessages = (request) => REQUIRED_FIELDS
    .filter(([key]) => trimText(request[key]) === '').map(([, label]) => `${label}が未入力です`);
const findFormatMessages = (request, catalog) => [
    request.phone !== '' && !isPhoneNumber(request.phone) && '電話番号は数字とハイフンで10〜11桁を入力してください',
    request.email !== '' && !isEmailAddress(request.email) && 'メールアドレスの形が正しくありません',
    request.purpose !== '' && !catalog.purposes.includes(request.purpose) && '利用目的を一覧から選んでください'
].filter(Boolean);
const findCountMessages = (request, config) => [
    !isValidDateString(request.startDate) && '利用開始日を選んでください',
    !(isNonNegativeInteger(request.nights) && request.nights <= config.maxNights) && `利用日数は1〜${config.maxNights + 1}日から選んでください`
].filter(Boolean);
// 日ごとの数のうち、0〜上限の整数でない日のインデックス
const findInvalidDayIndexes = (counts, limit) => (Array.isArray(counts) ? counts : [])
    .map((count, dayIndex) => (isNonNegativeInteger(count) && count <= limit ? null : dayIndex)).filter((dayIndex) => dayIndex !== null);
// 宿泊人数の欄（区分×性別）は0以上の整数
const findStayFormatMessages = (request, catalog) => catalog.stayGuestTypes.flatMap((type) => findInvalidDayIndexes(request.stays?.[type.key], Infinity)
    .map((nightIndex) => `${formatDayOfRequest(request, nightIndex)}の宿泊人数（${type.name}）は0以上の整数で入力してください`));
// 夜ごとの宿泊人数の合計（区分・男女の合計）は1件の予約の上限人数まで
const findStayTotalMessages = (request, config) => listNightTotals(request)
    .map((total, nightIndex) => ({ total, nightIndex })).filter(({ total }) => total > config.maxPeople)
    .map(({ total, nightIndex }) => `${formatDayOfRequest(request, nightIndex)}の宿泊人数の合計（${total}人）が1件の予約の上限（${config.maxPeople}人）を超えています`);
const findStayMessages = (request, config, catalog) => [...findStayFormatMessages(request, catalog), ...findStayTotalMessages(request, config)];
// 食事などは日ごとに0〜上限まで（食堂の食事は1件の予約の上限人数まで、それ以外は maxDailyItemCount まで）
// ※食堂の食事は泊まらない日帰り参加者も食べるため、宿泊人数ではなく上限人数で止める
const findMealMessages = (request, config, catalog) => catalog.meals.flatMap((meal) => {
    const limit = meal.perPerson ? config.maxPeople : catalog.maxDailyItemCount;
    return findInvalidDayIndexes(request.meals?.[meal.key], limit).map((dayIndex) =>
        `${formatDayOfRequest(request, dayIndex)}の${meal.name}は0〜${limit}${meal.unit}${meal.perPerson ? '（1件の予約の上限人数まで）' : ''}で入力してください`);
});
const hasAnyMeal = (request) => Object.values(request.meals ?? {}).some((counts) => sumCounts(counts) > 0);
const findEmptyRequestMessages = (request) => (!isStayRequest(request) && request.slots.length === 0 && !hasAnyMeal(request)
    ? ['宿泊人数・施設コマ・食事のどれかを入力してください'] : []);
// 入力の不備の一覧
const findInputMessages = (request, config, catalog) => [
    ...findMissingFieldMessages(request), ...findFormatMessages(request, catalog), ...findCountMessages(request, config),
    ...findStayMessages(request, config, catalog), ...findMealMessages(request, config, catalog), ...findEmptyRequestMessages(request),
    ...(canCheckSchedule(request, config) ? findInvalidSlots(request, catalog) : []).map((slot) => `${formatDateLabel(slot.date)}の施設コマは選べません`)
];
// 受付期間の外か（today：今日の "YYYY-MM-DD"）
const findScheduleMessages = (request, config, today) => {
    if (!isValidDateString(request.startDate)) return [];
    const leadDays = countDaysBetween(today, request.startDate);
    return [
        leadDays < config.minLeadDays && `利用開始日は${formatDateJapanese(addDaysToDateString(today, config.minLeadDays))}以降を選んでください`,
        leadDays > config.maxAdvanceDays && `利用開始日は${formatDateJapanese(addDaysToDateString(today, config.maxAdvanceDays))}までを選んでください`
    ].filter(Boolean);
};
// 予約を確定できない理由のすべて（空なら確定できる）。context：{ reservations, config, catalog, today }
const findReservationBlockers = (request, context) => [
    ...findInputMessages(request, context.config, context.catalog),
    ...findScheduleMessages(request, context.config, context.today),
    ...findAvailabilityConflicts(request, context)
];

// ---------- 予約データ（localStorage に保存する配列） ----------
const isValidSlot = (slot) => typeof slot === 'object' && slot !== null && isValidDateString(slot.date)
    && typeof slot.facilityKey === 'string' && typeof slot.timeKey === 'string';
// 決まった日数分の、0以上の整数の配列か
const isCountList = (value, length) => Array.isArray(value) && value.length === length && value.every(isNonNegativeInteger);
// キーごとに決まった日数分の数の配列を持つオブジェクトか（宿泊人数・食事）
const isCountTable = (table, length) => typeof table === 'object' && table !== null && !Array.isArray(table)
    && Object.values(table).every((counts) => isCountList(counts, length));
// 予約1件として使える形か（空き状況の計算に使う項目を確認する。宿泊人数は夜ごと、食事は利用日ごとの配列）
const isValidReservation = (value) => typeof value === 'object' && value !== null
    && typeof value.id === 'string' && value.id !== '' && typeof value.groupName === 'string'
    && isValidDateString(value.startDate) && isNonNegativeInteger(value.nights) && isNonNegativeInteger(value.people)
    && isCountTable(value.stays, value.nights) && isCountTable(value.meals, value.nights + 1)
    && Array.isArray(value.slots) && value.slots.every(isValidSlot);
const safeParseJson = (text) => {
    try { return JSON.parse(text); } catch (error) { return null; }
};
// 保存データの文字列から予約の一覧を作る（壊れたデータは空、形の違う予約は除く）
const parseStoredReservations = (rawText) => {
    const parsed = safeParseJson(rawText);
    return Array.isArray(parsed) ? parsed.filter(isValidReservation) : [];
};
const serializeReservations = (reservations) => JSON.stringify(reservations);
const appendReservation = (reservations, reservation) => [...reservations, reservation];
const isSampleReservation = (reservation) => reservation.id.startsWith(SAMPLE_ID_PREFIX);
// サンプル予約を入れ直した、新しい一覧（前に入れたサンプルは消し、利用者の予約は残す）
const mergeSampleReservations = (reservations, samples) => [...reservations.filter((reservation) => !isSampleReservation(reservation)), ...samples];

// 予約番号 "R20261017-001"（申込日ごとの通し番号。使われている一番大きい番号の次）
const createReservationId = (createdAt, reservations) => {
    const prefix = `R${createdAt.slice(0, 10).replace(/-/g, '')}-`;
    const usedNumbers = reservations.filter((reservation) => reservation.id.startsWith(prefix))
        .map((reservation) => Number(reservation.id.slice(prefix.length))).filter(Number.isInteger);
    return `${prefix}${String(Math.max(0, ...usedNumbers) + 1).padStart(3, '0')}`;
};
// 申込の内容から予約1件を作る（createdAt：申込日時 "YYYY-MM-DDTHH:mm"）
const createReservation = (request, reservations, createdAt, catalog) => ({
    id: createReservationId(createdAt, reservations), createdAt, ...request,
    estimatedTotal: calculateReservationFee(request, catalog).total
});

// ---------- 職員取込用の1行コード ----------
// 改行を含まない1行の JSON（文字列の中の改行も \n に置き換わる）
const buildReservationCode = (reservation) => JSON.stringify({ type: RESERVATION_CODE_TYPE, version: RESERVATION_CODE_VERSION, reservation });
// 1行コードを読み取る（{ ok: true, reservation } または { ok: false, error }）
const parseReservationCode = (codeText) => {
    const parsed = safeParseJson(trimText(codeText));
    if (parsed?.type !== RESERVATION_CODE_TYPE) return { ok: false, error: '予約の取込用コードではありません' };
    if (parsed.version !== RESERVATION_CODE_VERSION) return { ok: false, error: `対応していない版のコードです（version ${parsed.version}）` };
    if (!isValidReservation(parsed.reservation)) return { ok: false, error: '予約の内容が正しくありません' };
    return { ok: true, reservation: parsed.reservation };
};
// 1行コードの予約を一覧に加える（同じ予約番号があれば加えない）
const importReservationCode = (reservations, codeText) => {
    const result = parseReservationCode(codeText);
    if (!result.ok) return result;
    if (reservations.some((reservation) => reservation.id === result.reservation.id)) return { ok: false, error: `予約番号 ${result.reservation.id} はすでに取り込まれています` };
    return { ok: true, reservations: appendReservation(reservations, result.reservation) };
};

// ---------- 予約申込控え・職員宛てメール ----------
// 続いている時間をまとめる（[9, 10, 13] → [[9, 11], [13, 14]]。終わりの時刻は含まない）
const mergeHourRanges = (hours) => [...hours].sort((hour, otherHour) => hour - otherHour).reduce((ranges, hour) => {
    const lastRange = ranges[ranges.length - 1];
    return lastRange && lastRange[1] === hour ? [...ranges.slice(0, -1), [lastRange[0], hour + 1]] : [...ranges, [hour, hour + 1]];
}, []);
const formatHourRanges = (ranges) => ranges.map(([startHour, endHour]) => `${startHour}:00~${endHour}:00`).join('・');
// 1つの施設の、1日分のコマ（"大体育館 AM・PM" ／ "大研修室(1･3研) 9:00~11:00・13:00~14:00"）
const formatFacilitySlots = (facilityKey, slots, catalog) => {
    const facility = findByKey(catalog.facilities, facilityKey);
    if (facility?.billing !== 'hour') return `${facility?.name ?? facilityKey} ${slots.map((slot) => findTimeUnit(slot, catalog)?.label ?? slot.timeKey).join('・')}`;
    const hours = slots.map((slot) => findTimeUnit(slot, catalog)?.startHour).filter(Number.isInteger);
    return `${facility.name} ${formatHourRanges(mergeHourRanges(hours))}`;
};
const formatSlotsOfDate = (date, slots, catalog) => {
    const daySlots = slots.filter((slot) => slot.date === date);
    const facilityKeys = [...new Set(daySlots.map((slot) => slot.facilityKey))];
    return `${formatDateLabel(date)} ${facilityKeys.map((key) => formatFacilitySlots(key, daySlots.filter((slot) => slot.facilityKey === key), catalog)).join('、')}`;
};
const formatSlotList = (slots, catalog) => [...new Set(slots.map((slot) => slot.date))]
    .map((date) => formatSlotsOfDate(date, slots, catalog)).join(' ／ ');
// "10/20(火) 40人・10/21(水) 38人"（日帰りは「なし（日帰り）」、全員0人は「なし」）
// その夜の内訳 "高校生 男20・女18、大学生・一般 男2"（人数が1人以上の区分・性別だけ）
const formatStayBreakdown = (stays, nightIndex, catalog) => catalog.priceTypes
    .map((priceType) => ({ priceType, parts: catalog.genders
        .map((gender) => ({ gender, count: toSafeCount(stays?.[`${priceType.key}_${gender.key}`]?.[nightIndex]) })).filter(({ count }) => count > 0) }))
    .filter(({ parts }) => parts.length > 0)
    .map(({ priceType, parts }) => `${priceType.name} ${parts.map(({ gender, count }) => `${gender.shortName}${count}`).join('・')}`).join('、');
// "10/20(火) 38人（高校生 男20・女18） ／ 10/21(水) …"（日帰りは「なし（日帰り）」、全員0人は「なし」）
const formatStayCounts = (reservation, catalog) => {
    if (reservation.nights === 0) return 'なし（日帰り）';
    if (!isStayRequest(reservation)) return 'なし';
    return listNightTotals(reservation).map((total, nightIndex) => `${formatDayOfRequest(reservation, nightIndex)} ${total}人`
        + (total > 0 ? `（${formatStayBreakdown(reservation.stays, nightIndex, catalog)}）` : '')).join(' ／ ');
};
// "朝食 80食（10/21(水) 40・10/22(木) 40） ／ お茶 45本（10/20(火) 45）"（数が1以上の品目と日だけ。なければ「なし」）
const formatMealCounts = (reservation, catalog) => catalog.meals
    .filter((meal) => sumCounts(reservation.meals?.[meal.key]) > 0)
    .map((meal) => {
        const days = reservation.meals[meal.key].map((count, dayIndex) => ({ count, dayIndex })).filter(({ count }) => count > 0);
        const dayText = days.map(({ count, dayIndex }) => `${formatDayOfRequest(reservation, dayIndex)} ${count}`).join('・');
        return `${meal.name} ${sumCounts(reservation.meals[meal.key])}${meal.unit}（${dayText}）`;
    }).join(' ／ ') || 'なし';
// "38人（高校生）"（宿泊人数から決めた利用人数と料金区分。宿泊者がいなければ「宿泊者なし」）
const formatPeopleSummary = (reservation, catalog) => (isStayRequest(reservation)
    ? `${countRequestPeople(reservation)}人（${findByKey(catalog.priceTypes, resolveFacilityPriceType(reservation, catalog)).name}）` : '宿泊者なし');
// 控えとメールに載せる [見出し, 内容] の一覧
const buildReservationSummary = (reservation, catalog) => [
    ['予約番号', reservation.id], ['申込日時', reservation.createdAt.replace('T', ' ')],
    ['団体名', reservation.groupName], ['代表者名', reservation.representative],
    ['電話番号', reservation.phone], ['メールアドレス', reservation.email], ['利用目的', reservation.purpose],
    ['日程', formatScheduleLabel(reservation.startDate, reservation.nights)],
    ['利用人数', formatPeopleSummary(reservation, catalog)],
    ['宿泊人数', formatStayCounts(reservation, catalog)],
    ['施設コマ', formatSlotList(reservation.slots, catalog) || 'なし'], ['食事など', formatMealCounts(reservation, catalog)]
];
const buildMailSubject = (reservation) => `【Web予約申込】${reservation.groupName} ${formatDateLabel(reservation.startDate)}〜（予約番号 ${reservation.id}）`;
const buildMailBody = (reservation, catalog) => [
    'Web予約システムから予約の申込がありました。内容を確認してください。', '',
    ...buildReservationSummary(reservation, catalog).map(([label, value]) => `${label}：${value}`),
    `概算料金：${formatYen(calculateReservationFee(reservation, catalog).total)}（税込）`, '',
    '▼施設の予約管理用データ（この行と次の行は消したり書き換えたりせず、そのまま送信してください）', buildReservationCode(reservation)
].join('\n');
// メールソフトを開く mailto: の URL（件名・本文は URL 用に変換する）
const buildStaffMailUrl = (address, subject, body) => `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
// HTML に文字として埋め込むための変換
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

// ---------- デモ用のサンプル予約（baseDate：今日の "YYYY-MM-DD"。offset は今日から何日後か） ----------
// 既定の日程（3日後から2泊）を開くと、宿泊の△・大体育館の×・施設の△がすぐ確認できる並びにしている
// サンプルの1時間単位のコマ（day 日目の startHour 時から endHour 時まで）
const buildSampleHours = (day, facilityKey, startHour, endHour) => Array.from({ length: endHour - startHour },
    (_, index) => [day, facilityKey, toHourKey(startHour + index)]);
// stays は区分×性別ごとに泊まる夜ごと、meals は品目ごとに利用日ごとの数（書いていないキーは毎日0）。slots は [何日目(0始まり), 施設, コマ]
const SAMPLE_SPECS = deepFreeze([
    { offset: 3, nights: 2, groupName: 'サンプル高校 陸上部', representative: '佐藤 花子', purpose: 'スポーツ合宿',
        stays: { hs_m: [20, 19], hs_f: [20, 19] }, meals: { bf: [0, 40, 38], lu: [40, 40, 38], di: [40, 38, 0] },
        slots: [[0, 'field', 'am'], [0, 'field', 'pm'], [1, 'field', 'am'], [1, 'field', 'pm']] },
    { offset: 3, nights: 1, groupName: 'みどりスポーツクラブ', representative: '鈴木 一郎', purpose: 'サークル・クラブ活動',
        stays: { ad_m: [25], ad_f: [20] }, meals: { bf: [0, 45], di: [45, 0], te: [45, 0] },
        slots: [...buildSampleHours(0, 'kL', 17, 21), [1, 'gym', 'am'], [1, 'gym', 'pm'], [1, 'gym', 'ev']] },
    { offset: 5, nights: 0, groupName: 'やまびこスポーツ少年団', representative: '高橋 次郎', purpose: '大会・試合',
        stays: {}, meals: { be_oni: [30], te: [30] }, slots: [[0, 'gym_s', 'am'], [0, 'gym_s', 'pm'], ...buildSampleHours(0, 'mr', 13, 17)] },
    { offset: 10, nights: 3, groupName: 'あおぞら大学 バレーボール部', representative: '田中 三郎', purpose: 'スポーツ合宿',
        stays: { ad_m: [60, 60, 60], ad_f: [40, 40, 40] }, meals: { bf: [0, 100, 100, 100], lu: [100, 100, 100, 0], di: [100, 100, 100, 0] },
        slots: [[1, 'gym', 'am'], [1, 'gym', 'pm'], [2, 'gym', 'am'], [2, 'gym', 'pm']] },
    // 既定の日程の1泊目を、全団体で225人（上限300人の残り75人）にして△を見せる
    { offset: 3, nights: 2, groupName: 'さくら中学校 バスケットボール部', representative: '伊藤 四郎', purpose: 'スポーツ合宿',
        stays: { es_m: [30, 28], es_f: [30, 27] }, meals: {}, slots: [] },
    { offset: 3, nights: 1, groupName: 'ひかり大学 サッカー部', representative: '渡辺 五郎', purpose: 'スポーツ合宿',
        stays: { ad_m: [80] }, meals: {}, slots: [] },
    // 10日後の夜を、上の大学（100人）と合わせて6団体にし、人数に余裕があっても団体数の上限で×になることを見せる
    ...['わかば剣道クラブ', 'ひまわり合唱団', 'こだま吹奏楽部', 'いずみ研修会', 'あさひ陸上クラブ'].map((groupName, index) => ({
        offset: 10, nights: 1, groupName, representative: `山本 ${['一', '二', '三', '四', '五'][index]}郎`,
        purpose: 'サークル・クラブ活動', stays: { ad_m: [5], ad_f: [5] }, meals: {}, slots: [] }))
]);
// サンプルの宿泊人数・食事を、すべてのキー・日の配列にする（keyedList：stayGuestTypes か meals）
const fillCountTable = (specTable, keyedList, length) => Object.fromEntries(keyedList
    .map((entry) => [entry.key, Array.from({ length }, (_, dayIndex) => specTable[entry.key]?.[dayIndex] ?? 0)]));
const buildSampleRequest = (spec, startDate, index, catalog) => ({
    groupName: spec.groupName, representative: spec.representative, phone: `000000000${index + 1}`,
    email: `sample${index + 1}@example.com`, purpose: spec.purpose, startDate, nights: spec.nights,
    ...buildDerivedStayPart(spec.nights, fillCountTable(spec.stays, catalog.stayGuestTypes, spec.nights), catalog),
    meals: fillCountTable(spec.meals, catalog.meals, spec.nights + 1),
    slots: spec.slots.map(([day, facilityKey, timeKey]) => ({ date: addDaysToDateString(startDate, day), facilityKey, timeKey }))
});
// 動作確認用のサンプル予約（同じ baseDate なら毎回同じ内容）
const createSampleReservations = (baseDate, catalog) => SAMPLE_SPECS.map((spec, index) => ({
    ...createReservation(buildSampleRequest(spec, addDaysToDateString(baseDate, spec.offset), index, catalog), [], `${baseDate}T09:00`, catalog),
    id: `${SAMPLE_ID_PREFIX}${String(index + 1).padStart(3, '0')}`
}));

// RESERVATION_EXPORTS:start
// Node.js（テスト）から読み込んだときだけ、関数をまとめて渡す（ブラウザでは何もしない）
if (typeof module !== 'undefined') {
    module.exports = {
        FACILITY_INFO, resolveFacilityInfo, buildIssuerLines, RESERVATION_STORAGE_KEY, RESERVATION_CODE_TYPE, RESERVATION_CODE_VERSION, SAMPLE_ID_PREFIX,
        RESERVATION_CONFIG, resolveReservationConfig, RESERVATION_CATALOG,
        parseDateString, isValidDateString, addDaysToDateString, countDaysBetween, formatDateLabel, formatDateJapanese,
        toLocalDateString, toLocalDateTimeString, listUsageDates, listStayNights, formatScheduleLabel,
        toHourKey, buildHourSlots, formatHourHeader, listTimeUnits, mergeHourRanges, formatSlotList,
        toHalfWidthDigits, parseCount, isSameSlot, sortUniqueSlots, buildRequest,
        sumCounts, sumStayOnNight, listNightTotals, countRequestPeople, countStayOfPriceType, resolveFacilityPriceType, isStayRequest, pickFacilityPrice, calculateIncludedTax, calculateTaxBreakdown, calculateReservationFee, formatYen, formatQuantity, EXTRA_FEE_NOTE,
        isClosedDate, getStayCountOnDate, countStayGuests, countStayGroups, judgeStayAvailability, isSlotBooked, judgeFacilityAvailability, buildAvailabilityRows,
        findSlotConflicts, findDuplicateSlots, findCapacityOverflows, findGroupLimitOverflows, formatSlotName, findAvailabilityConflicts,
        isPhoneNumber, findInputMessages, findScheduleMessages, findReservationBlockers,
        isValidReservation, parseStoredReservations, serializeReservations, appendReservation, isSampleReservation, mergeSampleReservations,
        createReservationId, createReservation, buildReservationCode, parseReservationCode, importReservationCode,
        buildReservationSummary, buildMailSubject, buildMailBody, buildStaffMailUrl, escapeHtml, createSampleReservations
    };
}
// RESERVATION_EXPORTS:end
