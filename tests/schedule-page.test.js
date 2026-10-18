// スケジュール管理表（schedule/index.html）の画面の動作確認テスト
// 実行方法：node --test tests/schedule-page.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    SCHEDULE_HTML_PATH, SCHEDULE_LOGIC_PATH, RESERVATION_LOGIC_PATH, BROWSER_CANDIDATES, findBrowser, renderDom, findById
} = require('./helpers');
const { RESERVATION_CATALOG: CATALOG, createSampleReservations } = require(RESERVATION_LOGIC_PATH);

const BROWSER = findBrowser(BROWSER_CANDIDATES);
const readPage = () => fs.readFileSync(SCHEDULE_HTML_PATH, 'utf8');
const readInlineScript = (html) => /<script>([\s\S]*?)<\/script>/.exec(html)[1];
// サンプル予約の団体名・代表者名・電話番号・メールアドレス（公開用モードの画面に出てはいけない）
const SAMPLE_PRIVATE_VALUES = createSampleReservations('2026-10-18', CATALOG)
    .flatMap((sample) => [sample.groupName, sample.representative, sample.phone, sample.email]);

// 画面の状態を書き出す関数（ページの中で動かす）
const CAPTURE_SOURCE = `const capture = () => ({
    mode: document.getElementById('app').dataset.mode,
    search: location.search,
    pressed: Array.from(document.querySelectorAll('[data-mode-button]'), (button) => button.dataset.modeButton + ':' + button.getAttribute('aria-pressed')),
    staffPanelHidden: document.getElementById('staffPanel').classList.contains('hidden'),
    emptyHidden: document.getElementById('emptyNotice').classList.contains('hidden'),
    monthLabel: document.getElementById('monthLabel').textContent,
    selectedDate: document.getElementById('app').dataset.selectedDate,
    cells: Object.fromEntries(Array.from(document.querySelectorAll('#calendar td[data-date]'), (cell) => [cell.dataset.date, {
        stay: (cell.querySelector('[data-stay-symbol]') || { dataset: {} }).dataset.staySymbol || null,
        facilities: Array.from(cell.querySelectorAll('[data-facility]'), (entry) => entry.textContent).join(' '),
        text: cell.textContent, isSelected: cell.classList.contains('is-selected')
    }])),
    detailHeading: document.getElementById('detailHeading').textContent,
    detailStay: document.getElementById('detailStay').dataset.staySymbol,
    detailStayCount: (document.getElementById('detailStayCount') || {}).textContent || null,
    units: Object.fromEntries(Array.from(document.querySelectorAll('#dayDetail td[data-facility]'), (cell) => [cell.dataset.facility + ':' + cell.dataset.time, { text: cell.textContent, colspan: cell.colSpan }])),
    unitCount: document.querySelectorAll('#dayDetail tbody td[data-facility]').length,
    stayBreakdown: Array.from(document.querySelectorAll('#stayBreakdownTable tbody tr'), (row) => row.textContent),
    mealTotals: Array.from(document.querySelectorAll('#mealTotalsTable tbody td'), (cell) => cell.textContent),
    groupRows: Array.from(document.querySelectorAll('#groupTable tbody tr'), (row) => row.dataset.reservationId),
    publicText: ['modeNotice', 'calendar', 'dayDetail', 'calendarLegend'].map((id) => document.getElementById(id).textContent).join(' '),
    legend: document.getElementById('calendarLegend').textContent,
    timetableHeadings: Array.from(document.querySelectorAll('#dayDetail .timetable-heading'), (element) => element.textContent),
    timetableRows: Array.from(document.querySelectorAll('#dayDetail tbody th'), (cell) => cell.textContent),
    importResult: document.getElementById('importResult').textContent,
    publicLoadResult: document.getElementById('publicLoadResult').textContent,
    storageStatus: document.getElementById('storageStatus').textContent,
    publicSourceLabel: (document.getElementById('publicSourceLabel') || {}).textContent || null,
    publicJson: document.getElementById('publicJsonOutput').value,
    storage: localStorage.getItem('facility_dx_reservations'),
    title: document.title
});
// その日のある月を開いて、日付を選ぶ
const openDate = (date) => { writeViewState({ month: date.slice(0, 7) }); selectDate(date); };`;

