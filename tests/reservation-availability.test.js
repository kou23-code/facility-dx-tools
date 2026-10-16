// Web予約システム：空き状況・重複・定員超過・予約不可の判定の動作確認テスト
// 実行方法：node --test tests/reservation-availability.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { RESERVATION_LOGIC_PATH } = require('./helpers');
const {
    RESERVATION_CONFIG: CONFIG, RESERVATION_CATALOG: CATALOG,
    isClosedDate, countStayGuests, judgeStayAvailability, isSlotBooked, judgeFacilityAvailability, buildAvailabilityRows,
    findSlotConflicts, findDuplicateSlots, findCapacityOverflows, formatSlotName, findAvailabilityConflicts,
    isPhoneNumber, findInputMessages, findScheduleMessages, findReservationBlockers
} = require(RESERVATION_LOGIC_PATH);

const toPlain = (value) => JSON.parse(JSON.stringify(value));
const slotOf = (date, facilityKey, periodKey) => ({ date, facilityKey, periodKey });

const buildReservation = (id, overrides) => ({
    id, createdAt: '2026-10-01T09:00', groupName: '既存の団体', representative: '鈴木 一郎', phone: '0000000000',
    email: 'booked@example.com', purpose: 'スポーツ合宿', startDate: '2026-11-02', nights: 1, priceType: 'ad', people: 0,
    meals: { bf: 0, lu: 0, di: 0 }, slots: [], ...overrides
});
const buildRequest = (overrides) => ({
    groupName: 'サンプル高校 陸上部', representative: '山田 太郎', phone: '000-0000-0000', email: 'sample@example.com',
    purpose: 'スポーツ合宿', startDate: '2026-11-02', nights: 2, priceType: 'hs', people: 20,
    meals: { bf: 0, lu: 0, di: 0 }, slots: [], ...overrides
});

// 11/2〜11/3 に60人、11/3 に25人（11/3 の夜は85人）。11/3 の大体育館は全区分、11/2 の小体育館は AM だけ予約済み
const RESERVATIONS = [
    buildReservation('R1', { nights: 2, people: 60, slots: [slotOf('2026-11-02', 'gym_s', 'am')] }),
    buildReservation('R2', { startDate: '2026-11-03', people: 25,
        slots: [slotOf('2026-11-03', 'gym', 'am'), slotOf('2026-11-03', 'gym', 'pm'), slotOf('2026-11-03', 'gym', 'ev')] })
];
const CONTEXT = { reservations: RESERVATIONS, config: CONFIG, catalog: CATALOG, today: '2026-10-17' };

test('isClosedDate は "MM-DD"（毎年）と "YYYY-MM-DD"（その日だけ）の休館日を判定する', () => {
    assert.strictEqual(isClosedDate('2026-12-31', CONFIG.closedDates), true);
    assert.strictEqual(isClosedDate('2027-01-03', CONFIG.closedDates), true);
    assert.strictEqual(isClosedDate('2027-01-04', CONFIG.closedDates), false);
    assert.strictEqual(isClosedDate('2026-11-03', ['2026-11-03']), true);
    assert.strictEqual(isClosedDate('2027-11-03', ['2026-11-03']), false);
    assert.strictEqual(isClosedDate('2026-11-03', []), false);
});

test('countStayGuests はその夜に泊まる人数だけを合計する（チェックアウト日の夜は数えない）', () => {
    assert.deepStrictEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'].map((date) => countStayGuests(RESERVATIONS, date)), [0, 60, 85, 0]);
    assert.strictEqual(countStayGuests([], '2026-11-02'), 0);
});

test('judgeStayAvailability：残りが定員の30%以上は◎、30%未満は△、0以下は×', () => {
    assert.deepStrictEqual([0, 70, 71, 99, 100, 120].map((booked) => judgeStayAvailability(booked, 100, 0.3)), ['◎', '◎', '△', '△', '×', '×']);
});

test('judgeFacilityAvailability：予約0区分は◎、一部は△、全区分は×', () => {
    assert.deepStrictEqual([0, 1, 2, 3].map((count) => judgeFacilityAvailability(count, 3)), ['◎', '△', '△', '×']);
});

test('isSlotBooked は日付・施設・時間帯がすべて同じときだけ予約済みにする', () => {
    assert.strictEqual(isSlotBooked(RESERVATIONS, slotOf('2026-11-02', 'gym_s', 'am')), true);
    assert.strictEqual(isSlotBooked(RESERVATIONS, slotOf('2026-11-02', 'gym_s', 'pm')), false);
    assert.strictEqual(isSlotBooked(RESERVATIONS, slotOf('2026-11-03', 'gym_s', 'am')), false);
    assert.strictEqual(isSlotBooked(RESERVATIONS, slotOf('2026-11-02', 'gym', 'am')), false);
});

