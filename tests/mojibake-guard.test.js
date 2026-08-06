const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_DIRECTORIES = ["app", "components", "lib"];
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const MOJIBAKE_MARKERS = [
  "â€¦",
  "â€™",
  "â€œ",
  "â€\u009d",
  "â€“",
  "â€”",
  "Ã¢",
  "Ã©",
  "Ã¨",
  "Ã¶",
  "Ã¼",
];

function walkSourceFiles(relativeDirectory) {
  const directory = path.join(ROOT, relativeDirectory);
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(ROOT, absolutePath);

    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(relativePath));
      continue;
    }

    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push({ absolutePath, relativePath });
    }
  }

  return files;
}

test("user-facing source files do not contain common mojibake markers", () => {
  const matches = [];

  for (const directory of SOURCE_DIRECTORIES) {
    for (const file of walkSourceFiles(directory)) {
      const contents = fs.readFileSync(file.absolutePath, "utf8");

      for (const marker of MOJIBAKE_MARKERS) {
        if (contents.includes(marker)) {
          matches.push(`${file.relativePath}: ${marker}`);
        }
      }
    }
  }

  assert.deepEqual(matches, []);
});
