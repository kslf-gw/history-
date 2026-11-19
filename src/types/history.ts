export type SourceProviderId =
  | 'atlaspi'
  | 'vetustas'
  | 'dayinhistory'
  | 'wikimedia'
  | 'wikidata'
  | 'cleveland'
  | 'artic'
  | 'openlibrary'
  | 'internetarchive';

export type RecordCategory =
  | 'polity'
  | 'event'
  | 'person'
  | 'ruler'
  | 'site'
  | 'route'
  | 'invention'
  | 'landmark'
  | 'artwork'
  | 'literature'
  | 'archive'
  | 'concept';

export interface HistoricalRecord {
  id: string;
  externalId: string;
  source: SourceProviderId;
  sourceLabel: string;
  category: RecordCategory;
  title: string;
  nativeTitle?: string;
  nativeLang?: string;
  subtitle?: string;
  description: string;
  yearStart?: number | null;
  yearEnd?: number | null;
  dateDisplay?: string;
  region?: string;
  location?: string;
  coordinates?: { lat: number; lon: number };
  confidenceScore?: number | null;
  ethicalNotes?: string | null;
  imageUrl?: string | null;
  url?: string | null;
  wikidataQid?: string | null;
  metadata: Record<string, string | number | boolean | string[] | null | undefined>;
}

export interface SearchResponse {
  query: string;
  yearMin: number | null;
  yearMax: number | null;
  sourcesQueried: SourceProviderId[];
  providerMetrics: Array<{
    source: SourceProviderId;
    label: string;
    count: number;
    durationMs: number;
    cached: boolean;
    error?: string;
  }>;
  records: HistoricalRecord[];
}

export interface AtlasEntitySummary {
  id: number;
  name: string;
  name_original?: string;
  name_original_lang?: string;
  entity_type: string;
  year_start: number | null;
  year_end: number | null;
  continent?: string | null;
  confidence_score?: number | null;
  status?: string;
  capital?: { name: string; lat: number; lon: number } | null;
  boundary_geojson?: GeoJSONGeometry | null;
}

export interface GeoJSONGeometry {
  type: 'Polygon' | 'MultiPolygon' | 'LineString' | 'MultiLineString' | 'Point';
  coordinates: unknown;
}

export interface AtlasYearSnapshot {
  year: number;
  yearDisplay: string;
  periods: Array<{
    id: number;
    name: string;
    slug: string;
    period_type: string;
    region: string;
    year_start: number;
    year_end: number;
  }>;
  entityStats: {
    totalActive: number;
    byType: Record<string, number>;
  };
  entities: AtlasEntitySummary[];
  events: Array<{
    id: number;
    name: string;
    event_type: string;
    month: number | null;
    day: number | null;
    location_name: string | null;
    confidence_score: number | null;
  }>;
  rulers: Array<{
    id: number;
    name_original: string;
    name_regnal?: string | null;
    title?: string | null;
    reign_start: number | null;
    reign_end: number | null;
    entity_id: number | null;
    entity_name_fallback?: string | null;
    region?: string | null;
    description?: string | null;
  }>;
  routes: Array<{
    id: number;
    name_original: string;
    route_type: string;
    start_year: number | null;
    end_year: number | null;
    commodities?: string[];
    involves_slavery?: boolean;
    geometry_simplified?: GeoJSONGeometry | null;
  }>;
  sites: Array<{
    id: number;
    name_original: string;
    site_type: string;
    latitude: number;
    longitude: number;
    date_start: number | null;
    date_end: number | null;
    description?: string | null;
  }>;
  chains: Array<{
    id: number;
    name: string;
    chain_type: string;
    region: string;
  }>;
  vetustasMilestones: HistoricalRecord[];
}

export interface AtlasEntityDetail {
  id: number;
  entity_type: string;
  year_start: number | null;
  year_end: number | null;
  name_original: string;
  name_original_lang?: string;
  name_variants?: Array<{
    name: string;
    lang: string;
    context?: string | null;
  }>;
  capital?: { name: string; lat: number; lon: number } | null;
  boundary_geojson?: GeoJSONGeometry | null;
  boundary_source?: string | null;
  confidence_score?: number | null;
  status?: string;
  continent?: string | null;
  wikidata_qid?: string | null;
  ethical_notes?: string | null;
  sources?: Array<{
    title?: string;
    author?: string;
    year?: number | string;
    url?: string;
    citation?: string;
  }>;
  rulers?: Array<{
    id: number;
    name_original: string;
    title?: string;
    reign_start?: number | null;
    reign_end?: number | null;
  }>;
  predecessors?: Array<{ id: number; name_original: string; year_start?: number; year_end?: number }>;
  successors?: Array<{ id: number; name_original: string; year_start?: number; year_end?: number }>;
  events?: Array<{ id: number; name: string; event_type?: string; year_start?: number | null }>;
  periods?: Array<{ id: number; name: string; year_start?: number; year_end?: number }>;
}

