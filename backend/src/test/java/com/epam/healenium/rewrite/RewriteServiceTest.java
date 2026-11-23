package com.epam.healenium.rewrite;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RewriteServiceTest {

    private static final String SOURCE = """
            import { test } from '@playwright/test';

            test('heals', async ({ healedPage }) => {
              await healedPage.locator('#username').fill('a');
            });
            """;

    @TempDir
    Path tmp;

    @Test
    void plansAppliesAndRevertsTheExactSourceLine() throws IOException {
        Path project = Files.createDirectories(tmp.resolve("project"));
        Path spec = writeSpec(project, SOURCE);
        Path sessions = Files.createDirectories(tmp.resolve("reports"));
        writeSession(sessions, spec, 4, 20);
        RewriteService service = new RewriteService(List.of(project.toRealPath()),
                tmp.resolve("journal"));

        Map<String, Object> plan = service.plan(List.of(sessions.resolve("session-1.jsonl")),
                null, null);
        assertEquals(true, plan.get("enabled"));
        List<Map<String, Object>> items = items(plan);
        assertEquals(1, items.size());
        assertEquals("writable", items.get(0).get("status"));
        assertTrue(String.valueOf(items.get(0).get("before")).contains("locator('#username')"));
        assertTrue(String.valueOf(items.get(0).get("after")).contains("// healwright:"));
        assertTrue(String.valueOf(items.get(0).get("after")).contains("locator('#lambdatest')"));

        Map<String, Object> applied = service.apply(
                List.of(sessions.resolve("session-1.jsonl")), null, null, true, false, false);
        assertEquals(1, appliedItems(applied).size());
        String rewritten = Files.readString(spec, StandardCharsets.UTF_8);
        assertTrue(rewritten.contains("// healwright: page.locator('#username')"));
        assertTrue(rewritten.contains("healedPage.locator('#lambdatest')"));
        assertFalse(rewritten.contains("healedPage.locator('#username')"));

        Map<String, Object> afterApply = service.plan(
                List.of(sessions.resolve("session-1.jsonl")), null, null);
        Map<String, Object> appliedItem = items(afterApply).get(0);
        assertEquals("applied", appliedItem.get("status"));
        // The diff after a write comes from the journal: it still describes the write, not the
        // healed line re-parsed as if it were the failed one. The line is the one the failed
        // chain occupied before the write inserted its comment.
        assertEquals(4, appliedItem.get("line"));
        assertTrue(String.valueOf(appliedItem.get("before")).contains("locator('#username')"));
        assertFalse(String.valueOf(appliedItem.get("before")).contains("// healwright:"));
        assertTrue(String.valueOf(appliedItem.get("after")).contains("// healwright:"));
        assertTrue(String.valueOf(appliedItem.get("after")).contains("locator('#lambdatest')"));
        assertNotNull(appliedItem.get("transactionId"));

        Map<String, Object> reverted = service.revert("last", null, null, null);
        assertEquals(1, restored(reverted).size());
        assertEquals(SOURCE, Files.readString(spec, StandardCharsets.UTF_8));
        Map<String, Object> afterRevert = service.plan(
                List.of(sessions.resolve("session-1.jsonl")), null, null);
        assertEquals("writable", items(afterRevert).get(0).get("status"));
    }

    @Test
    void variableArgumentIsManualAndSkippedWithoutConfirmation() throws IOException {
        Path project = Files.createDirectories(tmp.resolve("project"));
        Path spec = writeSpec(project, """
                import { test } from '@playwright/test';

                test('heals', async ({ healedPage }) => {
                  const selector = '#username';
                  await healedPage.locator(selector).click();
                });
                """);
        Path sessions = Files.createDirectories(tmp.resolve("reports"));
        writeSession(sessions, spec, 5, 20);
        RewriteService service = new RewriteService(List.of(project.toRealPath()),
                tmp.resolve("journal"));
        Path session = sessions.resolve("session-1.jsonl");

        Map<String, Object> plan = service.plan(List.of(session), null, null);
        assertEquals("manual", items(plan).get(0).get("status"));

        Map<String, Object> skipped = service.apply(List.of(session), null, null, true, false,
                false);
        assertTrue(appliedItems(skipped).isEmpty());
        assertTrue(Files.readString(spec).contains("locator(selector)"));

        Map<String, Object> confirmed = service.apply(List.of(session), null, null, true, true,
                false);
        assertEquals(1, appliedItems(confirmed).size());
        assertTrue(Files.readString(spec).contains("locator('#lambdatest')"));
    }

    @Test
    void refusesFilesOutsideTheAllowedRoots() throws IOException {
        Path project = Files.createDirectories(tmp.resolve("project"));
        Path outside = Files.createDirectories(tmp.resolve("outside"));
        Path spec = writeSpec(outside, SOURCE);
        Path sessions = Files.createDirectories(tmp.resolve("reports"));
        writeSession(sessions, spec, 4, 20);
        RewriteService service = new RewriteService(List.of(project.toRealPath()),
                tmp.resolve("journal"));

        Map<String, Object> plan = service.plan(List.of(sessions.resolve("session-1.jsonl")),
                null, null);
        assertEquals("unresolved", items(plan).get(0).get("status"));
        Map<String, Object> applied = service.apply(
                List.of(sessions.resolve("session-1.jsonl")), null, null, true, true, false);
        assertTrue(appliedItems(applied).isEmpty());
        assertTrue(Files.readString(spec).contains("locator('#username')"));
    }

    @Test
    void disambiguatesTwoChainsOnOneLineByColumn() throws IOException {
        String source = """
                import { test } from '@playwright/test';

                test('two', async ({ healedPage }) => {
                  await healedPage.locator('#a').click(); await healedPage.locator('#b').click();
                });
                """;
        String fourthLine = source.split("\n")[3];
        int secondColumn = fourthLine.lastIndexOf("locator") + 1;
        SourceChain.Span span = SourceChain.locate(source, 4, secondColumn,
                List.of("locator"), List.of("#b"), 1);
        assertNotNull(span);
        assertTrue(span.text().endsWith("locator('#b')"));
    }

    @Test
    void keepsOnePlanItemPerSourcePositionForTheSameExpression() throws IOException {
        Path project = Files.createDirectories(tmp.resolve("project"));
        Path spec = writeSpec(project, """
                import { test } from '@playwright/test';

                test('repeats', async ({ healedPage }) => {
                  await healedPage.locator('#username').fill('a');
                  await healedPage.locator('#username').fill('b');
                });
                """);
        Path sessions = Files.createDirectories(tmp.resolve("reports"));
        String meta = "{\"ts\":\"2026-11-15T18:00:00.000Z\",\"event\":\"report.meta\","
                + "\"testName\":\"repeats\",\"testFile\":\"" + escape(spec.toString()) + "\"}";
        String first = healEvent(spec, 4, 20, "#username", "#lambdatest");
        String second = healEvent(spec, 5, 20, "#username", "#lambdatest");
        Files.writeString(sessions.resolve("session-1.jsonl"),
                meta + "\n" + first + "\n" + second + "\n", StandardCharsets.UTF_8);
        RewriteService service = new RewriteService(List.of(project.toRealPath()),
                tmp.resolve("journal"));
        Path session = sessions.resolve("session-1.jsonl");

        List<Map<String, Object>> planned = items(service.plan(List.of(session), null, null));
        assertEquals(2, planned.size(), String.valueOf(planned));
        assertEquals(4, planned.get(0).get("line"));
        assertEquals(5, planned.get(1).get("line"));
        assertEquals("writable", planned.get(0).get("status"));
        assertEquals("writable", planned.get(1).get("status"));
        assertEquals(1, planned.get(0).get("occurrences"));
        assertFalse(planned.get(0).get("id").equals(planned.get(1).get("id")));

        Map<String, Object> applied = service.apply(List.of(session), null, null, true, false,
                false);
        assertEquals(2, appliedItems(applied).size());
        String rewritten = Files.readString(spec, StandardCharsets.UTF_8);
        assertEquals(2, rewritten.split("// healwright:", -1).length - 1);

        String secondId = appliedItems(applied).stream()
                .filter((item) -> String.valueOf(item.get("before")).contains("fill('b')"))
                .findFirst().orElseThrow().get("id").toString();
        Map<String, Object> reverted = service.revert(null, null, null, List.of(secondId));
        assertEquals(1, restored(reverted).size());
        String partly = Files.readString(spec, StandardCharsets.UTF_8);
        assertTrue(partly.contains("healedPage.locator('#lambdatest').fill('a')"), partly);
        assertTrue(partly.contains("healedPage.locator('#username').fill('b')"), partly);
    }

    @Test
    void showsAnOccurrenceThatNeverHealedButNeverWritesItWithoutExplicitRequest() throws IOException {
        Path project = Files.createDirectories(tmp.resolve("project"));
        String source = """
                import { test } from '@playwright/test';

                test('once', async ({ healedPage }) => {
                  await healedPage.locator('#username').fill('a');
                  await healedPage.locator(changeButton).click();
                  await healedPage.locator('#username').fill('b');
                });
                """;
        Path spec = writeSpec(project, source);
        Path sessions = Files.createDirectories(tmp.resolve("reports"));
        writeSession(sessions, spec, 4, 20);
        RewriteService service = new RewriteService(List.of(project.toRealPath()),
                tmp.resolve("journal"));
        Path session = sessions.resolve("session-1.jsonl");

        List<Map<String, Object>> planned = items(service.plan(List.of(session), null, null));
        // One measured position (line 4) plus the same chain on line 6 that never failed.
        assertEquals(2, planned.size(), String.valueOf(planned));
        assertEquals("writable", planned.get(0).get("status"));
        assertEquals(4, planned.get(0).get("line"));
        assertEquals("unmeasured", planned.get(1).get("status"));
        assertEquals(6, planned.get(1).get("line"));
        assertTrue(String.valueOf(planned.get(1).get("reason")).contains("jamais mesurée"));
        assertTrue(String.valueOf(planned.get(1).get("after"))
                .contains("locator('#lambdatest').fill('b')"));
        @SuppressWarnings("unchecked")
        Map<String, Object> counts = (Map<String, Object>) service
                .plan(List.of(session), null, null).get("counts");
        assertEquals(1, counts.get("writable"));
        assertEquals(1, counts.get("unmeasured"));

        // "Write all" and automatic mode only take the measured position.
        Map<String, Object> all = service.apply(List.of(session), null, null, true, false, false);
        assertEquals(1, appliedItems(all).size(), String.valueOf(all));
        String partlyWritten = Files.readString(spec, StandardCharsets.UTF_8);
        assertTrue(partlyWritten.contains("locator('#lambdatest').fill('a')"));
        assertTrue(partlyWritten.contains("locator('#username').fill('b')"));
        // The comment a rewrite inserts still carries the failed chain but is not an occurrence.
        assertEquals(2, items(service.plan(List.of(session), null, null)).size());
        service.revert(null, null, null, null);
        assertEquals(source, Files.readString(spec, StandardCharsets.UTF_8));
        Map<String, Object> auto = service.apply(List.of(session), null, null, false, false, true);
        assertEquals(1, appliedItems(auto).size(), String.valueOf(auto));
        service.revert(null, null, null, null);

        String unmeasuredId = String.valueOf(items(service.plan(List.of(session), null, null))
                .get(1).get("id"));
        Map<String, Object> explicit = service.apply(List.of(session), null,
                List.of(unmeasuredId), false, false, false);
        assertEquals(1, appliedItems(explicit).size(), String.valueOf(explicit));
        String written = Files.readString(spec, StandardCharsets.UTF_8);
        assertTrue(written.contains("locator('#username').fill('a')"), written);
        assertTrue(written.contains("locator('#lambdatest').fill('b')"), written);
    }

    @Test
    void keepsUnmeasuredProposalsInsideTheTestThatWasMeasured() throws IOException {
        Path project = Files.createDirectories(tmp.resolve("project"));
        String source = """
                import { test } from '@playwright/test';

                test('first', async ({ healedPage }) => {
                  await healedPage.locator('#username').fill('a');
                  await healedPage.locator('#username').fill('b');
                });

                test('second', async ({ healedPage }) => {
                  await healedPage.locator('#username').fill('c');
                });
                """;
        Path spec = writeSpec(project, source);
        Path sessions = Files.createDirectories(tmp.resolve("reports"));
        String meta = "{\"ts\":\"2026-11-15T18:00:00.000Z\",\"event\":\"report.meta\","
                + "\"testName\":\"first\",\"testFile\":\"" + escape(spec.toString()) + "\"}";
        Files.writeString(sessions.resolve("first.jsonl"),
                meta + "\n" + healEvent(spec, 4, 20, "#username", "#one") + "\n",
                StandardCharsets.UTF_8);
        Files.writeString(sessions.resolve("second.jsonl"),
                meta + "\n" + healEvent(spec, 9, 20, "#username", "#two") + "\n",
                StandardCharsets.UTF_8);
        RewriteService service = new RewriteService(List.of(project.toRealPath()),
                tmp.resolve("journal"));

        // Each test heals the same expression to its own target (different page state). A report
        // must not propose one test's lines with the other test's target.
        List<Map<String, Object>> firstOnly = items(service.plan(
                List.of(sessions.resolve("first.jsonl")), null, null));
        assertEquals(2, firstOnly.size(), String.valueOf(firstOnly));
        assertEquals("writable", firstOnly.get(0).get("status"));
        assertEquals(4, firstOnly.get(0).get("line"));
        assertEquals("unmeasured", firstOnly.get(1).get("status"));
        assertEquals(5, firstOnly.get(1).get("line"));
        assertEquals("#one", firstOnly.get(1).get("healedValue"));
        assertEquals(4, firstOnly.get(1).get("measuredLine"));

        List<Map<String, Object>> secondOnly = items(service.plan(
                List.of(sessions.resolve("second.jsonl")), null, null));
        assertEquals(1, secondOnly.size(), String.valueOf(secondOnly));
        assertEquals("writable", secondOnly.get(0).get("status"));
        assertEquals(9, secondOnly.get(0).get("line"));
        assertEquals("#two", secondOnly.get(0).get("healedValue"));

        List<Map<String, Object>> both = items(service.plan(
                List.of(sessions.resolve("first.jsonl"), sessions.resolve("second.jsonl")),
                null, null));
        assertEquals(3, both.size(), String.valueOf(both));
        assertEquals("#one", both.get(1).get("healedValue"));
        assertEquals("#two", both.get(2).get("healedValue"));
    }

    @Test
    void keepsTheUnmeasuredTargetOfEachExpressionInsideOneTest() throws IOException {
        Path project = Files.createDirectories(tmp.resolve("project"));
        Path spec = writeSpec(project, """
                import { test } from '@playwright/test';

                test('mixed', async ({ healedPage }) => {
                  await healedPage.locator('#username').fill('a');
                  await healedPage.locator('#username').fill('b');
                  await healedPage.locator('#password').fill('c');
                  await healedPage.locator('#password').fill('d');
                });
                """);
        Path sessions = Files.createDirectories(tmp.resolve("reports"));
        String meta = "{\"ts\":\"2026-11-15T18:00:00.000Z\",\"event\":\"report.meta\","
                + "\"testName\":\"mixed\",\"testFile\":\"" + escape(spec.toString()) + "\"}";
        Path session = sessions.resolve("mixed.jsonl");
        Files.writeString(session, meta + "\n"
                + healEvent(spec, 5, 20, "#username", "#user1") + "\n"
                + healEvent(spec, 7, 20, "#password", "#pass1") + "\n",
                StandardCharsets.UTF_8);
        RewriteService service = new RewriteService(List.of(project.toRealPath()),
                tmp.resolve("journal"));

        // Two different expressions heal inside the same test: the block alone is not the scope,
        // (block, expression) is. Each unmeasured line keeps its own expression's target.
        List<Map<String, Object>> plan = items(service.plan(List.of(session), null, null));
        assertEquals(4, plan.size(), String.valueOf(plan));
        assertEquals("unmeasured", plan.get(0).get("status"));
        assertEquals(4, plan.get(0).get("line"));
        assertEquals("#user1", plan.get(0).get("healedValue"));
        assertEquals(5, plan.get(1).get("line"));
        assertEquals("unmeasured", plan.get(2).get("status"));
        assertEquals(6, plan.get(2).get("line"));
        assertEquals("#pass1", plan.get(2).get("healedValue"));
        assertEquals("writable", plan.get(3).get("status"));
        assertEquals(7, plan.get(3).get("line"));
    }

    @Test
    void proposesNothingWhenOneTestMeasuredTwoTargetsForTheSameExpression() throws IOException {
        Path project = Files.createDirectories(tmp.resolve("project"));
        Path spec = writeSpec(project, """
                import { test } from '@playwright/test';

                test('flaky', async ({ healedPage }) => {
                  await healedPage.locator('#username').fill('a');
                  await healedPage.locator('#username').fill('b');
                  await healedPage.locator('#username').fill('c');
                });
                """);
        Path sessions = Files.createDirectories(tmp.resolve("reports"));
        String meta = "{\"ts\":\"2026-11-15T18:00:00.000Z\",\"event\":\"report.meta\","
                + "\"testName\":\"flaky\",\"testFile\":\"" + escape(spec.toString()) + "\"}";
        Path session = sessions.resolve("flaky.jsonl");
        Files.writeString(session, meta + "\n"
                + healEvent(spec, 4, 20, "#username", "#one") + "\n"
                + healEvent(spec, 5, 20, "#username", "#two") + "\n",
                StandardCharsets.UTF_8);
        RewriteService service = new RewriteService(List.of(project.toRealPath()),
                tmp.resolve("journal"));

        // The same expression healed to two different targets inside one test: line 6 gets no
        // proposal, because either target would be a guess.
        List<Map<String, Object>> plan = items(service.plan(List.of(session), null, null));
        assertEquals(2, plan.size(), String.valueOf(plan));
        assertEquals("writable", plan.get(0).get("status"));
        assertEquals("writable", plan.get(1).get("status"));
    }

    @Test
    void findsTheMeasuredChainWhenAnEarlierRewriteShiftedItsLine() throws IOException {
        Path project = Files.createDirectories(tmp.resolve("project"));
        Path spec = writeSpec(project, """
                import { test } from '@playwright/test';

                test('drift', async ({ healedPage }) => {
                  // healwright: page.locator('#username')
                  await healedPage.locator('#lambdatest').fill('a');
                  await expect(healedPage.locator('#username')).toHaveValue('a');
                });
                """);
        Path sessions = Files.createDirectories(tmp.resolve("reports"));
        // Measured on the pre-rewrite file: the assertion was on line 5, the comment shifted it
        // to line 6. The healed line above carries a different literal and must not be picked.
        writeSession(sessions, spec, 5, 27);
        RewriteService service = new RewriteService(List.of(project.toRealPath()),
                tmp.resolve("journal"));

        List<Map<String, Object>> planned = items(service.plan(
                List.of(sessions.resolve("session-1.jsonl")), null, null));
        assertEquals(1, planned.size(), String.valueOf(planned));
        assertEquals("writable", planned.get(0).get("status"), String.valueOf(planned.get(0)));
        assertEquals(6, planned.get(0).get("line"));
        assertTrue(String.valueOf(planned.get(0).get("before")).contains("toHaveValue('a')"));
    }

    @Test
    void revertsOneLocatorByIdAndLeavesTheOtherRewritten() throws IOException {
        Path project = Files.createDirectories(tmp.resolve("project"));
        Path spec = writeSpec(project, """
                import { test } from '@playwright/test';

                test('two', async ({ healedPage }) => {
                  await healedPage.locator('#username').fill('a');
                  await healedPage.locator('#password').fill('b');
                });
                """);
        Path sessions = Files.createDirectories(tmp.resolve("reports"));
        writeSessionPair(sessions, spec);
        RewriteService service = new RewriteService(List.of(project.toRealPath()),
                tmp.resolve("journal"));
        Path session = sessions.resolve("session-1.jsonl");

        Map<String, Object> applied = service.apply(List.of(session), null, null, true, false,
                false);
        List<Map<String, Object>> done = appliedItems(applied);
        assertEquals(2, done.size());
        String rewritten = Files.readString(spec, StandardCharsets.UTF_8);
        assertTrue(rewritten.contains("healedPage.locator('#lambdatest')"));
        assertTrue(rewritten.contains("healedPage.locator('#secret')"));
        String usernameId = done.stream()
                .filter((item) -> String.valueOf(item.get("failed")).contains("#username"))
                .findFirst().orElseThrow().get("id").toString();
        String passwordId = done.stream()
                .filter((item) -> String.valueOf(item.get("failed")).contains("#password"))
                .findFirst().orElseThrow().get("id").toString();

        Map<String, Object> first = service.revert(null, null, null, List.of(usernameId));
        assertEquals(1, restored(first).size(), String.valueOf(first));
        String partly = Files.readString(spec, StandardCharsets.UTF_8);
        assertTrue(partly.contains("healedPage.locator('#username')"));
        assertTrue(partly.contains("healedPage.locator('#secret')"));

        Map<String, Object> second = service.revert(null, null, null, List.of(passwordId));
        assertEquals(1, restored(second).size());
        String original = Files.readString(spec, StandardCharsets.UTF_8);
        assertTrue(original.contains("healedPage.locator('#password')"));
        assertFalse(original.contains("healwright:"));
    }

    @Test
    void prefixesAnXpathHealedValueSoPlaywrightCanReplayIt() throws IOException {
        Path project = Files.createDirectories(tmp.resolve("project"));
        Path spec = writeSpec(project, SOURCE);
        Path sessions = Files.createDirectories(tmp.resolve("reports"));
        String meta = "{\"ts\":\"2026-11-15T18:00:00.000Z\",\"event\":\"report.meta\","
                + "\"testName\":\"heals\",\"testFile\":\"" + escape(spec.toString()) + "\"}";
        String heal = "{\"ts\":\"2026-11-15T18:00:01.000Z\",\"event\":\"heal.success\","
                + "\"score\":0.84,\"margin\":0.1,"
                + "\"failedLocator\":{\"value\":\"#username\",\"type\":\"By.cssSelector\"},"
                + "\"healedLocator\":{\"value\":\"/html/body/form/input[1]\",\"type\":\"By.xpath\"},"
                + "\"playwright\":{\"failed\":\"page.locator('#username')\",\"root\":\"page\","
                + "\"apis\":[\"locator\"],\"healed\":\"page.locator('/html/body/form/input[1]')\","
                + "\"callsite\":{\"file\":\"" + escape(spec.toString()) + "\","
                + "\"line\":4,\"column\":20}}}";
        Files.writeString(sessions.resolve("session-1.jsonl"), meta + "\n" + heal + "\n",
                StandardCharsets.UTF_8);
        RewriteService service = new RewriteService(List.of(project.toRealPath()),
                tmp.resolve("journal"));

        Map<String, Object> plan = service.plan(List.of(sessions.resolve("session-1.jsonl")),
                null, null);
        assertEquals("writable", items(plan).get(0).get("status"));
        assertTrue(String.valueOf(items(plan).get(0).get("after"))
                .contains(".locator('xpath=/html/body/form/input[1]')"));
    }

    @Test
    void autoModeWritesWhenTheMarginIsUnmeasuredAndSkipsAnAmbiguousOne() throws IOException {
        Path project = Files.createDirectories(tmp.resolve("project"));
        Path spec = writeSpec(project, SOURCE);
        Path sessions = Files.createDirectories(tmp.resolve("reports"));
        // Healenium scoring never records a margin: the key is absent, so null means "unmeasured".
        // A measured margin below the 0.02 threshold is the real ambiguity signal.
        writeSessionWithMargin(sessions, spec, null);
        RewriteService service = new RewriteService(List.of(project.toRealPath()),
                tmp.resolve("journal"));
        Path session = sessions.resolve("session-1.jsonl");

        Map<String, Object> unmeasured = service.apply(List.of(session), null, null, false, false,
                true);
        assertEquals(1, appliedItems(unmeasured).size());
        assertTrue(Files.readString(spec).contains("healedPage.locator('#lambdatest')"));

        service.revert(null, null, null, null);
        writeSessionWithMargin(sessions, spec, 0.01);
        Map<String, Object> ambiguous = service.apply(List.of(session), null, null, false, false,
                true);
        assertTrue(appliedItems(ambiguous).isEmpty());
        assertTrue(Files.readString(spec).contains("healedPage.locator('#username')"));
    }

    @Test
    void countsTheLocatorChainAndNotTheAction() {
        assertEquals(1, SourceChain.countSegments("page.locator('#a')"));
        assertEquals(2, SourceChain.countSegments("page.frameLocator('#f').locator('#save')"));
        assertEquals(3, SourceChain.countSegments(
                "page.getByRole('button', { name: 'Save' }).filter({ hasText: 'x' }).first()"));
        assertEquals(0, SourceChain.countSegments(""));
    }

    private Path writeSpec(Path project, String content) throws IOException {
        Path spec = project.resolve("tests/heal.spec.ts");
        Files.createDirectories(spec.getParent());
        Files.writeString(spec, content, StandardCharsets.UTF_8);
        return spec;
    }

    private void writeSession(Path dir, Path spec, int line, int column) throws IOException {
        String meta = "{\"ts\":\"2026-11-15T18:00:00.000Z\",\"event\":\"report.meta\","
                + "\"testName\":\"heals\",\"testFile\":\"" + escape(spec.toString()) + "\"}";
        String heal = "{\"ts\":\"2026-11-15T18:00:01.000Z\",\"event\":\"heal.success\","
                + "\"score\":0.84,\"margin\":0.1,"
                + "\"failedLocator\":{\"value\":\"#username\",\"type\":\"By.cssSelector\"},"
                + "\"healedLocator\":{\"value\":\"#lambdatest\",\"type\":\"By.cssSelector\"},"
                + "\"playwright\":{\"failed\":\"page.locator('#username')\",\"root\":\"page\","
                + "\"apis\":[\"locator\"],\"healed\":\"page.locator('#lambdatest')\","
                + "\"callsite\":{\"file\":\"" + escape(spec.toString()) + "\","
                + "\"line\":" + line + ",\"column\":" + column + "}}}";
        Files.writeString(dir.resolve("session-1.jsonl"), meta + "\n" + heal + "\n",
                StandardCharsets.UTF_8);
    }

    private void writeSessionWithMargin(Path dir, Path spec, Double margin) throws IOException {
        String meta = "{\"ts\":\"2026-11-15T18:00:00.000Z\",\"event\":\"report.meta\","
                + "\"testName\":\"heals\",\"testFile\":\"" + escape(spec.toString()) + "\"}";
        String heal = "{\"ts\":\"2026-11-15T18:00:01.000Z\",\"event\":\"heal.success\","
                + "\"score\":0.84,\"margin\":" + (margin == null ? "null" : margin) + ","
                + "\"failedLocator\":{\"value\":\"#username\",\"type\":\"By.cssSelector\"},"
                + "\"healedLocator\":{\"value\":\"#lambdatest\",\"type\":\"By.cssSelector\"},"
                + "\"playwright\":{\"failed\":\"page.locator('#username')\",\"root\":\"page\","
                + "\"apis\":[\"locator\"],\"healed\":\"page.locator('#lambdatest')\","
                + "\"callsite\":{\"file\":\"" + escape(spec.toString()) + "\","
                + "\"line\":4,\"column\":20}}}";
        Files.writeString(dir.resolve("session-1.jsonl"), meta + "\n" + heal + "\n",
                StandardCharsets.UTF_8);
    }

    private void writeSessionPair(Path dir, Path spec) throws IOException {
        String meta = "{\"ts\":\"2026-11-15T18:00:00.000Z\",\"event\":\"report.meta\","
                + "\"testName\":\"two\",\"testFile\":\"" + escape(spec.toString()) + "\"}";
        String first = healEvent(spec, 4, 20, "#username", "#lambdatest");
        String second = healEvent(spec, 5, 20, "#password", "#secret");
        Files.writeString(dir.resolve("session-1.jsonl"), meta + "\n" + first + "\n" + second + "\n",
                StandardCharsets.UTF_8);
    }

    private static String healEvent(Path spec, int line, int column, String failed, String healed) {
        return "{\"ts\":\"2026-11-15T18:00:01.000Z\",\"event\":\"heal.success\","
                + "\"score\":0.84,\"margin\":0.1,"
                + "\"failedLocator\":{\"value\":\"" + failed + "\",\"type\":\"By.cssSelector\"},"
                + "\"healedLocator\":{\"value\":\"" + healed + "\",\"type\":\"By.cssSelector\"},"
                + "\"playwright\":{\"failed\":\"page.locator('" + failed + "')\",\"root\":\"page\","
                + "\"apis\":[\"locator\"],\"healed\":\"page.locator('" + healed + "')\","
                + "\"callsite\":{\"file\":\"" + escape(spec.toString()) + "\","
                + "\"line\":" + line + ",\"column\":" + column + "}}}";
    }

    private static String escape(String value) {
        return value.replace("\\", "\\\\");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> items(Map<String, Object> plan) {
        return (List<Map<String, Object>>) plan.get("items");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> appliedItems(Map<String, Object> result) {
        return (List<Map<String, Object>>) result.get("applied");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> restored(Map<String, Object> result) {
        return (List<Map<String, Object>>) result.get("restored");
    }
}
