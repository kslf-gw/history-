import type {
  ApiProviderMetadata,
  AtlasEntityDetail,
  AtlasEntitySummary,
  AtlasYearSnapshot,
  HistoricalRecord,
  OnThisDayEntry,
  OnThisDayResponse,
  RecordCategory,
  RegistryResponse,
  SearchResponse,
  SourceProviderId,
} from '../src/types/history.ts';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

function setCached<T>(key: string, value: T, ttlMs: number): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

// Day in History API free-tier limit: 10 requests/hour
const DAY_IN_HISTORY_LIMIT_PER_HOUR = 10;
const dayInHistoryTimestamps: number[] = [];

function getDayInHistoryQuotaUsed(): number {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  while (dayInHistoryTimestamps.length > 0 && dayInHistoryTimestamps[0] < oneHourAgo) {
    dayInHistoryTimestamps.shift();
  }
  return dayInHistoryTimestamps.length;
}

function recordDayInHistoryRequest(): void {
  dayInHistoryTimestamps.push(Date.now());
}

async function fetchJson<T>(url: string, timeoutMs = 9000, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'ArchivumHistoricalEngine/1.0 (https://github.com/archivum-research)',
      Accept: 'application/json',
      ...headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
  }
  return (await response.json()) as T;
}

export function formatYearDisplay(year: number | null | undefined): string {
  if (year === null || year === undefined || Number.isNaN(year)) return 'Undated';
  if (year < 0) return `${Math.abs(year)} BCE`;
  if (year === 0) return '1 BCE';
  return `${year} CE`;
}

function parseYearFromDateString(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(-?\d{1,5})/);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

// ============================================================================
// 1. ATLASPI HISTORICAL GEOGRAPHY API (https://atlaspi.it/v1)
// ============================================================================

interface AtlasAdvancedSearchResult {
  results?: Array<{
    type: string;
    id: number;
    name: string;
    name_lang?: string;
    subtype?: string;
    year_start?: number | null;
    year_end?: number | null;
    status?: string;
    confidence_score?: number | null;
  }>;
}

function mapAtlasTypeToCategory(atlasType: string): RecordCategory {
  switch (atlasType) {
    case 'entity':
      return 'polity';
    case 'event':
      return 'event';
    case 'ruler':
      return 'ruler';
    case 'site':
    case 'city':
      return 'site';
    case 'route':
      return 'route';
    default:
      return 'concept';
  }
}

async function searchAtlasPI(
  query: string,
  yearMin: number | null,
  yearMax: number | null,
  limit = 14
): Promise<{ records: HistoricalRecord[]; cached: boolean }> {
  const cacheKey = `atlas:search:${query}:${yearMin ?? ''}:${yearMax ?? ''}:${limit}`;
  const hit = getCached<HistoricalRecord[]>(cacheKey);
  if (hit) return { records: hit, cached: true };

  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (yearMin !== null) params.set('year_min', String(yearMin));
  if (yearMax !== null) params.set('year_max', String(yearMax));

  const data = await fetchJson<AtlasAdvancedSearchResult>(`https://atlaspi.it/v1/search/advanced?${params.toString()}`);
  const items = data.results ?? [];

  const records: HistoricalRecord[] = items.map((item) => {
    const start = item.year_start ?? null;
    const end = item.year_end ?? null;
    const dateDisplay =
      start !== null && end !== null
        ? `${formatYearDisplay(start)} – ${formatYearDisplay(end)}`
        : start !== null
          ? formatYearDisplay(start)
          : 'Chronology unrecorded';

    return {
      id: `atlaspi:${item.type}:${item.id}`,
      externalId: String(item.id),
      source: 'atlaspi',
      sourceLabel: 'AtlasPI',
      category: mapAtlasTypeToCategory(item.type),
      title: item.name,
      nativeTitle: item.name,
      nativeLang: item.name_lang,
      subtitle: item.subtype ? `${item.type} · ${item.subtype}` : item.type,
      description: `Historical ${item.type}${item.subtype ? ` (${item.subtype})` : ''} catalogued in AtlasPI${item.status ? ` with status "${item.status}"` : ''}.`,
      yearStart: start,
      yearEnd: end,
      dateDisplay,
      confidenceScore: item.confidence_score ?? null,
      url: `https://atlaspi.it/v1/${item.type === 'entity' ? 'entities' : item.type + 's'}/${item.id}`,
      metadata: {
        atlasType: item.type,
        atlasId: item.id,
        subtype: item.subtype ?? null,
        status: item.status ?? null,
      },
    };
  });

  setCached(cacheKey, records, 10 * 60 * 1000);
  return { records, cached: false };
}

export async function getAtlasYearSnapshot(year: number): Promise<AtlasYearSnapshot> {
  const cacheKey = `atlas:snapshot:${year}`;
  const hit = getCached<AtlasYearSnapshot>(cacheKey);
  if (hit) return hit;

  const [snapshotRes, entitiesRes, rulersRes, routesRes, sitesRes, vetustasMilestones] = await Promise.allSettled([
    fetchJson<{
      year: number;
      year_display: string;
      periods?: { items?: AtlasYearSnapshot['periods'] };
      entities?: { total_active?: number; by_type?: Record<string, number>; top_by_confidence?: AtlasEntitySummary[] };
      events_that_year?: { items?: AtlasYearSnapshot['events'] };
      chains?: { items?: AtlasYearSnapshot['chains'] };
    }>(`https://atlaspi.it/v1/snapshot/year/${year}`),
    fetchJson<{ entities?: AtlasEntitySummary[] }>(
      `https://atlaspi.it/v1/entities?year=${year}&limit=35`
    ),
    fetchJson<{ rulers?: AtlasYearSnapshot['rulers'] }>(`https://atlaspi.it/v1/rulers/at-year/${year}`),
    fetchJson<{ routes?: AtlasYearSnapshot['routes'] }>(`https://atlaspi.it/v1/routes?year=${year}&limit=25`),
    fetchJson<{ sites?: AtlasYearSnapshot['sites'] }>(`https://atlaspi.it/v1/sites?year=${year}&limit=45`),
    getVetustasByYear(year),
  ]);

  const snap = snapshotRes.status === 'fulfilled' ? snapshotRes.value : null;
  const entitiesList =
    entitiesRes.status === 'fulfilled' && Array.isArray(entitiesRes.value.entities)
      ? entitiesRes.value.entities
      : snap?.entities?.top_by_confidence ?? [];

  const result: AtlasYearSnapshot = {
    year,
    yearDisplay: snap?.year_display ?? formatYearDisplay(year),
    periods: snap?.periods?.items ?? [],
    entityStats: {
      totalActive: snap?.entities?.total_active ?? entitiesList.length,
      byType: snap?.entities?.by_type ?? {},
    },
    entities: entitiesList.map((e) => ({
      ...e,
      name: e.name ?? e.name_original ?? `Entity #${e.id}`,
    })),
    events: snap?.events_that_year?.items ?? [],
    rulers: rulersRes.status === 'fulfilled' ? rulersRes.value.rulers ?? [] : [],
    routes: routesRes.status === 'fulfilled' ? routesRes.value.routes ?? [] : [],
    sites: sitesRes.status === 'fulfilled' ? sitesRes.value.sites ?? [] : [],
    chains: snap?.chains?.items ?? [],
    vetustasMilestones: vetustasMilestones.status === 'fulfilled' ? vetustasMilestones.value : [],
  };

  setCached(cacheKey, result, 15 * 60 * 1000);
  return result;
}

