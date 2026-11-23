/** Java String.trim() removes code units <= U+0020 only (not the wider JS whitespace set). */
export function javaTrim(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && s.charCodeAt(start) <= 0x20) start++;
  while (end > start && s.charCodeAt(end - 1) <= 0x20) end--;
  return s.slice(start, end);
}

/** Apache commons-lang3 StringUtils.isBlank: null, empty, or whitespace-only (Java trim set). */
export function isBlank(s: string | null | undefined): boolean {
  return s == null || javaTrim(s).length === 0;
}