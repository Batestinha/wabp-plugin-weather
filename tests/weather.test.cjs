const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const fs = require('node:fs');
const crypto = require('node:crypto');
const plugin = require('../dist/index.js').default;
const { parseWeatherRequest } = require('../dist/commands.js');
const { portugalTides } = require('../dist/tides.js');
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
  assert.equal(output.report.location.timezone, 'Europe/Lisbon');
  assert.equal(serviceCalls[0].serviceId, 'official.geocoder.v1');
  for (const key of ['scopeId', 'actorIdentityId', 'groupId', 'groupWid']) assert.equal(serviceCalls[0][key], call[key]);
  assert.equal(serviceCalls[0].signal, abort.signal);
  assert.equal(requests[0].options.signal, abort.signal);
  assert.equal(requests[0].url.searchParams.get('temperature_unit'), 'fahrenheit');
  assert.equal(requests[0].url.searchParams.get('latitude'), '38.72');
  assert.equal(requests[0].url.searchParams.get('longitude'), '-9.14');
  assert.equal(requests[0].url.searchParams.get('timezone'), 'Europe/Lisbon');
  assert.equal(plugin.lifecycle, undefined);
});

test('includes tides for named locations and tolerates auto timezone service inputs', async () => {
  const year = new Date().getUTCFullYear();
  const forecastDate = `${year}-09-23`;
  const requests = [];
  const services = { call: async () => ({
    results: [{
      label: 'Sesimbra, Setúbal, Portugal',
      point: { latitude: 38.4436932, longitude: -9.0996273 },
      timezone: 'Europe/Lisbon'
    }]
  }) };
  global.fetch = async input => {
    const url = new URL(input);
    requests.push(url);
    if (url.hostname === 'api.open-meteo.com') {
      return {
        ok: true,
        json: async () => ({
          daily: {
            time: [`${year}-09-21`, `${year}-09-22`, forecastDate],
            weather_code: [0, 1, 2]
          },
          daily_units: {}
        })
      };
    }
    if (url.hostname === 'marine-api.open-meteo.com') {
      return {
        ok: true,
        json: async () => ({
          latitude: 38.4,
          longitude: -9.1,
          minutely_15: {
            time: [`${year}-09-22T23:45`, `${forecastDate}T00:00`, `${forecastDate}T00:15`],
            sea_level_height_msl: [1, 2, 1]
          }
        })
      };
    }
    if (url.hostname === 'webpages.ciencias.ulisboa.pt') {
      return {
        ok: true,
        text: async () => url.pathname.endsWith(`Sesimbra${year}.TXT`)
          ? `${forecastDate} 05:38 1.63 Baixa-Mar\n${forecastDate} 11:48 2.98 Preia-Mar\n`
          : ''
      };
    }
    if (url.hostname === 'ogcapi.hidrografico.pt') {
      return { ok: false };
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const config = { cacheTtlSeconds: 0, metrics: { tide: true } };
  const output = await method(config, services).handler({
    location: 'Sesimbra',
    selection: { startDay: 2, endDay: 2 },
    includeMarine: 'auto'
  }, call);

  assert.equal(weatherQueryOutputSchema.safeParse(output).success, true);
  assert.equal(output.report.location.timezone, 'Europe/Lisbon');
  assert.equal(output.report.tideContext.forecastSource, 'fcul');
  assert.deepEqual(output.report.days[0].marine.unavailable, []);
  assert.equal(output.report.days[0].marine.tideEvents.length, 2);
  assert.equal(
    requests.find(url => url.hostname === 'api.open-meteo.com').searchParams.get('timezone'),
    'Europe/Lisbon'
  );

  const direct = await portugalTides({
    config: plugin.manifest.configSchema.parse(config),
    location: {
      label: 'Sesimbra, Setúbal, Portugal',
      latitude: 38.4436932,
      longitude: -9.0996273,
      timezone: 'auto'
    },
    forecastDays: 3
  });
  assert.equal(direct.eventsByDate.get(forecastDate).length, 2);
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
