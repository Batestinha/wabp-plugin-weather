# Weather

Current weather, forecasts and marine conditions through `/weather`, a typed assistant tool and the `official.weather.v2` service.

Standalone WABS package `official.weather` version `0.5.1`, requiring WABP core API `^0.3.0`. All 20 ports in FCUL's published catalogue have calibrated harmonic forecasts. A recent Instituto Hidrográfico L1 observation supplies the current height where available; otherwise the current height is an FCUL estimate. If FCUL is unavailable, only a fresh IH observation may anchor a clearly labelled crude Open-Meteo fallback. Other Open-Meteo heights remain relative to mean sea level.

The archive includes its runtime dependencies and Portuguese translations. Existing scope settings, metric selections, units, provider endpoints and enabled state retain their identifiers and values. WABP owns authorization and configuration resolution.

Named locations use the separately installed `official.geocoder` service. Only its pinned, unmodified service contract is included here; the geocoder provider and geographic database are separate. `contracts/provenance.json` records the upstream commit, checksum and license. Packaging rejects changed contract bytes.

Install through a trusted WABS registry entry. Installation and scope enablement are separate operations. The publisher signs exact archive bytes; registry branding alone does not establish trust.

For development, run `npm ci --ignore-scripts`, `npm test`, then `npm run release:archive`. Tests use fixture identities, mocked host capabilities and mocked HTTP. CI checks Node22.23.2 and24.15.0, reproducibility, and execution outside the repository with packaged dependencies.

`provenance.json` records imported source history and the exact SDK input. No host implementation or credentials are included.
