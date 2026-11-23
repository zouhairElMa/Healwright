/**
 * Node model — port of com.epam.healenium.treecomparing.Node (tree-comparing 0.4.14).
 * Equality is tag + id only, case-sensitive (Node.java:68-75); classes/text/attributes
 * deliberately excluded because they are the LCS match criterion (phase-1 §6.1).
 */
export class Node {
  children: Node[] = [];
  parent: Node | null = null;

  constructor(
    public tag: string,
    public id: string,
    public classes: Set<string>,
    public index: number,
    public otherAttributes: Map<string, string>,
    public innerText: string,
  ) {}

  equals(other: Node): boolean {
    return this.tag === other.tag && this.id === other.id;
  }
}