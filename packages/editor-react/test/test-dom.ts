import { JSDOM } from 'jsdom';

if (typeof globalThis.document === 'undefined') {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost/'
  });

  const globals: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Window: dom.window.Window,
    NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLIFrameElement: dom.window.HTMLIFrameElement,
    localStorage: dom.window.localStorage,
    Node: dom.window.Node,
    Text: dom.window.Text,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    HTMLImageElement: dom.window.HTMLImageElement,
    HTMLAnchorElement: dom.window.HTMLAnchorElement,
    SVGElement: dom.window.SVGElement,
    DOMParser: dom.window.DOMParser,
    XMLSerializer: dom.window.XMLSerializer,
    MutationObserver: dom.window.MutationObserver,
    Range: dom.window.Range,
    File: dom.window.File,
    Blob: dom.window.Blob,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
    CustomEvent: dom.window.CustomEvent,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window)
  };

  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value
    });
  }
}
