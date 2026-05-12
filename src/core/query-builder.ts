import type { MemoryKind, MemoryQuery, MemoryScope } from "../types/memory.js";

export class MemoryQueryBuilder {
  private readonly query: MemoryQuery = {
    limit: 10,
    offset: 0,
    includeExpired: false,
  };

  static create(): MemoryQueryBuilder {
    return new MemoryQueryBuilder();
  }

  text(text: string): this {
    this.query.text = text;
    return this;
  }

  key(key: string): this {
    this.query.key = key;
    return this;
  }

  namespace(namespace: string): this {
    this.query.namespace = namespace;
    return this;
  }

  project(project: string): this {
    this.query.project = project;
    return this;
  }

  repo(repo: string): this {
    this.query.repo = repo;
    return this;
  }

  scope(scope: MemoryScope): this {
    this.query.scope = scope;
    return this;
  }

  kind(kind: MemoryKind): this {
    this.query.kind = kind;
    return this;
  }

  tags(tags: string[]): this {
    this.query.tags = [...tags];
    return this;
  }

  limit(limit: number): this {
    this.query.limit = limit;
    return this;
  }

  offset(offset: number): this {
    this.query.offset = offset;
    return this;
  }

  threshold(threshold: number): this {
    this.query.threshold = threshold;
    return this;
  }

  includeExpired(includeExpired: boolean = true): this {
    this.query.includeExpired = includeExpired;
    return this;
  }

  build(): MemoryQuery {
    return { ...this.query };
  }
}
