const BLOCKED_HOSTS = ["x.com", "www.x.com", "mobile.x.com", "twitter.com", "www.twitter.com"];
const BLOCKED_URL_PATTERNS = ["*://*.x.com/*", "*://*.twitter.com/*"];
const STORAGE_KEYS = {
	activeSession: "activeSession",
	pendingNavigations: "pendingNavigations"
};
const SESSION_ALARM = "mindful-x-session-expiry";
const ALTERNATIVE_ACTIVITIES = [
	{
		label: "Listen to uplifting music",
		url: "https://www.youtube.com/results?search_query=motivational+songs"
	},
	{
		label: "Take a mindful walk",
		url: "https://www.google.com/search?q=5+minute+walk+ideas"
	},
	{
		label: "Hydrate and reset",
		url: "https://www.healthline.com/nutrition/how-much-water-should-you-drink-per-day"
	},
	{
		label: "Call a loved one",
		url: "https://ggia.berkeley.edu/practice/three-good-things"
	},
	{
		label: "Quick breathing exercise",
		url: "https://www.youtube.com/watch?v=SEfs5TJZ6Nk"
	},
	{
		label: "Stretch for two minutes",
		url: "https://www.youtube.com/results?search_query=2+minute+stretch"
	}
];

chrome.runtime.onInstalled.addListener(async () => {
	await ensureStorageShape();
});

chrome.webNavigation.onBeforeNavigate.addListener(handleNavigation, {
	url: [{ hostSuffix: "x.com" }, { hostSuffix: "twitter.com" }]
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	const handler = messageHandlers[message.type];
	if (!handler) {
		return false;
	}

	handler(message, sender)
		.then((result) => sendResponse({ ok: true, result }))
		.catch((error) => {
			console.error(`[MindfulX] ${message.type} failed`, error);
			sendResponse({ ok: false, error: error?.message || "Unknown error" });
		});

	return true;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
	if (alarm.name !== SESSION_ALARM) {
		return;
	}

	const session = await getActiveSession();
	if (!session) {
		return;
	}

	session.status = "expired";
	await setLocal({ [STORAGE_KEYS.activeSession]: session });
	await notifyTabs(session.allowedTabIds || [], {
		type: "session-expired",
		payload: session
	});
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
	const pending = await getPendingNavigations();
	if (pending[tabId]) {
		delete pending[tabId];
		await setLocal({ [STORAGE_KEYS.pendingNavigations]: pending });
	}

	const session = await getActiveSession();
	if (!session) {
		return;
	}

	const nextAllowed = (session.allowedTabIds || []).filter((id) => id !== tabId);
	if (nextAllowed.length !== (session.allowedTabIds || []).length) {
		session.allowedTabIds = nextAllowed;
		await setLocal({ [STORAGE_KEYS.activeSession]: session });
	}
});

const messageHandlers = {
	"intervention-ready": async (_, sender) => {
		const pending = await getPendingNavigations();
		const tabId = sender.tab?.id;
		const session = await getActiveSession();
		return {
			alternativeActivities: ALTERNATIVE_ACTIVITIES,
			pendingNavigation: tabId != null ? pending[tabId] || null : null,
			activeSession: session
		};
	},
	"start-session": async (message, sender) => {
		const tabId = sender.tab?.id;
		if (tabId == null) {
			throw new Error("Missing tab context");
		}

		const { purpose, minutes } = message.payload;
		const pending = await getPendingNavigations();
		const pendingEntry = pending[tabId];
		if (!pendingEntry) {
			throw new Error("No pending navigation found");
		}

		const now = Date.now();
		const ms = minutes * 60 * 1000;
		const session = {
			purpose,
			minutes,
			createdAt: now,
			endTime: now + ms,
			allowedTabIds: [tabId],
			targetUrl: pendingEntry.targetUrl,
			status: "active"
		};

		await Promise.all([
			setLocal({ [STORAGE_KEYS.activeSession]: session }),
			createSessionAlarm(session.endTime)
		]);

		delete pending[tabId];
		await setLocal({ [STORAGE_KEYS.pendingNavigations]: pending });

		await focusAndNavigate(tabId, session.targetUrl);

		return session;
	},
	"cancel-navigation": async (_, sender) => {
		const tabId = sender.tab?.id;
		if (tabId == null) {
			throw new Error("Missing tab context");
		}

		const pending = await getPendingNavigations();
		if (pending[tabId]) {
			delete pending[tabId];
			await setLocal({ [STORAGE_KEYS.pendingNavigations]: pending });
		}

		await chrome.tabs.remove(tabId);
	},
	"get-session": async () => {
		return getActiveSession();
	},
	"register-tab": async (_, sender) => {
		const tabId = sender.tab?.id;
		if (tabId == null) {
			return null;
		}

		const session = await getActiveSession();
		if (!session) {
			return null;
		}

		if (!session.allowedTabIds.includes(tabId)) {
			session.allowedTabIds.push(tabId);
			await setLocal({ [STORAGE_KEYS.activeSession]: session });
		}

		return session;
	},
	"close-session": async () => {
		await endSession({ closeTabs: true, reason: "user" });
	},
	"request-extension": async (_, sender) => {
		const tabId = sender.tab?.id;
		const session = await getActiveSession();
		if (!session || tabId == null) {
			throw new Error("No active session to extend");
		}

		await endSession({ closeTabs: false, reason: "extend" });

		const pending = await getPendingNavigations();
		pending[tabId] = {
			targetUrl: session.targetUrl,
			createdAt: Date.now(),
			previousPurpose: session.purpose
		};
		await setLocal({ [STORAGE_KEYS.pendingNavigations]: pending });

		await focusAndNavigate(tabId, chrome.runtime.getURL("intervention/intervention.html"));
	}
};

