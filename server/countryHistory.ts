import { COUNTRY_BY_CODE, countryFlagEmoji, type CountryEntry } from '../src/data/countries.ts';
import type {
  CountryEventRecord,
  CountryHistoryBundle,
  CountryHistoryResponse,
} from '../src/types/history.ts';
import { formatYearDisplay, getOnThisDayFeed, whereWasAtlasPI } from './historicalSources.ts';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const cache = new Map<string, { value: unknown; expiresAt: number }>();

function getCached<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value as T;
}

function setCached<T>(key: string, value: T, ttlMs = 15 * 60 * 1000): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function fetchJson<T>(url: string, timeoutMs = 8500): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'ArchivumCountryExplorer/1.0 (https://archivum.local; research@archivum.local)',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

function cleanWikitext(raw: string): { text: string; refs: string[] } {
  const refs: string[] = [];
  let text = raw;

  // Extract ref URLs or titles before stripping <ref>
  text = text.replace(/<ref[^>]*>([\s\S]*?)<\/ref>/gi, (_m, inner: string) => {
    const urlMatch = inner.match(/https?:\/\/[^\s|}]+/);
    const titleMatch = inner.match(/title\s*=\s*([^|}]+)/i);
    if (titleMatch && urlMatch) {
      refs.push(`${titleMatch[1].trim()} (${urlMatch[0]})`);
    } else if (urlMatch) {
      refs.push(urlMatch[0]);
    }
    return '';
  });
  text = text.replace(/<ref[^>]*\/>/gi, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  text = text.replace(/\{\{[^}]*\}\}/g, '');
  text = text.replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1');
  text = text.replace(/'{2,3}/g, '');
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return { text, refs: [...new Set(refs)].slice(0, 3) };
}

function classifyCategory(text: string): CountryEventRecord['category'] {
  const lower = text.toLowerCase();
  if (/(war|battle|army|military|troop|coup|rebellion|invasion|treaty|ceasefire|missile|weapon)/.test(lower)) {
    return 'military';
  }
  if (/(senate|congress|president|king|emperor|prime minister|parliament|election|law|act|constitution|government|derg|minister|diplomat|independence|republic)/.test(lower)) {
    return 'political';
  }
  if (/(econom|bank|trade|tariff|currency|famine|oil|market|nationaliz|strike|budget)/.test(lower)) {
    return 'economic';
  }
  if (/(scien|space|launch|discover|medicine|physics|nobel|invent|patent|university|observatory)/.test(lower)) {
    return 'scientific';
  }
  if (/(film|movie|novel|book|art|music|festival|olympic|theater|award|born|died|architect)/.test(lower)) {
    return 'cultural';
  }
  return 'social';
}