test('buildAvailabilityRows は日ごとに宿泊と施設の空き状況を作る', () => {
    const rows = buildAvailabilityRows(RESERVATIONS, '2026-11-02', 2, CONTEXT);
    assert.deepStrictEqual(rows.map((row) => row.date), ['2026-11-02', '2026-11-03', '2026-11-04']);
    assert.deepStrictEqual(toPlain(rows.map((row) => row.stay)), [
        { booked: 60, remaining: 40, symbol: '◎' }, { booked: 85, remaining: 15, symbol: '△' }, null
    ]);
    const symbolsOf = (row) => Object.fromEntries(row.facilities.map((status) => [status.facilityKey, status.symbol]));
    assert.deepStrictEqual(symbolsOf(rows[0]), { gym: '◎', gym_s: '△', field: '◎', kL: '◎', kS: '◎', mr: '◎' });
    assert.deepStrictEqual(symbolsOf(rows[1]), { gym: '×', gym_s: '◎', field: '◎', kL: '◎', kS: '◎', mr: '◎' });
    assert.deepStrictEqual(toPlain(rows[0].facilities[1].bookedPeriodKeys), ['am']);
});

test('buildAvailabilityRows：予約がなければすべて◎、休館日は宿泊も施設もすべて×', () => {
    const emptyRows = buildAvailabilityRows([], '2026-11-02', 1, CONTEXT);
    assert.strictEqual(emptyRows[0].stay.symbol, '◎');
    assert.ok(emptyRows.every((row) => row.facilities.every((status) => status.symbol === '◎')));
    const closedRows = buildAvailabilityRows([], '2026-12-28', 1, CONTEXT);
    assert.deepStrictEqual(closedRows.map((row) => row.isClosed), [false, true]);
    assert.ok(closedRows[1].facilities.every((status) => status.symbol === '×'));
    assert.strictEqual(buildAvailabilityRows([], '2026-12-29', 1, CONTEXT)[0].stay.symbol, '×');
});

test('findSlotConflicts・findDuplicateSlots は予約済みのコマと、申込の中の重なりを見つける', () => {
    const slots = [slotOf('2026-11-03', 'gym', 'pm'), slotOf('2026-11-03', 'gym_s', 'pm'), slotOf('2026-11-03', 'gym_s', 'pm')];
    assert.deepStrictEqual(toPlain(findSlotConflicts(RESERVATIONS, slots)), [slotOf('2026-11-03', 'gym', 'pm')]);
    assert.deepStrictEqual(toPlain(findDuplicateSlots(slots)), [slotOf('2026-11-03', 'gym_s', 'pm')]);
    assert.deepStrictEqual(findSlotConflicts(RESERVATIONS, []), []);
    assert.deepStrictEqual(findDuplicateSlots([]), []);
});

test('findCapacityOverflows は定員ちょうどまで許し、超える夜だけを返す', () => {
    assert.deepStrictEqual(findCapacityOverflows(RESERVATIONS, buildRequest({ people: 15 }), 100), []);
    assert.deepStrictEqual(toPlain(findCapacityOverflows(RESERVATIONS, buildRequest({ people: 16 }), 100)), [
        { date: '2026-11-03', booked: 85, requested: 16, remaining: 15 }
    ]);
    assert.strictEqual(findCapacityOverflows(RESERVATIONS, buildRequest({ people: 41 }), 100).length, 2);
    assert.deepStrictEqual(findCapacityOverflows(RESERVATIONS, buildRequest({ nights: 0, people: 300 }), 100), [], '日帰りは定員の対象外');
});

test('formatSlotName は施設名と時間帯名を出し、知らないキーはそのまま出す', () => {
    assert.strictEqual(formatSlotName(slotOf('2026-11-02', 'kL', 'ev'), CATALOG), '大研修室(1･3研) 夜');
    assert.strictEqual(formatSlotName(slotOf('2026-11-02', 'pool', 'xx'), CATALOG), 'pool xx');
});

test('findAvailabilityConflicts は定員超過・施設コマの重複・休館日を文言にする', () => {
    const request = buildRequest({ people: 20, slots: [slotOf('2026-11-03', 'gym', 'ev'), slotOf('2026-11-03', 'gym_s', 'ev')] });
    assert.deepStrictEqual(findAvailabilityConflicts(request, CONTEXT), [
        '11/3(火)の夜は宿泊定員を超えます（ご希望 20人 ／ 残り 15人）。人数か日程を変更してください。',
        '11/3(火)の「大体育館 夜」はすでに予約が入っています。別の時間帯か日程を選んでください。'
    ]);
    assert.deepStrictEqual(findAvailabilityConflicts(buildRequest({ startDate: '2026-12-28', nights: 1, people: 1 }), CONTEXT),
        ['12/29(火)は休館日のため予約できません。日程を変更してください。']);
    assert.deepStrictEqual(findAvailabilityConflicts(buildRequest({ people: 15 }), CONTEXT), []);
});

test('findAvailabilityConflicts は日程が正しくないときは判定しない', () => {
    assert.deepStrictEqual(findAvailabilityConflicts(buildRequest({ startDate: '' }), CONTEXT), []);
    assert.deepStrictEqual(findAvailabilityConflicts(buildRequest({ nights: NaN }), CONTEXT), []);
    assert.deepStrictEqual(findAvailabilityConflicts(buildRequest({ nights: 99 }), CONTEXT), []);
});

