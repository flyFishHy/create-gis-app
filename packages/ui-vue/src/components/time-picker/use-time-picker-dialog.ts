import { nextTick, onBeforeUnmount, ref, shallowRef, type CSSProperties } from 'vue';

export function useTimePickerDialog() {
  const trigger = ref<HTMLButtonElement>();
  const popup = ref<HTMLDialogElement>();
  const open = ref(false);
  const position = shallowRef<CSSProperties>();
  const nativeDialog =
    typeof HTMLDialogElement !== 'undefined' &&
    typeof HTMLDialogElement.prototype.showModal === 'function';
  function place() {
    if (!trigger.value) {
      return;
    }
    const anchor = trigger.value.getBoundingClientRect();
    const width = Math.min(410, window.innerWidth - 24);
    const below = window.innerHeight - anchor.bottom - 20;
    const above = anchor.top - 20;
    const center = Math.max(above, below) < 325;
    const upward = !center && below < 380 && above > below;
    position.value = {
      width: width + 'px',
      left: Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12)) + 'px',
      top: upward ? 'auto' : (center ? 12 : anchor.bottom + 8) + 'px',
      bottom: upward ? window.innerHeight - anchor.top + 8 + 'px' : 'auto',
      maxHeight: (center ? window.innerHeight - 24 : upward ? above : below) + 'px',
    };
  }

  function stopPositioning() {
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place, true);
  }

  function show(): boolean {
    const dialog = popup.value;
    if (!dialog || (nativeDialog ? dialog.open : open.value)) {
      return false;
    }
    place();
    if (nativeDialog) {
      dialog.showModal();
    }
    open.value = true;
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    void nextTick(() => {
      if (open.value) {
        popup.value?.querySelector<HTMLElement>('header strong')?.focus();
      }
    });
    return true;
  }

  function close() {
    if (nativeDialog && popup.value?.open) {
      popup.value.close();
    }
    syncClosed();
  }

  function syncClosed() {
    // A queued native close event can arrive after the dialog has already reopened.
    if (!open.value || (nativeDialog && popup.value?.open)) {
      return;
    }
    open.value = false;
    stopPositioning();
    trigger.value?.focus();
  }

  onBeforeUnmount(stopPositioning);
  return { trigger, popup, open, position, nativeDialog, show, close, syncClosed };
}
