/**
 * Environment validation.
 *
 * src/lib/env.ts is the one place that decides whether this app is configured
 * well enough to run, and it is deliberately strict: a missing DATABASE_URL
 * should stop the process at startup rather than surface later as a connection
 * error from somewhere in a request. These tests pin that strictness, since it
 * is only ever exercised by being wrong.
 *
 * They call parseEnv() rather than getEnv(). getEnv() memoises on purpose, so
 * it can answer only one question per process; parseEnv() takes the variables
 * as an argument and is otherwise the same code.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { getEnv, parseEnv, type ServerEnv } from "@/lib/env";

/** The smallest environment that should be accepted. */
const MINIMAL = {
  DATABASE_URL: "mysql://user:pw@127.0.0.1:3306/agtci_test",
  AUTH_SECRET: "a-secret",
};

test("a minimal environment is accepted and NODE_ENV defaults to development", () => {
  const env = parseEnv({ ...MINIMAL });
  assert.equal(env.DATABASE_URL, MINIMAL.DATABASE_URL);
  assert.equal(env.AUTH_SECRET, MINIMAL.AUTH_SECRET);
  assert.equal(env.NODE_ENV, "development");
  assert.equal(env.AUTH_URL, undefined);
  assert.equal(env.WHATSAPP_NUMBER, undefined);
});

test("a missing required variable is refused, and the message names it", () => {
  for (const missing of ["DATABASE_URL", "AUTH_SECRET"] as const) {
    const source = { ...MINIMAL };
    delete source[missing];
    assert.throws(
      () => parseEnv(source),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /Invalid environment configuration/);
        // The whole point of failing at startup is telling the operator which
        // variable to go and set, so the name has to be in the message.
        assert.match(err.message, new RegExp(missing));
        return true;
      },
      `${missing} should be required`,
    );
  }
});

test('a variable set to "" is treated as unset, not as a valid empty value', () => {
  // Hosting panels and CI commonly write an empty string for "not set". Without
  // the coercion in parseEnv, zod sees a string and min(1) is the only thing
  // standing between that and a pool connecting to "".
  assert.throws(() => parseEnv({ ...MINIMAL, DATABASE_URL: "" }), /DATABASE_URL/);
  assert.throws(() => parseEnv({ ...MINIMAL, AUTH_SECRET: "" }), /AUTH_SECRET/);

  // Optional fields, however, must tolerate it rather than failing the whole app.
  const env = parseEnv({ ...MINIMAL, AUTH_URL: "", WHATSAPP_NUMBER: "" });
  assert.equal(env.AUTH_URL, undefined);
  assert.equal(env.WHATSAPP_NUMBER, undefined);
});

test("NODE_ENV is restricted to the three known values", () => {
  for (const value of ["development", "test", "production"] as const) {
    assert.equal(parseEnv({ ...MINIMAL, NODE_ENV: value }).NODE_ENV, value);
  }
  // Cast because the point is a value TypeScript already rejects: the schema
  // has to refuse it at runtime too, for a value arriving from the host's
  // environment rather than from this codebase.
  assert.throws(
    () => parseEnv({ ...MINIMAL, NODE_ENV: "staging" as ServerEnv["NODE_ENV"] }),
    /NODE_ENV/,
  );
});

test("AUTH_URL must be a URL when it is given at all", () => {
  assert.equal(
    parseEnv({ ...MINIMAL, AUTH_URL: "https://agtci.com" }).AUTH_URL,
    "https://agtci.com",
  );
  assert.throws(() => parseEnv({ ...MINIMAL, AUTH_URL: "agtci.com" }), /AUTH_URL/);
});

test("unrelated variables in the environment are ignored, not rejected", () => {
  // parseEnv is handed the whole of process.env in production, which on any
  // real host carries hundreds of variables this app knows nothing about.
  const env = parseEnv({ ...MINIMAL, PATH: "/usr/bin", SOME_HOST_THING: "x" });
  assert.equal(env.DATABASE_URL, MINIMAL.DATABASE_URL);
});

test("getEnv reads the real environment once and caches it", () => {
  process.env.DATABASE_URL = MINIMAL.DATABASE_URL;
  process.env.AUTH_SECRET = MINIMAL.AUTH_SECRET;

  const first = getEnv();
  assert.equal(first.DATABASE_URL, MINIMAL.DATABASE_URL);

  // The cache is the contract: src/server/db/index.ts calls getEnv() at module
  // load to build the pool, and nothing should be able to swap the database
  // out from under it afterwards.
  process.env.DATABASE_URL = "mysql://somewhere/else";
  assert.equal(getEnv(), first, "getEnv should return the very same object");
  assert.equal(getEnv().DATABASE_URL, MINIMAL.DATABASE_URL);
});
