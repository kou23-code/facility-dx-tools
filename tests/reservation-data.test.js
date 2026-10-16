// Web予約システム：予約データの保存・職員取込用1行コード・メール・サンプル予約の動作確認テスト
// 実行方法：node --test tests/reservation-data.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT_DIR, RESERVATION_LOGIC_PATH } = require('./helpers');
const {
    RESERVATION_STORAGE_KEY, RESERVATION_CODE_TYPE, RESERVATION_CODE_VERSION, RESERVATION_CONFIG: CONFIG, RESERVATION_CATALOG: CATALOG,
    findReservationBlockers, buildAvailabilityRows,
    isValidReservation, parseStoredReservations, serializeReservations, appendReservation, isSampleReservation, mergeSampleReservations,
    createReservationId, createReservation, buildReservationCode, parseReservationCode, importReservationCode,
    buildReservationSummary, buildMailSubject, buildMailBody, buildStaffMailUrl, escapeHtml, createSampleReservations
} = require(RESERVATION_LOGIC_PATH);

const toPlain = (value) => JSON.parse(JSON.stringify(value));

const REQUEST = Object.freeze({
    groupName: 'サンプル高校 陸上部', representative: '山田 太郎', phone: '000-0000-0000', email: 'sample@example.com',
    purpose: 'スポーツ合宿', startDate: '2026-11-02', nights: 1, priceType: 'hs', people: 20, stays: [20],
    meals: Object.fromEntries(CATALOG.meals.map((meal) => [meal.key, ({ bf: [0, 20], di: [20, 0], te: [20, 0] })[meal.key] ?? [0, 0]])),
    slots: [{ date: '2026-11-02', facilityKey: 'gym', timeKey: 'pm' }, { date: '2026-11-03', facilityKey: 'gym', timeKey: 'am' }]
});
const RESERVATION = createReservation(REQUEST, [], '2026-10-17T14:05', CATALOG);

test('予約データの localStorage のキーは facility_dx_reservations', () => {
    assert.strictEqual(RESERVATION_STORAGE_KEY, 'facility_dx_reservations');
});

test('createReservationId は申込日ごとの通し番号を作り、使われている一番大きい番号の次にする', () => {
    assert.strictEqual(createReservationId('2026-10-17T14:05', []), 'R20261017-001');
    const reservations = [{ id: 'R20261017-001' }, { id: 'R20261017-007' }, { id: 'R20261016-020' }, { id: 'SAMPLE-001' }];
    assert.strictEqual(createReservationId('2026-10-17T09:00', reservations), 'R20261017-008');
    assert.strictEqual(createReservationId('2026-10-18T09:00', reservations), 'R20261018-001');
});

test('createReservation は申込の内容に予約番号・申込日時・概算料金を付け、申込を書き換えない', () => {
    assert.deepStrictEqual(toPlain(RESERVATION), {
        id: 'R20261017-001', createdAt: '2026-10-17T14:05', ...toPlain(REQUEST), estimatedTotal: 50000 + 13200 + 19800 + 3000 + 10740
    });
    assert.strictEqual(Object.prototype.hasOwnProperty.call(REQUEST, 'id'), false);
});

test('isValidReservation は空き状況の計算に使う項目がそろった予約だけを認める', () => {
    assert.strictEqual(isValidReservation(RESERVATION), true);
    [null, 'text', [], {}, { ...RESERVATION, id: '' }, { ...RESERVATION, startDate: '2026-02-30' }, { ...RESERVATION, nights: -1 },
        { ...RESERVATION, people: 1.5 }, { ...RESERVATION, slots: 'gym' }, { ...RESERVATION, slots: [{ date: 'x', facilityKey: 'gym', timeKey: 'am' }] },
        { ...RESERVATION, groupName: undefined }, { ...RESERVATION, stays: undefined }, { ...RESERVATION, stays: [20, 20] },
        { ...RESERVATION, stays: [-1] }, { ...RESERVATION, meals: { bf: [1] } }, { ...RESERVATION, meals: { bf: 20 } }, { ...RESERVATION, meals: [] }
    ].forEach((value, index) => assert.strictEqual(isValidReservation(value), false, `${index}番目`));
});

