import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  contentHash,
  type HashableContent,
} from "../../src/modules/missions/domain/content-hash.js";

const content: HashableContent = {
  title: "Fever in the Rainy Season",
  story: "Mama Ngozi carries her son…",
  countryCode: "NG",
  locale: "en",
  learningObjectives: [],
  steps: [
    {
      stepId: "s1",
      prompt: "First step?",
      choices: [
        { choiceId: "s1c1", text: "Test", correct: true, feedback: "Right" },
        { choiceId: "s1c2", text: "Home", correct: false, feedback: "No" },
      ],
    },
  ],
};

describe("content hash", () => {
  it("is stable regardless of key order and reference order", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    expect(contentHash(content, ["b", "a"])).toBe(
      contentHash(JSON.parse(JSON.stringify(content)), ["a", "b"]),
    );
    expect(contentHash(content, [])).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    ["title", { ...content, title: "Fever" }],
    ["country", { ...content, countryCode: "GH" }],
    [
      "answer key",
      {
        ...content,
        steps: [
          {
            ...content.steps[0]!,
            choices: content.steps[0]!.choices.map((c) => ({ ...c, correct: !c.correct })),
          },
        ],
      },
    ],
    [
      "feedback",
      {
        ...content,
        steps: [
          {
            ...content.steps[0]!,
            choices: [
              { ...content.steps[0]!.choices[0]!, feedback: "Correct" },
              content.steps[0]!.choices[1]!,
            ],
          },
        ],
      },
    ],
    [
      "critical flag",
      {
        ...content,
        steps: [
          {
            ...content.steps[0]!,
            choices: [
              content.steps[0]!.choices[0]!,
              { ...content.steps[0]!.choices[1]!, critical: true },
            ],
          },
        ],
      },
    ],
  ])("changes when the %s changes", (_label, changed) => {
    expect(contentHash(changed as HashableContent, [])).not.toBe(contentHash(content, []));
  });

  it("changes when references change", () => {
    expect(contentHash(content, ["r1"])).not.toBe(contentHash(content, []));
  });
});
