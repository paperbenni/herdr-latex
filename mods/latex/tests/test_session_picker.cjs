const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

function picker(allSpaces, allPanes) {
  const calls = [];
  const source = fs.readFileSync(path.join(__dirname, '..', 'session-picker.js'), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export default class LatexSessionPicker', 'class LatexSessionPicker');
  const Picker = new Function('View', 'run', 'spaces', 'panes', 'closeOverlay', source + '\nreturn LatexSessionPicker;')(
    class {}, (name, args) => calls.push([name, args]), () => allSpaces, () => allPanes, id => calls.push(['close', id]));
  const view = new Picker();
  view.init({ overlay: 'picker', active: { machine: 'remote', folder: '/paper' }, current: { machine: '', folder: '/home/local' } });
  return { view, calls };
}

test('jump selects an existing pane on the correct machine', () => {
  const p = picker([{ id: 'remote-space', machine: 'remote', tabs: [{ id: 'remote-tab' }] }],
    [{ id: 'wrong', tab: 'local-tab', cwd: '/paper' }, { id: 'right', tab: 'remote-tab', cwd: '/paper/' }]);
  p.view.jump();
  assert.deepEqual(p.calls.filter(c => c[0] !== 'close'), [
    ['tab.select', { id: 'remote-tab' }], ['pane.focus', { pane: 'right' }], ['mod.open', { name: 'latex' }]]);
});

test('jump opens a tab at the active folder if its old pane has gone', () => {
  const p = picker([{ id: 'remote-space', machine: 'remote', tabs: [] }], []);
  p.view.jump();
  assert.deepEqual(p.calls.find(c => c[0] === 'tab.new'), ['tab.new', { space: 'remote-space', folder: '/paper', name: 'LaTeX' }]);
});

test('open here does not navigate away from the current session', () => {
  const p = picker([], []);
  p.view.openHere();
  assert.deepEqual(p.calls.filter(c => c[0] !== 'close'), [['mod.open', { name: 'latex' }]]);
});
