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
  "TypedSchemaForm",
  "TypedResourceTable",
  "TypedResourceFilters",
  "TypedResourceRanges",
  "TypedResourceSort",
  "useResourceList",
  "Select",
  "SelectOption",
  "ResourceValue",
  "ReferencePicker",
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

export const viewJSXExports = ["jsx", "jsxs", "Fragment"] as const;
export type ViewHostRequirements = Readonly<Record<string, number>>;
export type ViewHostCapabilities = Readonly<Record<string, readonly number[]>>;
export const viewHostExports = {
  react: viewReactExports,
  jsx: viewJSXExports,
  ui: viewUIExports,
} as const;

/** Revisions describe supported contracts explicitly; a larger number does not imply compatibility. */
export function describeViewHost(
  bindings: {
    react: object;
    jsx: object;
    ui: object;
  },
  options: { queuedCommands?: boolean } = {},
): ViewHostCapabilities {
  const capabilities: Record<string, readonly number[]> = {
    "view.context": [1],
    "client.resources": [1, 2, 3, 4, 5, 6],
    "client.host": [1, 2],
    "client.formats": [1],
  };
  if (options.queuedCommands) capabilities["client.queue"] = [1];
  for (const [namespace, names] of Object.entries(viewHostExports))
    for (const name of names)
      if (
        Object.hasOwn(bindings[namespace as keyof typeof bindings], name) &&
        Reflect.get(bindings[namespace as keyof typeof bindings], name) !==
          undefined
      )
        capabilities[`${namespace}.${name}`] = [1];
  Object.values(capabilities).forEach(Object.freeze);
  return Object.freeze(capabilities);
}

/** Self-contained so the builder can embed the same guard before module initialization. */
export function assertViewHost(
  required: ViewHostRequirements,
  capabilities: ViewHostCapabilities = {},
): void {
  for (const [name, revision] of Object.entries(required))
    if (
      !Object.hasOwn(capabilities, name) ||
      !Array.isArray(capabilities[name]) ||
      !capabilities[name].includes(revision)
    )
      throw Object.assign(
        new Error(
          `This module requires host contract ${name} revision ${revision}. Update the application or select a compatible module release.`,
        ),
        { code: "HOST_VIEW_INCOMPATIBLE" },
      );
}

export function validateViewRequirements(
  value: unknown,
): asserts value is ViewHostRequirements {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length > 128 ||
    Object.entries(value).some(
      ([name, revision]) =>
        !/^(?:ui|react|jsx|view|client)\.[A-Za-z][A-Za-z0-9_]{0,79}$/.test(
          name,
        ) ||
        !Number.isSafeInteger(revision) ||
        (revision as number) < 1 ||
        (revision as number) > 1000,
    )
  )
    throw Error(
      "Invalid host view requirements. Rebuild the module with a supported SDK.",
    );
}