export async function getAtlasEntityDetail(entityId: number): Promise<AtlasEntityDetail> {
  const cacheKey = `atlas:entity:${entityId}`;
  const hit = getCached<AtlasEntityDetail>(cacheKey);
  if (hit) return hit;

  const [entityRes, rulersRes, predecessorsRes, successorsRes, eventsRes, periodsRes] = await Promise.allSettled([
    fetchJson<AtlasEntityDetail>(`https://atlaspi.it/v1/entities/${entityId}`),
    fetchJson<{ rulers?: AtlasEntityDetail['rulers'] }>(`https://atlaspi.it/v1/rulers/by-entity/${entityId}`),
    fetchJson<{ predecessors?: AtlasEntityDetail['predecessors'] }>(`https://atlaspi.it/v1/entities/${entityId}/predecessors`),
    fetchJson<{ successors?: AtlasEntityDetail['successors'] }>(`https://atlaspi.it/v1/entities/${entityId}/successors`),
    fetchJson<{ events?: AtlasEntityDetail['events'] }>(`https://atlaspi.it/v1/entities/${entityId}/events`),
    fetchJson<{ periods?: AtlasEntityDetail['periods'] }>(`https://atlaspi.it/v1/entities/${entityId}/periods`),
  ]);

  if (entityRes.status !== 'fulfilled') {
    throw new Error(`Unable to retrieve AtlasPI entity #${entityId}`);
  }

  const detail: AtlasEntityDetail = {
    ...entityRes.value,
    rulers: rulersRes.status === 'fulfilled' ? rulersRes.value.rulers ?? [] : [],
    predecessors: predecessorsRes.status === 'fulfilled' ? predecessorsRes.value.predecessors ?? [] : [],
    successors: successorsRes.status === 'fulfilled' ? successorsRes.value.successors ?? [] : [],
    events: eventsRes.status === 'fulfilled' ? eventsRes.value.events ?? [] : [],
    periods: periodsRes.status === 'fulfilled' ? periodsRes.value.periods ?? [] : [],
  };

  setCached(cacheKey, detail, 15 * 60 * 1000);
  return detail;
}

export async function whereWasAtlasPI(lat: number, lon: number, year: number): Promise<unknown> {
  const roundedLat = Number(lat.toFixed(3));
  const roundedLon = Number(lon.toFixed(3));
  const cacheKey = `atlas:where:${roundedLat}:${roundedLon}:${year}`;
  const hit = getCached<unknown>(cacheKey);
  if (hit) return hit;

  const data = await fetchJson<unknown>(
    `https://atlaspi.it/v1/where-was?lat=${roundedLat}&lon=${roundedLon}&year=${year}`
  );
  setCached(cacheKey, data, 15 * 60 * 1000);
  return data;
}

// ============================================================================
// 2. VETUSTAS HISTORICAL DATA API (https://api.vetustas.net/v1)
// ============================================================================

interface VetustasListResponse {
  dataset: string;
  total: number;
  records: Array<Record<string, unknown>>;
}

const VETUSTAS_HISTORICAL_DATASETS: Array<{
  name: string;
  category: RecordCategory;
  label: string;
}> = [
  { name: 'events', category: 'event', label: 'Historical Event' },
  { name: 'people', category: 'person', label: 'Historical Figure' },
  { name: 'inventions', category: 'invention', label: 'Invention & Discovery' },
  { name: 'landmarks', category: 'landmark', label: 'Landmark' },
  { name: 'fine-art', category: 'artwork', label: 'Fine Art' },
  { name: 'literature', category: 'literature', label: 'Literature' },
  { name: 'companies', category: 'concept', label: 'Historic Institution' },
];