test('parseStoredReservations は保存データがない・壊れているときは空にし、形の違う予約を除く', () => {
    [null, '', '{', 'null', '{"id":"R1"}', '123'].forEach((raw) => assert.deepStrictEqual(parseStoredReservations(raw), [], String(raw)));
    const raw = serializeReservations([RESERVATION, { id: 'broken' }]);
    assert.deepStrictEqual(toPlain(parseStoredReservations(raw)), [toPlain(RESERVATION)]);
});

test('appendReservation・mergeSampleReservations は新しい配列を返し、元の配列を書き換えない', () => {
    const reservations = Object.freeze([RESERVATION]);
    assert.deepStrictEqual(appendReservation(reservations, { id: 'R2' }).map((reservation) => reservation.id), ['R20261017-001', 'R2']);
    const withSamples = mergeSampleReservations(reservations, [{ id: 'SAMPLE-001' }, { id: 'SAMPLE-002' }]);
    const merged = mergeSampleReservations(withSamples, [{ id: 'SAMPLE-001' }]);
    assert.deepStrictEqual(merged.map((reservation) => reservation.id), ['R20261017-001', 'SAMPLE-001'], '前のサンプルは入れ直す');
    assert.deepStrictEqual([isSampleReservation({ id: 'SAMPLE-003' }), isSampleReservation(RESERVATION)], [true, false]);
});

test('buildReservationCode は改行を含まない1行の JSON を作り、parseReservationCode で元に戻せる', () => {
    const reservation = { ...RESERVATION, groupName: '改行\nを含む"団体"' };
    const code = buildReservationCode(reservation);
    assert.strictEqual(code.includes('\n'), false);
    assert.deepStrictEqual(JSON.parse(code).type, RESERVATION_CODE_TYPE);
    assert.deepStrictEqual(JSON.parse(code).version, RESERVATION_CODE_VERSION);
    assert.deepStrictEqual(toPlain(parseReservationCode(`  ${code}\n`)), { ok: true, reservation: toPlain(reservation) });
});

test('parseReservationCode は別のデータ・違う版・壊れた予約を読み取らない', () => {
    const wrap = (overrides) => JSON.stringify({ type: RESERVATION_CODE_TYPE, version: RESERVATION_CODE_VERSION, reservation: RESERVATION, ...overrides });
    assert.deepStrictEqual(parseReservationCode(''), { ok: false, error: '予約の取込用コードではありません' });
    assert.deepStrictEqual(parseReservationCode('not json'), { ok: false, error: '予約の取込用コードではありません' });
    assert.deepStrictEqual(parseReservationCode(undefined), { ok: false, error: '予約の取込用コードではありません' });
    assert.deepStrictEqual(parseReservationCode(wrap({ type: 'other' })), { ok: false, error: '予約の取込用コードではありません' });
    assert.deepStrictEqual(parseReservationCode(wrap({ version: 1 })), { ok: false, error: '対応していない版のコードです（version 1）' }, '宿泊人数・食事が日ごとでない古い版');
    assert.deepStrictEqual(parseReservationCode(wrap({ reservation: { id: 'R1' } })), { ok: false, error: '予約の内容が正しくありません' });
});

test('importReservationCode は予約を一覧に加え、同じ予約番号は二重に取り込まない', () => {
    const code = buildReservationCode(RESERVATION);
    const imported = importReservationCode([], code);
    assert.strictEqual(imported.ok, true);
    assert.deepStrictEqual(toPlain(imported.reservations), [toPlain(RESERVATION)]);
    assert.deepStrictEqual(importReservationCode(imported.reservations, code), { ok: false, error: '予約番号 R20261017-001 はすでに取り込まれています' });
    assert.strictEqual(importReservationCode([], 'x').ok, false);
});

