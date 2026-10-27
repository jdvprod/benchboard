// Loose React typings for offline typechecking (the real @types/react isn't available here).
declare module "react" {
  export type ReactNode = any;
  export type MouseEvent<T = any> = any;
  export type PointerEvent<T = any> = any;
  export type ChangeEvent<T = any> = any;
  export type KeyboardEvent<T = any> = any;
  export type FormEvent<T = any> = any;
  export function useState<S>(init: S | (() => S)): [S, (v: S | ((p: S) => S)) => void];
  export function useState<S = undefined>(): [S | undefined, (v: S | undefined | ((p: S | undefined) => S | undefined)) => void];
  export function useEffect(f: () => void | (() => void), deps?: any[]): void;
  export function useLayoutEffect(f: () => void | (() => void), deps?: any[]): void;
  export function useRef<T>(v: T): { current: T };
  export function useRef<T>(v: T | null): { current: T | null };
  export function useMemo<T>(f: () => T, deps: any[]): T;
  export function useCallback<T>(f: T, deps: any[]): T;
  export function useSyncExternalStore<T>(s: (cb: () => void) => () => void, g: () => T): T;
  export function lazy<T>(f: () => Promise<{ default: T }>): T;
  export const Suspense: (p: { fallback?: any; children?: any }) => any;
  export const StrictMode: any; export const Fragment: any;
  export class Component<P = any, S = any> { constructor(p: P); props: P; state: S; setState(s: Partial<S> | ((s: S) => Partial<S>)): void; render(): any }
  const React: any; export default React;
}
declare module "react/jsx-runtime" { export const jsx: any, jsxs: any, Fragment: any; }
declare module "react-dom/client" { export function createRoot(el: any): { render(n: any): void }; }
declare module "jszip" { const J: any; export default J; }
declare namespace JSX { interface IntrinsicElements { [k: string]: any } interface Element {} interface ElementAttributesProperty { props: {} } interface IntrinsicAttributes { key?: any } }
declare module "*.css";
