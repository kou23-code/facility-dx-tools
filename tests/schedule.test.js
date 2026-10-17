// スケジュール管理表：日別集計・空き状況・職員取込・公開用データの動作確認テスト
// 実行方法：node --test tests/schedule.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ROOT_DIR, RESERVATION_LOGIC_PATH } = require('./helpers');
const { RESERVATION_CATALOG: CATALOG } = require(RESERVATION_LOGIC_PATH);
const SCHEDULE_LOGIC_PATH = path.join(ROOT_DIR, 'schedule', 'schedule-logic.js');
const ScheduleLogic = require(SCHEDULE_LOGIC_PATH);
const {
    STAY_THRESHOLDS, MEAL_SUMMARY_ITEMS, findNightIndex, findDayIndex, countStayOnDate,
    countStayGuests, countStayGroups, summarizeDailyReservations, judgeStaySymbol, mapFacilitySchedule
} = ScheduleLogic;

// キーごとの日ごとの数の表を、keyedList のすべてのキー・日数分にそろえる（書いていないキーは毎日0）
const fillTable = (partialTable, keyedList, length) => Object.fromEntries(keyedList
    .map((entry) => [entry.key, Array.from({ length }, (_, index) => partialTable?.[entry.key]?.[index] ?? 0)]));

// テスト用の予約1件（spec に書いた項目だけ上書きする）
const buildReservation = (spec) => ({
    id: spec.id, createdAt: '2026-10-01T09:00', groupName: spec.groupName ?? `${spec.id} スポーツクラブ`,
    representative: '山田 太郎', phone: '000-0000-0000', email: 'sample@example.com', purpose: 'スポーツ合宿',
    startDate: spec.startDate, nights: spec.nights, priceType: 'ad', people: 0,
    stays: fillTable(spec.stays, CATALOG.stayGuestTypes, spec.nights),
    meals: fillTable(spec.meals, CATALOG.meals, spec.nights + 1),
    dayGuests: fillTable({}, CATALOG.priceTypes, spec.nights + 1),
    slots: spec.slots ?? [], estimatedTotal: 0
});

const HIGH_SCHOOL = buildReservation({
    id: 'R20261001-001', startDate: '2026-11-02', nights: 2,
    stays: { hs_m: [20, 19], hs_f: [18, 18] },
    meals: { bf: [0, 38, 37], lu: [38, 38, 37], di: [38, 37, 0], be_maku: [0, 0, 10], te: [38, 0, 5], on: [0, 0, 20] },
    slots: [{ date: '2026-11-02', facilityKey: 'gym', timeKey: 'pm' }, { date: '2026-11-03', facilityKey: 'kL', timeKey: 'h09' }]
});
const UNIVERSITY = buildReservation({
    id: 'R20261001-002', startDate: '2026-11-03', nights: 1,
    stays: { ad_m: [30], ad_f: [10] },
    meals: { di: [40, 0], be_tatsu: [5, 0], be_oni: [3, 0], bf: [0, 40] },
    slots: [{ date: '2026-11-03', facilityKey: 'gym', timeKey: 'am' }, { date: '2026-11-03', facilityKey: 'mr', timeKey: 'h20' }]
});
// 日帰り（宿泊なし）。食事は数えるが、宿泊人数・団体数には入れない
const DAY_TRIP = buildReservation({
    id: 'R20261001-003', startDate: '2026-11-03', nights: 0,
    meals: { be_kara: [12], te: [12] },
    slots: [{ date: '2026-11-03', facilityKey: 'gym_s', timeKey: 'ev' }]
});
const RESERVATION_LIST = Object.freeze([HIGH_SCHOOL, UNIVERSITY, DAY_TRIP]);

// ---------- 読み込み ----------
// ブラウザと同じように、予約システムのファイルのあとに読み込む（同じページで名前がぶつかるとエラーになる）
const loadInBrowserContext = () => {
    const context = vm.createContext({ window: {} });
    [RESERVATION_LOGIC_PATH, SCHEDULE_LOGIC_PATH].forEach((filePath) => vm.runInContext(fs.readFileSync(filePath, 'utf8'), context));
    return context;
};

test('ブラウザでは予約システムと同じページで読み込め、window.ScheduleLogic から使える', () => {
    const context = loadInBrowserContext();
    assert.deepStrictEqual(Object.keys(context.window.ScheduleLogic), Object.keys(ScheduleLogic));
    assert.strictEqual(context.window.ScheduleLogic.judgeStaySymbol(300, 0, STAY_THRESHOLDS), '×');
});

