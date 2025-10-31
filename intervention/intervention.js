const app = document.getElementById("app");

const MUSIC_TRACKS = [
	{
		id: "mixkit-chillax-655",
		title: "Chillax",
		path: "content/mixkit-chillax-655.mp3"
	},
	{
		id: "mixkit-classical-3-710",
		title: "Gentle Classical Theme",
		path: "content/mixkit-classical-3-710.mp3"
	},
	{
		id: "mixkit-classical-7-714",
		title: "Soft Piano Arrival",
		path: "content/mixkit-classical-7-714.mp3"
	}
];

const YOUTUBE_PLAYLIST_URL = "https://youtu.be/Os47nMrjw_Y?si=goF4DzjfhRt7NMuW";
const MINDFUL_WALK_URL = "https://bangor.cloud.panopto.eu/Panopto/Pages/Embed.aspx?id=d170ff49-be8e-4aee-9196-afb700efe7c8&autoplay=false&offerviewer=true&showtitle=true&showbrand=true&captions=false&interactivity=all";
const WALK_TIPS_URL = "https://meredithewenson.com/";
const STRETCH_STEPS = [
	{
		id: "neck",
		title: "Neck circles",
		description: "Roll your shoulders down and trace slow halos with your chin.",
		duration: 40,
		icon: "🌀"
	},
	{
		id: "spine",
		title: "Standing side stretch",
		description: "Reach both arms up, sway gently left and right to lengthen your sides.",
		duration: 40,
		icon: "🌿"
	},
	{
		id: "wrists",
		title: "Wrist release",
		description: "Interlace your fingers, press palms out, and circle your wrists slowly.",
		duration: 40,
		icon: "💫"
	}
];
const HYDRATE_DURATION = 120;
const HYDRATE_BENEFITS = [
	"Every sip cushions your joints and keeps them moving freely.",
	"Hydration boosts focus—your brain is over 70% water.",
	"Water supports a steady heartbeat and gentle energy.",
	"Take this pause to stretch your spine while you refill."
];

const state = {
	pending: null,
	activities: [],
	purpose: "",
	minutes: "",
	loading: false,
	error: null,
	musicPanel: {
		open: false,
		selectedId: MUSIC_TRACKS[0]?.id || null,
		isPlaying: false
	},
	walkPanel: {
		open: false,
		copyStatus: "idle"
	},
	breathPanel: {
		open: false
	},
	stretchPanel: {
		open: false,
		activeStep: 0,
		remainingSeconds: 0,
		completed: false,
		timerId: null
	},
	hydratePanel: {
		open: false,
		remainingSeconds: HYDRATE_DURATION,
		benefitIndex: 0,
		timerId: null
	},
	callPanel: {
		open: false
	}
};

init().catch((error) => {
	console.error("Failed to initialise intervention", error);
	renderError("We couldn't prepare the intervention screen. Please close this tab and try again.");
});

async function init() {
	const data = await sendMessage("intervention-ready");
	state.pending = data?.result?.pendingNavigation || null;
	state.activities = data?.result?.alternativeActivities || [];

	if (state.pending?.previousPurpose) {
		state.purpose = state.pending.previousPurpose;
	}

	render();
}