// 起動後に操作し、操作ごとの画面の状態をページに書き出すスクリプト
const buildScript = (steps) => `<script>
window.addEventListener('load', () => {
    window.confirm = () => true;
    ${CAPTURE_SOURCE}
    const today = getToday();
    const day3 = addDaysToDateString(today, 3);
    const day5 = addDaysToDateString(today, 5);
    const day10 = addDaysToDateString(today, 10);
    const day20 = addDaysToDateString(today, 20);
    const states = [];
    const dates = { today, day3, day5, day10, day20 };
    ${steps}
    const dump = document.createElement('div');
    dump.id = 'test_dump';
    dump.textContent = encodeURIComponent(JSON.stringify({ dates, states }));
    document.body.appendChild(dump);
});
</script>`;

// 一時フォルダに、本番と同じフォルダ構成（schedule/・reservation/）でコピーして開く
const renderStates = (steps, search = '') => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-test-'));
    ['schedule', 'reservation'].forEach((folder) => fs.mkdirSync(path.join(dir, folder)));
    fs.writeFileSync(path.join(dir, 'schedule', 'index.html'), readPage().replace('</body>', `${buildScript(steps)}\n</body>`), 'utf8');
    fs.copyFileSync(SCHEDULE_LOGIC_PATH, path.join(dir, 'schedule', 'schedule-logic.js'));
    fs.copyFileSync(RESERVATION_LOGIC_PATH, path.join(dir, 'reservation', 'reservation-logic.js'));
    return JSON.parse(decodeURIComponent(findById(renderDom(BROWSER, path.join(dir, 'schedule', 'index.html'), search), 'test_dump')));
};

// ---------- ファイルの中身 ----------
test('スケジュール画面は facility-config.js・reservation-logic.js・schedule-logic.js の順に読み込み、let・var を使っていない', () => {
    const html = readPage();
    const order = ['<script src="../facility-config.js">', '<script src="../reservation/reservation-logic.js">', '<script src="schedule-logic.js">'].map((tag) => html.indexOf(tag));
    assert.ok(order.every((index) => index >= 0), String(order));
    assert.deepStrictEqual([...order].sort((first, second) => first - second), order);
    assert.doesNotMatch(readInlineScript(html), /\b(let|var)\s/);
    assert.doesNotMatch(fs.readFileSync(SCHEDULE_LOGIC_PATH, 'utf8'), /\b(let|var)\s/);
});

test('スケジュール画面にポータルへ戻るリンクと Web予約画面へのリンクがある', () => {
    const html = readPage();
    assert.match(html, /<a href="\.\.\/"[^>]*>← ツール一覧へ戻る<\/a>/);
    assert.match(html, /<a id="newReservationLink" href="\.\.\/reservation\/"/);
});

test('スケジュール画面・ロジックに会社名・住所・電話番号らしい表記が書かれていない', () => {
    const text = `${readPage()}\n${fs.readFileSync(SCHEDULE_LOGIC_PATH, 'utf8')}`;
    [/〒/, /TEL\s*\d/, /\d{2,4}-\d{2,4}-\d{3,4}/, /株式会社|協会|財団/, /[都道府県][^\s<'"`]*[市区町村]/].forEach((pattern) => {
        assert.doesNotMatch(text, pattern, `${pattern} に当てはまる表記があります`);
    });
});

