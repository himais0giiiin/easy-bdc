// Keep touch phones in the mobile layout when rotated to landscape.
export const MOBILE_MEDIA_QUERY = '(max-width: 767px), (pointer: coarse) and (max-height: 600px)';

const guardedPrototypes = new WeakSet();

export const installMobileInputGuard = (blockly, isMobile) => {
  const prototype = blockly.FieldInput?.prototype || blockly.FieldTextInput?.prototype;
  const originalKeyDown = prototype?.onHtmlInputKeyDown_;
  if (!originalKeyDown || guardedPrototypes.has(prototype)) return;
  // Blockly already supplies HTML inputs, validators, undo, Escape and a proper
  // multiline textarea. Do not replace them with a transparent single-line box.
  prototype.onHtmlInputKeyDown_ = function (event) {
    if (isMobile() && (event.isComposing || event.keyCode === 229)) return;
    return originalKeyDown.call(this, event);
  };
  guardedPrototypes.add(prototype);
};

export const getMobileViewport = (windowRef) => {
  const viewport = windowRef.visualViewport;
  // Pinch zoom should not resize the app itself.
  const useVisualViewport = viewport && (!viewport.scale || viewport.scale === 1);
  return {
    height: Math.round(useVisualViewport ? Math.min(windowRef.innerHeight, viewport.height) : windowRef.innerHeight),
    top: Math.round(useVisualViewport ? viewport.offsetTop || 0 : 0),
  };
};

export const installMobileViewport = (windowRef, root, mobileQuery) => {
  const update = () => {
    if (!mobileQuery.matches) {
      root.style.removeProperty('--edbb-mobile-height');
      root.style.removeProperty('--edbb-mobile-top');
      return;
    }
    const { height, top } = getMobileViewport(windowRef);
    root.style.setProperty('--edbb-mobile-height', height + 'px');
    root.style.setProperty('--edbb-mobile-top', top + 'px');
  };
  const surfaces = [windowRef, windowRef.visualViewport].filter(Boolean);
  surfaces.forEach(surface => surface.addEventListener('resize', update));
  windowRef.visualViewport?.addEventListener('scroll', update);
  mobileQuery.addEventListener('change', update);
  update();
  return () => {
    surfaces.forEach(surface => surface.removeEventListener('resize', update));
    windowRef.visualViewport?.removeEventListener('scroll', update);
    mobileQuery.removeEventListener('change', update);
  };
};

if (typeof window !== 'undefined' && typeof Blockly !== 'undefined') {
  const mobileQuery = window.matchMedia(MOBILE_MEDIA_QUERY);
  installMobileInputGuard(Blockly, () => mobileQuery.matches);
  installMobileViewport(window, document.documentElement, mobileQuery);
}
