import Redis from 'ioredis';
import { Story, Poem, AbcLesson } from '@prisma/client';
import { OpenAIService } from './openai.service';
import {
  createStory,
  createPoem,
  upsertAbcLesson,
} from '../db/content.repo';

export class ContentService {
  private openai: OpenAIService;
  private redis: Redis;

  constructor(redis: Redis) {
    this.openai = new OpenAIService(redis);
    this.redis = redis;
  }

  async generateStory(ageBand: 'junior' | 'senior', date: string): Promise<Story> {
    const system = 'You are a warm children\'s storyteller. Output ONLY valid JSON.';
    const user = `Story for ${ageBand} kids (date: ${date}). JSON: {title, story: "6-8 sentences", moral: "1 sentence", emoji}`;

    const raw = await this.openai.complete(system, user);
    const parsed = JSON.parse(raw) as { title: string; story: string; moral: string; emoji: string };

    return createStory({
      ageBand,
      title: parsed.title,
      body: parsed.story,
      moral: parsed.moral,
      emoji: parsed.emoji,
      source: 'openai',
      date,
    });
  }

  async generatePoem(topic: string): Promise<Poem> {
    const system = 'Children\'s poet for ages 5-6. Output ONLY valid JSON.';
    const user = `4-line rhyming poem about '${topic}'. JSON: {title, poem: "lines joined by \\n", emoji}`;

    const raw = await this.openai.complete(system, user);
    const parsed = JSON.parse(raw) as { title: string; poem: string; emoji: string };

    return createPoem({
      topic,
      title: parsed.title,
      lines: parsed.poem,
      emoji: parsed.emoji,
      source: 'openai',
    });
  }

  async generateAbcLesson(letter: string): Promise<AbcLesson> {
    const upperLetter = letter.toUpperCase();
    const system = 'Children\'s phonics teacher. Output ONLY valid JSON.';
    const user = `ABC lesson for '${upperLetter}'. JSON: {letter, word, emoji, phonics: "short tip", miniStory: "2-3 sentences"}`;

    const raw = await this.openai.complete(system, user);
    const parsed = JSON.parse(raw) as {
      letter: string;
      word: string;
      emoji: string;
      phonics: string;
      miniStory: string;
    };

    return upsertAbcLesson({
      letter: upperLetter,
      word: parsed.word,
      emoji: parsed.emoji,
      phonics: parsed.phonics,
      miniStory: parsed.miniStory,
      source: 'openai',
    });
  }

  getOpenAIService(): OpenAIService {
    return this.openai;
  }
}