test('buildReservationSummary は控えとメールに載せる見出しと内容を作る', () => {
    assert.deepStrictEqual(buildReservationSummary(RESERVATION, CATALOG), [
        ['予約番号', 'R20261017-001'], ['申込日時', '2026-10-17 14:05'], ['団体名', 'サンプル高校 陸上部'], ['代表者名', '山田 太郎'],
        ['電話番号', '000-0000-0000'], ['メールアドレス', 'sample@example.com'], ['利用目的', 'スポーツ合宿'],
        ['日程', '2026年11月2日(月)〜11月3日(火) 1泊2日'], ['利用人数', '20人（高校生）'], ['宿泊人数', '11/2(月) 20人'],
        ['施設コマ', '11/2(月) 大体育館 PM ／ 11/3(火) 大体育館 AM'],
        ['食事など', '朝食 20食（11/3(火) 20） ／ 夕食 20食（11/2(月) 20） ／ お茶 20本（11/2(月) 20）']
    ]);
    const summaryOf = (overrides) => Object.fromEntries(buildReservationSummary({ ...RESERVATION, ...overrides }, CATALOG));
    assert.strictEqual(summaryOf({ slots: [] })['施設コマ'], 'なし');
    assert.strictEqual(summaryOf({ stays: [0] })['宿泊人数'], 'なし');
    assert.strictEqual(summaryOf({ nights: 0, stays: [] })['宿泊人数'], 'なし（日帰り）');
    assert.strictEqual(summaryOf({ meals: {} })['食事など'], 'なし');
});

test('職員宛てメールの件名・本文・mailto の URL', () => {
    assert.strictEqual(buildMailSubject(RESERVATION), '【Web予約申込】サンプル高校 陸上部 11/2(月)〜（予約番号 R20261017-001）');
    const body = buildMailBody(RESERVATION, CATALOG);
    assert.ok(body.includes('団体名：サンプル高校 陸上部'));
    assert.ok(body.includes('概算料金：96,740円（税込）'));
    assert.strictEqual(body.split('\n').at(-1), buildReservationCode(RESERVATION), '最後の行が1行コード');
    const url = buildStaffMailUrl(CONFIG.staffEmail, 'a&b', '1行目\n2行目');
    assert.strictEqual(url, 'mailto:reservation@example.com?subject=a%26b&body=1%E8%A1%8C%E7%9B%AE%0A2%E8%A1%8C%E7%9B%AE');
});

test('escapeHtml は HTML の特別な文字を変換する', () => {
    assert.strictEqual(escapeHtml(`<b>"A&B's"</b>`), '&lt;b&gt;&quot;A&amp;B&#39;s&quot;&lt;/b&gt;');
    assert.strictEqual(escapeHtml(12), '12');
});

test('createSampleReservations は今日を基準に、毎回同じ・正しい形のサンプル予約を作る', () => {
    const samples = createSampleReservations('2026-10-17', CATALOG);
    assert.deepStrictEqual(toPlain(samples), toPlain(createSampleReservations('2026-10-17', CATALOG)));
    assert.deepStrictEqual(samples.map((sample) => sample.id), ['SAMPLE-001', 'SAMPLE-002', 'SAMPLE-003', 'SAMPLE-004']);
    assert.deepStrictEqual(samples.map((sample) => sample.startDate), ['2026-10-20', '2026-10-20', '2026-10-22', '2026-10-27']);
    assert.ok(samples.every(isValidReservation));
    assert.ok(samples.every((sample) => sample.estimatedTotal > 0));
});

test('サンプル予約どうしは重ならず、それぞれ単独なら受付ルールを満たす', () => {
    const samples = createSampleReservations('2026-10-17', CATALOG);
    samples.forEach((sample, index) => {
        const others = samples.filter((_, otherIndex) => otherIndex !== index);
        const context = { reservations: others, config: CONFIG, catalog: CATALOG, today: '2026-10-17' };
        assert.deepStrictEqual(findReservationBlockers(sample, context), [], sample.id);
    });
});

test('サンプル予約を入れると、既定の日程（3日後から2泊）で◎・△・×がすべて確認できる', () => {
    const samples = createSampleReservations('2026-10-17', CATALOG);
    const rows = buildAvailabilityRows(samples, '2026-10-20', 2, { config: CONFIG, catalog: CATALOG });
    assert.deepStrictEqual(rows.map((row) => row.stay?.symbol ?? null), ['△', '◎', null]);
    assert.deepStrictEqual(rows.map((row) => row.facilities.find((status) => status.facilityKey === 'gym').symbol), ['◎', '×', '◎']);
    assert.deepStrictEqual(rows.map((row) => row.facilities.find((status) => status.facilityKey === 'field').symbol), ['△', '△', '◎']);
    assert.strictEqual(buildAvailabilityRows(samples, '2026-10-27', 1, { config: CONFIG, catalog: CATALOG })[0].stay.symbol, '×');
});

