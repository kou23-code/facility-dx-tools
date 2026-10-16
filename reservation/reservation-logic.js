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

// ---------- 空き状況（◎：空きあり ／ △：残りわずか・一部予約あり ／ ×：満室・予約済み） ----------
// 休館日か（closedDates の "MM-DD" は毎年、"YYYY-MM-DD" はその日だけ）
const isClosedDate = (date, closedDates) => closedDates.some((closedDate) => closedDate === date || closedDate === date.slice(5));
// その夜に泊まる人数の合計
const countStayGuests = (reservations, date) => reservations
    .filter((reservation) => listStayNights(reservation.startDate, reservation.nights).includes(date))
    .reduce((total, reservation) => total + reservation.people, 0);
const judgeStayAvailability = (bookedGuests, capacity, fewRatio) => {
    const remaining = capacity - bookedGuests;
    if (remaining <= 0) return '×';
    return remaining < capacity * fewRatio ? '△' : '◎';
};
const isSlotBooked = (reservations, slot) => reservations.some((reservation) => reservation.slots.some((booked) => isSameSlot(booked, slot)));
// 予約済みの時間帯のキーの一覧
const listBookedPeriodKeys = (reservations, date, facilityKey, periods) => periods
    .filter((period) => isSlotBooked(reservations, { date, facilityKey, periodKey: period.key }))
    .map((period) => period.key);
const judgeFacilityAvailability = (bookedCount, periodCount) => {
    if (bookedCount === 0) return '◎';
    return bookedCount >= periodCount ? '×' : '△';
};
const buildStayStatus = (reservations, date, config) => {
    const booked = countStayGuests(reservations, date);
    const symbol = judgeStayAvailability(booked, config.stayCapacity, config.fewRatio);
    return { booked, remaining: Math.max(config.stayCapacity - booked, 0), symbol };
};
const buildFacilityStatus = (reservations, date, facility, periods) => {
    const bookedPeriodKeys = listBookedPeriodKeys(reservations, date, facility.key, periods);
    return { facilityKey: facility.key, bookedPeriodKeys, symbol: judgeFacilityAvailability(bookedPeriodKeys.length, periods.length) };
};
// 日程の日ごとの空き状況（stay はその夜の宿泊。チェックアウト日・日帰りの日は null。休館日は施設もすべて×）
const buildAvailabilityRows = (reservations, startDate, nights, context) => listUsageDates(startDate, nights).map((date, index) => {
    const isClosed = isClosedDate(date, context.config.closedDates);
    const stay = index < nights ? buildStayStatus(reservations, date, context.config) : null;
    const facilities = context.catalog.facilities.map((facility) => buildFacilityStatus(reservations, date, facility, context.catalog.periods));
    const closedFacilities = facilities.map((status) => ({ ...status, symbol: '×' }));
    return { date, isClosed, stay: stay && isClosed ? { ...stay, symbol: '×' } : stay, facilities: isClosed ? closedFacilities : facilities };
});

// ---------- 重複・定員超過・予約不可の判定 ----------
// すでに予約が入っている施設コマ
const findSlotConflicts = (reservations, slots) => slots.filter((slot) => isSlotBooked(reservations, slot));
// 申込の中で2回以上選ばれている施設コマ（2回目以降を返す）
const findDuplicateSlots = (slots) => slots.filter((slot, index) => slots.findIndex((otherSlot) => isSameSlot(otherSlot, slot)) !== index);
// 宿泊定員を超える夜（{ date, booked, requested, remaining }）
const findCapacityOverflows = (reservations, request, capacity) => listStayNights(request.startDate, request.nights)
    .map((date) => ({ date, booked: countStayGuests(reservations, date) }))
    .filter(({ booked }) => booked + request.people > capacity)
    .map(({ date, booked }) => ({ date, booked, requested: request.people, remaining: Math.max(capacity - booked, 0) }));
// 日程の外の日、または知らない施設・時間帯の施設コマ
const findInvalidSlots = (request, catalog) => request.slots.filter((slot) => !listUsageDates(request.startDate, request.nights).includes(slot.date)
    || !findByKey(catalog.facilities, slot.facilityKey) || !findByKey(catalog.periods, slot.periodKey));
