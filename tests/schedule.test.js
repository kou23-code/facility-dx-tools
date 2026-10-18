// スケジュール管理表：日別集計・空き状況・職員取込・公開用データの動作確認テスト
// 実行方法：node --test tests/schedule.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ROOT_DIR, RESERVATION_LOGIC_PATH } = require('./helpers');
const {
    RESERVATION_CATALOG: CATALOG, RESERVATION_CODE_TYPE, RESERVATION_CODE_VERSION, buildReservationCode, createSampleReservations
} = require(RESERVATION_LOGIC_PATH);
const SCHEDULE_LOGIC_PATH = path.join(ROOT_DIR, 'schedule', 'schedule-logic.js');
const ScheduleLogic = require(SCHEDULE_LOGIC_PATH);
const {
    SCHEDULE_CODE_TYPE, SCHEDULE_CODE_VERSION, STAY_THRESHOLDS, STAY_LIMITS, MEAL_SUMMARY_ITEMS, findNightIndex, findDayIndex, countStayOnDate,
    countStayGuests, countStayGroups, summarizeDailyReservations, judgeStaySymbol, mapFacilitySchedule,
    isImportableReservation, parseScheduleCode, applyReservationCode, buildDeleteCode,
    buildPublicSchedule,
    PUBLIC_SCHEDULE_TYPE, serializePublicSchedule, parsePublicSchedule, findPublicDay, mapPublicFacilitySchedule,
    judgeFacilityDaySymbol, summarizeFacilitySymbols,
    parseMonthKey, toMonthKeyOfDate, shiftMonthKey, formatMonthLabel, buildCalendarWeeks,
    resolveInitialMode, buildModeSearch, listGroupBadges, buildGroupDailyRows, mergeBookedUnits
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
    slots: [{ date: '2026-11-02', facilityKey: 'gym', timeKey: 'pm' }, { date: '2026-11-03', facilityKey: 'kL1', timeKey: 'h09' }]
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
    assert.deepStrictEqual(facilitySchedules.map((schedule) => schedule.facilityKey), ['gym', 'gym_s', 'track', 'court', 'kL1', 'kL3', 'kS', 'mr']);
    assert.deepStrictEqual(facilitySchedules.map((schedule) => schedule.units.length), [3, 3, 3, 3, 12, 12, 12, 12]);
    assert.deepStrictEqual(facilitySchedules.map((schedule) => schedule.name), ['大体育館', '小体育館', '陸上グラウンド', '球技場',
        '大研修室（第１研修室）', '大研修室（第３研修室）', '小研修室（第２研修室）', 'ミーティングルーム']);
    assert.deepStrictEqual(findFacility(facilitySchedules, 'gym').units.map((unit) => unit.timeKey), ['am', 'pm', 'ev']);
    assert.deepStrictEqual(findFacility(facilitySchedules, 'kL1').units.map((unit) => unit.label).slice(0, 1), ['9:00~10:00']);
    assert.deepStrictEqual(findFacility(facilitySchedules, 'kL1').units.map((unit) => unit.label).slice(-1), ['20:00~21:00']);
});

test('mapFacilitySchedule は予約済みのコマを×、空いているコマを○にする（最初と最後のコマも判定する）', () => {
    const facilitySchedules = mapFacilitySchedule(RESERVATION_LIST, '2026-11-03', CATALOG);
    assert.strictEqual(listSymbols(findFacility(facilitySchedules, 'gym')), '×○○');
    assert.strictEqual(listSymbols(findFacility(facilitySchedules, 'gym_s')), '○○×');
    assert.strictEqual(listSymbols(findFacility(facilitySchedules, 'track')), '○○○');
    assert.strictEqual(listSymbols(findFacility(facilitySchedules, 'kL1')), `×${'○'.repeat(11)}`);
    assert.strictEqual(listSymbols(findFacility(facilitySchedules, 'mr')), `${'○'.repeat(11)}×`);
});

test('mapFacilitySchedule は日付が違う予約のコマを数えない', () => {
    const facilitySchedules = mapFacilitySchedule(RESERVATION_LIST, '2026-11-02', CATALOG);
    assert.strictEqual(listSymbols(findFacility(facilitySchedules, 'gym')), '○×○');
    assert.strictEqual(listSymbols(findFacility(facilitySchedules, 'kL1')), '○'.repeat(12));
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
    assert.strictEqual(symbols, '○'.repeat(3 * 4 + 12 * 4), '区分の4施設×3区分と、1時間の4施設×12コマ');
});

