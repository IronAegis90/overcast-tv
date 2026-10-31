import assert from 'node:assert/strict';
import {test} from 'node:test';

import type {NotificationEvent} from '../src/protocol.ts';
import {
  AppLaunchTarget,
  DEFAULT_ICON_URL,
  MENU_TOAST,
  SIMPLE_TOAST,
  ToastKind,
  buildToastContent,
} from '../src/toastContent.ts';

const base: NotificationEvent = {
  kind: 'notification',
  nid: 'N1',
  expires_at: '2026-10-29T20:01:00Z',
  title: 'Front door',
  message: 'Motion',
  duration: 12,
};

test('plain notification uses the simple template and the default icon', () => {
  const content = buildToastContent(base);
  assert.equal(content.mTitle, 'Front door');
  assert.equal(content.mDescription, 'Motion');
  assert.equal(content.mIconUri, DEFAULT_ICON_URL);
  assert.equal(content.mTimeout, 12);
  assert.deepEqual(content.mLaunchTargets, []);
  assert.equal(content.mChannel.name, SIMPLE_TOAST);
  assert.ok(content.mChannel.kind instanceof ToastKind);
  assert.equal('mSmallIconUri' in content || 'mLargeIconUri' in content, false);
});

test('launch action uses the menu template', () => {
  const content = buildToastContent({...base, launch: {uri: 'pkg://com.example.main', title: 'Open'}});
  assert.equal(content.mChannel.name, MENU_TOAST);
  assert.deepEqual(content.mLaunchTargets, [new AppLaunchTarget('pkg://com.example.main', 'Open', 'not_used')]);
});

test('icon size sets the sized icon field like the SDK hook', () => {
  const url = 'https://example.com/a.png';
  const large = buildToastContent({...base, icon: {url, size: 'large'}});
  assert.equal(large.mIconUri, url);
  assert.equal(large.mLargeIconUri, url);
  const small = buildToastContent({...base, icon: {url, size: 'small'}});
  assert.equal(small.mSmallIconUri, url);
  const normal = buildToastContent({...base, icon: {url, size: 'normal'}});
  assert.equal('mSmallIconUri' in normal || 'mLargeIconUri' in normal, false);
});

test('launch target and kind match the SDK classes', () => {
  const visited: string[] = [];
  new AppLaunchTarget('pkg://a', 'Open', 'not_used').visit({visitApp: t => visited.push(t.appUri)});
  new ToastKind().visit({visitToast: k => visited.push(String(k.kindDescriptor))});
  // ToastKindDescriptor in NativeNotificationManager.d.ts is 5.
  assert.deepEqual(visited, ['pkg://a', '5']);
});

test('channel names match the SDK render templates', () => {
  // From RenderTemplate in @amazon-devices/react-native-kepler NativeNotificationManager.
  assert.equal(SIMPLE_TOAST, 'SimpleToastRenderTemplate');
  assert.equal(MENU_TOAST, 'MenuToastRenderTemplate');
});