function render() {
	if (!state.pending) {
		renderEmptyState();
		return;
	}

	const targetHost = safeHostname(state.pending.targetUrl);
	const selectedTrack = getTrackById(state.musicPanel.selectedId) || MUSIC_TRACKS[0];
	const selectedTrackSrc = selectedTrack ? chrome.runtime.getURL(selectedTrack.path) : "";
	const activitiesHtml = state.activities
		.map(
			(activity, index) => `
				<button class="activity-card" data-activity="${index}" aria-label="${activity.label}">
					<strong>${activity.label}</strong>
				</button>
			`
		)
		.join("");

	app.innerHTML = `
		<main class="shell" aria-live="polite">
			<div class="header">
				<span class="target-pill">${targetHost}</span>
				<h1>WHAT ARE YOU HERE FOR?</h1>
				<p>Take a mindful pause before heading into ${targetHost}. Choose an alternative or set a clear, time-bound intention.</p>
				${state.pending.previousPurpose ? `<p class="previous-purpose">Previously: "${escapeHtml(state.pending.previousPurpose)}"</p>` : ""}
			</div>

			${state.musicPanel.open ? renderMusicPanel(selectedTrack, selectedTrackSrc) : ""}
			${state.walkPanel.open ? renderWalkPanel() : ""}
			${state.breathPanel.open ? renderBreathingPanel() : ""}
			${state.stretchPanel.open ? renderStretchPanel() : ""}
			${state.hydratePanel.open ? renderHydratePanel() : ""}
			${state.callPanel.open ? renderCallPanel() : ""}

			<section class="activities" aria-label="Alternative activities">
				${activitiesHtml}
			</section>

			<form class="form" novalidate>
				${state.error ? `<div class="error-banner">${state.error}</div>` : ""}
				<div class="field">
					<label for="purpose">I need access because:</label>
					<textarea id="purpose" name="purpose" placeholder="e.g., I will schedule and post campaign updates" required>${escapeHtml(state.purpose)}</textarea>
					<small>Be specific. What outcome do you expect from this visit?</small>
				</div>

				<div class="field">
					<label for="minutes">Total engagement time required (minutes):</label>
					<input id="minutes" name="minutes" type="number" min="1" max="120" inputmode="numeric" placeholder="e.g., 15" value="${state.minutes}" required />
					<small>Choose between 1 and 120 minutes. We'll hold you accountable.</small>
					<small class="error" hidden data-error-time></small>
				</div>

				<div class="actions">
					<button type="submit" class="primary" ${state.loading ? "disabled" : ""}>${state.loading ? "Starting mindful session…" : "Start Mindful Session"}</button>
					<button type="button" class="secondary" data-action="close">I'd rather step away</button>
				</div>
			</form>
		</main>
	`;

	syncStretchTimer();
	syncHydrateTimer();
	bindEvents();
	updateSubmitState();
}

