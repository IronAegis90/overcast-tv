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