function normalizeVetustasRecord(
  dataset: string,
  category: RecordCategory,
  label: string,
  rec: Record<string, unknown>
): HistoricalRecord {
  const title = String(rec.title ?? rec.name ?? 'Untitled Record');
  const rawDate =
    rec.start_date ?? rec.date_of_birth ?? rec.date ?? rec.creation_date ?? rec.publish_date ?? rec.foundation_date;
  const yearStart = parseYearFromDateString(rawDate);
  const yearEnd = parseYearFromDateString(rec.end_date);

  const locationParts = [rec.location, rec.city, rec.country, rec.origin_country, rec.nationality]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  const location = [...new Set(locationParts)].join(', ');

  const subtitleParts = [
    label,
    typeof rec.type === 'string' ? rec.type : null,
    typeof rec.occupation === 'string' ? rec.occupation : null,
    typeof rec.movement === 'string' ? rec.movement : null,
    typeof rec.inventor === 'string' ? `Inventor: ${rec.inventor}` : null,
    typeof rec.author === 'string' ? `Author: ${rec.author}` : null,
    typeof rec.artist === 'string' ? `Artist: ${rec.artist}` : null,
    typeof rec.architect === 'string' ? `Architect: ${rec.architect}` : null,
    typeof rec.era === 'string' ? rec.era : null,
  ].filter((v): v is string => Boolean(v));

  const descSegments = [
    typeof rec.era === 'string' ? `Era: ${rec.era}.` : null,
    typeof rec.occupation === 'string' ? `Occupation: ${rec.occupation}.` : null,
    typeof rec.category === 'string' ? `Category: ${rec.category}.` : null,
    typeof rec.medium === 'string' ? `Medium: ${rec.medium}.` : null,
    typeof rec.museum === 'string' ? `Museum: ${rec.museum}.` : null,
    typeof rec.industry === 'string' ? `Industry: ${rec.industry}.` : null,
    location ? `Provenance / Region: ${location}.` : null,
  ].filter(Boolean);

  const image =
    typeof rec.image === 'string'
      ? rec.image
      : typeof rec.cover === 'string'
        ? rec.cover
        : typeof rec.logo === 'string'
          ? rec.logo
          : null;

  return {
    id: `vetustas:${dataset}:${String(rec.id)}`,
    externalId: String(rec.id),
    source: 'vetustas',
    sourceLabel: 'Vetustas',
    category,
    title,
    subtitle: subtitleParts.slice(0, 3).join(' · '),
    description: descSegments.join(' ') || `Catalogued in the Vetustas ${label} archive.`,
    yearStart,
    yearEnd,
    dateDisplay:
      yearStart !== null && yearEnd !== null && yearEnd !== yearStart
        ? `${formatYearDisplay(yearStart)} – ${formatYearDisplay(yearEnd)}`
        : yearStart !== null
          ? formatYearDisplay(yearStart)
          : typeof rawDate === 'string' && rawDate
            ? rawDate
            : 'Undated',
    location: location || undefined,
    imageUrl: image,
    url: typeof rec.reference_url === 'string' ? rec.reference_url : null,
    wikidataQid: typeof rec.wikidata_id === 'string' ? rec.wikidata_id : null,
    metadata: {
      dataset,
      dateAccuracy: typeof rec.date_accuracy === 'string' ? rec.date_accuracy : null,
      countryCode: typeof rec.country_code === 'string' ? rec.country_code : null,
    },
  };
}

async function searchVetustas(
  query: string,
  yearMin: number | null,
  yearMax: number | null
): Promise<{ records: HistoricalRecord[]; cached: boolean }> {
  const cacheKey = `vetustas:search:${query}:${yearMin ?? ''}:${yearMax ?? ''}`;
  const hit = getCached<HistoricalRecord[]>(cacheKey);
  if (hit) return { records: hit, cached: true };

  const responses = await Promise.allSettled(
    VETUSTAS_HISTORICAL_DATASETS.map(async (ds) => {
      const params = new URLSearchParams({ q: query, page_size: '5' });
      if (yearMin !== null) params.set('year_min', String(yearMin));
      if (yearMax !== null) params.set('year_max', String(yearMax));
      const data = await fetchJson<VetustasListResponse>(
        `https://api.vetustas.net/v1/${ds.name}?${params.toString()}`
      );
      return (data.records ?? []).map((rec) => normalizeVetustasRecord(ds.name, ds.category, ds.label, rec));
    })
  );

  const records = responses
    .filter((r): r is PromiseFulfilledResult<HistoricalRecord[]> => r.status === 'fulfilled')
    .flatMap((r) => r.value);

  setCached(cacheKey, records, 10 * 60 * 1000);
  return { records, cached: false };
}

async function getVetustasByYear(year: number): Promise<HistoricalRecord[]> {
  const cacheKey = `vetustas:year:${year}`;
  const hit = getCached<HistoricalRecord[]>(cacheKey);
  if (hit) return hit;

  const targetDatasets = VETUSTAS_HISTORICAL_DATASETS.slice(0, 4);
  const responses = await Promise.allSettled(
    targetDatasets.map(async (ds) => {
      const data = await fetchJson<VetustasListResponse>(
        `https://api.vetustas.net/v1/${ds.name}?year=${year}&page_size=6`
      );
      return (data.records ?? []).map((rec) => normalizeVetustasRecord(ds.name, ds.category, ds.label, rec));
    })
  );

  const records = responses
    .filter((r): r is PromiseFulfilledResult<HistoricalRecord[]> => r.status === 'fulfilled')
    .flatMap((r) => r.value);

  setCached(cacheKey, records, 15 * 60 * 1000);
  return records;
}

// ============================================================================
// 3. DAY IN HISTORY API (https://api.dayinhistory.dev/v1) + WIKIMEDIA REST + ATLASPI OTD
// ============================================================================

interface DayInHistoryApiResult {
  count?: number;
  results?: Array<{
    year?: string;
    title?: string;
    name?: string;
    description?: string;
    bio?: string;
    type?: string;
  }>;
}

interface WikimediaOtdResponse {
  selected?: Array<{
    text: string;
    year: number;
    pages?: Array<{
      normalizedtitle?: string;
      extract?: string;
      thumbnail?: { source?: string };
      content_urls?: { desktop?: { page?: string } };
    }>;
  }>;
  births?: Array<{
    text: string;
    year: number;
    pages?: Array<{
      normalizedtitle?: string;
      extract?: string;
      thumbnail?: { source?: string };
      content_urls?: { desktop?: { page?: string } };
    }>;
  }>;
  deaths?: Array<{
    text: string;
    year: number;
    pages?: Array<{
      normalizedtitle?: string;
      extract?: string;
      thumbnail?: { source?: string };
      content_urls?: { desktop?: { page?: string } };
    }>;
  }>;
}

