import * as cheerio from 'cheerio';
import pino from 'pino';
import { config } from '../config';

const logger = pino({ level: config.LOG_LEVEL });

export interface CrawledContent {
  title: string;
  body: string;
  rawHtml?: string;
}

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
}