function bindEvents() {
	const form = app.querySelector("form");
	const purposeInput = app.querySelector("#purpose");
	const minutesInput = app.querySelector("#minutes");
	const closeButton = app.querySelector('[data-action="close"]');
	const timeError = app.querySelector('[data-error-time]');
	const musicPlayToggle = app.querySelector("[data-action='music-toggle']");
	const musicClose = app.querySelector("[data-action='music-close']");
	const musicSelect = app.querySelector("[data-music-select]");
	const musicAudio = app.querySelector("#music-audio");
	const musicTitle = app.querySelector("[data-music-title]");
	const musicPlayIcon = app.querySelector("[data-music-icon]");
	const musicStatus = app.querySelector("[data-music-status]");
	const walkCopy = app.querySelector("[data-action='walk-copy']");
	const walkOpen = app.querySelector("[data-action='walk-open']");
	const walkMeredith = app.querySelector("[data-action='walk-meredith']");
	const walkDone = app.querySelector("[data-action='walk-done']");
	const walkClose = app.querySelector("[data-action='walk-close']");
	const walkStatus = app.querySelector("[data-walk-status]");
	const breathClose = app.querySelector("[data-action='breath-close']");
	const breathDone = app.querySelector("[data-action='breath-done']");
	const stretchClose = app.querySelector("[data-action='stretch-close']");
	const stretchRestart = app.querySelector("[data-action='stretch-restart']");
	const stretchDone = app.querySelector("[data-action='stretch-done']");
	const hydrateClose = app.querySelector("[data-action='hydrate-close']");
	const hydrateRestart = app.querySelector("[data-action='hydrate-restart']");
	const hydrateDone = app.querySelector("[data-action='hydrate-done']");
	const callClose = app.querySelector("[data-action='call-close']");
	const callDone = app.querySelector("[data-action='call-done']");
	const callPrompt = app.querySelector("[data-action='call-prompt']");

	purposeInput.addEventListener("input", () => {
		state.purpose = purposeInput.value.trim();
		updateSubmitState();
	});

	minutesInput.addEventListener("input", () => {
		state.minutes = minutesInput.value.trim();
		const minutesValue = Number(state.minutes);
		const invalid = Number.isNaN(minutesValue) || minutesValue < 1 || minutesValue > 120;
		timeError.hidden = !invalid;
		timeError.textContent = invalid ? "Enter a number between 1 and 120." : "";
		updateSubmitState();
	});

	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		await handleSubmit();
	});

	closeButton.addEventListener("click", async () => {
		await handleClose();
	});

	app.querySelectorAll("[data-activity]").forEach((button) => {
		button.addEventListener("click", async (event) => {
			const index = Number(event.currentTarget.dataset.activity);
			if (Number.isInteger(index)) {
				await launchActivity(index);
			}
		});
	});

	if (musicSelect && musicAudio && musicTitle && musicPlayToggle && musicPlayIcon && musicStatus) {
		musicSelect.addEventListener("change", (event) => {
			const track = getTrackById(event.target.value);
			if (!track) {
				return;
			}
			state.musicPanel.selectedId = track.id;
			const src = chrome.runtime.getURL(track.path);
			musicAudio.src = src;
			musicAudio.currentTime = 0;
			musicAudio.load();
			musicTitle.textContent = track.title;
			musicStatus.textContent = "Stopped";
			state.musicPanel.isPlaying = false;
			setMusicButtonState({ playing: false, toggleButton: musicPlayToggle, icon: musicPlayIcon });
		});

		musicPlayToggle.addEventListener("click", async () => {
			if (!state.musicPanel.isPlaying) {
				try {
					await musicAudio.play();
					state.musicPanel.isPlaying = true;
					musicStatus.textContent = "Playing";
					setMusicButtonState({ playing: true, toggleButton: musicPlayToggle, icon: musicPlayIcon });
				} catch (error) {
					console.warn("Unable to play music track", error);
				}
			} else {
				musicAudio.pause();
				state.musicPanel.isPlaying = false;
				musicStatus.textContent = "Paused";
				setMusicButtonState({ playing: false, toggleButton: musicPlayToggle, icon: musicPlayIcon });
			}
		});

		musicAudio.addEventListener("pause", () => {
			if (!musicAudio.ended) {
				state.musicPanel.isPlaying = false;
				musicStatus.textContent = "Paused";
				setMusicButtonState({ playing: false, toggleButton: musicPlayToggle, icon: musicPlayIcon });
			}
		});

		musicAudio.addEventListener("ended", () => {
			state.musicPanel.isPlaying = true;
			musicStatus.textContent = "Looping";
			setMusicButtonState({ playing: true, toggleButton: musicPlayToggle, icon: musicPlayIcon });
		});

		musicClose?.addEventListener("click", () => {
			musicAudio.pause();
			state.musicPanel.isPlaying = false;
			state.musicPanel.open = false;
			render();
		});

		musicAudio.loop = true;
		musicAudio.preload = "auto";
		musicStatus.textContent = state.musicPanel.isPlaying ? "Playing" : "Ready";
	}

	if (walkCopy && walkStatus) {
		walkCopy.addEventListener("click", async () => {
			try {
				await navigator.clipboard.writeText(MINDFUL_WALK_URL);
				state.walkPanel.copyStatus = "success";
				walkStatus.textContent = "Link copied—text it to yourself and enjoy the walk.";
			} catch (error) {
				console.warn("Unable to copy walk link", error);
				state.walkPanel.copyStatus = "error";
				walkStatus.textContent = "Copy failed. Long-press on mobile or use the open button.";
			}
		});
	}

	walkOpen?.addEventListener("click", async () => {
		try {
			await chrome.tabs.create({ url: MINDFUL_WALK_URL, active: false });
		} catch (error) {
			console.warn("Unable to open walk link", error);
		}
	});

	walkMeredith?.addEventListener("click", async () => {
		try {
			await chrome.tabs.create({ url: WALK_TIPS_URL, active: false });
		} catch (error) {
			console.warn("Unable to open Meredith Wenson link", error);
		}
	});

	walkDone?.addEventListener("click", async () => {
		await handleClose();
	});

	walkClose?.addEventListener("click", () => {
		state.walkPanel.open = false;
		state.walkPanel.copyStatus = "idle";
		render();
	});

	breathClose?.addEventListener("click", () => {
		state.breathPanel.open = false;
		render();
	});

	breathDone?.addEventListener("click", async () => {
		await handleClose();
	});

	stretchClose?.addEventListener("click", () => {
		closeStretchPanel();
		render();
	});

	stretchRestart?.addEventListener("click", () => {
		restartStretchSequence();
	});

	stretchDone?.addEventListener("click", async () => {
		await handleClose();
	});

	hydrateClose?.addEventListener("click", () => {
		closeHydratePanel();
		render();
	});

	hydrateRestart?.addEventListener("click", () => {
		restartHydrateTimer();
	});

	hydrateDone?.addEventListener("click", async () => {
		await handleClose();
	});

	callClose?.addEventListener("click", () => {
		closeCallPanel();
		render();
	});

	callDone?.addEventListener("click", async () => {
		await handleClose();
	});

	callPrompt?.addEventListener("click", async () => {
		try {
			await chrome.tabs.create({ url: "https://ggia.berkeley.edu/practice/three-good-things", active: false });
		} catch (error) {
			console.warn("Unable to open gratitude prompt", error);
		}
	});
}