export async function getOnThisDayFeed(monthInput?: number, dayInput?: number): Promise<OnThisDayResponse> {
  const now = new Date();
  const month = monthInput && monthInput >= 1 && monthInput <= 12 ? monthInput : now.getUTCMonth() + 1;
  const day = dayInput && dayInput >= 1 && dayInput <= 31 ? dayInput : now.getUTCDate();
  const monthName = MONTH_NAMES[month - 1];
  const isToday = month === now.getUTCMonth() + 1 && day === now.getUTCDate();

  const cacheKey = `otd:combined:${month}:${day}`;
  const cachedCombined = getCached<OnThisDayResponse>(cacheKey);
  if (cachedCombined) {
    return {
      ...cachedCombined,
      dayInHistoryQuota: {
        usedLastHour: getDayInHistoryQuotaUsed(),
        limitPerHour: DAY_IN_HISTORY_LIMIT_PER_HOUR,
        servedFromCache: true,
        rateLimitedFallback: cachedCombined.dayInHistoryQuota.rateLimitedFallback,
      },
    };
  }

  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');

  // Check Day in History cache (6 hours) and rate-limit budget (10 req/hr max; each date uses 3 calls)
  const dihDateCacheKey = `dih:${monthName}:${day}`;
  let dihCached = getCached<{
    events: OnThisDayEntry[];
    births: OnThisDayEntry[];
    deaths: OnThisDayEntry[];
  }>(dihDateCacheKey);

  let servedDihFromCache = Boolean(dihCached);
  let rateLimitedFallback = false;

  if (!dihCached) {
    const used = getDayInHistoryQuotaUsed();
    // Reserve 3 requests atomically for events, births, deaths
    if (used + 3 <= DAY_IN_HISTORY_LIMIT_PER_HOUR) {
      try {
        const basePath = isToday ? 'https://api.dayinhistory.dev/v1/today' : `https://api.dayinhistory.dev/v1`;
        const urls = isToday
          ? [`${basePath}/events/`, `${basePath}/births/`, `${basePath}/deaths/`]
          : [
              `${basePath}/events/${monthName}/${day}/`,
              `${basePath}/births/${monthName}/${day}/`,
              `${basePath}/deaths/${monthName}/${day}/`,
            ];

        recordDayInHistoryRequest();
        recordDayInHistoryRequest();
        recordDayInHistoryRequest();

        const [evRes, biRes, deRes] = await Promise.allSettled(
          urls.map((u) => fetchJson<DayInHistoryApiResult>(u, 8000))
        );

        const parseDihList = (
          res: PromiseSettledResult<DayInHistoryApiResult>,
          kind: 'event' | 'birth' | 'death'
        ): OnThisDayEntry[] => {
          if (res.status !== 'fulfilled') return [];
          return (res.value.results ?? []).slice(0, 20).map((item, idx) => {
            const parsedYear = item.year ? Number.parseInt(item.year, 10) : null;
            return {
              id: `dih:${kind}:${month}:${day}:${idx}`,
              source: 'dayinhistory',
              sourceLabel: 'Day in History',
              kind,
              year: Number.isFinite(parsedYear) ? parsedYear : null,
              title: item.title ?? item.name ?? 'Untitled Anniversary',
              description: item.bio ?? item.description ?? '',
              month,
              day,
            };
          });
        };

        dihCached = {
          events: parseDihList(evRes, 'event'),
          births: parseDihList(biRes, 'birth'),
          deaths: parseDihList(deRes, 'death'),
        };

        setCached(dihDateCacheKey, dihCached, 6 * 60 * 60 * 1000);
      } catch {
        dihCached = { events: [], births: [], deaths: [] };
      }
    } else {
      rateLimitedFallback = true;
      dihCached = { events: [], births: [], deaths: [] };
    }
  }

  // Also fetch Wikimedia REST On This Day + AtlasPI On This Day in parallel
  const [wikiRes, atlasOtdRes] = await Promise.allSettled([
    fetchJson<WikimediaOtdResponse>(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/all/${mm}/${dd}`, 8000),
    fetchJson<{
      events?: Array<{
        id: number;
        name: string;
        event_type?: string;
        year_start?: number | null;
        location_name?: string | null;
      }>;
    }>(`https://atlaspi.it/v1/events/on-this-day/${mm}-${dd}`, 8000),
  ]);

  const wikiEvents: OnThisDayEntry[] = [];
  const wikiBirths: OnThisDayEntry[] = [];
  const wikiDeaths: OnThisDayEntry[] = [];

  if (wikiRes.status === 'fulfilled') {
    const mapWiki = (
      items: WikimediaOtdResponse['selected'],
      kind: 'event' | 'birth' | 'death'
    ): OnThisDayEntry[] =>
      (items ?? []).slice(0, 18).map((item, idx) => {
        const page = item.pages?.[0];
        return {
          id: `wiki:${kind}:${month}:${day}:${idx}`,
          source: 'wikimedia',
          sourceLabel: 'Wikimedia',
          kind,
          year: item.year ?? null,
          title: page?.normalizedtitle ?? item.text.slice(0, 90),
          description: item.text,
          url: page?.content_urls?.desktop?.page ?? null,
          thumbnailUrl: page?.thumbnail?.source ?? null,
          month,
          day,
        };
      });

    wikiEvents.push(...mapWiki(wikiRes.value.selected, 'event'));
    wikiBirths.push(...mapWiki(wikiRes.value.births, 'birth'));
    wikiDeaths.push(...mapWiki(wikiRes.value.deaths, 'death'));
  }

  const atlasEvents: OnThisDayEntry[] =
    atlasOtdRes.status === 'fulfilled'
      ? (atlasOtdRes.value.events ?? []).map((ev) => ({
          id: `atlaspi:otd:${ev.id}`,
          source: 'atlaspi',
          sourceLabel: 'AtlasPI',
          kind: 'event',
          year: ev.year_start ?? null,
          title: ev.name,
          description: `${ev.event_type ?? 'Historical event'}${ev.location_name ? ` in ${ev.location_name}` : ''}.`,
          url: `https://atlaspi.it/v1/events/${ev.id}`,
          month,
          day,
        }))
      : [];

  const response: OnThisDayResponse = {
    month,
    monthName: monthName.charAt(0).toUpperCase() + monthName.slice(1),
    day,
    isToday,
    epistemicNote:
      'Calendar anniversaries match month and day across all historical years. They represent recurring calendar dates, not events filtered to a single timeline year.',
    dayInHistoryQuota: {
      usedLastHour: getDayInHistoryQuotaUsed(),
      limitPerHour: DAY_IN_HISTORY_LIMIT_PER_HOUR,
      servedFromCache: servedDihFromCache,
      rateLimitedFallback,
    },
    events: [...dihCached.events, ...atlasEvents, ...wikiEvents].sort((a, b) => (b.year ?? -9999) - (a.year ?? -9999)),
    births: [...dihCached.births, ...wikiBirths].sort((a, b) => (b.year ?? -9999) - (a.year ?? -9999)),
    deaths: [...dihCached.deaths, ...wikiDeaths].sort((a, b) => (b.year ?? -9999) - (a.year ?? -9999)),
  };

  setCached(cacheKey, response, 30 * 60 * 1000);
  return response;
}

// ============================================================================
// 4. WIKIPEDIA & WIKIDATA ADAPTERS
// ============================================================================

async function searchWikipedia(query: string): Promise<{ records: HistoricalRecord[]; cached: boolean }> {
  const cacheKey = `wiki:search:${query}`;
  const hit = getCached<HistoricalRecord[]>(cacheKey);
  if (hit) return { records: hit, cached: true };

  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: '6',
    format: 'json',
    origin: '*',
  });
  const data = await fetchJson<{
    query?: {
      search?: Array<{ pageid: number; title: string; snippet: string }>;
    };
  }>(`https://en.wikipedia.org/w/api.php?${params.toString()}`);

  const records: HistoricalRecord[] = (data.query?.search ?? []).map((item) => ({
    id: `wikimedia:page:${item.pageid}`,
    externalId: String(item.pageid),
    source: 'wikimedia',
    sourceLabel: 'Wikipedia',
    category: 'concept',
    title: item.title,
    subtitle: 'Encyclopedic Monograph',
    description: item.snippet.replace(/<[^>]+>/g, ''),
    url: `https://en.wikipedia.org/?curid=${item.pageid}`,
    metadata: { pageid: item.pageid },
  }));

  setCached(cacheKey, records, 15 * 60 * 1000);
  return { records, cached: false };
}

