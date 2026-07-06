import { describe, expect, it } from "vitest";
import plist from "plist";
import { canonicalizeSebPlist, SebConfigKeyService } from "../../src/server/services/seb-config-key.service.js";

describe("SebConfigKeyService", () => {
  it("canonicalizes plist dictionaries without originatorVersion", () => {
    const left = canonicalizeSebPlist({ b: 2, originatorVersion: "3.7.0", a: { z: true } });
    const right = canonicalizeSebPlist({ A: { z: true }, B: 2 });
    expect(left.toLowerCase()).toBe(right.toLowerCase());
    expect(left).not.toContain("originatorVersion");
  });

  it("computes config-key URL hashes and ignores fragments", () => {
    const service = new SebConfigKeyService();
    const config = Buffer.from(plist.build({ startURL: "https://canvas.example.com", originatorVersion: "3.7.0" }));
    const key = service.computeConfigKey(config);
    const hash = service.hashForUrl("https://canvas.example.com/courses/1#fragment", key);
    expect(service.validateConfigKeyHashForUrl(hash, "https://canvas.example.com/courses/1", key)).toBe(true);
  });

  it("accepts direct SEB config keys exposed by the JavaScript security API", () => {
    const service = new SebConfigKeyService();
    const key = service.computeConfigKey(
      Buffer.from(plist.build({ startURL: "https://canvas.example.com/courses/1" }))
    );

    expect(service.validateConfigKeyHashForUrl(key, "https://canvas.example.com/courses/1?user_id=7", key)).toBe(true);
  });

  it("accepts queryless URL hashes for Canvas quiz attempt URLs", () => {
    const service = new SebConfigKeyService();
    const key = service.computeConfigKey(
      Buffer.from(plist.build({ startURL: "https://canvas.example.com/courses/1" }))
    );
    const querylessHash = service.hashForUrl("https://canvas.example.com/courses/1/quizzes/2/take", key);

    expect(
      service.validateConfigKeyHashForUrl(
        querylessHash,
        "https://canvas.example.com/courses/1/quizzes/2/take?user_id=7",
        key
      )
    ).toBe(true);
  });
});
