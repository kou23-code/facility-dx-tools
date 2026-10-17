// Web予約システム：空き状況・重複・定員超過・予約不可の判定の動作確認テスト
// 実行方法：node --test tests/reservation-availability.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { RESERVATION_LOGIC_PATH } = require('./helpers');
const {
    RESERVATION_CONFIG: CONFIG, RESERVATION_CATALOG: CATALOG,
    isClosedDate, getStayCountOnDate, countStayGuests, countStayGroups, findGroupLimitOverflows, judgeStayAvailability, isSlotBooked, judgeFacilityAvailability, buildAvailabilityRows,
    findSlotConflicts, findDuplicateSlots, findCapacityOverflows, formatSlotName, findAvailabilityConflicts,
    isPhoneNumber, findInputMessages, findScheduleMessages, findReservationBlockers
} = require(RESERVATION_LOGIC_PATH);

const toPlain = (value) => JSON.parse(JSON.stringify(value));
const slotOf = (date, facilityKey, timeKey) => ({ date, facilityKey, timeKey });
// 夜ごとの宿泊人数（区分×性別のうち「大学生・一般 男性」にまとめて入れる）
const staysOf = (counts) => ({ ad_m: counts });

const buildReservation = (id, overrides) => ({
    id, createdAt: '2026-10-01T09:00', groupName: '既存の団体', representative: '鈴木 一郎', phone: '0000000000',
    email: 'booked@example.com', purpose: 'スポーツ合宿', startDate: '2026-11-02', nights: 1, priceType: 'ad', people: 0,
    stays: staysOf([0]), meals: {}, slots: [], ...overrides
});
// 申込（11/2 から2泊3日、宿泊は毎晩20人。食事は書いた品目だけ。日帰りにしたときの料金区分は大学生・一般）
const buildRequest = (overrides) => ({
    groupName: 'サンプル高校 陸上部', representative: '山田 太郎', phone: '000-0000-0000', email: 'sample@example.com',
    purpose: 'スポーツ合宿', startDate: '2026-11-02', nights: 2, priceType: 'ad',
    stays: staysOf([20, 20]), meals: {}, slots: [], ...overrides
});

// 11/2〜11/3 に60人、11/3 に25人（11/3 の夜は85人）。11/3 の大体育館は全区分、11/2 の小体育館は AM だけ予約済み
const RESERVATIONS = [
    buildReservation('R1', { nights: 2, people: 60, stays: staysOf([60, 60]), slots: [slotOf('2026-11-02', 'gym_s', 'am')] }),
    buildReservation('R2', { startDate: '2026-11-03', people: 25, stays: staysOf([25]),
        slots: [slotOf('2026-11-03', 'gym', 'am'), slotOf('2026-11-03', 'gym', 'pm'), slotOf('2026-11-03', 'gym', 'ev')] })
];
// 境界を確かめやすいよう、宿泊人数の上限を100人にした設定（団体数の上限は既定の6団体）
const SMALL_CONFIG = { ...CONFIG, stayCapacity: 100 };
const CONTEXT = { reservations: RESERVATIONS, config: SMALL_CONFIG, catalog: CATALOG, today: '2026-10-17' };

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

test('judgeStayAvailability：人数の残りが上限の30%以上は◎、30%未満は△、0以下は×', () => {
    assert.deepStrictEqual([0, 70, 71, 99, 100, 120].map((booked) => judgeStayAvailability(booked, 0, SMALL_CONFIG)), ['◎', '◎', '△', '△', '×', '×']);
    assert.deepStrictEqual([0, 210, 211, 299, 300].map((booked) => judgeStayAvailability(booked, 1, CONFIG)), ['◎', '◎', '△', '△', '×'], '既定の上限は300人');
});