async function handleNavigation(details) {
	if (details.frameId !== 0) {
		return;
	}

	const url = new URL(details.url);
	if (!BLOCKED_HOSTS.includes(url.host)) {
		return;
	}

	const session = await getActiveSession();
	if (session) {
		if (Date.now() >= session.endTime) {
			session.status = "expired";
			await setLocal({ [STORAGE_KEYS.activeSession]: session });
			await notifyTabs(session.allowedTabIds || [], {
				type: "session-expired",
				payload: session
			});
			await redirectToIntervention(details.tabId, details.url);
			return;
		}

		if (!session.allowedTabIds.includes(details.tabId)) {
			session.allowedTabIds.push(details.tabId);
			await setLocal({ [STORAGE_KEYS.activeSession]: session });
		}
		return;
	}

	await redirectToIntervention(details.tabId, details.url);
}

async function redirectToIntervention(tabId, targetUrl) {
	const pending = await getPendingNavigations();
	pending[tabId] = {
		targetUrl,
		createdAt: Date.now()
	};
	await setLocal({ [STORAGE_KEYS.pendingNavigations]: pending });

	await focusAndNavigate(tabId, chrome.runtime.getURL("intervention/intervention.html"));
}

async function ensureStorageShape() {
	const data = await chrome.storage.local.get([STORAGE_KEYS.pendingNavigations]);
	if (!data[STORAGE_KEYS.pendingNavigations]) {
		await setLocal({ [STORAGE_KEYS.pendingNavigations]: {} });
	}
}

async function getActiveSession() {
	const result = await chrome.storage.local.get(STORAGE_KEYS.activeSession);
	return result[STORAGE_KEYS.activeSession] || null;
}

async function getPendingNavigations() {
	const result = await chrome.storage.local.get(STORAGE_KEYS.pendingNavigations);
	return result[STORAGE_KEYS.pendingNavigations] || {};
}

async function setLocal(payload) {
	await chrome.storage.local.set(payload);
}

async function createSessionAlarm(when) {
	await chrome.alarms.clear(SESSION_ALARM);
	await chrome.alarms.create(SESSION_ALARM, { when });
}

async function focusAndNavigate(tabId, url) {
	try {
		await chrome.tabs.update(tabId, { url, active: true });
	} catch (error) {
		console.warn("Failed to update tab", error);
	}
}

async function endSession({ closeTabs, reason }) {
	const session = await getActiveSession();
	if (!session) {
		if (closeTabs) {
			await closeBlockedTabs();
		}
		return;
	}

	await chrome.alarms.clear(SESSION_ALARM);
	await chrome.storage.local.remove(STORAGE_KEYS.activeSession);

	if (closeTabs) {
		await closeBlockedTabs(session.allowedTabIds || []);
	}

	await notifyTabs(session.allowedTabIds || [], {
		type: "session-ended",
		payload: { reason }
	});
}

async function closeBlockedTabs(preferredTabIds = []) {
	const seen = new Set();
	for (const tabId of preferredTabIds) {
		seen.add(tabId);
		try {
			await chrome.tabs.remove(tabId);
		} catch (error) {
			console.debug(`Unable to remove tab ${tabId}`, error);
		}
	}

	try {
		const matches = await chrome.tabs.query({ url: BLOCKED_URL_PATTERNS });
		for (const tab of matches) {
			if (tab.id == null || seen.has(tab.id)) {
				continue;
			}
			try {
				await chrome.tabs.remove(tab.id);
			} catch (error) {
				console.debug(`Unable to remove queried tab ${tab.id}`, error);
			}
		}
	} catch (error) {
		console.warn("Failed to query blocked tabs", error);
	}
}

async function notifyTabs(tabIds, message) {
	const deliveries = (tabIds || []).map(async (tabId) => {
		try {
			await chrome.tabs.sendMessage(tabId, message);
		} catch (error) {
			if (!/Receiving end does not exist/i.test(error?.message || "")) {
				console.debug(`Failed to notify tab ${tabId}`, error);
			}
		}
	});
	await Promise.all(deliveries);
}
