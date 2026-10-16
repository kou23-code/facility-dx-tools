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
    sumCounts, isStayRequest, pickFacilityPrice, calculateIncludedTax, calculateTaxBreakdown, calculateReservationFee, formatYen
} = logic;

const toPlain = (value) => JSON.parse(JSON.stringify(value));

// 概算見積もりシステム（estimate/index.html）の料金表 categories を読み込む
const loadEstimateCategories = () => {
    const source = /const categories = (\[[\s\S]*?\n {8}\]);/.exec(readHtml())[1];
    return vm.runInNewContext(`(${source})`);
};
// 予約システムだけ表記を変えている施設（料金は同じ）
const RENAMED_FACILITIES = Object.freeze({ mr: 'ミーティングルーム' });
const findEstimateItem = (categories, key) => categories.flatMap((category) => category.items).find((item) => item.key === key);

// 概算見積もりシステムの消費税の設定 TAX_CONFIG を読み込む
const loadEstimateTaxConfig = () => vm.runInNewContext(
    `${/\/\/ TAX_CONFIG:start([\s\S]*?)\/\/ TAX_CONFIG:end/.exec(readHtml())[1]}\nTAX_CONFIG`
);

// すべての品目が毎日0の食事（overrides で品目ごとの日ごとの数を上書き）
const buildMeals = (dayCount, overrides) => Object.fromEntries(CATALOG.meals
    .map((meal) => [meal.key, overrides?.[meal.key] ?? Array.from({ length: dayCount }, () => 0)]));
const buildSampleRequest = (overrides) => ({
    groupName: 'サンプル高校 陸上部', representative: '山田 太郎', phone: '0000000000', email: 'sample@example.com',
    purpose: 'スポーツ合宿', startDate: '2026-11-02', nights: 2, priceType: 'hs', people: 20,
    stays: [20, 20], meals: buildMeals(3), slots: [], ...overrides
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
    CATALOG.meals.forEach((meal) => {
        const item = findEstimateItem(categories, meal.key);
        assert.deepStrictEqual([meal.name, meal.price, meal.unit], [item.name, item.price, item.unit], meal.key);
    });
    CATALOG.facilities.forEach((facility) => {
        const item = findEstimateItem(categories, facility.key);
        assert.strictEqual(facility.name, RENAMED_FACILITIES[facility.key] ?? item.name);
        [[true, 'ad'], [true, 'es'], [true, 'hs'], [false, 'ad'], [false, 'es'], [false, 'hs']].forEach(([isStay, type]) => {
            assert.strictEqual(pickFacilityPrice(facility, isStay, type), item.calcPrice(isStay, type), `${facility.key} ${isStay} ${type}`);
        });
    });
});

test('食事などは食堂の食事3種・弁当4種・お茶・塩おにぎりで、税率は概算見積もりシステムの TAX_CONFIG と同じ', () => {
    const taxConfig = loadEstimateTaxConfig();
    assert.deepStrictEqual(CATALOG.meals.map((meal) => meal.name),
        ['朝食', '昼食', '夕食', '竜田揚げ弁当', '幕の内弁当', 'からマヨ丼', 'おにぎり弁当', 'お茶', '塩おにぎり(2個)']);
    assert.deepStrictEqual([CATALOG.standardTaxRate, CATALOG.reducedTaxRate], [taxConfig.standardRate, taxConfig.reducedRate]);
    assert.deepStrictEqual(CATALOG.meals.filter((meal) => meal.reducedTax).map((meal) => meal.key), [...taxConfig.reducedItemIds]);
    assert.deepStrictEqual(CATALOG.meals.filter((meal) => meal.perPerson).map((meal) => meal.key), ['bf', 'lu', 'di']);
    assert.ok(Object.isFrozen(CATALOG.meals[3]));
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
        purpose: 'スポーツ合宿', startDate: '2026-11-02', nights: '2', priceType: 'hs', people: '２０', stays: ['20', '１８'],
        meals: { bf: ['', '20', '18'], lu: ['20'], di: ['x', '', ''], te: ['5', '5', '5', '5'] } };
    assert.deepStrictEqual(toPlain(buildRequest(formValues, [], CATALOG)), {
        groupName: 'サンプル高校', representative: '山田 太郎', phone: '000-0000-0000', email: 'a@example.com',
        purpose: 'スポーツ合宿', startDate: '2026-11-02', nights: 2, priceType: 'hs', people: 20, stays: [20, 18],
        meals: buildMeals(3, { bf: [0, 20, 18], lu: [20, 0, 0], di: [null, 0, 0], te: [5, 5, 5] }), slots: []
    });
});