async function handleSubmit() {
	if (state.loading) {
		return;
	}

	const minutesValue = Number(state.minutes);
	if (!state.purpose || Number.isNaN(minutesValue) || minutesValue < 1 || minutesValue > 120) {
		state.error = "Please share your purpose and choose a time between 1 and 120 minutes.";
		render();
		return;
	}

	state.loading = true;
	state.error = null;
	render();

	try {
		const response = await sendMessage("start-session", {
			purpose: state.purpose,
			minutes: minutesValue
		});

		if (!response.ok) {
			throw new Error(response.error || "Unable to start session");
		}
	} catch (error) {
		console.error("Failed to start mindful session", error);
		state.loading = false;
		state.error = error?.message || "Something went wrong. Please try again.";
		render();
	}
}

async function handleClose() {
	closeStretchPanel();
	closeHydratePanel();
	closeCallPanel();
	await sendMessage("cancel-navigation");
}

async function launchActivity(index) {
	const activity = state.activities[index];
	if (!activity) {
		return;
	}

	if (isMusicActivity(activity)) {
		showMusicPanel();
		return;
	}

	if (isWalkActivity(activity)) {
		showWalkPanel();
		return;
	}

	if (isBreathingActivity(activity)) {
		showBreathingPanel();
		return;
	}

	if (isStretchActivity(activity)) {
		showStretchPanel();
		return;
	}

	if (isHydrateActivity(activity)) {
		showHydratePanel();
		return;
	}

	if (isCallActivity(activity)) {
		showCallPanel();
		return;
	}

	try {
		await chrome.tabs.create({ url: activity.url, active: true });
	} catch (error) {
		console.warn("Unable to open activity tab", error);
	}
	await handleClose();
}

function updateSubmitState() {
	const submitButton = app.querySelector("button.primary");
	if (!submitButton) {
		return;
	}

	const minutesValue = Number(state.minutes);
	const disabled =
		state.loading ||
		!state.purpose ||
		Number.isNaN(minutesValue) ||
		minutesValue < 1 ||
		minutesValue > 120;

	submitButton.disabled = disabled;
}

function renderEmptyState() {
	app.innerHTML = `
		<main class="shell">
			<div class="empty-state">
				<h2>Mindful X Blocker</h2>
				<p>Open X (Twitter) to trigger the mindful pause. If you're seeing this message repeatedly, try refreshing the original tab.</p>
				<button type="button" id="close-empty">Close tab</button>
			</div>
		</main>
	`;

	document.getElementById("close-empty").addEventListener("click", async () => {
		await handleClose();
	});
}

function renderError(message) {
	app.innerHTML = `
		<main class="shell">
			<div class="empty-state">
				<h2>We hit a snag</h2>
				<p>${escapeHtml(message)}</p>
				<button type="button" id="close-error">Close tab</button>
			</div>
		</main>
	`;

	document.getElementById("close-error").addEventListener("click", async () => {
		await handleClose();
	});
}

async function sendMessage(type, payload) {
	return chrome.runtime.sendMessage({ type, payload });
}

function safeHostname(url) {
	try {
		return new URL(url).hostname;
	} catch (error) {
		return "the site";
	}
}

function escapeHtml(str) {
	return (str || "").replace(/[&<>'"]+/g, (match) => {
		const map = {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;",
			"'": "&#39;"
		};
		return map[match];
	});
}

function isMusicActivity(activity) {
	return activity.label.toLowerCase().includes("listen to uplifting music");
}

function isWalkActivity(activity) {
	return activity.label.toLowerCase().includes("take a mindful walk");
}

function isBreathingActivity(activity) {
	return activity.label.toLowerCase().includes("quick breathing exercise");
}

function isStretchActivity(activity) {
	return activity.label.toLowerCase().includes("stretch for two minutes");
}

function isHydrateActivity(activity) {
	return activity.label.toLowerCase().includes("hydrate and reset");
}

function isCallActivity(activity) {
	return activity.label.toLowerCase().includes("call a loved one");
}

function showMusicPanel() {
	closeHydratePanel();
	closeCallPanel();
	state.musicPanel.open = true;
	state.musicPanel.isPlaying = false;
	state.walkPanel.open = false;
	state.walkPanel.copyStatus = "idle";
	state.breathPanel.open = false;
	closeStretchPanel();
	render();
}

