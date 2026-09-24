/** FCUL's published Portuguese tide-table network; coordinates are port reference points. */
export type TideStation = { name: string; latitude: number; longitude: number; file: string };

// FCUL station list: https://webpages.ciencias.ulisboa.pt/~cmantunes/hidrografia/hidro_mares.html
// Coordinates: FCUL port table, with Setúbal from IH's Tróia gauge and Sagres/Albufeira port centres.
export const PORTUGUESE_TIDE_STATIONS: readonly TideStation[] = [
  { name: 'Viana do Castelo', latitude: 41.6875, longitude: -8.8389, file: 'VianaFCUL%d.TXT' },
  { name: 'Leixões', latitude: 41.1847, longitude: -8.7028, file: 'LeixoesFCUL%d.TXT' },
  { name: 'Aveiro', latitude: 40.6444, longitude: -8.7486, file: 'AveiroFCUL%d.TXT' },
  { name: 'Figueira da Foz', latitude: 40.1472, longitude: -8.8542, file: 'FigueiraFCUL%d.TXT' },
  { name: 'Peniche', latitude: 39.3556, longitude: -9.3722, file: 'PenicheFCUL%d.TXT' },
  { name: 'Cascais', latitude: 38.6944, longitude: -9.4181, file: 'CascaisFCUL%d.TXT' },
  { name: 'Lisboa', latitude: 38.7083, longitude: -9.1306, file: 'LisboaFCUL%d.TXT' },
  { name: 'Sesimbra', latitude: 38.4403, longitude: -9.1111, file: 'Sesimbra%d.TXT' },
  { name: 'Setúbal', latitude: 38.4944, longitude: -8.9008, file: 'SetubalFCUL%d.TXT' },
  { name: 'Sines', latitude: 37.9514, longitude: -8.8875, file: 'SinesFCUL%d.TXT' },
  { name: 'Sagres', latitude: 37.0090, longitude: -8.9410, file: 'SagresFCUL%d.TXT' },
  { name: 'Lagos', latitude: 37.0986, longitude: -8.6667, file: 'LagosFCUL%d.TXT' },
  { name: 'Albufeira', latitude: 37.0880, longitude: -8.2500, file: 'AlbufeiraFCUL%d.TXT' },
  { name: 'Faro', latitude: 36.9750, longitude: -7.8667, file: 'FaroFCUL%d.TXT' },
  { name: 'Vila Real de Santo António', latitude: 37.1931, longitude: -7.4125, file: 'VilaRealFCUL%d.TXT' },
  { name: 'Funchal', latitude: 32.6444, longitude: -16.9125, file: 'Funchal%d.TXT' },
  { name: 'Ponta Delgada', latitude: 37.7361, longitude: -25.6714, file: 'PontaDelgada%d.TXT' },
  { name: 'Horta', latitude: 38.5306, longitude: -28.6208, file: 'Horta%d.TXT' },
  { name: 'Angra do Heroísmo', latitude: 38.6514, longitude: -27.2208, file: 'Angra%d.TXT' },
  { name: 'Santa Cruz das Flores', latitude: 39.4556, longitude: -31.1208, file: 'SantaCruz%d.TXT' }
];
