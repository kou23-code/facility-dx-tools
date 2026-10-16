// Web予約システム：設定・日付・入力値の整理・概算料金の動作確認テスト
// 実行方法：node --test tests/reservation-fee.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { RESERVATION_LOGIC_PATH, readHtml } = require('./helpers');
const logic = require(RESERVATION_LOGIC_PATH);

const {
    RESERVATION_CONFIG, resolveReservationConfig, RESERVATION_CATALOG: CATALOG,
    parseDateString, isValidDateString, addDaysToDateString, countDaysBetween, formatDateLabel, formatDateJapanese,
    toLocalDateString, toLocalDateTimeString, listUsageDates, listStayNights, formatScheduleLabel,
    toHalfWidthDigits, parseCount, sortUniqueSlots, buildRequest,
    isStayRequest, pickFacilityPrice, calculateIncludedTax, calculateReservationFee, formatYen
} = logic;

const toPlain = (value) => JSON.parse(JSON.stringify(value));

// 概算見積もりシステム（estimate/index.html）の料金表 categories を読み込む
const loadEstimateCategories = () => {
    const source = /const categories = (\[[\s\S]*?\n {8}\]);/.exec(readHtml())[1];
    return vm.runInNewContext(`(${source})`);
};
const findEstimateItem = (categories, key) => categories.flatMap((category) => category.items).find((item) => item.key === key);

const buildSampleRequest = (overrides) => ({
    groupName: 'サンプル高校 陸上部', representative: '山田 太郎', phone: '0000000000', email: 'sample@example.com',
    purpose: 'スポーツ合宿', startDate: '2026-11-02', nights: 2, priceType: 'hs', people: 20,
    meals: { bf: 0, lu: 0, di: 0 }, slots: [], ...overrides
});

test('RESERVATION_CONFIG の既定値と、書き換えられないこと', () => {
    assert.deepStrictEqual(toPlain(RESERVATION_CONFIG), {
        stayCapacity: 100, fewRatio: 0.3, maxNights: 6, maxPeople: 300, minLeadDays: 1, maxAdvanceDays: 365,
        closedDates: ['12-29', '12-30', '12-31', '01-01', '01-02', '01-03'], staffEmail: 'reservation@example.com'
    });
    assert.ok(Object.isFrozen(RESERVATION_CONFIG) && Object.isFrozen(RESERVATION_CONFIG.closedDates));
});

test('resolveReservationConfig は設定がなければ既定値、書いたキーだけを上書きする', () => {
    assert.deepStrictEqual(toPlain(resolveReservationConfig(RESERVATION_CONFIG, undefined)), toPlain(RESERVATION_CONFIG));
    const resolved = resolveReservationConfig(RESERVATION_CONFIG, { stayCapacity: 80, closedDates: ['2026-11-03'], staffEmail: 'staff@example.com' });
    assert.deepStrictEqual(toPlain(resolved), { ...toPlain(RESERVATION_CONFIG), stayCapacity: 80, closedDates: ['2026-11-03'], staffEmail: 'staff@example.com' });
    assert.ok(Object.isFrozen(resolved) && Object.isFrozen(resolved.closedDates));
});

test('resolveReservationConfig は正しくない値と知らないキーを無視する', () => {
    const custom = { stayCapacity: 0, fewRatio: 1, maxNights: 2.5, maxPeople: '50', minLeadDays: -1, maxAdvanceDays: null,
        closedDates: ['11/3'], staffEmail: 'not-mail', unknownKey: 1 };
    assert.deepStrictEqual(toPlain(resolveReservationConfig(RESERVATION_CONFIG, custom)), toPlain(RESERVATION_CONFIG));
    assert.strictEqual(resolveReservationConfig(RESERVATION_CONFIG, { minLeadDays: 0 }).minLeadDays, 0, '0日（当日から）は認める');
});

test('予約システムの料金は、概算見積もりシステムの料金表と同じ金額になっている', () => {
    const categories = loadEstimateCategories();
    Object.entries(CATALOG.stayPrices).forEach(([type, price]) => assert.strictEqual(price, findEstimateItem(categories, type).price, type));
    CATALOG.meals.forEach((meal) => assert.strictEqual(meal.price, findEstimateItem(categories, meal.key).price, meal.key));
    CATALOG.facilities.forEach((facility) => {
        const item = findEstimateItem(categories, facility.key);
        assert.strictEqual(facility.name, item.name);
        [[true, 'ad'], [true, 'es'], [true, 'hs'], [false, 'ad'], [false, 'es'], [false, 'hs']].forEach(([isStay, type]) => {
            assert.strictEqual(pickFacilityPrice(facility, isStay, type), item.calcPrice(isStay, type), `${facility.key} ${isStay} ${type}`);
        });
    });
});

