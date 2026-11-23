package com.epam.healenium.rewrite;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Phase-24: locate the Playwright locator chain a test wrote, from the call site recorded in the
 * telemetry (file + 1-based line/column). The column reported by V8 points at the method name of
 * the call (e.g. {@code locator} in {@code page.locator('#a')}), which disambiguates several
 * chains on one line. Parsing is textual on purpose: no TypeScript dependency is added to the
 * backend, and an unverifiable chain is reported instead of guessed.
 */
public final class SourceChain {

    private static final Pattern IDENTIFIER = Pattern.compile("[A-Za-z_$][A-Za-z0-9_$]*");
    private static final Pattern TEST_DECL = Pattern.compile(
            "^\\s*(?:test|it)(?:\\.(?:only|skip|fixme|fail|slow))?\\s*\\(");
    private static final int SEARCH_RADIUS = 12;

    private SourceChain() {
    }

    public record Segment(String name, int nameOffset, int startOffset, int endOffset) {
    }

    /**
     * @param startOffset global offset of the root identifier
     * @param endOffset   global offset just after the last ')' of the chain
     * @param rootText    the chain prefix before the expected API suffix (the frame root)
     * @param literals    string literals found in the chain arguments, in order
     * @param nonLiteral  true when an argument is not a literal (variable, regex, function...)
     */
    public record Span(int startLine, int startColumn, int endLine, int endColumn,
                       int startOffset, int endOffset, String rootText, String text,
                       List<String> literals, boolean nonLiteral) {
    }

    private record Candidate(Span span, int lineDistance, boolean columnHit) {
    }

    /**
     * Parse the chain at the recorded call site, searching a small window when the line drifted
     * (a previous rewrite added a comment above the call shifts every later line by one).
     *
     * @param expectedApis the APIs Playwright's telemetry recorded, outermost first. A chain inside
     *                     a frame records only its own suffix ({@code ['locator']}) while the source
     *                     chain also contains {@code frameLocator}, hence the suffix comparison.
     * @param literals     literals of the failed expression, used to verify the argument values.
     */
    public static Span locate(String content, int line, int column,
                              List<String> expectedApis, List<String> literals,
                              int chainSegments) {
        List<Integer> lines = new ArrayList<>();
        lines.add(line);
        for (int delta = 1; delta <= SEARCH_RADIUS; delta++) {
            if (line - delta >= 1) {
                lines.add(line - delta);
            }
            lines.add(line + delta);
        }
        Candidate best = null;
        for (int candidateLine : lines) {
            int lineStart = lineStartOffset(content, candidateLine);
            if (lineStart < 0) {
                continue;
            }
            int lineEnd = lineEndOffset(content, lineStart);
            Matcher matcher = IDENTIFIER.matcher(content);
            matcher.region(lineStart, lineEnd);
            while (matcher.find()) {
                int start = matcher.start();
                if (start > lineStart && content.charAt(start - 1) == '.') {
                    continue; // a member name, not the start of a chain
                }
                Candidate candidate = parseCandidate(content, start, candidateLine, line, column,
                        expectedApis, literals, chainSegments);
                if (candidate == null) {
                    continue;
                }
                if (best == null || better(candidate, best)) {
                    best = candidate;
                }
            }
        }
        return best == null ? null : best.span();
    }

    /**
     * Every occurrence of the measured chain in the file, with the exact literal values. Used to
     * show the tester the source positions that carry the failed locator but were never measured
     * (they healed nowhere), so the gap is visible instead of silent. Comment lines are skipped:
     * a previous rewrite leaves the failed expression readable in {@code // healwright: ...}, and
     * that comment is not an occurrence to rewrite.
     */
    public static List<Span> findAll(String content, List<String> expectedApis, List<String> literals,
                                     int chainSegments) {
        List<Span> out = new ArrayList<>();
        java.util.Set<Integer> seen = new java.util.HashSet<>();
        int line = 1;
        int lineStart = 0;
        while (lineStart <= content.length()) {
            int lineEnd = lineEndOffset(content, lineStart);
            Matcher matcher = IDENTIFIER.matcher(content);
            matcher.region(lineStart, lineEnd);
            while (matcher.find()) {
                int start = matcher.start();
                if (start > lineStart && content.charAt(start - 1) == '.') {
                    continue; // a member name, not the start of a chain
                }
                if (insideComment(content, lineStart, start)) {
                    continue;
                }
                Candidate candidate = parseCandidate(content, start, line, line, -1,
                        expectedApis, literals, chainSegments);
                // Only the measured chain itself: a variable argument or another literal value
                // is a different expression, never an occurrence to propose.
                if (candidate != null && !candidate.span().nonLiteral()
                        && seen.add(candidate.span().startOffset())) {
                    out.add(candidate.span());
                }
            }
            if (lineEnd >= content.length()) {
                break;
            }
            lineStart = lineEnd + 1;
            line++;
        }
        return out;
    }