test('judgeStayAvailability：団体数が上限（6団体）なら人数に余裕があっても×、残り1団体なら△', () => {
    assert.deepStrictEqual([0, 4, 5, 6, 7].map((groups) => judgeStayAvailability(10, groups, CONFIG)), ['◎', '◎', '△', '×', '×']);
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
        { booked: 60, remaining: 40, groups: 1, remainingGroups: 5, symbol: '◎' }, { booked: 85, remaining: 15, groups: 2, remainingGroups: 4, symbol: '△' }, null
    ]);
    const symbolsOf = (row) => Object.fromEntries(row.facilities.map((status) => [status.facilityKey, status.symbol]));
    assert.deepStrictEqual(symbolsOf(rows[0]), { gym: '◎', gym_s: '△', field: '◎', kL: '◎', kS: '◎', mr: '◎' });
    assert.deepStrictEqual(symbolsOf(rows[1]), { gym: '×', gym_s: '◎', field: '◎', kL: '◎', kS: '◎', mr: '◎' });
    assert.deepStrictEqual(toPlain(rows[0].facilities[1].bookedTimeKeys), ['am']);
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

test('buildAvailabilityRows：研修室・ミーティングルームは12コマのうち一部が予約済みなら△、すべてなら×', () => {
    const hourSlots = (facilityKey, hours) => hours.map((hour) => slotOf('2026-11-02', facilityKey, `h${String(hour).padStart(2, '0')}`));
    const reservations = [buildReservation('H1', { slots: [...hourSlots('kL', [9, 10]), ...hourSlots('mr', [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])] })];
    const statusOf = (key) => buildAvailabilityRows(reservations, '2026-11-02', 0, CONTEXT)[0].facilities.find((status) => status.facilityKey === key);
    assert.deepStrictEqual(toPlain(statusOf('kL')), { facilityKey: 'kL', bookedTimeKeys: ['h09', 'h10'], symbol: '△' });
    assert.strictEqual(statusOf('mr').symbol, '×');
    assert.strictEqual(statusOf('kS').symbol, '◎');
});

test('研修室の1時間のコマは、同じ部屋・同じ時間だけが重複になる', () => {
    const reservations = [buildReservation('H2', { slots: [slotOf('2026-11-02', 'kL', 'h13')] })];
    const request = buildRequest({ slots: [slotOf('2026-11-02', 'kL', 'h13'), slotOf('2026-11-02', 'kL', 'h14'), slotOf('2026-11-02', 'kS', 'h13')] });
    assert.deepStrictEqual(findAvailabilityConflicts(request, { ...CONTEXT, reservations }),
        ['11/2(月)の「大研修室(1･3研) 13:00~14:00」はすでに予約が入っています。別の時間帯か日程を選んでください。']);
});

test('findSlotConflicts・findDuplicateSlots は予約済みのコマと、申込の中の重なりを見つける', () => {
    const slots = [slotOf('2026-11-03', 'gym', 'pm'), slotOf('2026-11-03', 'gym_s', 'pm'), slotOf('2026-11-03', 'gym_s', 'pm')];
    assert.deepStrictEqual(toPlain(findSlotConflicts(RESERVATIONS, slots)), [slotOf('2026-11-03', 'gym', 'pm')]);
    assert.deepStrictEqual(toPlain(findDuplicateSlots(slots)), [slotOf('2026-11-03', 'gym_s', 'pm')]);
    assert.deepStrictEqual(findSlotConflicts(RESERVATIONS, []), []);
    assert.deepStrictEqual(findDuplicateSlots([]), []);
});

test('findCapacityOverflows は定員ちょうどまで許し、超える夜だけを返す', () => {
    assert.deepStrictEqual(findCapacityOverflows(RESERVATIONS, buildRequest({ stays: staysOf([40, 15]) }), 100), []);
    assert.deepStrictEqual(toPlain(findCapacityOverflows(RESERVATIONS, buildRequest({ stays: staysOf([40, 16]) }), 100)), [
        { date: '2026-11-03', booked: 85, requested: 16, remaining: 15 }
    ]);
    assert.strictEqual(findCapacityOverflows(RESERVATIONS, buildRequest({ stays: staysOf([41, 41]) }), 100).length, 2);
    assert.deepStrictEqual(findCapacityOverflows(RESERVATIONS, buildRequest({ nights: 0, stays: staysOf([]) }), 100), [], '日帰りは定員の対象外');
});

