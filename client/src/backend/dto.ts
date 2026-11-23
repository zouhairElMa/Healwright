/**
 * Wire DTOs mirroring healenium-web model classes (Jackson field names, no @JsonProperty).
 * Node paths use the WireNode shape produced by NodeSerializer (see ./wire.ts).
 * `screenshot` is a Java byte[] which Jackson serializes as a Base64 string on the wire.
 */
import type { WireNode } from './wire.js';

/** Locator.java:24-25 — value = selector string, type = By strategy name. */
export interface Locator {
  value: string;
  type: string;
}

/** HealingResultDto.java:25-26. */
export interface HealingResultDto {
  locator: Locator;
  score: number;
}

/** SelectorDto.java:13-15. */
export interface SelectorDto {
  id: string;
  locator: string;
  enableHealing: boolean;
}

/**
 * RequestDto.java:27-50. Backend POST /healenium binds SelectorRequestDto which requires
 * @NotBlank locator/className/methodName, command matching ^(findElement|findElements)$,
 * and @NotNull url (SelectorRequestDto.java:25-34).
 */
export interface RequestDto {
  locator: string;
  type: string;
  className: string;
  methodName: string;
  command: string;
  url: string;
  pageContent?: string | null;
  nodePath?: WireNode[][];
  results?: HealingResultDto[] | null;
  usedResult?: HealingResultDto | null;
  /** Base64-encoded screenshot bytes (Jackson byte[] wire form). */
  screenshot?: string | null;
  elementIds?: string[] | null;
  enableHealing?: boolean;
  sessionId?: string | null;
  metrics?: string | null;
}

/** ReferenceElementsDto.java:13-15. */
export interface ReferenceElementsDto {
  pageContent: string;
  paths: WireNode[][];
  unsuccessfulLocators: Locator[];
}

/** ConfigSelectorDto.java:12-16. */
export interface ConfigSelectorDto {
  urlForKey: boolean;
  pathForKey: boolean;
  disableHealingElementDto: SelectorDto[];
  enableHealingElementsDto: SelectorDto[];
  findElementsAutoHealing: boolean;
}