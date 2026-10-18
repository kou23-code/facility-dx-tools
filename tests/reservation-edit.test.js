// Web予約システム：職員による既存予約の編集（?edit=予約番号）の動作確認テスト
// 実行方法：node --test tests/reservation-edit.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { RESERVATION_LOGIC_PATH } = require('./helpers');
const {
    RESERVATION_CONFIG: CONFIG, RESERVATION_CATALOG: CATALOG,
    STAFF_SCHEDULE_URL, resolveEditReservationId, findReservationById, excludeReservationById, buildFormValuesFromReservation,
    updateReservation, replaceReservation, buildRequest, createReservation, findReservationBlockers, findAvailabilityConflicts,
    parseStoredReservations, serializeReservations, createSampleReservations
} = require(RESERVATION_LOGIC_PATH);

const toPlain = (value) => JSON.parse(JSON.stringify(value));
const slotOf = (date, facilityKey, timeKey) => ({ date, facilityKey, timeKey });
// 区分×性別・品目・区分のすべてのキーを持つ、日ごとの数の表（overrides に書いていないキーは毎日0）
const fillTable = (keyedList, length, overrides) => Object.fromEntries(keyedList
    .map((entry) => [entry.key, overrides?.[entry.key] ?? Array.from({ length }, () => 0)]));

// 11/2 から2泊3日の高校の予約（宿泊は高校生男女、陸上グラウンド AM・第１研修室 9時）
const ORIGINAL_REQUEST = Object.freeze({
    groupName: 'サンプル高校 陸上部', representative: '佐藤 花子', phone: '000-0000-0000', email: 'sample@example.com',
    purpose: 'スポーツ合宿', startDate: '2026-11-02', nights: 2, priceType: 'hs', people: 40,
    stays: fillTable(CATALOG.stayGuestTypes, 2, { hs_m: [20, 19], hs_f: [20, 18] }),
    meals: fillTable(CATALOG.meals, 3, { bf: [0, 40, 37], di: [40, 37, 0], te: [10, 0, 0] }),
    dayGuests: fillTable(CATALOG.priceTypes, 3, { hs: [3, 0, 0] }),
    slots: [slotOf('2026-11-02', 'track', 'am'), slotOf('2026-11-03', 'kL1', 'h09')]
});
const ORIGINAL = Object.freeze(createReservation(ORIGINAL_REQUEST, [], '2026-10-17T14:05', CATALOG));
// 同じ日程のほかの団体（11/2 の夜に250人・5団体分を占める）
const OTHER = Object.freeze(createReservation({
    ...ORIGINAL_REQUEST, groupName: 'ほかの団体', stays: fillTable(CATALOG.stayGuestTypes, 2, { ad_m: [250, 0] }),
    meals: fillTable(CATALOG.meals, 3), dayGuests: fillTable(CATALOG.priceTypes, 3), slots: [slotOf('2026-11-02', 'gym', 'am')]
}, [ORIGINAL], '2026-10-17T15:00', CATALOG));
const TODAY = '2026-10-17';
const buildEditContext = (reservations, editingId) => ({
    reservations: excludeReservationById(reservations, editingId), config: CONFIG, catalog: CATALOG, today: TODAY, editingId
});

test('resolveEditReservationId は URL の ?edit= から予約番号を取り出し、なければ空にする', () => {
    assert.strictEqual(resolveEditReservationId('?edit=R20261017-001'), 'R20261017-001');
    assert.strictEqual(resolveEditReservationId('?mode=staff&edit=SAMPLE-002'), 'SAMPLE-002');
    assert.strictEqual(resolveEditReservationId(`?edit=${encodeURIComponent(' R20261017-001 ')}`), 'R20261017-001', '前後の空白は除く');
    ['', '?', '?edit=', '?mode=staff', undefined, null].forEach((search) => assert.strictEqual(resolveEditReservationId(search), '', String(search)));
});

test('findReservationById・excludeReservationById は予約番号で探す・除く（元の一覧は書き換えない）', () => {
    const reservations = Object.freeze([ORIGINAL, OTHER]);
    assert.strictEqual(findReservationById(reservations, ORIGINAL.id), ORIGINAL);
    assert.strictEqual(findReservationById(reservations, 'R20990101-001'), null);
    assert.strictEqual(findReservationById([], ''), null);
    assert.deepStrictEqual(excludeReservationById(reservations, ORIGINAL.id).map((entry) => entry.id), [OTHER.id]);
    assert.deepStrictEqual(excludeReservationById(reservations, '').map((entry) => entry.id), [ORIGINAL.id, OTHER.id], '新規（空）ならそのまま');
    assert.strictEqual(reservations.length, 2);
});

