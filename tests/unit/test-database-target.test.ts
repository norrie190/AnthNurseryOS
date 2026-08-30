import { describe, expect, test } from 'vitest';
import { getTestDatabaseUrl } from '../../scripts/test-database-target';

const developmentUrl = 'postgresql://nursery:local@localhost:5432/anth_nursery?schema=public';
const testUrl = 'postgresql://nursery:local@localhost:5432/anth_nursery_test?schema=public';

describe('test database target protection', () => {
  test.each(['localhost', '127.0.0.1', '[::1]'])(
    'allows a separate test database on %s',
    (host) => {
      const target = testUrl.replace('localhost', host);
      expect(getTestDatabaseUrl({ DATABASE_URL: developmentUrl, TEST_DATABASE_URL: target })).toBe(
        target,
      );
    },
  );

  test.each([
    undefined,
    '',
    'not a URL',
    'file:./test.db',
    developmentUrl,
    testUrl.replace('localhost', 'production.example.com'),
    testUrl.replace('anth_nursery_test', 'anth_nursery'),
    testUrl.replace('schema=public', 'schema=other'),
    `${testUrl}&host=production.example.com`,
    `${testUrl}&options=-csearch_path=other`,
  ])('rejects an unsafe or missing test URL (%s)', (target) => {
    expect(() =>
      getTestDatabaseUrl({ DATABASE_URL: developmentUrl, TEST_DATABASE_URL: target }),
    ).toThrow();
  });

  test('rejects the development database even through a different host alias', () => {
    expect(() =>
      getTestDatabaseUrl({
        DATABASE_URL: testUrl,
        TEST_DATABASE_URL: testUrl.replace('localhost', '127.0.0.1'),
      }),
    ).toThrow('separate database');
  });

  test('requires the development URL so the targets can be compared', () => {
    expect(() => getTestDatabaseUrl({ TEST_DATABASE_URL: testUrl })).toThrow();
  });
});
