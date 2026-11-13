const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const plugin = require('../dist/index.js').default;
const { presentWeather } = require('../dist/presentation.js');
const { bundledTranslator } = require('../dist/bundledMessages.js');
const { weatherPresentOutputSchema } = require('../dist/serviceApi.js');
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

const m = (value, unit) => ({ value, unit });
function day(date, code, values, tides) {
  return {
    date,
    weatherCode: code,
    temperatureMin: m(values.tmin, '°C'), temperatureMax: m(values.tmax, '°C'),
    relativeHumidityMin: m(values.hmin, '%'), relativeHumidityMax: m(values.hmax, '%'),
    precipitationProbabilityMax: m(values.prob, '%'), precipitationSum: m(values.sum, 'mm'),
    windSpeedMax: m(values.wind, 'km/h'), windDirectionDominant: m(values.dir, '°'), windGustsMax: m(values.gust, 'km/h'),
    marine: {
      requested: ['tide'],
      unavailable: [],
      tideEvents: tides.map(([type, time, height]) => ({ type, time: `${date}T${time}`, height: m(height, 'm') }))
    }
  };
}
const sesimbra = {
  provider: 'open-meteo',
  fetchedAt: '2026-11-11T22:45:00.000Z',
  location: { label: 'Sesimbra, Setúbal, Portugal', latitude: 38.44, longitude: -9.1, timezone: 'Europe/Lisbon' },
  units: { temperatureUnit: 'celsius', windSpeedUnit: 'kmh', precipitationUnit: 'mm' },
  tideContext: {
    forecastSource: 'fcul', datum: 'zh-portugal', quality: 'calibrated-prediction',
    station: { id: '28-297', name: 'Sesimbra', distanceKm: 0.6 }
  },
  days: [
    day('2026-11-14', 95, { tmin: 16, tmax: 17.9, hmin: 72, hmax: 96, prob: 80, sum: 19.7, wind: 24.5, dir: 141, gust: 47.2 },
      [['high', '04:54', 2.84], ['low', '11:09', 1.14], ['high', '17:22', 2.53], ['low', '23:11', 1.28]]),
    day('2026-11-15', 3, { tmin: 15.7, tmax: 19, hmin: 63, hmax: 88, prob: 38, sum: 1.2, wind: 14.8, dir: 300, gust: 28.8 },
      [['high', '05:39', 2.71], ['low', '11:57', 1.27], ['high', '18:14', 2.42]])
  ]
};
const forecast = { kind: 'forecast', selection: { startDay: 2, endDay: 3 }, report: sesimbra };
const pt = { t: bundledTranslator('pt-PT'), locale: 'pt-PT' };

test('renders a forecast day by day with emoji, rounded values, compass points and one tide note', () => {
  const presentation = presentWeather(forecast, { ...pt, style: 'emoji' });
  assert.equal(presentation.text, [
    '*Sesimbra, Setúbal, Portugal* · previsão',
    '',
    '*sáb, 14 nov*',
    '⛈️ Trovoada',
    '🌡️ 16–18 °C · 💧 72–96 %',
    '☔ 80 % · 19,7 mm',
    '💨 25 km/h de SE · rajadas 47 km/h',
    '🌊 ⬆️ 04h54 2,8 m · ⬇️ 11h09 1,1 m',
    '🌊 ⬆️ 17h22 2,5 m · ⬇️ 23h11 1,3 m',
    '',
    '*dom, 15 nov*',
    '☁️ Encoberto',
    '🌡️ 16–19 °C · 💧 63–88 %',
    '☔ 38 % · 1,2 mm',
    '💨 15 km/h de NO · rajadas 29 km/h',
    '🌊 ⬆️ 05h39 2,7 m · ⬇️ 11h57 1,3 m',
    '🌊 ⬆️ 18h14 2,4 m',
    '',
    '_Marés: previsão FCUL calibrada para Sesimbra, zero hidrográfico._'
  ].join('\n'));
  assert.deepEqual(presentation.days[0].condition, { code: 95, text: 'Trovoada', emoji: '⛈️' });
  assert.equal(presentation.days[0].label, 'sáb, 14 nov');
  const wholeMetre = structuredClone(forecast);
  wholeMetre.report.days[0].marine.tideEvents[0].height.value = 2.98;
  assert.match(presentWeather(wholeMetre, { ...pt, style: 'emoji' }).days[0].marineText, /^🌊 ⬆️ 04h54 3,0 m · /);
  assert.equal(presentation.days[0].text, `${presentation.days[0].weatherText}\n${presentation.days[0].marineText}`);
});