function showWalkPanel() {
	closeHydratePanel();
	closeCallPanel();
	state.walkPanel.open = true;
	state.walkPanel.copyStatus = "idle";
	state.musicPanel.open = false;
	state.musicPanel.isPlaying = false;
	state.breathPanel.open = false;
	closeStretchPanel();
	render();
}

function showBreathingPanel() {
	closeHydratePanel();
	closeCallPanel();
	state.breathPanel.open = true;
	state.musicPanel.open = false;
	state.musicPanel.isPlaying = false;
	state.walkPanel.open = false;
	closeStretchPanel();
	render();
}

function showStretchPanel() {
	closeHydratePanel();
	closeCallPanel();
	stopStretchTimer();
	state.stretchPanel.open = true;
	state.stretchPanel.activeStep = 0;
	state.stretchPanel.remainingSeconds = STRETCH_STEPS[0]?.duration || 0;
	state.stretchPanel.completed = false;
	state.musicPanel.open = false;
	state.musicPanel.isPlaying = false;
	state.walkPanel.open = false;
	state.walkPanel.copyStatus = "idle";
	state.breathPanel.open = false;
	render();
}

function showHydratePanel() {
	closeStretchPanel();
	closeCallPanel();
	stopHydrateTimer();
	state.hydratePanel.open = true;
	state.hydratePanel.remainingSeconds = HYDRATE_DURATION;
	state.hydratePanel.benefitIndex = 0;
	state.musicPanel.open = false;
	state.musicPanel.isPlaying = false;
	state.walkPanel.open = false;
	state.walkPanel.copyStatus = "idle";
	state.breathPanel.open = false;
	render();
}

function showCallPanel() {
	closeStretchPanel();
	closeHydratePanel();
	state.callPanel.open = true;
	state.musicPanel.open = false;
	state.musicPanel.isPlaying = false;
	state.walkPanel.open = false;
	state.walkPanel.copyStatus = "idle";
	state.breathPanel.open = false;
	render();
}

function renderMusicPanel(track, src) {
	const options = MUSIC_TRACKS.map(
		(option) => `<option value="${option.id}" ${option.id === track.id ? "selected" : ""}>${escapeHtml(option.title)}</option>`
	).join("");

	return `
		<section class="music-panel" aria-label="Uplifting music player">
			<div class="music-panel__header">
				<h2>Stay on track with gentle music</h2>
				<button type="button" class="music-panel__close" data-action="music-close" aria-label="Hide music player">×</button>
			</div>
			<p class="music-panel__description">Pick a soft instrumental track to loop in the background. Everything plays right here—no new tabs.</p>
			<label class="music-panel__label" for="music-track">Choose a track</label>
			<select id="music-track" data-music-select>
				${options}
			</select>
			<div class="music-panel__player">
				<button type="button" class="music-panel__toggle" data-action="music-toggle">
					<span data-music-icon>▶</span>
					<span data-music-status class="music-panel__status">Ready</span>
				</button>
				<div class="music-panel__meta">
					<strong data-music-title>${escapeHtml(track.title)}</strong>
					<span>Licensed via Mixkit (CC0)</span>
				</div>
			</div>
			<a class="music-panel__link" href="${escapeHtml(YOUTUBE_PLAYLIST_URL)}" target="_blank" rel="noopener noreferrer">Prefer a longer cinematic mix? Open the 1-hour playlist on YouTube</a>
			<audio id="music-audio" src="${src}" preload="auto"></audio>
		</section>
	`;
}

function getTrackById(id) {
	return MUSIC_TRACKS.find((track) => track.id === id) || null;
}

function setMusicButtonState({ playing, toggleButton, icon }) {
	if (!toggleButton || !icon) {
		return;
	}

	if (playing) {
		toggleButton.classList.add("music-panel__toggle--playing");
		icon.textContent = "❚❚";
		toggleButton.setAttribute("aria-pressed", "true");
	} else {
		toggleButton.classList.remove("music-panel__toggle--playing");
		icon.textContent = "▶";
		toggleButton.setAttribute("aria-pressed", "false");
	}
}