// ---------- 職員取込用の1行コード ----------
const IMPORT_CONTEXT = Object.freeze({ catalog: CATALOG, limits: STAY_LIMITS });
// その夜（2026-11-10）に guests 人が泊まる1泊の予約
const buildStayReservation = (id, guests, slots) => buildReservation({
    id, startDate: '2026-11-10', nights: 1, stays: { ad_m: [guests] }, slots
});
const toPlain = (value) => JSON.parse(JSON.stringify(value));

test('取込用コードの種類・版は予約システムの1行コードと同じで、予約システムのコードをそのまま読める', () => {
    assert.strictEqual(SCHEDULE_CODE_TYPE, RESERVATION_CODE_TYPE);
    assert.strictEqual(SCHEDULE_CODE_VERSION, RESERVATION_CODE_VERSION);
    const result = applyReservationCode([], buildReservationCode(HIGH_SCHOOL), IMPORT_CONTEXT);
    assert.deepStrictEqual(toPlain(result), { ok: true, operation: 'added', id: HIGH_SCHOOL.id, reservations: [toPlain(HIGH_SCHOOL)] });
});

test('予約システムのデモ用サンプル予約は、すべて取込できる形と判定される', () => {
    createSampleReservations('2026-10-18', CATALOG).forEach((sample) => assert.strictEqual(isImportableReservation(sample, CATALOG), true, sample.id));
});

test('applyReservationCode は同じ予約番号があれば更新し、元の一覧を書き換えない', () => {
    const changed = { ...HIGH_SCHOOL, groupName: 'サンプル高校 陸上部（変更）' };
    const result = applyReservationCode(RESERVATION_LIST, buildReservationCode(changed), IMPORT_CONTEXT);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.operation, 'updated');
    assert.deepStrictEqual(result.reservations.map((reservation) => reservation.groupName), [changed.groupName, UNIVERSITY.groupName, DAY_TRIP.groupName]);
    assert.strictEqual(RESERVATION_LIST[0].groupName, HIGH_SCHOOL.groupName);
});

test('applyReservationCode の更新は、同じ予約の古いコマ・人数とは重複にしない', () => {
    const moreGuests = { ...HIGH_SCHOOL, stays: { ...HIGH_SCHOOL.stays, hs_m: [30, 30] } };
    assert.strictEqual(applyReservationCode(RESERVATION_LIST, buildReservationCode(moreGuests), IMPORT_CONTEXT).ok, true);
});

test('applyReservationCode は action: delete のコードで予約を削除する', () => {
    const result = applyReservationCode(RESERVATION_LIST, buildDeleteCode(UNIVERSITY.id), IMPORT_CONTEXT);
    assert.deepStrictEqual(toPlain(result), { ok: true, operation: 'deleted', id: UNIVERSITY.id, reservations: toPlain([HIGH_SCHOOL, DAY_TRIP]) });
    assert.strictEqual(RESERVATION_LIST.length, 3);
});

test('applyReservationCode は、ない予約番号の削除をエラーにする', () => {
    assert.deepStrictEqual(applyReservationCode(RESERVATION_LIST, buildDeleteCode('R20990101-001'), IMPORT_CONTEXT),
        { ok: false, errors: ['予約番号 R20990101-001 の予約はありません'] });
});

test('applyReservationCode はほかの団体と重なる施設コマをエラーにし、一覧を返さない', () => {
    const overlapping = buildReservation({ id: 'R20261001-020', startDate: '2026-11-03', nights: 0,
        slots: [{ date: '2026-11-03', facilityKey: 'gym', timeKey: 'am' }, { date: '2026-11-03', facilityKey: 'mr', timeKey: 'h20' },
            { date: '2026-11-03', facilityKey: 'track', timeKey: 'am' }] });
    assert.deepStrictEqual(applyReservationCode(RESERVATION_LIST, buildReservationCode(overlapping), IMPORT_CONTEXT), {
        ok: false, errors: ['2026-11-03 大体育館 AM はすでに別の団体の予約が入っています',
            '2026-11-03 ミーティングルーム 20:00~21:00 はすでに別の団体の予約が入っています']
    });
});