async function searchWikidata(query: string): Promise<{ records: HistoricalRecord[]; cached: boolean }> {
  const cacheKey = `wikidata:search:${query}`;
  const hit = getCached<HistoricalRecord[]>(cacheKey);
  if (hit) return { records: hit, cached: true };

  const params = new URLSearchParams({
    action: 'wbsearchentities',
    search: query,
    language: 'en',
    limit: '6',
    format: 'json',
  });
  const data = await fetchJson<{
    search?: Array<{ id: string; label: string; description?: string; concepturi?: string }>;
  }>(`https://www.wikidata.org/w/api.php?${params.toString()}`);

  const records: HistoricalRecord[] = (data.search ?? []).map((item) => ({
    id: `wikidata:${item.id}`,
    externalId: item.id,
    source: 'wikidata',
    sourceLabel: 'Wikidata',
    category: 'concept',
    title: item.label,
    subtitle: `Knowledge Graph Entity · ${item.id}`,
    description: item.description ?? 'Structured entity in the Wikidata historical knowledge graph.',
    wikidataQid: item.id,
    url: item.concepturi ?? `https://www.wikidata.org/wiki/${item.id}`,
    metadata: { qid: item.id },
  }));

  setCached(cacheKey, records, 15 * 60 * 1000);
  return { records, cached: false };
}

// ============================================================================
// 5. OPEN MUSEUM & LIBRARY ARCHIVES (CLEVELAND, ARTIC, OPEN LIBRARY, ARCHIVE.ORG)
// ============================================================================

async function searchClevelandMuseum(query: string): Promise<{ records: HistoricalRecord[]; cached: boolean }> {
  const cacheKey = `cleveland:search:${query}`;
  const hit = getCached<HistoricalRecord[]>(cacheKey);
  if (hit) return { records: hit, cached: true };

  const params = new URLSearchParams({ q: query, has_image: '1', limit: '6' });
  const data = await fetchJson<{
    data?: Array<{
      id: number;
      accession_number?: string;
      title?: string;
      creation_date?: string;
      creation_date_earliest?: number;
      creation_date_latest?: number;
      culture?: string[];
      department?: string;
      technique?: string;
      url?: string;
      images?: { web?: { url?: string } };
      creators?: Array<{ description?: string }>;
    }>;
  }>(`https://openaccess-api.clevelandart.org/api/artworks/?${params.toString()}`);

  const records: HistoricalRecord[] = (data.data ?? []).map((item) => ({
    id: `cleveland:${item.id}`,
    externalId: String(item.id),
    source: 'cleveland',
    sourceLabel: 'Cleveland Museum of Art',
    category: 'artwork',
    title: item.title ?? 'Untitled Artifact',
    subtitle: [item.department, item.accession_number].filter(Boolean).join(' · '),
    description: [
      item.creators?.[0]?.description ? `Creator: ${item.creators[0].description}.` : null,
      item.culture?.length ? `Culture: ${item.culture.join(', ')}.` : null,
      item.technique ? `Medium: ${item.technique}.` : null,
    ]
      .filter(Boolean)
      .join(' ') || 'Open Access museum collection object.',
    yearStart: item.creation_date_earliest ?? null,
    yearEnd: item.creation_date_latest ?? null,
    dateDisplay: item.creation_date ?? 'Undated',
    location: item.culture?.join(', '),
    imageUrl: item.images?.web?.url ?? null,
    url: item.url ?? `https://www.clevelandart.org/art/${item.accession_number ?? item.id}`,
    metadata: {
      accessionNumber: item.accession_number ?? null,
      department: item.department ?? null,
    },
  }));

  setCached(cacheKey, records, 15 * 60 * 1000);
  return { records, cached: false };
}

