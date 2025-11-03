const state = {
	session: null,
	intervalId: null,
	overlay: null,
	remainingEl: null,
	modal: null,
	modalPurpose: null,
	modalExtendBtn: null,
	modalCloseBtn: null,
	modalBadge: null,
	modalHeading: null,
	modalMessage: null
};

const MODAL_COPY = {
	badge: "TIME'S UP",
	heading: "Your mindful session has ended",
	message: "Take a breath and return to your priorities."
};
bootstrap().catch((error) => {
	console.error("Mindful X timer failed to boot", error);
});

async function bootstrap() {
	const registration = await sendMessageSafe("register-tab");
	let session = registration?.result || null;

	if (!session) {
		const lookup = await sendMessageSafe("get-session");
		session = lookup?.result || null;
	}

	if (session) {
		setSession(session);
	}

	chrome.runtime.onMessage.addListener((message) => {
		if (message?.type === "session-expired") {
			setSession({ ...message.payload, status: "expired" });
		}

		if (message?.type === "session-ended") {
			clearSession();
		}
	});

	chrome.storage.onChanged.addListener((changes, areaName) => {
		if (areaName !== "local" || !changes.activeSession) {
			return;
		}

		const next = changes.activeSession.newValue;
		if (next) {
			setSession(next);
		} else {
			clearSession();
		}
	});
}

function setSession(session) {
	state.session = session;

	if (!session || session.status === "ended") {
		clearSession();
		return;
	}

	ensureOverlay();
	updateOverlay();
	restartInterval();

	if (session.status === "expired" || Date.now() >= session.endTime) {
		showExpiryModal();
	} else {
		hideExpiryModal();
	}
}

function clearSession() {
	state.session = null;
	if (state.intervalId) {
		clearInterval(state.intervalId);
		state.intervalId = null;
	}
	removeOverlay();
	hideExpiryModal(true);
}

function restartInterval() {
	if (state.intervalId) {
		clearInterval(state.intervalId);
	}
	state.intervalId = setInterval(() => {
		updateOverlay();
	}, 1000);
}

function ensureOverlay() {
	if (state.overlay) {
		return;
	}

	const container = document.createElement("section");
	container.className = "mindful-timer";
	container.dataset.state = "ok";

	const indicator = document.createElement("span");
	indicator.className = "mindful-timer__indicator";

	const content = document.createElement("div");
	content.className = "mindful-timer__content";

	const label = document.createElement("span");
	label.className = "mindful-timer__label";
	label.textContent = "Time remaining";

	const remaining = document.createElement("strong");
	remaining.className = "mindful-timer__remaining";
	remaining.textContent = "--:--";

	content.append(label, remaining);
	container.append(indicator, content);
	document.documentElement.appendChild(container);

	state.overlay = container;
	state.remainingEl = remaining;
}

function removeOverlay() {
	if (state.overlay?.parentNode) {
		state.overlay.parentNode.removeChild(state.overlay);
	}
	state.overlay = null;
	state.remainingEl = null;
}

function updateOverlay() {
	if (!state.session || !state.remainingEl) {
		return;
	}

	const timeLeft = Math.max(0, state.session.endTime - Date.now());
	const status = statusForMs(timeLeft);

	if (state.overlay) {
		state.overlay.dataset.state = status;
	}

	state.remainingEl.textContent = formatDuration(timeLeft);

	if (timeLeft <= 0 && state.session.status !== "expired") {
		setSession({ ...state.session, status: "expired" });
		showExpiryModal();
	}
}

function statusForMs(ms) {
	const minutes = ms / 60000;
	if (minutes <= 2) {
		return "critical";
	}
	if (minutes <= 5) {
		return "warning";
	}
	return "ok";
}

function formatDuration(ms) {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function ensureModalElements() {
	if (state.modal) {
		return;
	}
	const backdrop = document.createElement("section");
	backdrop.className = "mindful-modal mindful-hidden";

	const panel = document.createElement("article");
	panel.className = "mindful-modal__panel";
	const badge = document.createElement("span");
	badge.className = "mindful-modal__badge";
	badge.textContent = MODAL_COPY.badge;

	const heading = document.createElement("h2");
	heading.textContent = MODAL_COPY.heading;

	const message = document.createElement("p");
	message.textContent = MODAL_COPY.message;

	const purpose = document.createElement("div");
	purpose.className = "mindful-modal__purpose";

	const actions = document.createElement("div");
	actions.className = "mindful-modal__actions";

	const closeBtn = document.createElement("button");
	closeBtn.className = "primary";
	closeBtn.type = "button";
	closeBtn.textContent = "Close X and refocus";

	const extendBtn = document.createElement("button");
	extendBtn.className = "secondary";
	extendBtn.type = "button";
	extendBtn.textContent = "Request 5 more minutes";

	actions.append(closeBtn, extendBtn);
	panel.append(badge, heading, message, purpose, actions);
	backdrop.append(panel);
	document.documentElement.appendChild(backdrop);

	closeBtn.addEventListener("click", () => {
		handleCloseSession();
	});

	extendBtn.addEventListener("click", () => {
		handleExtendSession();
	});

	state.modal = backdrop;
	state.modalPurpose = purpose;
	state.modalCloseBtn = closeBtn;
	state.modalExtendBtn = extendBtn;
	state.modalBadge = badge;
	state.modalHeading = heading;
	state.modalMessage = message;
}

function showExpiryModal() {
	ensureModalElements();
	if (!state.modal) {
		return;
	}

	if (state.modalBadge) {
		state.modalBadge.textContent = MODAL_COPY.badge;
	}

	if (state.modalHeading) {
		state.modalHeading.textContent = MODAL_COPY.heading;
	}

	if (state.modalMessage) {
		state.modalMessage.textContent = MODAL_COPY.message;
	}

	const plannedPurpose = typeof state.session?.purpose === "string" ? state.session.purpose.trim() : "";
	if (plannedPurpose) {
		state.modalPurpose.textContent = `You planned to: ${plannedPurpose}`;
	} else {
		state.modalPurpose.textContent = "Remember why you came here.";
	}
	state.modal.classList.remove("mindful-hidden");
}

function hideExpiryModal(force = false) {
	if (!state.modal) {
		return;
	}

	if (force || (state.session && state.session.status !== "expired")) {
		state.modal.classList.add("mindful-hidden");
	}
}

async function handleCloseSession() {
	disableModalButtons();
	await sendMessageSafe("close-session");
	clearSession();
}

async function handleExtendSession() {
	disableModalButtons();
	await sendMessageSafe("request-extension");
	clearSession();
}

function disableModalButtons() {
	if (state.modalCloseBtn) {
		state.modalCloseBtn.disabled = true;
	}
	if (state.modalExtendBtn) {
		state.modalExtendBtn.disabled = true;
	}
}

async function sendMessageSafe(type, payload) {
	try {
		const response = await chrome.runtime.sendMessage({ type, payload });
		if (response?.ok === false) {
			throw new Error(response.error || "Unknown error");
		}
		return response;
	} catch (error) {
		console.warn(`Mindful X message ${type} failed`, error);
		return null;
	}
}
