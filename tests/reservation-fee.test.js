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
    toHourKey, buildHourSlots, listTimeUnits, toHalfWidthDigits, parseCount, sortUniqueSlots, buildRequest,
    sumCounts, sumStayOnNight, listNightTotals, countRequestPeople, countStayOfPriceType, resolveFacilityPriceType, isStayRequest, pickFacilityPrice, calculateIncludedTax, calculateTaxBreakdown, calculateReservationFee, formatYen
} = logic;

const toPlain = (value) => JSON.parse(JSON.stringify(value));
// 夜ごとの宿泊人数（区分×性別のうち「高校生 男性」にまとめて入れる）
const staysOf = (counts) => ({ hs_m: counts });
// 区分×性別の6つの欄をすべて持つ宿泊人数（overrides に書いていない欄は毎晩0）
const fullStays = (nights, overrides) => Object.fromEntries(['es_m', 'es_f', 'hs_m', 'hs_f', 'ad_m', 'ad_f']
    .map((key) => [key, overrides[key] ?? Array.from({ length: nights }, () => 0)]));

// 概算見積もりシステム（estimate/index.html）の料金表 categories を読み込む
const loadEstimateCategories = () => {
    const source = /const categories = (\[[\s\S]*?\n {8}\]);/.exec(readHtml())[1];
    return vm.runInNewContext(`(${source})`);
};
// 予約システムだけ表記を変えている施設（料金は同じ）
const RENAMED_FACILITIES = Object.freeze({
    mr: 'ミーティングルーム', track: '陸上グラウンド', court: '球技場',
    kL1: '大研修室（第１研修室）', kL3: '大研修室（第３研修室）', kS: '小研修室（第２研修室）'
});
// 予約システムで分割した施設 → 概算見積もりシステムの料金表の品目（分割前の1つの品目と同じ単価）
const ESTIMATE_ITEM_KEYS = Object.freeze({ track: 'field', court: 'field', kL1: 'kL', kL3: 'kL' });
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
    purpose: 'スポーツ合宿', startDate: '2026-11-02', nights: 2,
    stays: staysOf([20, 20]), meals: buildMeals(3), slots: [], ...overrides
});

