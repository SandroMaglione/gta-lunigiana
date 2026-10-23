/**
 * The project's own oxlint rules, registered in `.oxlintrc.json` as `"jsPlugins": ["./lint/plugin.ts"]`
 * and named `lunigiana/<rule>`.
 *
 * @module lint/plugin
 */
import { basename, dirname } from "node:path"

import { definePlugin, defineRule } from "@oxlint/plugins"

/** Whether `filename` is a test that does not sit directly in a `__tests__` folder. */
export const misplacedTest = (filename: string): boolean =>
  filename.endsWith(".test.ts") && basename(dirname(filename)) !== "__tests__"

/** A test sits in a `__tests__` folder beside the module it tests. */
const testsFolder = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Keep each test in a `__tests__` folder beside the module it tests." },
    messages: {
      move: "Move this test into a `__tests__` folder beside the module it tests: `src/a/b.ts` is tested by `src/a/__tests__/b.test.ts`.",
    },
    schema: [],
  },
  create: (context) => ({
    Program: (node) => {
      if (misplacedTest(context.filename)) context.report({ node, messageId: "move" })
    },
  }),
})

export default definePlugin({ meta: { name: "lunigiana" }, rules: { "tests-folder": testsFolder } })
