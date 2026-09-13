// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  GOOGLE_DOCS_STAGE2_V7_SCHEMA_COMPATIBILITY_PROFILE,
  STRICT_DATABASE_SCHEMA_COMPATIBILITY_PROFILE
} from "../../src/server/data/schema-compatibility.js";
import { assertSchemaReady } from "../../src/server/data/schema.js";

const V7_CHECKSUM = "c439022d14c0d2091151b3e468d59d7981babfb2c2ec334ae182ddee47a15dc5";

function databaseWithMigrations(migrations: Array<{ version: number; name: string; checksum: string }>): {
  query: ReturnType<typeof vi.fn>;
} {
  return { query: vi.fn().mockResolvedValue({ rows: migrations }) };
}

describe("PostgreSQL schema readiness", () => {
  const baseline = Array.from({ length: 6 }, (_, index) => ({
    version: index + 1,
    name: `migration_${index + 1}`,
    checksum: `checksum-${index + 1}`
  }));
  const googleDocsStage2 = { version: 7, name: "google_docs_stage2", checksum: V7_CHECKSUM };

  it("keeps strict schema version 6 as the default", async () => {
    await expect(assertSchemaReady(databaseWithMigrations(baseline) as never)).resolves.toBeUndefined();
    await expect(assertSchemaReady(databaseWithMigrations([...baseline, googleDocsStage2]) as never)).rejects.toThrow(
      "PostgreSQL schema version 7 does not match required version 6"
    );
  });

  it("accepts only the checksum-verified Google Docs v7 migration in its explicit profile", async () => {
    await expect(
      assertSchemaReady(
        databaseWithMigrations([...baseline, googleDocsStage2]) as never,
        GOOGLE_DOCS_STAGE2_V7_SCHEMA_COMPATIBILITY_PROFILE
      )
    ).resolves.toBeUndefined();

    await expect(
      assertSchemaReady(
        databaseWithMigrations([...baseline, { ...googleDocsStage2, checksum: "different" }]) as never,
        GOOGLE_DOCS_STAGE2_V7_SCHEMA_COMPATIBILITY_PROFILE
      )
    ).rejects.toThrow("does not match the approved google-docs-stage2-v7 migration");
  });

  it("rejects unknown future migrations and unsupported compatibility profiles", async () => {
    await expect(
      assertSchemaReady(
        databaseWithMigrations([
          ...baseline,
          googleDocsStage2,
          { version: 8, name: "future", checksum: "future" }
        ]) as never,
        GOOGLE_DOCS_STAGE2_V7_SCHEMA_COMPATIBILITY_PROFILE
      )
    ).rejects.toThrow("PostgreSQL schema version 8 does not match required version 6");
    await expect(assertSchemaReady(databaseWithMigrations(baseline) as never, "accept-anything")).rejects.toThrow(
      "Unsupported PostgreSQL schema compatibility profile"
    );
  });

  it("retains explicit strict profile behavior", async () => {
    await expect(
      assertSchemaReady(databaseWithMigrations(baseline) as never, STRICT_DATABASE_SCHEMA_COMPATIBILITY_PROFILE)
    ).resolves.toBeUndefined();
  });
});
