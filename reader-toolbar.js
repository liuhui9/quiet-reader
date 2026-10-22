'use strict';
function createReaderToolbar({ root, toolbar, library, toc, libraryButton, tocButton, closeButton, scroll }) {
  let pointerTop = false, keyboardFocus = false;
  function sync() {
    root.classList.toggle('toolbar-visible', pointerTop || keyboardFocus || !library.hidden || !toc.hidden);
    libraryButton.setAttribute('aria-expanded', String(!library.hidden));
    tocButton.setAttribute('aria-expanded', String(!toc.hidden));
  }
  function close() { library.hidden = true; toc.hidden = true; sync(); }
  libraryButton.onclick = () => { library.hidden = !library.hidden; toc.hidden = true; sync(); };
  tocButton.onclick = () => { toc.hidden = !toc.hidden; library.hidden = true; sync(); };
  closeButton.onclick = close;
  root.addEventListener('pointermove', event => {
    const bounds = root.getBoundingClientRect();
    pointerTop = event.clientY - bounds.top >= 0 && event.clientY - bounds.top < 44;
    sync();
  });
  scroll.addEventListener('pointerdown', close);
  toolbar.addEventListener('focusin', event => { keyboardFocus = event.target.matches(':focus-visible'); sync(); });
  toolbar.addEventListener('focusout', event => { if (!toolbar.contains(event.relatedTarget)) { keyboardFocus = false; sync(); } });
  root.addEventListener('keydown', event => { if (event.key === 'Escape' && (!library.hidden || !toc.hidden)) { event.preventDefault(); close(); scroll.focus({ preventScroll: true }); } });
  sync();
  return {
    close,
    pointer(value) { pointerTop = value.top; if (!value.inside) { keyboardFocus = false; close(); } else sync(); },
    reset() { pointerTop = false; keyboardFocus = false; close(); }
  };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { createReaderToolbar };
else window.createReaderToolbar = createReaderToolbar;
