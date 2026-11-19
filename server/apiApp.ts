import express from 'express';
import {
  getApiRegistry,
  getAtlasEntityDetail,
  getAtlasYearSnapshot,
  getOnThisDayFeed,
  probeAllowedEndpoint,
  runUnifiedSearch,
  whereWasAtlasPI,
} from './historicalSources.ts';
import {
  analyzeCountryComparison,
  briefYearSnapshot,
  compareHistoricalRecords,
  synthesizeHistoricalRecords,
} from './geminiAssistant.ts';
import { fetchCountryHistoryForDate } from './countryHistory.ts';
import type { AtlasYearSnapshot, CountryHistoryBundle, HistoricalRecord, SourceProviderId } from '../src/types/history.ts';

export function createApiApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'archivum-historical-engine' });
  });

  app.get('/api/search', async (req, res) => {
    try {
      const q = String(req.query.q ?? '').trim();
      if (!q) {
        return res.status(400).json({ error: 'Search query parameter "q" is required.' });
      }
      const yearMinRaw = req.query.year_min ? Number.parseInt(String(req.query.year_min), 10) : null;
      const yearMaxRaw = req.query.year_max ? Number.parseInt(String(req.query.year_max), 10) : null;
      const yearMin = yearMinRaw !== null && Number.isFinite(yearMinRaw) ? yearMinRaw : null;
      const yearMax = yearMaxRaw !== null && Number.isFinite(yearMaxRaw) ? yearMaxRaw : null;

      const sourcesParam =
        typeof req.query.sources === 'string' && req.query.sources.trim()
          ? (req.query.sources.split(',').map((s) => s.trim()) as SourceProviderId[])
          : undefined;

      const result = await runUnifiedSearch(q, yearMin, yearMax, sourcesParam);
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Search failed' });
    }
  });

  app.get('/api/atlas/snapshot/:year', async (req, res) => {
    try {
      const year = Number.parseInt(req.params.year, 10);
      if (!Number.isFinite(year) || year < -15000 || year > 2026) {
        return res.status(400).json({ error: 'Provide a valid historical year between -15000 and 2026.' });
      }
      const snapshot = await getAtlasYearSnapshot(year);
      return res.json(snapshot);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Snapshot lookup failed' });
    }
  });

  app.get('/api/atlas/entity/:id', async (req, res) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'Valid numeric entity id required.' });
      }
      const detail = await getAtlasEntityDetail(id);
      return res.json(detail);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Entity lookup failed' });
    }
  });

  app.get('/api/atlas/where-was', async (req, res) => {
    try {
      const lat = Number.parseFloat(String(req.query.lat));
      const lon = Number.parseFloat(String(req.query.lon));
      const year = Number.parseInt(String(req.query.year), 10);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(year)) {
        return res.status(400).json({ error: 'Parameters lat, lon, and year are required.' });
      }
      const data = await whereWasAtlasPI(lat, lon, year);
      return res.json(data);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Reverse-geocoding failed' });
    }
  });

  app.get('/api/on-this-day', async (req, res) => {
    try {
      const month = req.query.month ? Number.parseInt(String(req.query.month), 10) : undefined;
      const day = req.query.day ? Number.parseInt(String(req.query.day), 10) : undefined;
      const feed = await getOnThisDayFeed(month, day);
      return res.json(feed);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'On This Day feed failed' });
    }
  });

  app.get('/api/registry', async (_req, res) => {
    try {
      const registry = await getApiRegistry();
      return res.json(registry);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Registry lookup failed' });
    }
  });

  app.post('/api/registry/probe', async (req, res) => {
    try {
      const url = String(req.body?.url ?? '').trim();
      if (!url) {
        return res.status(400).json({ error: 'Endpoint URL is required.' });
      }
      const result = await probeAllowedEndpoint(url);
      return res.json(result);
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Probe failed' });
    }
  });

  app.post('/api/assistant/synthesize', async (req, res) => {
    try {
      const query = String(req.body?.query ?? '').trim();
      const records = (req.body?.records ?? []) as HistoricalRecord[];
      if (!query || !Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ error: 'Query and retrieved records are required.' });
      }
      const synthesis = await synthesizeHistoricalRecords(query, records);
      return res.json(synthesis);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Gemini synthesis failed' });
    }
  });

  app.post('/api/assistant/compare', async (req, res) => {
    try {
      const records = (req.body?.records ?? []) as HistoricalRecord[];
      if (!Array.isArray(records) || records.length < 2) {
        return res.status(400).json({ error: 'At least two records are required for comparison.' });
      }
      const comparison = await compareHistoricalRecords(records);
      return res.json(comparison);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Gemini comparison failed' });
    }
  });

  app.post('/api/assistant/year-briefing', async (req, res) => {
    try {
      const snapshot = req.body?.snapshot as AtlasYearSnapshot | undefined;
      if (!snapshot || typeof snapshot.year !== 'number') {
        return res.status(400).json({ error: 'Valid year snapshot payload is required.' });
      }
      const briefing = await briefYearSnapshot(snapshot);
      return res.json(briefing);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Year briefing failed' });
    }
  });

  app.post('/api/country-history', async (req, res) => {
    try {
      const year = Number.parseInt(String(req.body?.year), 10);
      const month = Number.parseInt(String(req.body?.month), 10);
      const day = Number.parseInt(String(req.body?.day), 10);
      const countries = Array.isArray(req.body?.countries) ? (req.body.countries as string[]) : [];

      if (!Number.isFinite(year) || year < -3000 || year > 2026) {
        return res.status(400).json({ error: 'Provide a valid year between -3000 and 2026.' });
      }
      if (!Number.isFinite(month) || month < 1 || month > 12 || !Number.isFinite(day) || day < 1 || day > 31) {
        return res.status(400).json({ error: 'Provide a valid month (1-12) and day (1-31).' });
      }
      if (countries.length === 0) {
        return res.status(400).json({ error: 'Select at least one country.' });
      }

      const data = await fetchCountryHistoryForDate(year, month, day, countries.slice(0, 4));
      return res.json(data);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Country history retrieval failed' });
    }
  });

  app.post('/api/assistant/country-compare', async (req, res) => {
    try {
      const dateDisplay = String(req.body?.dateDisplay ?? '').trim();
      const countries = (req.body?.countries ?? []) as CountryHistoryBundle[];
      if (!dateDisplay || !Array.isArray(countries) || countries.length === 0) {
        return res.status(400).json({ error: 'dateDisplay and retrieved country bundles are required.' });
      }
      const analysis = await analyzeCountryComparison(dateDisplay, countries);
      return res.json(analysis);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Country comparison failed' });
    }
  });

  return app;
}