test('applyReservationCode は同じ予約の中で2回入っている施設コマをエラーにする', () => {
    const slot = { date: '2026-11-10', facilityKey: 'track', timeKey: 'ev' };
    const result = applyReservationCode([], buildReservationCode(buildStayReservation('R20261001-021', 10, [slot, slot])), IMPORT_CONTEXT);
    assert.deepStrictEqual(result, { ok: false, errors: ['2026-11-10 陸上グラウンド 夜 が2回入っています'] });
});

test('applyReservationCode は1日の宿泊人数がちょうど300人までは取り込み、301人でエラーにする', () => {
    const others = [buildStayReservation('R20261001-030', 200), buildStayReservation('R20261001-031', 60)];
    assert.strictEqual(applyReservationCode(others, buildReservationCode(buildStayReservation('R20261001-032', 40)), IMPORT_CONTEXT).ok, true);
    assert.deepStrictEqual(applyReservationCode(others, buildReservationCode(buildStayReservation('R20261001-032', 41)), IMPORT_CONTEXT),
        { ok: false, errors: ['2026-11-10の夜の宿泊人数が1日の上限（300人）を超えます（合計 301人）'] });
});

test('applyReservationCode は1日の宿泊団体がちょうど6団体までは取り込み、7団体目でエラーにする', () => {
    const fiveGroups = Array.from({ length: 5 }, (_, index) => buildStayReservation(`R20261001-04${index}`, 10));
    const sixGroups = [...fiveGroups, buildStayReservation('R20261001-045', 10)];
    assert.strictEqual(applyReservationCode(fiveGroups, buildReservationCode(buildStayReservation('R20261001-046', 10)), IMPORT_CONTEXT).ok, true);
    assert.deepStrictEqual(applyReservationCode(sixGroups, buildReservationCode(buildStayReservation('R20261001-046', 10)), IMPORT_CONTEXT),
        { ok: false, errors: ['2026-11-10の夜の宿泊団体数が1日の上限（6団体）を超えます（合計 7団体）'] });
});

test('applyReservationCode は宿泊人数・団体数が上限の夜でも、泊まらない予約（日帰り）は取り込む', () => {
    const sixGroups = Array.from({ length: 6 }, (_, index) => buildStayReservation(`R20261001-05${index}`, 50));
    const dayTrip = buildReservation({ id: 'R20261001-056', startDate: '2026-11-10', nights: 0 });
    assert.strictEqual(applyReservationCode(sixGroups, buildReservationCode(dayTrip), IMPORT_CONTEXT).ok, true);
});

test('applyReservationCode は人数と団体数の両方が上限を超えると、両方の文言を返す', () => {
    const sixGroups = Array.from({ length: 6 }, (_, index) => buildStayReservation(`R20261001-06${index}`, 50));
    assert.strictEqual(applyReservationCode(sixGroups, buildReservationCode(buildStayReservation('R20261001-066', 1)), IMPORT_CONTEXT).errors.length, 2);
});

test('parseScheduleCode は取込用コードでないもの・違う版・知らない操作をエラーにする', () => {
    assert.deepStrictEqual(parseScheduleCode(''), { ok: false, errors: ['予約の取込用コードではありません'] });
    assert.deepStrictEqual(parseScheduleCode('{壊れたJSON'), { ok: false, errors: ['予約の取込用コードではありません'] });
    assert.deepStrictEqual(parseScheduleCode(undefined), { ok: false, errors: ['予約の取込用コードではありません'] });
    assert.deepStrictEqual(parseScheduleCode(JSON.stringify({ type: SCHEDULE_CODE_TYPE, version: 2 })),
        { ok: false, errors: ['対応していない版のコードです（version 2）'] });
    assert.deepStrictEqual(parseScheduleCode(JSON.stringify({ type: SCHEDULE_CODE_TYPE, version: 3, action: 'drop' })),
        { ok: false, errors: ['知らない操作です（action drop）'] });
});

test('parseScheduleCode は前後の空白・改行を無視して読む', () => {
    assert.strictEqual(parseScheduleCode(`  ${buildReservationCode(HIGH_SCHOOL)}\n`).ok, true);
});

