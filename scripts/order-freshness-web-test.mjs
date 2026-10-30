import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const script = readFileSync(new URL('../public/v2/modules-v161-order-freshness.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../src/index-production-mobile-update.js', import.meta.url), 'utf8');
assert.match(shell, /modules-v161-order-freshness\.js\?v=161\.0/, 'Production shell must load freshness bridge');

let now = 100000, reloaded = 0, editing = false, online = true, visible = 'visible', active = 'orders';
const windowListeners = new Map(), documentListeners = new Map();
const window = {
  addEventListener: (key, fn) => windowListeners.set(key, fn),
  dispatchEvent: () => {},
  KunSectionReloadV57: {activeView: () => active, reload: async () => { reloaded++; }}
};
const document = {
  addEventListener: (key, fn) => documentListeners.set(key, fn),
  querySelector: () => editing ? {} : null,
  activeElement: {matches: () => false},
  get visibilityState() {return visible;}
};
const navigator = {get onLine() {return online;}};
class ClockDate extends Date {static now() {return now;}}
let channel;
class MockChannel {
  constructor() {channel = this; this.closed = false; this.messages = [];}
  postMessage(message) {this.messages.push(message);}
  close() {this.closed = true;}
}
let tick;
vm.runInNewContext(script, {window, document, navigator, BroadcastChannel: MockChannel,
  CustomEvent: class {constructor(type, options) {this.type = type; this.detail = options?.detail;}},
  Date: ClockDate, setInterval: fn => {tick = fn; return 1;}, clearInterval: () => {}});
const flush = async () => {await Promise.resolve(); await Promise.resolve();};
assert.equal(window.KunOrderFreshnessV161.version, '161.0');
windowListeners.get('focus')(); await flush();
assert.equal(reloaded, 1, 'Focus refreshes active orders');
windowListeners.get('focus')(); await flush();
assert.equal(reloaded, 1, 'Debounced repeat focus');
now += 13000; visible = 'hidden'; tick(); await flush();
assert.equal(reloaded, 1, 'No hidden-tab order scans');
visible = 'visible'; editing = true; documentListeners.get('visibilitychange')(); await flush();
assert.equal(reloaded, 1, 'Never disrupt edit form');
editing = false; online = false; tick(); await flush();
assert.equal(reloaded, 1, 'No retry while offline');
online = true; windowListeners.get('online')(); await flush();
assert.equal(reloaded, 2, 'Refresh when network reconnects');
now += 13000; active = 'settings'; tick(); await flush();
assert.equal(reloaded, 2, 'No unrelated sections');
active = 'customer-service';
windowListeners.get('kun:order-workflow-updated')();
assert.equal(channel.messages.length, 1, 'Notify other same-origin tabs after a mutation');
channel.onmessage({data: {type:'orders-updated'}}); await flush();
assert.equal(reloaded, 3, 'Other tab reloads authorized customer-service data');
windowListeners.get('pagehide')();
assert.equal(channel.closed, true);
console.log('PASS: web foreground orders refresh, scoped views, editor safety, and cross-tab invalidation');