function renderWalkPanel() {
	return `
		<section class="walk-panel" aria-label="Mindful walk prompt">
			<div class="walk-panel__header">
				<h2>Step outside with intention</h2>
				<button type="button" class="walk-panel__close" data-action="walk-close" aria-label="Hide walk prompt">×</button>
			</div>
			<p class="walk-panel__description">Grab your headphones, press play on the walking meditation, and stroll away from the screen.</p>
			<div class="walk-panel__link">
				<code>${escapeHtml(MINDFUL_WALK_URL)}</code>
				<div class="walk-panel__actions">
					<button type="button" data-action="walk-copy">Copy link</button>
					<button type="button" data-action="walk-open">Open in new tab</button>
					<button type="button" data-action="walk-meredith">Read Meredith Wenson's walk guide</button>
				</div>
			</div>
			<p class="walk-panel__status" data-walk-status>${state.walkPanel.copyStatus === "success" ? "Link copied—text it to yourself and enjoy the walk." : "Copy the link to send it to your phone or open it quietly in a new tab."}</p>
			<div class="walk-panel__footer">
				<button type="button" class="primary" data-action="walk-done">Walk complete – close Twitter</button>
				<button type="button" class="secondary" data-action="walk-close">Go back</button>
			</div>
		</section>
	`;
}

function renderBreathingPanel() {
	return `
		<section class="breathing-panel" aria-label="Quick breathing exercise">
			<div class="breathing-panel__header">
				<h2>Slow down with a calm breath</h2>
				<button type="button" class="breathing-panel__close" data-action="breath-close" aria-label="Hide breathing exercise">×</button>
			</div>
			<p class="breathing-panel__description">Match your inhale and exhale with the gentle expansion of the circle to re-centre before you continue.</p>
			<div class="breathing-panel__visual" aria-hidden="true">
				<span class="breathing-panel__pulse"></span>
				<div class="breathing-panel__circle"></div>
				<div class="breathing-panel__legend">
					<span><strong>Inhale</strong> 4s</span>
					<span><strong>Hold</strong> 2s</span>
					<span><strong>Exhale</strong> 4s</span>
				</div>
			</div>
			<p class="breathing-panel__tip">Tip: Imagine filling your lungs all the way to the sides of your ribs, then let your shoulders melt on the exhale.</p>
			<div class="breathing-panel__footer">
				<button type="button" class="primary" data-action="breath-done">Feeling calmer – close Twitter</button>
				<button type="button" class="secondary" data-action="breath-close">Back to activities</button>
			</div>
		</section>
	`;
}

function renderStretchPanel() {
	if (!STRETCH_STEPS.length) {
		return "";
	}

	const activeIndex = state.stretchPanel.activeStep;
	const completed = state.stretchPanel.completed;
	const remaining = state.stretchPanel.remainingSeconds;
	const statusText = completed
		? "Sequence complete! Sip some water and notice how your posture feels."
		: `Step ${activeIndex + 1} of ${STRETCH_STEPS.length} – ${formatSeconds(remaining)} left.`;

	const stepsHtml = STRETCH_STEPS.map((step, index) => {
		const isActive = !completed && index === activeIndex;
		const isComplete = completed || index < activeIndex;
		const progress = isComplete
			? 100
			: isActive
				? Math.max(0, Math.min(100, Math.round(((step.duration - remaining) / Math.max(step.duration, 1)) * 100)))
				: 0;
		const timeLabel = isComplete && !isActive ? "Done" : `${isActive ? formatSeconds(remaining) : formatSeconds(step.duration)}`;
		return `
			<li class="stretch-step ${isActive ? "stretch-step--active" : ""} ${isComplete ? "stretch-step--complete" : ""}">
				<div class="stretch-step__icon" aria-hidden="true">${escapeHtml(step.icon)}</div>
				<div class="stretch-step__body">
					<div class="stretch-step__title">${escapeHtml(step.title)}</div>
					<p>${escapeHtml(step.description)}</p>
					<div class="stretch-step__progress" role="progressbar" aria-label="${escapeHtml(step.title)} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">
						<span class="stretch-step__bar" style="--stretch-progress:${progress}%"></span>
					</div>
				</div>
				<span class="stretch-step__time">${escapeHtml(timeLabel)}</span>
			</li>
		`;
	}).join("");

	return `
		<section class="stretch-panel" aria-label="Two-minute guided stretch">
			<div class="stretch-panel__header">
				<h2>Stretch for two minutes</h2>
				<button type="button" class="stretch-panel__close" data-action="stretch-close" aria-label="Hide stretch guide">×</button>
			</div>
			<p class="stretch-panel__description">Move slowly, breathe steadily, and follow the prompts below. We'll cycle through three restorative poses.</p>
			<p class="stretch-panel__status">${escapeHtml(statusText)}</p>
			<ol class="stretch-panel__list">
				${stepsHtml}
			</ol>
			<div class="stretch-panel__footer">
				<button type="button" class="primary" data-action="stretch-done">${escapeHtml(completed ? "Sequence complete – close Twitter" : "I'm stretched – close Twitter")}</button>
				<button type="button" class="secondary" data-action="stretch-restart">${escapeHtml(completed ? "Run it again" : "Restart sequence")}</button>
				<button type="button" class="link-button" data-action="stretch-close">Back to activities</button>
			</div>
		</section>
	`;
}

