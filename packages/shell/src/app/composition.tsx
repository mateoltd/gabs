import {
  createContext,
  useContext,
  type ComponentType,
  type ReactNode,
} from "react";
import type { MutableModuleCatalog } from "@suite/module-sdk/catalog";
import type { ModuleDefinition } from "@suite/module-sdk";
import type { LocalProfileRuntime } from "@suite/client/local-profiles";
import type { FeatureProps } from "@suite/client";

export type ModuleView = ComponentType<
  FeatureProps & { definition: ModuleDefinition }
>;

export interface ShellComposition {
  catalog: MutableModuleCatalog;
  permissions: readonly string[];
  businessPermissions: readonly string[];
  localProfiles: LocalProfileRuntime;
  moduleViews: Readonly<Record<string, ModuleView>>;
}

const ShellCompositionContext = createContext<ShellComposition | undefined>(
  undefined,
);

export function ShellCompositionProvider({
  value,
  children,
}: {
  value: ShellComposition;
  children: ReactNode;
}) {
  return (
    <ShellCompositionContext.Provider value={value}>
      {children}
    </ShellCompositionContext.Provider>
  );
}

export function useShellComposition() {
  const composition = useContext(ShellCompositionContext);
  if (!composition)
    throw Error(
      "The application shell requires an injected product composition.",
    );
  return composition;
}