test('区分の時間数は AM 4時間・PM 4.5時間・夜 4時間で、料金表は書き換えられない', () => {
    assert.deepStrictEqual(toPlain(CATALOG.periods.map((period) => [period.key, period.hours])), [['am', 4], ['pm', 4.5], ['ev', 4]]);
    assert.ok(Object.isFrozen(CATALOG.facilities[0].prices));
});

test('parseDateString・isValidDateString は存在する日付の "YYYY-MM-DD" だけを認める', () => {
    assert.strictEqual(parseDateString('2026-10-17'), Date.UTC(2026, 9, 17));
    ['2026-10-17', '2028-02-29', '2000-02-29'].forEach((date) => assert.strictEqual(isValidDateString(date), true, date));
    ['2026-02-29', '2100-02-29', '2026-13-01', '2026-1-5', '', null, undefined, 20261017].forEach((date) => {
        assert.strictEqual(isValidDateString(date), false, String(date));
    });
});

test('addDaysToDateString・countDaysBetween は月末・年末・うるう年をまたいでも正しい', () => {
    assert.strictEqual(addDaysToDateString('2026-12-31', 1), '2027-01-01');
    assert.strictEqual(addDaysToDateString('2028-02-28', 1), '2028-02-29');
    assert.strictEqual(addDaysToDateString('2026-03-01', -1), '2026-02-28');
    assert.strictEqual(countDaysBetween('2026-10-17', '2027-10-17'), 365);
    assert.strictEqual(countDaysBetween('2026-10-17', '2026-10-16'), -1);
});

test('日付の表示（M/D(曜)・YYYY年M月D日(曜)・日程）', () => {
    assert.strictEqual(formatDateLabel('2026-10-20'), '10/20(火)');
    assert.strictEqual(formatDateJapanese('2026-11-01'), '2026年11月1日(日)');
    assert.strictEqual(formatScheduleLabel('2026-10-20', 0), '2026年10月20日(火) 日帰り');
    assert.strictEqual(formatScheduleLabel('2026-12-30', 2), '2026年12月30日(水)〜1月1日(金) 2泊3日');
});

