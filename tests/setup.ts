// This file runs before any test file, setting required env vars so
// config.ts does not call process.exit(1) during module initialization.
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
process.env['REDIS_URL'] = 'redis://localhost:6379';
process.env['OPENAI_API_KEY'] = 'sk-test';
process.env['API_KEY'] = 'test-api-key';
process.env['ADMIN_API_KEY'] = 'test-admin-key';
process.env['NODE_ENV'] = 'test';
process.env['DAILY_OPENAI_CALL_LIMIT'] = '10';
process.env['PUBLIC_BASE_URL'] = 'https://api.test.local';
process.env['ELEVENLABS_API_KEY'] = 'eleven-test';
process.env['ELEVENLABS_DAILY_CHAR_LIMIT'] = '1000';