    /**
     * Lines of the innermost {@code test(...)} / {@code it(...)} block that contains
     * {@code line}, as {@code [firstLine, lastLine]}, or {@code null} outside any test.
     *
     * <p>Scope proposals to one test: the same expression in another test of the file is another
     * locator (different page state, possibly a different healed target), so copying a measured
     * target across test boundaries would be a guess.
     */
    public static int[] testBlockLines(String content, int line) {
        for (int candidate = Math.min(line, lineOf(content, content.length())); candidate >= 1;
             candidate--) {
            int start = lineStartOffset(content, candidate);
            if (start < 0) {
                continue;
            }
            int end = lineEndOffset(content, start);
            java.util.regex.Matcher declaration = TEST_DECL.matcher(content.substring(start, end));
            if (!declaration.find()) {
                continue;
            }
            int bodyStart = callbackBody(content, start + declaration.end() - 1);
            if (bodyStart < 0) {
                continue;
            }
            int close = scanBalanced(content, bodyStart, '{', '}');
            if (close < 0) {
                continue;
            }
            int startLine = lineOf(content, bodyStart);
            int endLine = lineOf(content, close);
            if (line >= startLine && line <= endLine) {
                return new int[]{startLine, endLine};
            }
        }
        return null;
    }

    /**
     * The callback body brace inside the call's parenthesis (the arrow {@code => { }}), or -1 for
     * an expression-bodied test where there is no block to bound.
     */
    private static int callbackBody(String content, int openParen) {
        int closeParen = scanBalanced(content, openParen, '(', ')');
        if (closeParen < 0) {
            return -1;
        }
        int arrow = arrowOffset(content, openParen, closeParen);
        if (arrow < 0) {
            return -1;
        }
        int brace = content.indexOf('{', arrow + 2);
        if (brace < 0 || brace > closeParen) {
            return -1; // expression-bodied test: no block to bound
        }
        return brace;
    }

    /** Offset of the first {@code =>} outside strings between {@code from} and {@code limit}. */
    private static int arrowOffset(String content, int from, int limit) {
        char quote = 0;
        for (int i = from; i + 1 < limit; i++) {
            char c = content.charAt(i);
            if (quote != 0) {
                if (c == '\\') {
                    i++;
                } else if (c == quote) {
                    quote = 0;
                }
                continue;
            }
            if (c == '\'' || c == '"' || c == '`') {
                quote = c;
                continue;
            }
            if (c == '=' && content.charAt(i + 1) == '>') {
                return i;
            }
        }
        return -1;
    }

    /**
     * Offset of the closing character matching {@code open} at {@code from}, honoring strings
     * (with escapes), template literals, line comments and block comments. -1 when unbalanced.
     */
    private static int scanBalanced(String content, int from, char open, char close) {
        int depth = 0;
        char quote = 0;
        boolean lineComment = false;
        boolean blockComment = false;
        for (int i = from; i < content.length(); i++) {
            char c = content.charAt(i);
            char next = i + 1 < content.length() ? content.charAt(i + 1) : '\0';
            if (lineComment) {
                if (c == '\n') {
                    lineComment = false;
                }
                continue;
            }
            if (blockComment) {
                if (c == '*' && next == '/') {
                    blockComment = false;
                    i++;
                }
                continue;
            }
            if (quote != 0) {
                if (c == '\\') {
                    i++;
                } else if (c == quote) {
                    quote = 0;
                }
                continue;
            }
            if (c == '/' && next == '/') {
                lineComment = true;
                i++;
                continue;
            }
            if (c == '/' && next == '*') {
                blockComment = true;
                i++;
                continue;
            }
            if (c == '\'' || c == '"' || c == '`') {
                quote = c;
                continue;
            }
            if (c == open) {
                depth++;
            } else if (c == close) {
                depth--;
                if (depth == 0) {
                    return i;
                }
            }
        }
        return -1;
    }

    /** Number of chained calls in a Playwright expression (locator chain only, not the action). */
    public static int countSegments(String expression) {
        Parser parser = new Parser(expression, 0);
        String first = parser.readIdentifier();
        if (first == null) {
            return 0;
        }
        skipRootMembers(parser);
        int count = 0;
        while (true) {
            int dot = parser.position();
            parser.skipWhitespace();
            if (!parser.consume('.')) {
                parser.restore(dot);
                break;
            }
            if (parser.readIdentifier() == null) {
                parser.restore(dot);
                break;
            }
            parser.skipWhitespace();
            if (!parser.consume('(')) {
                parser.restore(dot);
                break;
            }
            parser.readBalancedArguments();
            count++;
        }
        return count;
    }