test('RESERVATION_CONFIG の既定値と、書き換えられないこと', () => {
    assert.deepStrictEqual(toPlain(RESERVATION_CONFIG), {
        stayCapacity: 300, maxStayGroups: 6, fewRatio: 0.3, maxNights: 6, maxPeople: 300, minLeadDays: 1, maxAdvanceDays: 365,
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
    const custom = { stayCapacity: 0, maxStayGroups: 0, fewRatio: 1, maxNights: 2.5, maxPeople: '50', minLeadDays: -1, maxAdvanceDays: null,
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
        const item = findEstimateItem(categories, ESTIMATE_ITEM_KEYS[facility.key] ?? facility.key);
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

test('体育館・競技場は区分（AM・PM・夜）、研修室・ミーティングルームは1時間単位で、料金表は書き換えられない', () => {
    assert.deepStrictEqual(toPlain(CATALOG.periods.map((period) => [period.key, period.name, period.time])),
        [['am', 'AM', '8:30~12:30'], ['pm', 'PM', '12:30~17:00'], ['ev', '夜', '17:00~21:00']]);
    assert.deepStrictEqual(CATALOG.facilities.map((facility) => `${facility.key}:${facility.billing}`),
        ['gym:period', 'gym_s:period', 'track:period', 'court:period', 'kL1:hour', 'kL3:hour', 'kS:hour', 'mr:hour']);
    assert.ok(Object.isFrozen(CATALOG.facilities[0].prices) && Object.isFrozen(CATALOG.hourSlots[0]));
});

test('施設は区分単位の4施設と1時間単位の4施設の全8施設で、月間カレンダー用の略称を持つ', () => {
    assert.deepStrictEqual(toPlain(CATALOG.facilities.map((facility) => [facility.key, facility.name, facility.shortName])), [
        ['gym', '大体育館', '大体'], ['gym_s', '小体育館', '小体'], ['track', '陸上グラウンド', '陸上'], ['court', '球技場', '球技'],
        ['kL1', '大研修室（第１研修室）', '大研1'], ['kL3', '大研修室（第３研修室）', '大研3'], ['kS', '小研修室（第２研修室）', '小研2'],
        ['mr', 'ミーティングルーム', 'MR']
    ]);
    assert.strictEqual(new Set(CATALOG.facilities.map((facility) => facility.shortName)).size, 8, '略称が重ならない');
});

test('分割した施設（陸上グラウンドと球技場、第１研修室と第３研修室）の料金単価は同じ', () => {
    const pricesOf = (key) => toPlain(CATALOG.facilities.find((facility) => facility.key === key).prices);
    assert.deepStrictEqual(pricesOf('track'), pricesOf('court'));
    assert.deepStrictEqual(pricesOf('track'), { stayAdult: 5280, stayYouth: 3520, dayAdult: 6600, dayYouth: 4400 });
    assert.deepStrictEqual(pricesOf('kL1'), pricesOf('kL3'));
    assert.deepStrictEqual(pricesOf('kL1'), { stayAdult: 950, stayYouth: 950, dayAdult: 1890, dayYouth: 1890 });
    assert.deepStrictEqual(pricesOf('kS'), { stayAdult: 630, stayYouth: 630, dayAdult: 1260, dayYouth: 1260 });
    assert.deepStrictEqual(toPlain(CATALOG.facilities.find((facility) => facility.key === 'court').joinPrices), { adult: 320, youth: 220 });
    assert.deepStrictEqual(toPlain(CATALOG.legacyFacilityKeys), { field: ['track', 'court'], kL: ['kL1', 'kL3'] });
});

test('calculateReservationFee：分割した施設は施設ごとに別の明細行で計算する', () => {
    const slots = [{ date: '2026-11-02', facilityKey: 'track', timeKey: 'am' }, { date: '2026-11-02', facilityKey: 'court', timeKey: 'am' },
        { date: '2026-11-02', facilityKey: 'court', timeKey: 'pm' }, { date: '2026-11-02', facilityKey: 'kL1', timeKey: 'h09' },
        { date: '2026-11-02', facilityKey: 'kL3', timeKey: 'h09' }, { date: '2026-11-02', facilityKey: 'kL3', timeKey: 'h10' },
        { date: '2026-11-02', facilityKey: 'kS', timeKey: 'h09' }];
    const fee = calculateReservationFee(buildSampleRequest({ stays: staysOf([0, 0]), slots }), CATALOG);
    assert.deepStrictEqual(toPlain(fee.lines.map((line) => [line.label, line.unitPrice, line.quantity, line.unit, line.amount])), [
        ['陸上グラウンド', 6600, 1, '区分', 6600], ['球技場', 6600, 2, '区分', 13200],
        ['大研修室（第１研修室）', 1890, 1, '時間', 1890], ['大研修室（第３研修室）', 1890, 2, '時間', 3780],
        ['小研修室（第２研修室）', 1260, 1, '時間', 1260]
    ]);
    assert.strictEqual(fee.total, 6600 + 13200 + 1890 + 3780 + 1260);
});

test('calculateReservationFee：日帰り参加料は陸上グラウンドと球技場で別々に数える', () => {
    const slots = [{ date: '2026-11-02', facilityKey: 'track', timeKey: 'am' }, { date: '2026-11-02', facilityKey: 'court', timeKey: 'pm' }];
    const dayGuests = { es: [0, 0, 0], hs: [3, 0, 0], ad: [0, 0, 0] };
    const fee = calculateReservationFee(buildSampleRequest({ dayGuests, slots }), CATALOG);
    assert.deepStrictEqual(toPlain(fee.lines.filter((line) => line.label.startsWith('日帰り参加料')).map((line) => [line.label, line.amount])),
        [['日帰り参加料（陸上グラウンド・小中高）', 660], ['日帰り参加料（球技場・小中高）', 660]]);
});

test('1時間単位のコマは9時〜21時の12コマ（9:00~10:00 〜 20:00~21:00）', () => {
    assert.strictEqual(CATALOG.hourSlots.length, 12);
    assert.deepStrictEqual(toPlain(CATALOG.hourSlots[0]), { key: 'h09', name: '9', label: '9:00~10:00', startHour: 9 });
    assert.deepStrictEqual(toPlain(CATALOG.hourSlots[11]), { key: 'h20', name: '20', label: '20:00~21:00', startHour: 20 });
    assert.deepStrictEqual(toPlain(buildHourSlots(9, 9)), [], '開始と終了が同じなら0コマ');
    assert.deepStrictEqual(buildHourSlots(13, 15).map((unit) => unit.key), ['h13', 'h14']);
    assert.deepStrictEqual([toHourKey(9), toHourKey(20)], ['h09', 'h20']);
});

test('listTimeUnits は区分の施設には AM・PM・夜、1時間の施設には1時間単位のコマを返す', () => {
    const facilityOf = (key) => CATALOG.facilities.find((facility) => facility.key === key);
    assert.deepStrictEqual(listTimeUnits(facilityOf('track'), CATALOG).map((unit) => unit.key), ['am', 'pm', 'ev']);
    assert.strictEqual(listTimeUnits(facilityOf('mr'), CATALOG), CATALOG.hourSlots);
    assert.strictEqual(listTimeUnits(undefined, CATALOG), CATALOG.periods, '知らない施設は区分として扱う');
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
        { date: '2026-11-03', facilityKey: 'gym', timeKey: 'pm' }, { date: '2026-11-02', facilityKey: 'kL1', timeKey: 'h13' },
        { date: '2026-11-02', facilityKey: 'gym', timeKey: 'ev' }, { date: '2026-11-03', facilityKey: 'gym', timeKey: 'pm' },
        { date: '2026-11-02', facilityKey: 'gym', timeKey: 'am' }, { date: '2026-11-02', facilityKey: 'kL1', timeKey: 'h09' }
    ];
    const original = toPlain(slots);
    assert.deepStrictEqual(sortUniqueSlots(slots, CATALOG).map((slot) => `${slot.date} ${slot.facilityKey} ${slot.timeKey}`),
        ['2026-11-02 gym am', '2026-11-02 gym ev', '2026-11-02 kL1 h09', '2026-11-02 kL1 h13', '2026-11-03 gym pm']);
    assert.deepStrictEqual(slots, original);
});

test('buildRequest は入力値の前後の空白を除き、数を整数にし、全角の電話番号を半角にする（利用人数・料金区分は宿泊人数から決める）', () => {
    const formValues = { groupName: ' サンプル高校 ', representative: '山田 太郎 ', phone: '０００－００００－００００', email: ' a@example.com ',
        purpose: 'スポーツ合宿', startDate: '2026-11-02', nights: '2', priceType: 'es', people: '５',
        stays: { hs_m: ['12', '１０'], hs_f: ['8', ''], ad_m: ['1', '1', '1'] },
        meals: { bf: ['', '20', '18'], lu: ['20'], di: ['x', '', ''], te: ['5', '5', '5', '5'] },
        dayGuests: { es: ['３', '', '1', '9'], ad: ['-1'] } };
    assert.deepStrictEqual(toPlain(buildRequest(formValues, [], CATALOG)), {
        groupName: 'サンプル高校', representative: '山田 太郎', phone: '000-0000-0000', email: 'a@example.com',
        purpose: 'スポーツ合宿', startDate: '2026-11-02', nights: 2, priceType: 'hs', people: 21,
        stays: fullStays(2, { hs_m: [12, 10], hs_f: [8, 0], ad_m: [1, 1] }),
        meals: buildMeals(3, { bf: [0, 20, 18], lu: [20, 0, 0], di: [null, 0, 0], te: [5, 5, 5] }),
        dayGuests: { es: [3, 0, 1], hs: [0, 0, 0], ad: [null, 0, 0] }, slots: []
    });
});

test('buildRequest は宿泊人数を区分×男女の6つの欄・泊まる夜の数、食事を利用日の数にそろえる（足りない日は0、余った日は捨てる）', () => {
    const dayTrip = buildRequest({ nights: '0', stays: { es_m: ['30', '30'] }, meals: { lu: ['10', '20'] } }, [], CATALOG);
    assert.deepStrictEqual(toPlain([dayTrip.stays, dayTrip.meals.lu, dayTrip.meals.bf]), [fullStays(0, {}), [10], [0]]);
    const threeNights = buildRequest({ nights: '3', stays: { hs_f: ['5'] } }, [], CATALOG);
    assert.deepStrictEqual(toPlain([threeNights.stays, threeNights.meals.di]), [fullStays(3, { hs_f: [5, 0, 0] }), [0, 0, 0, 0]]);
    const broken = buildRequest({ nights: 'x', stays: 'abc', meals: null }, [], CATALOG);
    assert.deepStrictEqual(toPlain([broken.stays, broken.meals.bf]), [fullStays(0, {}), [0]]);
    assert.deepStrictEqual(Object.keys(threeNights.stays), ['es_m', 'es_f', 'hs_m', 'hs_f', 'ad_m', 'ad_f']);
});

test('buildRequest は日帰り参加人数を区分（男女別なし）の3つの欄・利用日の数にそろえる', () => {
    const twoNights = buildRequest({ nights: '2', dayGuests: { hs: ['5', '6', '7', '8'], ad: ['2'] } }, [], CATALOG);
    assert.deepStrictEqual(toPlain(twoNights.dayGuests), { es: [0, 0, 0], hs: [5, 6, 7], ad: [2, 0, 0] }, '最終日（チェックアウト日）も入力できる');
    assert.deepStrictEqual(toPlain(buildRequest({ nights: '0' }, [], CATALOG).dayGuests), { es: [0], hs: [0], ad: [0] });
    assert.deepStrictEqual(toPlain(buildRequest({ nights: '1', dayGuests: 'abc' }, [], CATALOG).dayGuests), { es: [0, 0], hs: [0, 0], ad: [0, 0] });
});

test('countDayGuestsOnDay・sumDayGuestsOnDay はその日の日帰り参加人数を区分をまたいで合計する', () => {
    const { countDayGuestsOnDay, sumDayGuestsOnDay } = logic;
    const dayGuests = { es: [3, 0], hs: [2, NaN], ad: [1, 4] };
    assert.deepStrictEqual([countDayGuestsOnDay(dayGuests, ['es', 'hs'], 0), countDayGuestsOnDay(dayGuests, ['ad'], 1)], [5, 4]);
    assert.deepStrictEqual([sumDayGuestsOnDay(dayGuests, 0), sumDayGuestsOnDay(dayGuests, 1), sumDayGuestsOnDay(dayGuests, 2)], [6, 4, 0]);
    assert.strictEqual(sumDayGuestsOnDay(undefined, 0), 0);
});

test('buildRequest の利用人数は夜ごとの宿泊人数の合計の最大、料金区分は宿泊人数がいちばん多い区分（2日以上で宿泊者なしは0人・大学生一般）', () => {
    const pick = (formValues) => toPlain((({ people, priceType }) => ({ people, priceType }))(buildRequest(formValues, [], CATALOG)));
    assert.deepStrictEqual(pick({ nights: '2', stays: { es_m: ['20', '25'], es_f: ['10', '10'], ad_m: ['3', '3'] } }), { people: 38, priceType: 'es' });
    assert.deepStrictEqual(pick({ nights: '1', stays: { hs_f: ['1'] } }), { people: 1, priceType: 'hs' }, '1人でも区分が決まる');
    assert.deepStrictEqual(pick({ nights: '2', stays: {} }), { people: 0, priceType: 'ad' }, '宿泊0人');
    assert.deepStrictEqual(pick({ nights: '1', stays: { es_m: ['x'], hs_m: ['-1'] } }), { people: 0, priceType: 'ad' }, '正しくない数は0人として数える');
    assert.deepStrictEqual(pick({ nights: '2', stays: { hs_f: ['3', '0'] }, priceType: 'es' }), { people: 3, priceType: 'hs' }, '2日以上は選んだ区分を使わない');
    assert.deepStrictEqual(pick({ nights: '2', stays: {}, priceType: 'es' }), { people: 0, priceType: 'ad' }, '2日以上で宿泊0人も選んだ区分を使わない');
});

test('buildRequest の料金区分は、日帰り（1日）のときだけ画面で選んだ区分にする', () => {
    const pick = (formValues) => buildRequest(formValues, [], CATALOG).priceType;
    assert.deepStrictEqual(['es', 'hs', 'ad'].map((priceType) => pick({ nights: '0', priceType })), ['es', 'hs', 'ad']);
    assert.strictEqual(pick({ nights: '0', priceType: ' hs ', stays: { ad_m: ['30'] } }), 'hs', '前後の空白を除き、宿泊人数の欄の値は使わない');
    assert.strictEqual(pick({ nights: '0' }), '', '選んでいなければ空（入力エラーにする）');
});

test('countRequestPeople は夜ごとの宿泊人数の合計のうち、いちばん多い夜の人数を返す', () => {
    assert.strictEqual(countRequestPeople({ nights: 3, stays: fullStays(3, { hs_m: [10, 12, 5], ad_f: [5, 0, 5] }) }), 15);
    assert.strictEqual(countRequestPeople({ nights: 0, stays: fullStays(0, {}) }), 0);
    assert.strictEqual(countRequestPeople({ nights: NaN, stays: undefined }), 0);
});

test('宿泊人数の欄は「小学生・中学生」「高校生」「大学生・一般」×「男性」「女性」の6つ', () => {
    assert.deepStrictEqual(CATALOG.stayGuestTypes.map((type) => [type.key, type.priceType, type.gender, type.name]), [
        ['es_m', 'es', 'm', '小学生・中学生 男性'], ['es_f', 'es', 'f', '小学生・中学生 女性'], ['hs_m', 'hs', 'm', '高校生 男性'],
        ['hs_f', 'hs', 'f', '高校生 女性'], ['ad_m', 'ad', 'm', '大学生・一般 男性'], ['ad_f', 'ad', 'f', '大学生・一般 女性']
    ]);
    assert.ok(Object.isFrozen(CATALOG.stayGuestTypes[0]));
});

test('sumStayOnNight・listNightTotals・countStayOfPriceType は区分・男女をまたいで夜ごとに合計する', () => {
    const stays = fullStays(2, { es_m: [3, 0], hs_m: [10, 9], hs_f: [8, NaN], ad_f: [1, 2] });
    assert.deepStrictEqual([sumStayOnNight(stays, 0), sumStayOnNight(stays, 1), sumStayOnNight(stays, 2)], [22, 11, 0]);
    assert.deepStrictEqual(listNightTotals({ nights: 2, stays }), [22, 11]);
    assert.deepStrictEqual(listNightTotals({ nights: NaN, stays }), []);
    assert.deepStrictEqual(['es', 'hs', 'ad'].map((key) => countStayOfPriceType(stays, key, 0, CATALOG)), [3, 18, 1]);
    assert.strictEqual(sumStayOnNight(undefined, 0), 0);
});

test('resolveFacilityPriceType：宿泊者がいれば宿泊人数がいちばん多い区分（同数なら小中→高校→大学一般の順）、いなければ大学生・一般', () => {
    const resolve = (stays, priceType) => resolveFacilityPriceType({ nights: 2, priceType, stays: fullStays(2, stays) }, CATALOG);
    assert.strictEqual(resolve({ hs_m: [5, 5], ad_f: [9, 0] }, 'es'), 'hs', '高校生10人・大学生一般9人');
    assert.strictEqual(resolve({ es_f: [5, 0], ad_m: [5, 0] }, 'hs'), 'es', '同数なら小中が先');
    assert.strictEqual(resolve({ hs_m: [3, 3], ad_m: [3, 3] }, 'es'), 'hs', '同数なら高校が大学一般より先');
    assert.strictEqual(resolve({}, 'es'), 'ad', '2日以上で宿泊者がいなければ、priceType に関係なく大学生・一般');
    assert.strictEqual(CATALOG.dayTripPriceType, 'ad');
    const resolveDayTrip = (priceType) => resolveFacilityPriceType({ nights: 0, priceType, stays: fullStays(0, {}) }, CATALOG);
    assert.deepStrictEqual(['es', 'hs', 'ad'].map(resolveDayTrip), ['es', 'hs', 'ad'], '日帰りは選んだ料金区分');
    assert.deepStrictEqual(['', 'zz', undefined].map(resolveDayTrip), ['ad', 'ad', 'ad'], '日帰りで選んだ区分が正しくなければ大学生・一般');
});

test('sumCounts は日ごとの数を合計し、正しくない数は0として数える', () => {
    assert.deepStrictEqual([[1, 2, 3], [], [NaN, 4, -1], undefined, 'x'].map(sumCounts), [6, 0, 4, 0, 0]);
});

test('isStayRequest は宿泊人数が1人以上の夜があるときだけ宿泊利用にする', () => {
    assert.strictEqual(isStayRequest(buildSampleRequest({})), true);
    assert.strictEqual(isStayRequest(buildSampleRequest({ stays: staysOf([0, 1]) })), true);
    assert.strictEqual(isStayRequest(buildSampleRequest({ stays: staysOf([0, 0]) })), false, '2泊3日でも全員泊まらなければ日帰り専有料金');
    assert.strictEqual(isStayRequest(buildSampleRequest({ nights: 0, stays: staysOf([]) })), false);
    assert.strictEqual(isStayRequest(buildSampleRequest({ stays: staysOf([NaN, -3]) })), false);
});

test('calculateReservationFee：宿泊は夜ごとの人数、食事・弁当・お茶は日ごとの合計で計算する', () => {
    const slots = [{ date: '2026-11-02', facilityKey: 'gym', timeKey: 'am' }, { date: '2026-11-02', facilityKey: 'gym', timeKey: 'pm' },
        { date: '2026-11-03', facilityKey: 'kL1', timeKey: 'h13' }, { date: '2026-11-03', facilityKey: 'kL1', timeKey: 'h14' },
        { date: '2026-11-04', facilityKey: 'kL1', timeKey: 'h09' }];
    const meals = buildMeals(3, { bf: [0, 20, 18], di: [20, 18, 0], be_maku: [0, 0, 18], te: [20, 20, 18] });
    const fee = calculateReservationFee(buildSampleRequest({ stays: staysOf([20, 18]), meals, slots }), CATALOG);
    assert.deepStrictEqual(toPlain(fee.lines), [
        { label: '宿泊料（高校生） 11/2(月)泊', unitPrice: 2500, quantity: 20, unit: '人／泊', isReducedTax: false, amount: 50000 },
        { label: '宿泊料（高校生） 11/3(火)泊', unitPrice: 2500, quantity: 18, unit: '人／泊', isReducedTax: false, amount: 45000 },
        { label: '朝食', unitPrice: 660, quantity: 38, unit: '食', isReducedTax: false, amount: 25080 },
        { label: '夕食', unitPrice: 990, quantity: 38, unit: '食', isReducedTax: false, amount: 37620 },
        { label: '幕の内弁当', unitPrice: 700, quantity: 18, unit: '食', isReducedTax: true, amount: 12600 },
        { label: 'お茶', unitPrice: 150, quantity: 58, unit: '本', isReducedTax: true, amount: 8700 },
        { label: '大体育館', unitPrice: 5370, quantity: 2, unit: '区分', isReducedTax: false, amount: 10740 },
        { label: '大研修室（第１研修室）', unitPrice: 950, quantity: 3, unit: '時間', isReducedTax: false, amount: 2850 }
    ]);
    assert.strictEqual(fee.total, 192590);
    assert.deepStrictEqual(toPlain(fee.taxBreakdown), {
        standard: { rate: 0.10, taxIncluded: 171290, tax: 15571 }, reduced: { rate: 0.08, taxIncluded: 21300, tax: 1577 }
    });
    assert.strictEqual(fee.tax, 15571 + 1577);
    assert.strictEqual(fee.isStay, true);
});

test('calculateReservationFee：宿泊料は夜ごと・区分ごとに男女を合わせた人数で計算し、施設は人数がいちばん多い区分の料金にする', () => {
    const stays = fullStays(2, { es_m: [4, 4], es_f: [6, 6], ad_m: [1, 0], ad_f: [1, 1] });
    const slots = [{ date: '2026-11-02', facilityKey: 'gym', timeKey: 'am' }];
    const fee = calculateReservationFee(buildSampleRequest({ stays, slots }), CATALOG);
    assert.deepStrictEqual(toPlain(fee.lines.map((line) => [line.label, line.unitPrice, line.quantity, line.amount])), [
        ['宿泊料（小学生・中学生） 11/2(月)泊', 2200, 10, 22000], ['宿泊料（大学生・一般） 11/2(月)泊', 3300, 2, 6600],
        ['宿泊料（小学生・中学生） 11/3(火)泊', 2200, 10, 22000], ['宿泊料（大学生・一般） 11/3(火)泊', 3300, 1, 3300],
        ['大体育館', 5370, 1, 5370]
    ]);
    assert.strictEqual(fee.facilityPriceType, 'es', '小中20人泊 ＞ 大学一般3人泊なので、施設は小中高の料金');
    assert.strictEqual(fee.total, 59270);
});

// 陸上グラウンド AM と、ミーティングルーム 13時・14時
const DAY_TRIP_SLOTS = [{ date: '2026-11-02', facilityKey: 'track', timeKey: 'am' },
    { date: '2026-11-02', facilityKey: 'mr', timeKey: 'h13' }, { date: '2026-11-02', facilityKey: 'mr', timeKey: 'h14' }];
const calculateDayTripFee = (priceType) => calculateReservationFee(buildSampleRequest({ nights: 0, stays: staysOf([]), meals: buildMeals(1), priceType, slots: DAY_TRIP_SLOTS }), CATALOG);

test('calculateReservationFee：日帰り（1日）は、選んだ料金区分の日帰り専有料金になる', () => {
    const fee = calculateDayTripFee('ad');
    assert.deepStrictEqual(toPlain(fee.lines.map((line) => [line.label, line.quantity, line.unit, line.amount])),
        [['陸上グラウンド', 1, '区分', 6600], ['ミーティングルーム', 2, '時間', 1320]]);
    assert.deepStrictEqual([fee.total, fee.isStay, fee.facilityPriceType], [7920, false, 'ad']);
    assert.deepStrictEqual(['es', 'hs'].map((priceType) => toPlain(calculateDayTripFee(priceType).lines.map((line) => line.amount))), [[4400, 1320], [4400, 1320]],
        '小学生・中学生／高校生は小中高の料金（研修室・ミーティングルームは区分で変わらない）');
    assert.deepStrictEqual(['es', 'hs'].map((priceType) => calculateDayTripFee(priceType).facilityPriceType), ['es', 'hs']);
});

test('calculateReservationFee：2日以上で宿泊0人なら、priceType に関係なく日帰り専有料金（大学・一般）になる', () => {
    const fee = calculateReservationFee(buildSampleRequest({ stays: staysOf([0, 0]), priceType: 'es', slots: DAY_TRIP_SLOTS }), CATALOG);
    assert.deepStrictEqual(toPlain(fee.lines.map((line) => line.amount)), [6600, 1320]);
    assert.deepStrictEqual([fee.isStay, fee.facilityPriceType], [false, 'ad']);
});

// 日帰り参加人数（区分ごと・利用日ごと。書いていない区分は毎日0）
const buildDayGuests = (dayCount, overrides) => Object.fromEntries(['es', 'hs', 'ad']
    .map((key) => [key, overrides?.[key] ?? Array.from({ length: dayCount }, () => 0)]));
const pickJoinLines = (fee) => toPlain(fee.lines.filter((line) => line.label.startsWith('日帰り参加料'))
    .map((line) => [line.label, line.unitPrice, line.quantity, line.unit, line.amount]));
// 11/2 は大体育館（AM・PM）と大研修室、11/3 は陸上グラウンド、11/4 は小体育館を使う
const JOIN_SLOTS = [{ date: '2026-11-02', facilityKey: 'gym', timeKey: 'am' }, { date: '2026-11-02', facilityKey: 'gym', timeKey: 'pm' },
    { date: '2026-11-02', facilityKey: 'kL1', timeKey: 'h09' }, { date: '2026-11-03', facilityKey: 'track', timeKey: 'am' },
    { date: '2026-11-04', facilityKey: 'gym_s', timeKey: 'am' }];

test('calculateReservationFee：日帰り参加料は、体育館・競技場を使う日の日帰り参加人数×その施設の単価（小中高・大学一般）で加算する', () => {
    const dayGuests = buildDayGuests(3, { es: [3, 0, 0], hs: [2, 4, 0], ad: [1, 0, 6] });
    const fee = calculateReservationFee(buildSampleRequest({ dayGuests, slots: JOIN_SLOTS }), CATALOG);
    assert.deepStrictEqual(pickJoinLines(fee), [
        ['日帰り参加料（大体育館・小中高）', 220, 5, '人', 1100], ['日帰り参加料（大体育館・大学・一般）', 320, 1, '人', 320],
        ['日帰り参加料（小体育館・大学・一般）', 320, 6, '人', 1920], ['日帰り参加料（陸上グラウンド・小中高）', 220, 4, '人', 880]
    ], '同じ日に同じ施設を2区分使っても1日分。研修室には日帰り参加料がない');
    const withoutGuests = calculateReservationFee(buildSampleRequest({ dayGuests: buildDayGuests(3), slots: JOIN_SLOTS }), CATALOG);
    assert.strictEqual(fee.total - withoutGuests.total, 1100 + 320 + 1920 + 880, '合計に日帰り参加料が加わる');
    assert.strictEqual(fee.taxBreakdown.standard.taxIncluded - withoutGuests.taxBreakdown.standard.taxIncluded, 4220, '日帰り参加料は標準税率');
});

test('calculateReservationFee：日帰り参加料は複数日・複数施設の分を足し、施設を使わない日・宿泊者がいないときは加算しない', () => {
    const slots = [{ date: '2026-11-02', facilityKey: 'gym', timeKey: 'am' }, { date: '2026-11-03', facilityKey: 'gym', timeKey: 'ev' },
        { date: '2026-11-03', facilityKey: 'track', timeKey: 'am' }];
    const dayGuests = buildDayGuests(3, { hs: [10, 10, 10] });
    assert.deepStrictEqual(pickJoinLines(calculateReservationFee(buildSampleRequest({ dayGuests, slots }), CATALOG)),
        [['日帰り参加料（大体育館・小中高）', 220, 20, '人', 4400], ['日帰り参加料（陸上グラウンド・小中高）', 220, 10, '人', 2200]], '3日目は施設を使わない');
    assert.deepStrictEqual(pickJoinLines(calculateReservationFee(buildSampleRequest({ dayGuests, slots: [] }), CATALOG)), []);
    assert.deepStrictEqual(pickJoinLines(calculateReservationFee(buildSampleRequest({ stays: staysOf([0, 0]), dayGuests, slots }), CATALOG)), [], '宿泊0人');
    assert.deepStrictEqual(pickJoinLines(calculateReservationFee(buildSampleRequest({ dayGuests: undefined, slots }), CATALOG)), [], '日帰り参加人数がない古い予約');
    assert.deepStrictEqual(pickJoinLines(calculateReservationFee(buildSampleRequest({ dayGuests: buildDayGuests(3, { ad: [NaN, -2, 0] }), slots }), CATALOG)), []);
});

test('日帰り参加料の単価は、概算見積もりシステムの「日帰り参加料」と同じ', () => {
    const categories = loadEstimateCategories();
    const estimateKeys = { gym: 'jg', gym_s: 'js', track: 'jf', court: 'jf' };
    assert.deepStrictEqual(CATALOG.facilities.filter((facility) => facility.joinPrices).map((facility) => facility.key), ['gym', 'gym_s', 'track', 'court']);
    Object.entries(estimateKeys).forEach(([facilityKey, prefix]) => {
        const { joinPrices } = CATALOG.facilities.find((facility) => facility.key === facilityKey);
        assert.deepStrictEqual([joinPrices.youth, joinPrices.adult],
            [findEstimateItem(categories, `${prefix}_es_hs`).price, findEstimateItem(categories, `${prefix}_ad`).price], facilityKey);
    });
    assert.deepStrictEqual(toPlain(CATALOG.joinPriceGroups.map((group) => group.priceTypes)), [['es', 'hs'], ['ad']], '小中高は同じ単価');
});

test('calculateReservationFee：何もない・正しくない数のときは0円で、明細を出さない', () => {
    const fee = calculateReservationFee(buildSampleRequest({ stays: staysOf([NaN, -1]), meals: buildMeals(3, { bf: [NaN, -1, 0] }) }), CATALOG);
    assert.deepStrictEqual(toPlain(fee), {
        lines: [], total: 0, tax: 0, isStay: false, facilityPriceType: 'ad',
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
    const fee = calculateReservationFee(buildSampleRequest({ startDate: '', stays: staysOf([3, 0]) }), CATALOG);
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

test('formatQuantity は数量の単位を「20（人／泊）」のように括弧で囲む', () => {
    const { formatQuantity } = logic;
    assert.deepStrictEqual([[20, '人／泊'], [3, '時間'], [2, '区分'], [1200, '食'], [0, '本']].map(([quantity, unit]) => formatQuantity(quantity, unit)),
        ['20（人／泊）', '3（時間）', '2（区分）', '1,200（食）', '0（本）']);
});

test('別途料金の案内の文言', () => {
    assert.strictEqual(logic.EXTRA_FEE_NOTE, '※体育館の照明代金、研修室の冷暖房代、および宿泊を伴わない日帰り参加者の施設利用料などは別途料金がかかります');
});

test('formatHourHeader は1時間のコマの見出しを「9-10時」の形にする（9時〜20時台の12コマ）', () => {
    const { formatHourHeader } = logic;
    assert.strictEqual(formatHourHeader(CATALOG.hourSlots[0]), '9-10時');
    assert.strictEqual(formatHourHeader(CATALOG.hourSlots[11]), '20-21時');
    assert.deepStrictEqual(CATALOG.hourSlots.map(formatHourHeader), ['9-10時', '10-11時', '11-12時', '12-13時', '13-14時', '14-15時',
        '15-16時', '16-17時', '17-18時', '18-19時', '19-20時', '20-21時']);
});