test('applyReservationCode は形の正しくない予約をエラーにする', () => {
    [null, {}, { ...HIGH_SCHOOL, id: '' }, { ...HIGH_SCHOOL, startDate: '2026-02-30' }, { ...HIGH_SCHOOL, nights: -1 },
        { ...HIGH_SCHOOL, stays: { hs_m: [20] } }, { ...HIGH_SCHOOL, meals: { bf: [1, 2] } }, { ...HIGH_SCHOOL, slots: 'gym' },
        { ...HIGH_SCHOOL, slots: [{ date: '2026-11-02', facilityKey: 'pool', timeKey: 'am' }] },
        { ...HIGH_SCHOOL, slots: [{ date: '2026-11-02', facilityKey: 'gym', timeKey: 'h09' }] },
        { ...HIGH_SCHOOL, slots: [{ date: '2026-11-02', facilityKey: 'kL1', timeKey: 'h21' }] },
        { ...HIGH_SCHOOL, slots: [{ date: '2026-11-05', facilityKey: 'gym', timeKey: 'am' }] }
    ].forEach((reservation, index) => assert.deepStrictEqual(applyReservationCode([], buildReservationCode(reservation), IMPORT_CONTEXT),
        { ok: false, errors: ['予約の内容が正しくありません'] }, `${index}番目`));
});

// ---------- 公開用データ ----------
test('buildPublicSchedule は日別の宿泊人数・団体数と、埋まっている施設コマだけを日付の順に返す', () => {
    assert.deepStrictEqual(buildPublicSchedule([DAY_TRIP, UNIVERSITY, HIGH_SCHOOL], CATALOG), { days: [
        { date: '2026-11-02', stayGuests: 38, stayGroups: 1, bookedSlots: [{ facilityKey: 'gym', timeKey: 'pm' }] },
        { date: '2026-11-03', stayGuests: 77, stayGroups: 2, bookedSlots: [{ facilityKey: 'gym', timeKey: 'am' },
            { facilityKey: 'gym_s', timeKey: 'ev' }, { facilityKey: 'kL1', timeKey: 'h09' }, { facilityKey: 'mr', timeKey: 'h20' }] }
    ] });
});

test('buildPublicSchedule は宿泊も施設コマもない日（チェックアウト日・食事だけの日）を入れない', () => {
    const mealOnly = buildReservation({ id: 'R20261001-070', startDate: '2026-12-01', nights: 0, meals: { te: [5] } });
    assert.deepStrictEqual(buildPublicSchedule([mealOnly], CATALOG), { days: [] });
    assert.deepStrictEqual(buildPublicSchedule([], CATALOG), { days: [] });
});

test('buildPublicSchedule の結果には、団体名・代表者名・電話番号・メールアドレス・予約番号などの個人情報が含まれない', () => {
    const samples = createSampleReservations('2026-10-18', CATALOG);
    const publicText = JSON.stringify(buildPublicSchedule([...RESERVATION_LIST, ...samples], CATALOG));
    const privateValues = [...RESERVATION_LIST, ...samples].flatMap((reservation) => [
        reservation.id, reservation.groupName, reservation.representative, reservation.phone, reservation.email, reservation.createdAt]);
    privateValues.forEach((privateValue) => assert.strictEqual(publicText.includes(privateValue), false, privateValue));
    ['groupName', 'representative', 'phone', 'email', 'purpose', 'id', 'createdAt', 'meals', 'stays', 'estimatedTotal']
        .forEach((privateKey) => assert.strictEqual(publicText.includes(`"${privateKey}"`), false, privateKey));
});

test('buildPublicSchedule の1日分は date・stayGuests・stayGroups・bookedSlots の項目だけを持つ', () => {
    const { days } = buildPublicSchedule(createSampleReservations('2026-10-18', CATALOG), CATALOG);
    assert.ok(days.length > 0);
    days.forEach((day) => assert.deepStrictEqual(Object.keys(day), ['date', 'stayGuests', 'stayGroups', 'bookedSlots']));
    days.flatMap((day) => day.bookedSlots).forEach((slot) => assert.deepStrictEqual(Object.keys(slot), ['facilityKey', 'timeKey']));
});

// ---------- 公開用データの JSON（出力と読み込み） ----------
const PUBLIC_JSON = serializePublicSchedule(RESERVATION_LIST, CATALOG, '2026-10-18T09:30');

test('serializePublicSchedule は種類・版・作成日時と日別のデータを JSON にし、parsePublicSchedule でそのまま読める', () => {
    const parsed = JSON.parse(PUBLIC_JSON);
    assert.deepStrictEqual(Object.keys(parsed), ['type', 'version', 'generatedAt', 'days']);
    assert.strictEqual(parsed.type, PUBLIC_SCHEDULE_TYPE);
    assert.deepStrictEqual(parsePublicSchedule(PUBLIC_JSON, CATALOG),
        { ok: true, schedule: { generatedAt: '2026-10-18T09:30', ...buildPublicSchedule(RESERVATION_LIST, CATALOG) } });
});