test('plain style swaps emoji for labels, and English uses its own date, time and compass wording', () => {
  const plain = presentWeather(forecast, { ...pt, style: 'plain' }).days[0];
  assert.equal(plain.weatherText, [
    'Trovoada',
    'Temperatura: 16–18 °C · Humidade: 72–96 %',
    'Chuva: 80 % · 19,7 mm',
    'Vento: 25 km/h de SE · rajadas 47 km/h'
  ].join('\n'));
  assert.equal(plain.marineText, 'Marés: cheia 04h54 2,8 m · baixa 11h09 1,1 m\nMarés: cheia 17h22 2,5 m · baixa 23h11 1,3 m');
  const english = presentWeather(forecast, { t: bundledTranslator('en'), locale: 'en', style: 'emoji' });
  assert.equal(english.days[1].label, 'Sun 15 Nov');
  assert.match(english.days[1].weatherText, /💨 15 km\/h from NW · gusts 29 km\/h/);
  assert.match(english.days[0].marineText, /^🌊 ⬆️ 04:54 2\.8 m · ⬇️ 11:09 1\.1 m$/m);
});

test('current conditions use a night icon, feels-like, today\'s tides and the tide datum note', () => {
  const current = {
    kind: 'current',
    report: {
      ...sesimbra, tideContext: undefined, days: undefined,
      current: {
        time: '2026-11-12T22:45', temperature2m: m(14.6, '°C'), apparentTemperature: m(12.8, '°C'),
        relativeHumidity2m: m(81, '%'), precipitation: m(0, 'mm'), weatherCode: 1, isDay: false,
        windSpeed10m: m(17.6, 'km/h'), windDirection10m: m(315, '°'), windGusts10m: m(35.3, 'km/h')
      }
    }
  };
  delete current.report.days;
  delete current.report.tideContext;
  const todayMarine = {
    ...sesimbra,
    tideContext: { forecastSource: 'open-meteo', datum: 'mean-sea-level', quality: 'modelled' },
    days: [{ date: '2026-11-12', marine: { requested: ['tide'], unavailable: [], tideEvents: [
      { type: 'low', time: '2026-11-12T10:45', height: m(-1.08, 'm') }
    ] } }]
  };
  assert.equal(presentWeather(current, { ...pt, style: 'emoji' }, todayMarine).text, [
    '*Sesimbra, Setúbal, Portugal* · agora',
    '🌙 Pouco nublado',
    '🌡️ 15 °C (sensação 13 °C) · 💧 81 %',
    '☔ 0 mm',
    '💨 18 km/h de NO · rajadas 35 km/h',
    '🌊 ⬇️ 10h45 -1,1 m',
    '',
    '_Atualizado às 22h45_',
    '_Marés: estimativa do modelo Open-Meteo; alturas relativas ao nível médio do mar._'
  ].join('\n'));
});

test('unavailable marine values get one short line and no tide note', () => {
  const report = { ...sesimbra, days: [{ date: '2026-11-14', weatherCode: 0, marine: { requested: ['tide'], unavailable: ['tide'], tideEvents: [] } }] };
  const presentation = presentWeather({ kind: 'forecast', selection: { startDay: 0, endDay: 0 }, report }, { ...pt, style: 'emoji' });
  assert.equal(presentation.days[0].text, '☀️ Céu limpo\n🌊 Marés: sem dados para este local ou data');
  assert.equal(presentation.footnote, undefined);
});

function presentMethod(config, extraContext = {}) {
  const methods = plugin.registerServices({
    pluginId: plugin.manifest.pluginId, manifest: plugin.manifest,
    configFor: async () => config, enabledFor: async () => true,
    ephemeralStore: { get: async () => undefined, set: async () => {} },
    ...extraContext
  })[0].methods;
  return methods.find(method => method.name === 'present');
}

function mockSesimbraFetch(forecastDate) {
  global.fetch = async input => {
    const url = new URL(input);
    if (url.hostname === 'api.open-meteo.com') {
      return { ok: true, json: async () => ({
        daily: { time: [forecastDate], weather_code: [61], temperature_2m_max: [19.4], temperature_2m_min: [14.2] },
        daily_units: { temperature_2m_max: '°C', temperature_2m_min: '°C' }
      }) };
    }
    if (url.hostname === 'webpages.ciencias.ulisboa.pt') {
      return { ok: true, text: async () => url.pathname.endsWith(`Sesimbra${forecastDate.slice(0, 4)}.TXT`)
        ? `${forecastDate} 05:38 1.63 Baixa-Mar\n${forecastDate} 11:48 2.98 Preia-Mar\n`
        : '' };
    }
    if (url.hostname === 'ogcapi.hidrografico.pt') return { ok: false };
    throw new Error(`Unexpected request: ${url}`);
  };
}

