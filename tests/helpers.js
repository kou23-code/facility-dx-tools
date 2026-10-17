// テストで共通して使う関数
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT_DIR = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT_DIR, 'estimate', 'index.html');
const PORTAL_PATH = path.join(ROOT_DIR, 'index.html');
const RESERVATION_DIR = path.join(ROOT_DIR, 'reservation');
const RESERVATION_HTML_PATH = path.join(RESERVATION_DIR, 'index.html');
const RESERVATION_LOGIC_PATH = path.join(RESERVATION_DIR, 'reservation-logic.js');
const SCHEDULE_DIR = path.join(ROOT_DIR, 'schedule');
const SCHEDULE_HTML_PATH = path.join(SCHEDULE_DIR, 'index.html');
const SCHEDULE_LOGIC_PATH = path.join(SCHEDULE_DIR, 'schedule-logic.js');
const BROWSER_CANDIDATES = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];

// ヘッドレスブラウザ1回分の待ち時間の上限（ミリ秒）。テストを並列で動かすと多数のブラウザが同時に起動して
// 1回に60秒以上かかることがあるため、余裕をもたせている（ブラウザが固まったときは、この時間で打ち切る）
const BROWSER_TIMEOUT_MS = 180000;

const readHtml = () => fs.readFileSync(HTML_PATH, 'utf8');

const findBrowser = (candidates) => candidates.find((p) => fs.existsSync(p));

const buildBrowserArgs = (profileDir, fileUrl) => [
    '--headless=new', '--disable-gpu', '--no-first-run',
    `--user-data-dir=${profileDir}`, '--virtual-time-budget=5000',
    '--dump-dom', fileUrl
];

// ブラウザでページを開き、JavaScript 実行後の HTML を返す（search：URL の検索部分。例："?mode=staff"）
const renderDom = (browserPath, htmlPath, search = '') => {
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'estimate-test-'));
    const args = buildBrowserArgs(profileDir, `${pathToFileURL(htmlPath).href}${search}`);
    return execFileSync(browserPath, args, { encoding: 'utf8', timeout: BROWSER_TIMEOUT_MS });
};

const findById = (dom, id) => {
    const match = new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(dom);
    return match ? match[1] : null;
};

module.exports = {
    ROOT_DIR, HTML_PATH, PORTAL_PATH, RESERVATION_DIR, RESERVATION_HTML_PATH, RESERVATION_LOGIC_PATH,
    SCHEDULE_DIR, SCHEDULE_HTML_PATH, SCHEDULE_LOGIC_PATH,
    BROWSER_CANDIDATES, readHtml, findBrowser, renderDom, findById
};