async function searchArtInstituteChicago(query: string): Promise<{ records: HistoricalRecord[]; cached: boolean }> {
  const cacheKey = `artic:search:${query}`;
  const hit = getCached<HistoricalRecord[]>(cacheKey);
  if (hit) return { records: hit, cached: true };

  const params = new URLSearchParams({
    q: query,
    limit: '6',
    fields: 'id,title,date_display,date_start,date_end,artist_display,place_of_origin,department_title,medium_display,image_id',
  });
  const data = await fetchJson<{
    config?: { iiif_url?: string };
    data?: Array<{
      id: number;
      title: string;
      date_display?: string;
      date_start?: number;
      date_end?: number;
      artist_display?: string;
      place_of_origin?: string;
      department_title?: string;
      medium_display?: string;
      image_id?: string;
    }>;
  }>(`https://api.artic.edu/api/v1/artworks/search?${params.toString()}`);

  const iiifBase = data.config?.iiif_url ?? 'https://www.artic.edu/iiif/2';

  const records: HistoricalRecord[] = (data.data ?? []).map((item) => ({
    id: `artic:${item.id}`,
    externalId: String(item.id),
    source: 'artic',
    sourceLabel: 'Art Institute of Chicago',
    category: 'artwork',
    title: item.title,
    subtitle: [item.department_title, item.place_of_origin].filter(Boolean).join(' · '),
    description: [
      item.artist_display ? `Attribution: ${item.artist_display.replace(/\n/g, ', ')}.` : null,
      item.medium_display ? `Medium: ${item.medium_display}.` : null,
    ]
      .filter(Boolean)
      .join(' ') || 'Public archive record from the Art Institute of Chicago.',
    yearStart: item.date_start ?? null,
    yearEnd: item.date_end ?? null,
    dateDisplay: item.date_display ?? 'Undated',
    location: item.place_of_origin,
    imageUrl: item.image_id ? `${iiifBase}/${item.image_id}/full/600,/0/default.jpg` : null,
    url: `https://www.artic.edu/artworks/${item.id}`,
    metadata: {
      department: item.department_title ?? null,
    },
  }));

  setCached(cacheKey, records, 15 * 60 * 1000);
  return { records, cached: false };
}

async function searchOpenLibrary(query: string): Promise<{ records: HistoricalRecord[]; cached: boolean }> {
  const cacheKey = `openlibrary:search:${query}`;
  const hit = getCached<HistoricalRecord[]>(cacheKey);
  if (hit) return { records: hit, cached: true };

  const params = new URLSearchParams({
    q: `${query} subject:history`,
    limit: '6',
    fields: 'key,title,author_name,first_publish_year,cover_i,subject',
  });
  const data = await fetchJson<{
    docs?: Array<{
      key: string;
      title: string;
      author_name?: string[];
      first_publish_year?: number;
      cover_i?: number;
      subject?: string[];
    }>;
  }>(`https://openlibrary.org/search.json?${params.toString()}`);

  const records: HistoricalRecord[] = (data.docs ?? []).map((doc) => ({
    id: `openlibrary:${doc.key}`,
    externalId: doc.key,
    source: 'openlibrary',
    sourceLabel: 'Open Library',
    category: 'literature',
    title: doc.title,
    subtitle: doc.author_name?.slice(0, 2).join(', ') || 'Historical Monograph',
    description: `Published ${doc.first_publish_year ?? 'date unknown'}${doc.subject?.length ? `. Subjects: ${doc.subject.slice(0, 4).join(', ')}` : ''}.`,
    yearStart: doc.first_publish_year ?? null,
    dateDisplay: doc.first_publish_year ? `First published ${doc.first_publish_year}` : 'Undated edition',
    imageUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
    url: `https://openlibrary.org${doc.key}`,
    metadata: {
      authors: doc.author_name ?? [],
    },
  }));

  setCached(cacheKey, records, 15 * 60 * 1000);
  return { records, cached: false };
}

async function searchInternetArchive(query: string): Promise<{ records: HistoricalRecord[]; cached: boolean }> {
  const cacheKey = `ia:search:${query}`;
  const hit = getCached<HistoricalRecord[]>(cacheKey);
  if (hit) return { records: hit, cached: true };

  const q = `(${query}) AND mediatype:texts`;
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier,title,date,creator,description&rows=6&output=json`;
  const data = await fetchJson<{
    response?: {
      docs?: Array<{
        identifier: string;
        title?: string;
        date?: string;
        creator?: string | string[];
        description?: string | string[];
      }>;
    };
  }>(url);

  const records: HistoricalRecord[] = (data.response?.docs ?? []).map((doc) => {
    const rawDesc = Array.isArray(doc.description) ? doc.description[0] : doc.description;
    const creator = Array.isArray(doc.creator) ? doc.creator.join(', ') : doc.creator;
    const year = parseYearFromDateString(doc.date);
    return {
      id: `ia:${doc.identifier}`,
      externalId: doc.identifier,
      source: 'internetarchive',
      sourceLabel: 'Internet Archive',
      category: 'archive',
      title: doc.title ?? doc.identifier,
      subtitle: creator ? `Creator: ${creator}` : 'Digitized Archival Text',
      description: (rawDesc ?? 'Digitized primary text preserved in the Internet Archive.').replace(/<[^>]+>/g, '').slice(0, 280),
      yearStart: year,
      dateDisplay: year ? formatYearDisplay(year) : doc.date?.slice(0, 10) ?? 'Undated',
      imageUrl: `https://archive.org/services/img/${doc.identifier}`,
      url: `https://archive.org/details/${doc.identifier}`,
      metadata: { identifier: doc.identifier },
    };
  });

  setCached(cacheKey, records, 15 * 60 * 1000);
  return { records, cached: false };
}

// ============================================================================
// UNIFIED MULTI-SOURCE SEARCH ORCHESTRATOR
// ============================================================================

const ALL_SEARCH_PROVIDERS: Array<{
  id: SourceProviderId;
  label: string;
  fn: (q: string, yearMin: number | null, yearMax: number | null) => Promise<{ records: HistoricalRecord[]; cached: boolean }>;
}> = [
  { id: 'atlaspi', label: 'AtlasPI', fn: (q, yMin, yMax) => searchAtlasPI(q, yMin, yMax) },
  { id: 'vetustas', label: 'Vetustas', fn: (q, yMin, yMax) => searchVetustas(q, yMin, yMax) },
  { id: 'wikimedia', label: 'Wikipedia', fn: (q) => searchWikipedia(q) },
  { id: 'wikidata', label: 'Wikidata', fn: (q) => searchWikidata(q) },
  { id: 'cleveland', label: 'Cleveland Museum of Art', fn: (q) => searchClevelandMuseum(q) },
  { id: 'artic', label: 'Art Institute of Chicago', fn: (q) => searchArtInstituteChicago(q) },
  { id: 'openlibrary', label: 'Open Library', fn: (q) => searchOpenLibrary(q) },
  { id: 'internetarchive', label: 'Internet Archive', fn: (q) => searchInternetArchive(q) },
];

