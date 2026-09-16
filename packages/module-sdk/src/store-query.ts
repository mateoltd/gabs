import type { JsonRecord } from "./index";
import type { StorePage } from "./store";
export type StoreScalar = string | number | boolean | null;
type Keys<T, V> = {
  [K in keyof T & string]-?: NonNullable<T[K]> extends V ? K : never;
}[keyof T & string];
export type StoreScalarField<T> =
  Keys<T, string> | Keys<T, number> | Keys<T, boolean>;
export interface StoreFilter<T> {
  where?: Partial<T>;
  search?: { fields: readonly Keys<T, string>[]; text: string };
  ranges?: {
    [K in Keys<T, string> | Keys<T, number>]?: {
      gt?: NonNullable<T[K]>;
      gte?: NonNullable<T[K]>;
      lt?: NonNullable<T[K]>;
      lte?: NonNullable<T[K]>;
    };
  };
}
export interface StoreQuery<T> extends StoreFilter<T> {
  orderBy?: readonly {
    field: StoreScalarField<T>;
    direction: "asc" | "desc";
  }[];
  cursor?: string;
  limit?: number;
}
export type StoreAggregate<
  T,
  S extends keyof T,
  G extends keyof T | undefined,
> = {
  count: number;
  sums: { [K in S]: number };
  groups: {
    key: G extends keyof T ? T[G] | null : never;
    count: number;
    sums: { [K in S]: number };
  }[];
};
export interface StoreQueries<T> {
  query(options?: StoreQuery<T>): Promise<StorePage<T>>;
  aggregate<
    const S extends readonly Keys<T, number>[] = readonly [],
    G extends StoreScalarField<T> | undefined = undefined,
  >(
    options?: StoreFilter<T> & { sum?: S; groupBy?: G; maxGroups?: number },
  ): Promise<StoreAggregate<T, S[number], G>>;
}
export interface StoreQueryFilter {
  where?: JsonRecord;
  search?: { fields: readonly string[]; text: string };
  ranges?: Record<
    string,
    {
      gt?: string | number;
      gte?: string | number;
      lt?: string | number;
      lte?: string | number;
    }
  >;
}
export type StoreQueryCommand =
  | (StoreQueryFilter & {
      action: "query";
      orderBy?: readonly { field: string; direction: "asc" | "desc" }[];
      cursor?: string;
      limit?: number;
    })
  | (StoreQueryFilter & {
      action: "aggregate";
      sum?: readonly string[];
      groupBy?: string;
      maxGroups?: number;
    });
