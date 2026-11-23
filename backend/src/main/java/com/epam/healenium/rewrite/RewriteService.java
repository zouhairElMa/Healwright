package com.epam.healenium.rewrite;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Phase-24: write a healed locator back to the Playwright source line the test wrote.
 *
 * <p>Three entry points share this engine: the dashboard buttons, the {@code healwright-rewrite}
 * CLI (both call the REST endpoints), and the fixture's automatic mode (config
 * {@code sourceRewrite: 'auto'}, which posts the session id after the report closes). Every write
 * is journaled under {@code ~/.healwright/rewrite/<transaction>/} with the exact before/after
 * block, so a revert restores the previous source text. Writes are atomic, never touch a file
 * outside {@code HEALWRIGHT_APPLY_ROOTS}, and never run git.
 */
@Slf4j
@Service
public class RewriteService {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Pattern UID = Pattern.compile("[A-Za-z0-9_-]{1,128}");
    private static final DateTimeFormatter TX_FORMAT =
            DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss-SSS").withZone(ZoneOffset.UTC);
    private static final double AMBIGUITY_MARGIN = 0.02;

    private final List<Path> roots;
    private final Path journalRoot;
    private final boolean enabled;

    public RewriteService() {
        this(rootsFromEnv(), journalFromEnv());
    }

    RewriteService(List<Path> roots, Path journalRoot) {
        this.roots = List.copyOf(roots);
        this.enabled = !this.roots.isEmpty();
        this.journalRoot = journalRoot;
        log.info("[Healwright] Source rewrite {} (roots: {}, journal: {})",
                enabled ? "enabled" : "disabled", this.roots, journalRoot);
    }

    private static List<Path> rootsFromEnv() {
        String env = System.getenv("HEALWRIGHT_APPLY_ROOTS");
        List<Path> parsed = new ArrayList<>();
        if (env != null && !env.isBlank()) {
            for (String entry : env.split(Pattern.quote(File.pathSeparator))) {
                if (entry.isBlank()) {
                    continue;
                }
                Path path = Paths.get(entry).toAbsolutePath().normalize();
                if (Files.isDirectory(path)) {
                    parsed.add(realPath(path));
                } else {
                    log.warn("[Healwright] HEALWRIGHT_APPLY_ROOTS entry is not a directory: {}", path);
                }
            }
        }
        return parsed;
    }

    private static Path journalFromEnv() {
        String journal = System.getenv("HEALWRIGHT_REWRITE_JOURNAL");
        return journal != null && !journal.isBlank()
                ? Paths.get(journal).toAbsolutePath().normalize()
                : Paths.get(System.getProperty("user.home"), ".healwright", "rewrite");
    }

    public boolean enabled() {
        return enabled;
    }

    public List<Path> roots() {
        return roots;
    }

    // ---------------------------------------------------------------------------------------
    // Plan
    // ---------------------------------------------------------------------------------------

