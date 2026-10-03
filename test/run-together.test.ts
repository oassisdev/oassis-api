import { describe, expect, it } from "vitest";
import { wordsRunTogether } from "../src/run-together";

/** Exactly what example.com returned on 2026-10-01, which is how this was found. */
const ROTO = `---
title: "Example Domain"
---

Thisdomainisforuseindocumentationexampleswithoutneedingpermission.Thisisnotaservice,avoidrelyingonitfortestingandmonitoringpurposes.

هذا النطاق مُخصص للاستخدام في أمثلة التوثيق دون الحاجة إلى إذن.

该域名仅用于文档示例，无需获得许可。

L'usagedecedomaineestréservéàdesexemplesdedocumentation,sansautorisationpréalable.

Estedominioestádestinadoalusoenejemplosdedocumentaciónsinnecesidaddepermiso.

[Learn more](https://iana.org/help/example-domains)`;

const SANO = `# What is the Model Context Protocol?

MCP is an open-source standard for connecting AI applications to external systems. Using
MCP, AI applications like Claude or ChatGPT can connect to data sources, tools and
workflows, enabling them to access key information and perform tasks.

Think of MCP like a USB-C port for AI applications: a standardised way to connect.`;

describe("noticing a page whose words came back stuck together", () => {
  it("catches the page that started this", () => {
    expect(wordsRunTogether(ROTO)).toBe(true);
  });

  it("leaves ordinary prose alone", () => {
    expect(wordsRunTogether(SANO)).toBe(false);
  });

  /** Chinese, Japanese and Thai run together by design. Calling that broken is our bug. */
  it("does not accuse a language that writes without spaces", () => {
    const zh = "该域名仅用于文档示例，无需获得许可。这并非一项服务，请勿将其用于测试和监控目的。".repeat(4);
    expect(wordsRunTogether(zh)).toBe(false);
  });

  it("is not fooled by a hash, a long url or a block of code", () => {
    const hashes = `A page about keys.

    The digest is 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 and the
    other is e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.

    See https://example.org/a/very/long/path/that/goes/on/forever/and/ever/and/ever/more

    \`\`\`
    const aVeryLongIdentifierThatNobodyShouldEverWriteButSomePeopleDo = 1;
    \`\`\``;
    expect(wordsRunTogether(hashes)).toBe(false);
  });

  it("says nothing about an empty or tiny answer", () => {
    expect(wordsRunTogether(undefined)).toBe(false);
    expect(wordsRunTogether("")).toBe(false);
    expect(wordsRunTogether("ok")).toBe(false);
  });
});

describe("one paragraph is enough", () => {
  /**
   * The first detector demanded two run-together tokens, because the page that found the
   * bug had five languages. A page with one paragraph produces one, and it sailed through.
   */
  it("catches a single run that is most of the page", () => {
    const uno =
      "# Span Test\n\nThisdomainisforuseindocumentationexampleswithoutneedingpermission." +
      "Thisisnotaservice,avoidrelyingonitfortestingandmonitoringpurposes.";
    expect(wordsRunTogether(uno)).toBe(true);
  });

  it("still ignores one long oddity in a page of ordinary prose", () => {
    const normal =
      "The configuration key is called " +
      "enableExperimentalBackgroundSynchronisationForLargeDocuments" +
      ". " +
      "It is off by default, and most people never need to touch it. Turning it on makes " +
      "the editor synchronise in the background, which helps on very large documents but " +
      "costs memory. The team is working on making it unnecessary. Until then, leave it " +
      "alone unless you have measured a problem and know this is the cause of it.";
    expect(wordsRunTogether(normal)).toBe(false);
  });
});