// ---------- 画面の動作 ----------
test('画面：公開用モードで始まり、サンプル投入で◎/△/×が出て、団体名などの個人情報は表示しない', { skip: !BROWSER }, () => {
    const { dates, states } = renderStates(`
        states.push(capture());
        insertSampleReservations();
        openDate(day3);
        states.push(capture());
        openDate(day10);
        states.push(capture());
        moveMonth(1);
        states.push(capture());
        moveMonth(-2);
        states.push(capture());
    `);
    const [initial, afterSample, tenDays, nextMonth, prevMonth] = states;
    assert.strictEqual(initial.mode, 'public');
    assert.deepStrictEqual(initial.pressed, ['public:true', 'staff:false']);
    assert.strictEqual(initial.staffPanelHidden, true);
    assert.strictEqual(initial.emptyHidden, false);
    assert.strictEqual(initial.selectedDate, dates.today);
    assert.strictEqual(initial.title, 'あおぞらセミナーハウス スケジュール管理表');
    assert.strictEqual(afterSample.emptyHidden, true);
    // 3日後の夜は4団体・225人で△、施設は陸上グラウンド（AM・PM予約）と大研修室の第１研修室（17〜21時）が△。
    // 球技場と第３研修室は別の施設なので◎のまま
    assert.strictEqual(afterSample.cells[dates.day3].stay, '△');
    assert.strictEqual(afterSample.cells[dates.day3].facilities, '大体◎ 小体◎ 陸上△ 球技◎ 大研1△ 大研3◎ 小研2◎ MR◎');
    assert.strictEqual(afterSample.cells[dates.day3].isSelected, true);
    assert.strictEqual(afterSample.detailStay, '△');
    assert.deepStrictEqual([afterSample.units['track:am'].text, afterSample.units['track:ev'].text, afterSample.units['kL1:h17'].text, afterSample.units['kL1:h09'].text], ['×', '○', '×', '○']);
    assert.deepStrictEqual([afterSample.units['court:am'].text, afterSample.units['kL3:h17'].text], ['○', '○'], '分割した施設は別々に表示する');
    assert.strictEqual(afterSample.unitCount, 3 * 4 + 12 * 4, '区分の4施設×3区分と、1時間の4施設×12コマ');
    assert.deepStrictEqual(afterSample.timetableHeadings, ['区分単位（午前・午後・夜間の3区分）：大体育館・小体育館・陸上グラウンド・球技場',
        '1時間単位（9-10時〜20-21時）：大研修室（第１研修室）・大研修室（第３研修室）・小研修室（第２研修室）・ミーティングルーム']);
    assert.deepStrictEqual(afterSample.timetableRows, ['大体育館', '小体育館', '陸上グラウンド', '球技場',
        '大研修室（第１研修室）', '大研修室（第３研修室）', '小研修室（第２研修室）', 'ミーティングルーム']);
    assert.ok(afterSample.legend.includes('施設（大体：大体育館、小体：小体育館、陸上：陸上グラウンド、球技：球技場、大研1：大研修室（第１研修室）、'
        + '大研3：大研修室（第３研修室）、小研2：小研修室（第２研修室）、MR：ミーティングルーム）'), afterSample.legend);
    assert.strictEqual(afterSample.legend.includes('陸上/球技場'), false, '分割前の施設名は出さない');
    assert.strictEqual(afterSample.detailStayCount, null);
    assert.deepStrictEqual(afterSample.groupRows, []);
    // 10日後の夜は6団体で×（人数に余裕があっても団体数の上限）
    assert.strictEqual(tenDays.cells[dates.day10].stay, '×');
    assert.strictEqual(tenDays.detailStay, '×');
    [afterSample, tenDays].forEach((state) => SAMPLE_PRIVATE_VALUES.forEach((value) => assert.strictEqual(state.publicText.includes(value), false, value)));
    assert.notStrictEqual(nextMonth.monthLabel, tenDays.monthLabel);
    assert.notStrictEqual(prevMonth.monthLabel, nextMonth.monthLabel);
});

