const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const plugin = require('../dist/index.js').default;
const { portugalTides } = require('../dist/tides.js');
const { presentWeather } = require('../dist/presentation.js');
const portuguese = require('../locales/pt-PT/official.weather.json');

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
const config = plugin.manifest.configSchema.parse({});
const locations = [
  ['Cascais', 38.6944444, -9.4180556, 'CascaisFCUL'],
  ['Lisboa', 38.700194, -9.16325, 'LisboaFCUL'],
  ['Sesimbra', 38.4397973, -9.1103589, 'Sesimbra'],
  ['Setúbal', 38.4944358, -8.9007503, 'SetubalFCUL'],
  ['Sagres', 37.006, -8.943, 'SagresFCUL'],
  ['Lagos', 37.0986111, -8.6666667, 'LagosFCUL'],
  ['Albufeira', 37.087, -8.251, 'AlbufeiraFCUL'],
  ['Faro', 36.9778027, -7.8663946, 'FaroFCUL']
];
const location = (latitude = 38.4397973, longitude = -9.1103589) => ({
  label: 'Test port', latitude, longitude, timezone: 'Europe/Lisbon'
});
const response = (body, ok = true) => ({ ok, json: async () => body, text: async () => String(body) });
const iso = (offset = -60) => new Date(Date.now() + offset * 1000).toISOString();
const catalogue = (items) => ({ features: items.map(([id, time, height, category]) => ({
  id, properties: { last_date_time: time, last_sea_surface_height: height, category }
})) });
const marine = () => {
  const start = Math.floor(Date.now() / 900000) * 900000 - 3600000;
  return { latitude: 38.44, longitude: -9.11, minutely_15: {
    time: Array.from({ length: 16 }, (_, index) => new Date(start + index * 900000).toISOString().slice(0, 16)),
    sea_level_height_msl: Array(16).fill(0.5)
  } };
};
function mockProviders({ metadata, fcul = true, series = false } = {}) {
  const requests = [];
  global.fetch = async (input, options) => {
    const url = new URL(input); requests.push({ url, options });
    if (url.hostname === 'ogcapi.hidrografico.pt') {
      if (url.pathname.endsWith('/locations')) return response(metadata ?? catalogue([]));
      if (series) return response({ coverages: [{ domain: { axes: { t: { values: [iso()] } } }, ranges: { sea_surface_height: { values: [2.5] } } }] });
      return response({}, false);
    }
    if (url.hostname === 'webpages.ciencias.ulisboa.pt') {
      if (!fcul) return response('', false);
      const year = new Date().getUTCFullYear();
      const start = Math.floor(Date.now() / (6 * 3600000)) * (6 * 3600000) - 6 * 3600000;
      const table = Array.from({ length: 4 }, (_, index) => {
        const at = new Date(start + index * 6 * 3600000).toISOString();
        return `${at.slice(0, 10)} ${at.slice(11, 16)} ${index % 2 ? '0.46 Baixa-Mar' : '2.76 Preia-Mar'}`;
      }).join('\n');
      return response(url.pathname.endsWith(`${year}.TXT`) ? table : '');
    }
    if (url.hostname === 'marine-api.open-meteo.com') return response(marine());
    throw new Error(`Unexpected ${url}`);
  };
  return requests;
}
async function tides(at = location()) { return portugalTides({ config, location: at, forecastDays: 2 }); }

test('fresh newest IH gauge wins; category 1 wins tied timestamps', async () => {
  const requests = mockProviders({ metadata: catalogue([
    ['28-297', iso(-120), 2.4, '1'], ['156-279', iso(-60), 2.5, '2']
  ]) });
  assert.equal((await tides()).context.observation.height.value, 2.5);
  assert.equal((await tides()).context.station.id, '156-279');
  assert.equal(requests.filter(({ url }) => url.hostname === 'ogcapi.hidrografico.pt').every(({ url, options }) =>
    url.pathname.includes('/instances/l1/locations') && options.cache === 'no-store'), true);
  mockProviders({ metadata: catalogue([
    ['28-297', iso(-60), 2.4, '1'], ['156-279', iso(-60), 2.5, '2']
  ]) });
  assert.equal((await tides()).context.station.id, '28-297');
});

