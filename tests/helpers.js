// テストで共通して使う関数
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT_DIR = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT_DIR, 'estimate', 'index.html');
const PORTAL_PATH = path.join(ROOT_DIR, 'index.html');
const BROWSER_CANDIDATES = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];

const readHtml = () => fs.readFileSync(HTML_PATH, 'utf8');

const findBrowser = (candidates) => candidates.find((p) => fs.existsSync(p));

const buildBrowserArgs = (profileDir, fileUrl) => [
    '--headless=new', '--disable-gpu', '--no-first-run',
    `--user-data-dir=${profileDir}`, '--virtual-time-budget=5000',
    '--dump-dom', fileUrl
];

// ブラウザでページを開き、JavaScript 実行後の HTML を返す
const renderDom = (browserPath, htmlPath) => {
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'estimate-test-'));
    const args = buildBrowserArgs(profileDir, pathToFileURL(htmlPath).href);
    return execFileSync(browserPath, args, { encoding: 'utf8', timeout: 60000 });
};

const findById = (dom, id) => {
    const match = new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(dom);
    return match ? match[1] : null;
};

module.exports = { ROOT_DIR, HTML_PATH, PORTAL_PATH, BROWSER_CANDIDATES, readHtml, findBrowser, renderDom, findById };
