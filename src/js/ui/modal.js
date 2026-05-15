/**
 * In-app modals (avoid window.confirm / window.alert — Tauri IPC can reject them).
 */

/** @param {{ title: string, message: string }} opts */
export function alertModal({ title, message }) {
    return new Promise((resolve) => {
        const backdrop = document.getElementById("app-modal");
        const titleEl = document.getElementById("app-modal-title");
        const bodyEl = document.getElementById("app-modal-body");
        const btnPrimary = document.getElementById("app-modal-primary");
        const btnSecondary = document.getElementById("app-modal-secondary");
        const btnCancel = document.getElementById("app-modal-cancel");
        if (!backdrop || !titleEl || !bodyEl || !btnPrimary || !btnSecondary || !btnCancel) {
            resolve();
            return;
        }

        titleEl.textContent = title;
        bodyEl.textContent = message;
        btnPrimary.textContent = "OK";
        btnPrimary.classList.remove("hidden");
        btnSecondary.classList.add("hidden");
        btnCancel.classList.add("hidden");

        /** @type {(ev: KeyboardEvent) => void} */
        let onKey;

        const clean = () => {
            backdrop.classList.add("hidden");
            btnPrimary.onclick = null;
            btnSecondary.onclick = null;
            btnCancel.onclick = null;
            backdrop.onclick = null;
            if (onKey) window.removeEventListener("keydown", onKey);
        };

        const finish = () => {
            clean();
            resolve();
        };

        btnPrimary.onclick = finish;
        backdrop.onclick = (ev) => {
            if (ev.target === backdrop) finish();
        };
        onKey = (ev) => {
            if (ev.key === "Escape") finish();
        };
        window.addEventListener("keydown", onKey);

        backdrop.classList.remove("hidden");
    });
}

/**
 * @param {{ title: string, message: string, primaryLabel?: string, secondaryLabel?: string }} opts
 * @returns {Promise<boolean>} true if primary clicked, false if secondary / backdrop / Escape
 */
export function confirmModal({
    title,
    message,
    primaryLabel = "OK",
    secondaryLabel = "Cancel",
}) {
    return new Promise((resolve) => {
        const backdrop = document.getElementById("app-modal");
        const titleEl = document.getElementById("app-modal-title");
        const bodyEl = document.getElementById("app-modal-body");
        const btnPrimary = document.getElementById("app-modal-primary");
        const btnSecondary = document.getElementById("app-modal-secondary");
        const btnCancel = document.getElementById("app-modal-cancel");
        if (!backdrop || !titleEl || !bodyEl || !btnPrimary || !btnSecondary || !btnCancel) {
            resolve(false);
            return;
        }

        titleEl.textContent = title;
        bodyEl.textContent = message;
        btnPrimary.textContent = primaryLabel;
        btnSecondary.textContent = secondaryLabel;
        btnPrimary.classList.remove("hidden");
        btnSecondary.classList.remove("hidden");
        btnCancel.classList.add("hidden");

        /** @type {(ev: KeyboardEvent) => void} */
        let onKey;

        const clean = () => {
            backdrop.classList.add("hidden");
            btnPrimary.onclick = null;
            btnSecondary.onclick = null;
            btnCancel.onclick = null;
            backdrop.onclick = null;
            if (onKey) window.removeEventListener("keydown", onKey);
        };

        const pick = /** @param {boolean} v */ (v) => {
            clean();
            resolve(v);
        };

        btnPrimary.onclick = () => pick(true);
        btnSecondary.onclick = () => pick(false);
        backdrop.onclick = (ev) => {
            if (ev.target === backdrop) pick(false);
        };
        onKey = (ev) => {
            if (ev.key === "Escape") pick(false);
        };
        window.addEventListener("keydown", onKey);

        backdrop.classList.remove("hidden");
    });
}