test('stale, future and malformed metadata never anchor or claim live IH', async () => {
  for (const time of [iso(-960), iso(60), 'invalid']) {
    mockProviders({ metadata: catalogue([['28-297', time, 2.5, '1']]), fcul: false });
    const result = await tides();
    assert.equal(result.context.datum, 'mean-sea-level');
    assert.equal(result.context.observation, undefined);
    assert.equal(result.context.adjustment, undefined);
  }
});

test('missing catalogue metadata uses explicit L1 series', async () => {
  const requests = mockProviders({ metadata: catalogue([]), series: true });
  const result = await tides();
  assert.equal(result.context.observation.height.value, 2.5);
  assert.ok(requests.some(({ url }) => url.pathname.endsWith('/instances/l1/locations/28-297')));
});

test('forecast-only ports use FCUL identifiers and no IH request', async () => {
  for (const [name, latitude, longitude, stem] of locations) {
    const requests = mockProviders();
    const result = await tides(location(latitude, longitude));
    assert.equal(result.context.forecastSource, 'fcul', name);
    assert.equal(result.context.current?.estimated, true, name);
    assert.ok(requests.some(({ url }) => url.pathname.endsWith(`${stem}${new Date().getUTCFullYear()}.TXT`)), name);
    assert.equal(requests.some(({ url }) => url.hostname === 'marine-api.open-meteo.com'), false, name);
    if (name === 'Cascais' || name === 'Sagres' || name === 'Lagos' || name === 'Albufeira') {
      assert.equal(result.context.station.id, `fcul:${stem.replace(/FCUL$/, '').toLowerCase()}`);
      assert.equal(requests.some(({ url }) => url.hostname === 'ogcapi.hidrografico.pt'), false);
    }
  }
});

test('English and Portuguese tide notes name the FCUL station, the crude IH anchor or the mean-sea-level model', () => {
  const report = (tideContext) => ({ kind: 'forecast', selection: { startDay: 0, endDay: 0 }, report: {
    location: { label: 'Sesimbra' }, tideContext,
    days: [{ date: '2026-09-24', marine: { requested: ['tide'], unavailable: [], tideEvents: [
      { type: 'high', time: '2026-09-24T05:00', height: { value: 2.5, unit: 'm' } }
    ] } }]
  } });
  const english = plugin.manifest.defaultMessages;
  const translate = (messages) => (key, values) => (messages[key] ?? english[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => values?.[name] ?? '');
  for (const [locale, messages, expectedFcul, expectedCrude, expectedMsl] of [
    ['en-GB', english, 'calibrated FCUL forecast for Sesimbra, Portuguese chart datum', 'anchored to the IH gauge at Sesimbra', 'relative to mean sea level'],
    ['pt-PT', portuguese, 'previsão FCUL calibrada para Sesimbra, zero hidrográfico', 'ancorada no marégrafo do IH em Sesimbra', 'relativas ao nível médio do mar']
  ]) {
    const note = (tideContext) => presentWeather(report(tideContext), { t: translate(messages), locale, style: 'emoji' }).footnote;
    const fcul = { forecastSource: 'fcul', datum: 'zh-portugal', quality: 'calibrated-prediction', station: { id: 'x', name: 'Sesimbra', distanceKm: 1 } };
    assert.ok(note(fcul).includes(expectedFcul));
    assert.equal(note({ ...fcul, observation: { time: iso(), height: { value: 2.5, unit: 'm' } } }), note(fcul));
    assert.ok(note({ ...fcul, forecastSource: 'open-meteo', quality: 'crude-current-anchor', datum: 'ih-anchored-approximate-zh',
      adjustment: { offset: { value: 2, unit: 'm' } } }).includes(expectedCrude));
    assert.ok(note({ forecastSource: 'open-meteo', datum: 'mean-sea-level', quality: 'modelled' }).includes(expectedMsl));
  }
});