export async function runUnifiedSearch(
  query: string,
  yearMin: number | null,
  yearMax: number | null,
  selectedSources?: SourceProviderId[]
): Promise<SearchResponse> {
  const activeProviders =
    selectedSources && selectedSources.length > 0
      ? ALL_SEARCH_PROVIDERS.filter((p) => selectedSources.includes(p.id))
      : ALL_SEARCH_PROVIDERS;

  const results = await Promise.all(
    activeProviders.map(async (provider) => {
      const started = Date.now();
      try {
        const { records, cached } = await provider.fn(query, yearMin, yearMax);
        // Apply optional chronological filter for providers that don't natively filter by year range
        const filtered =
          yearMin !== null || yearMax !== null
            ? records.filter((rec) => {
                if (rec.source === 'atlaspi' || rec.source === 'vetustas') return true;
                if (rec.yearStart === null || rec.yearStart === undefined) return true;
                const start = rec.yearStart;
                const end = rec.yearEnd ?? rec.yearStart;
                if (yearMin !== null && end < yearMin) return false;
                if (yearMax !== null && start > yearMax) return false;
                return true;
              })
            : records;

        return {
          source: provider.id,
          label: provider.label,
          count: filtered.length,
          durationMs: Date.now() - started,
          cached,
          records: filtered,
        };
      } catch (err) {
        return {
          source: provider.id,
          label: provider.label,
          count: 0,
          durationMs: Date.now() - started,
          cached: false,
          error: err instanceof Error ? err.message : 'Upstream timeout',
          records: [] as HistoricalRecord[],
        };
      }
    })
  );

  // Interleave records across providers so top results reflect diverse primary archives
  const buckets = results.map((r) => [...r.records]);
  const interleaved: HistoricalRecord[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const bucket of buckets) {
      const next = bucket.shift();
      if (next) {
        interleaved.push(next);
        added = true;
      }
    }
  }

  return {
    query,
    yearMin,
    yearMax,
    sourcesQueried: activeProviders.map((p) => p.id),
    providerMetrics: results.map(({ records: _r, ...metric }) => metric),
    records: interleaved,
  };
}

// ============================================================================
// 6. REGISTRY & LIVE ENDPOINT DISCOVERY
// ============================================================================