test('buildFormValuesFromReservation は保存した予約を、入力欄に入れる文字列（0は空欄）にする', () => {
    const formValues = buildFormValuesFromReservation(ORIGINAL, CATALOG);
    assert.deepStrictEqual([formValues.groupName, formValues.representative, formValues.phone, formValues.email, formValues.purpose],
        ['サンプル高校 陸上部', '佐藤 花子', '000-0000-0000', 'sample@example.com', 'スポーツ合宿']);
    assert.deepStrictEqual([formValues.startDate, formValues.nights, formValues.priceType], ['2026-11-02', '2', 'hs']);
    assert.deepStrictEqual(toPlain(formValues.stays), { es_m: ['', ''], es_f: ['', ''], hs_m: ['20', '19'], hs_f: ['20', '18'], ad_m: ['', ''], ad_f: ['', ''] });
    assert.deepStrictEqual([formValues.meals.bf, formValues.meals.di, formValues.meals.te, formValues.meals.lu], [['', '40', '37'], ['40', '37', ''], ['10', '', ''], ['', '', '']]);
    assert.deepStrictEqual(toPlain(formValues.dayGuests), { es: ['', '', ''], hs: ['3', '', ''], ad: ['', '', ''] });
});

test('buildFormValuesFromReservation の入力値から buildRequest で作り直すと、元の予約と同じ内容になる', () => {
    const request = buildRequest(buildFormValuesFromReservation(ORIGINAL, CATALOG), ORIGINAL.slots, CATALOG);
    assert.deepStrictEqual(toPlain(request), toPlain(ORIGINAL_REQUEST));
});

test('buildFormValuesFromReservation は日帰りの料金区分・日帰り参加人数のない古い予約・正しくない料金区分も扱える', () => {
    const { dayGuests, ...withoutDayGuests } = ORIGINAL;
    assert.deepStrictEqual(toPlain(buildFormValuesFromReservation(withoutDayGuests, CATALOG).dayGuests), { es: ['', '', ''], hs: ['', '', ''], ad: ['', '', ''] });
    const dayTrip = { ...ORIGINAL, nights: 0, priceType: 'es', stays: fillTable(CATALOG.stayGuestTypes, 0), meals: fillTable(CATALOG.meals, 1, { be_oni: [30] }) };
    const formValues = buildFormValuesFromReservation(dayTrip, CATALOG);
    assert.deepStrictEqual([formValues.nights, formValues.priceType, formValues.meals.be_oni], ['0', 'es', ['30']]);
    assert.deepStrictEqual(toPlain(formValues.stays.hs_m), [], '日帰りは泊まる夜がない');
    assert.strictEqual(buildFormValuesFromReservation({ ...ORIGINAL, priceType: 'zz' }, CATALOG).priceType, CATALOG.dayTripPriceType);
    assert.strictEqual(buildFormValuesFromReservation({ ...ORIGINAL, phone: undefined }, CATALOG).phone, '');
});

test('updateReservation は予約番号・申込日時を変えずに内容を置き換え、変更日時と概算料金を付け直す', () => {
    const request = { ...ORIGINAL_REQUEST, slots: [...ORIGINAL_REQUEST.slots, slotOf('2026-11-03', 'court', 'pm')] };
    const updated = updateReservation(ORIGINAL, request, '2026-10-20T10:30', CATALOG);
    assert.deepStrictEqual([updated.id, updated.createdAt, updated.updatedAt], [ORIGINAL.id, '2026-10-17T14:05', '2026-10-20T10:30']);
    assert.strictEqual(updated.estimatedTotal, ORIGINAL.estimatedTotal + 3520, '球技場 PM（宿泊利用・小中高 3,520円）の分だけ増える');
    assert.deepStrictEqual(toPlain(updated.slots), toPlain(request.slots));
    assert.strictEqual(ORIGINAL.updatedAt, undefined, '元の予約は書き換えない');
});

test('replaceReservation は同じ予約番号を置き換え、並び順を保ち、なければ最後に加える', () => {
    const reservations = Object.freeze([ORIGINAL, OTHER]);
    const updated = { ...ORIGINAL, groupName: 'サンプル高校 陸上部（変更）' };
    assert.deepStrictEqual(replaceReservation(reservations, updated).map((entry) => entry.groupName), ['サンプル高校 陸上部（変更）', 'ほかの団体']);
    assert.deepStrictEqual(replaceReservation([OTHER], updated).map((entry) => entry.id), [OTHER.id, ORIGINAL.id], '消されていたら加え直す');
    assert.strictEqual(reservations[0].groupName, 'サンプル高校 陸上部');
    const saved = parseStoredReservations(serializeReservations(replaceReservation(reservations, updateReservation(ORIGINAL, ORIGINAL_REQUEST, '2026-10-20T10:30', CATALOG))), CATALOG);
    assert.deepStrictEqual([saved.length, saved[0].updatedAt], [2, '2026-10-20T10:30'], '保存して読み込める');
});