test('parsePublicSchedule は決まった項目以外（団体名など）が混ざっていても捨てて読む', () => {
    const parsed = JSON.parse(PUBLIC_JSON);
    const tampered = JSON.stringify({ ...parsed, generatedAt: '山田 太郎', groupName: 'X',
        days: parsed.days.map((day) => ({ ...day, groupName: 'サンプル高校', bookedSlots: day.bookedSlots.map((slot) => ({ ...slot, phone: '0000' })) })) });
    const result = parsePublicSchedule(tampered, CATALOG);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.schedule.generatedAt, '');
    ['サンプル高校', '0000', '山田 太郎'].forEach((text) => assert.strictEqual(JSON.stringify(result.schedule).includes(text), false, text));
});

test('parsePublicSchedule は公開用データでないもの・違う版・形の正しくない日をエラーにする', () => {
    const parsed = JSON.parse(PUBLIC_JSON);
    assert.deepStrictEqual(parsePublicSchedule('', CATALOG), { ok: false, errors: ['公開用スケジュールデータではありません'] });
    assert.deepStrictEqual(parsePublicSchedule(buildReservationCode(HIGH_SCHOOL), CATALOG), { ok: false, errors: ['公開用スケジュールデータではありません'] });
    assert.deepStrictEqual(parsePublicSchedule(JSON.stringify({ ...parsed, version: 9 }), CATALOG),
        { ok: false, errors: ['対応していない版の公開用データです（version 9）'] });
    [{ days: null }, { days: [null] }, { days: [{ ...parsed.days[0], date: '2026-13-01' }] }, { days: [{ ...parsed.days[0], stayGuests: -1 }] },
        { days: [{ ...parsed.days[0], stayGroups: 1.5 }] }, { days: [{ ...parsed.days[0], bookedSlots: [{ facilityKey: 'pool', timeKey: 'am' }] }] },
        { days: [{ ...parsed.days[0], bookedSlots: [{ facilityKey: 'kL1', timeKey: 'am' }] }] }
    ].forEach((patch, index) => assert.deepStrictEqual(parsePublicSchedule(JSON.stringify({ ...parsed, ...patch }), CATALOG),
        { ok: false, errors: ['公開用データの内容が正しくありません'] }, `${index}番目`));
});

test('parsePublicSchedule は日が1つもない公開用データも読める（予約なし）', () => {
    assert.deepStrictEqual(parsePublicSchedule(serializePublicSchedule([], CATALOG, '2026-10-18T09:30'), CATALOG),
        { ok: true, schedule: { generatedAt: '2026-10-18T09:30', days: [] } });
});

// ---------- 公開用データからの表示 ----------
const PUBLIC_SCHEDULE = buildPublicSchedule(RESERVATION_LIST, CATALOG);

test('findPublicDay はその日のデータを返し、記録のない日は宿泊0人・施設コマなしにする', () => {
    assert.strictEqual(findPublicDay(PUBLIC_SCHEDULE, '2026-11-03').stayGuests, 77);
    assert.deepStrictEqual(findPublicDay(PUBLIC_SCHEDULE, '2026-12-01'), { date: '2026-12-01', stayGuests: 0, stayGroups: 0, bookedSlots: [] });
});

test('mapPublicFacilitySchedule は公開用データだけで、予約データから作るのと同じ○/×を出し、団体の詳細は空にする', () => {
    ['2026-11-02', '2026-11-03', '2026-11-04'].forEach((date) => {
        const fromPublic = mapPublicFacilitySchedule(findPublicDay(PUBLIC_SCHEDULE, date), CATALOG);
        const fromReservations = mapFacilitySchedule(RESERVATION_LIST, date, CATALOG)
            .map((facility) => ({ ...facility, units: facility.units.map((unit) => ({ ...unit, bookings: [] })) }));
        assert.deepStrictEqual(toPlain(fromPublic), toPlain(fromReservations), date);
    });
});

test('judgeFacilityDaySymbol はすべて空き◎・一部予約△・すべて予約×（境界：0コマ・1コマ・全コマ）', () => {
    const buildUnits = (bookedCount, total) => Array.from({ length: total }, (_, index) => ({ symbol: index < bookedCount ? '×' : '○' }));
    assert.deepStrictEqual([0, 1, 2, 3].map((bookedCount) => judgeFacilityDaySymbol(buildUnits(bookedCount, 3))), ['◎', '△', '△', '×']);
    assert.deepStrictEqual([0, 11, 12].map((bookedCount) => judgeFacilityDaySymbol(buildUnits(bookedCount, 12))), ['◎', '△', '×']);
});