test('予約ロジックに会社名・住所・電話番号らしい表記が FACILITY_INFO の外に書かれていない', () => {
    const source = fs.readFileSync(RESERVATION_LOGIC_PATH, 'utf8').replace(/\/\/ FACILITY_INFO:start[\s\S]*?\/\/ FACILITY_INFO:end/, '');
    [/〒/, /TEL\s*\d/, /\d{2,4}-\d{2,4}-\d{3,4}/, /株式会社|協会|財団/, /[都道府県][^\s<'"`]*[市区町村]/].forEach((pattern) => {
        assert.doesNotMatch(source, pattern, `${pattern} に当てはまる表記があります`);
    });
    assert.ok(fs.readFileSync(path.join(ROOT_DIR, '.gitignore'), 'utf8').split(/\r?\n/).includes('facility-config.js'));
});

test('buildIssuerLines は予約申込控えの発行元欄の3行を作り、resolveFacilityInfo で施設名を上書きできる', () => {
    const { FACILITY_INFO, resolveFacilityInfo, buildIssuerLines } = require(RESERVATION_LOGIC_PATH);
    assert.deepStrictEqual(buildIssuerLines(FACILITY_INFO), [
        '株式会社サンプルリゾート あおぞらセミナーハウス', '〒100-0001 東京都千代田区千代田1-1-1', 'TEL 03-0000-0000'
    ]);
    const custom = resolveFacilityInfo(FACILITY_INFO, { facilityName: 'みどり研修センター', tel: 1 });
    assert.strictEqual(buildIssuerLines(custom)[0], '株式会社サンプルリゾート みどり研修センター');
    assert.strictEqual(buildIssuerLines(custom)[2], 'TEL 03-0000-0000', '文字列以外は無視する');
});

test('mergeHourRanges は続いている時間を1つにまとめる', () => {
    const { mergeHourRanges } = require(RESERVATION_LOGIC_PATH);
    assert.deepStrictEqual(toPlain(mergeHourRanges([13, 9, 10])), [[9, 11], [13, 14]]);
    assert.deepStrictEqual(toPlain(mergeHourRanges([9, 10, 11, 12])), [[9, 13]]);
    assert.deepStrictEqual(toPlain(mergeHourRanges([20])), [[20, 21]]);
    assert.deepStrictEqual(toPlain(mergeHourRanges([])), []);
});

test('formatSlotList は日付ごと・施設ごとにまとめ、研修室の続いた時間は「9:00~11:00」の形にする', () => {
    const { formatSlotList } = require(RESERVATION_LOGIC_PATH);
    const slots = [
        { date: '2026-11-02', facilityKey: 'gym', timeKey: 'am' }, { date: '2026-11-02', facilityKey: 'gym', timeKey: 'pm' },
        { date: '2026-11-02', facilityKey: 'kL', timeKey: 'h09' }, { date: '2026-11-02', facilityKey: 'kL', timeKey: 'h10' },
        { date: '2026-11-02', facilityKey: 'kL', timeKey: 'h13' }, { date: '2026-11-03', facilityKey: 'mr', timeKey: 'h20' }
    ];
    assert.strictEqual(formatSlotList(slots, CATALOG),
        '11/2(月) 大体育館 AM・PM、大研修室(1･3研) 9:00~11:00・13:00~14:00 ／ 11/3(火) ミーティングルーム 20:00~21:00');
    assert.strictEqual(formatSlotList([{ date: '2026-11-02', facilityKey: 'pool', timeKey: 'x' }], CATALOG), '11/2(月) pool x', '知らないキーはそのまま');
    assert.strictEqual(formatSlotList([], CATALOG), '');
});

test('サンプル予約の研修室・ミーティングルームは1時間単位で、既定の日程で△になる', () => {
    const samples = createSampleReservations('2026-10-17', CATALOG);
    const rows = buildAvailabilityRows(samples, '2026-10-20', 2, { config: CONFIG, catalog: CATALOG });
    const symbolOf = (row, key) => row.facilities.find((status) => status.facilityKey === key).symbol;
    assert.deepStrictEqual([symbolOf(rows[0], 'kL'), symbolOf(rows[2], 'mr'), symbolOf(rows[0], 'kS')], ['△', '△', '◎']);
    assert.deepStrictEqual(samples[1].slots.filter((slot) => slot.facilityKey === 'kL').map((slot) => slot.timeKey), ['h17', 'h18', 'h19', 'h20']);
});
