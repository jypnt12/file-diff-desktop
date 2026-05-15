import { dropLeftEl, dropRightEl, halfDropLeftEl, halfDropRightEl, inputLeftFileEl, inputRightFileEl } from "./js/dom.js";
import { wireEvents } from "./js/events.js";
import { initTauriNativeDragDrop, setupDropZone } from "./js/features/dragDrop.js";
import { updatePathLabels } from "./js/features/folderCompare.js";
import { waitForMonaco } from "./js/utils.js";

await waitForMonaco();
wireEvents();
updatePathLabels();
await initTauriNativeDragDrop();
setupDropZone(dropLeftEl, "left", inputLeftFileEl);
setupDropZone(dropRightEl, "right", inputRightFileEl);
if (halfDropLeftEl) setupDropZone(halfDropLeftEl, "left", inputLeftFileEl);
if (halfDropRightEl) setupDropZone(halfDropRightEl, "right", inputRightFileEl);