const formatSlotName = (slot, catalog) => `${findByKey(catalog.facilities, slot.facilityKey)?.name ?? slot.facilityKey} ${findByKey(catalog.periods, slot.periodKey)?.name ?? slot.periodKey}`;
const buildCapacityMessage = (overflow) => `${formatDateLabel(overflow.date)}の夜は宿泊定員を超えます（ご希望 ${overflow.requested}人 ／ 残り ${overflow.remaining}人）。人数か日程を変更してください。`;
const buildSlotConflictMessage = (slot, catalog) => `${formatDateLabel(slot.date)}の「${formatSlotName(slot, catalog)}」はすでに予約が入っています。別の時間帯か日程を選んでください。`;
const buildClosedMessage = (date) => `${formatDateLabel(date)}は休館日のため予約できません。日程を変更してください。`;
const canCheckSchedule = (request, config) => isValidDateString(request.startDate)
    && isNonNegativeInteger(request.nights) && request.nights <= config.maxNights;

// 空き状況による予約不可の理由（休館日・宿泊定員の超過・施設コマの重複）。context：{ reservations, config, catalog }
const findAvailabilityConflicts = (request, context) => {
    if (!canCheckSchedule(request, context.config)) return [];
    const closedDates = listUsageDates(request.startDate, request.nights).filter((date) => isClosedDate(date, context.config.closedDates));
    const people = toSafeCount(request.people);
    const overflows = findCapacityOverflows(context.reservations, { ...request, people }, context.config.stayCapacity);
    return [...closedDates.map(buildClosedMessage), ...overflows.map(buildCapacityMessage),
        ...findSlotConflicts(context.reservations, request.slots).map((slot) => buildSlotConflictMessage(slot, context.catalog)),
        ...findDuplicateSlots(request.slots).map((slot) => `${formatDateLabel(slot.date)}の「${formatSlotName(slot, context.catalog)}」が2回選ばれています。`)];
};

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
const findCountMessages = (request, config, catalog) => [
    !isValidDateString(request.startDate) && '利用開始日を選んでください',
    !(isNonNegativeInteger(request.nights) && request.nights <= config.maxNights) && `泊数は日帰り〜${config.maxNights}泊から選んでください`,
    !(isPositiveInteger(request.people) && request.people <= config.maxPeople) && `人数は1〜${config.maxPeople}人で入力してください`,
    !findByKey(catalog.priceTypes, request.priceType) && '料金区分を選んでください'
].filter(Boolean);
// 食数は0以上、人数×利用日数まで
const findMealMessages = (request, catalog) => {
    const limit = toSafeCount(request.people) * (toSafeCount(request.nights) + 1);
    return catalog.meals.filter((meal) => !(isNonNegativeInteger(request.meals?.[meal.key]) && request.meals[meal.key] <= limit))
        .map((meal) => `${meal.name}の食数は0〜${limit}食（人数×利用日数まで）で入力してください`);
};
const findEmptyRequestMessages = (request) => (request.nights === 0 && request.slots.length === 0
    ? ['宿泊（1泊以上）か、施設の利用コマを1つ以上選んでください'] : []);
