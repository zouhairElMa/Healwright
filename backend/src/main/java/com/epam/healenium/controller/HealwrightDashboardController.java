package com.epam.healenium.controller;

import com.epam.healenium.repository.HealingRepository;
import com.epam.healenium.repository.HealingResultRepository;
import com.epam.healenium.repository.ReportRepository;
import com.epam.healenium.repository.SelectorRepository;
import com.epam.healenium.rewrite.RewriteService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.ModelAndView;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Healwright addition (Apache-2.0 fork, see docs/licenses): serves the Healwright reporting
 * dashboard at the root ("/") from classpath:/static/healwright/ and exposes the local JSONL
 * telemetry written by Healwright's LocalReporter, mirroring healwright/scripts/report-server.mjs
 * so the embedded SPA works same-origin without the Node proxy. The legacy "/healwright/" path
 * redirects to "/".
 *
 * <p>Telemetry dirs: env HEALWRIGHT_REPORT_DIR (default ./.healwright/reports, relative to the
 * backend working directory) plus every absolute dir recorded by the test process in the shared
 * registry (~/.healwright/dirs.json, written by LocalReporter; override with
 * HEALWRIGHT_REPORT_REGISTRY). The registry removes the need to align env vars between the
 * Playwright test process and the backend.
 *
 * <p>Phase-22 additions: {@code GET /api/telemetry/summary} aggregates every JSONL session on the
 * server (per-file cache keyed by size+mtime) so the dashboard reports real attempts instead of
 * only the PostgreSQL healing records, and {@code POST /api/admin/clean} empties the PostgreSQL
 * tables behind an explicit confirmation header. Telemetry files are never deleted.
 */
@Slf4j
@RestController
public class HealwrightDashboardController {

    private static final Pattern UID_PATTERN = Pattern.compile("[A-Za-z0-9_-]{1,128}");
    private static final String JSONL_SUFFIX = ".jsonl";
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Path DEFAULT_REGISTRY =
            Paths.get(System.getProperty("user.home"), ".healwright", "dirs.json");
    private static final int MAX_MISSES_PER_SESSION = 200;
    private static final long RUN_GAP_SECONDS = 600L;

    private final Path reportDir;
    private final HealingResultRepository healingResultRepository;
    private final HealingRepository healingRepository;
    private final ReportRepository reportRepository;
    private final SelectorRepository selectorRepository;
    private final RewriteService rewriteService;
    private final ConcurrentHashMap<String, CachedSession> sessionCache = new ConcurrentHashMap<>();

    public HealwrightDashboardController(HealingResultRepository healingResultRepository,
                                         HealingRepository healingRepository,
                                         ReportRepository reportRepository,
                                         SelectorRepository selectorRepository,
                                         RewriteService rewriteService) {
        this.healingResultRepository = healingResultRepository;
        this.healingRepository = healingRepository;
        this.reportRepository = reportRepository;
        this.selectorRepository = selectorRepository;
        this.rewriteService = rewriteService;
        String env = System.getenv("HEALWRIGHT_REPORT_DIR");
        this.reportDir = Paths.get(env != null && !env.isBlank() ? env : ".healwright/reports")
                .toAbsolutePath().normalize();
        log.info("[Healwright] Dashboard telemetry dir: {} (registry: {})", this.reportDir, registryFile());
    }

    private static Path registryFile() {
        String env = System.getenv("HEALWRIGHT_REPORT_REGISTRY");
        return (env != null && !env.isBlank() ? Paths.get(env) : DEFAULT_REGISTRY)
                .toAbsolutePath().normalize();
    }

    /**
     * Primary dir first, then every absolute dir the test process registered. Unreadable or
     * malformed registry entries are skipped: discovery must never break the dashboard.
     */
    private List<Path> telemetryDirs() {
        List<Path> dirs = new ArrayList<>();
        dirs.add(reportDir);
        Path registry = registryFile();
        if (!Files.isRegularFile(registry)) {
            return dirs;
        }
        try {
            JsonNode root = MAPPER.readTree(Files.readString(registry, StandardCharsets.UTF_8));
            JsonNode entries = root == null ? null : root.get("dirs");
            if (entries != null && entries.isArray()) {
                for (JsonNode entry : entries) {
                    if (!entry.isTextual()) {
                        continue;
                    }
                    Path dir;
                    try {
                        dir = Paths.get(entry.asText());
                    } catch (RuntimeException e) {
                        continue;
                    }
                    if (!dir.isAbsolute()) {
                        continue;
                    }
                    dir = dir.normalize();
                    if (!dirs.contains(dir)) {
                        dirs.add(dir);
                    }
                }
            }
        } catch (IOException | JacksonException e) {
            log.debug("[Healwright] Report registry unreadable: {}", e.getMessage());
        } catch (RuntimeException e) {
            log.debug("[Healwright] Report registry unreadable: {}", e.getMessage());
        }
        return dirs;
    }