    /** Consume `this.page` / `fixtures.po` style root members, stopping before the first call. */
    private static void skipRootMembers(Parser parser) {
        while (true) {
            int dot = parser.position();
            if (!parser.consume('.')) {
                return;
            }
            int nameStart = parser.position();
            String name = parser.readIdentifier();
            if (name == null) {
                parser.restore(nameStart);
                return;
            }
            if (parser.peek() == '(') {
                parser.restore(dot);
                return;
            }
        }
    }

    private static boolean better(Candidate left, Candidate right) {
        if (left.columnHit() != right.columnHit()) {
            return left.columnHit();
        }
        return left.lineDistance() < right.lineDistance();
    }

    /**
     * @param chainSegments length of the locator chain the telemetry recorded. The source text
     *                      continues with the action call ({@code .fill('a')}), so the parsed
     *                      segments are truncated to the locator chain before any check. When the
     *                      value is 0 (unknown expression) nothing is truncated.
     */
    private static Candidate parseCandidate(String content, int start, int candidateLine,
                                            int expectedLine, int expectedColumn,
                                            List<String> expectedApis, List<String> literals,
                                            int chainSegments) {
        Parser parser = new Parser(content, start);
        String first = parser.readIdentifier();
        if (first == null || isKeyword(first)) {
            return null;
        }
        while (true) {
            int dot = parser.position();
            if (!parser.consume('.')) {
                break;
            }
            int nameStart = parser.position();
            String name = parser.readIdentifier();
            if (name == null) {
                parser.restore(dot);
                break;
            }
            if (parser.peek() != '(') {
                // Member access: still part of the root (this.page, fixtures.po).
                parser.skipWhitespace();
                if (parser.peek() == '=' || parser.peek() == ';' || parser.peek() == ',') {
                    parser.restore(dot);
                    break;
                }
                continue;
            }
            parser.restore(dot);
            break;
        }
        List<Segment> segments = new ArrayList<>();
        List<String> segmentArgs = new ArrayList<>();
        while (true) {
            int dot = parser.position();
            parser.skipWhitespace();
            if (!parser.consume('.')) {
                parser.restore(dot);
                break;
            }
            int nameStart = parser.position();
            String name = parser.readIdentifier();
            if (name == null) {
                parser.restore(dot);
                break;
            }
            parser.skipWhitespace();
            if (!parser.consume('(')) {
                parser.restore(dot);
                break;
            }
            String args = parser.readBalancedArguments();
            int end = parser.position();
            segments.add(new Segment(name, nameStart, dot, end));
            segmentArgs.add(args);
        }
        if (segments.isEmpty()) {
            return null;
        }
        if (chainSegments > 0 && segments.size() > chainSegments) {
            // Drop the action call(s): only the locator chain is validated and rewritten.
            segments = new ArrayList<>(segments.subList(0, chainSegments));
            segmentArgs = new ArrayList<>(segmentArgs.subList(0, chainSegments));
        }
        List<String> chainLiterals = new ArrayList<>();
        for (String args : segmentArgs) {
            chainLiterals.addAll(allStringLiterals(args));
        }
        boolean nonLiteral = false;
        int suffixStart = Math.max(0, segments.size() - expectedApis.size());
        if (segments.size() < expectedApis.size()) {
            return null;
        }
        for (int i = 0; i < expectedApis.size(); i++) {
            if (!expectedApis.get(i).equals(segments.get(suffixStart + i).name())) {
                return null;
            }
        }
        if (literals != null && !literals.isEmpty() && !literals.equals(chainLiterals)) {
            if (!chainLiterals.isEmpty()) {
                // Different literal values: this is another chain (for instance the line a
                // previous rewrite already healed), not the one the telemetry measured.
                return null;
            }
            nonLiteral = true; // values differ or use variables: never auto-select
        }
        int startOffset = start;
        int suffixOffset = segments.get(suffixStart).startOffset();
        String rootText = content.substring(startOffset, suffixOffset).trim();
        int endOffset = segments.get(segments.size() - 1).endOffset();
        // The column is matched across the search window: a previous rewrite inserts a comment
        // and moves the line the telemetry measured, so requiring the exact line would drop the
        // only reliable discriminator between identical chains.
        boolean columnHit = columnHit(content, segments, expectedColumn);
        int lineDistance = Math.abs(candidateLine - expectedLine);
        Span span = new Span(
                lineOf(content, startOffset), columnOf(content, startOffset),
                lineOf(content, endOffset), columnOf(content, endOffset),
                startOffset, endOffset, rootText, content.substring(startOffset, endOffset),
                chainLiterals, nonLiteral);
        return new Candidate(span, lineDistance, columnHit);
    }