test('summarizeFacilitySymbols は施設ごとの略称と記号を、施設の順に返す', () => {
    const gymFull = buildReservation({ id: 'R20261001-080', startDate: '2026-11-03', nights: 0,
        slots: ['pm', 'ev'].map((timeKey) => ({ date: '2026-11-03', facilityKey: 'gym', timeKey })) });
    assert.deepStrictEqual(summarizeFacilitySymbols(mapFacilitySchedule([...RESERVATION_LIST, gymFull], '2026-11-03', CATALOG), CATALOG), [
        { facilityKey: 'gym', shortName: '大体', symbol: '×' }, { facilityKey: 'gym_s', shortName: '小体', symbol: '△' },
        { facilityKey: 'track', shortName: '陸上', symbol: '◎' }, { facilityKey: 'court', shortName: '球技', symbol: '◎' },
        { facilityKey: 'kL1', shortName: '大研1', symbol: '△' }, { facilityKey: 'kL3', shortName: '大研3', symbol: '◎' },
        { facilityKey: 'kS', shortName: '小研2', symbol: '◎' }, { facilityKey: 'mr', shortName: 'MR', symbol: '△' }
    ]);
});

test('summarizeFacilitySymbols は陸上グラウンドと球技場、第１研修室と第３研修室の記号を別々に出す', () => {
    const trackFull = buildReservation({ id: 'R20261001-081', startDate: '2026-11-03', nights: 0,
        slots: ['am', 'pm', 'ev'].map((timeKey) => ({ date: '2026-11-03', facilityKey: 'track', timeKey })).concat([{ date: '2026-11-03', facilityKey: 'kL3', timeKey: 'h12' }]) });
    const symbols = summarizeFacilitySymbols(mapFacilitySchedule([trackFull], '2026-11-03', CATALOG), CATALOG);
    const symbolOf = (key) => symbols.find((entry) => entry.facilityKey === key).symbol;
    assert.deepStrictEqual(['track', 'court', 'kL1', 'kL3'].map(symbolOf), ['×', '◎', '◎', '△']);
});

test('summarizeFacilitySymbols は略称のない施設には施設名を出す', () => {
    const catalog = { ...CATALOG, facilities: [{ key: 'pool', name: 'プール', billing: 'period' }] };
    assert.deepStrictEqual(summarizeFacilitySymbols(mapFacilitySchedule([], '2026-11-03', catalog), catalog), [{ facilityKey: 'pool', shortName: 'プール', symbol: '◎' }]);
});

// ---------- 月間カレンダー ----------
test('parseMonthKey は "YYYY-MM" を年と月にし、1〜12月でなければ null', () => {
    assert.deepStrictEqual(parseMonthKey('2026-10'), { year: 2026, month: 10 });
    ['2026-00', '2026-13', '2026-1', '', undefined, '2026-10-01'].forEach((value) => assert.strictEqual(parseMonthKey(value), null, String(value)));
    assert.strictEqual(toMonthKeyOfDate('2026-10-18'), '2026-10');
});

test('shiftMonthKey は前月・次月に動かし、年をまたぐ', () => {
    assert.deepStrictEqual([-1, 1, 2, 3, -10, -11, 15].map((delta) => shiftMonthKey('2026-10', delta)),
        ['2026-09', '2026-11', '2026-12', '2027-01', '2025-12', '2025-11', '2028-01']);
    assert.strictEqual(shiftMonthKey('2026-01', -1), '2025-12');
    assert.strictEqual(formatMonthLabel('2026-03'), '2026年3月');
});

