const path = require("path");

/**
 * Lint the whole Next.js package rather than the staged files individually.
 *
 * This looks wasteful and is the opposite. Measured on this repo with Next
 * 15.5:
 *
 *   yarn next:lint                            42 seconds
 *   yarn next:lint --file <8 staged files>  > 500 seconds, never finished
 *
 * `next lint --file` re-initialises ESLint per file, so the cost grows with
 * the number of staged files instead of shrinking. With a normal-sized commit
 * the pre-commit hook never completed, and git died partway through leaving
 * files staged but uncommitted — which looks like a git or disk problem and is
 * neither. See NOTES-failures.md #12.
 *
 * Linting the package is bounded, predictable, and an order of magnitude
 * faster here. Revisit after migrating to the ESLint CLI, which the `next
 * lint` deprecation notice already recommends.
 */
const buildNextEslintCommand = () => "yarn next:lint --fix";

const checkTypesNextCommand = () => "yarn next:check-types";

// Hardhat's ESLint invocation does not have this problem, so it keeps the
// cheaper per-file form.
const buildHardhatEslintCommand = filenames =>
  `yarn hardhat:lint-staged --fix ${filenames
    .map(f => path.relative(path.join("packages", "hardhat"), f))
    .join(" ")}`;

module.exports = {
  "packages/nextjs/**/*.{ts,tsx}": [buildNextEslintCommand, checkTypesNextCommand],
  "packages/hardhat/**/*.{ts,tsx}": [buildHardhatEslintCommand],
};