    /** V8 reports a 1-based column inside the line, so segment offsets are re-based first. */
    private static boolean columnHit(String content, List<Segment> segments, int column) {
        for (Segment segment : segments) {
            if (Math.abs(columnOf(content, segment.nameOffset()) - column) <= 1) {
                return true;
            }
        }
        return false;
    }

    /** True when the offset sits in a line comment or a block-comment continuation. */
    private static boolean insideComment(String content, int lineStart, int offset) {
        String prefix = content.substring(lineStart, offset);
        if (prefix.contains("//")) {
            return true;
        }
        int block = content.lastIndexOf("/*", offset);
        if (block >= 0) {
            int close = content.indexOf("*/", block);
            if (close < 0 || close > offset) {
                return true;
            }
        }
        return prefix.trim().startsWith("*");
    }

    private static boolean isKeyword(String value) {
        return switch (value) {
            case "await", "const", "let", "var", "return", "if", "else", "new", "function",
                 "async", "export", "import", "typeof", "void", "yield", "case", "throw" -> true;
            default -> false;
        };
    }

    /** Every quoted string value in the text, in order. Used to verify argument values. */
    public static List<String> allStringLiterals(String text) {
        List<String> out = new ArrayList<>();
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c != '\'' && c != '"' && c != '`') {
                continue;
            }
            int end = closingQuote(text, c, i);
            if (end < 0) {
                break;
            }
            String body = text.substring(i + 1, end);
            if (c != '`' || !body.contains("${")) {
                out.add(unescape(body));
            }
            i = end;
        }
        return out;
    }

    private static int closingQuote(String text, char quote, int from) {
        for (int i = from + 1; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '\\') {
                i++;
                continue;
            }
            if (c == quote) {
                return i;
            }
        }
        return -1;
    }

    private static String unescape(String body) {
        StringBuilder out = new StringBuilder(body.length());
        for (int i = 0; i < body.length(); i++) {
            char c = body.charAt(i);
            if (c == '\\' && i + 1 < body.length()) {
                char next = body.charAt(i + 1);
                switch (next) {
                    case 'n' -> out.append('\n');
                    case 't' -> out.append('\t');
                    case 'r' -> out.append('\r');
                    default -> out.append(next);
                }
                i++;
            } else {
                out.append(c);
            }
        }
        return out.toString();
    }

    public static int lineStartOffset(String content, int line) {
        int current = 1;
        int index = 0;
        while (current < line) {
            int next = content.indexOf('\n', index);
            if (next < 0) {
                return -1;
            }
            index = next + 1;
            current++;
        }
        return index <= content.length() ? index : -1;
    }

    private static int lineEndOffset(String content, int lineStart) {
        int next = content.indexOf('\n', lineStart);
        return next < 0 ? content.length() : next;
    }

    public static int lineOf(String content, int offset) {
        int line = 1;
        for (int i = 0; i < offset && i < content.length(); i++) {
            if (content.charAt(i) == '\n') {
                line++;
            }
        }
        return line;
    }

    private static int columnOf(String content, int offset) {
        int last = content.lastIndexOf('\n', Math.max(0, offset - 1));
        return offset - last;
    }

    /** Small cursor over the file content; handles newlines inside a multi-line chain. */
    private static final class Parser {
        private final String content;
        private final int limit;
        private int position;

        Parser(String content, int position) {
            this.content = content;
            this.position = position;
            this.limit = content.length();
        }

        int position() {
            return position;
        }

        void restore(int value) {
            position = value;
        }

        char peek() {
            return position < limit ? content.charAt(position) : '\0';
        }

        boolean consume(char expected) {
            if (peek() == expected) {
                position++;
                return true;
            }
            return false;
        }

        void skipWhitespace() {
            while (position < limit && Character.isWhitespace(content.charAt(position))) {
                position++;
            }
        }

        String readIdentifier() {
            skipWhitespace();
            Matcher matcher = IDENTIFIER.matcher(content);
            matcher.region(position, limit);
            if (!matcher.lookingAt()) {
                return null;
            }
            position = matcher.end();
            return matcher.group();
        }

        /** Read up to (not including) the matching ')', starting just after the '('. */
        String readBalancedArguments() {
            int start = position;
            int depth = 1;
            char quote = 0;
            while (position < limit) {
                char c = content.charAt(position);
                if (quote != 0) {
                    if (c == '\\') {
                        position++;
                    } else if (c == quote) {
                        quote = 0;
                    }
                } else if (c == '\'' || c == '"' || c == '`') {
                    quote = c;
                } else if (c == '(') {
                    depth++;
                } else if (c == ')') {
                    depth--;
                    if (depth == 0) {
                        String args = content.substring(start, position);
                        position++;
                        return args;
                    }
                }
                position++;
            }
            return content.substring(start);
        }
    }
}
