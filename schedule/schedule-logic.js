// ======================================================
//  スケジュール管理表の集計・判定（純粋関数だけを置くファイル）
//  画面（schedule/index.html）とテスト（tests/）の両方から読み込む
//  ※DOM や localStorage には触らない。必要な値（予約の一覧・施設の一覧など）はすべて引数で受け取る
//  ※catalog には reservation/reservation-logic.js の RESERVATION_CATALOG（施設・コマ・食事・区分の一覧）を渡す
//  ※予約システムと同じページで読み込んでも名前がぶつからないよう、全体をブロック { } で囲む
// ======================================================
{
    // ---------- 共通の設定 ----------
    const DAY_MS = 24 * 60 * 60 * 1000;
    const SCHEDULE_CODE_TYPE = 'facility_dx_reservation'; // 職員取込用コードの種類（予約システムの1行コードと同じ）
    const SCHEDULE_CODE_VERSION = 3;                      // 職員取込用コードの版（予約システムの1行コードと同じ）

    const PUBLIC_SCHEDULE_TYPE = 'facility_dx_public_schedule'; // 公開用データ（JSON）の種類
    const PUBLIC_SCHEDULE_VERSION = 1;                          // 公開用データ（JSON）の版

    // 取り込むときの1日（1泊）あたりの上限（全団体の合計宿泊人数・宿泊団体数）
    const STAY_LIMITS = Object.freeze({ stayCapacity: 300, maxStayGroups: 6 });

    // 宿泊の空き状況のしきい値（人数か団体数のどちらかが達したら、その記号）
    const STAY_THRESHOLDS = Object.freeze({
        full: Object.freeze({ guests: 300, groups: 6 }), // ×：満室
        few: Object.freeze({ guests: 200, groups: 4 })   // △：残りわずか
    });

    // 日別集計の食事の項目（mealKeys：品目のキー ／ group：catalog.meals の group が同じ品目をすべて数える）
    const MEAL_SUMMARY_ITEMS = Object.freeze([
        { key: 'breakfast', name: '朝食', mealKeys: ['bf'] },
        { key: 'lunch', name: '昼食', mealKeys: ['lu'] },
        { key: 'dinner', name: '夕食', mealKeys: ['di'] },
        { key: 'bento', name: '弁当', group: '弁当' },
        { key: 'tea', name: 'お茶', mealKeys: ['te'] },
        { key: 'onigiri', name: 'おにぎり', mealKeys: ['on'] }
    ].map(Object.freeze));

    // ---------- 日付（"YYYY-MM-DD" の文字列のまま扱い、タイムゾーンでずれないよう UTC で計算する） ----------
    // 日付の文字列を UTC の時刻（ミリ秒）にする。存在しない日付（2月30日など）や形の違う値は null
    const parseDateString = (dateString) => {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof dateString === 'string' ? dateString : '');
        if (!match) return null;
        const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        return new Date(time).toISOString().slice(0, 10) === dateString ? time : null;
    };
    const isValidDateString = (dateString) => parseDateString(dateString) !== null;
    const addDaysToDateString = (dateString, days) => new Date(parseDateString(dateString) + days * DAY_MS).toISOString().slice(0, 10);
    const countDaysBetween = (fromDate, toDate) => Math.round((parseDateString(toDate) - parseDateString(fromDate)) / DAY_MS);

    // ---------- 予約1件の、その日の数 ----------
    const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
    const toSafeCount = (value) => (isNonNegativeInteger(value) ? value : 0);
    // 予約の何泊目の夜か（0始まり。泊まる夜でなければ -1。チェックアウト日の夜は含まない）
    const findNightIndex = (reservation, date) => {
        const index = countDaysBetween(reservation.startDate, date);
        return index >= 0 && index < reservation.nights ? index : -1;
    };
    // 予約の何日目か（0始まり。利用日でなければ -1。チェックアウト日も利用日）
    const findDayIndex = (reservation, date) => {
        const index = countDaysBetween(reservation.startDate, date);
        return index >= 0 && index <= reservation.nights ? index : -1;
    };
    // キーごとの日ごとの数の表から、1つのキーの1日分の数を取り出す（index が -1 なら0）
    const pickCount = (countTable, key, index) => (index < 0 ? 0 : toSafeCount(countTable?.[key]?.[index]));
    const sumCountTableAt = (countTable, index) => Object.keys(countTable ?? {})
        .reduce((total, key) => total + pickCount(countTable, key, index), 0);
    // 予約1件の、その夜の宿泊人数（すべての区分・性別の合計）
    const countStayOnDate = (reservation, date) => sumCountTableAt(reservation.stays, findNightIndex(reservation, date));

    // ---------- 日別集計 ----------
    // その夜に泊まる人数の合計
    const countStayGuests = (reservationList, date) => reservationList
        .reduce((total, reservation) => total + countStayOnDate(reservation, date), 0);
    // その夜に宿泊する団体の数（宿泊人数が1人以上の予約の数）
    const countStayGroups = (reservationList, date) => reservationList
        .filter((reservation) => countStayOnDate(reservation, date) > 0).length;
    // その夜の、1つの区分×性別（"hs_m" など）の宿泊人数の合計
    const sumStayGuestType = (reservationList, date, guestTypeKey) => reservationList
        .reduce((total, reservation) => total + pickCount(reservation.stays, guestTypeKey, findNightIndex(reservation, date)), 0);
    // その夜の年代（料金区分）×男女別の内訳（{ es_m: 0, es_f: 0, hs_m: 20, ... }）
    const buildStayBreakdown = (reservationList, date, catalog) => Object.fromEntries(catalog.stayGuestTypes
        .map((guestType) => [guestType.key, sumStayGuestType(reservationList, date, guestType.key)]));
    // 食事の集計項目にふくまれる品目のキー
    const resolveMealKeys = (summaryItem, catalog) => summaryItem.mealKeys
        ?? catalog.meals.filter((meal) => meal.group === summaryItem.group).map((meal) => meal.key);
    // その日の、いくつかの品目の数の合計（すべての予約）
    const sumMealsOnDate = (reservationList, date, mealKeys) => reservationList.reduce((total, reservation) => total
        + mealKeys.reduce((subtotal, mealKey) => subtotal + pickCount(reservation.meals, mealKey, findDayIndex(reservation, date)), 0), 0);
    // その日の食事の項目別の合計（{ breakfast, lunch, dinner, bento, tea, onigiri }）
    const buildMealTotals = (reservationList, date, catalog) => Object.fromEntries(MEAL_SUMMARY_ITEMS
        .map((summaryItem) => [summaryItem.key, sumMealsOnDate(reservationList, date, resolveMealKeys(summaryItem, catalog))]));
    // 指定日の集計（宿泊合計人数・宿泊団体数・年代男女別の内訳・食事の項目別合計）
    const summarizeDailyReservations = (reservationList, date, catalog) => ({
        date,
        stayGuests: countStayGuests(reservationList, date),
        stayGroups: countStayGroups(reservationList, date),
        stayBreakdown: buildStayBreakdown(reservationList, date, catalog),
        meals: buildMealTotals(reservationList, date, catalog)
    });

    // ---------- 宿泊の空き状況（◎：空きあり ／ △：残りわずか ／ ×：満室） ----------
    const reachesThreshold = (stayGuests, stayGroups, threshold) => stayGuests >= threshold.guests || stayGroups >= threshold.groups;
    // 300人以上か6団体以上で×、200人以上か4団体以上で△、それ未満は◎（thresholds：STAY_THRESHOLDS）
    const judgeStaySymbol = (stayGuests, stayGroups, thresholds) => {
        if (reachesThreshold(stayGuests, stayGroups, thresholds.full)) return '×';
        return reachesThreshold(stayGuests, stayGroups, thresholds.few) ? '△' : '◎';
    };

    // ---------- 施設の空き状況（○：空き ／ ×：予約済み）と、職員用の予約団体の詳細 ----------
    // 施設で使えるコマの一覧（区分の施設は AM・PM・夜の3区分、1時間の施設は 9-10時〜20-21時の12コマ）
    const listTimeUnits = (facility, catalog) => (facility?.billing === 'hour' ? catalog.hourSlots : catalog.periods);
    const isSameSlot = (slot, otherSlot) => slot.date === otherSlot.date
        && slot.facilityKey === otherSlot.facilityKey && slot.timeKey === otherSlot.timeKey;
    const hasSlot = (reservation, slot) => reservation.slots.some((bookedSlot) => isSameSlot(bookedSlot, slot));
    // 職員用の予約団体の詳細（スケジュール管理表の職員画面だけで使い、公開用データには入れない）
    const toStaffBooking = (reservation) => ({
        id: reservation.id, groupName: reservation.groupName, representative: reservation.representative,
        phone: reservation.phone, email: reservation.email
    });
    // 1コマの空き状況（bookings：そのコマを予約している団体。ふつうは0件か1件）
    const buildUnitStatus = (reservationList, slot, timeUnit) => {
        const bookings = reservationList.filter((reservation) => hasSlot(reservation, slot)).map(toStaffBooking);
        return { timeKey: timeUnit.key, label: timeUnit.label, symbol: bookings.length > 0 ? '×' : '○', bookings };
    };
    // 1つの施設の、その日のコマごとの空き状況
    const buildFacilitySchedule = (reservationList, date, facility, catalog) => ({
        facilityKey: facility.key, name: facility.name,
        units: listTimeUnits(facility, catalog).map((timeUnit) => buildUnitStatus(reservationList,
            { date, facilityKey: facility.key, timeKey: timeUnit.key }, timeUnit))
    });
    // 指定日の、すべての施設（catalog.facilities の順）のコマごとの空き状況
    const mapFacilitySchedule = (reservationList, date, catalog) => catalog.facilities
        .map((facility) => buildFacilitySchedule(reservationList, date, facility, catalog));

    // ---------- 職員取込用の1行コード（予約システムのメールに載る JSON。削除は action: 'delete' と予約番号 id） ----------
    // 取込のときの文言用の "2026-11-03 大体育館 AM"
    const formatSlotLabel = (slot, catalog) => {
        const facility = catalog.facilities.find((entry) => entry.key === slot.facilityKey);
        const timeUnit = listTimeUnits(facility, catalog).find((entry) => entry.key === slot.timeKey);
        return `${slot.date} ${facility.name} ${timeUnit.label}`;
    };
    const isCountList = (value, length) => Array.isArray(value) && value.length === length && value.every(isNonNegativeInteger);
    // キーごとに決まった日数分の数の配列を持つオブジェクトか（宿泊人数・食事）
    const isCountTable = (countTable, length) => typeof countTable === 'object' && countTable !== null && !Array.isArray(countTable)
        && Object.values(countTable).every((counts) => isCountList(counts, length));
    // 知っている施設の、その施設で使えるコマか
    const isKnownSlot = (slot, catalog) => {
        const facility = catalog.facilities.find((entry) => entry.key === slot?.facilityKey);
        return Boolean(facility) && listTimeUnits(facility, catalog).some((timeUnit) => timeUnit.key === slot.timeKey);
    };
    // 日程の中の日付で、知っている施設のコマか
    const isSlotOfReservation = (slot, reservation, catalog) => isKnownSlot(slot, catalog)
        && isValidDateString(slot.date) && findDayIndex(reservation, slot.date) >= 0;
    // 取り込める予約の形か（予約番号・日程・宿泊人数は夜ごと・食事は利用日ごと・施設コマ）
    const isImportableReservation = (value, catalog) => typeof value === 'object' && value !== null
        && typeof value.id === 'string' && value.id !== '' && typeof value.groupName === 'string'
        && isValidDateString(value.startDate) && isNonNegativeInteger(value.nights)
        && isCountTable(value.stays, value.nights) && isCountTable(value.meals, value.nights + 1)
        && Array.isArray(value.slots) && value.slots.every((slot) => isSlotOfReservation(slot, value, catalog));
    const removeReservationById = (reservationList, id) => reservationList.filter((reservation) => reservation.id !== id);
    const hasReservationId = (reservationList, id) => reservationList.some((reservation) => reservation.id === id);
    // 同じ予約番号があれば置き換え、なければ最後に加えた、新しい一覧
    const upsertReservation = (reservationList, reservation) => (hasReservationId(reservationList, reservation.id)
        ? reservationList.map((current) => (current.id === reservation.id ? reservation : current))
        : [...reservationList, reservation]);

    // 予約の中で2回以上入っている施設コマの文言（2回目以降）
    const findInnerDuplicateMessages = (reservation, catalog) => reservation.slots
        .filter((slot, index) => reservation.slots.findIndex((otherSlot) => isSameSlot(otherSlot, slot)) !== index)
        .map((slot) => `${formatSlotLabel(slot, catalog)} が2回入っています`);
    // ほかの予約（otherReservations）と重なる施設コマの文言
    const findSlotConflictMessages = (otherReservations, reservation, catalog) => reservation.slots
        .filter((slot) => otherReservations.some((other) => hasSlot(other, slot)))
        .map((slot) => `${formatSlotLabel(slot, catalog)} はすでに別の団体の予約が入っています`);
    const listStayNightDates = (reservation) => Array.from({ length: reservation.nights },
        (_, nightIndex) => addDaysToDateString(reservation.startDate, nightIndex));
    // その夜に、ほかの予約と合わせて宿泊人数・団体数の上限を超えるときの文言（その夜に泊まらなければ対象外）
    const findStayLimitMessagesOnDate = (otherReservations, reservation, date, limits) => {
        const requestedGuests = countStayOnDate(reservation, date);
        const totalGuests = countStayGuests(otherReservations, date) + requestedGuests;
        const totalGroups = countStayGroups(otherReservations, date) + 1;
        return requestedGuests === 0 ? [] : [
            totalGuests > limits.stayCapacity && `${date}の夜の宿泊人数が1日の上限（${limits.stayCapacity}人）を超えます（合計 ${totalGuests}人）`,
            totalGroups > limits.maxStayGroups && `${date}の夜の宿泊団体数が1日の上限（${limits.maxStayGroups}団体）を超えます（合計 ${totalGroups}団体）`
        ].filter(Boolean);
    };
    const findStayLimitMessages = (otherReservations, reservation, limits) => listStayNightDates(reservation)
        .flatMap((date) => findStayLimitMessagesOnDate(otherReservations, reservation, date, limits));
    // 取り込めない理由のすべて（更新のときは、同じ予約番号の古い予約を除いて比べる）。context：{ catalog, limits }
    const findImportErrors = (reservationList, reservation, context) => {
        if (!isImportableReservation(reservation, context.catalog)) return ['予約の内容が正しくありません'];
        const otherReservations = removeReservationById(reservationList, reservation.id);
        return [...findInnerDuplicateMessages(reservation, context.catalog),
            ...findSlotConflictMessages(otherReservations, reservation, context.catalog),
            ...findStayLimitMessages(otherReservations, reservation, context.limits)];
    };

    const safeParseJson = (text) => {
        try { return JSON.parse(text); } catch (error) { return null; }
    };
    // 1行コードを読み取る（{ ok: true, code } または { ok: false, errors }）
    const parseScheduleCode = (codeText) => {
        const parsed = safeParseJson(typeof codeText === 'string' ? codeText.trim() : '');
        if (parsed?.type !== SCHEDULE_CODE_TYPE) return { ok: false, errors: ['予約の取込用コードではありません'] };
        if (parsed.version !== SCHEDULE_CODE_VERSION) return { ok: false, errors: [`対応していない版のコードです（version ${parsed.version}）`] };
        if (![undefined, 'delete'].includes(parsed.action)) return { ok: false, errors: [`知らない操作です（action ${parsed.action}）`] };
        return { ok: true, code: parsed };
    };
    const applyDeleteCode = (reservationList, id) => (hasReservationId(reservationList, id)
        ? { ok: true, operation: 'deleted', id, reservations: removeReservationById(reservationList, id) }
        : { ok: false, errors: [`予約番号 ${id} の予約はありません`] });
    const applyUpsertCode = (reservationList, reservation, context) => {
        const errors = findImportErrors(reservationList, reservation, context);
        if (errors.length > 0) return { ok: false, errors };
        const operation = hasReservationId(reservationList, reservation.id) ? 'updated' : 'added';
        return { ok: true, operation, id: reservation.id, reservations: upsertReservation(reservationList, reservation) };
    };
    // 1行コードを予約の一覧に反映する。新しい予約番号なら追加、同じ予約番号があれば更新、action: 'delete' なら削除
    // 成功：{ ok: true, operation: 'added' | 'updated' | 'deleted', id, reservations（新しい一覧） } ／ 失敗：{ ok: false, errors }
    // context：{ catalog, limits（STAY_LIMITS） }。元の一覧は書き換えない
    const applyReservationCode = (reservationList, codeText, context) => {
        const result = parseScheduleCode(codeText);
        if (!result.ok) return result;
        if (result.code.action === 'delete') return applyDeleteCode(reservationList, result.code.id);
        return applyUpsertCode(reservationList, result.code.reservation, context);
    };
    // 予約を削除する1行コード
    const buildDeleteCode = (id) => JSON.stringify({ type: SCHEDULE_CODE_TYPE, version: SCHEDULE_CODE_VERSION, action: 'delete', id });

    // ---------- 公開用データ（団体名・代表者名・電話番号・メールアドレス・予約番号などの個人情報は入れない） ----------
    // 予約1件の、宿泊人数が1人以上の夜と、施設コマのある日
    const listOccupiedDates = (reservation) => [
        ...listStayNightDates(reservation).filter((date) => countStayOnDate(reservation, date) > 0),
        ...reservation.slots.map((slot) => slot.date)
    ];
    // 宿泊か施設コマのある日の一覧（重なりを除いて日付の順）
    const listScheduleDates = (reservationList) => [...new Set(reservationList.flatMap(listOccupiedDates))].sort();
    // その日の埋まっている施設コマ（施設・コマのキーだけ。catalog の施設・コマの順）
    const listBookedSlots = (reservationList, date, catalog) => mapFacilitySchedule(reservationList, date, catalog)
        .flatMap((facilitySchedule) => facilitySchedule.units.filter((unit) => unit.symbol === '×')
            .map((unit) => ({ facilityKey: facilitySchedule.facilityKey, timeKey: unit.timeKey })));
    const buildPublicDay = (reservationList, date, catalog) => ({
        date, stayGuests: countStayGuests(reservationList, date), stayGroups: countStayGroups(reservationList, date),
        bookedSlots: listBookedSlots(reservationList, date, catalog)
    });
    // 公開用データ（{ days: [{ date, stayGuests, stayGroups, bookedSlots: [{ facilityKey, timeKey }] }] }）
    const buildPublicSchedule = (reservationList, catalog) => ({
        days: listScheduleDates(reservationList).map((date) => buildPublicDay(reservationList, date, catalog))
    });
    // 公開用データの JSON 文字列（generatedAt：作成日時 "YYYY-MM-DDTHH:mm"）
    const serializePublicSchedule = (reservationList, catalog, generatedAt) => JSON.stringify({
        type: PUBLIC_SCHEDULE_TYPE, version: PUBLIC_SCHEDULE_VERSION, generatedAt, ...buildPublicSchedule(reservationList, catalog)
    });
    const isPublicDay = (day, catalog) => typeof day === 'object' && day !== null && isValidDateString(day.date)
        && isNonNegativeInteger(day.stayGuests) && isNonNegativeInteger(day.stayGroups)
        && Array.isArray(day.bookedSlots) && day.bookedSlots.every((slot) => isKnownSlot(slot, catalog));
    // 決まった項目だけを写す（ほかの項目が入っていても捨て、個人情報を画面に出さない）
    const pickPublicDay = (day) => ({
        date: day.date, stayGuests: day.stayGuests, stayGroups: day.stayGroups,
        bookedSlots: day.bookedSlots.map((slot) => ({ facilityKey: slot.facilityKey, timeKey: slot.timeKey }))
    });
    const pickGeneratedAt = (value) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? value : '');
    // 公開用データの JSON を読み取る（{ ok: true, schedule: { generatedAt, days } } または { ok: false, errors }）
    const parsePublicSchedule = (text, catalog) => {
        const parsed = safeParseJson(typeof text === 'string' ? text.trim() : '');
        if (parsed?.type !== PUBLIC_SCHEDULE_TYPE) return { ok: false, errors: ['公開用スケジュールデータではありません'] };
        if (parsed.version !== PUBLIC_SCHEDULE_VERSION) return { ok: false, errors: [`対応していない版の公開用データです（version ${parsed.version}）`] };
        if (!Array.isArray(parsed.days) || !parsed.days.every((day) => isPublicDay(day, catalog))) return { ok: false, errors: ['公開用データの内容が正しくありません'] };
        return { ok: true, schedule: { generatedAt: pickGeneratedAt(parsed.generatedAt), days: parsed.days.map(pickPublicDay) } };
    };
    // 公開用データの1日分（その日の記録がなければ、宿泊0人・施設コマなし）
    const findPublicDay = (publicSchedule, date) => publicSchedule.days.find((day) => day.date === date)
        ?? { date, stayGuests: 0, stayGroups: 0, bookedSlots: [] };
    const isPublicSlotBooked = (publicDay, facilityKey, timeKey) => publicDay.bookedSlots
        .some((slot) => slot.facilityKey === facilityKey && slot.timeKey === timeKey);
    // 公開用データの1日分から作る、施設ごとのコマの空き状況（mapFacilitySchedule と同じ形。団体の詳細 bookings は常に空）
    const mapPublicFacilitySchedule = (publicDay, catalog) => catalog.facilities.map((facility) => ({
        facilityKey: facility.key, name: facility.name,
        units: listTimeUnits(facility, catalog).map((timeUnit) => ({
            timeKey: timeUnit.key, label: timeUnit.label, bookings: [],
            symbol: isPublicSlotBooked(publicDay, facility.key, timeUnit.key) ? '×' : '○'
        }))
    }));
    // 施設1日分の記号（すべて空き ◎ ／ 一部予約済み △ ／ すべて予約済み ×）
    const judgeFacilityDaySymbol = (units) => {
        const bookedCount = units.filter((unit) => unit.symbol === '×').length;
        if (bookedCount === 0) return '◎';
        return bookedCount >= units.length ? '×' : '△';
    };
    // カレンダーのマスに出す施設の略称（catalog.facilities の shortName。ないときは施設名を出す）
    const findFacilityShortName = (facilitySchedule, catalog) => catalog.facilities
        .find((facility) => facility.key === facilitySchedule.facilityKey)?.shortName ?? facilitySchedule.name;
    // カレンダーのマスに出す、施設ごとの略称と記号
    const summarizeFacilitySymbols = (facilitySchedules, catalog) => facilitySchedules.map((facilitySchedule) => ({
        facilityKey: facilitySchedule.facilityKey, shortName: findFacilityShortName(facilitySchedule, catalog),
        symbol: judgeFacilityDaySymbol(facilitySchedule.units)
    }));

    // ---------- 月間カレンダー（月は "YYYY-MM" の文字列で扱う） ----------
    const toMonthKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`;
    // "YYYY-MM" を { year, month } にする（形が違う・1〜12月でなければ null）
    const parseMonthKey = (monthKey) => {
        const match = /^(\d{4})-(\d{2})$/.exec(typeof monthKey === 'string' ? monthKey : '');
        const month = match ? Number(match[2]) : 0;
        return month >= 1 && month <= 12 ? { year: Number(match[1]), month } : null;
    };
    // 日付の月（"2026-10-18" → "2026-10"）
    const toMonthKeyOfDate = (dateString) => dateString.slice(0, 7);
    // delta か月ずらした月（年をまたいでもよい）
    const shiftMonthKey = (monthKey, delta) => {
        const { year, month } = parseMonthKey(monthKey);
        const monthIndex = year * 12 + (month - 1) + delta;
        return toMonthKey(Math.floor(monthIndex / 12), (monthIndex % 12) + 1);
    };
    const formatMonthLabel = (monthKey) => {
        const { year, month } = parseMonthKey(monthKey);
        return `${year}年${month}月`;
    };
    const countDaysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
    // 月の日付を週ごとに並べる（日曜始まり。月の外のマスは null で、どの週も7マス）
    const buildCalendarWeeks = (monthKey) => {
        const { year, month } = parseMonthKey(monthKey);
        const leadingCount = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
        const dates = Array.from({ length: countDaysInMonth(year, month) }, (_, index) => `${monthKey}-${String(index + 1).padStart(2, '0')}`);
        const cells = [...Array(leadingCount).fill(null), ...dates];
        const paddedCells = [...cells, ...Array((7 - (cells.length % 7)) % 7).fill(null)];
        return Array.from({ length: paddedCells.length / 7 }, (_, weekIndex) => paddedCells.slice(weekIndex * 7, weekIndex * 7 + 7));
    };

    // ---------- 表示モード（public：公開用（一般利用者向け） ／ staff：職員用（管理者向け）） ----------
    // URL の検索部分（"?mode=staff"）から最初のモードを決める（指定がなければ公開用）
    const resolveInitialMode = (search) => (new URLSearchParams(search ?? '').get('mode') === 'staff' ? 'staff' : 'public');
    // モードに合わせた URL の検索部分（ほかのパラメータは残す。公開用は mode を消す）
    const buildModeSearch = (search, mode) => {
        const params = new URLSearchParams(search ?? '');
        if (mode === 'staff') params.set('mode', 'staff'); else params.delete('mode');
        const text = params.toString();
        return text === '' ? '' : `?${text}`;
    };

    // ---------- 職員用の団体ごとの表示 ----------
    // その日に利用する（チェックアウト日・日帰りを含む）予約の一覧
    const listReservationsOnDate = (reservationList, date) => reservationList.filter((reservation) => findDayIndex(reservation, date) >= 0);
    // カレンダーのマスに出す団体名のバッジ（isStay：その夜に泊まるか）
    const listGroupBadges = (reservationList, date) => listReservationsOnDate(reservationList, date)
        .map((reservation) => ({ id: reservation.id, groupName: reservation.groupName, isStay: countStayOnDate(reservation, date) > 0 }));
    // 団体別の内訳一覧（その日の宿泊人数と食事の項目別の数。団体ごとに summarizeDailyReservations を使う）
    const buildGroupDailyRows = (reservationList, date, catalog) => listReservationsOnDate(reservationList, date).map((reservation) => {
        const summary = summarizeDailyReservations([reservation], date, catalog);
        return { ...toStaffBooking(reservation), stayGuests: summary.stayGuests, meals: summary.meals };
    });
    // 予約している団体が同じ、となりあうコマをまとめる（職員用の表で1つのマスにする。空きのコマはまとめない）
    const toBookingIdsText = (unit) => unit.bookings.map((booking) => booking.id).join(',');
    const mergeBookedUnits = (units) => units.reduce((runs, unit) => {
        const lastRun = runs[runs.length - 1];
        const canMerge = Boolean(lastRun) && toBookingIdsText(unit) !== '' && toBookingIdsText(lastRun.units[0]) === toBookingIdsText(unit);
        return canMerge ? [...runs.slice(0, -1), { ...lastRun, units: [...lastRun.units, unit] }]
            : [...runs, { symbol: unit.symbol, bookings: unit.bookings, units: [unit] }];
    }, []);

    // SCHEDULE_EXPORTS:start
    // ブラウザでは window.ScheduleLogic、Node.js（テスト）では module.exports から使う
    const ScheduleLogic = Object.freeze({
        SCHEDULE_CODE_TYPE, SCHEDULE_CODE_VERSION, STAY_THRESHOLDS, STAY_LIMITS, MEAL_SUMMARY_ITEMS,
        isValidDateString, addDaysToDateString, countDaysBetween, findNightIndex, findDayIndex, countStayOnDate,
        countStayGuests, countStayGroups, buildStayBreakdown, buildMealTotals, summarizeDailyReservations, judgeStaySymbol,
        listTimeUnits, isSameSlot, mapFacilitySchedule,
        isImportableReservation, upsertReservation, parseScheduleCode, applyReservationCode, buildDeleteCode,
        buildPublicSchedule,
        PUBLIC_SCHEDULE_TYPE, PUBLIC_SCHEDULE_VERSION, serializePublicSchedule, parsePublicSchedule,
        findPublicDay, mapPublicFacilitySchedule, judgeFacilityDaySymbol, summarizeFacilitySymbols,
        toMonthKey, parseMonthKey, toMonthKeyOfDate, shiftMonthKey, formatMonthLabel, buildCalendarWeeks,
        resolveInitialMode, buildModeSearch, listReservationsOnDate, listGroupBadges, buildGroupDailyRows, mergeBookedUnits
    });
    if (typeof module !== 'undefined') module.exports = ScheduleLogic;
    if (typeof window !== 'undefined') window.ScheduleLogic = ScheduleLogic;
    // SCHEDULE_EXPORTS:end
}
