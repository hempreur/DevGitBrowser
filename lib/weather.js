'use strict';
// Température extérieure via Open-Meteo (gratuit, sans clé, sans compte).
const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';

// Codes météo WMO -> type d'image (dessinée dans l'interface) + libellé.
function describe(code, isDay) {
  const c = Number(code);
  if (c === 0) return isDay ? ['sun', 'Ensoleillé'] : ['moon', 'Ciel dégagé'];
  if (c === 1 || c === 2) return isDay ? ['partly', 'Éclaircies'] : ['partly-night', 'Peu nuageux'];
  if (c === 3) return ['cloud', 'Nuageux'];
  if (c === 45 || c === 48) return ['fog', 'Brouillard'];
  if (c >= 51 && c <= 57) return ['drizzle', 'Bruine'];
  if (c >= 80 && c <= 82) return isDay ? ['showers', 'Averses'] : ['rain', 'Averses'];
  if (c >= 61 && c <= 67) return ['rain', 'Pluie'];
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return ['snow', 'Neige'];
  if (c >= 95) return ['storm', 'Orage'];
  return ['cloud', 'Météo'];
}

async function json(fetcher, url) {
  const res = await fetcher(url, {headers: {accept: 'application/json'}});
  if (!res.ok) throw new Error('Service météo indisponible (' + res.status + ').');
  return res.json();
}

async function findCity(fetcher, name) {
  const q = String(name || '').trim().slice(0, 80);
  if (q.length < 2) throw new Error('Indique le nom d’une ville.');
  const data = await json(fetcher, GEO + '?count=1&language=fr&format=json&name=' + encodeURIComponent(q));
  const r = data?.results?.[0];
  if (!r || !Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) throw new Error('Ville introuvable : ' + q);
  return {name: String(r.name), country: String(r.country_code || r.country || ''), lat: r.latitude, lon: r.longitude};
}

async function current(fetcher, city) {
  const url = FORECAST + '?latitude=' + city.lat + '&longitude=' + city.lon + '&current=temperature_2m,weather_code,is_day&timezone=auto';
  const data = await json(fetcher, url);
  const cur = data?.current;
  if (!cur || !Number.isFinite(cur.temperature_2m)) throw new Error('Température indisponible.');
  const [icon, label] = describe(cur.weather_code, cur.is_day);
  return {city: city.name, temp: Math.round(cur.temperature_2m), icon, label, at: Date.now()};
}

const validCity = c => c && typeof c === 'object' && typeof c.name === 'string' && c.name.length <= 100 &&
  Number.isFinite(c.lat) && Math.abs(c.lat) <= 90 && Number.isFinite(c.lon) && Math.abs(c.lon) <= 180;

module.exports = {findCity, current, describe, validCity};