test('findCapacityOverflows は宿泊人数を夜ごとに見て、泊まらない夜（0人）は満室でも超えない', () => {
    const full = [buildReservation('F1', { nights: 2, people: 100, stays: staysOf([100, 0]) })];
    assert.deepStrictEqual(findCapacityOverflows(full, buildRequest({ stays: staysOf([0, 30]) }), 100), []);
    assert.deepStrictEqual(toPlain(findCapacityOverflows(full, buildRequest({ stays: staysOf([1, 30]) }), 100)),
        [{ date: '2026-11-02', booked: 100, requested: 1, remaining: 0 }]);
});

test('getStayCountOnDate は予約のその夜の宿泊人数を返し、泊まる夜でなければ0にする', () => {
    const reservation = buildReservation('S1', { nights: 2, stays: staysOf([30, 12]) });
    assert.deepStrictEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'].map((date) => getStayCountOnDate(reservation, date)), [0, 30, 12, 0]);
    assert.strictEqual(countStayGuests([reservation, buildReservation('S2', { stays: staysOf([5]) })], '2026-11-02'), 35);
});

test('formatSlotName は施設名と時間帯名を出し、知らないキーはそのまま出す', () => {
    assert.strictEqual(formatSlotName(slotOf('2026-11-02', 'gym', 'ev'), CATALOG), '大体育館 夜');
    assert.strictEqual(formatSlotName(slotOf('2026-11-02', 'kL', 'h09'), CATALOG), '大研修室(1･3研) 9:00~10:00');
    assert.strictEqual(formatSlotName(slotOf('2026-11-02', 'kL', 'ev'), CATALOG), '大研修室(1･3研) ev', '研修室に区分のキーは使えない');
    assert.strictEqual(formatSlotName(slotOf('2026-11-02', 'pool', 'xx'), CATALOG), 'pool xx');
});

test('findAvailabilityConflicts は定員超過・施設コマの重複・休館日を文言にする', () => {
    const request = buildRequest({ slots: [slotOf('2026-11-03', 'gym', 'ev'), slotOf('2026-11-03', 'gym_s', 'ev')] });
    assert.deepStrictEqual(findAvailabilityConflicts(request, CONTEXT), [
        '11/3(火)の夜は、1日あたりの宿泊人数の上限（全団体で100人）を超えます（ご希望 20人 ／ 残り 15人）。人数か日程を変更してください。',
        '11/3(火)の「大体育館 夜」はすでに予約が入っています。別の時間帯か日程を選んでください。'
    ]);
    assert.deepStrictEqual(findAvailabilityConflicts(buildRequest({ startDate: '2026-12-28', nights: 1, stays: staysOf([1]) }), CONTEXT),
        ['12/29(火)は休館日のため予約できません。日程を変更してください。']);
    assert.deepStrictEqual(findAvailabilityConflicts(buildRequest({ stays: staysOf([20, 15]) }), CONTEXT), []);
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
    const meals = { bf: [0, 20, 20], lu: [20, 20, 20], di: [20, 20, 0], be_maku: [0, 0, 999], te: [999, 0, 0] };
    assert.deepStrictEqual(findInputMessages(buildRequest({ meals }), CONFIG, CATALOG), []);
});

test('findInputMessages：必須の項目が空・空白だけなら未入力にする', () => {
    const request = buildRequest({ groupName: '', representative: '  ', phone: '', email: '', purpose: '' });
    assert.deepStrictEqual(findInputMessages(request, CONFIG, CATALOG),
        ['団体名が未入力です', '代表者名が未入力です', '電話番号が未入力です', 'メールアドレスが未入力です', '利用目的が未入力です']);
});

test('findInputMessages：電話番号・メール・利用目的・日付・泊数の形をチェックする（利用人数・料金区分の入力欄はない）', () => {
    const request = buildRequest({ phone: '123', email: 'a@b', purpose: '旅行', startDate: '2026-02-30', nights: 7 });
    assert.deepStrictEqual(findInputMessages(request, CONFIG, CATALOG), [
        '電話番号は数字とハイフンで10〜11桁を入力してください', 'メールアドレスの形が正しくありません', '利用目的を一覧から選んでください',
        '利用開始日を選んでください', '利用日数は1〜7日から選んでください'
    ]);
    assert.deepStrictEqual(findInputMessages(buildRequest({ stays: staysOf([0, 0]), slots: [slotOf('2026-11-02', 'gym', 'am')] }), CONFIG, CATALOG), [],
        '宿泊0人（利用人数0人）でも、施設コマがあれば申し込める');
    assert.deepStrictEqual(findInputMessages(buildRequest({ people: 999, priceType: 'zz' }), CONFIG, CATALOG), [],
        '古い形の people・priceType は判定に使わない');
});