    private static Path findSession(List<Path> dirs, String uid) {
        for (Path dir : dirs) {
            Path file = dir.resolve(uid + JSONL_SUFFIX).normalize();
            if (file.startsWith(dir) && Files.isRegularFile(file)) {
                return file;
            }
        }
        return null;
    }

    /**
     * Phase-18: the Healwright dashboard replaces the upstream Healenium report at the root.
     * "/" wins over Spring Boot's welcome-page mapping (Thymeleaf templates/index.html).
     */
    @GetMapping({"/", "/index.html"})
    public ModelAndView dashboard() {
        return new ModelAndView("forward:/healwright/index.html");
    }

    /** The former dashboard path is retired; bookmarks land on the root dashboard. */
    @GetMapping({"/healwright", "/healwright/"})
    public ModelAndView legacyDashboard() {
        return new ModelAndView("redirect:/");
    }

    @GetMapping({"/api/config", "/healwright/api/config"})
    public Map<String, Object> config(HttpServletRequest request) {
        String backend = request.getScheme() + "://" + request.getServerName() + ":" + request.getServerPort();
        Map<String, Object> cfg = new LinkedHashMap<>();
        cfg.put("backend", backend);
        cfg.put("reportDir", reportDir.toString());
        cfg.put("reportDirs", telemetryDirs().stream().map(Path::toString).toList());
        cfg.put("backendBase", "");
        cfg.put("telemetryBase", "");
        return cfg;
    }

    @GetMapping({"/api/telemetry", "/healwright/api/telemetry"})
    public List<Map<String, Object>> listTelemetry() {
        List<Path> dirs = telemetryDirs();
        Map<String, Map<String, Object>> sessions = new LinkedHashMap<>();
        for (Path dir : dirs) {
            try (Stream<Path> files = Files.list(dir)) {
                files.filter(Files::isRegularFile)
                        .map(p -> p.getFileName().toString())
                        .filter(name -> name.endsWith(JSONL_SUFFIX))
                        .map(name -> name.substring(0, name.length() - JSONL_SUFFIX.length()))
                        .filter(id -> UID_PATTERN.matcher(id).matches())
                        .sorted()
                        .forEach(id -> sessions.putIfAbsent(id, sessionMeta(dirs, id)));
            } catch (IOException e) {
                log.debug("[Healwright] Telemetry dir unreadable ({}): {}", dir, e.getMessage());
            }
        }
        return new ArrayList<>(sessions.values());
    }

    /** Phase-17 parity: the first report.meta line carries the Playwright test name and file. */
    private Map<String, Object> sessionMeta(List<Path> dirs, String id) {
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("sessionId", id);
        meta.put("testName", null);
        meta.put("testFile", null);
        Path file = findSession(dirs, id);
        if (file == null) {
            return meta;
        }
        try {
            for (String line : Files.readAllLines(file, StandardCharsets.UTF_8)) {
                if (line.isBlank() || !line.contains("\"report.meta\"")) {
                    continue;
                }
                JsonNode node = MAPPER.readTree(line);
                JsonNode event = node.get("event");
                if (event != null && "report.meta".equals(event.asText())) {
                    meta.put("testName", textOf(node.get("testName")));
                    meta.put("testFile", textOf(node.get("testFile")));
                    break;
                }
            }
        } catch (IOException | JacksonException e) {
            log.debug("[Healwright] report.meta unreadable for {}: {}", id, e.getMessage());
        }
        return meta;
    }

    private static String textOf(JsonNode node) {
        return node == null || node.isNull() ? null : node.asText();
    }

