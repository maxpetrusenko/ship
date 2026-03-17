export type TipTapAttributes = Record<string, unknown>;

export interface TipTapMark {
  type: string;
  attrs?: TipTapAttributes;
}

export interface TipTapNode {
  type: string;
  text?: string;
  marks?: TipTapMark[];
  attrs?: TipTapAttributes;
  content?: TipTapNode[];
}

export interface TipTapDoc {
  type: 'doc';
  content: TipTapNode[];
}

export function isTipTapDoc(value: unknown): value is TipTapDoc {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const doc = value as Partial<TipTapDoc>;
  return doc.type === 'doc' && Array.isArray(doc.content);
}

export function createTipTapDoc(content: TipTapNode[] = []): TipTapDoc {
  return {
    type: 'doc',
    content,
  };
}
