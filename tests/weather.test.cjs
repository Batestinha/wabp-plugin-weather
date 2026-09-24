const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const fs = require('node:fs');
const crypto = require('node:crypto');
const plugin = require('../dist/index.js').default;
const { parseWeatherRequest } = require('../dist/commands.js');
const { weatherQueryInputSchema, weatherQueryOutputSchema } = require('../dist/serviceApi.js');
const { isAssistantCancellation } = require('@wabs/plugin-sdk/cancellation');
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

function store() {
  const values = new Map();
  return { get: async key => values.get(key), set: async (key, value) => { values.set(key, value); } };
}
function method(config = {}, services) {
  return plugin.registerServices({
    pluginId: plugin.manifest.pluginId, manifest: plugin.manifest,
    configFor: async () => config, enabledFor: async () => true,
    ephemeralStore: store(), services
  })[0].methods[0];
}
const call = { scopeId: 'fixture-scope', actorIdentityId: 'fixture-identity', groupId: 'fixture-group', groupWid: 'fixture@g.us' };

test('parses location names and rejects invalid forecast ranges', () => {
  assert.deepEqual(parseWeatherRequest('"São Pedro de Sintra" 0-5'), { ok: true, location: 'São Pedro de Sintra', selection: { startDay: 0, endDay: 5 } });
  assert.deepEqual(parseWeatherRequest('Cascais 2-1'), { ok: false, reason: 'invalid_selection' });
  assert.deepEqual(parseWeatherRequest('Cascais 16'), { ok: false, reason: 'invalid_selection' });
  assert.deepEqual(parseWeatherRequest(''), { ok: false, reason: 'missing_location' });
});

test('preserves customized units, metrics, endpoints and disabled state', async () => {
  const settings = { enabled: false, cacheTtlSeconds: 120,
    units: { temperatureUnit: 'fahrenheit', windSpeedUnit: 'mph', precipitationUnit: 'inch' },
    metrics: { wave: true, temperature: false },
    providerSettings: {
      openMeteo: { forecastBaseUrl: 'https://weather.example.invalid/forecast', marineBaseUrl: 'https://weather.example.invalid/marine' },
      tides: { institutoHidrograficoBaseUrl: 'https://ih.example.invalid/', fculBaseUrl: 'https://fcul.example.invalid/' }
    }
  };
  const resolved = plugin.manifest.configSchema.parse(settings);
  assert.equal(resolved.enabled, false);
  assert.deepEqual(resolved.units, settings.units);
  assert.equal(resolved.metrics.temperature, false);
  assert.equal(resolved.metrics.wave, true);
  assert.deepEqual(resolved.providerSettings, settings.providerSettings);
  global.fetch = async () => { throw new Error('Unexpected HTTP for disabled plugin'); };
  await assert.rejects(method(settings).handler({ location: 'Lisbon' }, call), /disabled for this scope/);
});

test('uses the geocoder service with the caller scope and normalizes mocked provider data', async () => {
  const serviceCalls = [];
  const requests = [];
  const abort = new AbortController();
  const services = { call: async input => {
    serviceCalls.push(input);
    return { results: [{ label: 'Lisbon, Portugal', point: { latitude: 38.72, longitude: -9.14 }, timezone: 'Europe/Lisbon' }] };
  } };
  global.fetch = async (url, options) => {
    requests.push({ url: new URL(url), options });
    return { ok: true, json: async () => ({ current: { time: '2026-09-12T12:00', temperature_2m: 77 }, current_units: { temperature_2m: '°F' } }) };
  };
  const operation = method({ units: { temperatureUnit: 'fahrenheit' } }, services);
  const input = weatherQueryInputSchema.parse({ location: 'Lisbon', language: 'pt-PT', includeMarine: false });
  const output = await operation.handler(input, { ...call, signal: abort.signal });
  assert.equal(weatherQueryOutputSchema.safeParse(output).success, true);
  assert.equal(output.report.current.temperature2m.value, 77);
  assert.equal(serviceCalls[0].serviceId, 'official.geocoder.v1');
  for (const key of ['scopeId', 'actorIdentityId', 'groupId', 'groupWid']) assert.equal(serviceCalls[0][key], call[key]);
  assert.equal(serviceCalls[0].signal, abort.signal);
  assert.equal(requests[0].options.signal, abort.signal);
  assert.equal(requests[0].url.searchParams.get('temperature_unit'), 'fahrenheit');
  assert.equal(requests[0].url.searchParams.get('latitude'), '38.72');
  assert.equal(requests[0].url.searchParams.get('longitude'), '-9.14');
  assert.equal(plugin.lifecycle, undefined);
});

test('registers a guarded read-only command and cancels assistant work before a service call', async () => {
  const registrations = [];
  const context = { router: { register: (...args) => registrations.push(args) },
    i18n: { translator: () => key => plugin.manifest.defaultMessages[key] ?? key },
    services: { call: async () => { throw new Error('Unexpected service invocation after cancellation'); } }
  };
  await plugin.registerCommands(context);
  assert.equal(registrations[0][0], 'weather');
  assert.equal(registrations[0][2].requiredAccessPlane, 'group_member');
  assert.equal(registrations[0][2].mutation, 'none');
  const tool = plugin.registerAssistantTools(context)[0];
  assert.equal(tool.descriptor.approval, 'never');
  assert.equal(tool.inputSchema.safeParse({ location: 'Lisbon', endDay: 2 }).success, false);
  const abort = new AbortController();
  abort.abort('Stopped');
  await assert.rejects(tool.run({ signal: abort.signal }, { location: 'Lisbon' }), isAssistantCancellation);
});