test('findInputMessages：宿泊人数の夜ごとの合計（区分・男女の合計）は1件の予約の上限人数（300人）まで（ちょうどは可）', () => {
    assert.deepStrictEqual(findInputMessages(buildRequest({ stays: { hs_m: [150, 0], hs_f: [100, 0], ad_m: [50, 0] } }), CONFIG, CATALOG), []);
    assert.deepStrictEqual(findInputMessages(buildRequest({ stays: { hs_m: [150, 20], hs_f: [151, 0] } }), CONFIG, CATALOG),
        ['11/2(月)の宿泊人数の合計（301人）が1件の予約の上限（300人）を超えています']);
    assert.deepStrictEqual(findInputMessages(buildRequest({ stays: staysOf([21, 0]) }), { ...CONFIG, maxPeople: 20 }, CATALOG),
        ['11/2(月)の宿泊人数の合計（21人）が1件の予約の上限（20人）を超えています'], '上限は設定の maxPeople に従う');
});

test('findInputMessages：宿泊人数の欄が正しくない数（小数・マイナス・文字）なら、区分と男女を示してエラー', () => {
    assert.deepStrictEqual(findInputMessages(buildRequest({ stays: { es_f: [NaN, 0], ad_m: [5, -1] } }), CONFIG, CATALOG), [
        '11/2(月)の宿泊人数（小学生・中学生 女性）は0以上の整数で入力してください', '11/3(火)の宿泊人数（大学生・一般 男性）は0以上の整数で入力してください'
    ]);
});

test('findInputMessages：食堂の食事は日ごとに1件の予約の上限人数まで、弁当・お茶などは999まで（ちょうどは可）', () => {
    const meals = { bf: [301, 300, 0], di: [0, NaN, 0], te: [0, 0, 1000], be_oni: [999, 0, 0] };
    assert.deepStrictEqual(findInputMessages(buildRequest({ meals }), CONFIG, CATALOG), [
        '11/2(月)の朝食は0〜300食（1件の予約の上限人数まで）で入力してください', '11/3(火)の夕食は0〜300食（1件の予約の上限人数まで）で入力してください',
        '11/4(水)のお茶は0〜999本で入力してください'
    ]);
    assert.deepStrictEqual(findInputMessages(buildRequest({ nights: 0, stays: staysOf([]), meals: { lu: [30] } }), CONFIG, CATALOG), [],
        '宿泊者がいない日帰りでも、食堂の食事を申し込める');
});

test('findInputMessages：日帰り参加人数は区分ごとに日ごとに0〜300人、その日の合計も300人まで（ちょうどは可）', () => {
    assert.deepStrictEqual(findInputMessages(buildRequest({ dayGuests: { es: [100, 0, 0], hs: [100, 0, 300], ad: [100, 0, 0] } }), CONFIG, CATALOG), []);
    assert.deepStrictEqual(findInputMessages(buildRequest({ dayGuests: { es: [NaN, 0, 0], hs: [0, 301, 0], ad: [0, 0, -1] } }), CONFIG, CATALOG), [
        '11/2(月)の日帰り参加人数（小学生・中学生）は0〜300人で入力してください', '11/3(火)の日帰り参加人数（高校生）は0〜300人で入力してください',
        '11/4(水)の日帰り参加人数（大学生・一般）は0〜300人で入力してください', '11/3(火)の日帰り参加人数の合計（301人）が1件の予約の上限（300人）を超えています'
    ]);
    assert.deepStrictEqual(findInputMessages(buildRequest({ dayGuests: { es: [200, 0, 0], ad: [101, 0, 0] } }), CONFIG, CATALOG),
        ['11/2(月)の日帰り参加人数の合計（301人）が1件の予約の上限（300人）を超えています']);
});