test('buildRequest は宿泊人数を泊まる夜の数、食事を利用日の数にそろえる（足りない日は0、余った日は捨てる）', () => {
    const dayTrip = buildRequest({ nights: '0', stays: ['30', '30'], meals: { lu: ['10', '20'] } }, [], CATALOG);
    assert.deepStrictEqual(toPlain([dayTrip.stays, dayTrip.meals.lu, dayTrip.meals.bf]), [[], [10], [0]]);
    const threeNights = buildRequest({ nights: '3', stays: ['5'] }, [], CATALOG);
    assert.deepStrictEqual(toPlain([threeNights.stays, threeNights.meals.di]), [[5, 0, 0], [0, 0, 0, 0]]);
    const broken = buildRequest({ nights: 'x', stays: 'abc', meals: null }, [], CATALOG);
    assert.deepStrictEqual(toPlain([broken.stays, broken.meals.bf]), [[], [0]]);
});

test('sumCounts は日ごとの数を合計し、正しくない数は0として数える', () => {
    assert.deepStrictEqual([[1, 2, 3], [], [NaN, 4, -1], undefined, 'x'].map(sumCounts), [6, 0, 4, 0, 0]);
});

test('isStayRequest は宿泊人数が1人以上の夜があるときだけ宿泊利用にする', () => {
    assert.strictEqual(isStayRequest(buildSampleRequest({})), true);
    assert.strictEqual(isStayRequest(buildSampleRequest({ stays: [0, 1] })), true);
    assert.strictEqual(isStayRequest(buildSampleRequest({ stays: [0, 0] })), false, '2泊3日でも全員泊まらなければ日帰り専有料金');
    assert.strictEqual(isStayRequest(buildSampleRequest({ nights: 0, stays: [] })), false);
    assert.strictEqual(isStayRequest(buildSampleRequest({ stays: [NaN, -3] })), false);
});

test('calculateReservationFee：宿泊は夜ごとの人数、食事・弁当・お茶は日ごとの合計で計算する', () => {
    const slots = [{ date: '2026-11-02', facilityKey: 'gym', periodKey: 'am' }, { date: '2026-11-02', facilityKey: 'gym', periodKey: 'pm' },
        { date: '2026-11-03', facilityKey: 'kL', periodKey: 'pm' }, { date: '2026-11-03', facilityKey: 'kL', periodKey: 'ev' }];
    const meals = buildMeals(3, { bf: [0, 20, 18], di: [20, 18, 0], be_maku: [0, 0, 18], te: [20, 20, 18] });
    const fee = calculateReservationFee(buildSampleRequest({ stays: [20, 18], meals, slots }), CATALOG);
    assert.deepStrictEqual(toPlain(fee.lines), [
        { label: '宿泊料（高校生） 11/2(月)泊', unitPrice: 2500, quantity: 20, unit: '人／泊', isReducedTax: false, amount: 50000 },
        { label: '宿泊料（高校生） 11/3(火)泊', unitPrice: 2500, quantity: 18, unit: '人／泊', isReducedTax: false, amount: 45000 },
        { label: '朝食', unitPrice: 660, quantity: 38, unit: '食', isReducedTax: false, amount: 25080 },
        { label: '夕食', unitPrice: 990, quantity: 38, unit: '食', isReducedTax: false, amount: 37620 },
        { label: '幕の内弁当', unitPrice: 700, quantity: 18, unit: '食', isReducedTax: true, amount: 12600 },
        { label: 'お茶', unitPrice: 150, quantity: 58, unit: '本', isReducedTax: true, amount: 8700 },
        { label: '大体育館', unitPrice: 5370, quantity: 2, unit: '区分', isReducedTax: false, amount: 10740 },
        { label: '大研修室(1･3研)', unitPrice: 950, quantity: 8.5, unit: '時間', isReducedTax: false, amount: 8075 }
    ]);
    assert.strictEqual(fee.total, 197815);
    assert.deepStrictEqual(toPlain(fee.taxBreakdown), {
        standard: { rate: 0.10, taxIncluded: 176515, tax: 16046 }, reduced: { rate: 0.08, taxIncluded: 21300, tax: 1577 }
    });
    assert.strictEqual(fee.tax, 16046 + 1577);
    assert.strictEqual(fee.isStay, true);
});

