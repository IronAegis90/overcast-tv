import AsyncStorage from '@amazon-devices/react-native-async-storage__async-storage';
import React, {useCallback, useEffect, useState} from 'react';
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  ToastKeplerDuration,
  useToastKepler,
  View,
} from 'react-native';

import {
  isComplete,
  loadConfig,
  loadStatus,
  saveConfig,
  STATUS_STALE_MS,
  type OvercastConfig,
  type ServiceStatus,
} from './config.ts';
import {websocketUrl} from './haClient.ts';
import {SERVICE_ID} from './ids.ts';
import {DEFAULT_ICON_URL} from './toastContent.ts';

const STATUS_POLL_MS = 2_000;

/** Nothing on Vega starts a service by itself; the app starts it by URI. */
function startService(): void {
  Linking.openURL(`pkg://${SERVICE_ID}`).catch(err =>
    console.log(`overcast: starting the service failed: ${String(err)}`),
  );
}

function isValidUrl(input: string): boolean {
  try {
    websocketUrl(input);
    return true;
  } catch {
    return false;
  }
}

function statusText(config: OvercastConfig | null, status: ServiceStatus | null): string {
  if (!isComplete(config)) {
    return STATE_TEXT.unconfigured;
  }
  if (!status || Date.now() - status.at > STATUS_STALE_MS) {
    return 'Service not running. Reopen Overcast to start it.';
  }
  const text = STATE_TEXT[status.state] ?? status.state;
  return status.detail ? `${text} (${status.detail})` : text;
}

const STATE_TEXT: Record<string, string> = {
  starting: 'Starting…',
  unconfigured: 'Not set up',
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Disconnected, retrying',
  auth_failed: 'Home Assistant rejected the token',
  unsupported: 'Home Assistant is not ready for Overcast',
  stopped: 'Stopped',
};

export const App = () => {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [config, setConfig] = useState<OvercastConfig | null>(null);
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToastKepler();

  useEffect(() => {
    startService();
    loadConfig(AsyncStorage).then(saved => {
      setConfig(saved);
      if (saved) {
        setUrl(saved.url);
        setToken(saved.token);
        setName(saved.name);
      }
    });
    const poll = setInterval(() => {
      loadStatus(AsyncStorage).then(setStatus);
    }, STATUS_POLL_MS);
    return () => clearInterval(poll);
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      setConfig(await saveConfig(AsyncStorage, {url, token, name}));
      // The service picks the new settings up within a few seconds; starting
      // it again covers the case where it is not running.
      startService();
    } finally {
      setSaving(false);
    }
  }, [url, token, name]);

  // Posted from the UI with the documented hook: checks the privilege and the
  // renderer independently of the service and Home Assistant.
  const testToast = useCallback(() => {
    toast.show({
      title: 'Overcast',
      description: 'Notifications from Home Assistant will look like this.',
      iconUri: DEFAULT_ICON_URL,
      duration: ToastKeplerDuration.LONG,
    });
  }, [toast]);

  const urlValid = isValidUrl(url);
  const canSave = urlValid && !!token.trim() && !!name.trim() && !saving;

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>Overcast</Text>
      <Text style={styles.hint}>
        Shows Home Assistant notifications over whatever is playing. Install the Overcast
        integration in Home Assistant, then enter its address and a long-lived access token.
      </Text>

      <Field label="Home Assistant URL" value={url} onChangeText={setUrl}
        placeholder="https://example.ui.nabu.casa" keyboardType="url" focusFirst />
      {url.trim() && !urlValid ? (
        <Text style={styles.error}>The URL must start with http:// or https://</Text>
      ) : null}
      <Field label="Long-lived access token" value={token} onChangeText={setToken}
        placeholder="Profile → Security → Long-lived access tokens" secure />
      <Field label="TV name" value={name} onChangeText={setName} placeholder="Living Room TV" />

      <View style={styles.row}>
        <Button title={saving ? 'Saving…' : 'Save and connect'} onPress={save} disabled={!canSave} />
        <Button title="Show test toast" onPress={testToast} />
      </View>

      <View style={styles.status}>
        <Text style={styles.statusText}>
          Status: {statusText(config, status)}
        </Text>
        {status?.lastNotification ? (
          <Text style={styles.hint}>
            Last notification: “{status.lastNotification.title}”, {status.lastNotification.status}
          </Text>
        ) : null}
        {config ? <Text style={styles.hint}>Device id: {config.deviceId}</Text> : null}
      </View>
    </View>
  );
};

const Field = (props: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: 'url';
  secure?: boolean;
  focusFirst?: boolean;
}) => {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        style={[styles.input, focused && styles.focused]}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor="#7a8494"
        keyboardType={props.keyboardType}
        secureTextEntry={props.secure}
        autoCapitalize="none"
        autoCorrect={false}
        hasTVPreferredFocus={props.focusFirst}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </View>
  );
};

const Button = (props: {title: string; onPress: () => void; disabled?: boolean}) => {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      style={[styles.button, focused && styles.focused, props.disabled && styles.disabled]}
      onPress={props.onPress}
      disabled={props.disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}>
      <Text style={styles.buttonText}>{props.title}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: '#101820', paddingHorizontal: 120, paddingVertical: 72},
  heading: {color: '#ffffff', fontSize: 56, fontWeight: '700', marginBottom: 12},
  hint: {color: '#aab4c3', fontSize: 24, marginBottom: 24, maxWidth: 1400},
  field: {marginBottom: 20},
  label: {color: '#ffffff', fontSize: 26, marginBottom: 8},
  input: {
    backgroundColor: '#1d2733',
    color: '#ffffff',
    fontSize: 28,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: 'transparent',
    maxWidth: 1400,
  },
  row: {flexDirection: 'row', marginTop: 12, marginBottom: 32},
  button: {
    backgroundColor: '#03a9f4',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: 'transparent',
    marginRight: 24,
  },
  buttonText: {color: '#ffffff', fontSize: 28, fontWeight: '600'},
  focused: {borderColor: '#ffffff'},
  disabled: {opacity: 0.4},
  status: {borderTopWidth: 1, borderTopColor: '#2c3846', paddingTop: 24},
  statusText: {color: '#ffffff', fontSize: 30, marginBottom: 8},
  error: {color: '#ff8a80', fontSize: 24, marginTop: -12, marginBottom: 20},
});
