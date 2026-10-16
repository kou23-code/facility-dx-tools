// 見積書の有効期限（発行日の1か月後）の動作確認テスト
// 実行方法：node --test tests/expiration-date.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { readHtml } = require('./helpers');

const BLOCK_PATTERN = /\/\/ EXPIRATION:start([\s\S]*?)\/\/ EXPIRATION:end/;

const loadExpirationBlock = (html) => vm.runInNewContext(`${BLOCK_PATTERN.exec(html)[1]}\n({ calculateExpirationDate })`);

const { calculateExpirationDate } = loadExpirationBlock(readHtml());

// "YYYY-MM-DD" ⇔ ローカル時刻の Date の変換（テスト用）
const toLocalDate = (text) => {
    const [year, month, day] = text.split('-').map(Number);
    return new Date(year, month - 1, day);
};
const formatYmd = (date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0')).join('-');

const assertExpiration = (issueText, expectedText) => {
    assert.strictEqual(formatYmd(calculateExpirationDate(toLocalDate(issueText))), expectedText, `発行日 ${issueText}`);
};

test('月の途中の日は、翌月の同じ日になる', () => {
    assertExpiration('2026-01-15', '2026-02-15');
    assertExpiration('2026-06-01', '2026-07-01');
    assertExpiration('2026-02-28', '2026-03-28');
});

test('翌月に同じ日がない月末日は、翌月の月末日になる（月をまたいでずれない）', () => {
    assertExpiration('2026-01-31', '2026-02-28');
    assertExpiration('2026-01-29', '2026-02-28');
    assertExpiration('2026-03-31', '2026-04-30');
    assertExpiration('2026-05-31', '2026-06-30');
    assertExpiration('2026-08-31', '2026-09-30');
    assertExpiration('2026-10-31', '2026-11-30');
});

test('翌月にも同じ日がある月末日は、そのまま翌月の同じ日になる', () => {
    assertExpiration('2026-04-30', '2026-05-30');
    assertExpiration('2026-07-31', '2026-08-31');
});

test('うるう年の2月は29日まで使える', () => {
    assertExpiration('2028-01-31', '2028-02-29');
    assertExpiration('2028-01-29', '2028-02-29');
    assertExpiration('2028-02-29', '2028-03-29');
    assertExpiration('2000-01-31', '2000-02-29');
});

test('100で割り切れて400で割り切れない年は、うるう年にしない', () => {
    assertExpiration('2100-01-31', '2100-02-28');
});

test('12月の発行日は、翌年の1月になる（年またぎ）', () => {
    assertExpiration('2026-12-01', '2027-01-01');
    assertExpiration('2026-12-15', '2027-01-15');
    assertExpiration('2026-12-31', '2027-01-31');
});

test('渡した発行日の Date を書き換えない', () => {
    const issueDate = toLocalDate('2026-01-31');
    calculateExpirationDate(issueDate);
    assert.strictEqual(formatYmd(issueDate), '2026-01-31');
});

test('見積書の有効期限は、予約開始日ではなく発行日から計算している', () => {
    const html = readHtml();
    assert.ok(html.includes('calculateExpirationDate(issueDate)'), '有効期限を発行日から計算していません');
    assert.ok(!html.includes('setMonth('), '月があふれる setMonth による計算が残っています');
});