test('calculateReservationFee：宿泊0人なら日帰り専有料金（大学・一般）になる', () => {
    const slots = [{ date: '2026-11-02', facilityKey: 'field', periodKey: 'am' }, { date: '2026-11-02', facilityKey: 'mr', periodKey: 'pm' }];
    const fee = calculateReservationFee(buildSampleRequest({ nights: 0, stays: [], meals: buildMeals(1), priceType: 'ad', slots }), CATALOG);
    assert.deepStrictEqual(toPlain(fee.lines.map((line) => [line.label, line.amount])), [['陸上/球技場', 6600], ['ミーティングルーム', 2970]]);
    assert.strictEqual(fee.total, 9570);
    assert.strictEqual(fee.isStay, false);
});

test('calculateReservationFee：何もない・正しくない数のときは0円で、明細を出さない', () => {
    const fee = calculateReservationFee(buildSampleRequest({ stays: [NaN, -1], meals: buildMeals(3, { bf: [NaN, -1, 0] }) }), CATALOG);
    assert.deepStrictEqual(toPlain(fee), {
        lines: [], total: 0, tax: 0, isStay: false,
        taxBreakdown: { standard: { rate: 0.10, taxIncluded: 0, tax: 0 }, reduced: { rate: 0.08, taxIncluded: 0, tax: 0 } }
    });
});

test('calculateTaxBreakdown は軽減税率の行と標準税率の行に分けて内消費税を出す', () => {
    const lines = [{ amount: 1100, isReducedTax: false }, { amount: 1080, isReducedTax: true }, { amount: 150, isReducedTax: true }];
    assert.deepStrictEqual(toPlain(calculateTaxBreakdown(lines, CATALOG)), {
        standard: { rate: 0.10, taxIncluded: 1100, tax: 100 }, reduced: { rate: 0.08, taxIncluded: 1230, tax: 91 }
    });
});

test('宿泊料の明細は、日付が正しくないときは「1日目」のように表示する', () => {
    const fee = calculateReservationFee(buildSampleRequest({ startDate: '', stays: [3, 0] }), CATALOG);
    assert.deepStrictEqual(fee.lines.map((line) => line.label), ['宿泊料（高校生） 1日目泊']);
});

test('calculateIncludedTax は内消費税を切り捨てで出し、formatYen は3桁区切りにする', () => {
    assert.deepStrictEqual([0, 1, 110, 1100, 184815].map((amount) => calculateIncludedTax(amount, 0.10)), [0, 0, 10, 100, 16801]);
    assert.strictEqual(formatYen(1234567), '1,234,567円');
    assert.strictEqual(formatYen(0), '0円');
});

test('予約システムでは「Mルーム」を使わず「ミーティングルーム」と表記する', () => {
    const fs = require('node:fs');
    const { RESERVATION_HTML_PATH } = require('./helpers');
    assert.strictEqual(CATALOG.facilities.find((facility) => facility.key === 'mr').name, 'ミーティングルーム');
    [RESERVATION_LOGIC_PATH, RESERVATION_HTML_PATH].forEach((filePath) => {
        assert.doesNotMatch(fs.readFileSync(filePath, 'utf8'), /Mルーム/, filePath);
    });
});
