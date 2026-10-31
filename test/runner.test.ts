import assert from 'node:assert/strict';
import {test} from 'node:test';

import {loadStatus, newDeviceId, saveConfig} from '../src/config.ts';
import {ServiceRunner} from '../src/service/runner.ts';
import type {NotificationEvent} from '../src/protocol.ts';
import {FakeSocket, FakeTimers, MemoryStorage, tick} from './fakes.ts';

function setup() {
  const storage = new MemoryStorage();
  const sockets: FakeSocket[] = [];
  const posted: NotificationEvent[] = [];
  const runner = new ServiceRunner({
    storage,
    post: async e => {
      posted.push(e);
    },
    clientOptions: {
      socketFactory: url => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
      timers: new FakeTimers(),
    },
    setInterval: () => 1,
    clearInterval: () => {},
  });
  return {storage, sockets, posted, runner};
}

test('device ids are v4 UUIDs', () => {
  assert.match(newDeviceId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('saving keeps the device id and bumps the revision', async () => {
  const storage = new MemoryStorage();
  const first = await saveConfig(storage, {url: 'https://a', token: 't', name: 'TV'});
  const second = await saveConfig(storage, {url: 'https://b', token: 't', name: 'TV'});
  assert.equal(second.deviceId, first.deviceId);
  assert.equal(second.revision, first.revision + 1);
});

test('reports unconfigured until settings are saved', async () => {
  const {storage, sockets, runner} = setup();
  runner.start();
  await tick();
  assert.equal((await loadStatus(storage))?.state, 'unconfigured');
  assert.equal(sockets.length, 0);
});

test('connects with saved settings, posts toasts and reconnects on change', async () => {
  const {storage, sockets, posted, runner} = setup();
  const config = await saveConfig(storage, {url: 'https://ha.example.com', token: 'T1', name: 'TV'});
  runner.start();
  await tick();
  assert.equal(sockets.length, 1);

  const socket = sockets[0];
  socket.receive({type: 'auth_required'});
  assert.equal(socket.last().access_token, 'T1');
  socket.receive({type: 'auth_ok'});
  assert.equal(socket.last().device_id, config.deviceId);
  socket.receive({id: 1, type: 'result', success: true, result: {}});
  await tick();
  assert.equal((await loadStatus(storage))?.state, 'connected');

  socket.receive({
    id: 1,
    type: 'event',
    event: {kind: 'notification', nid: 'N1', expires_at: '2999-01-01T00:00:00Z', title: 'Hi', message: 'There', duration: 8},
  });
  await tick();
  await tick();
  assert.equal(posted.length, 1);
  assert.equal((await loadStatus(storage))?.lastNotification?.status, 'posted');

  // Unchanged config: nothing happens.
  await runner.checkConfig();
  assert.equal(sockets.length, 1);

  await saveConfig(storage, {url: 'https://ha.example.com', token: 'T2', name: 'TV'});
  await runner.checkConfig();
  assert.equal(socket.closed, true);
  assert.equal(sockets.length, 2);
  runner.stop();
});

/** Storage whose reads only resolve when the test says so. */
class SlowStorage extends MemoryStorage {
  pending: Array<() => void> = [];
  reads = 0;
  async getItem(key: string): Promise<string | null> {
    this.reads++;
    await new Promise<void>(resolve => this.pending.push(resolve));
    return super.getItem(key);
  }
  release(): void {
    this.pending.splice(0).forEach(resolve => resolve());
  }
}

function setupWith(storage: MemoryStorage) {
  const sockets: FakeSocket[] = [];
  const runner = new ServiceRunner({
    storage,
    post: async () => {},
    clientOptions: {
      socketFactory: url => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
      timers: new FakeTimers(),
    },
    setInterval: () => 1,
    clearInterval: () => {},
  });
  return {sockets, runner};
}

test('a config read still pending at stop() starts no client', async () => {
  const storage = new SlowStorage();
  await MemoryStorage.prototype.setItem.call(
    storage,
    'overcast.config',
    JSON.stringify({url: 'https://ha', token: 't', name: 'TV', deviceId: 'd', revision: 1}),
  );
  const {sockets, runner} = setupWith(storage);
  runner.start();
  runner.stop();
  storage.release();
  await tick();
  assert.equal(sockets.length, 0);
});

test('config checks do not overlap', async () => {
  const storage = new SlowStorage();
  const {runner} = setupWith(storage);
  runner.start();
  await runner.checkConfig(); // poll while the first read is pending: skipped
  assert.equal(storage.reads, 1);
  storage.release();
  await tick();
  runner.stop();
});

test('status timestamp is refreshed on every poll', async () => {
  const {storage, runner} = setup();
  await saveConfig(storage, {url: 'https://ha.example.com', token: 'T', name: 'TV'});
  runner.start();
  await tick();
  const first = (await loadStatus(storage))!.at;
  await new Promise(resolve => setTimeout(resolve, 5));
  await runner.checkConfig();
  assert.ok((await loadStatus(storage))!.at > first);
  runner.stop();
});
