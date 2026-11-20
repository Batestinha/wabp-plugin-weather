# Weather

Current weather, forecasts and marine conditions through `/weather`, a typed assistant tool and the `official.weather.v2` service.

The service has two read methods. `query` returns the normalized data. `present` returns the same data plus the chat text that `/weather` and the assistant send, rendered in the caller's language: one block per day (conditions, temperature and humidity, rain, wind, then tides) and one note naming the tide source and datum. Other plugins, such as Community Events, send that text, so a forecast reads the same everywhere. The `presentation.style` setting chooses emoji icons (the default) or plain text labels.

Standalone WABS package `official.weather` version `0.6.3`, requiring WABP core API `^0.3.0`. Portuguese locations prefer the nearest FCUL reference port in the same region (mainland, Madeira or Azores), including places beyond the old 15 km station radius such as Sintra municipality. All 20 ports in FCUL's published catalogue remain available. The message names the reference port: it is a station prediction, not a separate tide model for every beach.

Open-Meteo supplies tides elsewhere and is the fallback when FCUL fails, times out or lacks the requested dates. A fresh Instituto Hidrográfico L1 observation can still supply the current height or anchor a clearly labelled crude fallback, but only within the existing local gauge radius. Other Open-Meteo heights remain relative to mean sea level. Ordinary atmospheric forecasts continue to use Open-Meteo.

Country and coastal coverage use a bundled public-domain Natural Earth map, without a network lookup or reliance on place names/timezones. Spanish land is excluded. A 2 km coastal margin accommodates generalized coastlines; the published Portuguese port coordinates remain authoritative within 250 metres of the gauge. Automatic marine output remains limited to locations within 35 km of the Portuguese coastline; finding a reference port does not make inland locations coastal. `scripts/generate-portugal-boundaries.py` reproduces the map from its pinned upstream revision.

The archive includes its runtime dependencies and Portuguese translations. Existing scope settings, metric selections, units, provider endpoints and enabled state retain their identifiers and values. WABP owns authorization and configuration resolution.

Named locations use the separately installed `official.geocoder` service (0.3.0 or later), whose `resolve` method decides which place is meant: this community's places and usual area first. When its pick is only the best guess, the message names the other places with that name under the title. Only its pinned, unmodified service contract is included here; the geocoder provider and geographic database are separate. `contracts/provenance.json` records the upstream commit, checksum and license. Packaging rejects changed contract bytes.

Install through a trusted WABS registry entry. Installation and scope enablement are separate operations. The publisher signs exact archive bytes; registry branding alone does not establish trust.

For development, run `npm ci --ignore-scripts`, `npm test`, then `npm run release:archive`. Tests use fixture identities, mocked host capabilities and mocked HTTP. CI checks Node22.23.2 and24.15.0, reproducibility, and execution outside the repository with packaged dependencies.

`provenance.json` records imported source history and the exact SDK input. No host implementation or credentials are included.