    @GetMapping({"/api/telemetry/{uid}", "/healwright/api/telemetry/{uid}"})
    public Map<String, Object> telemetry(@PathVariable String uid) {
        if (!UID_PATTERN.matcher(uid).matches()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        Path file = findSession(telemetryDirs(), uid);
        if (file == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        List<Object> events = new ArrayList<>();
        try {
            for (String line : Files.readAllLines(file, StandardCharsets.UTF_8)) {
                if (line.isBlank()) {
                    continue;
                }
                try {
                    events.add(MAPPER.readTree(line));
                } catch (JacksonException ignored) {
                    // A torn last line (concurrent writer) must not break the view.
                }
            }
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("sessionId", uid);
        payload.put("events", events);
        return payload;
    }

    // ---------------------------------------------------------------------------------------
    // Phase-24: write a healed locator back into the Playwright source. The engine (RewriteService)
    // is shared by the dashboard, the healwright-rewrite CLI and the fixture's automatic mode.
    // Writing requires HEALWRIGHT_APPLY_ROOTS (allowlist) and the X-Healwright-Apply header;
    // nothing outside those roots is ever touched and no git command is run.
    // ---------------------------------------------------------------------------------------

    @GetMapping({"/api/healwright/rewrite/plan", "/healwright/api/healwright/rewrite/plan"})
    public Map<String, Object> rewritePlan(@RequestParam(required = false) String session,
                                           @RequestParam(required = false) String file) {
        return rewriteService.plan(sessionFiles(), session, file);
    }

    @PostMapping({"/api/healwright/rewrite/apply", "/healwright/api/healwright/rewrite/apply"})
    public Map<String, Object> rewriteApply(@RequestBody(required = false) Map<String, Object> body,
                                            @RequestHeader(value = "X-Healwright-Apply", required = false)
                                            String confirm) {
        requireApply(confirm);
        Map<String, Object> request = body == null ? Map.of() : body;
        String sessionId = textOrNull(request.get("sessionId"));
        List<String> ids = request.get("ids") instanceof List<?> list
                ? list.stream().map(String::valueOf).toList() : null;
        boolean all = Boolean.TRUE.equals(request.get("all"));
        boolean includeManual = Boolean.TRUE.equals(request.get("includeManual"));
        boolean auto = Boolean.TRUE.equals(request.get("auto"));
        return rewriteService.apply(sessionFiles(), sessionId, ids, all, includeManual, auto);
    }

    @PostMapping({"/api/healwright/rewrite/revert", "/healwright/api/healwright/rewrite/revert"})
    public Map<String, Object> rewriteRevert(@RequestBody(required = false) Map<String, Object> body,
                                             @RequestHeader(value = "X-Healwright-Apply", required = false)
                                             String confirm) {
        requireApply(confirm);
        Map<String, Object> request = body == null ? Map.of() : body;
        String scope = textOrNull(request.get("scope"));
        List<String> ids = request.get("ids") instanceof List<?> list
                ? list.stream().map(String::valueOf).toList() : null;
        return rewriteService.revert(scope == null ? "last" : scope,
                textOrNull(request.get("sessionId")), textOrNull(request.get("transactionId")),
                ids);
    }

    @GetMapping({"/api/healwright/rewrite/status", "/healwright/api/healwright/rewrite/status"})
    public Map<String, Object> rewriteStatus() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("enabled", rewriteService.enabled());
        out.put("roots", rewriteService.roots().stream().map(Path::toString).toList());
        return out;
    }

    private void requireApply(String confirm) {
        if (!rewriteService.enabled()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "Source rewrite is disabled: set HEALWRIGHT_APPLY_ROOTS to the project root(s).");
        }
        if (!"APPLY".equals(confirm)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "Confirmation header X-Healwright-Apply: APPLY is required");
        }
    }