test('画面：職員用モードに切り替えると、人数/団体数・団体名バッジ・団体の詳細・宿泊内訳・食事の合計が出る', { skip: !BROWSER }, () => {
    const { dates, states } = renderStates(`
        insertSampleReservations();
        switchMode('staff');
        openDate(day3);
        states.push(capture());
        switchMode('public');
        states.push(capture());
    `);
    const [staff, backToPublic] = states;
    assert.strictEqual(staff.mode, 'staff');
    assert.strictEqual(staff.search, '?mode=staff');
    assert.deepStrictEqual(staff.pressed, ['public:false', 'staff:true']);
    assert.strictEqual(staff.staffPanelHidden, false);
    assert.match(staff.cells[dates.day3].text, /225人\/4団体/);
    assert.match(staff.cells[dates.day3].text, /サンプル高校 陸上部/);
    assert.match(staff.detailStayCount, /^225人 \/ 4団体$/);
    // 施設コマ表：予約済みのコマに「団体名（代表者名・TEL）」。同じ団体の続いた時間は1つのマスにまとめる
    assert.match(staff.units['track:am'].text, /サンプル高校 陸上部（佐藤 花子・TEL 0000000001）/);
    assert.deepStrictEqual([staff.units['kL1:h17'].colspan, staff.units['kL1:h18']], [4, undefined]);
    assert.match(staff.units['kL1:h17'].text, /みどりスポーツクラブ（鈴木 一郎・TEL 0000000002）/);
    assert.strictEqual(staff.units['kL1:h09'].text, '○');
    // 宿泊人数の内訳（小中・高校・大学一般 × 男女）と食事の合計（朝食・昼食・夕食・弁当・お茶・おにぎり）
    assert.deepStrictEqual(staff.stayBreakdown, ['小学生・中学生30人30人60人', '高校生20人20人40人', '大学生・一般105人20人125人']);
    assert.deepStrictEqual(staff.mealTotals, ['0食', '40食', '85食', '0食', '45本', '0食']);
    assert.deepStrictEqual(staff.groupRows, ['SAMPLE-001', 'SAMPLE-002', 'SAMPLE-005', 'SAMPLE-006']);
    assert.match(staff.storageStatus, /11件（うちサンプル 11件）/);
    assert.strictEqual(backToPublic.search, '');
    assert.strictEqual(backToPublic.staffPanelHidden, true);
    assert.deepStrictEqual(backToPublic.groupRows, []);
});

test('画面：URL に ?mode=staff を付けて開くと、最初から職員用モードになる', { skip: !BROWSER }, () => {
    const { states } = renderStates('states.push(capture());', '?mode=staff');
    assert.strictEqual(states[0].mode, 'staff');
    assert.deepStrictEqual(states[0].pressed, ['public:false', 'staff:true']);
    assert.strictEqual(states[0].staffPanelHidden, false);
});

