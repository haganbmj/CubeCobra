import React, { ComponentType, ReactElement } from 'react';

import { createRoot } from 'react-dom/client';

// Global stylesheets. Imported here (RenderToRoot is on every page's entry graph) so Vite
// bundles, hashes, and lists them in its manifest — the server reads that to emit the <link>
// tags. Order matters for the cascade: the Tailwind stylesheet is imported last so its
// utilities win over the legacy plain-CSS files.
import '../css/autocomplete.css';
import '../css/editcube.css';
import '../css/tags.css';
import '../css/stylesheet.css';

import AdsContext from '../contexts/AdsContext';
import { AutocardContextProvider } from '../contexts/AutocardContext';
import BaseUrlContext, { BaseUrlContextValue } from '../contexts/BaseUrlContext';
import CaptchaContext from '../contexts/CaptchaContext';
import { CSRFContextProvider } from '../contexts/CSRFContext';
import UserContext, { UserContextValue } from '../contexts/UserContext';
import { initErrorReporting } from '../utils/errorReporting';
import { reapLocalStorage } from '../utils/localStorage/reap';
import ErrorBoundary from './ErrorBoundary';

declare global {
  interface Window {
    reactProps: any;
  }
}

export interface UniversalReactProps {
  nitroPayEnabled: boolean;
  baseUrl: BaseUrlContextValue;
  cdnBaseUrl: string;
  user: UserContextValue;
  theme: string;
  captchaSiteKey: string;
  csrfToken: string;
}

/**
 * Migrates legacy draft keys and evicts expired ones, once per page load.
 *
 * This is the only hook that runs on every page: `RenderToRoot` is on every page's entry
 * graph, so wiring it here costs nothing, where wiring it per page would mean touching ~40
 * entry points and silently missing any added later.
 *
 * `reapLocalStorage` already swallows its own failures, so the guard here is a second line:
 * tidying storage must never be able to stop a page from rendering, whatever the reaper
 * grows into. Hoisted out of `RenderToRoot` because oxlint's `react(purity)` rule reads that
 * function as a render body and rejects a `Date.now()` read inside one.
 */
const reapStorage = (): void => {
  try {
    reapLocalStorage(Date.now());
  } catch (err) {
    console.error('Failed to reap localStorage', err);
  }
};

// Returns its input to enable our usual pattern of export default RenderToRoot(XPage).
const RenderToRoot = <P,>(Element: ComponentType<P>): ComponentType<P> => {
  const reactProps: P & UniversalReactProps = typeof window !== 'undefined' ? window.reactProps : {};
  const element: ReactElement = (
    <ErrorBoundary className="mt-3">
      <CSRFContextProvider csrfToken={reactProps.csrfToken}>
        <CaptchaContext.Provider value={reactProps.captchaSiteKey}>
          <AutocardContextProvider>
            <AdsContext.Provider value={reactProps.nitroPayEnabled}>
              <BaseUrlContext.Provider value={reactProps.baseUrl}>
                <UserContext.Provider value={reactProps.user || null}>
                  <Element {...reactProps} />
                </UserContext.Provider>
              </BaseUrlContext.Provider>
            </AdsContext.Provider>
          </AutocardContextProvider>
        </CaptchaContext.Provider>
      </CSRFContextProvider>
    </ErrorBoundary>
  );

  if (typeof document !== 'undefined') {
    // Install global error handlers (window.onerror / unhandledrejection) before we
    // render so we capture failures during the initial mount too.
    initErrorReporting();

    // Tidy storage before the page mounts, so an expired record is never read back.
    reapStorage();

    const wrapper = document.getElementById('react-root');
    if (wrapper) {
      const root = createRoot(wrapper); // createRoot(wrapper!) if you use TypeScript
      root.render(element);
    }
  }

  return Element;
};

export default RenderToRoot;
