const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

function button(store = {}) {
  let status = {};
  let task;
  const calls = [];
  let focus = { space: 'remote-space', tab: 'remote-tab', cwd: '/paper' };
  const source = fs.readFileSync(path.join(__dirname, '..', 'toolbar-button.js'), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/^export function /gm, 'function ').replace('export default class LatexToolbarButton', 'class LatexToolbarButton');
  const { LatexToolbarButton, isActive, sameFolder } = new Function('View', 'shared', 'readTextFile', 'exec', 'appHome', 'focused', 'spaces', 'panes', 'home', 'closeOverlay', 'openOverlay', 'run', 'layout', source + '\nreturn {LatexToolbarButton, isActive, sameFolder};')(
    class {}, key => store[key], async () => JSON.stringify(status),
    async () => ({ code: 0, stdout: JSON.stringify({ status }) }), () => '/app',
    () => focus, () => [{ id: 'remote-space', machine: 'remote', folder: '/stale', tabs: [{ id: 'remote-tab', active: true }] }],
    () => [], () => '/local/home', id => calls.push(['close', id]), options => calls.push(['popup', options]), (name, args) => calls.push([name, args]), () => ({ id: 'root' }));
  const view = new LatexToolbarButton();
  const cx = { notify() {}, timer: { every() {} }, spawn(fn) { task = fn(cx); } };
  return { view, cx, isActive, sameFolder, calls, focus: next => { focus = next; }, status: next => { status = next; }, wait: () => task };
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

test('active styling is scoped to the same machine and folder', () => {
  const { sameFolder } = button();
  assert.equal(sameFolder({ machine: 'remote', folder: '/paper/' }, { machine: 'remote', folder: '/paper' }), true);
  assert.equal(sameFolder({ machine: 'other', folder: '/paper' }, { machine: 'remote', folder: '/paper' }), false);
  assert.equal(sameFolder({ machine: 'remote', folder: '/elsewhere' }, { machine: 'remote', folder: '/paper' }), false);
});

test('clicking an activity in another folder offers current-folder and active-preview choices', () => {
  const active = { machine: 'remote', folder: '/other-project', tex: 'main.tex' };
  const p = button({ 'latex.active-session': active });
  p.view.active = true;
  p.view.open();
  const popup = p.calls.find(c => c[0] === 'popup')[1];
  assert.equal(popup.mod, 'latex');
  assert.equal(popup.props.sessionPicker, true);
  assert.deepEqual(popup.props.current, { machine: 'remote', folder: '/paper' });
  assert.deepEqual(popup.props.active, active);
  assert.equal(p.calls.some(c => c[0] === 'mod.open'), false);
});

test('same-folder or inactive toolbar clicks open the current panel directly', () => {
  const p = button({ 'latex.active-session': { machine: 'remote', folder: '/paper' } });
  p.view.active = true;
  p.view.open();
  assert.deepEqual(p.calls, [['mod.open', { name: 'latex' }]]);
  p.calls.length = 0;
  p.view.active = false;
  p.focus({ space: 'remote-space', tab: 'remote-tab', cwd: '/another-folder' });
  p.view.open();
  assert.deepEqual(p.calls, [['mod.open', { name: 'latex' }]]);
});
