/**
 * Stable identity for a DOM element, used in place of Selenium's RemoteWebElement.getId()
 * (which has no Playwright equivalent). The root->element tag:index path uniquely identifies
 * a node while the page is static during healing, so it serves both the candidate dedup
 * (HealingService.java:108) and the "same element" imitation check (SelfHealingEngine.java:125).
 * Self-contained: serialized into locator.evaluate, so it must not close over module scope.
 * Phase-6 shadowHealing: the walk crosses open shadow-root boundaries (getRootNode().host) so
 * elements in different shadow hosts with identical internal structure get distinct identities,
 * consistent with the reference capture. Non-shadow behavior is unchanged.
 */
export function elementFingerprint(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current !== null) {
    let index = 0;
    let sibling = current.previousElementSibling;
    while (sibling !== null) {
      index++;
      sibling = sibling.previousElementSibling;
    }
    parts.unshift(`${current.tagName.toLowerCase()}:${index}`);
    const node: Element = current;
    current = node.parentElement;
    if (current === null) {
      const root = node.getRootNode() as ShadowRoot;
      if (root && 'host' in root && root.host) {
        current = root.host;
      }
    }
  }
  return parts.join('/');
}