test('toLocalDateString・toLocalDateTimeString はパソコンの時刻で日付を作る', () => {
    assert.strictEqual(toLocalDateString(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
    assert.strictEqual(toLocalDateTimeString(new Date(2026, 9, 7, 8, 5)), '2026-10-07T08:05');
});

test('listUsageDates は利用する日、listStayNights は泊まる夜だけを返す', () => {
    assert.deepStrictEqual(listUsageDates('2026-10-30', 2), ['2026-10-30', '2026-10-31', '2026-11-01']);
    assert.deepStrictEqual(listStayNights('2026-10-30', 2), ['2026-10-30', '2026-10-31']);
    assert.deepStrictEqual(listUsageDates('2026-10-30', 0), ['2026-10-30']);
    assert.deepStrictEqual(listStayNights('2026-10-30', 0), []);
});

test('toHalfWidthDigits・parseCount は全角を半角にし、空欄は0、正しくない数は NaN にする', () => {
    assert.strictEqual(toHalfWidthDigits('０９０－１２３４'), '090-1234');
    assert.deepStrictEqual(['', '  ', '0', '12', '１２', ' 7 ', undefined].map(parseCount), [0, 0, 0, 12, 12, 7, 0]);
    ['-1', '1.5', 'abc', '1e3'].forEach((text) => assert.ok(Number.isNaN(parseCount(text)), text));
});

test('sortUniqueSlots は重なりを除いて日付・施設・時間帯の順に並べ、元の配列を書き換えない', () => {
    const slots = [
        { date: '2026-11-03', facilityKey: 'gym', periodKey: 'pm' }, { date: '2026-11-02', facilityKey: 'kL', periodKey: 'am' },
        { date: '2026-11-02', facilityKey: 'gym', periodKey: 'ev' }, { date: '2026-11-03', facilityKey: 'gym', periodKey: 'pm' },
        { date: '2026-11-02', facilityKey: 'gym', periodKey: 'am' }
    ];
    const original = toPlain(slots);
    assert.deepStrictEqual(sortUniqueSlots(slots, CATALOG).map((slot) => `${slot.date} ${slot.facilityKey} ${slot.periodKey}`),
        ['2026-11-02 gym am', '2026-11-02 gym ev', '2026-11-02 kL am', '2026-11-03 gym pm']);
    assert.deepStrictEqual(slots, original);
});

test('buildRequest は入力値の前後の空白を除き、数を整数にし、全角の電話番号を半角にする', () => {
    const formValues = { groupName: ' サンプル高校 ', representative: '山田 太郎 ', phone: '０００－００００－００００', email: ' a@example.com ',
        purpose: 'スポーツ合宿', startDate: '2026-11-02', nights: '2', priceType: 'hs', people: '２０', meals: { bf: '20', lu: '', di: 'x' } };
    assert.deepStrictEqual(toPlain(buildRequest(formValues, [], CATALOG)), {
        groupName: 'サンプル高校', representative: '山田 太郎', phone: '000-0000-0000', email: 'a@example.com',
        purpose: 'スポーツ合宿', startDate: '2026-11-02', nights: 2, priceType: 'hs', people: 20,
        meals: { bf: 20, lu: 0, di: null }, slots: []
    });
});

test('isStayRequest は1泊以上かつ1人以上のときだけ宿泊利用にする', () => {
    assert.strictEqual(isStayRequest(buildSampleRequest({})), true);
    assert.strictEqual(isStayRequest(buildSampleRequest({ nights: 0 })), false);
    assert.strictEqual(isStayRequest(buildSampleRequest({ people: 0 })), false);
    assert.strictEqual(isStayRequest(buildSampleRequest({ people: NaN })), false);
});

test('calculateReservationFee：宿泊・食事・区分の施設・時間の施設を宿泊利用料金で計算する', () => {
    const slots = [{ date: '2026-11-02', facilityKey: 'gym', periodKey: 'am' }, { date: '2026-11-02', facilityKey: 'gym', periodKey: 'pm' },
        { date: '2026-11-03', facilityKey: 'kL', periodKey: 'pm' }, { date: '2026-11-03', facilityKey: 'kL', periodKey: 'ev' }];
    const fee = calculateReservationFee(buildSampleRequest({ meals: { bf: 40, lu: 0, di: 40 }, slots }), CATALOG);
    assert.deepStrictEqual(toPlain(fee.lines), [
        { label: '宿泊料（高校生）', unitPrice: 2500, quantity: 40, unit: '人泊', amount: 100000 },
        { label: '朝食', unitPrice: 660, quantity: 40, unit: '食', amount: 26400 },
        { label: '夕食', unitPrice: 990, quantity: 40, unit: '食', amount: 39600 },
        { label: '大体育館', unitPrice: 5370, quantity: 2, unit: '区分', amount: 10740 },
        { label: '大研修室(1･3研)', unitPrice: 950, quantity: 8.5, unit: '時間', amount: 8075 }
    ]);
    assert.strictEqual(fee.total, 184815);
    assert.strictEqual(fee.tax, 16801);
    assert.strictEqual(fee.isStay, true);
});

test('calculateReservationFee：日帰りは日帰り専有料金（大学・一般）になる', () => {
    const slots = [{ date: '2026-11-02', facilityKey: 'field', periodKey: 'am' }, { date: '2026-11-02', facilityKey: 'mr', periodKey: 'pm' }];
    const fee = calculateReservationFee(buildSampleRequest({ nights: 0, priceType: 'ad', slots }), CATALOG);
    assert.deepStrictEqual(toPlain(fee.lines.map((line) => [line.label, line.amount])), [['陸上/球技場', 6600], ['Mルーム', 2970]]);
    assert.strictEqual(fee.total, 9570);
    assert.strictEqual(fee.isStay, false);
});

test('calculateReservationFee：何もない・正しくない数のときは0円で、明細を出さない', () => {
    const fee = calculateReservationFee(buildSampleRequest({ nights: 0, people: NaN, meals: { bf: NaN, lu: -1, di: 0 } }), CATALOG);
    assert.deepStrictEqual(toPlain(fee), { lines: [], total: 0, tax: 0, isStay: false });
});

test('calculateIncludedTax は内消費税を切り捨てで出し、formatYen は3桁区切りにする', () => {
    assert.deepStrictEqual([0, 1, 110, 1100, 184815].map((amount) => calculateIncludedTax(amount, 0.10)), [0, 0, 10, 100, 16801]);
    assert.strictEqual(formatYen(1234567), '1,234,567円');
    assert.strictEqual(formatYen(0), '0円');
});
