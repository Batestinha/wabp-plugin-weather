# Weather

Current weather, forecasts and marine conditions through `/weather`, a typed assistant tool and the `official.weather.v2` service.

Standalone WABS package `official.weather` version `0.5.3`, requiring WABP core API `^0.3.0`. Coastal locations across mainland Portugal, Madeira, and the Azores select the nearest available table from FCUL’s published tide-station network. If no usable FCUL table is available, a fresh nearby Instituto Hidrográfico observation anchors the Open-Meteo forecast with a clearly labelled approximate offset. Without a fresh observation, the fallback remains an uncorrected mean-sea-level model estimate.

The archive includes its runtime dependencies and Portuguese translations. Existing scope settings, metric selections, units, provider endpoints and enabled state retain their identifiers and values. WABP owns authorization and configuration resolution.

Named locations use the separately installed `official.geocoder` service. Only its pinned, unmodified service contract is included here; the geocoder provider and geographic database are separate. `contracts/provenance.json` records the upstream commit, checksum and license. Packaging rejects changed contract bytes.

Install through a trusted WABS registry entry. Installation and scope enablement are separate operations. The publisher signs exact archive bytes; registry branding alone does not establish trust.

For development, run `npm ci --ignore-scripts`, `npm test`, then `npm run release:archive`. Tests use fixture identities, mocked host capabilities and mocked HTTP. CI checks Node22.23.2 and24.15.0, reproducibility, and execution outside the repository with packaged dependencies.

`provenance.json` records imported source history and the exact SDK input. No host implementation or credentials are included.
