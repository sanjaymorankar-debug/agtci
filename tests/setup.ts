/**
 * Imported first by every test file. The tests run against a real MySQL
 * test database (TEST_DATABASE_URL), the same engine as production.
 */
import "dotenv/config";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL must be set: these tests run against a real MySQL test database.");
const env = process.env as Record<string, string | undefined>;
env.DATABASE_URL = url;
env.AUTH_SECRET ||= "test-secret-for-agtci-tests-only";