    private static String textOrNull(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    /** Every active JSONL session, as seen by the dashboard. */
    private List<Path> sessionFiles() {
        List<Path> files = new ArrayList<>();
        for (Path dir : telemetryDirs()) {
            if (!Files.isDirectory(dir)) {
                continue;
            }
            try (Stream<Path> stream = Files.list(dir)) {
                stream.filter(Files::isRegularFile)
                        .filter(path -> path.getFileName().toString().endsWith(JSONL_SUFFIX))
                        .forEach(files::add);
            } catch (IOException e) {
                log.debug("[Healwright] Telemetry dir unreadable ({}): {}", dir, e.getMessage());
            }
        }
        return files;
    }

    // ---------------------------------------------------------------------------------------
    // Phase-22: server-side aggregation of every JSONL session. The dashboard used to count only
    // the PostgreSQL healing records, which are written on success only, hence the misleading
    // "100% success". Attempts, misses and skips now come from the telemetry itself.
    // ---------------------------------------------------------------------------------------

    @GetMapping({"/api/telemetry/summary", "/healwright/api/telemetry/summary"})
    public Map<String, Object> summary(@RequestParam(required = false) String from,
                                       @RequestParam(required = false) String to,
                                       @RequestParam(required = false) String test,
                                       @RequestParam(required = false) String file,
                                       @RequestParam(required = false, defaultValue = "500") int limit) {
        Instant fromInstant = parseInstant(from);
        Instant toInstant = parseInstant(to);
        String needle = test == null || test.isBlank() ? null : test.trim().toLowerCase();
        // Phase-22c: exact test-file filter, applied before the 500-row cap so a file filter is
        // exhaustive over the whole telemetry corpus instead of the returned page.
        String exactFile = file == null || file.isBlank() ? null : file;
        int max = Math.max(1, Math.min(limit, 5000));

        List<Path> dirs = telemetryDirs();
        Map<String, Path> files = new LinkedHashMap<>();
        for (Path dir : dirs) {
            try (Stream<Path> stream = Files.list(dir)) {
                stream.filter(Files::isRegularFile)
                        .map(p -> p.getFileName().toString())
                        .filter(name -> name.endsWith(JSONL_SUFFIX))
                        .map(name -> name.substring(0, name.length() - JSONL_SUFFIX.length()))
                        .filter(id -> UID_PATTERN.matcher(id).matches())
                        .forEach(id -> files.putIfAbsent(id, dir.resolve(id + JSONL_SUFFIX)));
            } catch (IOException e) {
                log.debug("[Healwright] Telemetry dir unreadable ({}): {}", dir, e.getMessage());
            }
        }

        List<SessionSummary> matched = new ArrayList<>();
        for (Map.Entry<String, Path> entry : files.entrySet()) {
            SessionSummary s = loadSession(entry.getKey(), entry.getValue());
            if (s == null) {
                continue;
            }
            if (fromInstant != null && (s.startedAt == null || s.startedAt.isBefore(fromInstant))) {
                continue;
            }
            if (toInstant != null && (s.startedAt == null || s.startedAt.isAfter(toInstant))) {
                continue;
            }
            if (needle != null && !s.matches(needle)) {
                continue;
            }
            matched.add(s);
        }
        matched.sort(Comparator.comparing((SessionSummary s) ->
                s.startedAt == null ? Instant.EPOCH : s.startedAt).reversed());
        List<SessionSummary> selected = exactFile == null ? matched
                : matched.stream().filter(s -> exactFile.equals(s.testFile)).toList();

        Totals totals = new Totals();
        for (SessionSummary s : selected) {
            totals.add(s);
        }

        List<Map<String, Object>> sessions = new ArrayList<>();
        for (int i = 0; i < Math.min(selected.size(), max); i++) {
            sessions.add(selected.get(i).toRow());
        }

        Map<String, Map<String, Object>> unhealed = new LinkedHashMap<>();
        for (SessionSummary s : selected) {
            for (Miss miss : s.misses) {
                String key = miss.locator + "\u0000" + miss.reason;
                Map<String, Object> agg = unhealed.get(key);
                if (agg == null) {
                    agg = new LinkedHashMap<>();
                    agg.put("locator", miss.locator);
                    agg.put("type", miss.type);
                    agg.put("reason", miss.reason);
                    agg.put("count", 0);
                    agg.put("bestScore", miss.bestScore);
                    agg.put("lastTs", miss.ts == null ? null : miss.ts.toString());
                    agg.put("sampleSession", s.sessionId);
                    agg.put("sampleTest", s.testName);
                    agg.put("url", miss.url);
                    unhealed.put(key, agg);
                }
                agg.put("count", ((Number) agg.get("count")).intValue() + 1);
                if (miss.bestScore != null) {
                    Object best = agg.get("bestScore");
                    if (best == null || miss.bestScore > ((Number) best).doubleValue()) {
                        agg.put("bestScore", miss.bestScore);
                    }
                }
                if (miss.ts != null) {
                    Object last = agg.get("lastTs");
                    if (last == null || miss.ts.toString().compareTo(last.toString()) > 0) {
                        agg.put("lastTs", miss.ts.toString());
                        agg.put("sampleSession", s.sessionId);
                        agg.put("sampleTest", s.testName);
                        agg.put("url", miss.url);
                    }
                }
            }
        }
        List<Map<String, Object>> unhealedList = new ArrayList<>(unhealed.values());
        unhealedList.sort(Comparator
                .comparingInt((Map<String, Object> m) -> ((Number) m.get("count")).intValue()).reversed()
                .thenComparing(m -> String.valueOf(m.get("lastTs")), Comparator.reverseOrder()));
        if (unhealedList.size() > 150) {
            unhealedList = new ArrayList<>(unhealedList.subList(0, 150));
        }

        List<Map<String, Object>> reasons = new ArrayList<>();
        totals.reasons.entrySet().stream()
                .sorted(Map.Entry.<String, Integer>comparingByValue().reversed())
                .forEach(e -> {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("reason", e.getKey());
                    row.put("count", e.getValue());
                    reasons.add(row);
                });

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("generatedAt", Instant.now().toString());
        payload.put("sessionsTotal", selected.size());
        payload.put("sessionsReturned", sessions.size());
        payload.put("truncated", selected.size() > sessions.size());
        payload.put("telemetryFiles", files.size());
        payload.put("totals", totals.toMap());
        payload.put("reasons", reasons);
        payload.put("unhealed", unhealedList);
        payload.put("files", fileBreakdown(matched));
        payload.put("runs", buildRuns(selected));
        payload.put("sessions", sessions);
        return payload;
    }

    /**
     * Phase-22c: per-executed-file breakdown over every selected session (not the 500-row page),
     * so the dashboard can rank the files that heal worst. Empty testFile groups under "".
     */
    private List<Map<String, Object>> fileBreakdown(List<SessionSummary> selected) {
        Map<String, Totals> perFile = new LinkedHashMap<>();
        Map<String, Instant> lastSeen = new HashMap<>();
        for (SessionSummary s : selected) {
            String key = s.testFile == null || s.testFile.isBlank() ? "" : s.testFile;
            perFile.computeIfAbsent(key, k -> new Totals()).add(s);
            if (s.lastTs != null) {
                Instant prev = lastSeen.get(key);
                if (prev == null || s.lastTs.isAfter(prev)) {
                    lastSeen.put(key, s.lastTs);
                }
            }
        }
        List<Map<String, Object>> rows = new ArrayList<>();
        perFile.forEach((file, totals) -> {
            Map<String, Object> row = totals.toMap();
            row.put("testFile", file);
            Instant last = lastSeen.get(file);
            row.put("lastTs", last == null ? null : last.toString());
            rows.add(row);
        });
        rows.sort(Comparator
                .comparingInt((Map<String, Object> r) -> ((Number) r.get("sessions")).intValue()).reversed()
                .thenComparing(r -> String.valueOf(r.get("testFile"))));
        return rows;
    }

    private static Instant parseInstant(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return Instant.parse(value);
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    private SessionSummary loadSession(String id, Path file) {
        try {
            long size = Files.size(file);
            long modified = Files.getLastModifiedTime(file).toMillis();
            CachedSession cached = sessionCache.get(id);
            if (cached != null && cached.size == size && cached.modified == modified) {
                return cached.summary;
            }
            SessionSummary parsed = parseSession(id, file);
            sessionCache.put(id, new CachedSession(size, modified, parsed));
            return parsed;
        } catch (IOException e) {
            log.debug("[Healwright] Session unreadable ({}): {}", file, e.getMessage());
            return null;
        }
    }

    private SessionSummary parseSession(String id, Path file) throws IOException {
        SessionSummary s = new SessionSummary(id);
        for (String line : Files.readAllLines(file, StandardCharsets.UTF_8)) {
            if (line.isBlank()) {
                continue;
            }
            JsonNode node;
            try {
                node = MAPPER.readTree(line);
            } catch (JacksonException ignored) {
                continue;
            }
            if (node == null) {
                continue;
            }
            Instant ts = parseInstant(textOf(node.get("ts")));
            if (ts != null) {
                if (s.startedAt == null || ts.isBefore(s.startedAt)) {
                    s.startedAt = ts;
                }
                if (s.lastTs == null || ts.isAfter(s.lastTs)) {
                    s.lastTs = ts;
                }
            }
            String event = textOf(node.get("event"));
            if (event == null) {
                continue;
            }
            switch (event) {
                case "report.meta" -> {
                    String name = textOf(node.get("testName"));
                    String testFile = textOf(node.get("testFile"));
                    if (name != null) {
                        s.testName = name;
                    }
                    if (testFile != null) {
                        s.testFile = testFile;
                    }
                }
                case "heal.success" -> {
                    s.healed++;
                    Double score = doubleOf(node.get("score"));
                    if (score != null) {
                        s.scoreSum += score;
                        s.scoreCount++;
                    }
                    Double duration = doubleOf(node.get("durationMs"));
                    if (duration != null) {
                        s.durationSum += duration.longValue();
                        s.durationCount++;
                    }
                    String url = textOf(node.get("url"));
                    if (url != null) {
                        s.lastUrl = url;
                    }
                }
                case "heal.miss" -> {
                    s.missed++;
                    Double duration = doubleOf(node.get("durationMs"));
                    if (duration != null) {
                        s.durationSum += duration.longValue();
                        s.durationCount++;
                    }
                    String reason = textOf(node.get("reason"));
                    s.reasons.merge(reason == null ? "unknown" : reason, 1, Integer::sum);
                    JsonNode locator = node.get("locator");
                    Miss miss = new Miss();
                    miss.reason = reason == null ? "unknown" : reason;
                    if (locator != null) {
                        miss.locator = textOf(locator.get("value"));
                        miss.type = textOf(locator.get("type"));
                    }
                    JsonNode pw = node.get("playwright");
                    if (miss.locator == null && pw != null) {
                        miss.locator = textOf(pw.get("failed"));
                    }
                    miss.url = textOf(node.get("url"));
                    miss.ts = ts;
                    miss.bestScore = bestScore(node);
                    if (s.misses.size() < MAX_MISSES_PER_SESSION) {
                        s.misses.add(miss);
                    }
                }
                case "heal.skipped" -> {
                    s.skipped++;
                    String reason = textOf(node.get("reason"));
                    s.skipReasons.merge(reason == null ? "unknown" : reason, 1, Integer::sum);
                }
                case "replay.ok" -> s.replayOk++;
                case "replay.failed" -> s.replayFailed++;
                case "frame.healed" -> s.frames++;
                default -> {
                    // report.opening/opened/closing/closed, identity.redirected, heal.proposed:
                    // not part of the attempt denominators.
                }
            }
        }
        return s;
    }

    /** LCS top score when present (legacy/improved), else the best adaptive candidate score. */
    private static Double bestScore(JsonNode node) {
        JsonNode topScores = node.get("topScores");
        if (topScores != null && topScores.isArray() && !topScores.isEmpty()) {
            Double first = doubleOf(topScores.get(0));
            if (first != null) {
                return first;
            }
        }
        JsonNode candidates = node.get("candidates");
        if (candidates != null && candidates.isArray()) {
            Double best = null;
            for (JsonNode candidate : candidates) {
                Double score = doubleOf(candidate.get("score"));
                if (score != null && (best == null || score > best)) {
                    best = score;
                }
            }
            return best;
        }
        return doubleOf(node.get("score"));
    }

    private static Double doubleOf(JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        if (node.isNumber()) {
            return node.doubleValue();
        }
        if (node.isTextual()) {
            try {
                return Double.parseDouble(node.asText());
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }

    /**
     * Groups sessions into runs: consecutive sessions whose start is at most 10 minutes after the
     * previous one belong to the same run (one Playwright launch). Newest run first, 20 max.
     */
    private static List<Map<String, Object>> buildRuns(List<SessionSummary> sortedDesc) {
        List<SessionSummary> ascending = new ArrayList<>(sortedDesc);
        ascending.sort(Comparator.comparing(s -> s.startedAt == null ? Instant.EPOCH : s.startedAt));
        List<Map<String, Object>> runs = new ArrayList<>();
        Map<String, Object> current = null;
        Instant currentEnd = null;
        for (SessionSummary s : ascending) {
            if (s.startedAt == null) {
                continue;
            }
            boolean sameRun = current != null && currentEnd != null
                    && Duration.between(currentEnd, s.startedAt).getSeconds() <= RUN_GAP_SECONDS;
            if (!sameRun) {
                current = new LinkedHashMap<>();
                current.put("start", s.startedAt.toString());
                current.put("end", s.startedAt.toString());
                current.put("sessions", 0);
                current.put("healed", 0);
                current.put("missed", 0);
                runs.add(current);
            }
            current.put("end", s.startedAt.toString());
            current.put("sessions", ((Number) current.get("sessions")).intValue() + 1);
            current.put("healed", ((Number) current.get("healed")).intValue() + s.healed);
            current.put("missed", ((Number) current.get("missed")).intValue() + s.missed);
            currentEnd = s.startedAt;
        }
        List<Map<String, Object>> newest = new ArrayList<>(runs);
        newest.sort(Comparator.comparing((Map<String, Object> m) -> String.valueOf(m.get("end")))
                .reversed());
        return newest.size() > 20 ? new ArrayList<>(newest.subList(0, 20)) : newest;
    }

    // ---------------------------------------------------------------------------------------
    // Phase-22: explicit, local-only cleanup of the PostgreSQL state (selectors, healings,
    // results, reports). Phase-22c: the telemetry JSONL files can now be archived too, because a
    // telemetry-driven dashboard that keeps every KPI after "cleaning" reads as a broken button.
    // Files are moved to <reportDir>/.cleared/<timestamp>/, never deleted.
    // ---------------------------------------------------------------------------------------

    @GetMapping({"/api/admin/db-stats", "/healwright/api/admin/db-stats"})
    public Map<String, Object> dbStats() {
        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("reports", reportRepository.count());
        stats.put("selectors", selectorRepository.count());
        stats.put("healings", healingRepository.count());
        stats.put("healingResults", healingResultRepository.count());
        return stats;
    }

    @PostMapping({"/api/admin/clean", "/healwright/api/admin/clean"})
    @Transactional
    public Map<String, Object> clean(@RequestHeader(value = "X-Healwright-Clean", required = false) String confirm,
                                     @RequestParam(required = false, defaultValue = "false") boolean telemetry) {
        requireClean(confirm);
        Map<String, Object> deleted = new LinkedHashMap<>();
        deleted.put("healingResults", healingResultRepository.count());
        deleted.put("healings", healingRepository.count());
        deleted.put("reports", reportRepository.count());
        deleted.put("selectors", selectorRepository.count());
        healingResultRepository.deleteAllInBatch();
        healingRepository.deleteAllInBatch();
        reportRepository.deleteAllInBatch();
        selectorRepository.deleteAllInBatch();
        sessionCache.clear();
        log.warn("[Healwright] PostgreSQL state cleared on explicit request: {}", deleted);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("deleted", deleted);
        payload.put("telemetryKept", !telemetry);
        if (telemetry) {
            Map<String, Object> archived = archiveTelemetry();
            log.warn("[Healwright] Local telemetry archived on explicit request: {}", archived);
            payload.put("telemetry", archived);
        }
        return payload;
    }

    /** Archives the JSONL files without touching PostgreSQL (useful to reset the dashboard only). */
    @PostMapping({"/api/admin/clean-telemetry", "/healwright/api/admin/clean-telemetry"})
    public Map<String, Object> cleanTelemetry(
            @RequestHeader(value = "X-Healwright-Clean", required = false) String confirm) {
        requireClean(confirm);
        Map<String, Object> archived = archiveTelemetry();
        log.warn("[Healwright] Local telemetry archived on explicit request: {}", archived);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("telemetry", archived);
        return payload;
    }

    private static void requireClean(String confirm) {
        if (!"CLEAN".equals(confirm)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "Confirmation header X-Healwright-Clean: CLEAN is required");
        }
    }

    private Map<String, Object> archiveTelemetry() {
        String stamp = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss")
                .withZone(ZoneOffset.UTC)
                .format(Instant.now());
        int archived = 0;
        int failed = 0;
        List<String> archiveDirs = new ArrayList<>();
        for (Path dir : telemetryDirs()) {
            if (!Files.isDirectory(dir)) {
                continue;
            }
            List<Path> files;
            try (Stream<Path> stream = Files.list(dir)) {
                files = stream.filter(Files::isRegularFile)
                        .filter(p -> p.getFileName().toString().endsWith(JSONL_SUFFIX))
                        .toList();
            } catch (IOException e) {
                log.debug("[Healwright] Telemetry dir unreadable ({}): {}", dir, e.getMessage());
                continue;
            }
            if (files.isEmpty()) {
                continue;
            }
            Path target = dir.resolve(".cleared").resolve(stamp);
            try {
                Files.createDirectories(target);
            } catch (IOException e) {
                failed += files.size();
                log.warn("[Healwright] Cannot create archive dir {}: {}", target, e.getMessage());
                continue;
            }
            for (Path file : files) {
                try {
                    Files.move(file, target.resolve(file.getFileName()), StandardCopyOption.REPLACE_EXISTING);
                    archived++;
                } catch (IOException e) {
                    failed++;
                    log.debug("[Healwright] Cannot archive {}: {}", file, e.getMessage());
                }
            }
            archiveDirs.add(target.toString());
        }
        sessionCache.clear();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("archived", archived);
        out.put("failed", failed);
        out.put("archiveDirs", archiveDirs);
        return out;
    }

    // ---------------------------------------------------------------------------------------
    // Aggregation model
    // ---------------------------------------------------------------------------------------

    private record CachedSession(long size, long modified, SessionSummary summary) {
    }

    private static final class Miss {
        String locator;
        String type;
        String reason;
        String url;
        Instant ts;
        Double bestScore;
    }

    private static final class SessionSummary {
        final String sessionId;
        String testName;
        String testFile;
        String lastUrl;
        Instant startedAt;
        Instant lastTs;
        int healed;
        int missed;
        int skipped;
        int replayOk;
        int replayFailed;
        int frames;
        double scoreSum;
        int scoreCount;
        long durationSum;
        int durationCount;
        final Map<String, Integer> reasons = new HashMap<>();
        final Map<String, Integer> skipReasons = new HashMap<>();
        final List<Miss> misses = new ArrayList<>();

        SessionSummary(String sessionId) {
            this.sessionId = sessionId;
        }

        boolean matches(String needle) {
            return contains(testName, needle) || contains(testFile, needle)
                    || contains(sessionId, needle) || contains(lastUrl, needle);
        }

        private static boolean contains(String value, String needle) {
            return value != null && value.toLowerCase().contains(needle);
        }

        double successRate() {
            int attempts = healed + missed;
            return attempts == 0 ? 0 : Math.round((healed * 1000.0) / attempts) / 10.0;
        }

        Map<String, Object> toRow() {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("sessionId", sessionId);
            row.put("testName", testName);
            row.put("testFile", testFile);
            row.put("url", lastUrl);
            row.put("startedAt", startedAt == null ? null : startedAt.toString());
            row.put("lastTs", lastTs == null ? null : lastTs.toString());
            row.put("healed", healed);
            row.put("missed", missed);
            row.put("skipped", skipped);
            row.put("attempts", healed + missed + skipped);
            row.put("successRate", successRate());
            row.put("avgScore", scoreCount == 0 ? null : Math.round((scoreSum / scoreCount) * 1000) / 1000.0);
            row.put("avgDurationMs", durationCount == 0 ? null : Math.round((double) durationSum / durationCount));
            row.put("replayFailed", replayFailed);
            return row;
        }
    }

    private static final class Totals {
        int sessions;
        int healed;
        int missed;
        int skipped;
        int replayOk;
        int replayFailed;
        int frames;
        double scoreSum;
        int scoreCount;
        long durationSum;
        int durationCount;
        final Map<String, Integer> reasons = new HashMap<>();

        void add(SessionSummary s) {
            sessions++;
            healed += s.healed;
            missed += s.missed;
            skipped += s.skipped;
            replayOk += s.replayOk;
            replayFailed += s.replayFailed;
            frames += s.frames;
            scoreSum += s.scoreSum;
            scoreCount += s.scoreCount;
            durationSum += s.durationSum;
            durationCount += s.durationCount;
            s.reasons.forEach((k, v) -> reasons.merge(k, v, Integer::sum));
        }

        Map<String, Object> toMap() {
            int attempts = healed + missed + skipped;
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("sessions", sessions);
            map.put("attempts", attempts);
            map.put("healed", healed);
            map.put("missed", missed);
            map.put("skipped", skipped);
            map.put("successRate", healed + missed == 0 ? 0
                    : Math.round((healed * 1000.0) / (healed + missed)) / 10.0);
            map.put("avgScore", scoreCount == 0 ? null
                    : Math.round((scoreSum / scoreCount) * 1000) / 1000.0);
            map.put("avgDurationMs", durationCount == 0 ? null
                    : Math.round((double) durationSum / durationCount));
            map.put("replayOk", replayOk);
            map.put("replayFailed", replayFailed);
            map.put("frames", frames);
            return map;
        }
    }
}