test('編集中の自分の古い施設コマとは重複にせず、ほかの団体の施設コマとは重複にする', () => {
    const reservations = [ORIGINAL, OTHER];
    const sameSlots = { ...ORIGINAL_REQUEST };
    assert.deepStrictEqual(findAvailabilityConflicts(sameSlots, buildEditContext(reservations, ORIGINAL.id)), [], '自分の予約は除いて判定する');
    const withoutExclusion = findAvailabilityConflicts(sameSlots, buildEditContext(reservations, ''));
    assert.strictEqual(withoutExclusion.filter((message) => message.includes('すでに予約が入っています')).length, 2, '除かなければ自分の施設コマと重なる');
    assert.ok(withoutExclusion.some((message) => message.includes('宿泊人数の上限')), '除かなければ自分の人数も二重に数える（40＋250＋40人）');
    const withOtherSlot = { ...ORIGINAL_REQUEST, slots: [...ORIGINAL_REQUEST.slots, slotOf('2026-11-02', 'gym', 'am')] };
    assert.deepStrictEqual(findAvailabilityConflicts(withOtherSlot, buildEditContext(reservations, ORIGINAL.id)),
        ['11/2(月)の「大体育館 AM」はすでに予約が入っています。別の時間帯か日程を選んでください。']);
});

test('編集中の宿泊人数・団体数の上限は、自分の古い人数・団体を除いて判定する（ちょうど300人は可、301人は不可）', () => {
    const reservations = [ORIGINAL, OTHER];
    const staysOf = (count) => fillTable(CATALOG.stayGuestTypes, 2, { hs_m: [count, 0] });
    assert.deepStrictEqual(findAvailabilityConflicts({ ...ORIGINAL_REQUEST, stays: staysOf(50) }, buildEditContext(reservations, ORIGINAL.id)), [], '250＋50＝300人');
    assert.match(findAvailabilityConflicts({ ...ORIGINAL_REQUEST, stays: staysOf(51) }, buildEditContext(reservations, ORIGINAL.id))[0], /上限（全団体で300人）を超えます（ご希望 51人 ／ 残り 50人）/);
    const fiveGroups = [ORIGINAL, ...['A', 'B', 'C', 'D', 'E'].map((suffix) => ({ ...OTHER, id: `R20261017-10${suffix}`, stays: staysOf(5) }))];
    assert.deepStrictEqual(findAvailabilityConflicts({ ...ORIGINAL_REQUEST, slots: [] }, buildEditContext(fiveGroups, ORIGINAL.id)), [], '自分を除けば5団体なので6団体目として入れる');
    assert.match(findAvailabilityConflicts({ ...ORIGINAL_REQUEST, slots: [] }, buildEditContext(fiveGroups, ''))[0], /宿泊受け入れ団体数の上限（6団体）/);
});

test('findReservationBlockers は編集中（editingId あり）なら受付期間を確認せず、休館日・入力の不備は確認する', () => {
    const request = { ...ORIGINAL_REQUEST, startDate: '2026-10-17', stays: ORIGINAL_REQUEST.stays, slots: [slotOf('2026-10-17', 'track', 'am')] };
    assert.ok(findReservationBlockers(request, buildEditContext([ORIGINAL], '')).some((message) => message.startsWith('利用開始日は')), '新規は今日を選べない');
    assert.deepStrictEqual(findReservationBlockers(request, buildEditContext([ORIGINAL], ORIGINAL.id)), [], '編集は当日・過去の予約も直せる');
    const closed = { ...ORIGINAL_REQUEST, startDate: '2026-12-28', slots: [] };
    assert.ok(findReservationBlockers(closed, buildEditContext([ORIGINAL], ORIGINAL.id)).some((message) => message.includes('休館日')));
    assert.ok(findReservationBlockers({ ...ORIGINAL_REQUEST, groupName: '' }, buildEditContext([ORIGINAL], ORIGINAL.id)).includes('団体名が未入力です'));
});

test('サンプル予約は、編集の入力値に戻して作り直しても同じ内容になり、自分を除けば確定できる', () => {
    const samples = createSampleReservations('2026-10-17', CATALOG);
    samples.forEach((sample) => {
        const request = buildRequest(buildFormValuesFromReservation(sample, CATALOG), sample.slots, CATALOG);
        const { id, createdAt, estimatedTotal, ...sampleRequest } = sample;
        assert.deepStrictEqual(toPlain(request), toPlain(sampleRequest), id);
        assert.deepStrictEqual(findReservationBlockers(request, buildEditContext(samples, id)), [], id);
    });
});

test('編集を保存したあとに戻るのは、スケジュール管理表の職員用モード', () => {
    assert.strictEqual(STAFF_SCHEDULE_URL, '../schedule/index.html?mode=staff');
});
