import type {
  CountryComparisonAnalysis,
  CountryEventRecord,
  CountryHistoryBundle,
} from '../src/types/history.ts';

async function fetchBilateralWikipediaNote(
  countries: CountryHistoryBundle[],
  yearLabel: string
): Promise<string | null> {
  if (countries.length < 2) return null;
  const [a, b] = countries;
  const yearMatch = yearLabel.match(/\d{3,4}/);
  const yearNum = yearMatch ? Number.parseInt(yearMatch[0], 10) : null;

  // For historical dates prior to 2000, prefer a year-scoped Wikipedia search first
  if (yearNum && yearNum < 2000) {
    try {
      const q = `${a.countryName} ${b.countryName} ${yearNum}`;
      const url = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=2&prop=extracts&exintro=1&explaintext=1&exsentences=2&format=json`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'ArchivumCountryExplorer/1.0 (https://archivum.local; research@archivum.local)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(5500),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          query?: { pages?: Record<string, { title?: string; extract?: string }> };
        };
        const pages = Object.values(data.query?.pages ?? {}).filter(
          (p) => p.extract && p.extract.length > 40 && !/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i.test(p.title ?? '')
        );
        if (pages.length > 0) {
          const top = pages[0];
          return `${top.extract!.trim()} (Wikipedia: ${top.title})`;
        }
      }
    } catch {
      // fall through to bilateral relations summary
    }
  }

  const candidateTitles = [
    `${a.countryName}–${b.countryName} relations`,
    `${b.countryName}–${a.countryName} relations`,
  ];

  for (const title of candidateTitles) {
    try {
      const slug = encodeURIComponent(title.replace(/ /g, '_'));
      const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`, {
        headers: {
          'User-Agent': 'ArchivumCountryExplorer/1.0 (https://archivum.local; research@archivum.local)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(5500),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { extract?: string; type?: string };
      if (data.extract && data.type !== 'disambiguation' && data.extract.length > 40) {
        return `${data.extract.trim()} (Wikipedia: ${title})`;
      }
    } catch {
      // ignore timeout/not found
    }
  }

  return null;
}

function topEvents(events: CountryEventRecord[], count = 3): CountryEventRecord[] {
  return events.slice(0, count);
}

function summarizeCategoryProfile(bundle: CountryHistoryBundle): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ev of [...bundle.exactDateEvents, ...bundle.aroundDateEvents, ...bundle.backgroundEvents]) {
    counts.set(ev.category, (counts.get(ev.category) ?? 0) + 1);
  }
  return counts;
}

function dominantCategories(counts: Map<string, number>): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat]) => cat);
}

function formatEventCitation(ev: CountryEventRecord): string {
  return `${ev.title} (${ev.dateLabel}, ${ev.sourceLabel})`;
}