export interface OnThisDayEntry {
  id: string;
  source: 'dayinhistory' | 'wikimedia' | 'atlaspi';
  sourceLabel: string;
  kind: 'event' | 'birth' | 'death';
  year: number | null;
  title: string;
  description: string;
  url?: string | null;
  thumbnailUrl?: string | null;
  month: number;
  day: number;
}

export interface OnThisDayResponse {
  month: number;
  monthName: string;
  day: number;
  isToday: boolean;
  epistemicNote: string;
  dayInHistoryQuota: {
    usedLastHour: number;
    limitPerHour: number;
    servedFromCache: boolean;
    rateLimitedFallback: boolean;
  };
  events: OnThisDayEntry[];
  births: OnThisDayEntry[];
  deaths: OnThisDayEntry[];
}

export interface ApiProviderMetadata {
  id: SourceProviderId;
  name: string;
  baseUrl: string;
  docsUrl: string;
  authRequired: boolean;
  rateLimit: string;
  primaryUse: string;
  verifiedNote: string;
  sampleEndpoints: Array<{ label: string; url: string }>;
  liveStats?: Record<string, unknown> | null;
}

export interface RegistryResponse {
  providers: ApiProviderMetadata[];
  vetustasDatasets: Array<{
    name: string;
    label: string;
    description: string;
    records: number;
    date_field: string | null;
    geo_field: string | null;
  }>;
  atlasStats: Record<string, unknown> | null;
  dayInHistoryQuota: {
    usedLastHour: number;
    limitPerHour: number;
    cachedEntries: number;
  };
}

export interface GeminiSynthesisResponse {
  headline: string;
  executiveSummary: string;
  chronologicalThreads: Array<{
    eraOrDate: string;
    insight: string;
    citedRecords: string[];
  }>;
  crossSourceObservations: string[];
  historiographicalGaps: string;
  model: string;
}

export interface GeminiComparisonResponse {
  title: string;
  overview: string;
  dimensions: Array<{
    dimension: string;
    analysis: string;
  }>;
  sourceDiscrepancies: string;
  model: string;
}

export type EpistemicTier = 'exact_date' | 'around_date' | 'historical_background';

export interface CountryEventRecord {
  id: string;
  tier: EpistemicTier;
  countryCode: string;
  countryName: string;
  source: SourceProviderId;
  sourceLabel: string;
  category:
    | 'political'
    | 'military'
    | 'cultural'
    | 'economic'
    | 'scientific'
    | 'social'
    | 'biographical'
    | 'sovereignty';
  title: string;
  summary: string;
  importanceContext?: string;
  dateLabel: string;
  sortDateValue: number;
  location?: string;
  people?: string[];
  imageUrl?: string | null;
  sourceUrl?: string | null;
  references?: string[];
}

export interface CountryHistoryBundle {
  countryCode: string;
  countryName: string;
  flag: string;
  capital: string;
  region: string;
  eraOverview?: string | null;
  sovereignPolities: Array<{
    id: number;
    name: string;
    entityType: string;
    yearStart: number | null;
    yearEnd: number | null;
  }>;
  rulersInOffice: Array<{
    name: string;
    title?: string | null;
    reignSpan: string;
    entityName?: string | null;
  }>;
  exactDateEvents: CountryEventRecord[];
  aroundDateEvents: CountryEventRecord[];
  backgroundEvents: CountryEventRecord[];
  galleryImages: Array<{
    title: string;
    imageUrl: string;
    sourceUrl?: string | null;
  }>;
}

export interface CountryHistoryResponse {
  year: number;
  month: number;
  monthName: string;
  day: number;
  dateDisplay: string;
  countries: CountryHistoryBundle[];
  unifiedTimeline: CountryEventRecord[];
  sourcesConsulted: Array<{
    name: string;
    recordCount: number;
    durationMs: number;
  }>;
}

export interface CountryComparisonAnalysis {
  headline: string;
  dateDisplay: string;
  executiveOverview: string;
  countrySummaries: Array<{
    countryName: string;
    politicalSituation: string;
    keyDevelopments: string;
    whyItMattered: string;
  }>;
  similarities: string[];
  differences: string[];
  internationalRelationships: string;
  evidenceScopeNote: string;
  model: string;
}