test('isPhoneNumber は数字とハイフンで10〜11桁だけを認める', () => {
    ['0000000000', '000-0000-0000', '00-0000-0000', '00000000000'].forEach((phone) => assert.strictEqual(isPhoneNumber(phone), true, phone));
    ['000000000', '000000000000', '000(0000)0000', 'abc', ''].forEach((phone) => assert.strictEqual(isPhoneNumber(phone), false, phone));
});

test('findInputMessages：正しい申込なら空', () => {
    assert.deepStrictEqual(findInputMessages(buildRequest({ meals: { bf: 40, lu: 60, di: 40 } }), CONFIG, CATALOG), []);
});

test('findInputMessages：必須の項目が空・空白だけなら未入力にする', () => {
    const request = buildRequest({ groupName: '', representative: '  ', phone: '', email: '', purpose: '' });
    assert.deepStrictEqual(findInputMessages(request, CONFIG, CATALOG),
        ['団体名が未入力です', '代表者名が未入力です', '電話番号が未入力です', 'メールアドレスが未入力です', '利用目的が未入力です']);
});

test('findInputMessages：電話番号・メール・利用目的・日付・泊数・人数・料金区分の形をチェックする', () => {
    const request = buildRequest({ phone: '123', email: 'a@b', purpose: '旅行', startDate: '2026-02-30', nights: 7, people: 301, priceType: 'zz' });
    assert.deepStrictEqual(findInputMessages(request, CONFIG, CATALOG), [
        '電話番号は数字とハイフンで10〜11桁を入力してください', 'メールアドレスの形が正しくありません', '利用目的を一覧から選んでください',
        '利用開始日を選んでください', '泊数は日帰り〜6泊から選んでください', '人数は1〜300人で入力してください', '料金区分を選んでください'
    ]);
    assert.deepStrictEqual(findInputMessages(buildRequest({ people: 0 }), CONFIG, CATALOG), ['人数は1〜300人で入力してください']);
});

test('findInputMessages：食数は人数×利用日数まで（ちょうどは可）、正しくない数はエラー', () => {
    assert.deepStrictEqual(findInputMessages(buildRequest({ meals: { bf: 61, lu: 60, di: NaN } }), CONFIG, CATALOG), [
        '朝食の食数は0〜60食（人数×利用日数まで）で入力してください', '夕食の食数は0〜60食（人数×利用日数まで）で入力してください'
    ]);
});

test('findInputMessages：日帰りで施設コマもないときと、日程の外のコマを止める', () => {
    assert.deepStrictEqual(findInputMessages(buildRequest({ nights: 0 }), CONFIG, CATALOG), ['宿泊（1泊以上）か、施設の利用コマを1つ以上選んでください']);
    assert.deepStrictEqual(findInputMessages(buildRequest({ nights: 0, slots: [slotOf('2026-11-02', 'gym', 'am')] }), CONFIG, CATALOG), []);
    assert.deepStrictEqual(findInputMessages(buildRequest({ slots: [slotOf('2026-11-05', 'gym', 'am')] }), CONFIG, CATALOG), ['11/5(木)の施設コマは選べません']);
    assert.deepStrictEqual(findInputMessages(buildRequest({ slots: [slotOf('2026-11-02', 'pool', 'am')] }), CONFIG, CATALOG), ['11/2(月)の施設コマは選べません']);
});

test('findScheduleMessages は今日・過去の日と、受付期間より先の日を止める（境界は可）', () => {
    const schedule = (startDate) => findScheduleMessages(buildRequest({ startDate }), CONFIG, '2026-10-17');
    assert.deepStrictEqual(schedule('2026-10-17'), ['利用開始日は2026年10月18日(日)以降を選んでください']);
    assert.deepStrictEqual(schedule('2026-10-01'), ['利用開始日は2026年10月18日(日)以降を選んでください']);
    assert.deepStrictEqual(schedule('2026-10-18'), []);
    assert.deepStrictEqual(schedule('2027-10-17'), []);
    assert.deepStrictEqual(schedule('2027-10-18'), ['利用開始日は2027年10月17日(日)までを選んでください']);
    assert.deepStrictEqual(schedule(''), []);
});

test('findReservationBlockers は入力の不備・受付期間・空き状況の理由をまとめて返す', () => {
    assert.deepStrictEqual(findReservationBlockers(buildRequest({ people: 15 }), CONTEXT), []);
    const blockers = findReservationBlockers(buildRequest({ groupName: '', startDate: '2026-10-17', people: 20 }), { ...CONTEXT, reservations: [] });
    assert.deepStrictEqual(blockers, ['団体名が未入力です', '利用開始日は2026年10月18日(日)以降を選んでください']);
    assert.strictEqual(findReservationBlockers(buildRequest({ people: 50 }), CONTEXT).length, 2, '2泊とも定員超過');
});