test('findInputMessages：宿泊人数が0人なのに日帰り参加人数があれば止める（合流する宿泊団体がいない）', () => {
    const message = '宿泊人数が0人なのに日帰り参加人数が入っています。日帰り参加人数は宿泊する団体に日帰りで合流する人の人数です。宿泊人数を入れるか、日帰り参加人数を消してください。';
    const slots = [slotOf('2026-11-02', 'gym', 'am')];
    assert.deepStrictEqual(findInputMessages(buildRequest({ stays: staysOf([0, 0]), dayGuests: { hs: [0, 0, 5] }, slots }), CONFIG, CATALOG), [message]);
    assert.deepStrictEqual(findInputMessages(buildRequest({ nights: 0, stays: staysOf([]), dayGuests: { ad: [3] }, slots }), CONFIG, CATALOG), [message], '日帰り');
    assert.deepStrictEqual(findInputMessages(buildRequest({ stays: staysOf([0, 1]), dayGuests: { hs: [5, 0, 0] }, slots }), CONFIG, CATALOG), [], '1泊でも宿泊があればよい');
    assert.deepStrictEqual(findInputMessages(buildRequest({ stays: staysOf([0, 0]), dayGuests: { hs: [0, 0, 0] }, slots }), CONFIG, CATALOG), []);
});

test('findInputMessages：日帰り（1日）のときだけ、選んだ料金区分が一覧にあるかを確かめる', () => {
    const slots = [slotOf('2026-11-02', 'gym', 'am')];
    const dayTrip = (priceType) => findInputMessages(buildRequest({ nights: 0, stays: staysOf([]), priceType, slots }), CONFIG, CATALOG);
    assert.deepStrictEqual(['es', 'hs', 'ad'].map(dayTrip), [[], [], []]);
    ['', 'zz', undefined].forEach((priceType) => assert.deepStrictEqual(dayTrip(priceType), ['日帰りの料金区分を選んでください'], String(priceType)));
    assert.deepStrictEqual(findInputMessages(buildRequest({ priceType: '', slots }), CONFIG, CATALOG), [], '2日以上は宿泊人数から決めるので確かめない');
});

test('findInputMessages：宿泊・施設コマ・食事がどれもないときと、日程の外のコマを止める', () => {
    const empty = '宿泊人数・施設コマ・食事のどれかを入力してください';
    assert.deepStrictEqual(findInputMessages(buildRequest({ nights: 0, stays: staysOf([]) }), CONFIG, CATALOG), [empty]);
    assert.deepStrictEqual(findInputMessages(buildRequest({ stays: staysOf([0, 0]) }), CONFIG, CATALOG), [empty], '2泊3日でも宿泊0人で何もなければ止める');
    assert.deepStrictEqual(findInputMessages(buildRequest({ nights: 0, stays: staysOf([]), meals: { be_maku: [10] } }), CONFIG, CATALOG), [], '弁当だけでも申し込める');
    assert.deepStrictEqual(findInputMessages(buildRequest({ nights: 0, stays: staysOf([]), slots: [slotOf('2026-11-02', 'gym', 'am')] }), CONFIG, CATALOG), []);
    assert.deepStrictEqual(findInputMessages(buildRequest({ slots: [slotOf('2026-11-05', 'gym', 'am')] }), CONFIG, CATALOG), ['11/5(木)の施設コマは選べません']);
    assert.deepStrictEqual(findInputMessages(buildRequest({ slots: [slotOf('2026-11-02', 'pool', 'am')] }), CONFIG, CATALOG), ['11/2(月)の施設コマは選べません']);
    assert.deepStrictEqual(findInputMessages(buildRequest({ slots: [slotOf('2026-11-02', 'kL', 'am')] }), CONFIG, CATALOG), ['11/2(月)の施設コマは選べません'], '研修室は区分では選べない');
    assert.deepStrictEqual(findInputMessages(buildRequest({ slots: [slotOf('2026-11-02', 'gym', 'h09')] }), CONFIG, CATALOG), ['11/2(月)の施設コマは選べません'], '体育館は1時間では選べない');
    assert.deepStrictEqual(findInputMessages(buildRequest({ slots: [slotOf('2026-11-02', 'kL', 'h08'), slotOf('2026-11-02', 'kL', 'h21')] }), CONFIG, CATALOG),
        ['11/2(月)の施設コマは選べません', '11/2(月)の施設コマは選べません'], '9時より前・21時以降は選べない');
    assert.deepStrictEqual(findInputMessages(buildRequest({ slots: [slotOf('2026-11-02', 'kL', 'h20')] }), CONFIG, CATALOG), []);
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
    assert.deepStrictEqual(findReservationBlockers(buildRequest({ stays: staysOf([15, 15]) }), CONTEXT), []);
    const blockers = findReservationBlockers(buildRequest({ groupName: '', startDate: '2026-10-17' }), { ...CONTEXT, reservations: [] });
    assert.deepStrictEqual(blockers, ['団体名が未入力です', '利用開始日は2026年10月18日(日)以降を選んでください']);
    assert.strictEqual(findReservationBlockers(buildRequest({ stays: staysOf([50, 50]) }), CONTEXT).length, 2, '2泊とも定員超過');
});