function renderHydratePanel() {
	const remaining = Math.max(0, state.hydratePanel.remainingSeconds);
	const elapsed = HYDRATE_DURATION - remaining;
	const progress = Math.max(0, Math.min(100, Math.round((elapsed / HYDRATE_DURATION) * 100)));
	const benefit = HYDRATE_BENEFITS[state.hydratePanel.benefitIndex] || HYDRATE_BENEFITS[HYDRATE_BENEFITS.length - 1];
	const isComplete = remaining <= 0;
	const statusText = isComplete
		? "Timer complete! Notice your energy before returning."
		: benefit;

	return `
		<section class="hydrate-panel" aria-label="Two-minute hydration break">
			<div class="hydrate-panel__header">
				<h2>Hydrate & reset</h2>
				<button type="button" class="hydrate-panel__close" data-action="hydrate-close" aria-label="Hide hydration timer">×</button>
			</div>
			<p class="hydrate-panel__description">Fill your glass, breathe slowly, and let the clock guide a nourishing pause.</p>
			<div class="hydrate-panel__timer" role="status" aria-live="polite">
				<span class="hydrate-panel__clock">${formatCountdown(remaining)}</span>
				<div class="hydrate-panel__progress" role="progressbar" aria-label="Hydration timer" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">
					<span class="hydrate-panel__bar" style="--hydrate-progress:${progress}%"></span>
				</div>
			</div>
			<p class="hydrate-panel__benefit">${escapeHtml(statusText)}</p>
			<div class="hydrate-panel__footer">
				<button type="button" class="primary" data-action="hydrate-done">${escapeHtml(isComplete ? "Hydrated – close Twitter" : "Glass finished – close Twitter")}</button>
				<button type="button" class="secondary" data-action="hydrate-restart">${escapeHtml(isComplete ? "Start another round" : "Restart 2-minute timer")}</button>
				<button type="button" class="link-button" data-action="hydrate-close">Back to activities</button>
			</div>
		</section>
	`;
}

function renderCallPanel() {
	return `
		<section class="call-panel" aria-label="Call a loved one prompt">
			<div class="call-panel__header">
				<h2>Call a loved one</h2>
				<button type="button" class="call-panel__close" data-action="call-close" aria-label="Hide call prompt">×</button>
			</div>
			<p class="call-panel__description">Place your phone on speaker, soften your shoulders, and let this gentle pulse keep you present while you connect.</p>
			<div class="call-panel__visual" aria-hidden="true">
				<div class="call-panel__wave call-panel__wave--one"></div>
				<div class="call-panel__wave call-panel__wave--two"></div>
				<div class="call-panel__wave call-panel__wave--three"></div>
				<div class="call-panel__heart">❤</div>
			</div>
			<ul class="call-panel__prompts">
				<li>Start with one memory you’re grateful for today.</li>
				<li>Ask how they’re really feeling—then pause and listen.</li>
				<li>Share one small thing you appreciate about them.</li>
			</ul>
			<div class="call-panel__footer">
				<button type="button" class="primary" data-action="call-done">Call complete – close Twitter</button>
				<button type="button" class="secondary" data-action="call-prompt">Need a prompt? Open gratitude exercise</button>
				<button type="button" class="link-button" data-action="call-close">Back to activities</button>
			</div>
		</section>
	`;
}

function syncStretchTimer() {
	if (!state.stretchPanel.open || state.stretchPanel.completed) {
		stopStretchTimer();
		return;
	}

	if (state.stretchPanel.timerId != null) {
		return;
	}

	if (!STRETCH_STEPS.length) {
		return;
	}

	if (state.stretchPanel.remainingSeconds <= 0) {
		state.stretchPanel.remainingSeconds = STRETCH_STEPS[state.stretchPanel.activeStep]?.duration || 0;
	}

	startStretchTimer();
}

