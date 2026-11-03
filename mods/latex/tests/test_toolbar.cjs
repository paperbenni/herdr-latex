const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

function button(store = {}) {
  let status = {};
  let task;
  const source = fs.readFileSync(path.join(__dirname, '..', 'toolbar-button.js'), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export default class LatexToolbarButton', 'class LatexToolbarButton');
  const { LatexToolbarButton, isActive } = new Function('View', 'shared', 'readTextFile', 'exec', 'appHome', source + '\nreturn {LatexToolbarButton, isActive};')(
    class {}, key => store[key], async () => JSON.stringify(status),
    async () => ({ code: 0, stdout: JSON.stringify({ status }) }), () => '/app');
  const view = new LatexToolbarButton();
  const cx = { notify() {}, timer: { every() {} }, spawn(fn) { task = fn(cx); } };
  return { view, cx, isActive, status: next => { status = next; }, wait: () => task };
}

test('active means a live build or preview watcher, and excludes stale or stopped helpers', () => {
  const { isActive } = button();
  assert.equal(isActive({ pid: 1, heartbeat: 100, watching: true }, 110), true);
  assert.equal(isActive({ pid: 1, heartbeat: 100, building: true }, 110), true);
  assert.equal(isActive({ pid: 1, heartbeat: 100, watching: false, building: false }, 110), false);
  assert.equal(isActive({ pid: 1, heartbeat: 100, watching: true }, 300), false);
  assert.equal(isActive({ heartbeat: 100, watching: true }, 110), false);
});

test('toolbar reads helper state independently of whether the panel is open', async () => {
  const p = button({ 'latex.status-file': '/app/status.json' });
  p.status({ pid: 1, heartbeat: Date.now() / 1000, watching: true });
  p.view.init({}, p.cx);
  await p.wait();
  assert.equal(p.view.active, true);
  p.status({ pid: 1, heartbeat: Date.now() / 1000, watching: false });
  p.view.refresh(p.cx);
  await p.wait();
  assert.equal(p.view.active, false);
});

test('existing sessions are detected before a status-file pointer has been saved', async () => {
  const p = button({ 'latex.active-session': { machine: 'remote', folder: '/paper' } });
  p.status({ pid: 1, heartbeat: Date.now() / 1000, building: true });
  p.view.init({}, p.cx);
  await p.wait();
  assert.equal(p.view.active, true);
});