test('countStayGroups はその夜に1人以上泊まる予約（団体）の数を数える', () => {
    const reservations = [buildReservation('G1', { stays: staysOf([10]) }), buildReservation('G2', { stays: staysOf([0]) }),
        buildReservation('G3', { nights: 2, stays: { hs_f: [0, 3], es_m: [2, 0] } })];
    assert.deepStrictEqual(['2026-11-01', '2026-11-02', '2026-11-03'].map((date) => countStayGroups(reservations, date)), [0, 2, 1]);
});

// 11/2 の夜に、宿泊する団体を count 団体（1団体10人）入れた予約の一覧
const buildGroups = (count) => Array.from({ length: count }, (_, index) => buildReservation(`G${index}`, { stays: staysOf([10]) }));

test('findGroupLimitOverflows：5団体までなら6団体目を受け入れ、6団体に達した夜は7団体目を受け入れない', () => {
    assert.deepStrictEqual(findGroupLimitOverflows(buildGroups(5), buildRequest({ stays: staysOf([1, 1]) }), 6), []);
    assert.deepStrictEqual(toPlain(findGroupLimitOverflows(buildGroups(6), buildRequest({ stays: staysOf([1, 1]) }), 6)), [{ date: '2026-11-02', groups: 6 }]);
    assert.deepStrictEqual(findGroupLimitOverflows(buildGroups(6), buildRequest({ stays: staysOf([0, 1]) }), 6), [], 'その夜に泊まらなければ対象外');
    assert.deepStrictEqual(findGroupLimitOverflows(buildGroups(6), buildRequest({ nights: 0, stays: staysOf([]) }), 6), [], '日帰りは対象外');
});

test('findAvailabilityConflicts：既定の上限（全団体で300人・6団体）を超える夜はエラーにする（ちょうどは可）', () => {
    const context = { reservations: [buildReservation('B1', { stays: staysOf([280]) })], config: CONFIG, catalog: CATALOG };
    assert.deepStrictEqual(findAvailabilityConflicts(buildRequest({ stays: staysOf([20, 20]) }), context), [], '280＋20＝300人はちょうど');
    assert.deepStrictEqual(findAvailabilityConflicts(buildRequest({ stays: staysOf([21, 21]) }), context),
        ['11/2(月)の夜は、1日あたりの宿泊人数の上限（全団体で300人）を超えます（ご希望 21人 ／ 残り 20人）。人数か日程を変更してください。']);
    const groupContext = { ...context, reservations: buildGroups(6) };
    assert.deepStrictEqual(findAvailabilityConflicts(buildRequest({ stays: staysOf([1, 1]) }), groupContext),
        ['11/2(月)の夜は、1日あたりの宿泊受け入れ団体数の上限（6団体）に達しています（予約済み 6団体）。日程を変更してください。']);
    assert.strictEqual(findReservationBlockers(buildRequest({ stays: staysOf([1, 1]) }), { ...groupContext, today: '2026-10-17' }).length, 1, '確定できない');
});

test('buildAvailabilityRows：宿泊の空きに予約済みの団体数と残りの団体数を出す', () => {
    const [row] = buildAvailabilityRows(buildGroups(6), '2026-11-02', 1, { config: CONFIG, catalog: CATALOG });
    assert.deepStrictEqual(toPlain(row.stay), { booked: 60, remaining: 240, groups: 6, remainingGroups: 0, symbol: '×' });
});