export async function analyzeCountryComparison(
  dateDisplay: string,
  countries: CountryHistoryBundle[]
): Promise<CountryComparisonAnalysis> {
  if (!countries || countries.length === 0) {
    throw new Error('At least one country history bundle is required.');
  }

  const bilateralWikiNote = await fetchBilateralWikipediaNote(countries, dateDisplay);

  const totalExact = countries.reduce((acc, c) => acc + c.exactDateEvents.length, 0);
  const totalAround = countries.reduce((acc, c) => acc + c.aroundDateEvents.length, 0);
  const totalBg = countries.reduce((acc, c) => acc + c.backgroundEvents.length, 0);

  const countryNames = countries.map((c) => c.countryName);
  const headline =
    countries.length >= 2
      ? `${dateDisplay}: ${countryNames.join(' & ')}`
      : `${dateDisplay} in ${countryNames[0]}`;

  // Executive Overview built strictly from retrieved records
  const overviewParts: string[] = [];
  if (totalExact > 0) {
    const exactHighlights = countries
      .filter((c) => c.exactDateEvents.length > 0)
      .map((c) => {
        const lead = c.exactDateEvents[0];
        return `in ${c.countryName}, ${lead.sourceLabel} records "${lead.title}"`;
      })
      .join('; ');
    overviewParts.push(
      `Across ${dateDisplay}, external archives document ${totalExact} exact-date event${totalExact === 1 ? '' : 's'}: ${exactHighlights}.`
    );
  } else {
    overviewParts.push(
      `No country-specific events matched the exact calendar day of ${dateDisplay} across the queried feeds; the synthesis below draws on ${totalAround} surrounding-date records and ${totalBg} historical background entries.`
    );
  }

  const polityOverview = countries
    .filter((c) => c.sovereignPolities.length > 0 || c.rulersInOffice.length > 0)
    .map((c) => {
      const polity = c.sovereignPolities[0]?.name;
      const ruler = c.rulersInOffice[0];
      const parts = [
        polity ? `mapped under ${polity}` : null,
        ruler ? `leadership including ${ruler.name}${ruler.title ? ` (${ruler.title})` : ''}` : null,
      ].filter(Boolean);
      return `${c.countryName} (${parts.join(', ')})`;
    });
  if (polityOverview.length > 0) {
    overviewParts.push(`Governance and territorial context: ${polityOverview.join('; ')}.`);
  }

  const countrySummaries = countries.map((bundle) => {
    const politiesText =
      bundle.sovereignPolities.length > 0
        ? `AtlasPI maps ${bundle.capital} within ${bundle.sovereignPolities.map((p) => `${p.name} (${p.entityType})`).join(', ')}.`
        : `${bundle.countryName} (${bundle.region}, capital ${bundle.capital}).`;

    const rulersText =
      bundle.rulersInOffice.length > 0
        ? ` Recorded officeholders: ${bundle.rulersInOffice
            .slice(0, 4)
            .map((r) => `${r.name}${r.title ? ` (${r.title})` : ''}`)
            .join('; ')}.`
        : '';

    const politicalEvents = [...bundle.exactDateEvents, ...bundle.aroundDateEvents]
      .filter((e) => e.category === 'political' || e.category === 'military' || e.category === 'sovereignty')
      .slice(0, 2);

    const politicalNote =
      politicalEvents.length > 0
        ? ` Key political/military items: ${politicalEvents.map((e) => e.title).join('; ')}.`
        : '';

    const politicalSituation = `${politiesText}${rulersText}${politicalNote}`.trim();

    const exactTop = topEvents(bundle.exactDateEvents, 3);
    const aroundTop = topEvents(bundle.aroundDateEvents, 3);
    const keyDevelopments =
      exactTop.length > 0
        ? `Exact date (${dateDisplay}): ${exactTop.map(formatEventCitation).join(' · ')}.${
            aroundTop.length > 0
              ? ` Nearby period: ${aroundTop.slice(0, 2).map(formatEventCitation).join(' · ')}.`
              : ''
          }`
        : aroundTop.length > 0
          ? `Surrounding period records: ${aroundTop.map(formatEventCitation).join(' · ')}.`
          : bundle.backgroundEvents.length > 0
            ? `Year & era context: ${topEvents(bundle.backgroundEvents, 2).map(formatEventCitation).join(' · ')}.`
            : 'No specific dated developments were returned by the open archives for this query.';

    const bgLead = bundle.backgroundEvents[0];
    const whyItMattered = bundle.eraOverview
      ? bundle.eraOverview
      : bgLead
        ? `${bgLead.summary} (${bgLead.sourceLabel})`
        : `Historical significance is anchored in ${bundle.exactDateEvents.length} exact-date, ${bundle.aroundDateEvents.length} nearby, and ${bundle.backgroundEvents.length} background records retrieved from open archives.`;

    return {
      countryName: bundle.countryName,
      politicalSituation,
      keyDevelopments,
      whyItMattered,
    };
  });

  // Compute similarities & differences strictly from retrieved evidence
  const similarities: string[] = [];
  const differences: string[] = [];

  if (countries.length >= 2) {
    const profiles = countries.map((c) => ({
      name: c.countryName,
      counts: summarizeCategoryProfile(c),
      dominant: dominantCategories(summarizeCategoryProfile(c)),
    }));

    const sharedCats = profiles[0].dominant.filter((cat) =>
      profiles.slice(1).every((p) => (p.counts.get(cat) ?? 0) > 0)
    );
    if (sharedCats.length > 0) {
      similarities.push(
        `All selected countries have documented archival activity in ${sharedCats.join(', ')} themes during this period.`
      );
    }

    const countriesWithExact = countries.filter((c) => c.exactDateEvents.length > 0);
    if (countriesWithExact.length >= 2) {
      similarities.push(
        `${countriesWithExact.map((c) => c.countryName).join(' and ')} both record verified events on the exact day of ${dateDisplay}.`
      );
    }

    const regions = new Set(countries.map((c) => c.region));
    if (regions.size === 1) {
      similarities.push(`All selected countries share the same geographic region (${countries[0].region}).`);
    } else {
      differences.push(
        `Distinct regional contexts: ${countries.map((c) => `${c.countryName} (${c.region})`).join(' vs. ')}.`
      );
    }

    const polityComparison = countries.map(
      (c) =>
        `${c.countryName}: ${
          c.sovereignPolities[0]?.name ??
          c.rulersInOffice[0]?.title ??
          'national governance records'
        }`
    );
    differences.push(`Governance & polity structure: ${polityComparison.join(' · ')}.`);

    const dominantDiffs = profiles.map(
      (p) => `${p.name} (${p.dominant.length > 0 ? p.dominant.join(', ') : 'general background'})`
    );
    differences.push(`Primary documented themes: ${dominantDiffs.join(' vs. ')}.`);

    const coverageCounts = countries.map(
      (c) => `${c.countryName} (${c.exactDateEvents.length} exact / ${c.aroundDateEvents.length} near-date)`
    );
    differences.push(`Archival record distribution: ${coverageCounts.join(' · ')}.`);
  } else {
    const only = countries[0];
    const dom = dominantCategories(summarizeCategoryProfile(only));
    similarities.push(
      `Primary documented themes in ${only.countryName}: ${dom.length > 0 ? dom.join(', ') : 'general history'}.`
    );
    differences.push(
      `Select a second country above to generate cross-national parallels and contrasts for ${dateDisplay}.`
    );
  }

  // Scan for direct cross-country mentions inside retrieved event summaries
  const crossMentions: string[] = [];
  if (countries.length >= 2) {
    for (const sourceBundle of countries) {
      const otherCountries = countries.filter((o) => o.countryCode !== sourceBundle.countryCode);
      const allRecs = [
        ...sourceBundle.exactDateEvents,
        ...sourceBundle.aroundDateEvents,
        ...sourceBundle.backgroundEvents,
      ];
      for (const rec of allRecs) {
        const text = `${rec.title} ${rec.summary}`.toLowerCase();
        for (const target of otherCountries) {
          if (text.includes(target.countryName.toLowerCase())) {
            crossMentions.push(
              `${sourceBundle.countryName} record "${rec.title}" (${rec.dateLabel}) directly references ${target.countryName}.`
            );
          }
        }
      }
    }
  }

  const internationalRelationships =
    crossMentions.length > 0
      ? `${[...new Set(crossMentions)].slice(0, 3).join(' ')}${bilateralWikiNote ? ` ${bilateralWikiNote}` : ''}`
      : bilateralWikiNote ??
        (countries.length >= 2
          ? `No direct bilateral mention between ${countryNames.join(' and ')} appeared in the specific ${dateDisplay} event snippets; both countries are contextualized through their independent regional archives.`
          : `International context reflects ${countries[0].countryName}'s recorded developments within ${countries[0].region}.`);

  const sourceNames = [
    ...new Set(
      countries.flatMap((c) =>
        [...c.exactDateEvents, ...c.aroundDateEvents, ...c.backgroundEvents].map((e) => e.sourceLabel)
      )
    ),
  ];

  const evidenceScopeNote = `Keyless open-source synthesis across ${totalExact} exact-date, ${totalAround} around-date, and ${totalBg} background records from ${
    sourceNames.length > 0 ? sourceNames.join(', ') : 'Wikipedia, AtlasPI, and Vetustas'
  }. No external LLM or API key required.`;

  return {
    headline,
    dateDisplay,
    executiveOverview: overviewParts.join(' '),
    countrySummaries,
    similarities,
    differences,
    internationalRelationships,
    evidenceScopeNote,
    model: 'Open Archive Engine (Wikipedia · AtlasPI · Vetustas · Wikimedia)',
  };
}