function matchesCountry(text: string, country: CountryEntry): boolean {
  const haystack = ` ${text.toLowerCase()} `;
  const terms = [country.name, country.atlasName, country.capital, ...country.aliases];
  return terms.some((term) => {
    const clean = term.trim().toLowerCase();
    if (clean.length < 3) return false;
    // Word-boundary-ish match for short terms like UK/US/PRC
    if (clean.length <= 4) {
      return new RegExp(`\\b${clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(haystack);
    }
    return haystack.includes(clean);
  });
}

function makeTitleFromBullet(text: string): string {
  const cleaned = text.replace(/^(Born|Died):\s*/i, '').trim();
  const firstSentence = cleaned.split(/\.\s+/)[0] ?? cleaned;
  return firstSentence.length > 96 ? `${firstSentence.slice(0, 93)}...` : firstSentence;
}

interface WikipediaMonthParse {
  exactDayBullets: Array<{ text: string; refs: string[] }>;
  monthBullets: Array<{ day: number; text: string; refs: string[] }>;
  pageUrl: string;
}

async function fetchWikipediaMonthPage(monthName: string, day: number, year: number): Promise<WikipediaMonthParse | null> {
  if (year < 1800) return null;
  const pageTitle = `${monthName} ${year}`;
  const cacheKey = `wp-month:${pageTitle}`;
  let wikitext = getCached<string>(cacheKey);

  if (wikitext === null) {
    try {
      const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(pageTitle)}&prop=revisions&rvprop=content&rvslots=main&format=json`;
      const data = await fetchJson<{
        query?: { pages?: Record<string, { missing?: string; revisions?: Array<{ slots?: { main?: { '*'?: string } } }> }> };
      }>(url);
      const page = Object.values(data.query?.pages ?? {})[0];
      wikitext = page?.revisions?.[0]?.slots?.main?.['*'] ?? '';
      setCached(cacheKey, wikitext, 60 * 60 * 1000);
    } catch {
      return null;
    }
  }

  if (!wikitext) return null;

  const exactDayBullets: Array<{ text: string; refs: string[] }> = [];
  const monthBullets: Array<{ day: number; text: string; refs: string[] }> = [];

  // Match ==Month Day, Year...== sections
  const sectionRegex = new RegExp(`==\\s*${monthName}\\s+(\\d{1,2})(?:,\\s*${year})?[^=]*==([\\s\\S]*?)(?=\\n==[^=]|$)`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(wikitext)) !== null) {
    const secDay = Number.parseInt(match[1], 10);
    const body = match[2];
    const lines = body.split('\n').filter((l) => /^\*+/.test(l.trim()) && !/^\*\s*'''?(Born|Died)/i.test(l.trim()));
    for (const line of lines) {
      const { text, refs } = cleanWikitext(line.replace(/^\*+\s*/, ''));
      if (text.length < 24 || /^(Born|Died)\s*[:–-]/i.test(text)) continue;
      if (secDay === day) {
        exactDayBullets.push({ text, refs });
      } else if (Math.abs(secDay - day) <= 7) {
        monthBullets.push({ day: secDay, text, refs });
      }
    }
  }

  return {
    exactDayBullets,
    monthBullets,
    pageUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`,
  };
}

interface CountryYearPageResult {
  exactDayBullets: Array<{ text: string; refs: string[] }>;
  sameMonthBullets: Array<{ day: number | null; text: string; refs: string[] }>;
  annualBullets: Array<{ text: string; refs: string[] }>;
  pageUrl: string;
}

async function fetchWikipediaCountryYearPage(
  country: CountryEntry,
  year: number,
  monthName: string,
  day: number
): Promise<CountryYearPageResult | null> {
  if (year < 1700) return null;
  const candidateTitles = [...new Set([`${year} in ${country.wikiTitle}`, `${year} in ${country.name}`])];

  for (const title of candidateTitles) {
    const cacheKey = `wp-cy:${title}`;
    let wikitext = getCached<string>(cacheKey);
    if (wikitext === null) {
      try {
        const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=revisions&rvprop=content&rvslots=main&format=json`;
        const data = await fetchJson<{
          query?: { pages?: Record<string, { missing?: string; revisions?: Array<{ slots?: { main?: { '*'?: string } } }> }> };
        }>(url);
        const page = Object.values(data.query?.pages ?? {})[0];
        wikitext = page && !('missing' in page) ? page.revisions?.[0]?.slots?.main?.['*'] ?? '' : '';
        setCached(cacheKey, wikitext, 60 * 60 * 1000);
      } catch {
        wikitext = '';
      }
    }

    if (!wikitext) continue;

    const exactDayBullets: Array<{ text: string; refs: string[] }> = [];
    const sameMonthBullets: Array<{ day: number | null; text: string; refs: string[] }> = [];
    const annualBullets: Array<{ text: string; refs: string[] }> = [];

    // Look at == Events == section before Births/Deaths (handles piped Category headings too)
    const eventsSplit = wikitext.split(/\n==[^=\n]*(?:Births|Deaths|References|See also)[^=\n]*==/i)[0] ?? wikitext;
    const lines = eventsSplit.split('\n');

    let inTargetMonth = false;
    let currentDay: number | null = null;

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      const monthHeading = trimmed.match(/^===\s*([A-Za-z]+)\s*===$/);
      if (monthHeading) {
        inTargetMonth = monthHeading[1].toLowerCase() === monthName.toLowerCase();
        currentDay = null;
        continue;
      }

      if (!trimmed.startsWith('*')) continue;

      // Bullet like "* November 19 – ..." or "* November 19" header followed by "** ..."
      const dateLead = trimmed.match(new RegExp(`^\\*\\s*(?:\\[\\[)?${monthName}\\s+(\\d{1,2})(?:\\]\\])?\\s*(?:[–—:-]+\\s*(.*))?$`, 'i'));
      if (dateLead) {
        currentDay = Number.parseInt(dateLead[1], 10);
        if (dateLead[2]) {
          const { text, refs } = cleanWikitext(dateLead[2]);
          if (text.length > 20) {
            if (currentDay === day) exactDayBullets.push({ text, refs });
            else sameMonthBullets.push({ day: currentDay, text, refs });
          }
        }
        continue;
      }

      if (trimmed.startsWith('**') && currentDay !== null) {
        const { text, refs } = cleanWikitext(trimmed.replace(/^\*+\s*/, ''));
        if (text.length > 20) {
          if (currentDay === day) exactDayBullets.push({ text, refs });
          else sameMonthBullets.push({ day: currentDay, text, refs });
        }
        continue;
      }

      if (inTargetMonth) {
        const { text, refs } = cleanWikitext(trimmed.replace(/^\*+\s*/, ''));
        if (text.length > 24) {
          sameMonthBullets.push({ day: null, text, refs });
        }
      } else if (/^\*\s*\[?\[?[A-Za-z]+\s+\d{1,2}/.test(trimmed) && annualBullets.length < 8) {
        const { text, refs } = cleanWikitext(trimmed.replace(/^\*+\s*/, ''));
        if (text.length > 24 && !/^(Incumbents|President|Prime Minister|Monarch)/i.test(text)) {
          annualBullets.push({ text, refs });
        }
      }
    }

    return {
      exactDayBullets,
      sameMonthBullets: sameMonthBullets.slice(0, 8),
      annualBullets: annualBullets.slice(0, 6),
      pageUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    };
  }

  return null;
}

async function fetchWikipediaCountrySearch(
  country: CountryEntry,
  year: number,
  monthName: string,
  day: number
): Promise<{
  events: CountryEventRecord[];
  images: Array<{ title: string; imageUrl: string; sourceUrl?: string | null }>;
}> {
  const cacheKey = `wp-csearch:${country.code}:${year}`;
  const cachedPages = getCached<Array<{
    pageid: number;
    title: string;
    extract?: string;
    fullurl?: string;
    thumbnail?: { source?: string };
  }>>(cacheKey);

  let pages = cachedPages;
  if (!pages) {
    const q = `${country.name} ${year}`;
    const url = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=8&prop=extracts|pageimages|info&exintro=1&explaintext=1&exsentences=3&piprop=thumbnail&pithumbsize=500&inprop=url&format=json`;
    const res = await fetchJson<{
      query?: {
        pages?: Record<
          string,
          {
            pageid: number;
            title: string;
            extract?: string;
            fullurl?: string;
            thumbnail?: { source?: string };
          }
        >;
      };
    }>(url);
    pages = Object.values(res.query?.pages ?? {});
    setCached(cacheKey, pages, 60 * 60 * 1000);
  }

  const events: CountryEventRecord[] = [];
  const images: Array<{ title: string; imageUrl: string; sourceUrl?: string | null }> = [];
  const seenTitles = new Set<string>();

  for (const p of pages) {
      if (!p.extract || seenTitles.has(p.title)) continue;
      if (/^(List of|Timeline of|Index of)/i.test(p.title) && events.length >= 4) continue;
      if (/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}|\d{4})$/i.test(p.title)) continue;
      if (/^\d{4}\s+in\s+/i.test(p.title)) continue;
      seenTitles.add(p.title);

      if (p.thumbnail?.source) {
        images.push({
          title: p.title,
          imageUrl: p.thumbnail.source,
          sourceUrl: p.fullurl ?? `https://en.wikipedia.org/?curid=${p.pageid}`,
        });
      }

      const mentionsExact =
        p.extract.toLowerCase().includes(`${monthName.toLowerCase()} ${day}, ${year}`) ||
        p.extract.toLowerCase().includes(`${day} ${monthName.toLowerCase()} ${year}`);
      const mentionsYear = p.extract.includes(String(year)) || p.title.includes(String(year));

      events.push({
        id: `wp-search:${country.code}:${p.pageid}`,
        tier: mentionsExact ? 'exact_date' : mentionsYear ? 'around_date' : 'historical_background',
        countryCode: country.code,
        countryName: country.name,
        source: 'wikimedia',
        sourceLabel: 'Wikipedia',
        category: classifyCategory(`${p.title} ${p.extract}`),
        title: p.title,
        summary: p.extract,
        dateLabel: mentionsExact ? `${monthName} ${day}, ${year}` : mentionsYear ? `${formatYearDisplay(year)}` : `Era context (${formatYearDisplay(year)})`,
        sortDateValue: year * 10000 + (mentionsExact ? 100 : 0),
        location: country.name,
        imageUrl: p.thumbnail?.source ?? null,
        sourceUrl: p.fullurl ?? `https://en.wikipedia.org/?curid=${p.pageid}`,
      });
  }

  return { events: events.slice(0, 8), images: images.slice(0, 6) };
}

async function fetchVetustasCountryYear(country: CountryEntry, year: number): Promise<CountryEventRecord[]> {
  const yearMin = year - 2;
  const yearMax = year + 2;
  const datasets = ['events', 'people', 'inventions', 'landmarks'];
  const out: CountryEventRecord[] = [];

  const results = await Promise.allSettled(
    datasets.map((ds) =>
      fetchJson<{ records?: Array<Record<string, unknown>> }>(
        `https://api.vetustas.net/v1/${ds}?q=${encodeURIComponent(country.name)}&year_min=${yearMin}&year_max=${yearMax}&page_size=4`
      )
    )
  );

  results.forEach((res, idx) => {
    if (res.status !== 'fulfilled') return;
    const ds = datasets[idx];
    for (const rec of res.value.records ?? []) {
      const title = String(rec.title ?? rec.name ?? 'Milestone');
      const rawDate = String(rec.start_date ?? rec.date ?? rec.date_of_birth ?? year);
      const parsedYearMatch = rawDate.match(/^(-?\d{1,5})/);
      const recYear = parsedYearMatch ? Number.parseInt(parsedYearMatch[1], 10) : year;
      out.push({
        id: `vetustas-cy:${country.code}:${ds}:${String(rec.id)}`,
        tier: recYear === year ? 'around_date' : 'historical_background',
        countryCode: country.code,
        countryName: country.name,
        source: 'vetustas',
        sourceLabel: 'Vetustas',
        category: ds === 'people' ? 'biographical' : ds === 'inventions' ? 'scientific' : 'cultural',
        title,
        summary: [
          rec.era ? `Era: ${String(rec.era)}.` : null,
          rec.occupation ? `Role: ${String(rec.occupation)}.` : null,
          rec.inventor ? `Inventor: ${String(rec.inventor)}.` : null,
          rec.location ? `Location: ${String(rec.location)}.` : null,
          rec.country ? `Country: ${String(rec.country)}.` : null,
        ]
          .filter(Boolean)
          .join(' ') || `Recorded in Vetustas ${ds} dataset.`,
        dateLabel: rawDate,
        sortDateValue: recYear * 10000,
        location: String(rec.location ?? rec.country ?? country.name),
        imageUrl: typeof rec.image === 'string' ? rec.image : null,
        sourceUrl: typeof rec.reference_url === 'string' ? rec.reference_url : null,
      });
    }
  });

  return out;
}

export async function fetchCountryHistoryForDate(
  year: number,
  month: number,
  day: number,
  countryCodes: string[]
): Promise<CountryHistoryResponse> {
  const validCountries = countryCodes
    .map((code) => COUNTRY_BY_CODE.get(code.toUpperCase()))
    .filter((c): c is CountryEntry => Boolean(c));

  if (validCountries.length === 0) {
    throw new Error('Select at least one valid country.');
  }

  const monthName = MONTH_NAMES[month - 1] ?? 'January';
  const dateDisplay = `${monthName} ${day}, ${formatYearDisplay(year)}`;

  const cacheKey = `ch:${year}:${month}:${day}:${validCountries.map((c) => c.code).sort().join(',')}`;
  const hit = getCached<CountryHistoryResponse>(cacheKey);
  if (hit) return hit;

  const sourceTimings: Array<{ name: string; recordCount: number; durationMs: number }> = [];

  // Shared feeds for the exact date: Wikipedia Month-Year, OnThisDay (DayInHistory + Wikimedia + AtlasPI OTD), AtlasPI Rulers + Events
  const tSharedStart = Date.now();
  const [wpMonthRes, otdRes, atlasRulersRes, atlasEventsRes] = await Promise.allSettled([
    fetchWikipediaMonthPage(monthName, day, year),
    getOnThisDayFeed(month, day),
    fetchJson<{
      rulers?: Array<{
        id: number;
        name_original: string;
        title?: string | null;
        reign_start?: number | null;
        reign_end?: number | null;
        entity_id?: number | null;
        entity_name_fallback?: string | null;
        region?: string | null;
      }>;
    }>(`https://atlaspi.it/v1/rulers/at-year/${year}`),
    fetchJson<{
      events?: Array<{
        id: number;
        name: string;
        event_type: string;
        year_start?: number | null;
        month?: number | null;
        day?: number | null;
        location_name?: string | null;
      }>;
    }>(`https://atlaspi.it/v1/events?year_min=${year - 1}&year_max=${year + 1}&limit=40`),
  ]);

  const wpMonth = wpMonthRes.status === 'fulfilled' ? wpMonthRes.value : null;
  const otdFeed = otdRes.status === 'fulfilled' ? otdRes.value : null;
  const globalRulers = atlasRulersRes.status === 'fulfilled' ? atlasRulersRes.value.rulers ?? [] : [];
  const globalAtlasEvents = atlasEventsRes.status === 'fulfilled' ? atlasEventsRes.value.events ?? [] : [];

  sourceTimings.push({
    name: 'Wikipedia Date Chronicles & On-This-Day',
    recordCount:
      (wpMonth?.exactDayBullets.length ?? 0) +
      (otdFeed ? otdFeed.events.length + otdFeed.births.length + otdFeed.deaths.length : 0),
    durationMs: Date.now() - tSharedStart,
  });

  // Per-country parallel enrichment
  const bundles = await Promise.all(
    validCountries.map(async (country): Promise<CountryHistoryBundle> => {
      const [whereWasRes, wpYearRes, wpSearchRes, vetustasRes] = await Promise.allSettled([
        whereWasAtlasPI(country.lat, country.lon, year),
        fetchWikipediaCountryYearPage(country, year, monthName, day),
        fetchWikipediaCountrySearch(country, year, monthName, day),
        fetchVetustasCountryYear(country, year),
      ]);

      const whereWasEntitiesRaw =
        whereWasRes.status === 'fulfilled' &&
        Array.isArray((whereWasRes.value as { entities?: unknown[] })?.entities)
          ? (
              whereWasRes.value as {
                entities: Array<{
                  id: number;
                  name?: string;
                  name_original?: string;
                  entity_type?: string;
                  year_start?: number | null;
                  year_end?: number | null;
                }>;
              }
            ).entities
          : [];

      const sovereignPolities = whereWasEntitiesRaw.map((e) => ({
        id: e.id,
        name: e.name_original ?? e.name ?? 'Polity',
        entityType: e.entity_type ?? 'state',
        yearStart: e.year_start ?? null,
        yearEnd: e.year_end ?? null,
      }));

      const polityIds = new Set(sovereignPolities.map((p) => p.id));
      const matchedRulers = globalRulers
        .filter(
          (r) =>
            (r.entity_id && polityIds.has(r.entity_id)) ||
            matchesCountry(`${r.name_original} ${r.entity_name_fallback ?? ''} ${r.region ?? ''}`, country)
        )
        .map((r) => ({
          name: r.name_original,
          title: r.title,
          reignSpan: `${r.reign_start ?? '?'}–${r.reign_end ?? '?'}`,
          entityName: r.entity_name_fallback,
        }));

      const exactDateEvents: CountryEventRecord[] = [];
      const aroundDateEvents: CountryEventRecord[] = [];
      const backgroundEvents: CountryEventRecord[] = [];
      const seenTexts = new Set<string>();

      const pushUnique = (list: CountryEventRecord[], rec: CountryEventRecord) => {
        const sig = rec.title.toLowerCase().slice(0, 48);
        if (seenTexts.has(sig)) return;
        seenTexts.add(sig);
        list.push(rec);
      };

      // 1. Wikipedia Month-Year exact day matches for this country
      if (wpMonth) {
        wpMonth.exactDayBullets.forEach((b, idx) => {
          if (matchesCountry(b.text, country)) {
            pushUnique(exactDateEvents, {
              id: `wp-m-exact:${country.code}:${idx}`,
              tier: 'exact_date',
              countryCode: country.code,
              countryName: country.name,
              source: 'wikimedia',
              sourceLabel: 'Wikipedia Chronicle',
              category: classifyCategory(b.text),
              title: makeTitleFromBullet(b.text),
              summary: b.text,
              dateLabel: `${monthName} ${day}, ${year}`,
              sortDateValue: year * 10000 + month * 100 + day,
              location: country.name,
              sourceUrl: wpMonth.pageUrl,
              references: b.refs,
            });
          }
        });

        wpMonth.monthBullets.forEach((b, idx) => {
          if (matchesCountry(b.text, country)) {
            pushUnique(aroundDateEvents, {
              id: `wp-m-near:${country.code}:${idx}`,
              tier: 'around_date',
              countryCode: country.code,
              countryName: country.name,
              source: 'wikimedia',
              sourceLabel: 'Wikipedia Chronicle',
              category: classifyCategory(b.text),
              title: makeTitleFromBullet(b.text),
              summary: b.text,
              dateLabel: `${monthName} ${b.day}, ${year}`,
              sortDateValue: year * 10000 + month * 100 + b.day,
              location: country.name,
              sourceUrl: wpMonth.pageUrl,
              references: b.refs,
            });
          }
        });
      }

      // 2. Wikipedia "{Year} in {Country}" page
      if (wpYearRes.status === 'fulfilled' && wpYearRes.value) {
        const cy = wpYearRes.value;
        cy.exactDayBullets.forEach((b, idx) => {
          pushUnique(exactDateEvents, {
            id: `wp-cy-exact:${country.code}:${idx}`,
            tier: 'exact_date',
            countryCode: country.code,
            countryName: country.name,
            source: 'wikimedia',
            sourceLabel: 'Wikipedia Year Archive',
            category: classifyCategory(b.text),
            title: makeTitleFromBullet(b.text),
            summary: b.text,
            dateLabel: `${monthName} ${day}, ${year}`,
            sortDateValue: year * 10000 + month * 100 + day,
            location: country.name,
            sourceUrl: cy.pageUrl,
            references: b.refs,
          });
        });

        cy.sameMonthBullets.forEach((b, idx) => {
          pushUnique(aroundDateEvents, {
            id: `wp-cy-month:${country.code}:${idx}`,
            tier: 'around_date',
            countryCode: country.code,
            countryName: country.name,
            source: 'wikimedia',
            sourceLabel: 'Wikipedia Year Archive',
            category: classifyCategory(b.text),
            title: makeTitleFromBullet(b.text),
            summary: b.text,
            dateLabel: b.day ? `${monthName} ${b.day}, ${year}` : `${monthName} ${year}`,
            sortDateValue: year * 10000 + month * 100 + (b.day ?? day),
            location: country.name,
            sourceUrl: cy.pageUrl,
            references: b.refs,
          });
        });

        cy.annualBullets.forEach((b, idx) => {
          pushUnique(backgroundEvents, {
            id: `wp-cy-annual:${country.code}:${idx}`,
            tier: 'historical_background',
            countryCode: country.code,
            countryName: country.name,
            source: 'wikimedia',
            sourceLabel: 'Wikipedia Year Archive',
            category: classifyCategory(b.text),
            title: makeTitleFromBullet(b.text),
            summary: b.text,
            dateLabel: `${formatYearDisplay(year)}`,
            sortDateValue: year * 10000,
            location: country.name,
            sourceUrl: cy.pageUrl,
            references: b.refs,
          });
        });
      }

      // 3. Day in History + Wikimedia REST On This Day (filtered strictly by targetYear or ±2 yrs AND country!)
      if (otdFeed) {
        const allOtd = [
          ...otdFeed.events.map((e) => ({ ...e, kind: 'event' as const })),
          ...otdFeed.births.map((e) => ({ ...e, kind: 'birth' as const })),
          ...otdFeed.deaths.map((e) => ({ ...e, kind: 'death' as const })),
        ];
        for (const item of allOtd) {
          if (item.year === null) continue;
          const diff = Math.abs(item.year - year);
          if (diff > 2) continue;
          const combined = `${item.title} ${item.description}`;
          if (!matchesCountry(combined, country)) continue;

          const tier = item.year === year ? 'exact_date' : 'around_date';
          const targetList = tier === 'exact_date' ? exactDateEvents : aroundDateEvents;
          pushUnique(targetList, {
            id: `otd:${country.code}:${item.id}`,
            tier,
            countryCode: country.code,
            countryName: country.name,
            source: item.source === 'dayinhistory' ? 'dayinhistory' : item.source === 'atlaspi' ? 'atlaspi' : 'wikimedia',
            sourceLabel: item.sourceLabel,
            category: item.kind === 'event' ? classifyCategory(combined) : 'biographical',
            title: item.kind === 'birth' ? `Born: ${item.title}` : item.kind === 'death' ? `Died: ${item.title}` : item.title,
            summary: item.description || item.title,
            dateLabel: `${monthName} ${day}, ${formatYearDisplay(item.year)}`,
            sortDateValue: item.year * 10000 + month * 100 + day,
            location: country.name,
            imageUrl: item.thumbnailUrl ?? null,
            sourceUrl: item.url ?? null,
          });
        }
      }

      // 4. AtlasPI Events & Sovereign Polities
      for (const ev of globalAtlasEvents) {
        const combined = `${ev.name} ${ev.location_name ?? ''}`;
        if (!matchesCountry(combined, country)) continue;
        const isExact = ev.year_start === year && ev.month === month && ev.day === day;
        const tier = isExact ? 'exact_date' : 'around_date';
        pushUnique(tier === 'exact_date' ? exactDateEvents : aroundDateEvents, {
          id: `atlas-ev:${country.code}:${ev.id}`,
          tier,
          countryCode: country.code,
          countryName: country.name,
          source: 'atlaspi',
          sourceLabel: 'AtlasPI',
          category: 'military',
          title: ev.name,
          summary: `${ev.event_type}${ev.location_name ? ` at ${ev.location_name}` : ''}.`,
          dateLabel:
            ev.month && ev.day
              ? `${MONTH_NAMES[ev.month - 1]} ${ev.day}, ${formatYearDisplay(ev.year_start)}`
              : formatYearDisplay(ev.year_start),
          sortDateValue: (ev.year_start ?? year) * 10000 + (ev.month ?? month) * 100 + (ev.day ?? day),
          location: ev.location_name ?? country.name,
          sourceUrl: `https://atlaspi.it/v1/events/${ev.id}`,
        });
      }

      if (sovereignPolities.length > 0) {
        const primary = sovereignPolities[0];
        pushUnique(backgroundEvents, {
          id: `atlas-polity:${country.code}:${primary.id}`,
          tier: 'historical_background',
          countryCode: country.code,
          countryName: country.name,
          source: 'atlaspi',
          sourceLabel: 'AtlasPI Geography',
          category: 'sovereignty',
          title: `Sovereign Polity: ${primary.name}`,
          summary: `Geographic coordinates for ${country.capital}, ${country.name} fell within ${primary.name} (${primary.entityType}, ${primary.yearStart ?? '?'}–${primary.yearEnd ?? 'Present'}).`,
          dateLabel: `${primary.yearStart ?? '?'}–${primary.yearEnd ?? 'Present'}`,
          sortDateValue: year * 10000,
          location: country.capital,
          sourceUrl: `https://atlaspi.it/v1/entities/${primary.id}`,
        });
      }

      // 5. Wikipedia country+year search & historical photos + Vetustas milestones
      const galleryImages: CountryHistoryBundle['galleryImages'] = [];
      if (wpSearchRes.status === 'fulfilled') {
        for (const ev of wpSearchRes.value.events) {
          if (ev.tier === 'exact_date') pushUnique(exactDateEvents, ev);
          else if (ev.tier === 'around_date') pushUnique(aroundDateEvents, ev);
          else pushUnique(backgroundEvents, ev);
        }
        galleryImages.push(...wpSearchRes.value.images);
      }

      if (vetustasRes.status === 'fulfilled') {
        for (const vRec of vetustasRes.value) {
          pushUnique(vRec.tier === 'around_date' ? aroundDateEvents : backgroundEvents, vRec);
          if (vRec.imageUrl && galleryImages.length < 6) {
            galleryImages.push({
              title: vRec.title,
              imageUrl: vRec.imageUrl,
              sourceUrl: vRec.sourceUrl,
            });
          }
        }
      }

      exactDateEvents.sort((a, b) => a.sortDateValue - b.sortDateValue);
      aroundDateEvents.sort((a, b) => a.sortDateValue - b.sortDateValue);
      backgroundEvents.sort((a, b) => a.sortDateValue - b.sortDateValue);

      return {
        countryCode: country.code,
        countryName: country.name,
        flag: countryFlagEmoji(country.code),
        capital: country.capital,
        region: country.region,
        sovereignPolities,
        rulersInOffice: matchedRulers.slice(0, 6),
        exactDateEvents,
        aroundDateEvents: aroundDateEvents.slice(0, 10),
        backgroundEvents: backgroundEvents.slice(0, 10),
        galleryImages: galleryImages.slice(0, 6),
      };
    })
  );

  const unifiedTimeline = bundles
    .flatMap((b) => [...b.exactDateEvents, ...b.aroundDateEvents])
    .sort((a, b) => {
      if (a.tier !== b.tier) {
        return a.tier === 'exact_date' ? -1 : 1;
      }
      return a.sortDateValue - b.sortDateValue;
    });

  sourceTimings.push(
    {
      name: 'AtlasPI Sovereign Geography & Rulers',
      recordCount: bundles.reduce((acc, b) => acc + b.sovereignPolities.length + b.rulersInOffice.length, 0),
      durationMs: Date.now() - tSharedStart,
    },
    {
      name: 'Vetustas & Wikipedia Country Archives',
      recordCount: unifiedTimeline.length + bundles.reduce((acc, b) => acc + b.backgroundEvents.length, 0),
      durationMs: Date.now() - tSharedStart,
    }
  );

  const response: CountryHistoryResponse = {
    year,
    month,
    monthName,
    day,
    dateDisplay,
    countries: bundles,
    unifiedTimeline,
    sourcesConsulted: sourceTimings,
  };

  setCached(cacheKey, response, 15 * 60 * 1000);
  return response;
}