// 入力の不備の一覧
const findInputMessages = (request, config, catalog) => [
    ...findMissingFieldMessages(request), ...findFormatMessages(request, catalog), ...findCountMessages(request, config, catalog),
    ...findMealMessages(request, catalog), ...findEmptyRequestMessages(request),
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
    && typeof slot.facilityKey === 'string' && typeof slot.periodKey === 'string';
// 予約1件として使える形か（空き状況の計算に使う項目を確認する）
const isValidReservation = (value) => typeof value === 'object' && value !== null
    && typeof value.id === 'string' && value.id !== '' && typeof value.groupName === 'string'
    && isValidDateString(value.startDate) && isNonNegativeInteger(value.nights) && isNonNegativeInteger(value.people)
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
const formatSlotList = (slots, catalog) => [...new Set(slots.map((slot) => slot.date))]
    .map((date) => `${formatDateLabel(date)} ${slots.filter((slot) => slot.date === date).map((slot) => formatSlotName(slot, catalog)).join('・')}`)
    .join(' ／ ');
const formatMealCounts = (meals, catalog) => catalog.meals.map((meal) => `${meal.name} ${toSafeCount(meals?.[meal.key])}食`).join('・');
// 控えとメールに載せる [見出し, 内容] の一覧
const buildReservationSummary = (reservation, catalog) => [
    ['予約番号', reservation.id], ['申込日時', reservation.createdAt.replace('T', ' ')],
    ['団体名', reservation.groupName], ['代表者名', reservation.representative],
    ['電話番号', reservation.phone], ['メールアドレス', reservation.email], ['利用目的', reservation.purpose],
    ['日程', formatScheduleLabel(reservation.startDate, reservation.nights)],
    ['人数', `${reservation.people}人（${findByKey(catalog.priceTypes, reservation.priceType)?.name ?? ''}）`],
    ['施設コマ', formatSlotList(reservation.slots, catalog) || 'なし'], ['食事数', formatMealCounts(reservation.meals, catalog)]
];
const buildMailSubject = (reservation) => `【Web予約申込】${reservation.groupName} ${formatDateLabel(reservation.startDate)}〜（予約番号 ${reservation.id}）`;
const buildMailBody = (reservation, catalog) => [
    'Web予約システムから予約の申込がありました。内容を確認してください。', '',
    ...buildReservationSummary(reservation, catalog).map(([label, value]) => `${label}：${value}`),
    `概算料金：${formatYen(calculateReservationFee(reservation, catalog).total)}（税込）`, '',
    '▼職員取込用1行コード（1行すべてをコピーして取り込んでください）', buildReservationCode(reservation)
].join('\n');
// メールソフトを開く mailto: の URL（件名・本文は URL 用に変換する）
const buildStaffMailUrl = (address, subject, body) => `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
// HTML に文字として埋め込むための変換
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

// ---------- デモ用のサンプル予約（baseDate：今日の "YYYY-MM-DD"。offset は今日から何日後か） ----------
// 既定の日程（3日後から2泊）を開くと、宿泊の△・大体育館の×・施設の△がすぐ確認できる並びにしている
const SAMPLE_SPECS = deepFreeze([
    { offset: 3, nights: 2, people: 40, priceType: 'hs', groupName: 'サンプル高校 陸上部', representative: '佐藤 花子', purpose: 'スポーツ合宿',
        meals: { bf: 80, lu: 80, di: 80 }, slots: [[0, 'field', 'am'], [0, 'field', 'pm'], [1, 'field', 'am'], [1, 'field', 'pm']] },
    { offset: 3, nights: 1, people: 45, priceType: 'ad', groupName: 'みどりスポーツクラブ', representative: '鈴木 一郎', purpose: 'サークル・クラブ活動',
        meals: { bf: 45, lu: 0, di: 45 }, slots: [[0, 'kL', 'ev'], [1, 'gym', 'am'], [1, 'gym', 'pm'], [1, 'gym', 'ev']] },
    { offset: 5, nights: 0, people: 30, priceType: 'es', groupName: 'やまびこスポーツ少年団', representative: '高橋 次郎', purpose: '大会・試合',
        meals: { bf: 0, lu: 30, di: 0 }, slots: [[0, 'gym_s', 'am'], [0, 'gym_s', 'pm'], [0, 'mr', 'pm']] },
    { offset: 10, nights: 3, people: 100, priceType: 'ad', groupName: 'あおぞら大学 バレーボール部', representative: '田中 三郎', purpose: 'スポーツ合宿',
        meals: { bf: 300, lu: 300, di: 300 }, slots: [[1, 'gym', 'am'], [1, 'gym', 'pm'], [2, 'gym', 'am'], [2, 'gym', 'pm']] }
]);
const buildSampleRequest = (spec, startDate, index) => ({
    groupName: spec.groupName, representative: spec.representative, phone: `000000000${index + 1}`,
    email: `sample${index + 1}@example.com`, purpose: spec.purpose, startDate, nights: spec.nights, priceType: spec.priceType,
    people: spec.people, meals: { ...spec.meals },
    slots: spec.slots.map(([day, facilityKey, periodKey]) => ({ date: addDaysToDateString(startDate, day), facilityKey, periodKey }))
});
// 動作確認用のサンプル予約（同じ baseDate なら毎回同じ内容）
const createSampleReservations = (baseDate, catalog) => SAMPLE_SPECS.map((spec, index) => ({
    ...createReservation(buildSampleRequest(spec, addDaysToDateString(baseDate, spec.offset), index), [], `${baseDate}T09:00`, catalog),
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
        toHalfWidthDigits, parseCount, isSameSlot, sortUniqueSlots, buildRequest,
        isStayRequest, pickFacilityPrice, calculateIncludedTax, calculateReservationFee, formatYen,
        isClosedDate, countStayGuests, judgeStayAvailability, isSlotBooked, judgeFacilityAvailability, buildAvailabilityRows,
        findSlotConflicts, findDuplicateSlots, findCapacityOverflows, formatSlotName, findAvailabilityConflicts,
        isPhoneNumber, findInputMessages, findScheduleMessages, findReservationBlockers,
        isValidReservation, parseStoredReservations, serializeReservations, appendReservation, isSampleReservation, mergeSampleReservations,
        createReservationId, createReservation, buildReservationCode, parseReservationCode, importReservationCode,
        buildReservationSummary, buildMailSubject, buildMailBody, buildStaffMailUrl, escapeHtml, createSampleReservations
    };
}
// RESERVATION_EXPORTS:end
