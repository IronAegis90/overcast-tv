import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

import {MAIN_ID, PACKAGE_ID, SERVICE_ID} from '../src/ids.ts';

const manifest = readFileSync(new URL('../manifest.toml', import.meta.url), 'utf8');
const appJson = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
const serviceJs = readFileSync(new URL('../service.js', import.meta.url), 'utf8');

/** The ids listed under every [[<table>]] header in the manifest. */
function ids(table: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`^\\[\\[${table.replace('.', '\\.')}\\]\\]\\s*\\n(?:#.*\\n)*id = "([^"]+)"`, 'gm');
  for (const m of manifest.matchAll(re)) {
    out.push(m[1]);
  }
  return out;
}

test('ids agree across manifest, app.json and code', () => {
  assert.match(manifest, new RegExp(`^id = "${PACKAGE_ID}"$`, 'm'));
  assert.deepEqual(ids('components.interactive'), [MAIN_ID]);
  assert.equal(appJson.name, MAIN_ID);
  assert.deepEqual(ids('components.service'), [SERVICE_ID]);
});

test('service is wanted, offered and in its own process group', () => {
  assert.deepEqual(ids('wants.service'), [SERVICE_ID]);
  assert.deepEqual(ids('offers.service'), [SERVICE_ID]);
  assert.match(manifest, new RegExp(`component-ids = \\["${SERVICE_ID.replaceAll('.', '\\.')}"\\]`));
});

test('declares the toast privilege and headless task manager', () => {
  assert.ok(ids('needs.privilege').includes('com.amazon.notification.privilege.post'));
  assert.ok(ids('needs.module').some(id => id.startsWith('/com.amazon.kepler.headless_task_manager_1@')));
});

test('service.js registers both entry points', () => {
  assert.match(serviceJs, /::onStartService/);
  assert.match(serviceJs, /::onStopService/);
  assert.match(serviceJs, /registerHeadlessEntryPoint\(/);
});