test('ships complete Portuguese catalogs, matching controls and immutable upstream contract bytes', () => {
  const metadata = JSON.parse(fs.readFileSync('wa-plugin.json'));
  const pt = JSON.parse(fs.readFileSync('locales/pt-PT/official.weather.json'));
  for (const key of Object.keys(plugin.manifest.defaultMessages)) assert.ok(pt[key]?.trim(), key);
  assert.equal(metadata.operatorConsole.controls.length, 20);
  assert.equal(metadata.pluginId, plugin.manifest.pluginId);
  const contracts = JSON.parse(fs.readFileSync('contracts/provenance.json'));
  for (const item of contracts.contracts) {
    assert.deepEqual(item.patches, []);
    for (const base of ['src/contracts', 'contracts']) {
      const actual = crypto.createHash('sha256').update(fs.readFileSync(base + '/' + item.vendoredPath)).digest('hex');
      assert.equal(actual, item.upstreamSha256);
    }
  }
});


test('uses FCUL Cascais tides for the Sintra event location without an Open-Meteo tide request', async () => {
  const { portugalTides } = require('../dist/tides.js');
  const { parseWeatherConfig } = require('../dist/config.js');
  const urls = [];
  global.fetch = async url => {
    urls.push(String(url));
    if (!String(url).includes('CascaisFCUL2026.TXT')) {
      return { ok: false, text: async () => '' };
    }
    return { ok: true, text: async () =>
      '  Data       Hora   Alt    Maré\n2026-09-26   1:10  3.45  Preia-Mar\n2026-09-26   7:20  0.83  Baixa-Mar\n'
    };
  };
  const result = await portugalTides({
    config: parseWeatherConfig({}),
    location: { label: 'Cascais/Sintra (Por decidir)', latitude: 38.79846, longitude: -9.3881, timezone: 'Europe/Lisbon' },
    forecastDays: 3
  });
  assert.equal(result.context.forecastSource, 'fcul');
  assert.equal(result.context.station.name, 'Cascais');
  assert.equal(result.context.datum, 'zh-portugal');
  assert.deepEqual(result.eventsByDate.get('2026-09-26').map(event => event.height.value), [3.45, 0.83]);
  assert.equal(urls.some(url => url.includes('open-meteo')), false);
});

test('anchors an Open-Meteo fallback to a fresh nearby IH observation at the same station and time', async () => {
  const { portugalTides } = require('../dist/tides.js');
  const { parseWeatherConfig } = require('../dist/config.js');
  const now = Math.floor(Date.now() / 900_000) * 900_000;
  const sampleTimes = [-2, -1, 0, 1, 2].map(step => new Date(now + step * 900_000).toISOString().slice(0, 16));
  const urls = [];
  global.fetch = async url => {
    const value = String(url);
    urls.push(value);
    if (value.includes('instances/l1/locations')) return { ok: true, json: async () => ({ features: [{
      id: '152-303', geometry: { coordinates: [-9.16325, 38.700194] },
      properties: { title: 'Lisboa - Alcântara', last_date_time: new Date(now).toISOString(), last_sea_surface_height: 2 }
    }] }) };
    if (value.includes('/marine')) return { ok: true, json: async () => ({
      latitude: 38.700194, longitude: -9.16325,
      minutely_15: { time: sampleTimes, sea_level_height_msl: [0, 0.5, 1, 0.5, 0] }
    }) };
    return { ok: false, text: async () => '' };
  };
  const result = await portugalTides({
    config: parseWeatherConfig({}),
    location: { label: 'Cascais/Sintra', latitude: 38.79846, longitude: -9.3881, timezone: 'Europe/Lisbon' },
    forecastDays: 3
  });
  assert.equal(result.context.quality, 'crude-current-anchor');
  assert.equal(result.context.station.id, '152-303');
  assert.equal(result.context.adjustment.offset.value, 1);
  assert.equal(result.context.adjustment.openMeteoHeight.value, 1);
  assert.equal(result.context.adjustment.ihHeight.value, 2);
  assert.ok(result.eventsByDate.size > 0);
  assert.ok(urls.some(url => url.includes('latitude=38.700194') && url.includes('longitude=-9.16325')));
});

test('leaves an Open-Meteo fallback uncorrected when nearby IH readings are stale', async () => {
  const { portugalTides } = require('../dist/tides.js');
  const { parseWeatherConfig } = require('../dist/config.js');
  const now = Math.floor(Date.now() / 900_000) * 900_000;
  global.fetch = async url => {
    const value = String(url);
    if (value.includes('instances/l1/locations')) return { ok: true, json: async () => ({ features: [{
      id: '152-303', geometry: { coordinates: [-9.16325, 38.700194] },
      properties: { title: 'Lisboa - Alcântara', last_date_time: new Date(now - 86_400_000).toISOString(), last_sea_surface_height: 2 }
    }] }) };
    if (value.includes('/marine')) return { ok: true, json: async () => ({
      latitude: 38.79846, longitude: -9.3881,
      minutely_15: { time: [-1, 0, 1].map(step => new Date(now + step * 900_000).toISOString().slice(0, 16)), sea_level_height_msl: [0, 1, 0] }
    }) };
    return { ok: false, text: async () => '' };
  };
  const result = await portugalTides({
    config: parseWeatherConfig({}),
    location: { label: 'Cascais/Sintra', latitude: 38.79846, longitude: -9.3881, timezone: 'Europe/Lisbon' },
    forecastDays: 3
  });
  assert.equal(result.context.quality, 'modelled');
  assert.equal(result.context.adjustment, undefined);
  assert.equal(result.context.station, undefined);
});
