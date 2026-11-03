const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

// Exercise the context boundary with Herdr's native UI/runtime replaced by stubs.
function panel() {
  let focus = { space: 'remote-space', tab: 'active-tab', cwd: '/remote/current' };
  const store = {};
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export default class Latex', 'return class Latex');
  const inputs = { new({ value }) {
    let text = value;
    const handlers = {};
    return { value: () => text, on: (name, fn) => { handlers[name] = fn; },
      set_value(next) { text = next; }, focus() {} };
  } };
  const Latex = new Function('View', 'InputState', 'focused', 'spaces', 'panes', 'home', 'shared', 'setShared', 'props', source)(
    class {}, inputs, () => focus,
    () => [{ id: 'remote-space', machine: 'ufr', folder: '/wrong/stale-folder', tabs: [{ id: 'active-tab', active: true }] }],
    () => [{ tab: 'active-tab', cwd: '/remote/live-pane' }], () => '/local/home', k => store[k], (k, v) => { store[k] = v; }, () => ({}));
  const cx = { focus_handle: () => ({}), notify() {}, timer: { every() {} }, spawn() {} };
  const view = new Latex();
  view.poll = () => {};
  let searches = 0;
  view.discover = () => { searches++; };
  view.init({}, cx);
  return { view, cx, store, focus: next => { focus = next; }, searches: () => searches };
}

test('uses the focused terminal folder instead of the space creation folder', () => {
  const { view } = panel();
  assert.equal(view.config().folder, '/remote/current');
  assert.equal(view.config().machine, 'ufr');
  assert.equal(view.inputs.folder, undefined);
});

test('follows directory changes and restores document preferences per folder', () => {
  const p = panel();
  p.view.inputs.tex.set_value('slides/slides.tex');
  p.view.save();
  p.focus({ space: 'remote-space', tab: 'active-tab', cwd: '/remote/other' });
  p.view.followCurrent(p.cx);
  assert.equal(p.view.config().folder, '/remote/other');
  assert.equal(p.view.config().tex, '');
  p.focus({ space: 'remote-space', tab: 'active-tab', cwd: '/remote/current' });
  p.view.followCurrent(p.cx);
  assert.equal(p.view.config().tex, 'slides/slides.tex');
  assert.equal(p.searches(), 3);
});

test('uses a live pane when focus has no cwd, and follows machine changes', () => {
  const p = panel();
  p.focus({ space: 'remote-space', tab: 'active-tab', cwd: null });
  p.view.followCurrent(p.cx);
  assert.equal(p.view.config().folder, '/remote/live-pane');
  p.focus({ space: 'local-space', tab: 'local-tab', cwd: '/local/project' });
  p.view.followCurrent(p.cx);
  assert.equal(p.view.config().machine, '');
  assert.equal(p.view.config().folder, '/local/project');
});
