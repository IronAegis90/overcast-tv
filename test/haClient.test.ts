import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
  OvercastClient,
  backoffMs,
  websocketUrl,
  type ClientStatus,
  type DeliveryResult,
} from '../src/haClient.ts';
import type {NotificationEvent} from '../src/protocol.ts';
import {FakeSocket, FakeTimers, tick} from './fakes.ts';

const REGISTRATION = {
  device_id: 'dev-1',
  name: 'Living Room TV',
  app_version: '0.1.0',
  capabilities: {launch: true, icon_size: true},
};

function setup(deliver: (e: NotificationEvent) => Promise<DeliveryResult> = async () => ({status: 'posted'})) {
  const sockets: FakeSocket[] = [];
  const timers = new FakeTimers();
  const statuses: ClientStatus[] = [];
  const delivered: NotificationEvent[] = [];
  const client = new OvercastClient({
    url: 'https://ha.example.com:8123/',
    token: 'TOKEN',
    registration: REGISTRATION,
    onNotification: async e => {
      delivered.push(e);
      return deliver(e);
    },
    onStatus: s => statuses.push(s),
    socketFactory: url => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    timers,
    now: () => Date.parse('2026-10-29T20:00:00Z'),
  });
  return {client, sockets, timers, statuses, delivered};
}

function connect(socket: FakeSocket) {
  socket.receive({type: 'auth_required'});
  socket.receive({type: 'auth_ok'});
  socket.receive({id: 1, type: 'result', success: true, result: {protocol: 1}});
}

const notification = (overrides: Partial<NotificationEvent> = {}): NotificationEvent => ({
  kind: 'notification',
  nid: 'N1',
  expires_at: '2026-10-29T20:01:00Z',
  title: 'Front door',
  message: 'Motion',
  duration: 8,
  ...overrides,
});

test('websocketUrl maps the HA base URL to the WebSocket endpoint', () => {
  assert.equal(websocketUrl('https://x.ui.nabu.casa/'), 'wss://x.ui.nabu.casa/api/websocket');
  assert.equal(websocketUrl(' http://192.168.1.5:8123 '), 'ws://192.168.1.5:8123/api/websocket');
  assert.throws(() => websocketUrl('homeassistant.local'));
});

test('backoff doubles up to a minute', () => {
  assert.deepEqual([0, 1, 2, 5, 6, 10].map(backoffMs), [1000, 2000, 4000, 32000, 60000, 60000]);
});

test('authenticates, registers and reports connected', () => {
  const {client, sockets, statuses} = setup();
  client.start();
  const socket = sockets[0];
  assert.equal(socket.url, 'wss://ha.example.com:8123/api/websocket');

  socket.receive({type: 'auth_required'});
  assert.deepEqual(socket.last(), {type: 'auth', access_token: 'TOKEN'});

  socket.receive({type: 'auth_ok'});
  assert.deepEqual(socket.last(), {id: 1, type: 'overcast/register', protocol: 1, ...REGISTRATION});

  socket.receive({id: 1, type: 'result', success: true, result: {protocol: 1}});
  assert.equal(statuses.at(-1)?.state, 'connected');
});

test('shows a notification and acks it', async () => {
  const {client, sockets, delivered} = setup();
  client.start();
  connect(sockets[0]);

  sockets[0].receive({id: 1, type: 'event', event: notification()});
  await tick();
  assert.equal(delivered.length, 1);
  assert.deepEqual(sockets[0].last(), {id: 2, type: 'overcast/ack', device_id: 'dev-1', nid: 'N1', status: 'posted'});
});

test('reports a failed toast in the ack', async () => {
  const {client, sockets} = setup(async () => {
    throw new Error('privilege denied');
  });
  client.start();
  connect(sockets[0]);
  sockets[0].receive({id: 1, type: 'event', event: notification()});
  await tick();
  assert.equal(sockets[0].last().status, 'failed');
  assert.match(sockets[0].last().error, /privilege denied/);
});

test('acks an expired notification without showing it', async () => {
  const {client, sockets, delivered} = setup();
  client.start();
  connect(sockets[0]);
  sockets[0].receive({id: 1, type: 'event', event: notification({expires_at: '2026-10-29T19:59:00Z'})});
  await tick();
  assert.equal(delivered.length, 0);
  assert.equal(sockets[0].last().status, 'expired');
});

test('reconnects with backoff after the socket drops', () => {
  const {client, sockets, timers, statuses} = setup();
  client.start();
  sockets[0].drop();
  assert.equal(statuses.at(-1)?.state, 'disconnected');
  assert.deepEqual(timers.flushTimeouts(), [1000]);
  assert.equal(sockets.length, 2);
  sockets[1].drop();
  assert.deepEqual(timers.flushTimeouts(), [2000]);

  // A successful registration resets the backoff.
  connect(sockets[2]);
  sockets[2].drop();
  assert.deepEqual(timers.flushTimeouts(), [1000]);
});

test('stops retrying when the token is rejected', () => {
  const {client, sockets, timers, statuses} = setup();
  client.start();
  sockets[0].receive({type: 'auth_required'});
  sockets[0].receive({type: 'auth_invalid', message: 'Invalid access token'});
  sockets[0].drop();
  assert.equal(statuses.at(-1)?.state, 'auth_failed');
  assert.equal(timers.timeouts.size, 0);
});

test('stops retrying when the integration is missing', () => {
  const {client, sockets, timers, statuses} = setup();
  client.start();
  sockets[0].receive({type: 'auth_required'});
  sockets[0].receive({type: 'auth_ok'});
  sockets[0].receive({id: 1, type: 'result', success: false, error: {code: 'unknown_command', message: 'Unknown command.'}});
  assert.equal(statuses.at(-1)?.state, 'unsupported');
  assert.equal(timers.timeouts.size, 0);
});

test('retries when the integration is not set up yet', () => {
  const {client, sockets, timers} = setup();
  client.start();
  sockets[0].receive({type: 'auth_required'});
  sockets[0].receive({type: 'auth_ok'});
  sockets[0].receive({id: 1, type: 'result', success: false, error: {code: 'not_loaded', message: 'not set up'}});
  assert.equal(sockets[0].closed, true);
  assert.deepEqual(timers.flushTimeouts(), [1000]);
  assert.equal(sockets.length, 2);
});

test('reconnects when Home Assistant asks', () => {
  const {client, sockets, timers} = setup();
  client.start();
  connect(sockets[0]);
  sockets[0].receive({id: 1, type: 'event', event: {kind: 'reconnect'}});
  assert.equal(sockets[0].closed, true);
  timers.flushTimeouts();
  assert.equal(sockets.length, 2);
});

test('pings, and reconnects when a ping goes unanswered', () => {
  const {client, sockets, timers} = setup();
  client.start();
  connect(sockets[0]);

  timers.tickIntervals();
  const ping = sockets[0].last();
  assert.equal(ping.type, 'ping');
  sockets[0].receive({id: ping.id, type: 'pong'});

  timers.tickIntervals();
  timers.tickIntervals(); // no pong for the second ping
  assert.equal(sockets[0].closed, true);
  timers.flushTimeouts();
  assert.equal(sockets.length, 2);
});

test('stop closes the socket and cancels retries', () => {
  const {client, sockets, timers, statuses} = setup();
  client.start();
  sockets[0].drop();
  client.stop();
  assert.equal(timers.timeouts.size, 0);
  assert.equal(statuses.at(-1)?.state, 'stopped');
});
