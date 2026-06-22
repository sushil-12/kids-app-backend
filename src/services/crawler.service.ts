import * as cheerio from 'cheerio';
import pino from 'pino';
import { config } from '../config';

const logger = pino({ level: config.LOG_LEVEL });

export interface CrawledContent {
  title: string;
  body: string;
  rawHtml?: string;
}

/// Path fragments that are never article content (nav, taxonomy, account, etc.).
const NON_ARTICLE_PATTERNS =
  /\/(category|categories|tag|tags|author|page|wp-login|wp-admin|feed|about|contact|privacy|terms|search|login|signup|account|cart|subscribe|advertise|sitemap)(\/|$|\?|#)/i;

/// File extensions that aren't pages.
const ASSET_EXT = /\.(jpg|jpeg|png|gif|svg|webp|pdf|zip|mp3|mp4|css|js|xml|rss)(\?|$)/i;

const MAX_DISCOVERED_LINKS = 25;

export class CrawlerService {
  private domainRequestTimestamps: Map<string, number> = new Map();
  private readonly rateLimitMs = 2000;

  private getDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  private async respectRateLimit(url: string): Promise<void> {
    const domain = this.getDomain(url);
    const lastRequest = this.domainRequestTimestamps.get(domain);
    if (lastRequest) {
      const elapsed = Date.now() - lastRequest;
      if (elapsed < this.rateLimitMs) {
        await new Promise((resolve) => setTimeout(resolve, this.rateLimitMs - elapsed));
      }
    }
    this.domainRequestTimestamps.set(domain, Date.now());
  }

  /// Fetches a URL's text with the polite bot UA + timeout. Returns null on
  /// any non-OK response or network error.
  private async fetchText(url: string): Promise<string | null> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'BrightMindBot/1.0 (educational content indexer; contact: admin@brightmindkids.com)',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        logger.warn({ url, status: response.status }, 'Fetch failed: non-OK response');
        return null;
      }
      return await response.text();
    } catch (err) {
      logger.error({ url, err }, 'Fetch error');
      return null;
    }
  }

  async fetchAndParse(url: string): Promise<CrawledContent | null> {
    await this.respectRateLimit(url);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'BrightMindBot/1.0 (educational content indexer; contact: admin@brightmindkids.com)',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        logger.warn({ url, status: response.status }, 'Crawl failed: non-OK response');
        return null;
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Remove noise
      $('nav, header, footer, script, style, .ad, .advertisement, .sidebar, .cookie-banner').remove();

      const title = $('h1').first().text().trim() || $('title').text().trim();

      // Extract main content
      const contentSelectors = ['article', 'main', '.content', '.story', '.post-content', '#content'];
      let bodyText = '';

      for (const selector of contentSelectors) {
        const el = $(selector).first();
        if (el.length) {
          bodyText = el.text();
          break;
        }
      }

      if (!bodyText) {
        bodyText = $('body').text();
      }

      // Normalize whitespace
      bodyText = bodyText.replace(/\s+/g, ' ').trim().slice(0, 5000);

      logger.info({ url, titleLength: title.length, bodyLength: bodyText.length }, 'Crawled page');

      return { title, body: bodyText };
    } catch (err) {
      logger.error({ url, err }, 'Crawl error');
      return null;
    }
  }

  /// Discovers individual article links on a trusted index/listing page.
  ///
  /// RSS-first: most kids-content sites are WordPress and expose a clean feed of
  /// real article permalinks, which is far more reliable than scraping HTML. The
  /// order is: (1) the URL is itself a feed, (2) a feed declared in the page
  /// <head>, (3) the conventional `{url}/feed/` path, (4) an HTML anchor
  /// heuristic as a last resort. Stays strictly on the root's own domain.
  async discoverLinks(indexUrl: string): Promise<string[]> {
    await this.respectRateLimit(indexUrl);
    // The index page may bot-block (Cloudflare 404/403) even when its feed is
    // open, so a null body here is NOT fatal — we still try the feed paths.
    const body = await this.fetchText(indexUrl);

    // (1) The URL is already a feed.
    if (body && this.looksLikeFeed(body)) {
      return this.finalize(this.parseFeedLinks(body), indexUrl);
    }

    const $ = body ? cheerio.load(body) : null;

    // Build the ordered list of feed URLs to try.
    const feedCandidates: string[] = [];
    // (2) A feed declared in the page <head> (most accurate when available).
    const declared = $?.('link[type="application/rss+xml"], link[type="application/atom+xml"]')
      .first()
      .attr('href');
    if (declared) feedCandidates.push(this.resolve(declared, indexUrl));
    // (3) Conventional WordPress feed paths: this section's feed, then the site feed.
    feedCandidates.push(indexUrl.replace(/\/?$/, '/') + 'feed/');
    try {
      feedCandidates.push(new URL('/feed/', indexUrl).toString());
    } catch {
      /* ignore */
    }

    for (const feedUrl of feedCandidates) {
      if (!feedUrl) continue;
      await this.respectRateLimit(feedUrl);
      const feed = await this.fetchText(feedUrl);
      if (feed && this.looksLikeFeed(feed)) {
        const links = this.finalize(this.parseFeedLinks(feed), indexUrl);
        if (links.length) {
          logger.info({ indexUrl, feedUrl, discovered: links.length }, 'Discovered via RSS');
          return links;
        }
      }
    }

    // (4) HTML fallback: only links in post-title positions, to avoid pulling in
    // nav/sidebar/section links. Skipped if the index page couldn't be fetched.
    if (!$) {
      logger.warn({ indexUrl }, 'Discovery found no feed and index page was unreachable');
      return [];
    }
    const heuristic: string[] = [];
    $('h1 a[href], h2 a[href], h3 a[href], article a[href], .post a[href], .entry a[href], .entry-title a[href], .post-title a[href]')
      .each((_, el) => {
        const href = $(el).attr('href');
        if (href) heuristic.push(this.resolve(href, indexUrl));
      });
    const links = this.finalize(heuristic, indexUrl);
    logger.info({ indexUrl, discovered: links.length }, 'Discovered via HTML heuristic');
    return links;
  }

  /// Cheap check for RSS/Atom markup.
  private looksLikeFeed(text: string): boolean {
    const head = text.slice(0, 1000).toLowerCase();
    return head.includes('<rss') || head.includes('<feed') || head.includes('<rdf');
  }

  /// Extracts item permalinks from RSS 2.0 (`<item><link>text</link>`) or Atom
  /// (`<entry><link href>`).
  private parseFeedLinks(xml: string): string[] {
    const $ = cheerio.load(xml, { xmlMode: true });
    const out: string[] = [];
    $('item > link, entry > link').each((_, el) => {
      const e = $(el);
      const href = (e.attr('href') ?? e.text()).trim();
      if (href) out.push(href);
    });
    return out;
  }

  private resolve(href: string, base: string): string {
    try {
      const u = new URL(href, base);
      u.hash = '';
      return u.toString();
    } catch {
      return '';
    }
  }

  /// Same-domain filter + dedupe + asset/nav exclusion + cap.
  private finalize(urls: string[], indexUrl: string): string[] {
    let host: string;
    let selfNorm: string;
    try {
      host = new URL(indexUrl).hostname;
      selfNorm = indexUrl.replace(/\/$/, '');
    } catch {
      return [];
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of urls) {
      if (out.length >= MAX_DISCOVERED_LINKS) break;
      if (!raw) continue;
      let u: URL;
      try {
        u = new URL(raw);
      } catch {
        continue;
      }
      if (u.hostname !== host) continue;
      const norm = u.toString().replace(/\/$/, '');
      if (norm === selfNorm) continue;
      if (ASSET_EXT.test(u.pathname)) continue;
      if (NON_ARTICLE_PATTERNS.test(u.pathname)) continue;
      if (seen.has(norm)) continue;
      seen.add(norm);
      out.push(u.toString());
    }
    return out;
  }
}