// ---------- 日別集計 ----------
test('findNightIndex は泊まる夜だけ番号を返し、チェックアウト日や日程の外は -1', () => {
    assert.deepStrictEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'].map((date) => findNightIndex(HIGH_SCHOOL, date)), [-1, 0, 1, -1]);
    assert.strictEqual(findNightIndex(DAY_TRIP, '2026-11-03'), -1);
});

test('findDayIndex はチェックアウト日も利用日として番号を返す', () => {
    assert.deepStrictEqual(['2026-11-01', '2026-11-02', '2026-11-04', '2026-11-05'].map((date) => findDayIndex(HIGH_SCHOOL, date)), [-1, 0, 2, -1]);
    assert.strictEqual(findDayIndex(DAY_TRIP, '2026-11-03'), 0);
});

test('countStayOnDate は予約1件のその夜の宿泊人数（区分・性別の合計）を返す', () => {
    assert.strictEqual(countStayOnDate(HIGH_SCHOOL, '2026-11-02'), 38);
    assert.strictEqual(countStayOnDate(HIGH_SCHOOL, '2026-11-03'), 37);
    assert.strictEqual(countStayOnDate(HIGH_SCHOOL, '2026-11-04'), 0);
});

test('summarizeDailyReservations は宿泊合計人数・団体数・年代男女別の内訳・食事の項目別合計を返す', () => {
    assert.deepStrictEqual(summarizeDailyReservations(RESERVATION_LIST, '2026-11-03', CATALOG), {
        date: '2026-11-03', stayGuests: 37 + 40, stayGroups: 2,
        stayBreakdown: { es_m: 0, es_f: 0, hs_m: 19, hs_f: 18, ad_m: 30, ad_f: 10 },
        meals: { breakfast: 38, lunch: 38, dinner: 37 + 40, bento: 5 + 3 + 12, tea: 12, onigiri: 0 }
    });
});

test('summarizeDailyReservations はチェックアウト日の食事を数え、宿泊は数えない', () => {
    assert.deepStrictEqual(summarizeDailyReservations(RESERVATION_LIST, '2026-11-04', CATALOG), {
        date: '2026-11-04', stayGuests: 0, stayGroups: 0,
        stayBreakdown: { es_m: 0, es_f: 0, hs_m: 0, hs_f: 0, ad_m: 0, ad_f: 0 },
        meals: { breakfast: 37 + 40, lunch: 37, dinner: 0, bento: 10, tea: 5, onigiri: 20 }
    });
});

test('summarizeDailyReservations は予約が空のとき・予約のない日はすべて0', () => {
    const emptySummary = summarizeDailyReservations([], '2026-11-03', CATALOG);
    assert.strictEqual(emptySummary.stayGuests, 0);
    assert.strictEqual(emptySummary.stayGroups, 0);
    assert.deepStrictEqual(Object.values(emptySummary.meals), [0, 0, 0, 0, 0, 0]);
    assert.deepStrictEqual(summarizeDailyReservations(RESERVATION_LIST, '2026-12-01', CATALOG).meals,
        { breakfast: 0, lunch: 0, dinner: 0, bento: 0, tea: 0, onigiri: 0 });
});

test('宿泊人数が0人の夜の予約は団体数に入れない', () => {
    const zeroStay = buildReservation({ id: 'R20261001-009', startDate: '2026-11-03', nights: 1 });
    assert.strictEqual(countStayGroups([...RESERVATION_LIST, zeroStay], '2026-11-03'), 2);
    assert.strictEqual(countStayGuests([...RESERVATION_LIST, zeroStay], '2026-11-03'), 77);
});

test('食事の集計項目は 朝食・昼食・夕食・弁当・お茶・おにぎり の6つで、弁当は弁当の品目をすべて数える', () => {
    assert.deepStrictEqual(MEAL_SUMMARY_ITEMS.map((item) => item.name), ['朝食', '昼食', '夕食', '弁当', 'お茶', 'おにぎり']);
    const bentoReservation = buildReservation({ id: 'R20261001-010', startDate: '2026-11-03', nights: 0,
        meals: { be_tatsu: [1], be_maku: [2], be_kara: [3], be_oni: [4] } });
    assert.strictEqual(summarizeDailyReservations([bentoReservation], '2026-11-03', CATALOG).meals.bento, 10);
});

