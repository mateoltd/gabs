import type { ComponentType } from "react";
import type { ModuleDefinition, createModuleClient } from "./index";

/** The renderer supplies this context. Corporate requests always recheck authority. */
export interface ModuleViewProps<M extends ModuleDefinition> {
  client: ReturnType<typeof createModuleClient<M>>;
  scope: Readonly<{ userId: string; workspaceId: string }>;
  online: boolean;
  hasPermission: (permission: M["permissions"][number]) => boolean;
}

export function defineView<const M extends ModuleDefinition>(
  _module: M,
  component: ComponentType<ModuleViewProps<M>>,
): ComponentType<ModuleViewProps<M>> {
  return component;
}

/** Versioned ABI: these imports share the host instance rather than bundling another React. */
export const viewUIExports = [
  "Button",
  "Input",
  "Textarea",
  "Field",
  "PageHeading",
  "Empty",
  "ErrorMessage",
  "Loading",
  "Table",
  "SchemaForm",
] as const;
export const viewReactExports = [
  "Children",
  "Component",
  "PureComponent",
  "Fragment",
  "StrictMode",
  "Suspense",
  "createElement",
  "cloneElement",
  "createContext",
  "createRef",
  "forwardRef",
  "isValidElement",
  "lazy",
  "memo",
  "startTransition",
  "use",
  "useActionState",
  "useCallback",
  "useContext",
  "useDebugValue",
  "useDeferredValue",
  "useEffect",
  "useId",
  "useImperativeHandle",
  "useInsertionEffect",
  "useLayoutEffect",
  "useMemo",
  "useOptimistic",
  "useReducer",
  "useRef",
  "useState",
  "useSyncExternalStore",
  "useTransition",
] as const;