    public synchronized Map<String, Object> plan(List<Path> sessionFiles, String onlySession,
                                                 String onlyFile) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("enabled", enabled);
        out.put("roots", roots.stream().map(Path::toString).toList());
        List<Map<String, Object>> items = new ArrayList<>();
        if (!enabled) {
            out.put("items", items);
            out.put("counts", Map.of("writable", 0, "applied", 0, "manual", 0,
                    "conflict", 0, "unresolved", 0, "no-callsite", 0, "unmeasured", 0));
            return out;
        }
        Map<String, Aggregate> aggregates = collect(sessionFiles, onlySession, onlyFile);
        Map<String, JournalEntry> applied = appliedIndex();
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (String status : List.of("writable", "applied", "manual", "conflict", "unresolved",
                "no-callsite", "unmeasured")) {
            counts.put(status, 0);
        }
        for (Aggregate aggregate : aggregates.values()) {
            items.add(resolve(aggregate, applied.get(aggregate.id)));
        }
        // The same expression can appear in the file at a position that was never measured (it
        // did not fail there). Those lines are shown with the measured target as a proposal, so
        // the tester sees every occurrence instead of a silent gap. Never selected automatically.
        items.addAll(unmeasuredOccurrences(aggregates, items));
        for (Map<String, Object> item : items) {
            counts.merge(String.valueOf(item.get("status")), 1, Integer::sum);
        }
        items.sort(Comparator
                .comparing((Map<String, Object> m) -> String.valueOf(m.get("file")))
                .thenComparingInt(m -> ((Number) m.get("line")).intValue()));
        out.put("items", items);
        out.put("counts", counts);
        return out;
    }

    private Map<String, Aggregate> collect(List<Path> sessionFiles, String onlySession,
                                           String onlyFile) {
        Map<String, Aggregate> aggregates = new LinkedHashMap<>();
        for (Path sessionFile : sessionFiles) {
            String sessionId = sessionIdOf(sessionFile);
            if (onlySession != null && !onlySession.isBlank() && !onlySession.equals(sessionId)) {
                continue;
            }
            List<String> lines;
            try {
                lines = Files.readAllLines(sessionFile, StandardCharsets.UTF_8);
            } catch (IOException e) {
                continue;
            }
            String testFile = null;
            for (String line : lines) {
                if (line.isBlank()) {
                    continue;
                }
                JsonNode node;
                try {
                    node = MAPPER.readTree(line);
                } catch (RuntimeException ignored) {
                    continue;
                }
                if (node == null) {
                    continue;
                }
                String event = text(node.get("event"));
                if ("report.meta".equals(event)) {
                    String value = text(node.get("testFile"));
                    if (value != null) {
                        testFile = value;
                    }
                    continue;
                }
                if (!"heal.success".equals(event) && !"heal.proposed".equals(event)) {
                    continue;
                }
                JsonNode playwright = node.get("playwright");
                JsonNode healedLocator = node.get("healedLocator");
                JsonNode failedLocator = node.get("failedLocator");
                if (playwright == null || healedLocator == null) {
                    continue;
                }
                String failedExpression = text(playwright.get("failed"));
                String healedExpression = text(playwright.get("healed"));
                String healedValue = text(healedLocator.get("value"));
                JsonNode callsite = playwright.get("callsite");
                if (failedExpression == null || healedValue == null || healedValue.isBlank()) {
                    continue;
                }
                String file = callsite == null ? null : text(callsite.get("file"));
                if (file == null && (onlyFile == null || onlyFile.isBlank())) {
                    // Old telemetry: still shown as no-callsite, so the tester sees why.
                }
                if (onlyFile != null && !onlyFile.isBlank() && !onlyFile.equals(testFile)
                        && !onlyFile.equals(file)) {
                    continue;
                }
                // One plan item per healed source position: the same expression can heal at
                // several callsites of one file, and the tester must be able to pick each of
                // them. A callsite-less event keeps line 0 / column 0 and stays a single item.
                int sourceLine = callsite == null ? 0 : (int) number(callsite.get("line"));
                int sourceColumn = callsite == null ? 0 : (int) number(callsite.get("column"));
                String key = (file == null ? "?" : file) + "\u0000" + failedExpression
                        + "\u0000" + sourceLine + ":" + sourceColumn;
                Aggregate aggregate = aggregates.computeIfAbsent(key, k -> {
                    Aggregate created = new Aggregate();
                    created.id = shortHash(k);
                    created.file = file;
                    created.line = sourceLine;
                    created.column = sourceColumn;
                    created.failed = failedExpression;
                    created.apis = textList(playwright.get("apis"));
                    return created;
                });
                aggregate.occurrences++;
                aggregate.sessionIds.add(sessionId);
                aggregate.healedExpressions.add(healedExpression == null ? healedValue : healedExpression);
                aggregate.healedValue = healedValue;
                aggregate.healedType = text(healedLocator.get("type"));
                aggregate.score = number(node.get("score"));
                // A null margin means "no ambiguity measurement" (healenium scoring), which the
                // automatic mode treats as safe; only a measured margin below the threshold is
                // ambiguous. Folding null into 0 would silently disable auto mode.
                JsonNode marginNode = node.get("margin");
                aggregate.margin = marginNode == null || marginNode.isNull()
                        ? null : number(marginNode);
            }
        }
        return aggregates;
    }

    private Map<String, Object> resolve(Aggregate aggregate, JournalEntry appliedEntry) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", aggregate.id);
        item.put("file", displayPath(aggregate.file));
        item.put("absoluteFile", aggregate.file);
        item.put("line", aggregate.line);
        item.put("column", aggregate.column);
        item.put("failed", aggregate.failed);
        item.put("healed", newest(aggregate.healedExpressions));
        item.put("healedValue", aggregate.healedValue);
        item.put("healedType", aggregate.healedType);
        item.put("locatorArgument", locatorArgument(aggregate.healedValue, aggregate.healedType));
        item.put("apis", aggregate.apis);
        item.put("score", aggregate.score);
        item.put("margin", aggregate.margin);
        item.put("occurrences", aggregate.occurrences);
        item.put("sessions", new ArrayList<>(aggregate.sessionIds));
        item.put("recurring", aggregate.occurrences > 1);
        if (aggregate.file == null || aggregate.line <= 0) {
            return status(item, "no-callsite",
                    "Télémétrie antérieure à la phase 24 : position source absente.");
        }
        Path file = allowedFile(aggregate.file);
        if (file == null) {
            return status(item, "unresolved",
                    "Fichier hors des racines autorisées (HEALWRIGHT_APPLY_ROOTS).");
        }
        String content;
        try {
            content = Files.readString(file, StandardCharsets.UTF_8);
        } catch (IOException e) {
            return status(item, "unresolved", "Fichier illisible : " + e.getMessage());
        }
        if (appliedEntry != null && content.contains(appliedEntry.afterBlock)) {
            // The journal's exact two-line block is still in the file: the write is in effect.
            // Reported before any chain search, because the rewritten line no longer carries the
            // failed literals; the diff shown comes from the journal, not from a re-parse.
            item.put("line", appliedEntry.line);
            item.put("before", appliedEntry.beforeBlock);
            item.put("after", appliedEntry.afterBlock);
            item.put("transactionId", appliedEntry.transactionId);
            item.put("appliedAt", appliedEntry.appliedAt);
            return status(item, "applied", "Déjà réécrit dans le code source.");
        }
        SourceChain.Span span = SourceChain.locate(content, aggregate.line, aggregate.column,
                aggregate.apis, SourceChain.allStringLiterals(aggregate.failed),
                SourceChain.countSegments(aggregate.failed));
        if (span == null) {
            return status(item, "unresolved",
                    "Chaîne Playwright introuvable à la ligne " + aggregate.line + ".");
        }
        item.put("line", span.startLine());
        item.put("detectedLine", span.startLine());
        String eol = content.contains("\r\n") ? "\r\n" : "\n";
        int blockStart = lineStart(content, span.startOffset());
        int blockEnd = lineEnd(content, span.endOffset());
        String indent = leadingWhitespace(content, span.startOffset());
        String prefix = content.substring(blockStart, span.startOffset());
        String replacement = span.rootText() + ".locator("
                + jsString(locatorArgument(aggregate.healedValue, aggregate.healedType)) + ")";
        String comment = indent + "// healwright: " + aggregate.failed.replace("\n", " ");
        // The write owns the whole line, not just the chain: a journaled block that stopped at
        // the chain would be identical for two same-locator lines and revert could not tell
        // them apart.
        String after = comment + eol + prefix + replacement
                + content.substring(span.endOffset(), blockEnd);
        String before = content.substring(blockStart, blockEnd);
        item.put("before", before);
        item.put("after", after);
        if (aggregate.healedExpressions.size() > 1) {
            item.put("alternatives", new ArrayList<>(aggregate.healedExpressions));
            return status(item, "conflict",
                    "Plusieurs cibles guéries différentes pour ce même locator.");
        }
        if (span.nonLiteral()) {
            return status(item, "manual",
                    "Argument non littéral (variable) : l'écriture demande une confirmation.");
        }
        return status(item, "writable", null);
    }

    private static Map<String, Object> status(Map<String, Object> item, String status, String reason) {
        item.put("status", status);
        if (reason != null) {
            item.put("reason", reason);
        }
        return item;
    }

    /**
     * Source lines that carry the measured chain with the same literal values but never produced a
     * heal in the analysed sessions. The measured heal is offered as a proposal per line; nothing
     * is selected by "write all" or automatic mode, because an occurrence that never failed may be
     * intentionally different (the locator may still exist at that point of the test).
     *
     * <p>Proposals stay inside the {@code test(...)} block that contains the measurement: the same
     * expression in another test of the file runs against another page state and can heal to
     * another target, so copying the target across a test boundary would be a guess.
     */
    private List<Map<String, Object>> unmeasuredOccurrences(Map<String, Aggregate> aggregates,
                                                            List<Map<String, Object>> measured) {
        Map<String, Map<String, Object>> measuredById = new LinkedHashMap<>();
        Map<String, Set<Integer>> knownByExpression = new LinkedHashMap<>();
        for (Map<String, Object> item : measured) {
            measuredById.put(String.valueOf(item.get("id")), item);
            Set<Integer> lines = knownByExpression.computeIfAbsent(
                    item.get("absoluteFile") + "\u0000" + item.get("failed"),
                    k -> new LinkedHashSet<>());
            lines.add(((Number) item.get("line")).intValue());
            Object detected = item.get("detectedLine");
            if (detected instanceof Number detectedLine) {
                lines.add(detectedLine.intValue());
            }
        }
        Map<String, List<Aggregate>> byBlock = new LinkedHashMap<>();
        Map<String, int[]> ranges = new LinkedHashMap<>();
        Map<String, String> contents = new LinkedHashMap<>();
        for (Aggregate aggregate : aggregates.values()) {
            if (aggregate.file == null || aggregate.healedValue == null || aggregate.apis.isEmpty()) {
                continue;
            }
            knownByExpression.computeIfAbsent(aggregate.file + "\u0000" + aggregate.failed,
                    k -> new LinkedHashSet<>()).add(aggregate.line);
            String content = contents.computeIfAbsent(aggregate.file, this::readAllowed);
            if (content == null) {
                continue;
            }
            Map<String, Object> resolved = measuredById.get(aggregate.id);
            int line = resolved != null && resolved.get("line") instanceof Number number
                    ? number.intValue() : aggregate.line;
            int[] block = SourceChain.testBlockLines(content, line);
            if (block == null) {
                continue; // outside any test block: no scope, so no proposal
            }
            // Scope key: one test block AND one failed expression. Two different expressions
            // healed inside the same test keep their own target, and each proposes its own
            // unmeasured occurrences.
            String key = aggregate.file + "#" + block[0] + "-" + block[1]
                    + "\u0000" + aggregate.failed;
            byBlock.computeIfAbsent(key, k -> new ArrayList<>()).add(aggregate);
            ranges.put(key, block);
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map.Entry<String, List<Aggregate>> entry : byBlock.entrySet()) {
            List<Aggregate> members = entry.getValue();
            Aggregate representative = members.get(0);
            Set<String> targets = new LinkedHashSet<>();
            for (Aggregate member : members) {
                targets.addAll(member.healedExpressions);
            }
            if (targets.size() > 1) {
                continue; // two targets inside one test: no honest proposal for its other lines
            }
            String content = contents.get(representative.file);
            int[] range = ranges.get(entry.getKey());
            int measuredLine = representative.line;
            Map<String, Object> resolved = measuredById.get(representative.id);
            if (resolved != null && resolved.get("line") instanceof Number number) {
                measuredLine = number.intValue();
            }
            Set<Integer> lines = knownByExpression.getOrDefault(
                    representative.file + "\u0000" + representative.failed, Set.of());
            for (SourceChain.Span span : SourceChain.findAll(content, representative.apis,
                    SourceChain.allStringLiterals(representative.failed),
                    SourceChain.countSegments(representative.failed))) {
                if (span.startLine() < range[0] || span.startLine() > range[1]) {
                    continue; // another test: not the same occurrence
                }
                if (lines.contains(span.startLine())) {
                    continue;
                }
                out.add(unmeasuredItem(representative, span, content, measuredLine));
            }
        }
        return out;
    }

    private String readAllowed(String rawFile) {
        Path file = allowedFile(rawFile);
        if (file == null) {
            return null;
        }
        try {
            return Files.readString(file, StandardCharsets.UTF_8);
        } catch (IOException e) {
            return null;
        }
    }

    private Map<String, Object> unmeasuredItem(Aggregate measured, SourceChain.Span span,
                                               String content, int measuredLine) {
        String key = measured.file + "\u0000" + measured.failed + "\u0000unmeasured\u0000"
                + span.startLine() + ":" + span.startColumn();
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", shortHash(key));
        item.put("file", displayPath(measured.file));
        item.put("absoluteFile", measured.file);
        item.put("line", span.startLine());
        item.put("column", span.startColumn());
        item.put("failed", measured.failed);
        item.put("healed", newest(measured.healedExpressions));
        item.put("healedValue", measured.healedValue);
        item.put("healedType", measured.healedType);
        item.put("locatorArgument", locatorArgument(measured.healedValue, measured.healedType));
        item.put("apis", measured.apis);
        item.put("score", measured.score);
        item.put("margin", measured.margin);
        item.put("occurrences", 1);
        item.put("sessions", new ArrayList<>(measured.sessionIds));
        item.put("recurring", false);
        item.put("measuredLine", measuredLine);
        String eol = content.contains("\r\n") ? "\r\n" : "\n";
        int blockStart = lineStart(content, span.startOffset());
        int blockEnd = lineEnd(content, span.endOffset());
        String indent = leadingWhitespace(content, span.startOffset());
        String prefix = content.substring(blockStart, span.startOffset());
        String replacement = span.rootText() + ".locator("
                + jsString(locatorArgument(measured.healedValue, measured.healedType)) + ")";
        String comment = indent + "// healwright: " + measured.failed.replace("\n", " ");
        item.put("before", content.substring(blockStart, blockEnd));
        item.put("after", comment + eol + prefix + replacement
                + content.substring(span.endOffset(), blockEnd));
        return status(item, "unmeasured",
                "Occurrence jamais mesurée en échec : cible proposée d'après la guérison mesurée "
                        + "à la ligne " + measuredLine + " du même test. Écriture uniquement sur "
                        + "confirmation explicite.");
    }

    // ---------------------------------------------------------------------------------------
    // Apply
    // ---------------------------------------------------------------------------------------

    public synchronized Map<String, Object> apply(List<Path> sessionFiles, String sessionId,
                                                  List<String> ids, boolean all,
                                                  boolean includeManual, boolean auto) {
        Map<String, Object> plan = plan(sessionFiles, sessionId == null ? null : sessionId, null);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> items = (List<Map<String, Object>>) plan.get("items");
        Set<String> wanted = ids == null ? Set.of() : new LinkedHashSet<>(ids);
        List<Map<String, Object>> selected = new ArrayList<>();
        List<Map<String, Object>> skipped = new ArrayList<>();
        for (Map<String, Object> item : items) {
            String status = String.valueOf(item.get("status"));
            boolean explicit = !wanted.isEmpty() && wanted.contains(String.valueOf(item.get("id")));
            boolean chosen;
            if (!wanted.isEmpty()) {
                chosen = explicit;
            } else if (auto) {
                chosen = "writable".equals(status) && marginIsSafe(item);
            } else if (all) {
                chosen = "writable".equals(status) || (includeManual && "manual".equals(status));
            } else {
                chosen = "writable".equals(status);
            }
            if (!chosen) {
                if (!"applied".equals(status) && !"writable".equals(status)) {
                    skipped.add(skip(item, String.valueOf(item.get("reason"))));
                }
                continue;
            }
            if ("manual".equals(status) && !includeManual) {
                skipped.add(skip(item, "Argument non littéral : confirmation requise."));
                continue;
            }
            // An unmeasured occurrence is only written when its id is explicitly requested
            // (dashboard button or CLI id): "write all" and automatic mode never select it.
            if ("unmeasured".equals(status) && !explicit) {
                skipped.add(skip(item, "Occurrence non mesurée : confirmation explicite requise."));
                continue;
            }
            if (!"writable".equals(status) && !"manual".equals(status)
                    && !"unmeasured".equals(status)) {
                skipped.add(skip(item, "Statut non réécrivable : " + status + "."));
                continue;
            }
            selected.add(item);
        }
        if (selected.isEmpty()) {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("transactionId", null);
            out.put("applied", List.of());
            out.put("skipped", skipped);
            out.put("message", "Aucun locator sélectionné.");
            return out;
        }
        String transactionId = "tx-" + TX_FORMAT.format(Instant.now()) + "-" + shortHash(Instant.now().toString());
        Path txDir = journalRoot.resolve(transactionId);
        Path backupDir = txDir.resolve("backup");
        List<Map<String, Object>> applied = new ArrayList<>();
        List<JournalEntry> entries = new ArrayList<>();
        Map<Path, List<Map<String, Object>>> byFile = new LinkedHashMap<>();
        for (Map<String, Object> item : selected) {
            Path file = Paths.get(String.valueOf(item.get("absoluteFile"))).toAbsolutePath().normalize();
            byFile.computeIfAbsent(file, k -> new ArrayList<>()).add(item);
        }
        for (Map.Entry<Path, List<Map<String, Object>>> group : byFile.entrySet()) {
            Path file = group.getKey();
            Path real = allowedFile(file.toString());
            if (real == null) {
                for (Map<String, Object> item : group.getValue()) {
                    skipped.add(skip(item, "Fichier hors des racines autorisées."));
                }
                continue;
            }
            String content;
            try {
                content = Files.readString(real, StandardCharsets.UTF_8);
            } catch (IOException e) {
                for (Map<String, Object> item : group.getValue()) {
                    skipped.add(skip(item, "Fichier illisible : " + e.getMessage()));
                }
                continue;
            }
            String eol = content.contains("\r\n") ? "\r\n" : "\n";
            List<Edit> edits = new ArrayList<>();
            for (Map<String, Object> item : group.getValue()) {
                String failed = String.valueOf(item.get("failed"));
                List<String> apis = toStringList(item.get("apis"));
                int line = ((Number) item.get("line")).intValue();
                int column = ((Number) item.get("column")).intValue();
                SourceChain.Span span = SourceChain.locate(content, line, column, apis,
                        SourceChain.allStringLiterals(failed), SourceChain.countSegments(failed));
                if (span == null) {
                    skipped.add(skip(item, "Chaîne déplacée ou modifiée depuis la mesure."));
                    continue;
                }
                String indent = leadingWhitespace(content, span.startOffset());
                int blockStart = lineStart(content, span.startOffset());
                int blockEnd = lineEnd(content, span.endOffset());
                String prefix = content.substring(blockStart, span.startOffset());
                String replacement = span.rootText() + ".locator("
                        + jsString(String.valueOf(item.get("locatorArgument"))) + ")";
                String comment = indent + "// healwright: " + failed.replace("\n", " ");
                String afterBlock = comment + eol + prefix + replacement
                        + content.substring(span.endOffset(), blockEnd);
                String beforeBlock = content.substring(blockStart, blockEnd);
                edits.add(new Edit(blockStart, blockEnd, beforeBlock, afterBlock,
                        span.startLine(), item, failed));
            }
            if (edits.isEmpty()) {
                continue;
            }
            edits.sort(Comparator.comparingInt(Edit::start).reversed());
            StringBuilder updated = new StringBuilder(content);
            for (Edit edit : edits) {
                updated.replace(edit.start, edit.end, edit.afterBlock);
            }
            try {
                Files.createDirectories(backupDir);
                Files.writeString(backupDir.resolve(shortHash(real.toString()) + ".orig"), content,
                        StandardCharsets.UTF_8);
                writeAtomic(real, updated.toString());
            } catch (IOException e) {
                for (Edit edit : edits) {
                    skipped.add(skip(edit.item, "Écriture impossible : " + e.getMessage()));
                }
                continue;
            }
            for (Edit edit : edits) {
                Map<String, Object> item = edit.item;
                String entryId = String.valueOf(item.get("id"));
                // Every edit inserts one comment line, so an edit's line in the written file is
                // its measured line plus the edits that precede it. Journaling the written line
                // keeps revert's proximity check exact for identical blocks.
                int writtenLine = edit.startLine;
                for (Edit other : edits) {
                    if (other.start < edit.start) {
                        writtenLine++;
                    }
                }
                entries.add(new JournalEntry(transactionId, entryId, real.toString(),
                        writtenLine, edit.beforeBlock, edit.afterBlock, edit.failed,
                        String.valueOf(item.get("healed")),
                        String.valueOf(item.get("healedValue")),
                        item.get("score") == null ? null : ((Number) item.get("score")).doubleValue(),
                        item.get("sessions") instanceof List<?> list && !list.isEmpty()
                                ? String.valueOf(list.get(0)) : null,
                        Instant.now().toString(), null));
                Map<String, Object> done = new LinkedHashMap<>(item);
                done.put("status", "applied");
                done.put("transactionId", transactionId);
                done.put("appliedLine", writtenLine);
                applied.add(done);
            }
        }
        persistJournal(transactionId, entries);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("transactionId", entries.isEmpty() ? null : transactionId);
        out.put("applied", applied);
        out.put("skipped", skipped);
        out.put("journal", journalRoot.resolve(transactionId).toString());
        return out;
    }

    private boolean marginIsSafe(Map<String, Object> item) {
        Object margin = item.get("margin");
        return margin == null || ((Number) margin).doubleValue() >= AMBIGUITY_MARGIN;
    }

    private static Map<String, Object> skip(Map<String, Object> item, String reason) {
        Map<String, Object> skipped = new LinkedHashMap<>();
        skipped.put("id", item.get("id"));
        skipped.put("file", item.get("file"));
        skipped.put("line", item.get("line"));
        skipped.put("failed", item.get("failed"));
        skipped.put("reason", reason);
        return skipped;
    }

    private record Edit(int start, int end, String beforeBlock, String afterBlock, int startLine,
                        Map<String, Object> item, String failed) {
    }

    // ---------------------------------------------------------------------------------------
    // Revert
    // ---------------------------------------------------------------------------------------

    public synchronized Map<String, Object> revert(String scope, String sessionId,
                                                   String transactionId, List<String> ids) {
        List<Journal> journals = loadJournals();
        List<JournalEntry> candidates = new ArrayList<>();
        Set<String> wantedIds = ids == null ? Set.of() : new LinkedHashSet<>(ids);
        if (!wantedIds.isEmpty()) {
            // Per-locator restore: the dashboard's "Restaurer" button on one attempt.
            for (Journal journal : journals) {
                for (JournalEntry entry : journal.entries) {
                    if (wantedIds.contains(entry.id)) {
                        candidates.add(entry);
                    }
                }
            }
        } else if ("transaction".equals(scope)) {
            for (Journal journal : journals) {
                if (journal.transactionId.equals(transactionId)) {
                    candidates.addAll(journal.entries);
                }
            }
        } else if ("session".equals(scope)) {
            for (Journal journal : journals) {
                for (JournalEntry entry : journal.entries) {
                    if (sessionId != null && sessionId.equals(entry.sessionId)) {
                        candidates.add(entry);
                    }
                }
            }
        } else if ("all".equals(scope)) {
            for (Journal journal : journals) {
                candidates.addAll(journal.entries);
            }
        } else {
            if (!journals.isEmpty()) {
                candidates.addAll(journals.get(0).entries);
            }
        }
        List<Map<String, Object>> restored = new ArrayList<>();
        List<Map<String, Object>> conflicts = new ArrayList<>();
        Map<Path, List<JournalEntry>> byFile = new LinkedHashMap<>();
        for (JournalEntry entry : candidates) {
            if (entry.revertedAt != null) {
                continue;
            }
            Path file = allowedFile(entry.file);
            if (file == null) {
                conflicts.add(revertResult(entry, "Fichier hors des racines autorisées."));
                continue;
            }
            byFile.computeIfAbsent(file, k -> new ArrayList<>()).add(entry);
        }
        for (Map.Entry<Path, List<JournalEntry>> group : byFile.entrySet()) {
            Path file = group.getKey();
            String content;
            try {
                content = Files.readString(file, StandardCharsets.UTF_8);
            } catch (IOException e) {
                for (JournalEntry entry : group.getValue()) {
                    conflicts.add(revertResult(entry, "Fichier illisible : " + e.getMessage()));
                }
                continue;
            }
            StringBuilder updated = new StringBuilder(content);
            List<JournalEntry> toRevert = new ArrayList<>();
            for (JournalEntry entry : group.getValue()) {
                int index = findBlock(updated, entry.afterBlock, entry.line);
                if (index < 0) {
                    conflicts.add(revertResult(entry,
                            "Bloc réécrit introuvable (édition manuelle depuis l'application)."));
                    continue;
                }
                updated.replace(index, index + entry.afterBlock.length(), entry.beforeBlock);
                toRevert.add(entry);
            }
            if (toRevert.isEmpty()) {
                continue;
            }
            try {
                writeAtomic(file, updated.toString());
            } catch (IOException e) {
                for (JournalEntry entry : toRevert) {
                    conflicts.add(revertResult(entry, "Écriture impossible : " + e.getMessage()));
                }
                continue;
            }
            for (JournalEntry entry : toRevert) {
                restored.add(revertResult(entry, null));
            }
        }
        Set<String> touched = new LinkedHashSet<>();
        Set<String> restoredIds = new LinkedHashSet<>();
        for (Map<String, Object> result : restored) {
            Object tx = result.get("transactionId");
            if (tx != null) {
                touched.add(String.valueOf(tx));
            }
            Object id = result.get("id");
            if (id != null) {
                restoredIds.add(String.valueOf(id));
            }
        }
        markReverted(journals, touched, restoredIds);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("restored", restored);
        out.put("conflicts", conflicts);
        return out;
    }

    private static Map<String, Object> revertResult(JournalEntry entry, String reason) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", entry.id);
        result.put("transactionId", entry.transactionId);
        result.put("file", entry.file);
        result.put("line", entry.line);
        result.put("failed", entry.failed);
        result.put("status", reason == null ? "restored" : "conflict");
        if (reason != null) {
            result.put("reason", reason);
        }
        return result;
    }

    /**
     * Find an exact after-block. Repeated identical blocks are disambiguated by proximity to the
     * line the journal recorded; anything else is reported, never guessed.
     */
    private static int findBlock(StringBuilder content, String block, int line) {
        String text = content.toString();
        List<Integer> hits = new ArrayList<>();
        int from = 0;
        while (true) {
            int index = text.indexOf(block, from);
            if (index < 0) {
                break;
            }
            hits.add(index);
            from = index + 1;
        }
        if (hits.isEmpty()) {
            return -1;
        }
        if (hits.size() == 1) {
            return hits.get(0);
        }
        int best = -1;
        int bestDistance = Integer.MAX_VALUE;
        for (int index : hits) {
            int distance = Math.abs(SourceChain.lineOf(text, index) - line);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = index;
            }
        }
        return bestDistance <= 2 ? best : -1;
    }

    // ---------------------------------------------------------------------------------------
    // Journal
    // ---------------------------------------------------------------------------------------

    private record JournalEntry(String transactionId, String id, String file, int line,
                                String beforeBlock, String afterBlock, String failed,
                                String healed, String healedValue, Double score, String sessionId,
                                String appliedAt, String revertedAt) {
    }

    private record Journal(String transactionId, List<JournalEntry> entries) {
    }

    private void persistJournal(String transactionId, List<JournalEntry> entries) {
        if (entries.isEmpty()) {
            return;
        }
        Path dir = journalRoot.resolve(transactionId);
        try {
            Files.createDirectories(dir);
            List<Map<String, Object>> serialized = new ArrayList<>();
            for (JournalEntry entry : entries) {
                Map<String, Object> map = new LinkedHashMap<>();
                map.put("id", entry.id);
                map.put("file", entry.file);
                map.put("line", entry.line);
                map.put("beforeBlock", entry.beforeBlock);
                map.put("afterBlock", entry.afterBlock);
                map.put("failed", entry.failed);
                map.put("healed", entry.healed);
                map.put("healedValue", entry.healedValue);
                map.put("score", entry.score);
                map.put("sessionId", entry.sessionId);
                map.put("appliedAt", entry.appliedAt);
                map.put("revertedAt", entry.revertedAt);
                serialized.add(map);
            }
            Map<String, Object> document = new LinkedHashMap<>();
            document.put("transactionId", transactionId);
            document.put("createdAt", Instant.now().toString());
            document.put("entries", serialized);
            Files.writeString(dir.resolve("journal.json"),
                    MAPPER.writeValueAsString(document), StandardCharsets.UTF_8);
        } catch (IOException e) {
            log.warn("[Healwright] Could not persist rewrite journal {}: {}", transactionId,
                    e.getMessage());
        }
    }

    private List<Journal> loadJournals() {
        List<Journal> journals = new ArrayList<>();
        if (!Files.isDirectory(journalRoot)) {
            return journals;
        }
        try (Stream<Path> stream = Files.list(journalRoot)) {
            List<Path> dirs = stream.filter(Files::isDirectory)
                    .sorted(Comparator.comparing((Path p) -> p.getFileName().toString()).reversed())
                    .toList();
            for (Path dir : dirs) {
                Path file = dir.resolve("journal.json");
                if (!Files.isRegularFile(file)) {
                    continue;
                }
                try {
                    JsonNode root = MAPPER.readTree(Files.readString(file, StandardCharsets.UTF_8));
                    List<JournalEntry> entries = new ArrayList<>();
                    JsonNode array = root.get("entries");
                    if (array != null && array.isArray()) {
                        for (JsonNode node : array) {
                            entries.add(new JournalEntry(
                                    dir.getFileName().toString(),
                                    text(node.get("id")), text(node.get("file")),
                                    (int) number(node.get("line")),
                                    text(node.get("beforeBlock")), text(node.get("afterBlock")),
                                    text(node.get("failed")), text(node.get("healed")),
                                    text(node.get("healedValue")), number(node.get("score")),
                                    text(node.get("sessionId")), text(node.get("appliedAt")),
                                    text(node.get("revertedAt"))));
                        }
                    }
                    journals.add(new Journal(dir.getFileName().toString(), entries));
                } catch (RuntimeException e) {
                    log.debug("[Healwright] Unreadable rewrite journal {}: {}", file, e.getMessage());
                }
            }
        } catch (IOException e) {
            log.debug("[Healwright] Rewrite journal dir unreadable: {}", e.getMessage());
        }
        return journals;
    }

    private void markReverted(List<Journal> journals, Set<String> transactionIds,
                              Set<String> restoredIds) {
        for (Journal journal : journals) {
            if (!transactionIds.contains(journal.transactionId)) {
                continue;
            }
            List<Map<String, Object>> serialized = new ArrayList<>();
            for (JournalEntry entry : journal.entries) {
                Map<String, Object> map = new LinkedHashMap<>();
                // Only the entries actually restored are stamped, so a per-locator restore
                // leaves its siblings marked as applied.
                String revertedAt = entry.revertedAt;
                if (revertedAt == null && restoredIds.contains(entry.id)) {
                    revertedAt = Instant.now().toString();
                }
                map.put("id", entry.id);
                map.put("file", entry.file);
                map.put("line", entry.line);
                map.put("beforeBlock", entry.beforeBlock);
                map.put("afterBlock", entry.afterBlock);
                map.put("failed", entry.failed);
                map.put("healed", entry.healed);
                map.put("healedValue", entry.healedValue);
                map.put("score", entry.score);
                map.put("sessionId", entry.sessionId);
                map.put("appliedAt", entry.appliedAt);
                map.put("revertedAt", revertedAt);
                serialized.add(map);
            }
            Map<String, Object> document = new LinkedHashMap<>();
            document.put("transactionId", journal.transactionId);
            document.put("entries", serialized);
            try {
                Files.writeString(journalRoot.resolve(journal.transactionId).resolve("journal.json"),
                        MAPPER.writeValueAsString(document), StandardCharsets.UTF_8);
            } catch (IOException e) {
                log.warn("[Healwright] Could not update journal {}: {}",
                        journal.transactionId, e.getMessage());
            }
        }
    }

    /** Latest applied entry per rewrite id, so the plan can show "déjà réécrit". */
    private Map<String, JournalEntry> appliedIndex() {
        Map<String, JournalEntry> index = new LinkedHashMap<>();
        for (Journal journal : loadJournals()) {
            for (JournalEntry entry : journal.entries) {
                if (entry.revertedAt == null) {
                    index.put(entry.id, entry);
                }
            }
        }
        return index;
    }

    // ---------------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------------

    private Path allowedFile(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        Path path = Paths.get(raw).toAbsolutePath().normalize();
        if (!Files.isRegularFile(path)) {
            return null;
        }
        Path real = realPath(path);
        for (Path root : roots) {
            if (real.startsWith(root)) {
                return real;
            }
        }
        return null;
    }

    private static Path realPath(Path path) {
        try {
            return path.toRealPath();
        } catch (IOException e) {
            return path;
        }
    }

    private String displayPath(String raw) {
        if (raw == null) {
            return null;
        }
        Path path = Paths.get(raw).toAbsolutePath().normalize();
        for (Path root : roots) {
            if (path.startsWith(root)) {
                return root.relativize(path).toString();
            }
        }
        return path.getFileName() == null ? raw : path.getFileName().toString();
    }

    private static int lineStart(String content, int offset) {
        int index = content.lastIndexOf('\n', Math.max(0, offset - 1));
        return index + 1;
    }

    private static int lineEnd(String content, int offset) {
        int index = content.indexOf('\n', Math.max(0, offset));
        return index < 0 ? content.length() : index;
    }

    private static String leadingWhitespace(String content, int offset) {
        int start = lineStart(content, offset);
        int end = start;
        while (end < content.length()
                && (content.charAt(end) == ' ' || content.charAt(end) == '\t')) {
            end++;
        }
        return content.substring(start, end);
    }

    private static String jsString(String value) {
        String escaped = value.replace("\\", "\\\\").replace("'", "\\'")
                .replace("\n", "\\n").replace("\r", "\\r");
        return "'" + escaped + "'";
    }

    /** Playwright auto-detects CSS; an XPath value needs the xpath= prefix to be replayed. */
    private static String locatorArgument(String value, String type) {
        if (value == null) {
            return "";
        }
        if (type != null && type.toLowerCase().contains("xpath")
                && !value.startsWith("xpath=") && !value.startsWith("//")) {
            return "xpath=" + value;
        }
        return value;
    }

    private static void writeAtomic(Path file, String content) throws IOException {
        Path temp = Files.createTempFile(file.getParent(), ".healwright-", ".tmp");
        Files.writeString(temp, content, StandardCharsets.UTF_8,
                StandardOpenOption.TRUNCATE_EXISTING);
        try {
            Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private static String sessionIdOf(Path file) {
        String name = file.getFileName().toString();
        return name.endsWith(".jsonl") ? name.substring(0, name.length() - ".jsonl".length()) : name;
    }

    private static String text(JsonNode node) {
        return node == null || node.isNull() ? null : node.asText();
    }

    private static double number(JsonNode node) {
        if (node == null || node.isNull()) {
            return 0;
        }
        return node.asDouble();
    }

    private static List<String> textList(JsonNode node) {
        List<String> out = new ArrayList<>();
        if (node != null && node.isArray()) {
            for (JsonNode entry : node) {
                out.add(entry.asText());
            }
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    private static List<String> toStringList(Object value) {
        return value instanceof List<?> list
                ? list.stream().map(String::valueOf).toList() : List.of();
    }

    private static String newest(Set<String> values) {
        String last = null;
        for (String value : values) {
            last = value;
        }
        return last;
    }

    private static String shortHash(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(bytes, 0, 8);
        } catch (NoSuchAlgorithmException e) {
            return Integer.toHexString(value.hashCode());
        }
    }

    private static final class Aggregate {
        private String id;
        private String file;
        private int line;
        private int column;
        private String failed;
        private List<String> apis = List.of();
        private String healedValue;
        private String healedType;
        private Double score;
        private Double margin;
        private int occurrences;
        private final Set<String> sessionIds = new LinkedHashSet<>();
        private final Set<String> healedExpressions = new LinkedHashSet<>();
    }
}