test('画面：1行コードの取込（エラー時は理由を表示）・追加・削除ができる', { skip: !BROWSER }, () => {
    const { dates, states } = renderStates(`
        insertSampleReservations();
        switchMode('staff');
        const base = { ...createSampleReservations(today, CATALOG)[0], id: 'R-TEST-001', groupName: 'テスト取込団体' };
        document.getElementById('importCodeInput').value = 'abc';
        importCodeFromForm();
        states.push(capture());
        document.getElementById('importCodeInput').value = buildReservationCode(base);
        importCodeFromForm();
        states.push(capture());
        document.getElementById('importCodeInput').value = buildReservationCode({ ...base, slots: [] });
        importCodeFromForm();
        states.push(capture());
        deleteReservationById('R-TEST-001');
        states.push(capture());
        document.getElementById('importCodeInput').value = Schedule.buildDeleteCode('SAMPLE-002');
        importCodeFromForm();
        states.push(capture());
    `);
    const [invalid, conflict, added, deleted, deletedByCode] = states;
    assert.match(invalid.importResult, /取り込めませんでした.*予約の取込用コードではありません/);
    assert.match(conflict.importResult, /すでに別の団体の予約が入っています/);
    assert.strictEqual(JSON.parse(conflict.storage).length, 11);
    assert.match(added.importResult, /予約番号 R-TEST-001 を追加しました/);
    assert.strictEqual(JSON.parse(added.storage).length, 12);
    assert.strictEqual(added.selectedDate, dates.day3);
    assert.ok(added.groupRows.includes('R-TEST-001'));
    assert.match(added.detailStayCount, /^265人 \/ 5団体$/);
    assert.strictEqual(JSON.parse(deleted.storage).length, 11);
    assert.strictEqual(deleted.groupRows.includes('R-TEST-001'), false);
    assert.match(deletedByCode.importResult, /予約番号 SAMPLE-002 を削除しました/);
    assert.strictEqual(JSON.parse(deletedByCode.storage).some((reservation) => reservation.id === 'SAMPLE-002'), false);
});

test('画面：公開用データを出力すると個人情報がなく、読み込むと公開用モードでそのデータを表示し、解除できる', { skip: !BROWSER }, () => {
    const { dates, states } = renderStates(`
        insertSampleReservations();
        switchMode('staff');
        exportPublicSchedule();
        states.push(capture());
        const publicJson = JSON.stringify({ type: 'facility_dx_public_schedule', version: 1, generatedAt: '2026-01-02T03:04',
            days: [{ date: day20, stayGuests: 300, stayGroups: 1, bookedSlots: [{ facilityKey: 'mr', timeKey: 'h09' }] }] });
        document.getElementById('publicJsonInput').value = '{"type":"x"}';
        loadPublicScheduleFromForm();
        states.push(capture());
        document.getElementById('publicJsonInput').value = publicJson;
        loadPublicScheduleFromForm();
        openDate(day20);
        states.push(capture());
        openDate(day3);
        states.push(capture());
        clearImportedPublicSchedule();
        states.push(capture());
    `);
    const [exported, invalid, loaded, loadedOtherDay, cleared] = states;
    const exportedData = JSON.parse(exported.publicJson);
    assert.strictEqual(exportedData.type, 'facility_dx_public_schedule');
    assert.ok(exportedData.days.some((day) => day.date === dates.day3 && day.stayGuests === 225 && day.stayGroups === 4));
    SAMPLE_PRIVATE_VALUES.forEach((value) => assert.strictEqual(exported.publicJson.includes(value), false, value));
    assert.match(invalid.publicLoadResult, /読み込めませんでした.*公開用スケジュールデータではありません/);
    assert.strictEqual(invalid.mode, 'staff');
    assert.strictEqual(loaded.mode, 'public');
    assert.match(loaded.publicSourceLabel, /読み込んだ公開用データ（2026-01-02 03:04 作成）/);
    assert.strictEqual(loaded.detailStay, '×');
    assert.strictEqual(loaded.units['mr:h09'].text, '×');
    assert.strictEqual(loaded.units['mr:h10'].text, '○');
    // 読み込んだデータにない日は、このブラウザの予約があっても空きとして表示する
    assert.strictEqual(loadedOtherDay.detailStay, '◎');
    assert.strictEqual(loadedOtherDay.units['track:am'].text, '○');
    assert.match(cleared.publicSourceLabel, /このブラウザの予約データから作成/);
    assert.strictEqual(cleared.detailStay, '△');
});

test('画面：予約データをリセットすると、サンプル投入の案内が出る', { skip: !BROWSER }, () => {
    const { states } = renderStates(`
        insertSampleReservations();
        states.push(capture());
        resetReservations();
        states.push(capture());
    `);
    assert.deepStrictEqual(states.map((state) => state.emptyHidden), [true, false]);
    assert.strictEqual(states[1].storage, null);
});