// ---------- 宿泊の空き状況 ----------
test('judgeStaySymbol は人数の境界 200人・300人で記号が変わる', () => {
    assert.deepStrictEqual([0, 199, 200, 299, 300, 301].map((guests) => judgeStaySymbol(guests, 1, STAY_THRESHOLDS)),
        ['◎', '◎', '△', '△', '×', '×']);
});

test('judgeStaySymbol は団体数の境界 4団体・6団体で記号が変わる', () => {
    assert.deepStrictEqual([0, 3, 4, 5, 6, 7].map((groups) => judgeStaySymbol(10, groups, STAY_THRESHOLDS)),
        ['◎', '◎', '△', '△', '×', '×']);
});

test('judgeStaySymbol は人数と団体数の重いほうの記号にする', () => {
    assert.strictEqual(judgeStaySymbol(299, 6, STAY_THRESHOLDS), '×');
    assert.strictEqual(judgeStaySymbol(300, 0, STAY_THRESHOLDS), '×');
    assert.strictEqual(judgeStaySymbol(199, 4, STAY_THRESHOLDS), '△');
});

// ---------- 施設の空き状況 ----------
const findFacility = (facilitySchedules, facilityKey) => facilitySchedules.find((schedule) => schedule.facilityKey === facilityKey);
const listSymbols = (facilitySchedule) => facilitySchedule.units.map((unit) => unit.symbol).join('');

test('mapFacilitySchedule はすべての施設を、区分の施設は3区分・1時間の施設は12コマで返す', () => {
    const facilitySchedules = mapFacilitySchedule(RESERVATION_LIST, '2026-11-03', CATALOG);
    assert.deepStrictEqual(facilitySchedules.map((schedule) => schedule.facilityKey), ['gym', 'gym_s', 'field', 'kL', 'kS', 'mr']);
    assert.deepStrictEqual(facilitySchedules.map((schedule) => schedule.units.length), [3, 3, 3, 12, 12, 12]);
    assert.deepStrictEqual(findFacility(facilitySchedules, 'gym').units.map((unit) => unit.timeKey), ['am', 'pm', 'ev']);
    assert.deepStrictEqual(findFacility(facilitySchedules, 'kL').units.map((unit) => unit.label).slice(0, 1), ['9:00~10:00']);
    assert.deepStrictEqual(findFacility(facilitySchedules, 'kL').units.map((unit) => unit.label).slice(-1), ['20:00~21:00']);
});

test('mapFacilitySchedule は予約済みのコマを×、空いているコマを○にする（最初と最後のコマも判定する）', () => {
    const facilitySchedules = mapFacilitySchedule(RESERVATION_LIST, '2026-11-03', CATALOG);
    assert.strictEqual(listSymbols(findFacility(facilitySchedules, 'gym')), '×○○');
    assert.strictEqual(listSymbols(findFacility(facilitySchedules, 'gym_s')), '○○×');
    assert.strictEqual(listSymbols(findFacility(facilitySchedules, 'field')), '○○○');
    assert.strictEqual(listSymbols(findFacility(facilitySchedules, 'kL')), `×${'○'.repeat(11)}`);
    assert.strictEqual(listSymbols(findFacility(facilitySchedules, 'mr')), `${'○'.repeat(11)}×`);
});

test('mapFacilitySchedule は日付が違う予約のコマを数えない', () => {
    const facilitySchedules = mapFacilitySchedule(RESERVATION_LIST, '2026-11-02', CATALOG);
    assert.strictEqual(listSymbols(findFacility(facilitySchedules, 'gym')), '○×○');
    assert.strictEqual(listSymbols(findFacility(facilitySchedules, 'kL')), '○'.repeat(12));
});

test('mapFacilitySchedule は職員用に、予約しているコマへ団体の詳細を付け、空きのコマは空にする', () => {
    const gymSchedule = findFacility(mapFacilitySchedule(RESERVATION_LIST, '2026-11-03', CATALOG), 'gym');
    assert.deepStrictEqual(gymSchedule.units[0].bookings, [{
        id: UNIVERSITY.id, groupName: UNIVERSITY.groupName, representative: '山田 太郎', phone: '000-0000-0000', email: 'sample@example.com'
    }]);
    assert.deepStrictEqual(gymSchedule.units[1].bookings, []);
});

test('mapFacilitySchedule は予約が空ならすべて○', () => {
    const symbols = mapFacilitySchedule([], '2026-11-03', CATALOG).map(listSymbols).join('');
    assert.strictEqual(symbols, '○'.repeat(3 * 3 + 12 * 3));
});