test('the present service method returns the query data with the shared text, in the configured style', async () => {
  const forecastDate = new Date().toISOString().slice(0, 10);
  mockSesimbraFetch(forecastDate);
  const location = { label: 'Sesimbra', latitude: 38.4436932, longitude: -9.0996273, timezone: 'Europe/Lisbon' };
  const call = { scopeId: 'fixture-scope', actorIdentityId: 'fixture-identity' };
  const translations = [];
  const i18n = {
    resolveScopeLocale: async scopeId => ({ locale: 'pt-PT', languagePackScopes: [`scope:${scopeId}`] }),
    translator: (locale, scopes) => { translations.push({ locale, scopes }); return bundledTranslator(locale); }
  };
  const input = { location, selection: { startDay: 0, endDay: 0 }, includeMarine: 'auto' };
  const result = await presentMethod({ cacheTtlSeconds: 0, metrics: { tide: true } }, { i18n }).handler(input, call);
  assert.equal(weatherPresentOutputSchema.safeParse(result).success, true);
  assert.equal(result.output.kind, 'forecast');
  assert.deepEqual(translations, [{ locale: 'pt-PT', scopes: ['scope:fixture-scope'] }]);
  assert.equal(result.presentation.days[0].text, '🌧️ Chuva\n🌡️ 14–19 °C\n🌊 ⬇️ 05h38 1,4 m · ⬆️ 11h48 2,7 m');
  assert.match(result.presentation.footnote, /previsão FCUL calibrada para Sesimbra/);

  const plain = await presentMethod({ cacheTtlSeconds: 0, metrics: { tide: true }, presentation: { style: 'plain' } })
    .handler({ ...input, language: 'en' }, call);
  assert.equal(plain.presentation.style, 'plain');
  assert.equal(plain.presentation.days[0].text, 'Rain\nTemperature: 14–19 °C\nTides: low 05:38 1.4 m · high 11:48 2.7 m');
});

test('/weather and the assistant send the present method text', async () => {
  const calls = [];
  const registrations = [];
  const context = {
    router: { register: (...args) => registrations.push(args) },
    i18n: { translator: () => key => plugin.manifest.defaultMessages[key] ?? key },
    services: { call: async input => { calls.push(input); return { presentation: { text: 'shared text' } }; } }
  };
  const identityAddress = { identityId: 'fixture-identity', canonicalWid: '351000000000@s.whatsapp.net' };
  await plugin.registerCommands(context);
  const reply = await registrations[0][3]({
    command: { rawArgs: 'Sesimbra 1-2' }, locale: 'pt-PT', t: key => key,
    scopeId: 'fixture-scope', groupId: 'fixture-group', actor: { identityAddress }
  });
  assert.equal(reply.text, 'shared text');
  const tool = plugin.registerAssistantTools(context)[0];
  const result = await tool.run({
    scopeId: 'fixture-scope', context: { responseLocale: { locale: 'pt-PT' } }, actor: { identityAddress }
  }, { location: 'Sesimbra', startDay: 1, endDay: 2 });
  assert.deepEqual(result.content, { ok: true, text: 'shared text' });
  assert.equal(calls.length, 2);
  for (const item of calls) {
    assert.equal(item.serviceId, 'official.weather.v2');
    assert.equal(item.method, 'present');
    assert.equal(item.scopeId, 'fixture-scope');
    assert.equal(item.actorIdentityId, 'fixture-identity');
    assert.deepEqual(item.input, { location: 'Sesimbra', selection: { startDay: 1, endDay: 2 }, includeMarine: 'auto', language: 'pt-PT' });
  }
});

test('an ambiguous place name uses the best guess and names the other places under the title', async () => {
  const forecastDate = new Date().toISOString().slice(0, 10);
  mockSesimbraFetch(forecastDate);
  const lagos = { label: 'Lagos, Faro, Portugal', point: { latitude: 37.1028, longitude: -8.673 }, timezone: 'Europe/Lisbon',
    address: {}, attribution: { text: 'fixture', url: 'https://example.test' } };
  const calls = [];
  const services = { call: async input => {
    calls.push(input);
    return { status: 'ambiguous', query: 'Lagos', searchQuery: 'Lagos', remembered: false, provider: 'fixture', fetchedAt: new Date().toISOString(),
      candidates: [{ place: lagos, shortLabel: 'Lagos, Faro, Portugal', remembered: false, nameMatch: true }],
      presentation: { optionLines: ['1. Lagos, Faro, Portugal'], alternatives: 'Também encontrei: Lagos, Lagos State, Nigeria. Indica a região ou o país para escolher outro.' } };
  } };
  const result = await presentMethod({ cacheTtlSeconds: 0, metrics: { tide: false } }, { services })
    .handler({ location: 'Lagos', selection: { startDay: 0, endDay: 0 }, includeMarine: 'auto', language: 'pt-PT' }, { scopeId: 'fixture-scope', actorIdentityId: 'fixture-identity' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'resolve');
  assert.deepEqual(result.presentation.text.split('\n').slice(0, 2), [
    '*Lagos, Faro, Portugal* · previsão',
    '_Também encontrei: Lagos, Lagos State, Nigeria. Indica a região ou o país para escolher outro._'
  ]);
  assert.equal(result.output.report.location.label, 'Lagos, Faro, Portugal');
});
