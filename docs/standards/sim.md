# Simulation standards

Checks for a change in `src/sim`, on top of the steps in
[CODING_STANDARDS.md](../../CODING_STANDARDS.md):

- **Saved state**: a new component or resource lives in `src/sim/schema.ts`, with its bundle in
  `Schema.requires`. The `determinism` and `saves` tests in `src/sim/__tests__/index.test.ts` reach it:
  extend their scripted joyride when they don't.
- **Events**: a reader in a host schedule counts for `ritmo-devtools lint` only once `lintTarget`
  (`src/lint.ts`) describes that schedule; add every new host schedule there.