export async function getApiRegistry(): Promise<RegistryResponse> {
  const cacheKey = 'registry:metadata';
  const hit = getCached<RegistryResponse>(cacheKey);
  if (hit) {
    return {
      ...hit,
      dayInHistoryQuota: {
        usedLastHour: getDayInHistoryQuotaUsed(),
        limitPerHour: DAY_IN_HISTORY_LIMIT_PER_HOUR,
        cachedEntries: cache.size,
      },
    };
  }

  const [vetustasRes, atlasStatsRes] = await Promise.allSettled([
    fetchJson<{
      datasets?: RegistryResponse['vetustasDatasets'];
    }>('https://api.vetustas.net/v1/datasets'),
    fetchJson<Record<string, unknown>>('https://atlaspi.it/v1/stats'),
  ]);

  const providers: ApiProviderMetadata[] = [
    {
      id: 'atlaspi',
      name: 'AtlasPI Historical Geography API',
      baseUrl: 'https://atlaspi.it/v1',
      docsUrl: 'https://atlaspi.it/docs',
      authRequired: false,
      rateLimit: '60 requests / minute',
      primaryUse: 'Historical empires, GeoJSON boundaries, rulers, battles, cities, archaeological sites, trade routes, and temporal reverse-geocoding.',
      verifiedNote: 'OpenAPI 3.1 verified across 23+ REST endpoints including /v1/snapshot/year/{year}, /v1/entities, /v1/where-was, and /v1/routes.',
      sampleEndpoints: [
        { label: 'Snapshot 1250 CE', url: 'https://atlaspi.it/v1/snapshot/year/1250' },
        { label: 'Active Rulers 117 CE', url: 'https://atlaspi.it/v1/rulers/at-year/117' },
        { label: 'Trade Routes', url: 'https://atlaspi.it/v1/routes?limit=5' },
        { label: 'Where Was (Rome, 117 CE)', url: 'https://atlaspi.it/v1/where-was?lat=41.9&lon=12.5&year=117' },
      ],
    },
    {
      id: 'vetustas',
      name: 'Vetustas Historical Data API',
      baseUrl: 'https://api.vetustas.net/v1',
      docsUrl: 'https://docs.vetustas.net/',
      authRequired: false,
      rateLimit: '60 requests / minute',
      primaryUse: 'Curated datasets covering historical people, events, inventions, landmarks, fine art, literature, and historic institutions.',
      verifiedNote: 'Live catalog discovered at /v1/datasets exposing 14 distinct collections with negative BCE year filtering and Wikidata cross-references.',
      sampleEndpoints: [
        { label: 'Dataset Catalog', url: 'https://api.vetustas.net/v1/datasets' },
        { label: 'Inventions & Discoveries', url: 'https://api.vetustas.net/v1/inventions?page_size=5' },
        { label: 'Historical People', url: 'https://api.vetustas.net/v1/people?page_size=5' },
      ],
    },
    {
      id: 'dayinhistory',
      name: 'Day in History API',
      baseUrl: 'https://api.dayinhistory.dev/v1',
      docsUrl: 'https://dayinhistory.dev/docs',
      authRequired: false,
      rateLimit: '10 requests / hour (Free tier)',
      primaryUse: 'Calendar anniversaries (month/day) for notable historical events, births, and deaths.',
      verifiedNote: 'Verified active base URL is api.dayinhistory.dev (docs examples show .com) and month paths require full lowercase English month names (/v1/events/july/4/). Strictly scoped to calendar anniversaries.',
      sampleEndpoints: [
        { label: "Today's Events", url: 'https://api.dayinhistory.dev/v1/today/events/' },
        { label: 'July 4 Events', url: 'https://api.dayinhistory.dev/v1/events/july/4/' },
      ],
    },
    {
      id: 'wikimedia',
      name: 'Wikimedia REST & Wikipedia API',
      baseUrl: 'https://en.wikipedia.org/api/rest_v1',
      docsUrl: 'https://en.wikipedia.org/api/rest_v1/',
      authRequired: false,
      rateLimit: 'Polite User-Agent required',
      primaryUse: 'Cross-referenced encyclopedic summaries and On-This-Day calendar supplements.',
      verifiedNote: 'Complements Day in History with linked Wikipedia articles and historical thumbnails.',
      sampleEndpoints: [
        { label: 'On This Day (Nov 18)', url: 'https://en.wikipedia.org/api/rest_v1/feed/onthisday/selected/11/18' },
      ],
    },
    {
      id: 'wikidata',
      name: 'Wikidata Knowledge Graph API',
      baseUrl: 'https://www.wikidata.org/w/api.php',
      docsUrl: 'https://www.wikidata.org/wiki/Wikidata:REST_API',
      authRequired: false,
      rateLimit: 'Open public read access',
      primaryUse: 'Authoritative Q-ID entity resolution across empires, monarchs, treaties, and historical sites.',
      verifiedNote: 'Provides canonical entity Q-identifiers linked directly from AtlasPI and Vetustas records.',
      sampleEndpoints: [
        { label: 'Search Roman Empire', url: 'https://www.wikidata.org/w/api.php?action=wbsearchentities&search=Roman+Empire&language=en&format=json&limit=3' },
      ],
    },
    {
      id: 'cleveland',
      name: 'Cleveland Museum of Art Open Access',
      baseUrl: 'https://openaccess-api.clevelandart.org/api',
      docsUrl: 'https://openaccess-api.clevelandart.org/',
      authRequired: false,
      rateLimit: 'Open CC0 access',
      primaryUse: 'CC0 museum artifacts, provenance, archaeological dating, and high-resolution photographs.',
      verifiedNote: 'Returns direct open-access artifact records with earliest/latest creation years and museum photography.',
      sampleEndpoints: [
        { label: 'Roman Artifacts', url: 'https://openaccess-api.clevelandart.org/api/artworks/?q=roman&has_image=1&limit=3' },
      ],
    },
    {
      id: 'artic',
      name: 'Art Institute of Chicago API',
      baseUrl: 'https://api.artic.edu/api/v1',
      docsUrl: 'https://api.artic.edu/docs/',
      authRequired: false,
      rateLimit: '60 requests / minute',
      primaryUse: 'IIIF-backed fine art, manuscripts, antiquities, and historical decorative arts.',
      verifiedNote: 'Verified public search endpoint with IIIF image delivery.',
      sampleEndpoints: [
        { label: 'Ancient Rome Search', url: 'https://api.artic.edu/api/v1/artworks/search?q=ancient+rome&limit=3' },
      ],
    },
    {
      id: 'openlibrary',
      name: 'Open Library Archive API',
      baseUrl: 'https://openlibrary.org',
      docsUrl: 'https://openlibrary.org/developers/api',
      authRequired: false,
      rateLimit: 'Open public access',
      primaryUse: 'Historical monographs, primary-source bibliographies, and first-edition publication records.',
      verifiedNote: 'Direct bibliography lookup filtered to historical subjects.',
      sampleEndpoints: [
        { label: 'Roman History Texts', url: 'https://openlibrary.org/search.json?q=roman+empire+subject:history&limit=3' },
      ],
    },
    {
      id: 'internetarchive',
      name: 'Internet Archive Advanced Search',
      baseUrl: 'https://archive.org',
      docsUrl: 'https://archive.org/developers/',
      authRequired: false,
      rateLimit: 'Open public access',
      primaryUse: 'Digitized primary texts, historical chronicles, manuscripts, and out-of-copyright monographs.',
      verifiedNote: 'Verified JSON query interface scoped to digitized text collections.',
      sampleEndpoints: [
        { label: 'Roman Empire Texts', url: 'https://archive.org/advancedsearch.php?q=roman+empire+AND+mediatype:texts&rows=3&output=json' },
      ],
    },
  ];

  const payload: RegistryResponse = {
    providers,
    vetustasDatasets: vetustasRes.status === 'fulfilled' ? vetustasRes.value.datasets ?? [] : [],
    atlasStats: atlasStatsRes.status === 'fulfilled' ? atlasStatsRes.value : null,
    dayInHistoryQuota: {
      usedLastHour: getDayInHistoryQuotaUsed(),
      limitPerHour: DAY_IN_HISTORY_LIMIT_PER_HOUR,
      cachedEntries: cache.size,
    },
  };

  setCached(cacheKey, payload, 15 * 60 * 1000);
  return payload;
}

const ALLOWED_PROBE_HOSTS = new Set([
  'atlaspi.it',
  'api.vetustas.net',
  'api.dayinhistory.dev',
  'en.wikipedia.org',
  'www.wikidata.org',
  'openaccess-api.clevelandart.org',
  'api.artic.edu',
  'openlibrary.org',
  'archive.org',
]);

export async function probeAllowedEndpoint(targetUrl: string): Promise<{ status: number; durationMs: number; data: unknown }> {
  const parsed = new URL(targetUrl);
  if (parsed.protocol !== 'https:' || !ALLOWED_PROBE_HOSTS.has(parsed.hostname)) {
    throw new Error('Target URL must belong to a verified historical API host.');
  }

  // Respect Day in History rate limit during interactive probing too
  if (parsed.hostname === 'api.dayinhistory.dev') {
    const cached = getCached<unknown>(`probe:${targetUrl}`);
    if (cached) {
      return { status: 200, durationMs: 0, data: cached };
    }
    if (getDayInHistoryQuotaUsed() >= DAY_IN_HISTORY_LIMIT_PER_HOUR) {
      throw new Error('Day in History hourly free-tier limit (10 requests/hour) reached. Try again later or inspect cached responses.');
    }
    recordDayInHistoryRequest();
  }

  const started = Date.now();
  const data = await fetchJson<unknown>(targetUrl, 9000);
  if (parsed.hostname === 'api.dayinhistory.dev') {
    setCached(`probe:${targetUrl}`, data, 60 * 60 * 1000);
  }
  return { status: 200, durationMs: Date.now() - started, data };
}