test('buildCalendarWeeks は日曜始まりで、月の外のマスを null にした7マスの週を返す', () => {
    const weeks = buildCalendarWeeks('2026-10');
    assert.strictEqual(weeks.length, 5);
    assert.deepStrictEqual(weeks[0], [null, null, null, null, '2026-10-01', '2026-10-02', '2026-10-03']);
    assert.deepStrictEqual(weeks[4], ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
    weeks.forEach((week) => assert.strictEqual(week.length, 7));
});

test('buildCalendarWeeks はうるう年の2月・日曜始まりの月・6週になる月も正しく並べる', () => {
    const countDates = (weeks) => weeks.flat().filter(Boolean).length;
    assert.strictEqual(countDates(buildCalendarWeeks('2028-02')), 29);
    assert.strictEqual(countDates(buildCalendarWeeks('2026-02')), 28);
    assert.deepStrictEqual(buildCalendarWeeks('2026-02').length, 4);
    assert.strictEqual(buildCalendarWeeks('2026-02')[0][0], '2026-02-01');
    assert.strictEqual(buildCalendarWeeks('2026-08').length, 6);
    assert.deepStrictEqual(buildCalendarWeeks('2026-08')[5], ['2026-08-30', '2026-08-31', null, null, null, null, null]);
});

// ---------- 表示モード ----------
test('resolveInitialMode は ?mode=staff のときだけ職員用、それ以外は公開用', () => {
    assert.deepStrictEqual(['?mode=staff', '?x=1&mode=staff', '', '?mode=public', '?mode=STAFF', undefined].map(resolveInitialMode),
        ['staff', 'staff', 'public', 'public', 'public', 'public']);
});

test('buildModeSearch は職員用で mode=staff を付け、公開用で消し、ほかのパラメータは残す', () => {
    assert.strictEqual(buildModeSearch('', 'staff'), '?mode=staff');
    assert.strictEqual(buildModeSearch('?mode=staff', 'public'), '');
    assert.strictEqual(buildModeSearch('?x=1&mode=staff', 'public'), '?x=1');
    assert.strictEqual(buildModeSearch('?x=1', 'staff'), '?x=1&mode=staff');
});

// ---------- 職員用の団体ごとの表示 ----------
test('listGroupBadges はその日に利用する団体（チェックアウト日・日帰りを含む）と、泊まるかどうかを返す', () => {
    assert.deepStrictEqual(listGroupBadges(RESERVATION_LIST, '2026-11-03'), [
        { id: HIGH_SCHOOL.id, groupName: HIGH_SCHOOL.groupName, isStay: true },
        { id: UNIVERSITY.id, groupName: UNIVERSITY.groupName, isStay: true },
        { id: DAY_TRIP.id, groupName: DAY_TRIP.groupName, isStay: false }
    ]);
    assert.deepStrictEqual(listGroupBadges(RESERVATION_LIST, '2026-11-04').map((badge) => badge.isStay), [false, false]);
    assert.deepStrictEqual(listGroupBadges(RESERVATION_LIST, '2026-11-01'), []);
});

test('buildGroupDailyRows は団体ごとの連絡先・その夜の宿泊人数・食事の項目別の数を返し、合計は日別集計と一致する', () => {
    const rows = buildGroupDailyRows(RESERVATION_LIST, '2026-11-03', CATALOG);
    assert.deepStrictEqual(rows.map((row) => [row.id, row.representative, row.phone, row.stayGuests]),
        [[HIGH_SCHOOL.id, '山田 太郎', '000-0000-0000', 37], [UNIVERSITY.id, '山田 太郎', '000-0000-0000', 40], [DAY_TRIP.id, '山田 太郎', '000-0000-0000', 0]]);
    assert.deepStrictEqual(rows[2].meals, { breakfast: 0, lunch: 0, dinner: 0, bento: 12, tea: 12, onigiri: 0 });
    const summary = summarizeDailyReservations(RESERVATION_LIST, '2026-11-03', CATALOG);
    MEAL_SUMMARY_ITEMS.forEach((item) => assert.strictEqual(rows.reduce((total, row) => total + row.meals[item.key], 0), summary.meals[item.key], item.key));
});

test('mergeBookedUnits は同じ団体のとなりあうコマをまとめ、空きのコマ・別の団体のコマはまとめない', () => {
    const booking = (id) => [{ id }];
    const units = [[], booking('A'), booking('A'), booking('B'), [], [], booking('A')]
        .map((bookings, index) => ({ timeKey: `h${index}`, symbol: bookings.length > 0 ? '×' : '○', bookings }));
    assert.deepStrictEqual(mergeBookedUnits(units).map((run) => [run.symbol, run.units.length, run.bookings.map((entry) => entry.id).join('')]),
        [['○', 1, ''], ['×', 2, 'A'], ['×', 1, 'B'], ['○', 1, ''], ['○', 1, ''], ['×', 1, 'A']]);
    assert.deepStrictEqual(mergeBookedUnits([]), []);
});