function startStretchTimer() {
	if (state.stretchPanel.timerId != null) {
		return;
	}

	state.stretchPanel.timerId = window.setInterval(() => {
		if (!state.stretchPanel.open) {
			stopStretchTimer();
			return;
		}

		if (state.stretchPanel.completed) {
			stopStretchTimer();
			return;
		}

		if (state.stretchPanel.remainingSeconds > 0) {
			state.stretchPanel.remainingSeconds -= 1;
			render();
			return;
		}

		const nextIndex = state.stretchPanel.activeStep + 1;
		if (nextIndex < STRETCH_STEPS.length) {
			state.stretchPanel.activeStep = nextIndex;
			state.stretchPanel.remainingSeconds = STRETCH_STEPS[nextIndex]?.duration || 0;
			render();
			return;
		}

		state.stretchPanel.completed = true;
		state.stretchPanel.remainingSeconds = 0;
		stopStretchTimer();
		render();
	}, 1000);
}

function stopStretchTimer() {
	if (state.stretchPanel.timerId != null) {
		clearInterval(state.stretchPanel.timerId);
		state.stretchPanel.timerId = null;
	}
}

function closeStretchPanel() {
	stopStretchTimer();
	state.stretchPanel.open = false;
	state.stretchPanel.activeStep = 0;
	state.stretchPanel.remainingSeconds = 0;
	state.stretchPanel.completed = false;
}

function restartStretchSequence() {
	stopStretchTimer();
	if (!state.stretchPanel.open) {
		showStretchPanel();
		return;
	}

	state.stretchPanel.activeStep = 0;
	state.stretchPanel.remainingSeconds = STRETCH_STEPS[0]?.duration || 0;
	state.stretchPanel.completed = false;
	render();
}

function syncHydrateTimer() {
	if (!state.hydratePanel.open) {
		stopHydrateTimer();
		return;
	}

	if (state.hydratePanel.timerId != null) {
		return;
	}

	if (state.hydratePanel.remainingSeconds <= 0) {
		return;
	}

	startHydrateTimer();
}

function startHydrateTimer() {
	if (state.hydratePanel.timerId != null) {
		return;
	}

	state.hydratePanel.timerId = window.setInterval(() => {
		if (!state.hydratePanel.open) {
			stopHydrateTimer();
			return;
		}

		if (state.hydratePanel.remainingSeconds > 0) {
			state.hydratePanel.remainingSeconds -= 1;
			updateHydrateBenefit();
			render();
			return;
		}

		stopHydrateTimer();
		state.hydratePanel.remainingSeconds = 0;
		updateHydrateBenefit(true);
		render();
	}, 1000);
}

function stopHydrateTimer() {
	if (state.hydratePanel.timerId != null) {
		clearInterval(state.hydratePanel.timerId);
		state.hydratePanel.timerId = null;
	}
}

function closeHydratePanel() {
	stopHydrateTimer();
	state.hydratePanel.open = false;
	state.hydratePanel.remainingSeconds = HYDRATE_DURATION;
	state.hydratePanel.benefitIndex = 0;
}

function restartHydrateTimer() {
	stopHydrateTimer();
	if (!state.hydratePanel.open) {
		showHydratePanel();
		return;
	}

	state.hydratePanel.remainingSeconds = HYDRATE_DURATION;
	state.hydratePanel.benefitIndex = 0;
	updateHydrateBenefit();
	render();
}

function updateHydrateBenefit(forceFinal = false) {
	if (!state.hydratePanel.open) {
		return;
	}

	if (forceFinal) {
		state.hydratePanel.benefitIndex = HYDRATE_BENEFITS.length - 1;
		return;
	}

	const elapsed = HYDRATE_DURATION - state.hydratePanel.remainingSeconds;
	const segment = Math.max(1, Math.ceil(HYDRATE_DURATION / HYDRATE_BENEFITS.length));
	const index = Math.min(HYDRATE_BENEFITS.length - 1, Math.floor(elapsed / segment));
	state.hydratePanel.benefitIndex = index;
}

function closeCallPanel() {
	state.callPanel.open = false;
}

function formatSeconds(seconds) {
	const value = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 0;
	return `${value}s`;
}

function formatCountdown(seconds) {
	const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
	const minutes = Math.floor(safe / 60);
	const secs = safe % 60;
	return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
